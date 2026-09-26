/**
 * useReplayKlines — 拉取指定时间范围 + 周期的历史 K 线（只读，不挂在主 useBinanceData 上）
 */
import { useEffect, useRef, useState } from 'react';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import { normalizeReplayKlines } from '@/lib/replayKlineWindow';

async function fetchRange(
  symbol: string,
  interval: string,
  fromTime: number,
  toTime: number,
  signal?: AbortSignal,
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
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`, { signal });
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
    fetchRange(symbol, interval, fromTime, toTime, controller.signal)
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
