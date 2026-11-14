import { compileFeatureFormula, definitionKey, type DeepDigFeatureDef } from '../deepDig/features';
import type { FishSnapshot } from './algorithm';
import { qualityDefinition, qualityMetricPlan, type QualityGroup } from './quality';
import { TURING_INITIALIZATION_VERSION, TURING_SCREENING_INITIALIZATION_VERSION } from './qualityInitialization';
import { freezeQualityPlan, planVersionChanges } from './qualityPlanVersions';
import { newQualitySellPlanId } from './qualitySellPlans';
import { additionMetricBaseDefinition, additionMetricTime, withMetricSnapshotTime } from './qualityAdditionMetric';
import { researchChartFormula, researchIndicatorForFeature } from '../researchIndicators';
import { expressionConditions, validatePreEntryThreeStage, type EntryMarketExpression } from './preEntryThreeStage';

type ScreeningMetric = { label: string; metric: string; snapshot: FishSnapshot };

export function turingScreeningMetric<T extends ScreeningMetric>(condition: T, definitions: readonly DeepDigFeatureDef[]): T {
  const { snapshot, metric } = condition;
  const original = qualityDefinition(snapshot);
  if (!compileFeatureFormula(original.formula).usesBtc) return condition;
  const variant = definitions.find(def => def.btcFreeSourceId === snapshot.featureId);
  if (!variant) throw Error(`「${condition.label}」依赖 BTC，但没有可用的独立无 BTC 版本`);
  const formula = researchChartFormula(researchIndicatorForFeature(variant), variant.formula);
  if (compileFeatureFormula(formula).usesBtc) throw Error(`「${condition.label}」的无 BTC 版本仍依赖 BTC`);
  const base = additionMetricBaseDefinition(snapshot);
  const definition = { ...variant, formula, interval: base.interval, halfLifeHours: base.halfLifeHours, avgHours: base.avgHours };
  const label = `${variant.short} · ${metric}`;
  const copy = withMetricSnapshotTime({ ...condition, label, snapshot: {
    ...snapshot, featureId: variant.id, featureShort: variant.short, featureName: variant.name,
    definitionKey: definitionKey(definition), interval: definition.interval,
  } }, additionMetricTime(snapshot));
  qualityMetricPlan(copy.snapshot, metric);
  return copy;
}

export function validateTuringScreeningMetrics(metrics: readonly ScreeningMetric[]) {
  for (const metric of metrics) {
    if (compileFeatureFormula(qualityDefinition(metric.snapshot).formula).usesBtc) {
      throw Error(`「${metric.label}」依赖 BTC，请选用独立无 BTC 版本`);
    }
  }
}

export function createTuringPreEntryPlan(source: QualityGroup, definitions: readonly DeepDigFeatureDef[], id: string): QualityGroup {
  const config = source.preEntryThreeStage;
  validatePreEntryThreeStage(config);
  if (source.engine || planVersionChanges(source).length) throw Error('原方案的冻结版本已变化，无法创建图灵杯副本');
  const copy = turingScreeningMetric(structuredClone(source), definitions);
  const screening = copy.preEntryThreeStage!;
  const convert = <T extends ScreeningMetric>(metric: T) => turingScreeningMetric(metric, definitions);
  const convertExpression = (expression: EntryMarketExpression): EntryMarketExpression => 'condition' in expression
    ? { condition: convert(expression.condition) }
    : { ...expression, children: expression.children.map(convertExpression) };
  screening.required = screening.required.map(convert);
  if (screening.admission) screening.admission.algorithms = screening.admission.algorithms.map(convert);
  screening.sellRules = screening.sellRules.map(rule => ({ ...rule, expression: convertExpression(rule.expression) }));
  screening.hardVetoes = screening.hardVetoes.map(veto => {
    if (!veto.snapshot || !veto.metric) return veto;
    return convert({ ...veto, snapshot: veto.snapshot, metric: veto.metric });
  });
  return freezeQualityPlan({ ...copy, id, label: `${source.label} · 图灵杯专用 v1`, initialization: TURING_SCREENING_INITIALIZATION_VERSION });
}

export function validateTuringPreEntryPlan(plan: QualityGroup) {
  if (plan.initialization !== TURING_SCREENING_INITIALIZATION_VERSION || !plan.preEntryThreeStage) return;
  const config = plan.preEntryThreeStage;
  validateTuringScreeningMetrics([
    ...config.required, ...(config.admission?.algorithms ?? []),
    ...config.sellRules.flatMap(rule => expressionConditions(rule.expression)),
    ...config.hardVetoes.flatMap(veto => veto.snapshot && veto.metric ? [{ ...veto, snapshot: veto.snapshot, metric: veto.metric }] : []),
  ]);
}

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
