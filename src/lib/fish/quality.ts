/** Independent paper experiments; orders and account balances are never modified. */
import type { QualityCampaignRun } from './qualityCampaignArchive';
import type { QualityRepairBatch } from './qualityRepair';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { compileFeatureFormula, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { intervalMs, type ResearchInterval } from '@/lib/deepRsa/marketData';
import { compileFishProgram, evaluateFishProgram, shortFishHash, type FishSnapshot, type FishProgram } from './algorithm';
import { fishSourceLabel, fishMetricLabel } from './records';
import { signalDedupKey } from '@/lib/signalLibrary';
import type { FishReconstructionLoader } from './reconstruction';
import { validateFishBars } from './shared';
import { computeHoldingDynamicMaxDrawdownPct, computePeakPriceChangePct } from '@/lib/campaignMainPriceChange';
import { findQualityIntrabarExit, type QualityTrigger } from './qualityIntrabar';
import { activeHoldingVetoes, advanceQualityHolding, holdingVetoIdentity, validateHoldingVeto, type QualityHoldingVeto, type QualityExitCause } from './qualityVeto';

export const QUALITY_NOTIONAL = 100, QUALITY_MINUTE = 60_000;
export type QualityEntryMode = 'capture' | 'signal';
export interface QualityExitRule { metric: string; direction: '<' | '>'; threshold: number }
export interface QualityGroup {
  id: string; label: string; metric: string; snapshot: FishSnapshot; rule?: QualityExitRule;
  /** Absent on historical close-confirmation experiments. */
  execution?: 'intrabar-1m';
  /** New sell runs freeze the account definition; unmarked older runs retain their original snapshot. */
  definitionSource?: 'account';
  holdingVetoes?: QualityHoldingVeto[];
}
export interface QualitySample {
  id: string; source: TradeSignal; groups: string[]; enteredAt: number | null;
  basis: 'capture' | 'detected' | 'signal' | 'missing'; importedAt: number;
  /** 'library' = 信号库的信号：只参加卖出比较，不属于任何探测算法，也不与鱼舱的鱼合并。缺省 = 鱼。 */
  origin?: 'library';
  /** Derived per-row capture readings; never replaces any saved source snapshot. */
  readings?: Record<string, FishSnapshot>;
  /** Derived display rows share one signalId / paper trade; detectorId selects their attribution. */
  signalId?: string; detectorId?: string;
}
export interface QualityResult {
  key: string; sampleId: string; groupId: string; evaluatedAt: number;
  status: 'open' | 'closed' | 'waiting' | 'error'; reason?: string;
  entryTime?: number; entryPrice?: number; endTime?: number; endPrice?: number;
  returnPct?: number; pnl?: number; peakPct?: number; adversePct?: number;
  drawdownPct?: number; uncapturedPct?: number; heldHours?: number; complete?: boolean;
  exitReading?: number;
  pendingExit?: QualityTrigger;
  exitSnapshot?: { barOpenTime: number; observedAt: number; previous?: { at: number; reading: number }; cause?: QualityExitCause };
}
/** Drawdowns are nonnegative losses; an absent measurement is never a measured zero. */
export function qualityDrawdownPct(result: QualityResult | undefined, kind: 'static' | 'dynamic'): number | null {
  if (!result || !['open','closed'].includes(result.status)) return null;
  const value = kind === 'static' ? result.adversePct : result.drawdownPct;
  return value != null && Number.isFinite(value) ? Math.max(0,kind === 'static' ? -value : value) : null;
}
/**
 * 【用户要求】2026-10-26「在比较卖出的时候，再增加一些买入的过滤机制，比如只有符合状态S大于0.7才买入（选择权给我）」
 * 买入过滤：全部启用的条件都满足才买入；读数取买入时刻之前最后一根已收盘的 K 线（不看买入之后）。
 */
export interface QualityBuyFilter { id: string; label: string; metric: string; direction: '<' | '>'; threshold: number; enabled: boolean; snapshot: FishSnapshot }
/** 买入时刻的读数缓存：与门槛无关，改门槛不必重新取数。 */
export interface QualityFilterReading { key: string; value?: number; at?: number; error?: string }
export interface FishQualityStudy {
  version: 1; startedAt: number; entryMode: QualityEntryMode; observeHours: number;
  tracking: boolean; groups: QualityGroup[]; samples: QualitySample[]; results: QualityResult[];
  /** Shared sell experiments, independent of the detecting algorithm. Legacy group rules remain saved. */
  sellPlans?: QualityGroup[]; selectedSellId?: string; cohortIds?: string[]; selectedRowIds?: string[];
  /** Frozen evaluated trades, including earlier sell thresholds, for comparison campaigns. */
  campaignRuns?: QualityCampaignRun[];
  campaignRepair?: QualityRepairBatch;
  buyFilters?: QualityBuyFilter[]; filterReadings?: QualityFilterReading[];
  /** 已自动勾选过的挖掘信号（之后用户取消勾选就不再勾回来）。 */
  minedAutoSelected?: string[];
}
export const newQualityStudy = (now = Date.now()): FishQualityStudy => ({ version: 1, startedAt: now, entryMode: 'capture', observeHours: 0, tracking: true, groups: [], samples: [], results: [], selectedRowIds: [] });
/**
 * 【用户要求】2026-10-26「历史鱼按捕捞时刻买入」：信号时间是「一直持续到扫描时刻」那段行情的起点，
 * 在起点买入等于事先知道信号会撑到扫描时刻，并白拿起点到扫描之间的涨幅；捕捞时刻才是当时真能下单的时点。
 * 已有历史样本改按捕捞时刻重新评估（旧收益作废）；实时发现的鱼和已选的卖出规则保留。
 */
export function migrateQualityCaptureEntries(study: FishQualityStudy): FishQualityStudy {
  let changed = study.entryMode !== 'capture';
  const reset = new Set<string>();
  const samples = study.samples.map(sample => {
    if (sample.basis === 'detected' || sample.origin === 'library') return sample;
    const cutoff = sample.source.fish?.cutoffMs;
    const enteredAt = cutoff != null && Number.isFinite(cutoff) && cutoff > 0 ? cutoff : null;
    const basis = enteredAt == null ? 'missing' : 'capture';
    if (sample.enteredAt === enteredAt && sample.basis === basis) return sample;
    changed = true;
    if (sample.enteredAt !== enteredAt) reset.add(sample.id);
    return { ...sample, enteredAt, basis } as QualitySample;
  });
  return changed ? { ...study, entryMode: 'capture', samples, results: study.results.filter(r => !reset.has(r.sampleId)) } : study;
}
export function qualityMembers(s: TradeSignal): FishSnapshot[] {
  const f = s.fish;
  if (!f) return [];
  return f.algorithms?.length
    ? (f.combination === 'or' ? (f.hitAlgorithms ?? []).map(i => f.algorithms![i - 1]).filter(Boolean) : f.algorithms)
    : [f];
}
export const qualityGroupId = (f: FishSnapshot) => shortFishHash(JSON.stringify([
  f.featureId, f.definitionKey, f.statistic, f.interval, f.H, f.scale, f.unit, f.direction, f.threshold, f.constraints,
]));
/** A union's displayed start changes when another member joins. Attribute each member's original run once. */
function memberKey(source: TradeSignal, f: FishSnapshot): string {
  let start = source.timeMs;
  const bars = f.cutoffIndex != null && f.startIndex != null ? f.cutoffIndex - f.startIndex : f.aboveBars != null ? f.aboveBars - 1 : null;
  if (bars != null && Number.isInteger(bars) && bars >= 0 && Number.isFinite(f.cutoffMs)) {
    const step = intervalMs((f.interval ?? '5m') as ResearchInterval);
    start = Math.floor(f.cutoffMs / step) * step - bars * step;
  }
  return `${signalDedupKey({ ...source, timeMs: start })}|${qualityGroupId(f)}`;
}
/** Snapshot parameters, including non-default hl/avgh, are encoded in definitionKey. Never use today's formula. */
export function qualityDefinition(f: FishSnapshot): DeepDigFeatureDef {
  const saved: unknown = JSON.parse(f.definitionKey ?? 'null');
  if (!Array.isArray(saved) || typeof saved[0] !== 'string' || !saved[0].trim()) throw new Error('缺少捕获时的公式快照，请重新捕捞');
  const extra = saved.slice(4).filter((v): v is string => typeof v === 'string');
  const numeric = (prefix: string, fallback: number) => {
    const value = extra.find(v => v.startsWith(prefix));
    const n = value ? Number(value.slice(prefix.length)) : fallback;
    if (!(n > 0) || !Number.isFinite(n)) throw new Error('捕获快照的周期参数无效');
    return n;
  };
  return {
    id: f.featureId ?? 'captured', name: f.featureName ?? '捕获算法', short: f.featureShort ?? '捕获算法', definition: '',
    formula: saved[0], scale: f.scale ?? 1, unit: f.unit ?? '', positive: typeof saved[1] === 'string' ? saved[1] : '1',
    control: typeof saved[2] === 'string' ? saved[2] : '0', groupVars: 2,
    interval: (f.interval ?? extra.find(v => /^\d+[mhdwM]$/.test(v)) ?? '5m') as ResearchInterval,
    halfLifeHours: numeric('hl=', 6), avgHours: numeric('avgh=', 24),
  };
}
export function qualityMetricPlan(f: FishSnapshot, metric = 'capture'): { plan: FishProgram; scale: number } {
  let def = qualityDefinition(f), statistic = metric === 'capture' ? f.statistic ?? '结果' : metric;
  if (metric === 'capture' && f.H != null && f.H > 0) {
    const last = compileFeatureFormula(def.formula).program.statements.at(-1)!;
    const expression = last.name ?? `(${def.formula.split('\n')[last.line - 1]})`;
    let alias = '__qualityCapture';
    while (def.formula.includes(alias)) alias += '_';
    def = { ...def, formula: `${def.formula}\n${alias} = avg(${statistic === '结果' ? expression : statistic}, ${f.H})` };
    statistic = alias;
  }
  const plan = compileFishProgram(def, { statistic, direction: '>', threshold: 0, constraints: [] });
  if (plan.unavailable) throw new Error(plan.unavailable);
  return { plan, scale: metric === 'capture' ? f.scale ?? 1 : 1 };
}
export function importQualityFish(study: FishQualityStudy, signals: readonly TradeSignal[], now = Date.now()): FishQualityStudy {
  if (!study.tracking) return study;
  const groups = new Map(study.groups.map(g => [g.id, g])), samples = new Map(study.samples.map(s => [s.id, s]));
  const seen = new Set(study.samples.flatMap(s => qualityMembers(s.source).filter(f => s.groups.includes(qualityGroupId(f))).map(f => memberKey(s.source, f))));
  let changed = false;
  for (const source of signals) {
    const members = [...new Map(qualityMembers(source).map(f => [qualityGroupId(f), f])).values()].filter(f => !seen.has(memberKey(source, f)));
    const ids = members.map(qualityGroupId);
    if (!ids.length) continue;
    // Archiving/reopening a panel cannot buy the same signal again; changed capture settings are a new experiment.
    const id = shortFishHash(JSON.stringify(members.map(f => memberKey(source, f)).sort()));
    if (samples.has(id)) continue;
    const cutoff = source.fish?.cutoffMs;
    const live = source.freshCatch && (source.caughtAt ?? 0) >= study.startedAt && cutoff != null && Math.abs((source.caughtAt ?? 0) - cutoff) < 3_600_000;
    const enteredAt = live ? source.caughtAt : study.entryMode === 'signal' ? source.timeMs : cutoff;
    samples.set(id, { id, source: structuredClone(source), groups: ids, enteredAt: Number.isFinite(enteredAt) && enteredAt! > 0 ? enteredAt! : null,
      basis: !Number.isFinite(enteredAt) || enteredAt! <= 0 ? 'missing' : live ? 'detected' : study.entryMode === 'signal' ? 'signal' : 'capture', importedAt: now });
    members.forEach(f => { const key = qualityGroupId(f); if (!groups.has(key)) groups.set(key, { id: key, label: fishSourceLabel(f), metric: fishMetricLabel(f), snapshot: structuredClone(f) }); });
    members.forEach(f => seen.add(memberKey(source, f)));
    changed = true;
  }
  return changed ? { ...study, groups: [...groups.values()], samples: [...samples.values()] } : study;
}
/**
 * 【用户要求】2026-10-26「在检查卖出算法时，需要将信号库中的信号也纳入进来（注意要与鱼舱里的鱼做区分）」
 * 信号库的信号复制一份进来，按信号时间买入；没有探测算法（groups 为空），只参加第一步卖出比较。
 * 删掉信号库里的信号不删副本；同一信号只复制一次。
 */
export const qualityLibrarySampleId = (source: TradeSignal) => `lib-${shortFishHash(signalDedupKey(source))}`;
export function importQualityLibrary(study: FishQualityStudy, signals: readonly TradeSignal[], now = Date.now()): FishQualityStudy {
  if (!study.tracking) return study;
  const ids = new Set(study.samples.map(s => s.id)), added: QualitySample[] = [];
  for (const source of signals) {
    const id = qualityLibrarySampleId(source);
    if (ids.has(id)) continue;
    ids.add(id);
    const enteredAt = Number.isFinite(source.timeMs) && source.timeMs > 0 ? source.timeMs : null;
    added.push({ id, source: structuredClone(source), groups: [], enteredAt, basis: enteredAt == null ? 'missing' : 'signal', importedAt: now, origin: 'library' });
  }
  return added.length ? { ...study, samples: [...study.samples, ...added] } : study;
}
export const qualityResultKey = (s: QualitySample, g: QualityGroup, hours: number) => {
  const identity: unknown[] = [s.signalId ?? s.id, s.enteredAt, g.id, g.rule ?? null, hours, g.snapshot.definitionKey, g.snapshot.statistic, g.snapshot.interval, g.snapshot.scale, g.snapshot.H];
  if (g.execution === 'intrabar-1m') identity.push('intrabar-1m-v1');
  const vetoes=holdingVetoIdentity(g.holdingVetoes);if(vetoes.length)identity.push(['holding-veto-v1',vetoes]);
  return shortFishHash(JSON.stringify(identity));
};
/** A fish occupies one row, even when several capture rules/rounds caught the same signal. */
// 样本数组不变时复用合并结果：评估中每出一个结果 study 都会换，但 samples 不变，不必整表重算。
const comparisonCache = new WeakMap<readonly QualitySample[], QualitySample[]>();
export function qualityComparisonRows(study: FishQualityStudy): QualitySample[] {
  const cached = comparisonCache.get(study.samples);
  if (cached) return cached;
  const built = buildComparisonRows(study);
  comparisonCache.set(study.samples, built);
  return built;
}
function buildComparisonRows(study: FishQualityStudy): QualitySample[] {
  const rows = new Map<string, QualitySample>();
  for (const sample of study.samples) {
    // 信号库的信号单独成行，即使与某条鱼同币同时也不合并。
    const identity = `${sample.origin === 'library' ? 'lib|' : ''}${signalDedupKey(sample.source)}|${sample.enteredAt}`;
    const prior = rows.get(identity);
    const readings = Object.fromEntries(qualityMembers(sample.source).filter(f => sample.groups.includes(qualityGroupId(f))).map(f => [qualityGroupId(f), f]));
    rows.set(identity, prior ? { ...prior, groups: [...new Set([...prior.groups, ...sample.groups])], readings: { ...prior.readings, ...readings } }
      : { ...sample, id: `row-${shortFishHash(identity)}`, groups: [...sample.groups], readings });
  }
  return [...rows.values()];
}
export function expandQualityRows(rows: readonly QualitySample[]): QualitySample[] {
  return rows.flatMap(row => row.signalId ? [row] : (row.groups.length ? row.groups : [undefined]).map(detectorId => ({
    ...row, signalId: row.id, detectorId, id: `${row.id}/detector/${detectorId ?? 'none'}`, groups: detectorId ? [detectorId] : [],
  })));
}
export const qualityDisplayRows = (study: FishQualityStudy) => expandQualityRows(qualityComparisonRows(study));
export function qualityRunSamples(study: FishQualityStudy): QualitySample[] {
  if (!study.sellPlans) return study.samples;
  const signals = qualityComparisonRows(study), selected = new Set(study.selectedRowIds ?? []);
  const selectedSignals = new Set(expandQualityRows(signals).filter(r => selected.has(r.id) || selected.has(r.signalId!)).map(r => r.signalId));
  return signals.filter(s => selectedSignals.has(s.id) && (!study.cohortIds || study.cohortIds.includes(s.id)));
}
/**
 * 挖掘到的鱼导入后自动勾选它的全部探测行，交给固定的卖出方案评估（比较探测）。
 * 每条信号只自动勾一次；用户之后取消勾选就保持取消。没有新的返回原对象。
 */
export function selectMinedRows(study: FishQualityStudy): FishQualityStudy {
  if (!study.sellPlans) return study;
  const done = new Set(study.minedAutoSelected ?? []), fresh = qualityDisplayRows(study).filter(r => r.source.mined && !done.has(r.signalId!));
  if (!fresh.length) return study;
  const selected = new Set(study.selectedRowIds ?? []);
  fresh.forEach(r => selected.add(r.id));
  return { ...study, selectedRowIds: [...selected], minedAutoSelected: [...done, ...new Set(fresh.map(r => r.signalId!))] };
}
export const qualityRunGroups = (study: FishQualityStudy) => study.sellPlans ?? study.groups;
export function qualityExitSuggestions(group: QualityGroup): { label: string; rule: QualityExitRule }[] {
  const t = group.snapshot.threshold, direction: '<' | '>' = group.snapshot.direction === '<' ? '>' : '<';
  return [
    { label: '回穿捕获门槛', rule: { metric: 'capture', direction, threshold: t } },
    { label: '缓冲 50% 门槛幅度', rule: { metric: 'capture', direction, threshold: t + (direction === '<' ? -1 : 1) * Math.abs(t) / 2 } },
    { label: '穿过零轴', rule: { metric: 'capture', direction, threshold: 0 } },
  ].map(v => ({ ...v, label: `${v.label}（${v.rule.direction} ${v.rule.threshold}）` }));
}

export const qualityFilterReadingKey = (row: QualitySample, f: QualityBuyFilter) => shortFishHash(JSON.stringify(['buy-filter', row.signalId ?? row.id, row.enteredAt, f.snapshot.definitionKey, f.metric, f.snapshot.interval]));
export const activeBuyFilters = (study: FishQualityStudy) => (study.buyFilters ?? []).filter(f => f.enabled && Number.isFinite(f.threshold));
export type QualityFilterStatus = { state: 'none' | 'pass' | 'fail' | 'pending' | 'error'; detail: string };
/** 一行是否买入：没有启用的条件 = none；任一条件缺数据 = error；任一不满足 = fail；还没读数 = pending。 */
export function qualityFilterStatus(study: FishQualityStudy, row: QualitySample, readings: ReadonlyMap<string, QualityFilterReading> = new Map((study.filterReadings ?? []).map(r => [r.key, r]))): QualityFilterStatus {
  const filters = activeBuyFilters(study);
  if (!filters.length) return { state: 'none', detail: '' };
  const parts: string[] = []; let pending = false, error = false, fail = false;
  for (const f of filters) {
    const r = readings.get(qualityFilterReadingKey(row, f));
    if (!r) { pending = true; parts.push(`${f.label} 待读数`); continue; }
    if (r.error || !Number.isFinite(r.value)) { error = true; parts.push(`${f.label} 缺数据：${r.error ?? '读数无效'}`); continue; }
    const ok = f.direction === '>' ? r.value! > f.threshold : r.value! < f.threshold;
    if (!ok) fail = true;
    parts.push(`${f.label} ${+r.value!.toPrecision(4)} ${ok ? '满足' : '不满足'} ${f.direction} ${f.threshold}`);
  }
  return { state: error ? 'error' : fail ? 'fail' : pending ? 'pending' : 'pass', detail: parts.join('；') };
}
/** 买入时刻之前最后一根已收盘 K 线上的读数（原值，倍率 1）。 */
export async function evaluateQualityFilter(row: QualitySample, f: QualityBuyFilter, now: number, load: FishReconstructionLoader, signal: AbortSignal): Promise<QualityFilterReading> {
  const key = qualityFilterReadingKey(row, f);
  if (!row.enteredAt) return { key, error: '缺少有效买入时间' };
  try {
    const { plan, scale } = qualityMetricPlan(f.snapshot, f.metric);
    const cut = Math.floor(row.enteredAt / plan.step) * plan.step, from = cut - (plan.warm + 1) * plan.step;
    if (from < 0) return { key, error: '公式预热所需历史不足' };
    const bars = await load({ ...row.source, timeMs: now }, from, cut, plan, signal);
    validateFishBars(bars, cut, (cut - from) / plan.step, plan.step);
    const value = evaluateFishProgram(bars, plan).average.at(-1)! * scale;
    return Number.isFinite(value) ? { key, value, at: cut } : { key, error: '买入时刻读数缺失' };
  } catch (error) {
    abort(signal);
    return { key, error: error instanceof Error ? error.message : '行情读取失败' };
  }
}

const pricePlan = () => compileFishProgram({ id: 'quality-price', short: '价格', name: '价格', definition: '', formula: 'C', scale: 1, unit: '', positive: '1', control: '0', interval: '1m' }, { statistic: '结果', direction: '>', threshold: 0, constraints: [] });
const abort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); };
/** Observe the saved timing policy causally; only the execution minute open contributes to a fill. */
export async function evaluateQualitySample(sample: QualitySample, group: QualityGroup, observeHours: number, now: number, load: FishReconstructionLoader, signal: AbortSignal, previous?: QualityResult): Promise<QualityResult> {
  const key = qualityResultKey(sample, group, observeHours), base = { key, sampleId: sample.id, groupId: group.id, evaluatedAt: now };
  if (!sample.enteredAt) return { ...base, status: 'error', reason: '缺少有效买入时间，不能可靠还原买入时点' };
  if (!(observeHours >= 0 && observeHours <= 24 * 366) || !Number.isFinite(observeHours)) return { ...base, status: 'error', reason: '观察时长须在 0～8784 小时之间；0 为持续至卖出' };
  const entry = Math.ceil(sample.enteredAt / QUALITY_MINUTE) * QUALITY_MINUTE;
  const limit = observeHours === 0 ? Infinity : entry + Math.ceil(observeHours * 60) * QUALITY_MINUTE;
  const availableEnd = Math.floor(now / QUALITY_MINUTE) * QUALITY_MINUTE, end = Math.min(availableEnd, limit);
  if (end <= entry) return { ...base, status: 'waiting', reason: '等待入场后的首根 1 分钟 K 线' };
  try {
    const row = { ...sample.source, timeMs: now }, pp = pricePlan();
    if (!group.rule) {
      // Enter now, but wait for a chosen exit experiment before loading the whole holding history.
      const bars = await load(row, entry, entry + QUALITY_MINUTE, pp, signal);
      validateFishBars(bars, entry + QUALITY_MINUTE, 1, QUALITY_MINUTE);
      return { ...base, status: 'waiting', entryTime: entry, entryPrice: bars[0].open, reason: '已登记买入，待选择卖出规则后评估收益' };
    }
    const prior = previous?.key === key && previous.status === 'open' && previous.entryPrice! > 0 && previous.endTime! >= entry && previous.endTime! <= end ? previous : undefined;
    const since = prior?.endTime ?? entry;
    if (since >= end && !prior?.pendingExit) return { ...prior!, evaluatedAt: now };
    let trigger: QualityTrigger | undefined = prior?.pendingExit;
    let replayedPrices: ResearchBar[] | undefined;
    if (group.rule && !trigger) {
      const rule = group.rule;
      if (!Number.isFinite(rule.threshold) || !['<', '>'].includes(rule.direction)) throw new Error('卖出规则无效');
      const { plan, scale } = qualityMetricPlan(group.snapshot, rule.metric);
      const vetoes=activeHoldingVetoes(group.holdingVetoes);
      vetoes.forEach(validateHoldingVeto);
      if (group.execution === 'intrabar-1m' || vetoes.length) {
        let holding;
        if(vetoes.some(v=>v.kind!=='indicator')) {
          const initial=prior?.entryPrice ? undefined : await load(row,entry,entry+QUALITY_MINUTE,pp,signal);
          if(initial)validateFishBars(initial,entry+QUALITY_MINUTE,1,QUALITY_MINUTE);
          const entryPrice=prior?.entryPrice??initial![0].open;
          holding={entry:entryPrice,peak:entryPrice*(1+(prior?.peakPct??0)/100),minimum:entryPrice*(1+(prior?.adversePct??0)/100),dynamic:prior?.drawdownPct??0};
        }
        const conditions=vetoes.filter(v=>v.kind==='indicator').map(v=>({...qualityMetricPlan(v.snapshot!,v.metric),rule:{direction:v.direction,threshold:v.threshold},cause:{id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold}}));
        const replay = await findQualityIntrabarExit({ row,plan,scale,rule,entry,since,end,resumed:!!prior,load,signal,conditions,vetoes,holding });
        trigger = replay.trigger; replayedPrices = replay.prices;
      } else {
        let cursor = Math.floor(since / plan.step) * plan.step;
        const stop = Math.floor(end / plan.step) * plan.step;
        while (cursor < stop && !trigger) {
          abort(signal);
          const cut = Math.min(stop, cursor + 500 * plan.step), from = cursor - plan.warm * plan.step;
          if (from < 0) throw new Error('公式预热所需历史不足');
          const bars = await load(row, from, cut, plan, signal);
          validateFishBars(bars, cut, (cut - from) / plan.step, plan.step);
          const readings = evaluateFishProgram(bars, plan).average;
          for (let i = 0; i < bars.length; i++) {
            const at = bars[i].openTime + plan.step;
            if (at <= entry || at <= cursor || at > end) continue;
            const reading = readings[i] * scale;
            if (!Number.isFinite(reading)) throw new Error('卖出指标存在缺失读数，不能越过缺口判断成交');
            if (rule.direction === '<' ? reading < rule.threshold : reading > rule.threshold) { trigger = { at, reading }; break; }
          }
          cursor = cut;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }
    // Need the execution minute's open, but never its future high/low. A last-minute trigger waits for that price.
    const priceEnd = trigger && trigger.at < availableEnd ? trigger.at + QUALITY_MINUTE : end;
    if (priceEnd <= since && prior) return { ...prior, evaluatedAt: now };
    let prices: readonly ResearchBar[] | undefined = replayedPrices?.filter(b => b.openTime >= since && b.openTime < priceEnd);
    if (!prices || prices.length !== (priceEnd - since) / QUALITY_MINUTE) prices = await load(row, since, priceEnd, pp, signal);
    validateFishBars(prices, priceEnd, (priceEnd - since) / QUALITY_MINUTE, QUALITY_MINUTE);
    const entryPrice = prior?.entryPrice ?? prices[0].open;
    const exitBar = trigger ? prices.find(b => b.openTime === trigger.at) : undefined;
    const closed = !!exitBar, finalTime = closed ? exitBar!.openTime : end;
    const finalPrice = closed ? exitBar!.open : prices.at(-1)!.close;
    const held = prices.filter(b => b.openTime < finalTime);
    const klines = held.map(b => ({ time: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const args = { klines, startMs: since, endMs: finalTime - 1, barMs: QUALITY_MINUTE };
    const returnPct = (finalPrice / entryPrice - 1) * 100;
    let peakPct = Math.max(prior?.peakPct ?? 0, returnPct);
    for (let i = 0; i < klines.length; i += 5000) peakPct = Math.max(peakPct, computePeakPriceChangePct({ ...args, klines: klines.slice(i, i + 5000), side: 'long', entryPrice }) ?? 0);
    // The exit open itself is observable and belongs to the holding path; the rest of the exit candle does not.
    const previousPeak = entryPrice * (1 + (prior?.peakPct ?? 0) / 100);
    let peak = previousPeak, exitDrawdown = 0;
    for (const b of held) peak = Math.max(peak, b.high);
    exitDrawdown = Math.max(0, (peak - finalPrice) / peak * 100);
    const low = held.reduce((minimum, b) => Math.min(minimum, b.low), Math.min(entryPrice * (1 + (prior?.adversePct ?? 0) / 100), finalPrice));
    let vetoDynamic=0;
    if(activeHoldingVetoes(group.holdingVetoes).length) {
      let path={entry:entryPrice,peak:previousPeak,minimum:entryPrice*(1+(prior?.adversePct??0)/100),dynamic:prior?.drawdownPct??0};
      for(const b of held)path=advanceQualityHolding(path,b);
      vetoDynamic=Math.max(path.dynamic,0,(Math.max(path.peak,finalPrice)-finalPrice)/Math.max(path.peak,finalPrice)*100);
    }
    const drawdownBars = prior ? [{ time: since - QUALITY_MINUTE, open: previousPeak, high: previousPeak, low: previousPeak, close: previousPeak, volume: 0 }, ...klines] : klines;
    return { ...base, status: closed ? 'closed' : 'open', entryTime: entry, entryPrice, endTime: finalTime, endPrice: finalPrice,
      returnPct, pnl: QUALITY_NOTIONAL * returnPct / 100, peakPct, adversePct: (low / entryPrice - 1) * 100,
      drawdownPct: Math.max(prior?.drawdownPct ?? 0, exitDrawdown, vetoDynamic, computeHoldingDynamicMaxDrawdownPct({ ...args, klines: drawdownBars, startMs: prior ? since - QUALITY_MINUTE : since }) ?? 0), uncapturedPct: peakPct - returnPct,
      heldHours: (finalTime - entry) / 3_600_000, complete: closed || end >= limit && !trigger,
      exitReading: closed ? trigger!.reading : undefined,
      pendingExit: !closed ? trigger : undefined,
      exitSnapshot: trigger?.barOpenTime != null ? {barOpenTime:trigger.barOpenTime,observedAt:trigger.at,previous:trigger.previous,cause:trigger.cause} : undefined,
      reason: closed && trigger?.cause ? `一票否决：${trigger.cause.label} ${trigger.cause.direction} ${trigger.cause.threshold}${trigger.cause.kind==='indicator'?'':'%'}；按下一分钟开盘价卖出` : closed ? group.execution === 'intrabar-1m' ? '盘中指标按已完成分钟复原，首次达标时按下一分钟开盘价卖出' : '指标收盘确认，下一分钟开盘卖出' : trigger ? '指标已触发，等待下一分钟开盘数据' : end < limit ? '持有中' : '观察期结束仍持有，记录期末浮盈' };
  } catch (error) {
    abort(signal);
    return { ...base, status: 'error', reason: error instanceof Error ? error.message : '行情读取失败' };
  }
}
export interface QualityProgress { done: number; total: number; current: string }
export interface QualityRunOptions {
  study: FishQualityStudy; signal: AbortSignal; onProgress: (p: QualityProgress) => void; onResult: (r: QualityResult) => void;
  /** 当前界面上的行顺序（看得见的在前）。每算完一条都重新读取，换筛选 / 排序 / 滚动后先算新露出来的行。 */
  priority?: () => readonly string[];
  /** 买入过滤的读数（每行每个条件算一次）。 */
  onFilterReading?: (r: QualityFilterReading) => void;
}
export async function collectFishQuality(options: QualityRunOptions, load: FishReconstructionLoader, now: number): Promise<void> {
  const { study, signal } = options, previous = new Map(study.results.map(r => [r.key, r]));
  const tasks = study.sellPlans
    ? qualityRunSamples(study).flatMap(s => study.sellPlans!.map(g => ({ s, g })))
    : study.samples.flatMap(s => s.groups.map(id => ({ s, g: study.groups.find(g => g.id === id)! }))).filter(v => v.g);
  // 【用户要求】2026-10-26「运行完的币种，结果要立即显示出来」：按界面顺序挑下一行，同一行的几条卖出规则连着算完
  const pending = new Map<string, { s: QualitySample; g: QualityGroup }[]>();
  for (const task of tasks) { const list = pending.get(task.s.id); if (list) list.push(task); else pending.set(task.s.id, [task]); }
  const next = () => {
    for (const id of options.priority?.() ?? []) { const list = pending.get(id); if (list) { pending.delete(id); return list; } }
    const first = pending.entries().next();
    if (first.done) return undefined;
    pending.delete(first.value[0]); return first.value[1];
  };
  // 买入过滤：先读买入时刻的指标，不满足（或缺数据）的行不再评估卖出；之后放宽门槛会补算
  const filters = study.sellPlans ? activeBuyFilters(study) : [];
  const readings = new Map((study.filterReadings ?? []).map(r => [r.key, r]));
  const passes = async (row: QualitySample) => {
    for (const f of filters) {
      const key = qualityFilterReadingKey(row, f);
      if (!readings.has(key)) { abort(signal); const r = await evaluateQualityFilter(row, f, now, load, signal); readings.set(key, r); options.onFilterReading?.(r); }
    }
    const state = qualityFilterStatus(study, row, readings).state;
    return state === 'none' || state === 'pass';
  };
  let done = 0;
  for (let batch = next(); batch; batch = next()) {
    // 买入过滤只作用于比较卖出：没买入的行仍按「比较探测」固定的那套卖出方案评估
    if (filters.length && !(await passes(batch[0].s))) {
      const kept = batch.filter(t => t.g.id === study.selectedSellId);
      done += batch.length - kept.length; options.onProgress({ done, total: tasks.length, current: '' });
      batch = kept; if (!batch.length) continue;
    }
    for (const { s, g } of batch) {
    abort(signal);
    options.onProgress({ done, total: tasks.length, current: `${s.source.symbol} · ${g.label}` });
    const cached = previous.get(qualityResultKey(s, g, study.observeHours));
    if (!cached?.complete && !(!g.rule && cached?.status === 'waiting' && cached.entryPrice! > 0)) options.onResult(await evaluateQualitySample(s, g, study.observeHours, now, load, signal, cached));
    done++;
    await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  options.onProgress({ done, total: tasks.length, current: '' });
}
export function qualityGroupSummary(study: FishQualityStudy, group: QualityGroup) {
  const samples = study.samples.filter(s => s.groups.includes(group.id));
  const keys = new Set(samples.map(s => qualityResultKey(s, group, study.observeHours)));
  const results = study.results.filter(r => keys.has(r.key));
  const valid = results.filter(r => r.status === 'open' || r.status === 'closed'), closed = valid.filter(r => r.status === 'closed');
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return { total: samples.length, valid: valid.length, closed: closed.length, open: valid.length - closed.length + results.filter(r => r.status === 'waiting' && r.entryPrice! > 0).length,
    failed: results.filter(r => r.status === 'error').length, pending: samples.length - results.length + results.filter(r => r.status === 'waiting').length,
    averageReturn: mean(valid.map(r => r.returnPct!)), averagePeak: mean(valid.map(r => r.peakPct!)),
    pnl: valid.reduce((a, r) => a + r.pnl!, 0), closedWinRate: closed.length ? closed.filter(r => r.pnl! > 0).length / closed.length * 100 : null };
}
