import { additionIdentity } from './qualityAddition';
import { mirrorIdentity, mirrorExecutionIdentity } from './qualityMirror';
import { shortFishHash } from './algorithm';
import { QUALITY_NOTIONAL, activeBuyFilters, qualityComparisonRows, qualityFilterReadingKey, qualityFilterStatus, qualityResultKey, qualityRunGroups, qualityRunSamples, qualityVetoVersion, type FishQualityStudy, type QualityFilterReading, type QualityFilterStatus, type QualityGroup, type QualityResult, type QualitySample, qualityComboIdentity } from './quality';
import { activeHoldingVetoes, holdingVetoIdentity } from './qualityVeto';
import type { TradeSignal } from '@/lib/signalLibrary';

export interface QualityMonitorSetting {
  id: string; signature: string; plan: QualityGroup; detectors: QualityGroup[];
  observeHours: number; entryMode: FishQualityStudy['entryMode']; filtersKnown: boolean; detectorsKnown: boolean; notional: number; leverage: number;
}
export interface QualityMonitorRecord {
  id: string; settingId: string; source: TradeSignal; enteredAt: number | null; basis: QualitySample['basis'];
  origin?:QualitySample['origin'];origins?:QualitySample['origins'];
  filterStatus: QualityFilterStatus; readings: QualityFilterReading[]; result?: QualityResult;
  firstSavedAt: number; updatedAt: number;
}
/**
 * 一轮监测包含哪些记录。
 * 【2026-10-27 审查】每轮都存全部记录编号会线性膨胀：1178 条信号 × 2 套方案每轮约 0.23 MB，
 * 100 轮 24.5 MB，而监测中每 400 ms 就整份复制保存一次、账号同步也整份上传。
 * 现在只存与上一轮的差异：base = 上一轮，added / removed = 这一轮多出 / 少了的记录；
 * 没有 base 的轮（第一轮、历史快照、旧数据）照旧存完整的 recordIds。轮次一经开始就不再改动，差异链因此稳定。
 */
export interface QualityMonitorRound {
  id: string; startedAt: number; updatedAt: number; finishedAt?: number;
  state: 'running' | 'complete' | 'paused' | 'failed'; recordIds?: string[]; base?: string; added?: string[]; removed?: string[];
  legacy?: boolean; error?: string;
}
/** 还原某一轮的完整记录编号（沿差异链回溯到存完整清单的那一轮）。基准缺失时只算本轮新增的部分。 */
export function qualityMonitorRoundRecordIds(library: Pick<QualityMonitorLibrary, 'rounds'>, round: QualityMonitorRound, cache = new Map<string, string[]>()): string[] {
  const byId = new Map(library.rounds.map(r => [r.id, r]));
  const chain: QualityMonitorRound[] = [];
  const seen = new Set<string>();
  let cursor: QualityMonitorRound | undefined = round;
  while (cursor && !cache.has(cursor.id) && !seen.has(cursor.id)) {
    seen.add(cursor.id); chain.push(cursor);
    cursor = cursor.recordIds || !cursor.base ? undefined : byId.get(cursor.base);
  }
  let ids = cursor && cache.has(cursor.id) ? cache.get(cursor.id)! : [];
  for (const r of chain.reverse()) {
    if (r.recordIds) ids = r.recordIds;
    else { const removed = new Set(r.removed ?? []), next = ids.filter(id => !removed.has(id)), have = new Set(next); for (const id of r.added ?? []) if (!have.has(id)) { next.push(id); have.add(id); } ids = next; }
    cache.set(r.id, ids);
  }
  return ids;
}
/** 新一轮相对上一轮（非历史快照、开始时间最晚的那轮）存差异；差异比完整清单还大时存完整清单。 */
function encodeRound(library: QualityMonitorLibrary, ids: string[]): Pick<QualityMonitorRound, 'recordIds' | 'base' | 'added' | 'removed'> {
  const previous = library.rounds.filter(r => !r.legacy).reduce<QualityMonitorRound | undefined>((latest, r) => !latest || r.startedAt >= latest.startedAt ? r : latest, undefined);
  if (!previous) return { recordIds: ids };
  const before = qualityMonitorRoundRecordIds(library, previous), prior = new Set(before), now = new Set(ids);
  const added = ids.filter(id => !prior.has(id)), removed = before.filter(id => !now.has(id));
  return added.length + removed.length >= ids.length ? { recordIds: ids } : { base: previous.id, added, removed };
}
/** 旧数据里每轮都存完整清单的，改存成差异（内容不变，轮次与时间戳不动）。 */
export function compactQualityMonitorRounds(study: FishQualityStudy): FishQualityStudy {
  const library = study.monitorLibrary;
  if (!library || library.rounds.filter(r => !r.legacy && r.recordIds).length < 2) return study;
  const cache = new Map<string, string[]>(), resolved = new Map(library.rounds.map(r => [r.id, qualityMonitorRoundRecordIds(library, r, cache)]));
  const ordered = library.rounds.filter(r => !r.legacy).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const encoded = new Map<string, QualityMonitorRound>();
  ordered.forEach((round, index) => {
    const ids = resolved.get(round.id)!, previous = ordered[index - 1];
    const { recordIds: _full, base: _base, added: _added, removed: _removed, ...rest } = round;
    if (!previous) { encoded.set(round.id, { ...rest, recordIds: ids }); return; }
    const prior = new Set(resolved.get(previous.id)), now = new Set(ids);
    const added = ids.filter(id => !prior.has(id)), removed = resolved.get(previous.id)!.filter(id => !now.has(id));
    encoded.set(round.id, added.length + removed.length >= ids.length ? { ...rest, recordIds: ids } : { ...rest, base: previous.id, added, removed });
  });
  return { ...study, monitorLibrary: { ...library, rounds: library.rounds.map(r => encoded.get(r.id) ?? r) } };
}
export interface QualityMonitorLibrary {
  /** Full, independently cloned tables saved before manual restarts. Never updated by a later run. */
  archives?:QualityMonitorArchive[];
  directoryEdits?:Record<string,{hidden:boolean;at:number}>;
  version: 1; importedLegacy: boolean; settings: QualityMonitorSetting[]; records: QualityMonitorRecord[]; rounds: QualityMonitorRound[];
}
export type QualityMonitorArchiveStudy=Omit<FishQualityStudy,'monitorLibrary'|'filterLibrary'|'campaignRepair'>;
export interface QualityMonitorArchive {id:string;version:1;createdAt:number;reason:'restart'|'copy'|'copy-source';sourceRoundId?:string;study:QualityMonitorArchiveStudy}
/** Save the whole current table, including rows outside today's filters/selection. */
export function archiveQualityMonitorStudy(study:FishQualityStudy,at=Date.now(),reason:QualityMonitorArchive['reason']='restart'):FishQualityStudy{
  if(reason==='restart'&&!study.results.length&&!study.campaignRuns?.length)return study;
  const library=study.monitorLibrary??empty();
  const {monitorLibrary:_monitor,filterLibrary:_filter,campaignRepair:_repair,...table}=study;
  const latest=library.rounds.filter(r=>!r.legacy).reduce<QualityMonitorRound|undefined>((last,r)=>!last||r.startedAt>=last.startedAt?r:last,undefined)??library.rounds.at(-1);
  const archive:QualityMonitorArchive={id:`monitor-archive-${at}-${++sequence}-${Math.random().toString(36).slice(2,10)}`,version:1,createdAt:at,reason,sourceRoundId:latest?.id,study:structuredClone(table)};
  return {...study,monitorLibrary:{...library,archives:[...(library.archives??[]),archive]}};
}
interface MonitorTask { id: string; setting: QualityMonitorSetting; sample: QualitySample; plan: QualityGroup; resultKey: string }
export interface QualityMonitorCapture {
  roundId: string; tasks: Map<string, MonitorTask>; readings: Map<string, QualityFilterReading>; results: Map<string, QualityResult>;
}
const empty = (): QualityMonitorLibrary => ({ version: 1, importedLegacy: false, settings: [], records: [], rounds: [] });
const ordered = (values: unknown[]) => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const algorithm = (g: QualityGroup) => [g.snapshot.featureId, g.metric, g.snapshot.definitionKey, g.snapshot.statistic, g.snapshot.interval, g.snapshot.scale, g.snapshot.H ?? null];
function settingFor(study: FishQualityStudy, sample: QualitySample, plan: QualityGroup, catalog: Map<string, QualityMonitorSetting>, filtersKnown = true, detectorsKnown = true): QualityMonitorSetting {
  const selected = new Set(study.selectedRowIds ?? []);
  const detectors = study.groups.filter(g => sample.groups.includes(g.id) && (!study.selectedRowIds || selected.has(sample.id) || selected.has(`${sample.id}/detector/${g.id}`)));
  const filters = activeBuyFilters(study, plan);
  const signature = JSON.stringify([...(additionIdentity(plan.addition).length ? [additionIdentity(plan.addition)] : []),algorithm(plan), plan.rule ?? null, ...(plan.combo ? [qualityComboIdentity(plan)] : []), plan.execution ?? 'close', qualityVetoVersion(plan), holdingVetoIdentity(plan.holdingVetoes),
    ordered(activeHoldingVetoes(plan.holdingVetoes).map(v => [v.kind, v.direction, v.threshold, v.metric, v.snapshot?.scale, v.snapshot?.H])),
    ordered(filters.map(f => [f.snapshot.featureId, f.metric, f.snapshot.definitionKey, f.snapshot.interval, f.snapshot.scale, f.snapshot.H, f.direction, f.threshold])),
    ordered(detectors.map(g => [algorithm(g), g.snapshot.direction, g.snapshot.threshold])), study.observeHours, study.entryMode, filtersKnown, detectorsKnown, QUALITY_NOTIONAL, 1, ...(mirrorExecutionIdentity(plan).length ? [mirrorExecutionIdentity(plan)] : []), ...(mirrorIdentity(plan.mirrorTakeProfit).length ? [mirrorIdentity(plan.mirrorTakeProfit)] : [])]);
  const existing = catalog.get(signature); if (existing) return existing;
  const value: QualityMonitorSetting = { id: `setting-${shortFishHash(signature)}`, signature,
    plan: structuredClone({ ...plan, buyFilters: filters }), detectors: structuredClone(detectors),
    observeHours: study.observeHours, entryMode: study.entryMode, filtersKnown, detectorsKnown, notional: QUALITY_NOTIONAL, leverage: 1 };
  catalog.set(signature, value); return value;
}
function taskFor(study: FishQualityStudy, sample: QualitySample, plan: QualityGroup, catalog: Map<string, QualityMonitorSetting>, filtersKnown = true, detectorsKnown = true): MonitorTask {
  const setting = settingFor(study, sample, plan, catalog, filtersKnown, detectorsKnown), s = sample.source;
  // Source IDs and display labels do not split identical trials; exchange and actual entry time must.
  const id = JSON.stringify([setting.id, s.exchange ?? 'binance', s.market ?? 'crypto', s.underlying ?? '', s.symbol.toUpperCase(), s.timeMs, sample.enteredAt]);
  return { id, setting, sample, plan, resultKey: qualityResultKey(sample, plan, study.observeHours) };
}
function recordFor(task: MonitorTask, readings: Map<string, QualityFilterReading>, result: QualityResult | undefined, at: number, prior?: QualityMonitorRecord): QualityMonitorRecord {
  const { id, setting, sample, plan } = task;
  const { id: sourceId, symbol, timeMs, timeLabel, fallbackZone, exchange, market, underlying, binanceSymbol } = sample.source;
  const frozenStudy = { buyFilters: plan.buyFilters, sellPlans: [setting.plan] } as FishQualityStudy;
  const picked = (setting.plan.buyFilters ?? []).flatMap(f => { const reading = readings.get(qualityFilterReadingKey(sample, f)); return reading ? [structuredClone(reading)] : []; });
  return { id, settingId: setting.id, source: { id: sourceId, symbol, timeMs, timeLabel, fallbackZone, exchange, market, underlying, binanceSymbol }, enteredAt: sample.enteredAt, basis: sample.basis,origin:sample.origin,origins:sample.origins,
    filterStatus: qualityFilterStatus(frozenStudy, sample, setting.plan, readings), readings: picked,
    result: result ? structuredClone(result) : prior?.result, firstSavedAt: prior?.firstSavedAt ?? at, updatedAt: at };
}
let sequence = 0;
export function beginQualityMonitorRound(study: FishQualityStudy, frozen: FishQualityStudy, at: number, restart = false): { study: FishQualityStudy; capture: QualityMonitorCapture } {
  const library = study.monitorLibrary ?? empty(), catalog = new Map(library.settings.map(s => [s.signature, s]));
  const tasks = new Map<string, MonitorTask>(), readings = new Map((frozen.filterReadings ?? []).map(r => [r.key, r]));
  const results = new Map((restart ? [] : frozen.results).map(r => [r.key, r]));
  const records = new Map(library.records.map(r => [r.id, r]));
  for (const sample of qualityRunSamples(frozen)) for (const plan of qualityRunGroups(frozen).filter(g => frozen.sellPlans || sample.groups.includes(g.id))) {
    const task = taskFor(frozen, sample, plan, catalog); tasks.set(task.resultKey, task);
    records.set(task.id, recordFor(task, readings, results.get(task.resultKey), at, records.get(task.id)));
  }
  const roundId = `monitor-${at}-${++sequence}-${Math.random().toString(36).slice(2, 10)}`;
  const round: QualityMonitorRound = { id: roundId, startedAt: at, updatedAt: at, state: 'running', ...encodeRound(library, [...new Set([...tasks.values()].map(t => t.id))]) };
  return { study: { ...study, monitorLibrary: { ...library, settings: [...catalog.values()], records: [...records.values()], rounds: [...library.rounds, round] } }, capture: { roundId, tasks, readings, results } };
}
export function captureQualityMonitorResult(study: FishQualityStudy, capture: QualityMonitorCapture, result: QualityResult, at: number): FishQualityStudy {
  const task = capture.tasks.get(result.key), library = study.monitorLibrary;
  if (!task || !library || task.sample.id !== result.sampleId || task.plan.id !== result.groupId) return study;
  capture.results.set(result.key, structuredClone(result));
  const prior = library.records.find(r => r.id === task.id), record = recordFor(task, capture.readings, result, at, prior);
  return { ...study, monitorLibrary: { ...library, records: [...library.records.filter(r => r.id !== task.id), record] } };
}
export function finishQualityMonitorRound(study: FishQualityStudy, capture: QualityMonitorCapture, state: Exclude<QualityMonitorRound['state'], 'running'>, at: number, error?: string): FishQualityStudy {
  const library = study.monitorLibrary; if (!library?.rounds.some(r => r.id === capture.roundId)) return study;
  const records = new Map(library.records.map(r => [r.id, r]));
  for (const task of capture.tasks.values()) records.set(task.id, recordFor(task, capture.readings, capture.results.get(task.resultKey), at, records.get(task.id)));
  return { ...study, monitorLibrary: { ...library, records: [...records.values()], rounds: library.rounds.map(r => r.id === capture.roundId ? { ...r, state, updatedAt: at, finishedAt: at, error } : r) } };
}
/** Adopt only original frozen history. Unknown old buy conditions remain explicitly unknown. */
export function adoptQualityMonitorHistory(study: FishQualityStudy): FishQualityStudy {
  if (study.monitorLibrary?.importedLegacy) return study;
  const library = study.monitorLibrary ?? empty(), catalog = new Map(library.settings.map(s => [s.signature, s])), records = new Map(library.records.map(r => [r.id, r]));
  const ids = new Set<string>(); let earliest = Infinity, latest = 0;
  const add = (sample: QualitySample, plan: QualityGroup, detectors: QualityGroup[], result: QualityResult, hours: number, known: boolean, detectorsKnown = true) => {
    const frozen = { ...study, samples: [sample], groups: detectors, sellPlans: [plan], selectedRowIds: undefined, observeHours: hours, buyFilters: undefined, independentFilters: undefined };
    const task = taskFor(frozen, sample, plan, catalog, known, detectorsKnown), at = result.evaluatedAt;
    const prior = records.get(task.id); if (!prior || prior.updatedAt < at) records.set(task.id, recordFor(task, new Map(), result, at, prior));
    ids.add(task.id); earliest = Math.min(earliest, at); latest = Math.max(latest, at);
  };
  const archived = new Set<string>();
  for (const run of study.campaignRuns ?? []) if (!run.supersededBy) { add(run.sample, run.plan, run.detectors, run.result, run.observeHours, !!run.plan.buyFilters && !run.plan.buyFilters.length); archived.add(run.result.key); }
  const samples = new Map(qualityComparisonRows(study).map(s => [s.id, s]));
  for (const result of study.results) if (!archived.has(result.key)) {
    const sample = samples.get(result.sampleId), plan = qualityRunGroups(study).find(p => p.id === result.groupId);
    if (sample && plan && qualityResultKey(sample, plan, study.observeHours) === result.key) add(sample, { ...plan, buyFilters: undefined }, [], result, study.observeHours, false, false);
  }
  const round: QualityMonitorRound | undefined = ids.size ? { id: 'monitor-legacy-history', startedAt: earliest, updatedAt: latest, finishedAt: latest, state: 'complete', recordIds: [...ids], legacy: true } : undefined;
  return { ...study, monitorLibrary: { ...library, importedLegacy: true, settings: [...catalog.values()], records: [...records.values()], rounds: round ? [...library.rounds, round] : library.rounds } };
}
/** A persisted batch cannot still be running in a newly mounted evaluator. Retain all partial rows. Old full-list rounds are compacted. */
export function recoverQualityMonitorRounds(input: FishQualityStudy, at = Date.now()): FishQualityStudy {
  const study = compactQualityMonitorRounds(input);
  const library = study.monitorLibrary; if (!library?.rounds.some(r => r.state === 'running')) return study;
  return { ...study, monitorLibrary: { ...library, rounds: library.rounds.map(r => r.state === 'running' ? { ...r, state: 'paused', updatedAt: at, finishedAt: at } : r) } };
}
/** Additive history must survive stale tabs and repair-only writes. */
export function preserveQualityMonitorLibrary(saved: FishQualityStudy | undefined, incoming: FishQualityStudy): FishQualityStudy {
  const a = saved?.monitorLibrary, b = incoming.monitorLibrary;
  if (!a) return incoming; if (!b) return { ...incoming, monitorLibrary: a };
  const settings = new Map(a.settings.map(s => [s.id, s])); b.settings.forEach(s => settings.set(s.id, s));
  const records = new Map(a.records.map(r => [r.id, r])); for (const r of b.records) { const old = records.get(r.id); if (!old || old.updatedAt < r.updatedAt || old.updatedAt === r.updatedAt && (r.result || !old.result)) records.set(r.id, r); }
  const rounds = new Map(a.rounds.map(r => [r.id, r])); for (const r of b.rounds) { const old = rounds.get(r.id); if (!old || old.updatedAt < r.updatedAt || old.updatedAt === r.updatedAt && (r.state !== 'running' || old.state === 'running')) rounds.set(r.id, r); }
  const archives=new Map((a.archives??[]).map(s=>[s.id,s]));for(const s of b.archives??[])if(!archives.has(s.id))archives.set(s.id,s);
  const directoryEdits={...(a.directoryEdits??{})};for(const [id,edit]of Object.entries(b.directoryEdits??{})){const old=directoryEdits[id];if(!old||edit.at>old.at||edit.at===old.at&&edit.hidden)directoryEdits[id]=edit;}
  return { ...incoming, monitorLibrary: { ...(Object.keys(directoryEdits).length?{directoryEdits}:{}),version: 1, importedLegacy: a.importedLegacy || b.importedLegacy, settings: [...settings.values()], records: [...records.values()], rounds: [...rounds.values()],...(archives.size?{archives:[...archives.values()]}:{}) } };
}
