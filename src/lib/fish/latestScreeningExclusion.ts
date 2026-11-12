import { entryProcessStageLabels, type EntryExclusionProcess, type EntryProcessItem, type EntryProcessReading } from './preEntryExclusionProcess';
import type { QualityScreeningResult } from './qualityScreeningResults';

/** A read-only view: earlier attempts remain in the stored process and export. */
export function latestScreeningExclusion(process: EntryExclusionProcess): EntryProcessItem[] {
  const negative = process.entries.filter(e => e.status === 'blocked' || e.kind === 'guard-rejected');
  const candidates = negative.length ? negative : process.entries.filter(e => e.kind !== 'restart' && e.kind !== 'matched');
  if (!candidates.length) return [];
  const at = candidates.reduce((at, e) => Math.max(at, e.through), -Infinity);
  const latest = candidates.filter(e => e.through === at);
  const observations = latest.filter(e => e.kind === 'observation');
  const event = latest.find(e => e.event)?.event;
  const admission = latest.find(e => e.admission?.at === at)?.admission;
  const chosen = observations.length ? observations : latest.slice(-1);
  const base = chosen.find(e => e.stage === 'exclusion') ?? chosen[0];
  const readings = new Map<string, EntryProcessReading>();
  for (const e of chosen) for (const r of e.lastReadings ?? e.readings ?? []) readings.set(`${r.id}:${r.role ?? ''}:${r.at}`, r);
  const reason = chosen.map(e => (chosen.length > 1 && e.stage ? entryProcessStageLabels[e.stage] + '：' : '') + (e.lastReason ?? e.reason)).join('；');
  return [{ ...base, from: at, through: at, count: 1, reason, readings: [...readings.values()],
    lastReason: undefined, lastReadings: undefined, endedAt: undefined, nextStatus: undefined, event: base.event ?? event, admission }];
}

/** Ignore older screening runs when a table row contains several histories. */
export function latestScreeningProcessResults(results: readonly QualityScreeningResult[]): readonly QualityScreeningResult[] {
  const latest = results.reduce<QualityScreeningResult | undefined>((a, r) => !a || r.round.startedAt > a.round.startedAt
    || r.round.startedAt === a.round.startedAt && r.round.updatedAt > a.round.updatedAt ? r : a, undefined);
  return latest ? results.filter(r => r.round.id === latest.round.id) : [];
}
