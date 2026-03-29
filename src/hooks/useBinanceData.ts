import { useState, useCallback } from 'react';

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
      // Fetch in batches to get enough data
      const allKlines: KlineData[] = [];
      let currentStart = startTime;
      const batchSize = 1000;
      const batches = Math.ceil(limit / batchSize);

      for (let i = 0; i < batches; i++) {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&limit=${Math.min(batchSize, limit - allKlines.length)}`;
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
