import { useState, useCallback, useRef } from 'react';

export interface KlineData {
  time: number;   // ms timestamp (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Interval string → milliseconds
export function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000,
    '6h': 21_600_000, '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000,
    '3d': 259_200_000, '1w': 604_800_000,
  };
  return map[interval] || 60_000;
}

/**
 * Fetch a single batch of klines from Binance fapi.
 * Returns parsed KlineData[] sorted by time ascending.
 */
async function fetchBatch(
  symbol: string, interval: string,
  params: { startTime?: number; endTime?: number; limit?: number }
): Promise<KlineData[]> {
  const qs = new URLSearchParams({
    symbol,
    interval,
    limit: String(params.limit ?? 1000),
  });
  if (params.startTime != null) qs.set('startTime', String(params.startTime));
  if (params.endTime != null) qs.set('endTime', String(params.endTime));

  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const raw: any[][] = await res.json();
  return raw.map(k => ({
    time: k[0] as number,
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/**
 * useBinanceData — lazy-loading kline data manager.
 *
 * - `initLoad(symbol, interval, anchorTime)`: loads 1000 candles ending at anchorTime.
 * - `loadOlder()`: prepends 1000 older candles (called on chart left-scroll).
 * - `appendCandle(candle)`: pushes a new candle to the right (sim tick).
 * - `allData`: the current in-memory kline array, time-ascending.
 */
export function useBinanceData() {
  const [allData, setAllData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track current request context to avoid stale closures
  const ctxRef = useRef<{ symbol: string; interval: string }>({ symbol: '', interval: '' });
  const oldestRef = useRef<number>(Infinity);  // oldest loaded timestamp
  const noMoreRef = useRef(false);              // true when we've hit the earliest available data

  /**
   * Initial load: fetch up to 1000 candles ending at `anchorTime`.
   * Used when user clicks "Start Simulation".
   */
  const initLoad = useCallback(async (symbol: string, interval: string, anchorTime: number) => {
    setLoading(true);
    setError(null);
    noMoreRef.current = false;
    ctxRef.current = { symbol, interval };

    try {
      // Fetch 1000 candles with endTime = anchorTime
      const data = await fetchBatch(symbol, interval, { endTime: anchorTime, limit: 1000 });
      if (data.length === 0) throw new Error('No data returned');

      oldestRef.current = data[0].time;
      setAllData(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load older data: fetch 1000 candles before the current oldest.
   * Returns the number of new candles prepended.
   * Guards against concurrent calls via `loadingOlder` flag.
   */
  const loadOlder = useCallback(async (): Promise<number> => {
    if (loadingOlder || noMoreRef.current) return 0;
    const { symbol, interval } = ctxRef.current;
    if (!symbol) return 0;

    setLoadingOlder(true);
    try {
      // endTime = oldest - 1ms to avoid duplicate
      const endTime = oldestRef.current - 1;
      const older = await fetchBatch(symbol, interval, { endTime, limit: 1000 });

      if (older.length === 0) {
        noMoreRef.current = true;
        return 0;
      }

      // If fewer than 1000 returned, we've reached the beginning
      if (older.length < 1000) noMoreRef.current = true;

      oldestRef.current = older[0].time;

      setAllData(prev => {
        // Deduplicate: filter out any overlap
        const existingFirst = prev.length > 0 ? prev[0].time : Infinity;
        const unique = older.filter(k => k.time < existingFirst);
        return [...unique, ...prev];
      });

      return older.length;
    } catch (e: any) {
      console.error('Failed to load older data:', e);
      return 0;
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder]);

  /**
   * Get visible data up to the simulated time.
   */
  const getVisibleData = useCallback((currentSimTime: number): KlineData[] => {
    return allData.filter(k => k.time <= currentSimTime);
  }, [allData]);

  /**
   * Reset all data (e.g. when switching symbols).
   */
  const reset = useCallback(() => {
    setAllData([]);
    oldestRef.current = Infinity;
    noMoreRef.current = false;
    setError(null);
  }, []);

  return {
    allData,
    loading,
    loadingOlder,
    error,
    initLoad,
    loadOlder,
    getVisibleData,
    reset,
  };
}
