/**
 * 过滤库：买前过滤每一轮的冻结条件与判断结果，随鱼质量研究一起跟账号保存。
 * 【用户要求】2026-10-27「批量挖掘、买前过滤、持仓监测的逻辑和运行是独立的，因此需要有各自的数据库」。
 *
 * 以前只有读数缓存（study.filterReadings）：满足与否按「现在」的门槛现算，改了门槛就看不到上一轮的判断。
 * 现在每点一次「开始过滤」就记一轮：
 *   条件组（setting）= 当时启用的独立过滤条件（公式快照、方向、门槛）；旧版绑定条件保持原样。
 *   记录（record）  = 条件组 × 信号（交易所、市场、标的、信号时间、买入时刻），同一条件下同一信号合并为一条、保留最新判断；
 *   轮次（round）   = 这一轮判断了哪些记录（只存与上一轮的差异，见 libraryRounds）。
 */
import { shortFishHash } from './algorithm';
import { activeStandaloneBuyFilters, activeBuyFilters, qualityFilterReadingKey, qualityFilterStatus, qualityRunSamples, type FishQualityStudy, type QualityBuyFilter, type QualityFilterReading, type QualityFilterStatus, type QualitySample } from './quality';
import { finishLibraryRound, librarySignalIdentity, mergeLibraryRecords, mergeLibraryRounds, newLibraryRound, recoverLibraryRounds, type LibraryRecordBase, type LibraryRound } from './libraryRounds';
import type { TradeSignal } from '@/lib/signalLibrary';

export interface QualityFilterSetting { id: string; signature: string; filters: QualityBuyFilter[]; plans: string[] }
export interface QualityFilterRecord extends LibraryRecordBase {
  settingId: string; source: Pick<TradeSignal, 'id' | 'symbol' | 'timeMs' | 'timeLabel' | 'fallbackZone' | 'exchange' | 'market' | 'underlying' | 'binanceSymbol'>;
  enteredAt: number | null; basis: QualitySample['basis']; origin?: QualitySample['origin'];
  /** 与条件组的 filters 一一对应；还没读数的为 null。 */
  readings: (QualityFilterReading | null)[]; status: QualityFilterStatus;
}
export interface QualityFilterLibrary { version: 1; settings: QualityFilterSetting[]; records: QualityFilterRecord[]; rounds: LibraryRound[] }
interface FilterTask { id: string; setting: QualityFilterSetting; sample: QualitySample }
export interface QualityFilterCapture { roundId: string; tasks: FilterTask[]; readings: Map<string, QualityFilterReading> }

const empty = (): QualityFilterLibrary => ({ version: 1, settings: [], records: [], rounds: [] });
const conditionKey = (f: QualityBuyFilter) => [f.snapshot.featureId, f.metric, f.snapshot.definitionKey, f.snapshot.interval, f.direction, f.threshold];
export const qualityFilterSettingSignature = (filters: readonly QualityBuyFilter[]) =>
  JSON.stringify(filters.map(conditionKey).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

function tasksFor(study: FishQualityStudy, catalog: Map<string, QualityFilterSetting>): FilterTask[] {
  const tasks = new Map<string, FilterTask>();
  const sources = study.independentFilters ? [{label:'',filters:activeStandaloneBuyFilters(study)}] : (study.sellPlans ?? []).map(plan=>({label:plan.label,filters:activeBuyFilters(study,plan)}));
  for (const plan of sources) {
    const filters = plan.filters;
    if (!filters.length) continue;
    const signature = study.independentFilters ? JSON.stringify(['independent',qualityFilterSettingSignature(filters)]) : qualityFilterSettingSignature(filters);
    let setting = catalog.get(signature);
    if (!setting) { setting = { id: `filter-${shortFishHash(signature)}`, signature, filters: structuredClone(filters), plans: [] }; catalog.set(signature, setting); }
    if (plan.label && !setting.plans.includes(plan.label)) { setting = { ...setting, plans: [...setting.plans, plan.label] }; catalog.set(signature, setting); }
    for (const sample of qualityRunSamples(study)) {
      const id = JSON.stringify([setting.id, ...librarySignalIdentity(sample.source), sample.enteredAt]);
      tasks.set(id, { id, setting: catalog.get(signature)!, sample });
    }
  }
  return [...tasks.values()];
}
function recordFor(task: FilterTask, readings: ReadonlyMap<string, QualityFilterReading>, at: number, prior?: QualityFilterRecord): QualityFilterRecord {
  const { setting, sample } = task;
  const { id, symbol, timeMs, timeLabel, fallbackZone, exchange, market, underlying, binanceSymbol } = sample.source;
  const plan = { id: setting.id, buyFilters: setting.filters } as never;
  const picked = setting.filters.map(f => { const r = readings.get(qualityFilterReadingKey(sample, f)); return r ? structuredClone(r) : null; });
  return { id: task.id, settingId: setting.id, source: { id, symbol, timeMs, timeLabel, fallbackZone, exchange, market, underlying, binanceSymbol },
    enteredAt: sample.enteredAt, basis: sample.basis, ...(sample.origin ? { origin: sample.origin } : {}), readings: picked,
    status: qualityFilterStatus({ sellPlans: [plan] } as unknown as FishQualityStudy, sample, plan, new Map(readings)),
    firstSavedAt: prior?.firstSavedAt ?? at, updatedAt: at };
}
function withRecords(library: QualityFilterLibrary, tasks: readonly FilterTask[], readings: ReadonlyMap<string, QualityFilterReading>, at: number): QualityFilterRecord[] {
  const records = new Map(library.records.map(r => [r.id, r]));
  for (const task of tasks) records.set(task.id, recordFor(task, readings, at, records.get(task.id)));
  return [...records.values()];
}

let sequence = 0;
/** 开始一轮：冻结当前独立过滤条件（旧版保留绑定信息），先用已有读数写一遍（读数齐全的这一轮就已有结果）。没有任何启用条件时不记轮次。 */
export function beginQualityFilterRound(study: FishQualityStudy, frozen: FishQualityStudy, at: number): { study: FishQualityStudy; capture: QualityFilterCapture } | null {
  const library = study.filterLibrary ?? empty(), catalog = new Map(library.settings.map(s => [s.signature, s]));
  const tasks = tasksFor(frozen, catalog);
  if (!tasks.length) return null;
  const readings = new Map((frozen.filterReadings ?? []).filter(r => !r.error && Number.isFinite(r.value)).map(r => [r.key, r]));
  const roundId = `filter-${at}-${++sequence}-${Math.random().toString(36).slice(2, 8)}`;
  const round = newLibraryRound(library.rounds, roundId, at, tasks.map(t => t.id));
  return {
    study: { ...study, filterLibrary: { version: 1, settings: [...catalog.values()], records: withRecords(library, tasks, readings, at), rounds: [...library.rounds, round] } },
    capture: { roundId, tasks, readings },
  };
}
/** 结束（完成 / 暂停 / 失败）：用这一轮拿到的读数刷新本轮全部记录。 */
export function finishQualityFilterRound(study: FishQualityStudy, capture: QualityFilterCapture, state: 'complete' | 'paused' | 'failed', at: number, error?: string): FishQualityStudy {
  const library = study.filterLibrary;
  if (!library?.rounds.some(r => r.id === capture.roundId)) return study;
  return { ...study, filterLibrary: { ...library, records: withRecords(library, capture.tasks, capture.readings, at), rounds: finishLibraryRound(library.rounds, capture.roundId, state, at, error) } };
}
export function recoverQualityFilterRounds(study: FishQualityStudy, at = Date.now()): FishQualityStudy {
  const library = study.filterLibrary;
  return library?.rounds.some(r => r.state === 'running') ? { ...study, filterLibrary: { ...library, rounds: recoverLibraryRounds(library.rounds, at) } } : study;
}
/** 只增不减：旧标签页或只写修复的保存不能抹掉过滤库。 */
export function preserveQualityFilterLibrary(saved: FishQualityStudy | undefined, incoming: FishQualityStudy): FishQualityStudy {
  const a = saved?.filterLibrary, b = incoming.filterLibrary;
  if (!a) return incoming;
  if (!b) return { ...incoming, filterLibrary: a };
  const settings = new Map(a.settings.map(s => [s.id, s]));
  for (const s of b.settings) { const old = settings.get(s.id); settings.set(s.id, old ? { ...s, plans: [...new Set([...old.plans, ...s.plans])] } : s); }
  return { ...incoming, filterLibrary: { version: 1, settings: [...settings.values()], records: mergeLibraryRecords(a.records, b.records), rounds: mergeLibraryRounds(a.rounds, b.rounds) } };
}
