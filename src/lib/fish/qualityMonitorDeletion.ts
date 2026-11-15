import type { FishQualityStudy } from './quality';
import { hasQualityCampaign } from './qualityCampaignArchive';
import { qualityMonitorRoundRecordIds, type QualityMonitorLibrary, type QualityMonitorArchiveStudy } from './qualityMonitorLibrary';
import { serializeAccountBlob } from '../accountBlobCodec';

const permanentPrefix = 'monitor-permanent:';
export const permanentlyDeletedMonitorArchiveIds = (library: QualityMonitorLibrary | undefined): string[] =>
  Object.entries(library?.directoryEdits ?? {}).flatMap(([key,edit]) => {
    if (!edit.hidden || !key.startsWith(permanentPrefix)) return [];
    const id=key.slice(permanentPrefix.length);
    return id.startsWith('monitor-archive-') || id.startsWith('monitor-round-snapshot-') ? [id] : [];
  });

export const isPermanentlyDeletedMonitorEntry = (library: QualityMonitorLibrary | undefined, id: string): boolean =>
  library?.directoryEdits?.[permanentPrefix + id]?.hidden === true;

/** Persist the decision in the existing directory-edit format, including in older tabs. */
export function markMonitorEntriesDeleted(study: FishQualityStudy, ids: readonly string[], at = Date.now()): FishQualityStudy {
  const library = study.monitorLibrary;
  if (!library || !ids.length) return study;
  const directoryEdits = { ...library.directoryEdits };
  for (const id of ids) {
    directoryEdits[permanentPrefix + id] = { hidden: true, at };
    const current = directoryEdits[id];
    directoryEdits[id] = { ...current, hidden: true, at: Math.max(at, (current?.at ?? 0) + 1) };
  }
  return { ...study, monitorLibrary: pruneDeletedMonitorEntries({ ...library, directoryEdits }) };
}

/** Cut the round's directory and exclusive non-trading results. Other rounds
 * and the existing campaign reader still own the records they depend on. */
export function pruneDeletedMonitorEntries(library: QualityMonitorLibrary): QualityMonitorLibrary {
  const edits = library.directoryEdits ?? {};
  const removed = new Set(Object.keys(edits).filter(id => id.startsWith(permanentPrefix) && edits[id].hidden)
    .map(id => id.slice(permanentPrefix.length)));
  if (!removed.size) return library;
  const archives = library.archives?.filter(archive => !removed.has(archive.id));
  const lostRounds = library.rounds.filter(round => removed.has(round.id));
  if (!lostRounds.length) {
    return archives?.length === library.archives?.length ? library : { ...library, archives };
  }
  const surviving = library.rounds.filter(round => !removed.has(round.id));
  const cache = new Map<string, string[]>();
  const candidates = new Set(lostRounds.flatMap(round => qualityMonitorRoundRecordIds(library, round, cache)));
  const rounds = surviving.map(round => {
    const ids = qualityMonitorRoundRecordIds(library, round, cache);
    for (const id of ids) candidates.delete(id);
    if (!round.base || !removed.has(round.base)) return round;
    const { base: _base, added: _added, removed: _removed, ...rest } = round;
    return { ...rest, recordIds: ids };
  });
  const records = library.records.filter(record => !candidates.has(record.id) ||
    record.result?.status === 'open' || record.result?.status === 'closed');
  return { ...library, rounds, records, archives };
}

/** A drawer archive is never a live campaign input. Some old archives are
 * nevertheless the only remaining copy of a historical run or template. */
export function archiveDeletionGuard(study: FishQualityStudy) {
  const runs = new Map((study.campaignRuns ?? []).map(run => [run.result.key, run]));
  const results = new Map(study.results.map(result => [result.key, result]));
  for (const run of runs.values()) results.set(run.result.key, run.result);
  const templates = new Map((study.planTemplates ?? []).map(template => [template.id, template]));
  const equal = (a: unknown, b: unknown) => a === b || b !== undefined && serializeAccountBlob(a) === serializeAccountBlob(b);
  return (body: QualityMonitorArchiveStudy): boolean => {
    if (body.workspaceMonitorDraft?.rounds.some(round => round.state === 'paused' || round.state === 'running')) return false;
    if (body.campaignRuns?.some(run => !equal(run, runs.get(run.result.key)))) return false;
    if (body.results.some(result => hasQualityCampaign(result) && !equal(result, results.get(result.key)))) return false;
    return !(body.planTemplates ?? []).some(template => !template.deleted && !equal(template, templates.get(template.id)));
  };
}
