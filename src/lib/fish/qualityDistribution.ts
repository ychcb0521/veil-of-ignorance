import { qualityPairedRows, qualityPlanBought, qualityPlanRows, qualityResultMap, qualityRowResult } from './qualityComparison';
import { anyBuyFilters, type FishQualityStudy, type QualitySample } from './quality';

export type QualityDistributionMetric = 'returnPct' | 'peakPct';
export interface QualityDistributionSeries { id: string; label: string; values: number[] }
export function qualityDistributionSeries(study: FishQualityStudy, rows: QualitySample[], phase: 'sell' | 'detect', closedOnly: boolean, metric: QualityDistributionMetric): QualityDistributionSeries[] {
  const results = qualityResultMap(study), plans = (study.sellPlans ?? []).filter(plan => plan.rule);
  const signals = [...new Map(rows.map(row => [row.signalId ?? row.id, row])).values()];
  const usable = (row: QualitySample, plan: typeof plans[number]) => {
    const result = qualityRowResult(study, row, plan, results);
    return result && (result.status === 'closed' || !closedOnly && result.status === 'open') && Number.isFinite(result[metric]);
  };
  const label = (plan: typeof plans[number]) => `${plan.label} ${plan.rule!.direction} ${plan.rule!.threshold}`;
  if (phase === 'sell') {
    // 各方案买入过滤不同：每套方案只画它自己买入的信号
    if (anyBuyFilters(study)) return plans.map(plan => ({ id: plan.id, label: label(plan), values: qualityPlanRows(study, qualityPlanBought(study, signals, plan), plan, closedOnly).filter(row => usable(row, plan)).map(row => qualityRowResult(study, row, plan, results)![metric]!) }));
    const paired = (plans.length > 1 ? qualityPairedRows(study, signals, closedOnly) : signals).filter(row => plans.every(plan => usable(row, plan)));
    return plans.map(plan => ({ id: plan.id, label: label(plan), values: paired.map(row => qualityRowResult(study, row, plan, results)![metric]!) }));
  }
  const plan = plans.find(item => item.id === study.selectedSellId);
  if (!plan) return [];
  return study.groups.flatMap(group => {
    const selected = [...new Map(rows.filter(row => row.groups.includes(group.id)).map(row => [row.signalId ?? row.id, row])).values()];
    if (!selected.length) return [];
    return [{ id: group.id, label: `${group.label} ${group.snapshot.direction ?? '>'} ${group.snapshot.threshold}`, values: selected.filter(row => usable(row, plan)).map(row => qualityRowResult(study, row, plan, results)![metric]!) }];
  });
}
/** Shared, equal-width bins include every finite observation, including long tails and the maximum edge. */
export function qualityHistogram(series: QualityDistributionSeries[]) {
  const values = series.flatMap(s => s.values).filter(Number.isFinite);
  if (!values.length) return null;
  const low = values.reduce((min, v) => Math.min(min, v), 0), high = values.reduce((max, v) => Math.max(max, v), 0), range = high - low || 2;
  const raw = range / 12, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find(n => n * power >= raw)! * power;
  const min = Math.floor((low === high ? low - 1 : low) / step) * step;
  const count = Math.max(1, Math.ceil(((low === high ? high + 1 : high) - min) / step)), max = min + count * step;
  const plots = series.map(s => {
    const sorted = s.values.filter(Number.isFinite).sort((a, b) => a - b), bins = Array<number>(count).fill(0);
    sorted.forEach(value => bins[Math.max(0, Math.min(count - 1, Math.floor((value - min) / step)))]++);
    const n = sorted.length, mid = Math.floor(n / 2);
    return { ...s, n, bins, mean: n ? sorted.reduce((sum, v) => sum + v, 0) / n : null, median: n ? n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 : null };
  });
  const top = Math.max(.1, ...plots.flatMap(s => s.bins.map(n => s.n ? n / s.n : 0)));
  return { min, max, step, count, top, plots };
}
