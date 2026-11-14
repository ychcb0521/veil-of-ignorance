import type { DeepDigFeatureDef } from '../deepDig/features';
import { shortFishHash } from './algorithm';
import type { QualityBuyFilter, QualityGroup } from './quality';
import { TURING_INITIALIZATION_VERSION } from './qualityInitialization';
import { freezeQualityPlan, planVersionChanges } from './qualityPlanVersions';
import type { QualitySignalMetric } from './qualitySignalReadings';
import { turingScreeningMetric, validateTuringScreeningMetrics } from './qualityTuringPlan';

export const STATIC_FILTER_VERSION = 'static-filter-v1';

export interface QualityStaticFilter {
  version: typeof STATIC_FILTER_VERSION;
  filters: QualityBuyFilter[];
  metrics: QualitySignalMetric[];
}

export interface TuringStaticSettings {
  active: boolean;
  plan: QualityGroup;
  updatedAt: number;
}

export function createStaticFilterPlan(
  filters: readonly QualityBuyFilter[], metrics: readonly QualitySignalMetric[],
  initialization?: QualityGroup['initialization'],
): QualityGroup {
  const first = filters[0] ?? metrics[0];
  if (!first) throw Error('请先添加过滤条件或信号读数算法');
  const plan: QualityGroup = {
    id: 'static-filter', label: initialization ? '静态过滤 · 图灵杯专用 v1' : '静态过滤',
    metric: first.metric, snapshot: first.snapshot,
    ...(initialization ? { initialization } : {}),
    staticFilter: { version: STATIC_FILTER_VERSION, filters: [...filters], metrics: [...metrics] },
  };
  return freezeQualityPlan(structuredClone(plan));
}

export function createTuringStaticFilterPlan(
  filters: readonly QualityBuyFilter[], metrics: readonly QualitySignalMetric[], definitions: readonly DeepDigFeatureDef[],
): QualityGroup {
  const copyMetrics = metrics.map(metric => {
    const copy = turingScreeningMetric(metric, definitions);
    return copy === metric ? metric : { ...copy, id: shortFishHash(JSON.stringify([copy.snapshot.featureId+':'+copy.metric, copy.snapshot.definitionKey, copy.snapshot.interval])) };
  });
  return createStaticFilterPlan(filters.map(filter => turingScreeningMetric(filter, definitions)),
    [...new Map(copyMetrics.map(metric => [metric.id, metric])).values()], TURING_INITIALIZATION_VERSION);
}

export function validateTuringStaticFilterPlan(plan: QualityGroup) {
  if (plan.initialization !== TURING_INITIALIZATION_VERSION || plan.staticFilter?.version !== STATIC_FILTER_VERSION
    || !plan.frozenVersions?.length || planVersionChanges(plan).length) {
    throw Error('图灵杯静态过滤的冻结版本或参数不符，请保留原方案并另存副本');
  }
  validateTuringScreeningMetrics([...plan.staticFilter.filters, ...plan.staticFilter.metrics]);
}
