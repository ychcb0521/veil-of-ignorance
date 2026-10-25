/** Two-stage comparisons use one entry per fish and a common set of sell experiments. */
import { STATE_DEF, CDA_DEF, definitionKey } from '@/lib/deepDig/features';
import { qualityComparisonRows, qualityResultKey, type FishQualityStudy, type QualityGroup, type QualityResult, type QualitySample } from './quality';

export function enableQualityComparison(study: FishQualityStudy): FishQualityStudy {
  if (study.sellPlans) return study;
  const sellPlans: QualityGroup[] = [
    { def: STATE_DEF, metric: 'state', label: '状态 S 原始值', threshold: .5 },
    { def: CDA_DEF, metric: 'CDA', label: 'CDA 原始值', threshold: -8 },
  ].map(({ def, metric, label, threshold }) => ({ id: `sell-${def.id}-raw`, label, metric,
    snapshot: { featureId: def.id, featureShort: def.short, featureName: def.name, definitionKey: definitionKey({ ...def, interval: '5m' }),
      statistic: metric, interval: '5m', scale: 1, unit: '', threshold, direction: '<',
      cutoffMs: 0, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 },
  }));
  return { ...study, sellPlans };
}
export const qualitySellSuggestions = (plan: QualityGroup) => plan.snapshot.featureId === 'state' ? [.5, .45, .4] : [0, -8, -15];
export function qualityResultMap(study: FishQualityStudy) { return new Map(study.results.map(r => [r.key, r])); }
export const qualityRowResult = (study: FishQualityStudy, row: QualitySample, plan: QualityGroup, results = qualityResultMap(study)) => results.get(qualityResultKey(row, plan, study.observeHours));
export function qualityBatchRows(study: FishQualityStudy): QualitySample[] {
  return qualityComparisonRows(study).filter(row => !study.cohortIds || study.cohortIds.includes(row.id));
}
const usable = (r: QualityResult | undefined, closedOnly: boolean): r is QualityResult => !!r && Number.isFinite(r.returnPct) && (r.status === 'closed' || !closedOnly && r.status === 'open');
/** Identical rows and identical current valuation for unfinished positions, never independent missing-data denominators. */
export function qualityPairedRows(study: FishQualityStudy, rows: QualitySample[], closedOnly: boolean): QualitySample[] {
  const plans = study.sellPlans ?? [], results = qualityResultMap(study);
  if (plans.length < 2 || plans.some(p => !p.rule)) return [];
  const latest = study.results.reduce((time, r) => plans.some(p => p.id === r.groupId) ? Math.max(time, r.evaluatedAt) : time, 0);
  return rows.filter(row => plans.every(plan => {
    const r = qualityRowResult(study, row, plan, results);
    return usable(r, closedOnly) && (closedOnly || r.status === 'closed' || r.complete || r.evaluatedAt === latest);
  }));
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
  const plans = study.sellPlans ?? [], results = qualityResultMap(study), paired = qualityPairedRows(study, rows, closedOnly);
  const selected = plans.find(p => p.id === study.selectedSellId && p.rule);
  const sells = plans.map(plan => ({ plan, ...qualityDistribution(paired.map(row => qualityRowResult(study, row, plan, results)!)) }));
  const detectors = study.groups.map(group => {
    const caught = rows.filter(r => r.groups.includes(group.id));
    const valid = selected ? caught.map(row => qualityRowResult(study, row, selected, results)).filter(r => usable(r, closedOnly)) : [];
    return { group, total: caught.length, ...qualityDistribution(valid) };
  });
  return { paired, sells, detectors, selected };
}
