import { usePersistedState } from './usePersistedState';

export const ALL_TIMEFRAMES = [
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M',
] as const;

export type Timeframe = typeof ALL_TIMEFRAMES[number];

const DEFAULT_PINNED: Timeframe[] = ['15m', '1h', '4h', '1d'];

// Labels for display
export const TIMEFRAME_LABELS: Record<string, string> = {
  '1m': '1分钟', '3m': '3分钟', '5m': '5分钟',
  '15m': '15分钟', '30m': '30分钟',
  '1h': '1小时', '2h': '2小时', '4h': '4小时',
  '6h': '6小时', '8h': '8小时', '12h': '12小时',
  '1d': '1日', '3d': '3日', '1w': '1周', '1M': '1月',
};

// Unsupported in historical replay (UI placeholder only)
export const UNSUPPORTED_TIMEFRAMES = ['分时', '1s'];

export function useTimeframePrefs() {
  const [pinned, setPinned] = usePersistedState<Timeframe[]>('pinned_timeframes', DEFAULT_PINNED);

  const togglePin = (tf: Timeframe) => {
    setPinned(prev => {
      if (prev.includes(tf)) {
        if (prev.length <= 1) return prev; // keep at least one
        return prev.filter(t => t !== tf);
      }
      return [...prev, tf];
    });
  };

  const available = ALL_TIMEFRAMES.filter(tf => !pinned.includes(tf));

  return { pinned, available, togglePin, setPinned };
}
