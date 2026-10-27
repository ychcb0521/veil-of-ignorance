/** Two-stage comparisons use one entry per fish and a common set of sell experiments. */
import { STATE_DEF, CDA_DEF, definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { accountFeatureDefs } from '@/lib/featureSource';
import { activeBuyFilters, anyBuyFilters, hasQualityExit, qualityComparisonRows, qualityFilterStatus, qualityResultKey, type FishQualityStudy, type QualityGroup, type QualityResult, type QualitySample } from './quality';

export function enableQualityComparison(study: FishQualityStudy, definitions = accountFeatureDefs()): FishQualityStudy {
  if (study.sellPlans) return study;
  const sellPlans: QualityGroup[] = [
    { def: STATE_DEF, metric: 'state', label: '状态 S 原始值', threshold: .5 },
    { def: CDA_DEF, metric: 'CDA', label: 'CDA 原始值', threshold: -8 },
  ].map(({ def: builtin, metric, label, threshold }) => {
    const def = definitions.find(d => d.id === builtin.id) ?? builtin;
    return { id: `sell-${def.id}-raw`, label, metric, definitionSource: 'account' as const, execution: 'intrabar-1m' as const, vetoFill: 'stop' as const,
    snapshot: { featureId: def.id, featureShort: def.short, featureName: def.name, definitionKey: definitionKey({ ...def, interval: '5m' }),
      statistic: metric, interval: '5m', scale: 1, unit: '', threshold, direction: '<',
      cutoffMs: 0, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 },
  }; });
  return { ...study, sellPlans };
}
/** Refresh only the active experiments. Callers archive existing results BEFORE changing definitions. */
export function syncQualitySellDefinitions(study: FishQualityStudy, definitions: readonly DeepDigFeatureDef[] = accountFeatureDefs()): FishQualityStudy {
  let changed = false;
  const sellPlans = study.sellPlans?.map(plan => {
    // 回撤否决改为止损价成交（2026-10-26）：同步时给方案打上新版本，旧试验已在调用方先归档
    if (plan.vetoFill !== 'stop') { changed = true; plan = { ...plan, vetoFill: 'stop' as const }; }
    const builtin = [STATE_DEF, CDA_DEF].find(d => d.id === plan.snapshot.featureId);
    if (!builtin) return plan;
    // Same fallback as charts: a hidden built-in still has its built-in definition.
    const def = definitions.find(d => d.id === builtin.id) ?? builtin;
    const key = definitionKey({ ...def, interval: '5m' });
    if (plan.snapshot.definitionKey === key && plan.snapshot.interval === '5m' && plan.definitionSource === 'account' && plan.execution === 'intrabar-1m') return plan;
    changed = true;
    return { ...plan, definitionSource: 'account' as const, execution:'intrabar-1m' as const, snapshot: { ...plan.snapshot,
      definitionKey: key, interval: '5m' as const, scale: 1, statistic: plan.metric, H: undefined,
      featureName: def.name, featureShort: def.short,
    } };
  });
  return changed ? { ...study, sellPlans } : study;
}
export const qualitySellSuggestions = (plan: QualityGroup) => plan.snapshot.featureId === 'state' ? [.5, .45, .4] : [0, -8, -15];
export function qualityResultMap(study: FishQualityStudy) { return new Map(study.results.map(r => [r.key, r])); }
export const qualityRowResult = (study: FishQualityStudy, row: QualitySample, plan: QualityGroup, results = qualityResultMap(study)) => results.get(qualityResultKey(row, plan, study.observeHours));
export function qualityBatchRows(study: FishQualityStudy): QualitySample[] {
  return qualityComparisonRows(study);
}
const usable = (r: QualityResult | undefined, closedOnly: boolean): r is QualityResult => !!r && Number.isFinite(r.returnPct) && (r.status === 'closed' || !closedOnly && r.status === 'open');
/** Identical rows and identical current valuation for unfinished positions, never independent missing-data denominators. */
export function qualityPairedRows(study: FishQualityStudy, rows: QualitySample[], closedOnly: boolean): QualitySample[] {
  const plans = (study.sellPlans ?? []).filter(hasQualityExit), results = qualityResultMap(study);
  if (!plans.length) return [];
  const latest = study.results.reduce((time, r) => plans.some(p => p.id === r.groupId) ? Math.max(time, r.evaluatedAt) : time, 0);
  const signals = [...new Map(rows.map(row => [row.signalId ?? row.id, row])).values()];
  return signals.filter(row => plans.every(plan => {
    const r = qualityRowResult(study, row, plan, results);
    return usable(r, closedOnly) && (closedOnly || r.status === 'closed' || r.complete || r.evaluatedAt === latest);
  }));
}
/**
 * 一套卖出方案自己的有效样本（各方案买入过滤不同时用）：这套方案下有收益的信号；未完成的持仓只取最近一次一起估值的那批。
 */
export function qualityPlanRows(study: FishQualityStudy, rows: QualitySample[], plan: QualityGroup, closedOnly: boolean): QualitySample[] {
  if (!hasQualityExit(plan)) return [];
  const results = qualityResultMap(study);
  const latest = study.results.reduce((time, r) => r.groupId === plan.id ? Math.max(time, r.evaluatedAt) : time, 0);
  const signals = [...new Map(rows.map(row => [row.signalId ?? row.id, row])).values()];
  return signals.filter(row => { const r = qualityRowResult(study, row, plan, results); return usable(r, closedOnly) && (closedOnly || r.status === 'closed' || r.complete || r.evaluatedAt === latest); });
}
/** 某套卖出方案买入的信号：没开过滤 = 全部；开了 = 只有满足它全部条件的。 */
export function qualityPlanBought(study: FishQualityStudy, rows: QualitySample[], plan: QualityGroup, readings = new Map((study.filterReadings ?? []).map(r => [r.key, r]))): QualitySample[] {
  if (!activeBuyFilters(study, plan).length) return rows;
  return rows.filter(row => qualityFilterStatus(study, row, plan, readings).state === 'pass');
}
export const QUALITY_BINS = ['< −10%', '−10～−5%', '−5～0%', '0～5%', '5～10%', '≥ 10%'];
export function qualityDistribution(results: readonly QualityResult[]) {
  const valid = results.filter(r => usable(r, false)), values = valid.map(r => r.returnPct!).sort((a, b) => a - b);
  const n = values.length, sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
  const quantile = (q: number) => { if (!n) return null; const i = (n - 1) * q, a = Math.floor(i), b = Math.ceil(i); return values[a] + (values[b] - values[a]) * (i - a); };
  const bins = Array(6).fill(0) as number[];
  for (const v of values) bins[v < -10 ? 0 : v < -5 ? 1 : v < 0 ? 2 : v < 5 ? 3 : v < 10 ? 4 : 5]++;
  return { n, bins, closed: valid.filter(r => r.status === 'closed').length,
    mean: n ? sum(values) / n : null, median: quantile(.5), p10: quantile(.1), worst: n ? values[0] : null,
    winRate: n ? values.filter(v => v > 0).length / n * 100 : null,
    lossRate: n ? values.filter(v => v < 0).length / n * 100 : null,
    meanPeak: valid.some(r => Number.isFinite(r.peakPct)) ? sum(valid.filter(r => Number.isFinite(r.peakPct)).map(r => r.peakPct!)) / valid.filter(r => Number.isFinite(r.peakPct)).length : null,
  };
}
export function qualityComparisonStats(study: FishQualityStudy, rows: QualitySample[], closedOnly: boolean) {
  const plans = study.sellPlans ?? [], results = qualityResultMap(study);
  // 买入过滤只作用于比较卖出，且每套卖出方案各自一套：不满足、缺数据、还没读数的信号不进这套方案的统计
  const filterOn = !study.independentFilters && anyBuyFilters(study), readings = new Map((study.filterReadings ?? []).map(r => [r.key, r]));
  const signals = [...new Map(rows.map(row => [row.signalId ?? row.id, row])).values()];
  const planFilters = plans.map(plan => {
    const on = activeBuyFilters(study, plan).length > 0, states = on ? signals.map(row => qualityFilterStatus(study, row, plan, readings).state) : [];
    const count = (state: string) => states.filter(v => v === state).length;
    return { plan, on, passed: count('pass'), failed: count('fail'), pending: count('pending'), error: count('error'), bought: on ? signals.filter((_, i) => states[i] === 'pass') : signals };
  });
  const filter = { on: filterOn, plans: planFilters.map(({ bought: _bought, ...rest }) => rest) };
  // 没有方案开过滤：各方案用同一批共同有效样本（同批对照）；开了：各方案只在自己买入的信号里统计
  const paired = filterOn ? [] : qualityPairedRows(study, rows, closedOnly);
  const selected = plans.find(p => p.id === study.selectedSellId && hasQualityExit(p));
  const sells = plans.map((plan, i) => { const sample = filterOn ? qualityPlanRows(study, planFilters[i].bought, plan, closedOnly) : paired;
    return { plan, sample, ...qualityDistribution(sample.map(row => qualityRowResult(study, row, plan, results)!)) }; });
  const detectors = study.groups.map(group => {
    const caught = rows.filter(r => r.groups.includes(group.id));
    const valid = selected ? caught.map(row => qualityRowResult(study, row, selected, results)).filter(r => usable(r, closedOnly)) : [];
    return { group, total: caught.length, ...qualityDistribution(valid) };
  });
  return { paired, sells, detectors, selected, filter };
}
