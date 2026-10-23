import { useEffect, useRef, type MutableRefObject } from 'react';
import type { InitLoadOptions, KlineData } from './useBinanceData';

interface Options {
  status: 'stopped' | 'paused' | 'playing';
  symbol: string;
  interval: string;
  reverse: boolean;
  clockReady: boolean;
  getTime: (symbol: string) => number;
  dataRef: MutableRefObject<KlineData[]>;
  contextRef: MutableRefObject<{ symbol: string; interval: string }>;
  initLoad: (symbol: string, interval: string, time: number, options?: InitLoadOptions) => Promise<KlineData[]>;
  onRestored?: () => void;
}

/** Restore chart data from the active timeline, including late account hydration.
 * A global saved simulator snapshot can belong to a different isolated clock.
 * This hook only loads candles; it never starts, stops or rewinds a timeline.
 */
export function useReplayChartRestore({ status, symbol, interval, reverse, clockReady, getTime, dataRef, contextRef, initLoad, onRestored }: Options) {
  const restored = useRef(false);
  const onRestoredRef = useRef(onRestored);
  onRestoredRef.current = onRestored;
  useEffect(() => {
    if (restored.current || status === 'stopped' || !clockReady) return;
    const time = getTime(symbol);
    if (!Number.isFinite(time) || time <= 0) return;
    restored.current = true;
    const context = contextRef.current, bars = dataRef.current;
    // A manual start or signal jump may have loaded the window before activation.
    if (context.symbol === symbol && context.interval === interval && bars.length && bars[0].time <= time) return;
    void initLoad(symbol, interval, time, { reverse }).then(bars => {
      if (bars.length) onRestoredRef.current?.();
    });
  }, [status, symbol, interval, reverse, clockReady, getTime, dataRef, contextRef, initLoad]);
}
