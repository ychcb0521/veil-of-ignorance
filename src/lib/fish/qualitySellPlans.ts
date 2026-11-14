import {validateQualityVetoStages} from './qualityVetoStages';
import {validateQualitySellStages} from './qualitySellStages';
import { compileFeatureFormula, definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { makeQualityBuyFilter } from './qualityFilters';
import { archiveQualityStudy } from './qualityCampaignArchive';
import { materializePlanBuyFilters, type FishQualityStudy, type QualityGroup } from './quality';
import { freezeSavedPlans } from './qualityPlanVersions';
import { validatePayoffStops } from './qualityVeto';
import { STATIC_DRAWDOWN_SELL_CHOICE, STATIC_DRAWDOWN_SELL_LABEL, STATIC_DRAWDOWN_SELL_METRIC, STATIC_DRAWDOWN_SELL_VERSION, initialLimitedDrawdownPct, staticDrawdownSellSnapshot, validateQualityExitRule, withLimitedPayoffRisk, type StaticDrawdownSellRule } from './qualityStaticDrawdownSell';

export const newQualitySellPlanId = () => 'sell-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));

export function makeQualitySellPlan(choice: string, direction: '<' | '>' | '>=', threshold: number | undefined, definitions: readonly DeepDigFeatureDef[], original?: QualityGroup, id = newQualitySellPlanId()): QualityGroup {
  if (choice === STATIC_DRAWDOWN_SELL_CHOICE) {
    const snapshot = staticDrawdownSellSnapshot(threshold ?? 0);
    const rule: StaticDrawdownSellRule = { metric: STATIC_DRAWDOWN_SELL_METRIC, version: STATIC_DRAWDOWN_SELL_VERSION, direction: '>=', threshold: threshold ?? NaN };
    validateQualityExitRule(snapshot, rule);
    const plan: QualityGroup = { ...original, id: original?.id ?? id, label: STATIC_DRAWDOWN_SELL_LABEL,
      metric: STATIC_DRAWDOWN_SELL_METRIC, snapshot, execution: 'intrabar-1m', vetoFill: 'stop', rule };
    delete plan.definitionSource;
    return plan;
  }
  if (direction === '>=') throw Error('请选择有效的卖出方向');
  const filter = makeQualityBuyFilter(choice, direction, threshold ?? 0, true, definitions);
  const def = definitions.find(d => d.id === filter.snapshot.featureId)!;
  if (filter.metric === '结果' || compileFeatureFormula(def.formula).program.statements.some(s => s.name === filter.metric)) {
    filter.snapshot.definitionKey = definitionKey({ ...def, interval: '5m' });
  }
  return { ...original, id: original?.id ?? id, label: filter.label, metric: filter.metric, snapshot: filter.snapshot,
    definitionSource: 'account', execution: 'intrabar-1m', vetoFill: 'stop',
    rule: threshold == null ? undefined : { metric: filter.metric, direction, threshold } };
}

/** Archive before replacing active plans; detector data and prior libraries remain untouched. */
export function replaceQualitySellPlans(study: FishQualityStudy, incoming: readonly QualityGroup[]): FishQualityStudy {
  const ids = new Set<string>();
  const prior = new Map(study.sellPlans?.map(plan => [plan.id, plan]));
  const prepared = incoming.map(plan => {
    const saved = prior.get(plan.id);
    // A copied template carries its original execution, even under a new ID.
    const changedRisk = saved && JSON.stringify([saved.rule, saved.holdingVetoes, saved.vetoStages, !!saved.addition?.enabled])
      !== JSON.stringify([plan.rule, plan.holdingVetoes, plan.vetoStages, !!plan.addition?.enabled]);
    return !plan.router && !plan.engine && (changedRisk || !saved && !plan.frozenVersions) ? withLimitedPayoffRisk(plan) : plan;
  });
  for (const plan of prepared) {
    if (!plan.id || ids.has(plan.id)) throw new Error('卖出算法编号重复');
    ids.add(plan.id);
    validateQualitySellStages(plan);validateQualityVetoStages(plan);validatePayoffStops(plan.holdingVetoes, plan.payoffRiskVersion ? initialLimitedDrawdownPct(plan) : undefined);
    if (!plan.label.trim()) throw new Error('请填写卖出算法名称');
    validateQualityExitRule(plan.snapshot, plan.rule);
    if (plan.combo) validateQualityExitRule(plan.combo.after.snapshot, plan.combo.after.rule);
    if (plan.combo && (!(plan.combo.switchPct > 0) || !Number.isFinite(plan.combo.switchPct) || !Number.isFinite(plan.combo.after.rule.threshold))) throw new Error('分段切换涨幅须大于 0，后段门槛须为有限数字');
  }
  // 【用户要求】2026-11-02 保存时冻结版本：未改动的方案沿用已存的版本清单，新建或改过的按当前代码冻结
  const plans = freezeSavedPlans(study.sellPlans, prepared);
  if (study.sellPlansConfigured && JSON.stringify(study.sellPlans) === JSON.stringify(plans)) return study;
  const saved = materializePlanBuyFilters(archiveQualityStudy(study));
  return { ...saved, sellPlansConfigured: true, sellPlans: structuredClone([...plans]),
    selectedSellId: plans.some(plan => plan.id === study.selectedSellId) ? study.selectedSellId : undefined };
}
