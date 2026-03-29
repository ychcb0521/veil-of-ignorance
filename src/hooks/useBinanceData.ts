import { useState, useCallback } from 'react';

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const INTERVALS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export function useBinanceData() {
  const [allData, setAllData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKlines = useCallback(async (
    symbol: string,
    interval: string,
    startTime: number,
    limit: number = 1000
  ) => {
    setLoading(true);
    setError(null);
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=${limit}`;
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

      setAllData(parsed);
      return parsed;
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
