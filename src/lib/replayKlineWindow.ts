import type { KlineData } from '@/hooks/useBinanceData';

export function findReplayCursorIndex(klines: KlineData[], currentTime: number) {
  let lo = 0;
  let hi = klines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (klines[mid].time <= currentTime) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function sliceReplayKlines(
  klines: KlineData[],
  currentTime: number,
  historyCandles: number,
  viewportCenterTime?: number | null,
) {
  if (klines.length === 0) return [];
  const cursorIdx = findReplayCursorIndex(klines, currentTime);
  if (cursorIdx < 0) return [];

  const windowSize = Math.min(historyCandles, klines.length);
  if (typeof viewportCenterTime === 'number' && Number.isFinite(viewportCenterTime)) {
    const viewportIdx = Math.max(0, findReplayCursorIndex(klines, viewportCenterTime));
    const halfWindow = Math.floor(windowSize / 2);
    const maxStart = Math.max(0, klines.length - windowSize);
    const start = Math.min(Math.max(0, viewportIdx - halfWindow), maxStart);
    return klines.slice(start, start + windowSize);
  }

  const end = Math.max(0, cursorIdx) + 1;
  const start = Math.max(0, end - windowSize);
  return klines.slice(start, end);
}
