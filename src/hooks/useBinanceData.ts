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
  };
  return map[interval] || 60_000;
}

/**
 * Fetch a single batch of klines from Binance fapi.
 */
async function fetchBatch(
  symbol: string,
  interval: string,
  params: { startTime?: number; endTime?: number; limit?: number },
): Promise<KlineData[]> {
  const qs = new URLSearchParams({
    symbol,
    interval,
    limit: String(params.limit ?? 1000),
  });
  if (params.startTime != null) qs.set("startTime", String(params.startTime));
  if (params.endTime != null) qs.set("endTime", String(params.endTime));

  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
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
    async (symbol: string, interval: string, anchorTime: number) => {
      setLoading(true);
      setError(null);
      noMoreRef.current = false;
      ctxRef.current = { symbol, interval };

      try {
        const [historyData, futureData] = await Promise.all([
          fetchBatch(symbol, interval, { endTime: anchorTime, limit: 1000 }),
          fetchBatch(symbol, interval, { startTime: anchorTime + 1, limit: 300 }).catch(() => []),
        ]);
        if (historyData.length === 0) throw new Error("No data returned");

        const merged = [...historyData];
        if (futureData.length > 0) {
          const seen = new Set(historyData.map((k) => k.time));
          for (const k of futureData) {
            if (!seen.has(k.time)) merged.push(k);
          }
        }

        oldestRef.current = merged[0].time;
        setAllDataAndRef(merged);
        return merged;
      } catch (e: any) {
        setError(e.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [setAllDataAndRef],
  );

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
        const progress = Math.max(0, Math.min(1, (currentSimTime - last.time) / intervalMs));

        // Close interpolates linearly from open toward final close
        const close = last.open + (last.close - last.open) * progress;

        // High/low gradually reveal with a slight lead so extremes appear naturally
        const hlReveal = Math.min(1, progress * 1.5);
        const rawHigh = last.open + (last.high - last.open) * hlReveal;
        const rawLow = last.open + (last.low - last.open) * hlReveal;

        // Enforce OHLC constraints
        const high = Math.max(last.open, close, rawHigh);
        const low = Math.min(last.open, close, rawLow);

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
    setAllDataAndRef([]);
    oldestRef.current = Infinity;
    noMoreRef.current = false;
    setError(null);
  }, [setAllDataAndRef]);

  return {
    allData,
    allDataRef,
    loading,
    loadingOlder,
    error,
    initLoad,
    loadOlder,
    getVisibleData,
    reset,
  };
}
