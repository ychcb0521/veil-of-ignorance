import { qualityDisplayRows, qualityEntryIdentity, type FishQualityStudy } from './quality';
import { qualityOrigins } from './qualitySources';
import { libraryRoundRecordIds } from './libraryRounds';
import { preserveQualityFilterLibrary, type QualityFilterLibrary } from './qualityFilterLibrary';
import { preserveQualityMonitorLibrary, qualityMonitorRoundRecordIds, type QualityMonitorLibrary } from './qualityMonitorLibrary';

/** Resolve the selected detector rows back to their independent underlying samples. */
export function pickQualityWorkspaceRows(study: FishQualityStudy, ids: readonly string[], remove = false): FishQualityStudy['samples'] {
  const selected = new Set(ids);
  const rows = new Map<string, Set<string | undefined>>();
  const entries = new Set<string>();
  const counts = new Map<string,number>();
  for (const row of qualityDisplayRows(study)) {
    const key = qualityEntryIdentity(row.source, row.enteredAt);
    counts.set(key,(counts.get(key)??0)+1);
    if (!selected.has(row.id) && !selected.has(row.signalId!)) continue;
    if (selected.has(row.signalId!)) entries.add(key);
    const groups = rows.get(key) ?? new Set();
    groups.add(row.detectorId);
    rows.set(key,groups);
  }
  return study.samples.flatMap(sample => {
    const key = qualityEntryIdentity(sample.source,sample.enteredAt);
    const selectedGroups = rows.get(key);
    if (!selectedGroups) return remove ? [sample] : [];
    if (entries.has(key) || selectedGroups.size === counts.get(key)) return remove ? [] : [sample];
    if (!sample.groups.length) return remove ? [sample] : [];
    const groups = sample.groups.filter(id => selectedGroups.has(id) !== remove);
    return groups.length ? [{...sample,groups}] : [];
  });
}

export function importQualityWorkspaceRows(study: FishQualityStudy, snapshot: FishQualityStudy, ids: readonly string[]): FishQualityStudy {
  const picked = pickQualityWorkspaceRows(snapshot,ids);
  if (!picked.length) return study;
  const samples = new Map(study.samples.map(row => [row.id,row]));
  const pickedEntries = new Set(picked.map(row => qualityEntryIdentity(row.source,row.enteredAt)));
  const pickedGroups = new Set(picked.flatMap(row => row.groups));
  for (const row of structuredClone(picked)) {
    const existing = samples.get(row.id);
    if (!existing) samples.set(row.id,row);
    else samples.set(row.id,{...existing,groups:[...new Set([...existing.groups,...row.groups])],origins:[...new Set([...qualityOrigins(existing),...qualityOrigins(row)])]});
  }
  const activeGroups = new Set(study.groups.map(group => group.id));
  const selected = new Set(study.selectedRowIds);
  const next = {...study,samples:[...samples.values()],groups:[...study.groups,...structuredClone(snapshot.groups.filter(group => pickedGroups.has(group.id) && !activeGroups.has(group.id)))]};
  for (const row of qualityDisplayRows(next)) if (pickedEntries.has(qualityEntryIdentity(row.source,row.enteredAt))) selected.add(row.id);
  return {...next,selectedRowIds:[...selected]};
}

export function editWorkspaceMonitor(study: FishQualityStudy, apply: (draft: FishQualityStudy) => FishQualityStudy): FishQualityStudy {
  if (!study.workspaceUpdatedAt) return apply(study);
  const draft = apply({...study,monitorLibrary:study.workspaceMonitorDraft});
  return {...study,workspaceMonitorDraft:draft.monitorLibrary};
}

export function saveWorkspaceMonitorRounds(study: FishQualityStudy): FishQualityStudy {
  const draft = study.workspaceMonitorDraft;
  if (!draft) return study;
  const saved = draft.rounds.filter(round => round.state === 'complete');
  if (!saved.length) return study;
  const idsFor = (rounds: QualityMonitorLibrary['rounds']) => new Set(rounds.flatMap(round => qualityMonitorRoundRecordIds(draft!,round)));
  const savedIds = idsFor(saved), remaining = draft.rounds.filter(round => round.state !== 'complete'), remainingIds = idsFor(remaining);
  const rebase = (round: QualityMonitorLibrary['rounds'][number]) => {
    const { base: _base, added: _added, removed: _removed, ...metadata } = round;
    return {...metadata,recordIds:qualityMonitorRoundRecordIds(draft,round)};
  };
  const bundle = {...draft,rounds:saved.map(rebase),records:draft.records.filter(record => savedIds.has(record.id))};
  const monitorLibrary = preserveQualityMonitorLibrary(study,{...study,monitorLibrary:bundle}).monitorLibrary;
  return {...study,monitorLibrary,workspaceMonitorDraft:remaining.length ? {...draft,rounds:remaining.map(rebase),records:draft.records.filter(record=>remainingIds.has(record.id))} : undefined};
}

export function editWorkspaceFilter(study: FishQualityStudy, apply: (draft: FishQualityStudy) => FishQualityStudy): FishQualityStudy {
  if (!study.workspaceUpdatedAt) return apply(study);
  const draft = apply({...study,filterLibrary:study.workspaceFilterDraft});
  return draft.filterLibrary === study.workspaceFilterDraft ? study : {...study,workspaceFilterDraft:draft.filterLibrary};
}

export function saveWorkspaceFilterRounds(study: FishQualityStudy): FishQualityStudy {
  const draft = study.workspaceFilterDraft;
  if (!draft) return study;
  const saved = draft.rounds.filter(round => round.state === 'complete');
  if (!saved.length) return study;
  const cache = new Map<string, string[]>();
  const bundle = (rounds: QualityFilterLibrary['rounds']): QualityFilterLibrary => {
    const records = new Map<string, QualityFilterLibrary['records'][number]>();
    for (const round of rounds) for (const record of round.filterSnapshot?.records ?? []) {
      const prior = records.get(record.id);
      if (!prior || prior.updatedAt <= record.updatedAt) records.set(record.id, prior
        ? {...record,firstSavedAt:Math.min(record.firstSavedAt,prior.firstSavedAt)}
        : record);
    }
    const settings = [...new Map(rounds.flatMap(round => round.filterSnapshot?.settings ?? []).map(setting => [setting.id, setting])).values()];
    return {...draft, settings, records:[...records.values()], rounds: rounds.map(round => {
      const { base: _base, added: _added, removed: _removed, ...metadata } = round;
      return {...metadata,recordIds:libraryRoundRecordIds(draft.rounds,round,cache)};
    })};
  };
  const remaining = draft.rounds.filter(round => round.state !== 'complete');
  const filterLibrary = preserveQualityFilterLibrary(study,{...study,filterLibrary:bundle(saved)}).filterLibrary;
  return {...study,filterLibrary,workspaceFilterDraft:remaining.length ? bundle(remaining) : undefined};
}
