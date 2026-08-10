import { useState, useCallback, useRef } from "react";

export interface KlineData {
  time: number; // ms timestamp (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Interval string → milliseconds
export function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
    "3d": 259_200_000,
    "1w": 604_800_000,
    // 月线按最大自然月长度估算覆盖范围；Binance 的下一根月线会在实际月初接管。
    "1M": 2_678_400_000,
  };
  return map[interval] || 60_000;
}

/** HTTP 状态码：可重试的「瞬时」错误（限流 429 / 418、网关与服务端抖动 5xx）。 */
const RETRYABLE_STATUS = new Set([418, 429, 500, 502, 503, 504]);
/** 单个批次取数的最大重试次数（不含首次）。 */
const MAX_FETCH_RETRIES = 2;
/** 重试退避基数（毫秒），按指数增长：250 → 500。 */
const RETRY_BASE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a single batch of klines from Binance fapi.
 *
 * 对 Binance REST 的瞬时限流（HTTP 429 / 418）与网关抖动（5xx）做有界指数退避重试：
 * 「信号库」批量跳转 + 「手动启动」可能在短时间内连续打多次 klines 请求，偶发 429
 * 不应直接冒泡成「数据获取失败」。重试用尽后仍失败才抛出 `API <status>`，交由上层处理。
 */
async function fetchBatch(
  symbol: string,
  interval: string,
  params: { startTime?: number; endTime?: number; limit?: number },
  attempt = 0,
): Promise<KlineData[]> {
  const qs = new URLSearchParams({
    symbol,
    interval,
    limit: String(params.limit ?? 1000),
  });
  if (params.startTime != null) qs.set("startTime", String(params.startTime));
  if (params.endTime != null) qs.set("endTime", String(params.endTime));

  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
  if (!res.ok) {
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_FETCH_RETRIES) {
      await sleep(RETRY_BASE_MS * 2 ** attempt);
      return fetchBatch(symbol, interval, params, attempt + 1);
    }
    throw new Error(`API ${res.status}`);
  }
  const raw: any[][] = await res.json();
  return raw.map((k) => ({
    time: k[0] as number,
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/**
 * useBinanceData — lazy-loading kline data manager with sub-candle interpolation.
 */
export function useBinanceData() {
  const [allData, setAllData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<{ symbol: string; interval: string }>({ symbol: "", interval: "" });
  const oldestRef = useRef<number>(Infinity);
  const noMoreRef = useRef(false);
  const newestRef = useRef<number>(0);
  const noMoreNewerRef = useRef(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const initLoadRequestIdRef = useRef(0);

  /** Direct ref access to allData — avoids stale closures in RAF loops */
  const allDataRef = useRef<KlineData[]>([]);

  // Keep ref in sync
  const setAllDataAndRef = useCallback((updater: KlineData[] | ((prev: KlineData[]) => KlineData[])) => {
    setAllData((prev) => {
      const next = typeof updater === "function" ? (updater as (prev: KlineData[]) => KlineData[])(prev) : updater;
      allDataRef.current = next;
      return next;
    });
  }, []);

  const initLoad = useCallback(
    async (symbol: string, interval: string, anchorTime: number, opts?: { reverse?: boolean }) => {
      const requestId = ++initLoadRequestIdRef.current;
      setLoading(true);
      setError(null);

      try {
        // 正放：锚点前 1000 根作历史 + 300 根前瞻缓冲。
        // 倒放（镜像）：完全对称——锚点后 1000 根作「主观历史」（真实未来，铺在
        // 镜像图左侧）+ 锚点前 300 根作倒走的流式缓冲。
        const [historyData, futureData] = opts?.reverse
          ? await Promise.all([
              fetchBatch(symbol, interval, { startTime: anchorTime, limit: 1000 }),
              fetchBatch(symbol, interval, { endTime: anchorTime - 1, limit: 300 }).catch(() => []),
            ])
          : await Promise.all([
              fetchBatch(symbol, interval, { endTime: anchorTime, limit: 1000 }),
              fetchBatch(symbol, interval, { startTime: anchorTime + 1, limit: 300 }).catch(() => []),
            ]);
        // 正放要求锚点前有历史；倒放的「历史」在锚点后，任一侧有数据即可开局。
        if (opts?.reverse ? historyData.length === 0 && futureData.length === 0 : historyData.length === 0) {
          throw new Error("No data returned");
        }

        const seen = new Set(historyData.map((k) => k.time));
        const extra = futureData.filter((k) => !seen.has(k.time));
        // 倒放的 futureData 在锚点之前（真实更早），必须排在前面才保持升序。
        const merged = opts?.reverse ? [...extra, ...historyData] : [...historyData, ...extra];

        if (requestId !== initLoadRequestIdRef.current) {
          return merged;
        }

        // 仅在「确实拿到数据且本次请求仍是最新」时，才提交数据层上下文。
        // 这样一次失败 / 被取代的取数不会改动 ctxRef / oldestRef / noMoreRef / allData——
        // 失败的「信号库」跳转对「手动启动」所依赖的数据层是彻底的 no-op。
        ctxRef.current = { symbol, interval };
        oldestRef.current = merged[0].time;
        noMoreRef.current = false;
        newestRef.current = merged[merged.length - 1].time;
        noMoreNewerRef.current = false;
        setAllDataAndRef(merged);
        return merged;
      } catch (e: any) {
        if (requestId === initLoadRequestIdRef.current) {
          setError(e.message);
        }
        return [];
      } finally {
        if (requestId === initLoadRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [setAllDataAndRef],
  );

  /**
   * 向后补更晚的 K 线（loadOlder 的镜像）。倒放时镜像图左沿 = 真实更晚的数据，
   * 向左拖动即需要它；追加在数组尾部，保持升序。
   */
  const loadNewer = useCallback(async (): Promise<number> => {
    if (loadingNewer || noMoreNewerRef.current) return 0;
    const { symbol, interval } = ctxRef.current;
    if (!symbol || newestRef.current <= 0) return 0;

    setLoadingNewer(true);
    try {
      const startTime = newestRef.current + 1;
      const newer = await fetchBatch(symbol, interval, { startTime, limit: 1000 });

      if (newer.length === 0) {
        noMoreNewerRef.current = true;
        return 0;
      }
      if (newer.length < 1000) noMoreNewerRef.current = true;

      newestRef.current = newer[newer.length - 1].time;

      setAllDataAndRef((prev) => {
        const existingLast = prev.length > 0 ? prev[prev.length - 1].time : -Infinity;
        const unique = newer.filter((k) => k.time > existingLast);
        return [...prev, ...unique];
      });

      return newer.length;
    } catch (e: any) {
      console.error("Failed to load newer data:", e);
      return 0;
    } finally {
      setLoadingNewer(false);
    }
  }, [loadingNewer, setAllDataAndRef]);

  const loadOlder = useCallback(async (): Promise<number> => {
    if (loadingOlder || noMoreRef.current) return 0;
    const { symbol, interval } = ctxRef.current;
    if (!symbol) return 0;

    setLoadingOlder(true);
    try {
      const endTime = oldestRef.current - 1;
      const older = await fetchBatch(symbol, interval, { endTime, limit: 1000 });

      if (older.length === 0) {
        noMoreRef.current = true;
        return 0;
      }

      if (older.length < 1000) noMoreRef.current = true;

      oldestRef.current = older[0].time;

      setAllDataAndRef((prev) => {
        const existingFirst = prev.length > 0 ? prev[0].time : Infinity;
        const unique = older.filter((k) => k.time < existingFirst);
        return [...unique, ...prev];
      });

      return older.length;
    } catch (e: any) {
      console.error("Failed to load older data:", e);
      return 0;
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, setAllDataAndRef]);

  /**
   * Get visible data up to simulated time with sub-candle interpolation.
   *
   * When `intervalMs` is provided and the last visible candle is still "forming"
   * (sim time hasn't reached candle close), its OHLCV values are interpolated
   * to create a realistic live-candle animation effect.
   */
  const getVisibleData = useCallback(
    (currentSimTime: number, intervalMs?: number): KlineData[] => {
      const visible = allData.filter((k) => k.time <= currentSimTime);
      if (visible.length === 0 || !intervalMs || intervalMs <= 0) return visible;

      const last = visible[visible.length - 1];
      const candleEnd = last.time + intervalMs;

      // If sim time hasn't completed this candle, interpolate its forming state
      if (currentSimTime < candleEnd) {
        const isLiveCandle = candleEnd > Date.now() - 60000;
        const progress = Math.max(0, Math.min(1, (currentSimTime - last.time) / intervalMs));

        // Close interpolates linearly from open toward final close
        const close = isLiveCandle ? last.close : last.open + (last.close - last.open) * progress;

        // High/low gradually reveal with a slight lead so extremes appear naturally
        const hlReveal = Math.min(1, progress * 1.5);
        const rawHigh = isLiveCandle ? last.high : last.open + (last.high - last.open) * hlReveal;
        const rawLow = isLiveCandle ? last.low : last.open + (last.low - last.open) * hlReveal;

        // Enforce OHLC constraints
        const high = isLiveCandle ? last.high : Math.max(last.open, close, rawHigh);
        const low = isLiveCandle ? last.low : Math.min(last.open, close, rawLow);

        visible[visible.length - 1] = {
          time: last.time,
          open: last.open,
          high,
          low,
          close,
          volume: last.volume * progress,
        };
      }

      return visible;
    },
    [allData],
  );

  const reset = useCallback(() => {
    initLoadRequestIdRef.current += 1;
    setAllDataAndRef([]);
    oldestRef.current = Infinity;
    noMoreRef.current = false;
    newestRef.current = 0;
    noMoreNewerRef.current = false;
    setError(null);
    setLoading(false);
  }, [setAllDataAndRef]);

  return {
    allData,
    allDataRef,
    loading,
    loadingOlder,
    loadingNewer,
    error,
    initLoad,
    loadOlder,
    loadNewer,
    getVisibleData,
    reset,
  };
}
