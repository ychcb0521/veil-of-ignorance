/**
 * 【用户要求】2026-11-02 持仓监测的组合算法可以存成模板：算法是一套套试出来的，试出好组合要能整套保存、以后一键新建。
 * 模板＝整套方案的完整快照（组合算法、半仓镜像、加仓细节、硬性终止、一票条件切换等全部参数），存在鱼质量总表里随账号同步。
 * 删除留墓碑（deleted），两台设备合并时按 updatedAt 取新，删掉的模板不会被另一台设备的旧副本带回来。
 */
import type { FishQualityStudy, QualityGroup } from './quality';
import { activeHoldingVetoes } from './qualityVeto';
import { freezeQualityPlan, planVersionChanges } from './qualityPlanVersions';
import { hasPreBoxAdditionShape, withLegacyEngine } from './qualityLegacyEngine';

export interface QualityPlanTemplate {
  id: string; name: string; savedAt: number; updatedAt: number;
  /** 删除后只留墓碑，不再保存方案正文。 */
  deleted?: true; plan?: QualityGroup;
  /** 旧模板在 2026-11-02 版本保护上线时按当时代码补记版本清单的时间。 */
  versionsBackfilledAt?: number;
}
const newTemplateId = () => `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const activeQualityPlanTemplates = (study: Pick<FishQualityStudy, 'planTemplates'>): (QualityPlanTemplate & { plan: QualityGroup })[] =>
  (study.planTemplates ?? []).filter((t): t is QualityPlanTemplate & { plan: QualityGroup } => !t.deleted && !!t.plan).sort((a, b) => b.savedAt - a.savedAt);

export function saveQualityPlanTemplate(study: FishQualityStudy, plan: QualityGroup, name: string, now = Date.now()): FishQualityStudy {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('请填写模板名称');
  // 模板存的是这套方案实际冻结的版本；方案本身的版本已与代码不符时不能存（否则会把新版本当成旧版本存档）
  if (plan.frozenVersions && planVersionChanges(plan).length) throw new Error('这套方案冻结的算法版本与当前代码不同，不能存为模板；请先在条件设置里重新保存');
  // 没冻结过、又是 11-01 之前形态的方案（10-31 及更早的战役）：按旧引擎冻结，不能按当前代码记版本
  const frozen = plan.frozenVersions ? plan : !plan.engine && hasPreBoxAdditionShape(plan) ? withLegacyEngine(plan) : freezeQualityPlan(plan);
  const template: QualityPlanTemplate = { id: newTemplateId(), name: trimmed, savedAt: now, updatedAt: now, plan: structuredClone(frozen) };
  return { ...study, planTemplates: [...(study.planTemplates ?? []), template] };
}
export function deleteQualityPlanTemplate(study: FishQualityStudy, id: string, now = Date.now()): FishQualityStudy {
  if (!study.planTemplates?.some(t => t.id === id && !t.deleted)) return study;
  return { ...study, planTemplates: study.planTemplates.map(t => t.id === id ? { id: t.id, name: t.name, savedAt: t.savedAt, updatedAt: now, deleted: true as const } : t) };
}
export function renameQualityPlanTemplate(study: FishQualityStudy, id: string, name: string, now = Date.now()): FishQualityStudy {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('请填写模板名称');
  if (!study.planTemplates?.some(t => t.id === id && !t.deleted)) return study;
  return { ...study, planTemplates: study.planTemplates.map(t => t.id === id ? { ...t, name: trimmed, updatedAt: now } : t) };
}
/**
 * 【用户要求】2026-11-03 从交易战役存模板：只存能原样复算的方案。
 * 战役没冻结版本清单＝算于 11-02 版本保护之前。11-01 之前形态的交给旧引擎（见 qualityLegacyEngine.ts）；
 * 其余（11-01～11-02 之间算的）当时用的算法版本没有记录，当前代码不能保证算出同样的结果，不存。
 */
export function campaignPlanForTemplate(plan: QualityGroup): QualityGroup {
  if (plan.frozenVersions || plan.engine) return plan;
  if (hasPreBoxAdditionShape(plan)) return withLegacyEngine(plan);
  throw new Error('这场战役算于 2026-11-02 版本保护之前，当时的算法版本没有记录，用现在的代码重跑不能保证得到同样的结果，所以不能存为模板');
}
/** 两台设备合并：同一模板取 updatedAt 较新的一份（含删除墓碑）。 */
export function mergeQualityPlanTemplates(left?: readonly QualityPlanTemplate[], right?: readonly QualityPlanTemplate[]): QualityPlanTemplate[] | undefined {
  if (!left?.length && !right?.length) return left?.length === 0 || right?.length === 0 ? [] : undefined;
  const map = new Map<string, QualityPlanTemplate>();
  for (const t of [...(left ?? []), ...(right ?? [])]) { const old = map.get(t.id); if (!old || t.updatedAt >= old.updatedAt) map.set(t.id, t); }
  return [...map.values()];
}
/** 从模板新建方案：全部参数照搬，换新编号与名称。 */
export const qualityPlanFromTemplate = (template: QualityPlanTemplate & { plan: QualityGroup }, id: string, label = template.name): QualityGroup => {
  // 【用户要求】2026-11-02 模板冻结的算法版本与当前代码不同时不新建，免得按另一版逻辑运行
  const changes = planVersionChanges(template.plan);
  if (changes.length) throw new Error(`模板「${template.name}」的算法版本与当前代码不同：${changes.map(c => `${c.part}「${c.name}」${c.from ?? '（无）'} → ${c.to ?? '（已不存在）'}`).join('；')}`);
  return { ...structuredClone(template.plan), id, label };
};

/** 模板列表里的一行摘要（各项参数仍以新建后的设置界面为准）。 */
export function qualityPlanTemplateSummary(plan: QualityGroup): string {
  const sell = plan.combo && plan.rule ? `${plan.combo.beforeLabel} ${plan.rule.direction} ${plan.rule.threshold} → 涨 ${plan.combo.switchPct}% 后 ${plan.combo.after.label} ${plan.combo.after.rule.direction} ${plan.combo.after.rule.threshold}`
    : plan.rule ? `${plan.snapshot.featureShort ?? plan.label} ${plan.rule.direction} ${plan.rule.threshold}` : '无普通卖出门槛';
  const mirror = plan.mirrorTakeProfit?.enabled ? `镜像 ${plan.mirrorTakeProfit.gainPct}% 卖 ${plan.mirrorTakeProfit.sellPct}%` : '镜像关';
  const addition = plan.addition?.enabled ? `加仓最多 ${plan.addition.maxRounds ?? (plan.addition.repeat === false ? 1 : '多')} 次` : '加仓关';
  const stops = activeHoldingVetoes(plan.holdingVetoes).length;
  return [sell, mirror, addition, `硬性终止 ${stops} 条`].join(' · ');
}
