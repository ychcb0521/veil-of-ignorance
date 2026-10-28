import { mirrorLabel } from './qualityMirror';
import { qualityTradeHours } from './qualityStatisticsMath';
export { qualityTradeHours, qualityStatisticsEstimate, qualityStatisticsInference, type QualityInferenceMetric, type QualityInferenceRow } from './qualityStatisticsMath';
import { activeHoldingVetoes } from './qualityVeto';
import { qualityResultMap, qualityRowResult } from './qualityComparison';
import { qualityFilterColumns, qualityFilterValue } from './qualityFilterColumns';
import { qualityVariables, qualityVariableKey, qualityLevelText } from './qualityVariables';
import { activeBuyFilters, hasQualityExit, qualityDrawdownPct, qualityFilterStatus, type FishQualityStudy, type QualityGroup, type QualityResult, type QualitySample } from './quality';

export type QualityStatisticsCategory = 'sell' | 'detect' | 'filter';
export interface QualityStatisticTrade { id: string; cluster: string; result: QualityResult; sellType: string }
export interface QualityStatisticSeries {
  id: string; variableId: string; variable: string; level: string; context: string;
  trades: QualityStatisticTrade[];
  excluded: { filtered: number; pendingFilter: number; open: number; waiting: number; error: number; invalidReturn: number };
}
export const QUALITY_STATIC_CUTS = [5, 8, 10] as const;
const finite = (n: number | undefined | null): n is number => n != null && Number.isFinite(n);
const average = (values: readonly number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
export function qualitySellType(result: QualityResult, plan: QualityGroup): string {
  const cause = result.exitSnapshot?.cause;
  if (cause) return ({ 'static-drawdown': '静态回撤止损', 'dynamic-drawdown': '动态回撤止损', 'drop-1m': '1分钟跌幅卖出', 'drop-5m': '5分钟跌幅卖出', 'mirror-take-profit':'镜像止盈', indicator: `指标否决 · ${cause.label}` })[cause.kind] ?? '触发原因未记录';
  // A recorded exit with no veto cause is an ordinary exit. Unrecorded legacy causes stay unknown.
  return result.exitSnapshot || !activeHoldingVetoes(plan.holdingVetoes).length ? '算法条件卖出' : '触发原因未记录';
}
/** Entering a filter level starts with its owning seller, including when another seller was previously fixed. */
export function qualityStatisticsDefaultSell(study: FishQualityStudy, category: QualityStatisticsCategory, levelId?: string) {
  const plans = study.sellPlans ?? [], column = category === 'filter' && levelId ? qualityFilterColumns(study).find(c => c.id === levelId) : undefined;
  const owners = column && !study.independentFilters ? plans.filter(p => activeBuyFilters(study, p).some(f => qualityVariableKey(f.snapshot, f.metric) === qualityVariableKey(column.filter.snapshot, column.filter.metric) && f.direction === column.filter.direction && f.threshold === column.filter.threshold)) : plans;
  return (owners.find(p => p.id === study.selectedSellId) ?? owners[0] ?? plans[0])?.id ?? '';
}
export function qualityStatisticsSeries(study: FishQualityStudy, rows: readonly QualitySample[], category: QualityStatisticsCategory, fixedSellId?: string): QualityStatisticSeries[] {
  const results = qualityResultMap(study), readings = new Map((study.filterReadings ?? []).map(r => [r.key, r]));
  const plans = study.sellPlans ?? [], fixed = plans.find(p => p.id === fixedSellId) ?? plans.find(p => p.id === study.selectedSellId) ?? plans[0];
  const build = (plan: QualityGroup, subset: readonly QualitySample[], identity: Omit<QualityStatisticSeries, 'trades' | 'excluded'>): QualityStatisticSeries => {
    const series: QualityStatisticSeries = { ...identity, trades: [], excluded: { filtered: 0, pendingFilter: 0, open: 0, waiting: 0, error: 0, invalidReturn: 0 } };
    const seen = new Set<string>();
    for (const row of subset) {
      const id = row.signalId ?? row.id;
      if (seen.has(id)) continue;
      seen.add(id);
      if (activeBuyFilters(study, plan).length) {
        const status = qualityFilterStatus(study, row, plan, readings).state;
        if (status !== 'pass') { series.excluded[status === 'fail' ? 'filtered' : 'pendingFilter']++; continue; }
      }
      const result = qualityRowResult(study, row, plan, results);
      if (!hasQualityExit(plan) || !result || result.status === 'waiting') { series.excluded.waiting++; continue; }
      if (result.status !== 'closed') { series.excluded[result.status]++; continue; }
      if (!finite(result.returnPct)) { series.excluded.invalidReturn++; continue; }
      series.trades.push({ id, result, cluster: `${row.source.market ?? 'crypto'}|${row.source.exchange ?? 'binance'}|${row.source.symbol}`, sellType: qualitySellType(result, plan) });
    }
    return series;
  };
  if (category === 'sell') return plans.map(plan => build(plan, rows, {
    id: plan.id, variableId: qualityVariableKey(plan.snapshot, plan.metric), variable: plan.label,
    level: plan.rule ? `${plan.rule.direction} ${plan.rule.threshold}` : plan.mirrorTakeProfit?.enabled ? '镜像止盈' : '仅持仓否决 / 未设条件',
    context: `${plan.snapshot.interval ?? '5m'} · ${plan.execution === 'intrabar-1m' ? '盘中复原' : '收盘确认'} · 买入过滤 ${activeBuyFilters(study, plan).length} 条 · 持仓否决 ${activeHoldingVetoes(plan.holdingVetoes).length} 条${mirrorLabel(plan.mirrorTakeProfit) ? ` · ${mirrorLabel(plan.mirrorTakeProfit)}` : ''}`,
  }));
  if (!fixed) return [];
  if (category === 'detect') return qualityVariables(study.groups).flatMap(variable => variable.levels.map(group => build(fixed, rows.filter(row => row.detectorId ? row.detectorId === group.id : row.groups.includes(group.id)), {
    id: group.id, variableId: variable.id, variable: variable.label, level: qualityLevelText(group),
    context: `固定卖出：${fixed.label} · ${fixed.rule ? qualityLevelText(fixed) : '仅持仓否决 / 未设条件'}${mirrorLabel(fixed.mirrorTakeProfit) ? ` · ${mirrorLabel(fixed.mirrorTakeProfit)}` : ''} · ${group.snapshot.interval ?? '5m'}${group.snapshot.constraints?.length ? ` · 附加约束 ${group.snapshot.constraints.length} 条` : ''}`,
  })));
  return qualityFilterColumns(study).map(column => {
    const filter = column.filter;
    const subset = rows.filter(row => { const value = qualityFilterValue(row, filter, readings); return value != null && (filter.direction === '>' ? value > filter.threshold : value < filter.threshold); });
    const series = build(fixed, subset, { id: column.id, variableId: qualityVariableKey(filter.snapshot, filter.metric), variable: filter.label, level: qualityLevelText(filter), context: `固定卖出：${fixed.label} · ${fixed.rule ? qualityLevelText(fixed) : '仅持仓否决 / 未设条件'}${mirrorLabel(fixed.mirrorTakeProfit) ? ` · ${mirrorLabel(fixed.mirrorTakeProfit)}` : ''}；按本条件满足的记录分组${study.independentFilters ? '，不限制独立监测' : '，仍遵守该卖出方案全部买入条件'}` });
    // Count filter exclusions by unique entry, not expanded detector rows.
    const unique = [...new Map(rows.map(row => [row.signalId ?? row.id, row])).values()];
    const missing = unique.filter(row => qualityFilterValue(row, filter, readings) == null).length;
    const rejected = unique.filter(row => { const v = qualityFilterValue(row, filter, readings); return v != null && !(filter.direction === '>' ? v > filter.threshold : v < filter.threshold); }).length;
    series.excluded.pendingFilter += missing; series.excluded.filtered += rejected;
    return series;
  });
}
export const qualityMagnitudeBins = ['(0, 1)%', '[1, 3)%', '[3, 5)%', '[5, 10)%', '[10, 20)%', '≥20%'];
export function qualityOutcomeSummary(trades: readonly QualityStatisticTrade[], sign: 'profit' | 'loss') {
  const selected = trades.filter(t => sign === 'profit' ? t.result.returnPct! > 0 : t.result.returnPct! < 0);
  const magnitudes = selected.map(t => Math.abs(t.result.returnPct!)), hours = selected.map(t => qualityTradeHours(t.result)).filter(finite);
  const bins = qualityMagnitudeBins.map(label => ({ label, n: 0 }));
  for (const v of magnitudes) bins[v < 1 ? 0 : v < 3 ? 1 : v < 5 ? 2 : v < 10 ? 3 : v < 20 ? 4 : 5].n++;
  return { n: selected.length, mean: average(magnitudes), held: average(hours), heldN: hours.length, bins };
}
export function qualityCohortSummary(trades: readonly QualityStatisticTrade[], staticLimit?: number) {
  const eligible = staticLimit == null ? [...trades] : trades.filter(t => { const dd = qualityDrawdownPct(t.result, 'static'); return dd != null && dd <= staticLimit; });
  const values = eligible.map(t => t.result.returnPct!).sort((a, b) => a - b), mean = average(values);
  const q = (p: number) => { if (!values.length) return null; const i = (values.length - 1) * p, low = Math.floor(i); return values[low] + (values[Math.ceil(i)] - values[low]) * (i - low); };
  const n = eligible.length, profit = qualityOutcomeSummary(eligible, 'profit'), loss = qualityOutcomeSummary(eligible, 'loss');
  return { trades: eligible, n, profit, loss, flat: n - profit.n - loss.n, winRate: n ? profit.n / n * 100 : null, mean, median: q(.5), q1: q(.25), q3: q(.75),
    sd: values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean!) ** 2, 0) / (values.length - 1)) : null,
    missingDrawdown: trades.filter(t => qualityDrawdownPct(t.result, 'static') == null).length,
    sellTypes: [...eligible.reduce((map, t) => map.set(t.sellType, (map.get(t.sellType) ?? 0) + 1), new Map<string, number>())].map(([label, count]) => ({ label, n: count })),
  };
}

