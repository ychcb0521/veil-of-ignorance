import { signalChartSymbol, type TradeSignal } from '@/lib/signalLibrary';

/** Pick the newest signal from the latest capture, using the cabin when the new-fish list is empty. */
export function latestReplayCatch(signals: readonly TradeSignal[], now = Date.now()) {
  let fresh: { symbol: string; timeMs: number; roundAt: number } | undefined;
  let archived: typeof fresh;
  for (const signal of signals) {
    if (signal.mined || signal.cabinImportedAt != null || signal.jumpIssue || signal.turingReplaySample) continue;
    const { timeMs } = signal;
    if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > now) continue;
    const symbol = signalChartSymbol(signal);
    if (!symbol) continue;
    const captureAt = signal.fishArchive?.at ?? signal.caughtAt ?? 0;
    const roundAt = Number.isFinite(captureAt) ? captureAt : 0;
    if (signal.freshCatch && !signal.fishArchive) {
      if (!fresh || timeMs > fresh.timeMs || (timeMs === fresh.timeMs && roundAt > fresh.roundAt)) {
        fresh = { symbol, timeMs, roundAt };
      }
    } else if (!archived || roundAt > archived.roundAt || (roundAt === archived.roundAt && timeMs > archived.timeMs)) {
      archived = { symbol, timeMs, roundAt };
    }
  }
  return fresh ?? archived;
}
