import { useState, useCallback } from 'react';

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Calculate how many candles fit in a duration for a given interval
function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000,
    '6h': 21_600_000, '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000,
    '3d': 259_200_000, '1w': 604_800_000,
  };
  return map[interval] || 60_000;
}

export function calcPreloadCandles(interval: string, daysBack: number = 30): number {
  const ms = daysBack * 24 * 60 * 60 * 1000;
  return Math.ceil(ms / intervalToMs(interval));
}

export function useBinanceData() {
  const [allData, setAllData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKlines = useCallback(async (
    symbol: string,
    interval: string,
    startTime: number,
    limit: number = 1500
  ) => {
    setLoading(true);
    setError(null);
    try {
      const allKlines: KlineData[] = [];
      let currentStart = startTime;
      const batchSize = 1000;
      const batches = Math.ceil(limit / batchSize);

      for (let i = 0; i < batches; i++) {
        const fetchLimit = Math.min(batchSize, limit - allKlines.length);
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&limit=${fetchLimit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const raw = await res.json();

        const parsed: KlineData[] = raw.map((k: any[]) => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));

        allKlines.push(...parsed);

        if (parsed.length < batchSize) break;
        currentStart = parsed[parsed.length - 1].time + 1;
      }

      setAllData(allKlines);
      return allKlines;
    } catch (e: any) {
      setError(e.message || 'Failed to fetch data');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getVisibleData = useCallback((currentSimTime: number): KlineData[] => {
    return allData.filter(k => k.time <= currentSimTime);
  }, [allData]);

  return { allData, loading, error, fetchKlines, getVisibleData };
}
