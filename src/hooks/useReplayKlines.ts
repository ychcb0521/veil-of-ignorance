/**
 * useReplayKlines — 拉取指定时间范围 + 周期的历史 K 线（只读，不挂在主 useBinanceData 上）
 */
import { useEffect, useRef, useState } from 'react';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import { normalizeReplayKlines } from '@/lib/replayKlineWindow';
import { supabase } from '@/integrations/supabase/client';

export type ReplayKlineRequestPriority = 'interactive' | 'background';

type PendingKlineRequest = {
  priority: ReplayKlineRequestPriority;
  signal?: AbortSignal;
  run: () => Promise<Response>;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
};

const pendingKlineRequests: PendingKlineRequest[] = [];
let klineRequestPumpRunning = false;
let nextKlineRequestAt = 0;
let klineCooldownUntil = 0;
let preferKlineProxyUntil = 0;

// Interactive charts retain their existing immediate behaviour. Only bulk/background pagination is
// paced; it is the source of sustained request pressure and must yield to detail-page work.
const requestGapMs = (priority: ReplayKlineRequestPriority) => priority === 'background' ? 1_500 : 0;

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/**
 * All replay-Kline pages share one queue. A background list scan can therefore never burst four
 * pagination requests or overtake a detail-page chart. 418/429 opens a circuit breaker, so queued
 * work fails fast instead of extending Binance's IP ban by continuing to hit the endpoint.
 */
async function pumpKlineRequests(): Promise<void> {
  if (klineRequestPumpRunning) return;
  klineRequestPumpRunning = true;
  try {
    while (pendingKlineRequests.length > 0) {
      const interactiveIndex = pendingKlineRequests.findIndex(item => item.priority === 'interactive');
      const [item] = pendingKlineRequests.splice(interactiveIndex >= 0 ? interactiveIndex : 0, 1);
      if (!item) continue;
      if (item.signal?.aborted) {
        item.reject(new DOMException('Aborted', 'AbortError'));
        continue;
      }
      const now = Date.now();
      if (klineCooldownUntil > now) {
        item.reject(new Error('API 429'));
        continue;
      }
      const delay = Math.max(0, nextKlineRequestAt - now);
      if (delay > 0) await wait(delay);
      if (item.signal?.aborted) {
        item.reject(new DOMException('Aborted', 'AbortError'));
        continue;
      }
      try {
        const response = await item.run();
        nextKlineRequestAt = Date.now() + requestGapMs(item.priority);
        if (item.priority === 'background' && (response.status === 418 || response.status === 429)) {
          const retryAfterSeconds = Number(response.headers?.get?.('retry-after'));
          const fallbackMs = response.status === 418 ? 120_000 : 30_000;
          klineCooldownUntil = Date.now() + (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1_000
            : fallbackMs);
        }
        item.resolve(response);
      } catch (error) {
        item.reject(error);
      }
    }
  } finally {
    klineRequestPumpRunning = false;
    if (pendingKlineRequests.length > 0) void pumpKlineRequests();
  }
}

function governedKlineFetch(
  url: string,
  signal: AbortSignal | undefined,
  priority: ReplayKlineRequestPriority,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    pendingKlineRequests.push({
      priority,
      signal,
      run: () => fetch(url, { signal }),
      resolve,
      reject,
    });
    void pumpKlineRequests();
  });
}

async function fetchAuthenticatedKlineFallback(qs: URLSearchParams, signal?: AbortSignal): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return new Response(null, { status: 401 });
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return fetch(`${supabaseUrl}/functions/v1/binance-klines`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(Object.fromEntries(qs.entries())),
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
  const out: KlineData[] = [];
  let cursor = fromTime;
  // Binance fapi limit 1500 per request
  const limit = 1500;
  while (cursor < toTime) {
    if (signal?.aborted) break;
    const qs = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(toTime),
      limit: String(limit),
    });
    const priority = options?.priority ?? 'interactive';
    let res: Response;
    if (priority === 'interactive' && preferKlineProxyUntil > Date.now()) {
      res = await fetchAuthenticatedKlineFallback(qs, signal);
      if (!res.ok) preferKlineProxyUntil = 0;
    } else {
      res = await governedKlineFetch(
        `https://fapi.binance.com/fapi/v1/klines?${qs}`,
        signal,
        priority,
      );
      // The authenticated fallback is reserved for the campaign the user is actively viewing.
      // Bulk list metrics remain on the paced direct queue and can never transfer their load here.
      if (priority === 'interactive' && (res.status === 418 || res.status === 429)) {
        const fallback = await fetchAuthenticatedKlineFallback(qs, signal);
        if (fallback.ok) {
          preferKlineProxyUntil = Date.now() + 5 * 60_000;
          res = fallback;
        }
      }
    }
    if (!res.ok) throw new Error(`API ${res.status}`);
    const raw: unknown[][] = await res.json();
    if (raw.length === 0) break;
    for (const k of raw) {
      out.push({
        time: k[0] as number,
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      });
    }
    const last = out[out.length - 1];
    if (!last) break;
    const next = last.time + intervalToMs(interval);
    if (next <= cursor) break;
    cursor = next;
    if (raw.length < limit) break;
  }
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
