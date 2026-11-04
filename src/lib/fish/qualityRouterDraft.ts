import type { QualityGroup } from './quality';
import { canonicalRouterJson, validateQualityRouter, type QualityPlanRouter } from './qualityPlanRouter';
import { freezeQualityPlan } from './qualityPlanVersions';
import { qualityAdditionPrerequisites, validateQualityAddition } from './qualityAddition';
import { validateQualityMirror } from './qualityMirror';
import { validatePayoffStops } from './qualityVeto';

const sharedKeys = ['snapshot', 'metric', 'rule', 'combo', 'definitionSource', 'execution', 'vetoFill', 'holdingVetoes', 'mirrorTakeProfit', 'vetoStageMode', 'vetoPeakBasis'] as const;
const sharedLabels = ['初始卖出公式', '初始卖出变量', '初始卖出门槛', '初始分段卖出', '公式来源', '卖出确认方式', '止损成交方式', '初始止损', '镜像止盈', '否决切换方式', '否决峰值基准'];
const same = (a: unknown, b: unknown) => canonicalRouterJson(a) === canonicalRouterJson(b);
/** Both branches execute the same history before the decision. Reconcile edits to that shared history. */
export function prepareQualityRouterDraft(original: QualityPlanRouter, structure: QualityGroup, attack: QualityGroup, threshold: number): QualityPlanRouter {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw Error('分支状态 S 门槛须为 0 到 1 之间的有限数字');
  if (same(structure, original.structure) && same(attack, original.attack) && threshold === original.threshold) return original;
  const branches = [structuredClone(structure), structuredClone(attack)];
  const reconcile = <T,>(label: string, oldA: T, oldB: T, a: T, b: T): T => {
    const changedA = !same(a, oldA), changedB = !same(b, oldB);
    if (changedA && changedB && !same(a, b)) throw Error(`公共设置「${label}」在两个分支中被改成不同值，请统一后保存`);
    return structuredClone(changedB ? b : a);
  };
  for (const key of sharedKeys) {
    const value = reconcile(sharedLabels[sharedKeys.indexOf(key)], original.structure[key], original.attack[key], structure[key], attack[key]);
    for (const branch of branches) { if (value === undefined) delete branch[key]; else (branch as any)[key] = structuredClone(value); }
  }
  // Copy actual edits field by field. Existing branch-specific protection must not be
  // overwritten merely because another global field or the first addition was edited.
  const additionKeys = new Set([original.structure, original.attack, structure, attack].flatMap(p => Object.keys(p.addition ?? {})));
  for (const key of additionKeys) {
    if (key === 'rounds' || key === 'maxRounds') continue;
    const [oldA, oldB, a, b] = [original.structure, original.attack, structure, attack].map(p => p.addition?.[key]);
    if (same(oldA, a) && same(oldB, b)) continue;
    const value = reconcile('加仓通用设置', oldA, oldB, a, b);
    for (const branch of branches) { if (value === undefined) delete branch.addition![key]; else branch.addition![key] = structuredClone(value); }
  }
  const firstTwo = [0, 1].map(i => reconcile(`第 ${i + 1} 次加仓`, original.structure.addition?.rounds?.[i], original.attack.addition?.rounds?.[i], structure.addition?.rounds?.[i], attack.addition?.rounds?.[i]));
  for (const branch of branches) {
    const rounds = [...firstTwo.map(r => structuredClone(r)), ...(branch.addition?.rounds?.slice(2) ?? [])];
    branch.addition = { ...branch.addition, rounds } as QualityGroup['addition'];
  }
  for (const key of ['sellStages', 'vetoStages'] as const) {
    const early = (p: QualityGroup) => (p[key] ?? []).filter(s => s.afterAdditions <= 2);
    const common = reconcile(key === 'sellStages' ? '前两次加仓后的卖出' : '前两次加仓后的否决', early(original.structure), early(original.attack), early(structure), early(attack));
    for (const branch of branches) {
      const stages = [...structuredClone(common), ...(branch[key] ?? []).filter(s => s.afterAdditions > 2)];
      (branch as any)[key] = stages.length ? stages : undefined;
    }
  }
  for (const branch of branches) {
    validateQualityAddition(branch.addition); validateQualityMirror(branch.mirrorTakeProfit); validatePayoffStops(branch.holdingVetoes);
    if (!branch.addition?.enabled || (branch.addition.maxRounds ?? branch.addition.rounds?.length ?? 0) < 2) throw Error('条件分支需要至少两次结构加仓，才能在第二次成交时选择分支');
    if (!qualityAdditionPrerequisites(branch.addition.rounds![1]).some(c => c.metric === 'state')) throw Error('第二次结构加仓须保留状态 S 方向条件，以取得分支选择时的已收盘读数');
  }
  const router = { ...original, threshold, structure: branches[0], attack: branches[1] };
  validateQualityRouter(router);
  // Re-freeze edited branches only. Original templates and archived manifests are never mutated.
  router.structure = same(router.structure, original.structure) ? original.structure : freezeQualityPlan(router.structure);
  router.attack = same(router.attack, original.attack) ? original.attack : freezeQualityPlan(router.attack);
  return router;
}
