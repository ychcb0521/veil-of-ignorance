import type { QualityGroup } from './quality';
import { canonicalRouterJson, isRaceRouter, RACE_ROUND_KEYS, raceAttackFromRound, routerOrdinal, routerPrefixText, routerVersionFor, validateQualityRouter, type QualityPlanRouter } from './qualityPlanRouter';
import { freezeQualityPlan } from './qualityPlanVersions';
import { qualityAdditionPrerequisites, validateQualityAddition } from './qualityAddition';
import { validateQualityMirror } from './qualityMirror';
import { validatePayoffStops } from './qualityVeto';

const sharedKeys = ['snapshot', 'metric', 'rule', 'combo', 'definitionSource', 'execution', 'vetoFill', 'holdingVetoes', 'mirrorTakeProfit', 'vetoStageMode', 'vetoPeakBasis'] as const;
const sharedLabels = ['初始卖出公式', '初始卖出变量', '初始卖出门槛', '初始分段卖出', '公式来源', '卖出确认方式', '止损成交方式', '初始止损', '镜像止盈', '否决切换方式', '否决峰值基准'];
const same = (a: unknown, b: unknown) => canonicalRouterJson(a) === canonicalRouterJson(b);
/** Both branches execute the same history before the decision. Reconcile edits to that shared history. */
export function prepareQualityRouterDraft(original: QualityPlanRouter, structure: QualityGroup, attack: QualityGroup, threshold: number, attackFromRound = raceAttackFromRound(original)): QualityPlanRouter {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw Error('分支状态 S 门槛须为 0 到 1 之间的有限数字');
  if (isRaceRouter(original) && (!Number.isInteger(attackFromRound) || attackFromRound < 1)) throw Error('进攻分支参与竞速的起始次数须为不小于 1 的整数');
  if (!isRaceRouter(original)) attackFromRound = 1;
  if (same(structure, original.structure) && same(attack, original.attack) && threshold === original.threshold && attackFromRound === raceAttackFromRound(original)) return original;
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
  // 分流前的加仓（第一次或前两次）是公共历史；每轮分流（n＝0）没有公共轮，各轮条件两边各自独立
  const n = original.afterAdditions, race = isRaceRouter(original);
  const additionKeys = new Set([original.structure, original.attack, structure, attack].flatMap(p => Object.keys(p.addition ?? {})));
  for (const key of additionKeys) {
    if (key === 'rounds' || key === 'maxRounds' || race && (RACE_ROUND_KEYS as readonly string[]).includes(key)) continue;
    const [oldA, oldB, a, b] = [original.structure, original.attack, structure, attack].map(p => p.addition?.[key]);
    if (same(oldA, a) && same(oldB, b)) continue;
    const value = reconcile('加仓通用设置', oldA, oldB, a, b);
    for (const branch of branches) { if (value === undefined) delete branch.addition![key]; else branch.addition![key] = structuredClone(value); }
  }
  const shared = Array.from({ length: n }, (_, i) => reconcile(`第 ${i + 1} 次加仓`, original.structure.addition?.rounds?.[i], original.attack.addition?.rounds?.[i], structure.addition?.rounds?.[i], attack.addition?.rounds?.[i]));
  for (const branch of branches) {
    const rounds = [...shared.map(r => structuredClone(r)), ...(branch.addition?.rounds?.slice(n) ?? [])];
    branch.addition = { ...branch.addition, rounds } as QualityGroup['addition'];
  }
  for (const key of ['sellStages', 'vetoStages'] as const) {
    const cut = race ? Infinity : n, early = (p: QualityGroup) => (p[key] ?? []).filter(s => s.afterAdditions <= cut);
    const common = reconcile(`${race ? '' : routerPrefixText(original)}加仓后的${key === 'sellStages' ? '卖出' : '否决'}`, early(original.structure), early(original.attack), early(structure), early(attack));
    for (const branch of branches) {
      const stages = [...structuredClone(common), ...(branch[key] ?? []).filter(s => s.afterAdditions > cut)];
      (branch as any)[key] = stages.length ? stages : undefined;
    }
  }
  for (const branch of branches) {
    validateQualityAddition(branch.addition); validateQualityMirror(branch.mirrorTakeProfit); validatePayoffStops(branch.holdingVetoes);
    if (race) { if (!branch.addition?.enabled || !branch.addition.rounds?.length) throw Error('每轮分流的两条分支都须有逐轮加仓条件'); continue; }
    if (!branch.addition?.enabled || (branch.addition.maxRounds ?? branch.addition.rounds?.length ?? 0) < n) throw Error(n === 1 ? '条件分支需要至少一次结构加仓，才能在第一次成交时选择分支' : '条件分支需要至少两次结构加仓，才能在第二次成交时选择分支');
    if (!qualityAdditionPrerequisites(branch.addition.rounds![n - 1]).some(c => c.metric === 'state')) throw Error(`第${routerOrdinal(original)}次结构加仓须保留状态 S 方向条件，以取得分支选择时的已收盘读数`);
  }
  // 每轮分流的闸门随版本号成对变化（1＝v3 原版本号；>1＝带闸门的版本号）；一次选定的分流方式不带这个字段
  const { attackFromRound: _previousFrom, ...rest } = original;
  const router: QualityPlanRouter = { ...rest, version: routerVersionFor(original.afterAdditions, attackFromRound), threshold, ...(isRaceRouter(original) && attackFromRound > 1 ? { attackFromRound } : {}), structure: branches[0], attack: branches[1] };
  validateQualityRouter(router);
  // Re-freeze edited branches only. Original templates and archived manifests are never mutated.
  router.structure = same(router.structure, original.structure) ? original.structure : freezeQualityPlan(router.structure);
  router.attack = same(router.attack, original.attack) ? original.attack : freezeQualityPlan(router.attack);
  return router;
}
