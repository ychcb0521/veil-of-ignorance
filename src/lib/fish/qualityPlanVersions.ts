/**
 * 【用户要求】2026-11-02 「持仓监测」模板里涉及的所有算法都要版本保护：保存模板时冻结一份版本清单，
 * 之后代码里任何一项的逻辑变了（版本号变了），模板不会悄悄按新逻辑运行，而是明确指出哪一项变了、拒绝运行。
 *
 * 版本从两处来：
 *  - 引擎版本号：代码里写死的标记（如 holding-veto-v3、mirror-limit-v1、dbl-5-v2）。改了引擎逻辑的人必须换新标记。
 *  - 公式指纹：卖出算法、方向指标、否决指标等用户公式，取公式全文与参数的短哈希。公式改一个字，指纹就变。
 */
import { shortFishHash } from './algorithm';
import type { QualityGroup } from './quality';
import { qualityComboIdentity, qualityVetoVersion } from './quality';
import { activeHoldingVetoes, holdingVetoIdentity, holdingVetoLabel } from './qualityVeto';
import { mirrorExecutionIdentity, mirrorIdentity } from './qualityMirror';
import { additionIdentity, additionMirrorIdentity, qualityAdditionPrerequisites } from './qualityAddition';
import { qualityVetoStagesIdentity } from './qualityVetoStages';
import { qualitySellStagesIdentity } from './qualitySellStages';
import { boxAlgorithmVersion, freezeStructureVersions, structureVersions } from './boxAlgorithmVersions';
import type { FishSnapshot } from './algorithm';

export interface PlanVersionEntry {
  /** 稳定键：同一方案前后比较时按它对齐。 */
  key: string;
  /** 所属部分：卖出算法、半仓镜像、硬性终止、加仓、箱体算法…… */
  part: string;
  /** 这一项是什么（如「CDA < 0.5」「DBL-5 v2」）。 */
  name: string;
  /** 版本：引擎版本号和 / 或公式指纹。 */
  version: string;
  /** 一句话说明这一版的逻辑。 */
  summary: string;
}
const VERSION_TAG = /^[a-z][a-z0-9]*(?:-[a-z0-9.]+)*-v\d+$/;
/** 从身份数组里取出全部引擎版本号（如 holding-veto-v3），按出现顺序去重。 */
export function versionTags(value: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => { if (typeof x === 'string') { if (VERSION_TAG.test(x) && !out.includes(x)) out.push(x); } else if (Array.isArray(x)) x.forEach(walk); };
  walk(value); return out;
}
/** 公式指纹：公式全文 + 周期 + 缩放 + 统计口径。 */
export const formulaFingerprint = (s: Pick<FishSnapshot, 'definitionKey'> & Partial<Pick<FishSnapshot, 'interval' | 'scale' | 'statistic'>>) =>
  '公式 #' + shortFishHash(JSON.stringify([s.definitionKey, s.interval ?? null, s.scale ?? null, s.statistic ?? null]));
const join = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');

/** 方案涉及的全部算法及其版本（顺序：卖出 → 组合切换 → 执行 → 镜像 → 硬性终止 → 加仓 → 各次加仓的箱体与方向 → 加仓后切换）。 */
export function qualityPlanVersions(plan: QualityGroup): PlanVersionEntry[] {
  const out: PlanVersionEntry[] = [];
  const add = (key: string, part: string, name: string, version: string, summary: string) => out.push({ key, part, name, version, summary });
  const s = plan.snapshot;
  if (plan.rule || plan.combo) add('sell', '卖出算法', `${s.featureShort ?? plan.label} ${plan.rule ? `${plan.rule.direction} ${plan.rule.threshold}` : ''}`.trim(), formulaFingerprint(s),
    `${plan.definitionSource === 'account' ? '账号公式（保存时冻结全文）' : '历史公式'} · ${s.interval ?? '5m'}`);
  if (plan.combo) {
    const a = plan.combo.after;
    add('combo', '组合切换', `涨 ${plan.combo.switchPct}% 后改用 ${a.snapshot.featureShort ?? a.label} ${a.rule.direction} ${a.rule.threshold}`,
      join([...versionTags(qualityComboIdentity(plan)), formulaFingerprint(a.snapshot)]), '持仓最高价首次比买入价高出切换涨幅的那一分钟收盘起，改用后段算法');
  }
  add('execution', '卖出执行', plan.execution === 'intrabar-1m' ? '盘中达标 · 1 分钟复原' : '5 分钟收盘确认', plan.execution === 'intrabar-1m' ? 'intrabar-1m-v1' : 'close-confirm',
    plan.execution === 'intrabar-1m' ? '用 1 分钟线复原 5 分钟指标，盘中达标即卖' : '只认 5 分钟收盘读数');
  const mirror = [...versionTags(mirrorIdentity(plan.mirrorTakeProfit)), ...versionTags(mirrorExecutionIdentity(plan))];
  if (plan.mirrorTakeProfit?.enabled) add('mirror', '半仓镜像', `涨 ${plan.mirrorTakeProfit.gainPct}% 卖 ${plan.mirrorTakeProfit.sellPct}%`, join(mirror), '限价镜像止盈，只卖一次');
  const vetoes = activeHoldingVetoes(plan.holdingVetoes);
  if (vetoes.length) add('hard-stop', '硬性终止', vetoes.map(v => holdingVetoLabel(v)).join(' 或 '),
    join([qualityVetoVersion(plan), ...vetoes.filter(v => v.snapshot?.definitionKey).map(v => formulaFingerprint(v.snapshot!))]),
    plan.vetoFill === 'stop' ? '回撤止损盘中触及按止损价成交' : '回撤否决下一分钟开盘成交');
  const a = plan.addition;
  if (a?.enabled) {
    const rounds = a.rounds?.length ? a.rounds : [a];
    // 加仓引擎本身（平衡公式、轮次、门槛、否决、减仓等），不含箱体——箱体按轮单列
    add('addition', '加仓规则', `最多 ${a.maxRounds ?? rounds.length} 次`, join([...versionTags(additionIdentity({ ...a, structure: undefined, rounds: a.rounds?.map(r => ({ ...r, structure: undefined })) })), ...versionTags(additionMirrorIdentity(a, plan.mirrorTakeProfit))]),
      '镜像止盈后按平衡公式 Q×(K−S)+P＝新增币数×(T−K) 定量，碰到 K 卖出');
    rounds.forEach((r, i) => {
      if (r.source === 'structure' && r.structure) {
        const v = structureVersions(r.structure), box = boxAlgorithmVersion(v.box), guard = v.guard ? boxAlgorithmVersion(v.guard) : undefined;
        const k = r.structure.kSource === 'current' ? '新C' : r.structure.kSource === 'guard' ? '防守线' : '旧C';
        add(`box-${i + 1}`, `第 ${i + 1} 次加仓 · 箱体算法`, join([box?.label ?? v.box, guard?.label, `K＝${k}−${r.structure.buffer}${r.structure.bufferUnit === 'atr' ? 'ATR' : '%'}`]),
          join([v.box, v.guard, ...versionTags(additionIdentity({ ...a, rounds: undefined, source: 'structure', structure: r.structure })).filter(t => t.startsWith('k-from') || t.startsWith('box-addition'))]),
          join([box?.summary, guard?.summary]));
      }
      qualityAdditionPrerequisites(r).forEach((f, j) => add(`direction-${i + 1}-${j + 1}`, `第 ${i + 1} 次加仓 · 方向`, `${f.label} ${f.direction} ${f.threshold}`, formulaFingerprint(f.snapshot), '加仓那一刻须满足（只读最后一根已收盘 K 线）'));
    });
  }
  if (plan.vetoStages?.length) add('veto-stages', '加仓后否决', plan.vetoStages.map(st => `第 ${st.afterAdditions} 次后 ${st.conditions.filter(c => c.enabled).length} 条`).join('；'),
    join([...versionTags(qualityVetoStagesIdentity(plan)), ...plan.vetoStages.flatMap(st => st.conditions.filter(c => c.enabled && c.snapshot?.definitionKey).map(c => formulaFingerprint(c.snapshot!)))]), '某次加仓成交后换用的硬性终止条件');
  if (plan.sellStages?.length) add('sell-stages', '加仓后改用卖出', plan.sellStages.map(st => `第 ${st.afterAdditions} 次后 ${st.label}`).join('；'),
    join([...versionTags(qualitySellStagesIdentity(plan)), ...plan.sellStages.map(st => formulaFingerprint(st.snapshot))]), '某次加仓成交后换用的卖出算法');
  // 硬性终止条件本身的结构（类别、方向、门槛）已在名称里；这里另留一份完整指纹，门槛等任何改动都会被发现
  if (vetoes.length) out.push({ key: 'hard-stop-params', part: '硬性终止', name: '条件参数', version: '参数 #' + shortFishHash(JSON.stringify(holdingVetoIdentity(plan.holdingVetoes))), summary: '各条硬性终止的类别、方向、门槛' });
  return out;
}

export interface PlanVersionChange { key: string; part: string; name: string; from: string | null; to: string | null }
/** 冻结清单与按当前代码重算的清单逐项比较；返回变了的项（空数组＝版本一致）。 */
export function comparePlanVersions(frozen: readonly PlanVersionEntry[], current: readonly PlanVersionEntry[]): PlanVersionChange[] {
  const now = new Map(current.map(e => [e.key, e])), was = new Map(frozen.map(e => [e.key, e])), out: PlanVersionChange[] = [];
  for (const e of frozen) { const c = now.get(e.key); if (!c || c.version !== e.version) out.push({ key: e.key, part: e.part, name: e.name, from: e.version, to: c?.version ?? null }); }
  for (const c of current) if (!was.has(c.key)) out.push({ key: c.key, part: c.part, name: c.name, from: null, to: c.version });
  return out;
}
export const planVersionChangeText = (changes: readonly PlanVersionChange[]) => changes.map(c => `${c.part}「${c.name}」：${c.from ?? '（无）'} → ${c.to ?? '（已不存在）'}`).join('；');

/** 方案里每个箱体规则写下所用版本（防守线参数写成明确值）。 */
export function withFrozenStructures(plan: QualityGroup): QualityGroup {
  const a = plan.addition;
  if (!a) return plan;
  const fix = <R extends { structure?: import('./qualityAdditionStructure').StructureAdditionRule }>(r: R): R => r.structure ? { ...r, structure: freezeStructureVersions(r.structure) } : r;
  return { ...plan, addition: { ...fix(a), ...(a.rounds ? { rounds: a.rounds.map(fix) } : {}) } };
}
const body = (plan: QualityGroup) => { const { frozenVersions: _, ...rest } = withFrozenStructures(plan); return rest as QualityGroup; };
/** 按当前代码给方案冻结一份版本清单。 */
export const freezeQualityPlan = (plan: QualityGroup): QualityGroup => { const b = body(plan); return { ...b, frozenVersions: qualityPlanVersions(b) }; };
/**
 * 保存方案时：内容（除版本清单外）与已存的一样 → 沿用已存的清单（代码后来变了也照样能查出来）；
 * 新方案或改过 → 按保存这一刻的代码重新冻结（用户保存＝认可当前版本）。
 */
export function freezeSavedPlans(previous: readonly QualityGroup[] | undefined, plans: readonly QualityGroup[]): QualityGroup[] {
  const prior = new Map((previous ?? []).map(p => [p.id, p]));
  return plans.map(p => {
    const b = body(p), prev = prior.get(p.id);
    if (prev?.frozenVersions && JSON.stringify(body(prev)) === JSON.stringify(b)) return { ...b, frozenVersions: prev.frozenVersions };
    return { ...b, frozenVersions: qualityPlanVersions(b) };
  });
}
/** 方案冻结的版本与当前代码的差异；没冻结过的旧方案视为当前版本。 */
export const planVersionChanges = (plan: QualityGroup): PlanVersionChange[] => plan.frozenVersions ? comparePlanVersions(plan.frozenVersions, qualityPlanVersions(body(plan))) : [];
/** 打开时补记：还没冻结的方案与模板，按当前代码补一份清单（之后代码再变就能查出来）。 */
export function backfillPlanVersions<S extends { sellPlans?: QualityGroup[]; planTemplates?: import('./qualityPlanTemplates').QualityPlanTemplate[] }>(study: S): S {
  const plans = study.sellPlans?.some(p => !p.frozenVersions), templates = study.planTemplates?.some(t => !t.deleted && t.plan && !t.plan.frozenVersions);
  if (!plans && !templates) return study;
  return { ...study,
    ...(plans ? { sellPlans: study.sellPlans!.map(p => p.frozenVersions ? p : freezeQualityPlan(p)) } : {}),
    ...(templates ? { planTemplates: study.planTemplates!.map(t => !t.deleted && t.plan && !t.plan.frozenVersions ? { ...t, plan: freezeQualityPlan(t.plan), versionsBackfilledAt: Date.now() } : t) } : {}) };
}
/**
 * 方案会静默跟随账号里的公式（用户 2026-10-26 的要求，改公式＝本人认可）。只因公式跟随而变的指纹按当前重新冻结；
 * 引擎版本号的变化不在此列，照样拦下。模板不跟随账号公式，始终保持保存时的公式与版本。
 */
export function refreezeSyncedFormulas<S extends { sellPlans?: QualityGroup[] }>(study: S): S {
  const strip = (v: string | null) => (v ?? '').replace(/公式 #[0-9a-z]+/gi, '公式');
  let changed = false;
  const sellPlans = study.sellPlans?.map(p => {
    const changes = planVersionChanges(p);
    if (!changes.length || !changes.every(c => c.from != null && c.to != null && strip(c.from) === strip(c.to))) return p;
    changed = true; return freezeQualityPlan(p);
  });
  return changed ? { ...study, sellPlans } : study;
}
