import { normalizeSignalQuality, signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { fishCaptureTime } from './qualitySources';
import { fishCaughtBy } from './records';

interface FishCabinRow {
  signal: TradeSignal;
  captures: TradeSignal[];
  ratingId: string;
  algorithms: string[];
}

/** A cabin row represents one market, symbol and signal time. Each capture retains its own snapshot. */
export function groupFishCabin(signals: readonly TradeSignal[]): FishCabinRow[] {
  const groups = new Map<string, TradeSignal[]>();
  for (const signal of signals) {
    const key = signalDedupKey(signal);
    const captures = groups.get(key);
    if (captures) captures.push(signal);
    else groups.set(key, [signal]);
  }
  return [...groups.values()].map(captures => {
    captures.sort((a, b) => (fishCaptureTime(b) ?? 0) - (fishCaptureTime(a) ?? 0)
      || (b.fishArchive?.at ?? 0) - (a.fishArchive?.at ?? 0));
    const latest = captures[0];
    const rated = captures.find(signal => normalizeSignalQuality(signal.quality) !== undefined);
    const caughtAt = fishCaptureTime(latest);
    const signal = (rated && rated !== latest) || (caughtAt != null && caughtAt !== latest.caughtAt)
      ? { ...latest, quality: rated?.quality, caughtAt: caughtAt ?? undefined }
      : latest;
    return { signal, captures, ratingId: rated?.id ?? latest.id, algorithms: [...new Set(captures.flatMap(fishCaughtBy))] };
  });
}
