import { compileFeatureFormula, definitionKey, type DeepDigFeatureDef } from '../deepDig/features';
import type { FishSnapshot } from './algorithm';
import { qualityDefinition, type QualityGroup } from './quality';
import { TURING_INITIALIZATION_VERSION } from './qualityInitialization';
import { freezeQualityPlan, planVersionChanges } from './qualityPlanVersions';
import { newQualitySellPlanId } from './qualitySellPlans';
import { additionMetricTime, withMetricSnapshotTime } from './qualityAdditionMetric';
import { researchChartFormula, researchIndicatorForFeature } from '../researchIndicators';

/** Copy only: original formulas, thresholds, positions and archived results remain untouched. */
export function createTuringQualityPlan(source: QualityGroup, definitions: readonly DeepDigFeatureDef[], id = newQualitySellPlanId()): QualityGroup {
  if (source.engine) throw Error('历史冻结引擎不支持更换初始化方式，请先另存为当前引擎副本');
  if (planVersionChanges(source).length) throw Error('原方案的冻结版本已变化，不能静默升级为图灵杯副本');
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    const copy = Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'frozenVersions').map(([key, item]) => [key, convert(item)]));
    if (typeof object.definitionKey === 'string' && typeof object.featureId === 'string') {
      const snapshot = object as unknown as FishSnapshot;
      if (compileFeatureFormula(qualityDefinition(snapshot).formula).usesBtc) {
        const variant = definitions.find(d => d.btcFreeSourceId === snapshot.featureId);
        if (!variant || compileFeatureFormula(variant.formula).usesBtc) throw Error(`「${snapshot.featureShort ?? snapshot.featureId}」依赖 BTC，但没有可用的独立无 BTC 版本；原方案未修改`);
        Object.assign(copy, { featureId: variant.id, featureShort: variant.short, featureName: variant.name, definitionKey: definitionKey(variant), interval: variant.interval ?? snapshot.interval });
        const time = additionMetricTime(snapshot);
        if (Object.keys(time).length) {
          const formula = researchChartFormula(researchIndicatorForFeature(variant), variant.formula);
          const metric = snapshot.statistic ?? '结果';
          const tuned = withMetricSnapshotTime({label:variant.short, metric, snapshot:{
            ...(copy as unknown as FishSnapshot), definitionKey:definitionKey({...variant,formula}),
          }}, time);
          Object.assign(copy,tuned.snapshot);
        }
      }
    }
    return copy;
  };
  const copy = convert(source) as QualityGroup;
  copy.id = id; copy.label = `${source.label} · 图灵杯专用 v1`;
  copy.initialization = TURING_INITIALIZATION_VERSION;
  if (copy.router) for (const branch of ['structure', 'attack'] as const) {
    copy.router[branch].id = `${id}:${branch}`;
    copy.router[branch].initialization = TURING_INITIALIZATION_VERSION;
  }
  return freezeQualityPlan(copy);
}
