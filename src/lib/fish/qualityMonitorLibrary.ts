import { shortFishHash } from './algorithm';
import { QUALITY_NOTIONAL, activeBuyFilters, qualityComparisonRows, qualityFilterReadingKey, qualityFilterStatus, qualityResultKey, qualityRunGroups, qualityRunSamples, qualityVetoVersion, type FishQualityStudy, type QualityFilterReading, type QualityFilterStatus, type QualityGroup, type QualityResult, type QualitySample } from './quality';
import { activeHoldingVetoes, holdingVetoIdentity } from './qualityVeto';
import type { TradeSignal } from '@/lib/signalLibrary';

export interface QualityMonitorSetting {
  id: string; signature: string; plan: QualityGroup; detectors: QualityGroup[];
  observeHours: number; entryMode: FishQualityStudy['entryMode']; filtersKnown: boolean; detectorsKnown: boolean; notional: number; leverage: number;
}
export interface QualityMonitorRecord {
  id: string; settingId: string; source: TradeSignal; enteredAt: number | null; basis: QualitySample['basis'];
  filterStatus: QualityFilterStatus; readings: QualityFilterReading[]; result?: QualityResult;
  firstSavedAt: number; updatedAt: number;
}
export interface QualityMonitorRound {
  id: string; startedAt: number; updatedAt: number; finishedAt?: number;
  state: 'running' | 'complete' | 'paused' | 'failed'; recordIds: string[]; legacy?: boolean; error?: string;
}
export interface QualityMonitorLibrary {
  version: 1; importedLegacy: boolean; settings: QualityMonitorSetting[]; records: QualityMonitorRecord[]; rounds: QualityMonitorRound[];
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
  const signature = JSON.stringify([algorithm(plan), plan.rule ?? null, plan.execution ?? 'close', qualityVetoVersion(plan), holdingVetoIdentity(plan.holdingVetoes),
    ordered(activeHoldingVetoes(plan.holdingVetoes).map(v => [v.kind, v.direction, v.threshold, v.metric, v.snapshot?.scale, v.snapshot?.H])),
    ordered(filters.map(f => [f.snapshot.featureId, f.metric, f.snapshot.definitionKey, f.snapshot.interval, f.snapshot.scale, f.snapshot.H, f.direction, f.threshold])),
    ordered(detectors.map(g => [algorithm(g), g.snapshot.direction, g.snapshot.threshold])), study.observeHours, study.entryMode, filtersKnown, detectorsKnown, QUALITY_NOTIONAL, 1]);
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
  return { id, settingId: setting.id, source: { id: sourceId, symbol, timeMs, timeLabel, fallbackZone, exchange, market, underlying, binanceSymbol }, enteredAt: sample.enteredAt, basis: sample.basis,
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
  const round: QualityMonitorRound = { id: roundId, startedAt: at, updatedAt: at, state: 'running', recordIds: [...new Set([...tasks.values()].map(t => t.id))] };
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
    const frozen = { ...study, samples: [sample], groups: detectors, sellPlans: [plan], selectedRowIds: undefined, observeHours: hours, buyFilters: undefined };
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
/** A persisted batch cannot still be running in a newly mounted evaluator. Retain all partial rows. */
export function recoverQualityMonitorRounds(study: FishQualityStudy, at = Date.now()): FishQualityStudy {
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
  return { ...incoming, monitorLibrary: { version: 1, importedLegacy: a.importedLegacy || b.importedLegacy, settings: [...settings.values()], records: [...records.values()], rounds: [...rounds.values()] } };
}
