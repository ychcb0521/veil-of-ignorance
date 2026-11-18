import { signalDedupKey, type TradeSignal } from '../signalLibrary';
import { qualitySignalTime } from './qualityAdmissionTime';
import { isAutomaticPreEntryRound, preEntrySignal, type PreEntryLibrary } from './preEntryMonitor';

const sourceKey = (source: TradeSignal) => signalDedupKey({ ...source, timeMs: qualitySignalTime(source) });

/** Admission advances this signal permanently, including after its position is sold. */
export function screenedSourceKeys(library?: PreEntryLibrary): ReadonlySet<string> {
  const rounds = new Set(library?.rounds.filter(isAutomaticPreEntryRound).map(round => round.id));
  return new Set(library?.records.flatMap(record => rounds.has(record.roundId) && preEntrySignal(record)
    ? [sourceKey(record.sample.source)] : []) ?? []);
}

export const isScreenedSource = (source: TradeSignal, keys: ReadonlySet<string>) => keys.has(sourceKey(source));
