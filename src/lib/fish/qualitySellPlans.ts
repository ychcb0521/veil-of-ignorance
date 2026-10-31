import {validateQualityVetoStages} from './qualityVetoStages';
import {validateQualitySellStages} from './qualitySellStages';
import { compileFeatureFormula, definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { makeQualityBuyFilter } from './qualityFilters';
import { archiveQualityStudy } from './qualityCampaignArchive';
import { materializePlanBuyFilters, type FishQualityStudy, type QualityGroup } from './quality';

export const newQualitySellPlanId = () => 'sell-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));

export function makeQualitySellPlan(choice: string, direction: '<' | '>', threshold: number | undefined, definitions: readonly DeepDigFeatureDef[], original?: QualityGroup, id = newQualitySellPlanId()): QualityGroup {
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
export function replaceQualitySellPlans(study: FishQualityStudy, plans: readonly QualityGroup[]): FishQualityStudy {
  const ids = new Set<string>();
  for (const plan of plans) {
    if (!plan.id || ids.has(plan.id)) throw new Error('卖出算法编号重复');
    ids.add(plan.id);
    validateQualitySellStages(plan);validateQualityVetoStages(plan);
    if (!plan.label.trim()) throw new Error('请填写卖出算法名称');
    if (plan.rule && (!Number.isFinite(plan.rule.threshold) || !['<', '>'].includes(plan.rule.direction))) throw new Error('卖出门槛必须是有限数字');
    if (plan.combo && (!(plan.combo.switchPct > 0) || !Number.isFinite(plan.combo.switchPct) || !Number.isFinite(plan.combo.after.rule.threshold))) throw new Error('分段切换涨幅须大于 0，后段门槛须为有限数字');
  }
  if (study.sellPlansConfigured && JSON.stringify(study.sellPlans) === JSON.stringify(plans)) return study;
  const saved = materializePlanBuyFilters(archiveQualityStudy(study));
  return { ...saved, sellPlansConfigured: true, sellPlans: structuredClone([...plans]),
    selectedSellId: plans.some(plan => plan.id === study.selectedSellId) ? study.selectedSellId : undefined };
}
