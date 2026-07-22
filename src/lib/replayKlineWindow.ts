import type { KlineData } from '@/hooks/useBinanceData';

/**
 * KlineCharts uses a binary-search time scale, so analysis data must be strictly
 * ascending and contain exactly one candle per timestamp. Historical windows can
 * arrive in overlapping pages or include stale duplicate rows from legacy data.
 */
export function normalizeReplayKlines(klines: KlineData[]): KlineData[] {
  // Binance range pages are normally already valid, strictly ordered and
  // de-duplicated. Reusing that array avoids cloning tens of thousands of
  // candles twice (once in useReplayKlines and again in ReplayKlineChart) for
  // long historical campaigns. Legacy or corrected snapshots still fall
  // through to the authoritative Map + sort normalization below.
  let alreadyNormalized = true;
  let previousTime = -Infinity;
  for (const item of klines) {
    const time = Math.trunc(item.time);
    if (
      !Number.isFinite(time)
      || time !== item.time
      || time <= previousTime
      || !Number.isFinite(item.open)
      || !Number.isFinite(item.high)
      || !Number.isFinite(item.low)
      || !Number.isFinite(item.close)
      || !Number.isFinite(item.volume)
    ) {
      alreadyNormalized = false;
      break;
    }
    previousTime = time;
  }
  if (alreadyNormalized) return klines;

  const byTime = new Map<number, KlineData>();

  for (const item of klines) {
    const time = Math.trunc(item.time);
    if (
      !Number.isFinite(time)
      || !Number.isFinite(item.open)
      || !Number.isFinite(item.high)
      || !Number.isFinite(item.low)
      || !Number.isFinite(item.close)
    ) {
      continue;
    }

    byTime.set(time, {
      ...item,
      time,
      volume: Number.isFinite(item.volume) ? item.volume : 0,
    });
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

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
