/**
 * useReplayKlines — 拉取指定时间范围 + 周期的历史 K 线（只读，不挂在主 useBinanceData 上）
 */
import { useEffect, useState } from 'react';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import { fetchBinanceKlines } from '@/lib/binanceKlines';

async function fetchRange(
  symbol: string,
  interval: string,
  fromTime: number,
  toTime: number,
): Promise<KlineData[]> {
  const out: KlineData[] = [];
  let cursor = fromTime;
  // Binance fapi limit 1500 per request
  const limit = 1500;
  while (cursor < toTime) {
    const raw = await fetchBinanceKlines({ symbol, interval, startTime: cursor, endTime: toTime, limit });
    if (raw.length === 0) break;
    out.push(...raw);
    const last = out[out.length - 1];
    if (!last) break;
    const next = last.time + intervalToMs(interval);
    if (next <= cursor) break;
    cursor = next;
    if (raw.length < limit) break;
  }
  return out;
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

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRange(symbol, interval, fromTime, toTime)
      .then(data => { if (!cancelled) setKlines(data); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, interval, fromTime, toTime, reloadKey]);

  return { klines, loading, error, reload: () => setReloadKey(k => k + 1) };
}
