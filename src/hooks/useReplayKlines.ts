/**
 * useReplayKlines — 拉取指定时间范围 + 周期的历史 K 线（只读，不挂在主 useBinanceData 上）
 */
import { useEffect, useRef, useState } from 'react';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import { normalizeReplayKlines } from '@/lib/replayKlineWindow';

export type ReplayKlineRequestPriority = 'interactive' | 'background';

export type ReplayKlineErrorKind = 'rate-limit' | 'timeout' | 'network' | 'server' | 'invalid-response' | 'invalid-request';

/** Machine-readable failures let background work retry without mistaking an incomplete range for data. */
export class ReplayKlineRequestError extends Error {
  constructor(
    message: string,
    readonly kind: ReplayKlineErrorKind,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ReplayKlineRequestError';
  }
}

type PendingKlineRequest = {
  priority: ReplayKlineRequestPriority;
  signal?: AbortSignal;
  run: () => Promise<KlineData[]>;
  resolve: (data: KlineData[]) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
};

const pendingKlineRequests: PendingKlineRequest[] = [];
let klineRequestPumpRunning = false;
let nextBackgroundKlineRequestAt = 0;
let backgroundKlineCooldownUntil = 0;
let preferAlternateKlineEndpointUntil = 0;
let wakeKlineRequestPump: (() => void) | undefined;

const BACKGROUND_REQUEST_GAP_MS = 750;
const KLINE_REQUEST_TIMEOUT_MS = 15_000;
const abortError = () => new DOMException('Aborted', 'AbortError');
const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function backgroundCooldownError(): ReplayKlineRequestError | undefined {
  const remainingMs = backgroundKlineCooldownUntil - Date.now();
  return remainingMs > 0
    ? new ReplayKlineRequestError('API 429', 'rate-limit', true, 429, remainingMs)
    : undefined;
}

function waitForKlineQueue(ms: number): Promise<void> {
  return new Promise(resolve => {
    const wake = () => {
      clearTimeout(timer);
      if (wakeKlineRequestPump === wake) wakeKlineRequestPump = undefined;
      resolve();
    };
    const timer = setTimeout(wake, ms);
    wakeKlineRequestPump = wake;
  });
}

/**
 * One network page (including its response body) at a time. Choose the next item only after the
 * background pacing wait; a detail request arriving during that wait wakes it and goes first.
 * Failed and cancelled background pages are paced too, so retries cannot create request bursts.
 */
async function pumpKlineRequests(): Promise<void> {
  if (klineRequestPumpRunning) return;
  klineRequestPumpRunning = true;
  try {
    while (pendingKlineRequests.length > 0) {
      const interactiveIndex = pendingKlineRequests.findIndex(item => item.priority === 'interactive');
      if (interactiveIndex < 0) {
        const delay = Math.max(0, nextBackgroundKlineRequestAt - Date.now());
        if (delay > 0) {
          await waitForKlineQueue(delay);
          continue;
        }
      }
      const [item] = pendingKlineRequests.splice(interactiveIndex >= 0 ? interactiveIndex : 0, 1);
      if (!item) continue;
      if (item.signal?.aborted) {
        item.cleanup();
        item.reject(abortError());
        continue;
      }
      const cooldown = item.priority === 'background' ? backgroundCooldownError() : undefined;
      if (cooldown) {
        item.cleanup();
        item.reject(cooldown);
        continue;
      }
      try {
        item.resolve(await item.run());
      } catch (error) {
        item.reject(error);
      } finally {
        if (item.priority === 'background') {
          nextBackgroundKlineRequestAt = Date.now() + BACKGROUND_REQUEST_GAP_MS;
        }
        item.cleanup();
      }
    }
  } finally {
    klineRequestPumpRunning = false;
    if (pendingKlineRequests.length > 0) void pumpKlineRequests();
  }
}

function responseError(response: Response): ReplayKlineRequestError {
  const rateLimited = response.status === 418 || response.status === 429;
  const retryAfter = response.headers?.get?.('retry-after');
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  const retryAfterDate = retryAfter ? Date.parse(retryAfter) : NaN;
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1_000
    : Number.isFinite(retryAfterDate) && retryAfterDate > Date.now()
      ? retryAfterDate - Date.now()
      : rateLimited ? (response.status === 418 ? 120_000 : 30_000) : undefined;
  return new ReplayKlineRequestError(
    `API ${response.status}`,
    rateLimited ? 'rate-limit' : response.status >= 500 ? 'server' : 'invalid-request',
    rateLimited || response.status >= 500 || response.status === 408,
    response.status,
    retryAfterMs,
  );
}

/** Timeout covers fetch AND body reading. Racing also releases the queue if an adapter ignores abort. */
async function fetchKlinePage(url: string, signal?: AbortSignal): Promise<KlineData[]> {
  throwIfAborted(signal);
  const controller = new AbortController();
  let rejectInterruption: (error: unknown) => void = () => undefined;
  const interruption = new Promise<never>((_, reject) => { rejectInterruption = reject; });
  const onAbort = () => {
    rejectInterruption(abortError());
    controller.abort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    rejectInterruption(new ReplayKlineRequestError('K 线请求超时', 'timeout', true));
    controller.abort();
  }, KLINE_REQUEST_TIMEOUT_MS);
  try {
    return await Promise.race([
      interruption,
      (async () => {
        const response = await fetch(url, { signal: controller.signal });
        throwIfAborted(signal);
        if (!response.ok) throw responseError(response);
        let raw: unknown;
        try {
          raw = await response.json();
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new ReplayKlineRequestError('K 线响应格式无效', 'invalid-response', true);
        }
        throwIfAborted(signal);
        if (!Array.isArray(raw)) throw new ReplayKlineRequestError('K 线响应格式无效', 'invalid-response', true);
        return raw.map((row: unknown) => {
          if (!Array.isArray(row) || row.length < 6) {
            throw new ReplayKlineRequestError('K 线数据不完整', 'invalid-response', true);
          }
          const values = row.slice(0, 6).map(value => (
            typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
              ? Number(value)
              : NaN
          ));
          if (values.some(value => !Number.isFinite(value))) {
            throw new ReplayKlineRequestError('K 线数据不完整', 'invalid-response', true);
          }
          const [time, open, high, low, close, volume] = values;
          return { time, open, high, low, close, volume };
        });
      })(),
    ]);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof ReplayKlineRequestError || isAbortError(error)) throw error;
    throw new ReplayKlineRequestError('K 线网络请求失败', 'network', true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function governedKlineFetch(
  url: string,
  signal: AbortSignal | undefined,
  priority: ReplayKlineRequestPriority,
): Promise<KlineData[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      const index = pendingKlineRequests.indexOf(item);
      if (index >= 0) pendingKlineRequests.splice(index, 1);
      item.cleanup();
      reject(abortError());
      wakeKlineRequestPump?.();
    };
    const item: PendingKlineRequest = {
      priority,
      signal,
      run: () => fetchKlinePage(url, signal),
      resolve,
      reject,
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pendingKlineRequests.push(item);
    wakeKlineRequestPump?.();
    void pumpKlineRequests();
  });
}

export async function fetchReplayKlineRange(
  symbol: string,
  interval: string,
  fromTime: number,
  toTime: number,
  signal?: AbortSignal,
  options?: { priority?: ReplayKlineRequestPriority },
): Promise<KlineData[]> {
  throwIfAborted(signal);
  if (!symbol || !Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    throw new ReplayKlineRequestError('K 线请求参数无效', 'invalid-request', false);
  }
  const out: KlineData[] = [];
  let cursor = fromTime;
  const priority = options?.priority ?? 'interactive';
  // Binance fapi limit 1500 per request
  const limit = 1500;
  while (cursor < toTime) {
    throwIfAborted(signal);
    const qs = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(toTime),
      limit: String(limit),
    });
    const cooldown = priority === 'background' ? backgroundCooldownError() : undefined;
    if (cooldown) throw cooldown;
    const primaryUrl = `https://fapi.binance.com/fapi/v1/klines?${qs}`;
    const alternateUrl = `https://www.binance.com/fapi/v1/klines?${qs}`;
    const alternateFirst = preferAlternateKlineEndpointUntil > Date.now();
    let page: KlineData[];
    try {
      page = await governedKlineFetch(alternateFirst ? alternateUrl : primaryUrl, signal, priority);
    } catch (firstError) {
      throwIfAborted(signal);
      if (!(firstError instanceof ReplayKlineRequestError) || !firstError.retryable) throw firstError;
      try {
        page = await governedKlineFetch(alternateFirst ? primaryUrl : alternateUrl, signal, priority);
        preferAlternateKlineEndpointUntil = alternateFirst ? 0 : Date.now() + 5 * 60_000;
      } catch (secondError) {
        throwIfAborted(signal);
        const rateLimitErrors = [firstError, secondError].filter(
          (error): error is ReplayKlineRequestError => error instanceof ReplayKlineRequestError && error.kind === 'rate-limit',
        );
        if (rateLimitErrors.length > 0) {
          const rateLimitError = rateLimitErrors.reduce((longest, error) => (
            (error.retryAfterMs ?? 0) > (longest.retryAfterMs ?? 0) ? error : longest
          ));
          const retryAfterMs = rateLimitError.retryAfterMs ?? 120_000;
          // A detail request can discover the ban too. Stop bulk work in either case while
          // allowing a user-triggered detail retry to probe whether access has recovered.
          // A failed alternate must not erase the first endpoint's Retry-After with a network/5xx error.
          backgroundKlineCooldownUntil = Math.max(backgroundKlineCooldownUntil, Date.now() + retryAfterMs);
          throw new ReplayKlineRequestError(rateLimitError.message, 'rate-limit', true, rateLimitError.status, retryAfterMs);
        }
        throw secondError;
      }
    }
    throwIfAborted(signal);
    if (page.length === 0) break;
    out.push(...page);
    const last = out[out.length - 1];
    if (!last) break;
    const next = last.time + intervalToMs(interval);
    if (next <= cursor) throw new ReplayKlineRequestError('K 线分页未前进', 'invalid-response', true);
    cursor = next;
    if (page.length < limit) break;
  }
  throwIfAborted(signal);
  return normalizeReplayKlines(out);
}

export interface UseReplayKlinesResult {
  klines: KlineData[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useReplayKlines(
  symbol: string,
  fromTime: number,
  toTime: number,
  interval: string = '1m',
): UseReplayKlinesResult {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * 手上这份数据（或错误）属于哪一组参数。参数刚变、effect 还没来得及把 loading 置真的那一帧，
   * 旧写法会把上一组参数的 K 线（别的周期、别的窗口）当成这一组交出去——
   * 盘面按新周期的 intervalMs 画旧周期的蜡烛闪一帧。按参数认账：对不上就一律算「加载中」。
   */
  const requestKey = `${symbol}|${interval}|${fromTime}|${toTime}|${reloadKey}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  /**
   * 最后一次成功拉到手的是哪组参数。调用方停用这份（symbol 置空）后原样回来——
   * 详情页的另拉槽在盘面回到计算那一份时就这样空出来、切回来又落进同一个槽——
   * 手上的数据就是这一组的，不重拉：旧写法第一帧先把它交出去，effect 又置「加载中」重拉一遍，
   * 盘面挂上、闪一下「加载 K 线…」、再重挂，每来回一趟多一份请求。
   * 换了别的参数开拉就作废（手上的已不是这一组）；失败不记；重试会改 reloadKey，照常重拉。
   */
  const okKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    if (okKeyRef.current === requestKey) return;
    okKeyRef.current = null;
    let cancelled = false;
    // 旧写法只翻一个 cancelled 标志，分页循环仍会跑完并继续吃带宽。
    // 加了绝对时间预设后「连点几个预设」会叠出几个各自数 MB 的串行分页循环，必须真的中断。
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchReplayKlineRange(symbol, interval, fromTime, toTime, controller.signal)
      .then(data => {
        if (cancelled) return;
        setKlines(data);
        okKeyRef.current = requestKey;
      })
      .catch(e => {
        if (cancelled || controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, interval, fromTime, toTime, reloadKey, requestKey]);

  const settled = settledKey === requestKey;
  return {
    klines,
    loading: loading || !settled,
    error: settled ? error : null,
    reload: () => setReloadKey(k => k + 1),
  };
}
