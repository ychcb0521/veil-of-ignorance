/**
 * useReplayKlines — 拉取指定时间范围 + 周期的历史 K 线（只读，不挂在主 useBinanceData 上）
 */
import { useEffect, useState } from 'react';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';

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
    const qs = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(toTime),
      limit: String(limit),
    });
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
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
