import type { QualityGroup } from './quality';
import { qualityAdditionConditions, qualityAdditionPrerequisites } from './qualityAddition';
import { freezeQualityPlan, planVersionChanges } from './qualityPlanVersions';
import { QUALITY_ADVANTAGE_VERSION, validateQualityAdvantage } from './qualityAdvantage';

export const ADVANTAGE_TEMPLATE_ID = 'builtin-fish-advantage-exit-v3-2026-11-06';
export const ADVANTAGE_TEMPLATE_NAME = '鱼质量·优势筛选与退出灵敏度 v3';

/** Copy the actual selected baseline. Do not guess missing A/B branch parameters from an export. */
export function buildQualityAdvantageTemplate(base: QualityGroup, id: string, label = ADVANTAGE_TEMPLATE_NAME): QualityGroup {
  if (planVersionChanges(base).length) throw Error('原方案的冻结版本已变，请先核对原方案版本，不能静默换用新算法');
  const attach = (source: QualityGroup): QualityGroup => {
    const { frozenVersions: _, ...p } = structuredClone(source);
    if (p.engine) throw Error('旧引擎方案不能附加新规则，请选择当前引擎的原方案');
    if (p.router) {
      const structure = attach(p.router.structure), attack = attach(p.router.attack);
      return { ...p, advantage: structure.advantage, router: { ...p.router, structure, attack } };
    }
    const rounds = p.addition?.rounds?.length ? p.addition.rounds : p.addition ? [p.addition] : [];
    const state = rounds.flatMap(r => [...qualityAdditionConditions(r), ...qualityAdditionPrerequisites(r)]).find(f => f.snapshot.featureId === 'state' && f.metric === 'state');
    const structure = rounds.find(r => r.structure?.algorithm === 'dbl5')?.structure;
    if (!state || !structure) throw Error('请选择含状态 S 与 DBL-5 的原方案；不会补造原方案缺失的公式');
    const result: QualityGroup = { ...p, advantage: { version: QUALITY_ADVANTAGE_VERSION, state: { snapshot: structuredClone(state.snapshot), metric: state.metric },
      structure: structuredClone(structure), screenWeak: true, beforeFirst: true, afterAddition: true, confirmations: 2 } };
    validateQualityAdvantage(result); return result;
  };
  return freezeQualityPlan({ ...attach(base), id, label });
}
