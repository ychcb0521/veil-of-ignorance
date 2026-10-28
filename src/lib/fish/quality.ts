/** Independent paper experiments; orders and account balances are never modified. */
import type { QualityCampaignRun } from './qualityCampaignArchive';
import type { QualityMonitorLibrary } from './qualityMonitorLibrary';
import type { QualityFilterLibrary } from './qualityFilterLibrary';
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
import { findQualityIntrabarExit, type QualityIntrabarCondition, type QualityTrigger } from './qualityIntrabar';
import { activeHoldingVetoes, advanceQualityHolding, holdingVetoIdentity, validateHoldingVeto, type QualityHoldingVeto, type QualityExitCause } from './qualityVeto';

import { mirrorIdentity, mirrorExecutionIdentity, validateQualityMirror, mirrorPnlBreakdown, type QualityMirrorTakeProfit, type QualityMirrorFill } from './qualityMirror';

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
  mirrorTakeProfit?: QualityMirrorTakeProfit;
  /** 回撤否决的成交方式版本：'stop' = 盘中触及止损价即按止损价成交（2026-10-26 起）；缺省 = 旧版（下一分钟开盘价）。 */
  vetoFill?: 'stop';
  /**
   * 历史绑定条件，供旧试验还原；independentFilters 工作流不读取此字段。
   */
  buyFilters?: QualityBuyFilter[];
  /**
   * 组合卖出（如「卖出算法组合1」）：前段按本方案自己的 snapshot / rule（CDA）判断卖出；
   * 持仓中最高价首次比买入价高出 switchPct% 的那一分钟收盘起，改按 after（状态 S）判断。持仓否决两段都有效。
   */
  combo?: QualitySellCombo;
}
export interface QualitySellCombo { switchPct: number; beforeLabel: string; after: { label: string; metric: string; snapshot: FishSnapshot; rule: QualityExitRule } }
/** 组合方案的身份（参与结果编号、监测库与存档的区分）；普通方案为 null，旧编号不变。 */
export const qualityComboIdentity = (g: Pick<QualityGroup, 'combo'>) => g.combo ? ['combo-v1', g.combo.switchPct, g.combo.after.metric, g.combo.after.snapshot.featureId,
  g.combo.after.snapshot.definitionKey, g.combo.after.snapshot.interval, g.combo.after.snapshot.scale, g.combo.after.rule.direction, g.combo.after.rule.threshold] : null;
/** 卖出条件的显示文字：普通方案「< 0.5」；组合方案「CDA < 0.5 → 涨 5.1% 后 状态 S < 0.5」。 */
export function qualityRuleText(g: QualityGroup): string {
  if (g.combo && g.rule) return `${g.combo.beforeLabel} ${g.rule.direction} ${g.rule.threshold} → 涨 ${g.combo.switchPct}% 后 ${g.combo.after.label} ${g.combo.after.rule.direction} ${g.combo.after.rule.threshold}`;
  return g.rule ? `${g.rule.direction} ${g.rule.threshold}` : hasQualityExit(g) ? g.mirrorTakeProfit?.enabled ? '镜像止盈' : '仅一票否决' : '设置门槛';
}
/** Holding vetoes are independent exits, even without an ordinary sell threshold. */
export const hasQualityExit = (group: QualityGroup) => group.combo ? !!group.rule : !!group.rule || !!group.mirrorTakeProfit?.enabled || activeHoldingVetoes(group.holdingVetoes).length > 0;
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
  /** First and only mirror sale, as a fraction of original coin quantity. */
  mirrorFill?: QualityMirrorFill; remainingFraction?: number; realizedPnl?: number;
  mirrorRealizedPnl?: number; remainingPnl?: number; initialNotional?: number;
  exitReading?: number;
  pendingExit?: QualityTrigger;
  exitSnapshot?: { barOpenTime: number; observedAt: number; previous?: { at: number; reading: number }; cause?: QualityExitCause; atOpen?:boolean; stage?: 'before' | 'after' };
}
/** Drawdowns are nonnegative losses; an absent measurement is never a measured zero. */
/** 持仓否决试验的版本号：同步过的方案为 v3（止损价成交），旧试验保持 v2。 */
export const qualityVetoVersion = (g: Pick<QualityGroup, 'vetoFill'>) => g.vetoFill === 'stop' ? 'holding-veto-v3' : 'holding-veto-v2';
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
  /** Legacy saved field; automatic periodic evaluation has been removed. */
  tracking: boolean;
  groups: QualityGroup[]; samples: QualitySample[]; results: QualityResult[];
  /** Shared sell experiments, independent of the detecting algorithm. Legacy group rules remain saved. */
  sellPlans?: QualityGroup[]; selectedSellId?: string; selectedRowIds?: string[];
  /** Legacy saved field; no longer restricts display or execution. */
  cohortIds?: string[];
  /** Frozen evaluated trades, including earlier sell thresholds, for comparison campaigns. */
  campaignRuns?: QualityCampaignRun[];
  monitorLibrary?: QualityMonitorLibrary;
  /** 过滤库：买前过滤每一轮的冻结条件与判断（见 qualityFilterLibrary）。 */
  filterLibrary?: QualityFilterLibrary;
  campaignRepair?: QualityRepairBatch;
  buyFilters?: QualityBuyFilter[]; filterReadings?: QualityFilterReading[];
  /** New workflow: filters are standalone experiments and never gate sell monitoring. */
  independentFilters?: true;
  /** Exact pre-migration bindings retained for historical provenance, never executed. */
  legacyFilterBindings?: { planId: string; filters: QualityBuyFilter[] }[];
  /** 已自动勾选过的挖掘信号（之后用户取消勾选就不再勾回来）。 */
  minedAutoSelected?: string[];
}
export const newQualityStudy = (now = Date.now()): FishQualityStudy => ({ version: 1, startedAt: now, entryMode: 'capture', observeHours: 0, tracking: false, groups: [], samples: [], results: [], selectedRowIds: [] });
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
    ...(f.featureId === 'mbi' || /\bmbiz\s*\(/.test(saved[0]) ? { MBI_N: numeric('MBI_N=', 25), MBI_Z0: numeric('MBI_Z0=', 1.25) } : {}),
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
  const combo = qualityComboIdentity(g); if (combo) identity.push(combo);
  // v3：回撤止损改为盘中触及按止损价成交（2026-10-26），旧结果需要重算
  const vetoes=holdingVetoIdentity(g.holdingVetoes);if(vetoes.length)identity.push([qualityVetoVersion(g),vetoes]);
  if (mirrorIdentity(g.mirrorTakeProfit).length) identity.push(mirrorIdentity(g.mirrorTakeProfit));
  if (mirrorExecutionIdentity(g).length) identity.push(mirrorExecutionIdentity(g));
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
  if (!study.sellPlans && !study.independentFilters) return study.samples;
  const signals = qualityComparisonRows(study), selected = new Set(study.selectedRowIds ?? []);
  const selectedSignals = new Set(expandQualityRows(signals).filter(r => selected.has(r.id) || selected.has(r.signalId!)).map(r => r.signalId));
  return signals.filter(s => selectedSignals.has(s.id));
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
/** 参与运行的卖出方案；还没设前段门槛的组合方案不跑（否则只是重复登记 CDA 那套的买入）。 */
export const qualityRunGroups = (study: FishQualityStudy) => study.sellPlans ? study.sellPlans.filter(p => !p.combo || !!p.rule) : study.groups;
export function qualityExitSuggestions(group: QualityGroup): { label: string; rule: QualityExitRule }[] {
  const t = group.snapshot.threshold, direction: '<' | '>' = group.snapshot.direction === '<' ? '>' : '<';
  return [
    { label: '回穿捕获门槛', rule: { metric: 'capture', direction, threshold: t } },
    { label: '缓冲 50% 门槛幅度', rule: { metric: 'capture', direction, threshold: t + (direction === '<' ? -1 : 1) * Math.abs(t) / 2 } },
    { label: '穿过零轴', rule: { metric: 'capture', direction, threshold: 0 } },
  ].map(v => ({ ...v, label: `${v.label}（${v.rule.direction} ${v.rule.threshold}）` }));
}

export const qualityFilterReadingKey = (row: QualitySample, f: QualityBuyFilter) => shortFishHash(JSON.stringify(['buy-filter', row.signalId ?? row.id, row.enteredAt, f.snapshot.definitionKey, f.metric, f.snapshot.interval]));
/** 某套卖出方案的买入过滤（含停用的）；方案没单独设过时沿用旧版本的全局过滤。 */
export const planBuyFilters = (study: FishQualityStudy, plan: QualityGroup | undefined): QualityBuyFilter[] => study.independentFilters ? [] : plan ? plan.buyFilters ?? study.buyFilters ?? [] : [];
/** 某套卖出方案启用中的买入过滤。 */
export const activeBuyFilters = (study: FishQualityStudy, plan: QualityGroup | undefined) => planBuyFilters(study, plan).filter(f => f.enabled && Number.isFinite(f.threshold));
/** 任何一套卖出方案开着买入过滤。 */
export const anyBuyFilters = (study: FishQualityStudy) => study.independentFilters ? activeStandaloneBuyFilters(study).length > 0 : (study.sellPlans ?? []).some(plan => activeBuyFilters(study, plan).length > 0);
/** Standalone catalog, also used to migrate all old plan-owned conditions without losing levels. */
export function standaloneBuyFilters(study: FishQualityStudy): QualityBuyFilter[] {
  if (study.independentFilters) return study.buyFilters ?? [];
  const filters = new Map<string, QualityBuyFilter>();
  for (const f of [...(study.buyFilters ?? []), ...(study.sellPlans ?? []).flatMap(p => p.buyFilters ?? [])]) {
    const key = JSON.stringify([f.snapshot.definitionKey,f.snapshot.interval,f.metric,f.direction,f.threshold]);
    const prior = filters.get(key);
    if (!prior || !prior.enabled && f.enabled) filters.set(key, f);
  }
  return [...filters.values()];
}
export const activeStandaloneBuyFilters = (study: FishQualityStudy) => standaloneBuyFilters(study).filter(f => f.enabled && Number.isFinite(f.threshold));
/** Call after archiving legacy trials. Re-running migration never overwrites later independent edits. */
export function separateQualityFilters(study: FishQualityStudy): FishQualityStudy {
  if (study.independentFilters) return study;
  return { ...study, independentFilters: true, buyFilters: structuredClone(standaloneBuyFilters(study)),
    legacyFilterBindings: (study.sellPlans ?? []).filter(p => p.buyFilters).map(p => ({planId:p.id,filters:structuredClone(p.buyFilters!)})),
    sellPlans: study.sellPlans?.map(({buyFilters: _legacy, ...plan}) => plan) };
}
/** Filters can run independently; no entry-price or sell simulation is needed without an exit. */
export const onlyQualityFilters = (study: FishQualityStudy) => anyBuyFilters(study) && !(study.sellPlans ?? []).some(hasQualityExit);
/** 把旧版本的全局过滤落到每套方案上（之后各改各的），并去掉全局那份。 */
export function materializePlanBuyFilters(study: FishQualityStudy): FishQualityStudy {
  if (study.independentFilters || !study.buyFilters) return study;
  const { buyFilters, ...rest } = study;
  return { ...rest, sellPlans: study.sellPlans?.map(plan => plan.buyFilters ? plan : { ...plan, buyFilters: structuredClone(buyFilters) }) };
}
export type QualityFilterStatus = { state: 'none' | 'pass' | 'fail' | 'pending' | 'error'; detail: string };
/** 一行在某套卖出方案下是否买入：没有启用的条件 = none；任一条件缺数据 = error；任一不满足 = fail；还没读数 = pending。 */
export function qualityFilterStatus(study: FishQualityStudy, row: QualitySample, plan: QualityGroup | undefined, readings: ReadonlyMap<string, QualityFilterReading> = new Map((study.filterReadings ?? []).map(r => [r.key, r]))): QualityFilterStatus {
  const filters = activeBuyFilters(study, plan);
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
    if (!hasQualityExit(group)) {
      // Enter now, but wait for a chosen exit experiment before loading the whole holding history.
      const bars = await load(row, entry, entry + QUALITY_MINUTE, pp, signal);
      validateFishBars(bars, entry + QUALITY_MINUTE, 1, QUALITY_MINUTE);
      return { ...base, status: 'waiting', entryTime: entry, entryPrice: bars[0].open, reason: '已登记买入，待选择卖出规则后评估收益' };
    }
    validateQualityMirror(group.mirrorTakeProfit);
    const prior = previous?.key === key && previous.status === 'open' && previous.entryPrice! > 0 && previous.endTime! >= entry && previous.endTime! <= end ? previous : undefined;
    const since = prior?.endTime ?? entry;
    if (since >= end && !prior?.pendingExit) return { ...prior!, evaluatedAt: now };
    let trigger: QualityTrigger | undefined = prior?.pendingExit;
    let replayedPrices: ResearchBar[] | undefined;
    let mirrorFill = prior?.mirrorFill;
    if (!trigger) {
      const rule = group.rule, combo = group.combo;
      if (rule && (!Number.isFinite(rule.threshold) || !['<', '>'].includes(rule.direction))) throw new Error('卖出规则无效');
      if (combo && (!rule || !(combo.switchPct > 0) || !Number.isFinite(combo.after.rule.threshold) || !['<', '>'].includes(combo.after.rule.direction))) throw new Error('组合卖出规则无效：前段、后段门槛与分水岭都要设置');
      const { plan, scale } = rule ? qualityMetricPlan(group.snapshot, rule.metric) : { plan: pp, scale: 1 };
      const vetoes=activeHoldingVetoes(group.holdingVetoes);
      vetoes.forEach(validateHoldingVeto);
      if (group.execution === 'intrabar-1m' || vetoes.length || group.mirrorTakeProfit?.enabled || combo) {
        let holding;
        // 组合卖出要跟踪最高价（判断是否已过分水岭），与回撤否决、镜像止盈共用同一条持仓路径
        if(vetoes.some(v=>v.kind!=='indicator') || group.mirrorTakeProfit?.enabled || combo) {
          const initial=prior?.entryPrice ? undefined : await load(row,entry,entry+QUALITY_MINUTE,pp,signal);
          if(initial)validateFishBars(initial,entry+QUALITY_MINUTE,1,QUALITY_MINUTE);
          const entryPrice=prior?.entryPrice??initial![0].open;
          holding={entry:entryPrice,peak:entryPrice*(1+(prior?.peakPct??0)/100),minimum:entryPrice*(1+(prior?.adversePct??0)/100),dynamic:prior?.drawdownPct??0};
        }
        const conditions:QualityIntrabarCondition[]=vetoes.filter(v=>v.kind==='indicator').map(v=>({...qualityMetricPlan(v.snapshot!,v.metric),rule:{direction:v.direction,threshold:v.threshold},cause:{id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold}}));
        if (combo) conditions.push({ ...qualityMetricPlan(combo.after.snapshot, combo.after.rule.metric), rule: { direction: combo.after.rule.direction, threshold: combo.after.rule.threshold }, stage: 'after' as const });
        const replay = await findQualityIntrabarExit({ row,plan,scale,rule,entry,since,end,resumed:!!prior,load,signal,conditions,vetoes,holding,mirror:group.mirrorTakeProfit,mirrorFill,ruleCloseOnly:group.execution!=='intrabar-1m' && !vetoes.length && !combo,
          ...(combo ? { ruleStage: 'before' as const, switchPct: combo.switchPct } : {}) });
        trigger = replay.trigger; replayedPrices = replay.prices; mirrorFill = replay.mirrorFill;
      } else if (rule) {
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
    // 回撤止损盘中触及：按止损价成交；其余按卖出分钟的开盘价
    const stopFill = closed && trigger?.fillPrice != null ? trigger.fillPrice : undefined;
    const finalPrice = closed ? stopFill ?? exitBar!.open : prices.at(-1)!.close;
    const held = prices.filter(b => b.openTime < finalTime);
    const klines = held.map(b => ({ time: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const args = { klines, startMs: since, endMs: finalTime - 1, barMs: QUALITY_MINUTE };
    const priceReturnPct = (finalPrice / entryPrice - 1) * 100;
    const breakdown = mirrorPnlBreakdown(QUALITY_NOTIONAL, entryPrice, finalPrice, mirrorFill);
    const returnPct = breakdown.returnPct;
    let peakPct = Math.max(prior?.peakPct ?? 0, priceReturnPct);
    for (let i = 0; i < klines.length; i += 5000) peakPct = Math.max(peakPct, computePeakPriceChangePct({ ...args, klines: klines.slice(i, i + 5000), side: 'long', entryPrice }) ?? 0);
    // The exit open itself is observable and belongs to the holding path; the rest of the exit candle does not.
    const previousPeak = entryPrice * (1 + (prior?.peakPct ?? 0) / 100);
    // 止损在卖出分钟盘中成交时，算止损价用到的峰值（这一分钟的开盘或新高）排在持仓路径最后
    const fillPeak = stopFill != null ? trigger!.fillPeak ?? exitBar!.open : 0;
    if (fillPeak) peakPct = Math.max(peakPct, (fillPeak / entryPrice - 1) * 100);
    let peak = previousPeak, exitDrawdown = 0;
    for (const b of held) peak = Math.max(peak, b.high);
    peak = Math.max(peak, fillPeak);
    exitDrawdown = Math.max(0, (peak - finalPrice) / peak * 100);
    const low = held.reduce((minimum, b) => Math.min(minimum, b.low), Math.min(entryPrice * (1 + (prior?.adversePct ?? 0) / 100), finalPrice));
    let vetoDynamic=0;
    if(activeHoldingVetoes(group.holdingVetoes).length) {
      let path={entry:entryPrice,peak:previousPeak,minimum:entryPrice*(1+(prior?.adversePct??0)/100),dynamic:prior?.drawdownPct??0};
      for(const b of held)path=advanceQualityHolding(path,b);
      const top=Math.max(path.peak,finalPrice,fillPeak);
      vetoDynamic=Math.max(path.dynamic,0,(top-finalPrice)/top*100);
    }
    const drawdownBars = prior ? [{ time: since - QUALITY_MINUTE, open: previousPeak, high: previousPeak, low: previousPeak, close: previousPeak, volume: 0 }, ...klines] : klines;
    return { ...base, status: closed ? 'closed' : 'open', entryTime: entry, entryPrice, endTime: finalTime, endPrice: finalPrice,
      ...(mirrorFill ? {mirrorFill,remainingFraction:closed?0:1-mirrorFill.fraction,mirrorRealizedPnl:breakdown.mirrorPnl,remainingPnl:breakdown.remainingPnl,initialNotional:QUALITY_NOTIONAL,realizedPnl:breakdown.mirrorPnl+(closed?breakdown.remainingPnl:0)} : {}),
      returnPct, pnl: breakdown.totalPnl, peakPct, adversePct: (low / entryPrice - 1) * 100,
      drawdownPct: Math.max(prior?.drawdownPct ?? 0, exitDrawdown, vetoDynamic, computeHoldingDynamicMaxDrawdownPct({ ...args, klines: drawdownBars, startMs: prior ? since - QUALITY_MINUTE : since }) ?? 0), uncapturedPct: peakPct - returnPct,
      heldHours: (finalTime - entry) / 3_600_000, complete: closed || end >= limit && !trigger,
      exitReading: closed ? trigger!.reading : undefined,
      pendingExit: !closed ? trigger : undefined,
      exitSnapshot: trigger?.barOpenTime != null ? {barOpenTime:trigger.barOpenTime,observedAt:trigger.at,previous:trigger.previous,cause:trigger.cause,atOpen:trigger.atOpen,...(trigger.stage ? { stage: trigger.stage } : {})} : undefined,
      reason: closed && trigger?.cause?.kind === 'mirror-take-profit' ? '镜像止盈：全部币数已按止盈价卖出' : closed && !trigger?.cause && trigger?.stage && group.combo ? (trigger.stage === 'after'
        ? `组合卖出：涨幅已达 ${group.combo.switchPct}%，按 ${group.combo.after.label} ${group.combo.after.rule.direction} ${group.combo.after.rule.threshold} 盘中复原达标，下一分钟开盘卖出`
        : `组合卖出：涨幅未达 ${group.combo.switchPct}%，按 ${group.combo.beforeLabel} ${group.rule!.direction} ${group.rule!.threshold} 盘中复原达标，下一分钟开盘卖出`)
        : closed && trigger?.cause ? `一票否决：${trigger.cause.label} ${trigger.cause.direction} ${trigger.cause.threshold}${trigger.cause.kind==='indicator'?'':'%'}；${trigger.atOpen?'开盘跳空越线，按当分钟开盘价卖出':stopFill != null?'盘中触及止损价，按止损价卖出':'按下一分钟开盘价卖出'}` : closed ? group.execution === 'intrabar-1m' ? '盘中指标按已完成分钟复原，首次达标时按下一分钟开盘价卖出' : '指标收盘确认，下一分钟开盘卖出' : trigger ? '指标已触发，等待下一分钟开盘数据' : end < limit ? mirrorFill ? `镜像止盈已卖出初始币数 ${mirrorFill.fraction * 100}%，剩余 ${(1 - mirrorFill.fraction) * 100}% 持有中` : '持有中' : '观察期结束仍持有，记录期末浮盈' };
  } catch (error) {
    abort(signal);
    return { ...base, status: 'error', reason: error instanceof Error ? error.message : '行情读取失败' };
  }
}
export interface QualityProgress { done: number; total: number; current: string }
export interface QualityRunOptions {
  study: FishQualityStudy; signal: AbortSignal; onProgress: (p: QualityProgress) => void; onResult: (r: QualityResult) => void;
  /** Filter modes reuse saved trades; restart replays selected sell experiments from entry, including completed results. */
  mode?: 'filter' | 'filter-only' | 'restart';
  /** Independent UI tasks; filtering never evaluates exits. Legacy callers retain automatic filter-only behavior. */
  task?: 'filter' | 'monitor';
  /** 当前界面上的行顺序（看得见的在前）。每算完一条都重新读取，换筛选 / 排序 / 滚动后先算新露出来的行。 */
  priority?: () => readonly string[];
  /** 买入过滤的读数（每行每个条件算一次）。 */
  onFilterReading?: (r: QualityFilterReading) => void;
}
/** A threshold/direction/toggle edit with cached readings and trades needs no runner or market requests. */
export function qualityFilterNeedsData(study: FishQualityStudy, mode: 'filter' | 'filter-only'): boolean {
  if (study.independentFilters && mode === 'filter-only') {
    const readings = new Map((study.filterReadings ?? []).filter(r=>!r.error && Number.isFinite(r.value)).map(r=>[r.key,r]));
    return qualityRunSamples(study).some(row=>activeStandaloneBuyFilters(study).some(f=>!readings.has(qualityFilterReadingKey(row,f))));
  }
  const filtersOnly = onlyQualityFilters(study);
  const readings = new Map((study.filterReadings ?? []).map(r => [r.key, r]));
  const results = new Set(study.results.map(r => r.key));
  for (const row of qualityRunSamples(study)) for (const plan of study.sellPlans ?? []) {
    if (activeBuyFilters(study, plan).some(f => !readings.has(qualityFilterReadingKey(row, f)))) return true;
    const state = qualityFilterStatus(study, row, plan, readings).state;
    if (mode === 'filter' && !filtersOnly && (state === 'none' || state === 'pass' || plan.id === study.selectedSellId) && !results.has(qualityResultKey(row, plan, study.observeHours))) return true;
  }
  return false;
}
export async function collectFishQuality(options: QualityRunOptions, load: FishReconstructionLoader, now: number): Promise<void> {
  if (options.study.independentFilters && (options.task === 'filter' || options.mode === 'filter-only' || options.task !== 'monitor' && onlyQualityFilters(options.study))) {
    const {study,signal} = options, filters = activeStandaloneBuyFilters(study);
    const rows = new Map(qualityRunSamples(study).map(row => [row.id,row]));
    const total = rows.size, readings = new Map((study.filterReadings ?? []).filter(r => !r.error && Number.isFinite(r.value)).map(r=>[r.key,r]));
    let done = 0;
    while (rows.size) {
      abort(signal);
      const id = options.priority?.().find(id=>rows.has(id)) ?? rows.keys().next().value!;
      const row = rows.get(id)!; rows.delete(id);
      options.onProgress({done,total,current:row.source.symbol});
      for (const f of filters) {
        const key = qualityFilterReadingKey(row,f);
        if (readings.has(key)) continue;
        const reading = await evaluateQualityFilter(row,f,now,load,signal);
        abort(signal); readings.set(key,reading); options.onFilterReading?.(reading);
      }
      done++;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    options.onProgress({done,total,current:''}); return;
  }
  const { study, signal } = options, previous = new Map<string, QualityResult>(options.mode === 'restart' ? [] : study.results.map(r => [r.key, r]));
  const filtersOnly = options.task === 'filter' || options.task !== 'monitor' && onlyQualityFilters(study);
  const tasks = study.sellPlans
    ? qualityRunSamples(study).flatMap(s => qualityRunGroups(study).map(g => ({ s, g })))
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
  // 买入过滤（每套卖出方案各自一套）：先读买入时刻的指标，这套方案下不满足（或缺数据）的行不再按它评估卖出；之后放宽门槛会补算
  const readings = new Map((study.filterReadings ?? []).filter(r => options.mode !== 'restart' || !r.error && Number.isFinite(r.value)).map(r => [r.key, r]));
  const passes = async (row: QualitySample, plan: QualityGroup) => {
    const filters = study.sellPlans ? activeBuyFilters(study, plan) : [];
    if (!filters.length) return true;
    for (const f of filters) {
      const key = qualityFilterReadingKey(row, f);
      if (!readings.has(key)) { abort(signal); const r = await evaluateQualityFilter(row, f, now, load, signal); readings.set(key, r); options.onFilterReading?.(r); }
    }
    const state = qualityFilterStatus(study, row, plan, readings).state;
    return state === 'none' || state === 'pass';
  };
  let done = 0;
  for (let batch = next(); batch; batch = next()) {
    // 买入过滤只作用于比较卖出：没买入的行仍按「比较探测」固定的那套卖出方案评估
    const kept: typeof batch = [];
    for (const task of batch) { const bought = await passes(task.s, task.g); if (task.g.id === study.selectedSellId || bought) kept.push(task); }
    if (kept.length < batch.length) { done += batch.length - kept.length; options.onProgress({ done, total: tasks.length, current: '' }); }
    batch = kept; if (!batch.length) continue;
    for (const { s, g } of batch) {
    abort(signal);
    options.onProgress({ done, total: tasks.length, current: `${s.source.symbol} · ${g.label}` });
    const cached = previous.get(qualityResultKey(s, g, study.observeHours));
    if (filtersOnly || options.mode === 'filter-only' || options.mode === 'filter' && cached) { done++; continue; }
    const finished = cached?.complete || cached?.status === 'closed' && Number.isFinite(cached.returnPct);
    if (!finished && !(!hasQualityExit(g) && cached?.status === 'waiting' && cached.entryPrice! > 0)) options.onResult(await evaluateQualitySample(s, g, study.observeHours, now, load, signal, cached));
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
