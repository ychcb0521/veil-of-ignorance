import {BOX_STOP_KIND,freezeBoxStop,isBoxBreak,boxStopLabel} from './qualityBoxStop';
import { freezePreEntryConditions, preEntryConditionsVersion } from './preEntryConditions';
import { TURING_INITIALIZATION_VERSION } from './qualityInitialization';
import { routerFingerprint, routerVersionSummary, validateQualityRouter, equivalentRouterVersion } from './qualityPlanRouter';
import { qualityAdvantageFingerprint, validateQualityAdvantage, QUALITY_ADVANTAGE_VERSION } from './qualityAdvantage';
import { DOUBLE_DROP_VERSION } from './qualityDoubleDrop';
import { LOWER_WICK_VETO_VERSION, VETO_HISTORY_VERSION } from './qualityAdditionVeto';
import { compatibleHoldingParameterOrder } from './qualityPlanParameterCompatibility';
import { freezePreEntryThreeStage, threeStageFingerprint } from './preEntryThreeStage';
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
import { activeDetectorPrerequisite, additionIdentity, additionMirrorIdentity, qualityAdditionConditions, qualityAdditionPrerequisites } from './qualityAddition';
import { qualityVetoStagesIdentity } from './qualityVetoStages';
import { qualitySellStagesIdentity } from './qualitySellStages';
import { boxAlgorithmVersion, freezeStructureVersions, structureVersions } from './boxAlgorithmVersions';
import { structureKSourceLabel } from './qualityAdditionStructure';
import type { FishSnapshot } from './algorithm';
import { hasPreBoxAdditionShape, isLegacyQualityPlan, legacyPlanVersions, withLegacyEngine } from './qualityLegacyEngine';

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
  validateQualityAdvantage(plan);
  const initialization: PlanVersionEntry[] = plan.initialization ? [{ key: 'initialization', part: '历史初始化', name: '图灵杯首根行情初始化', version: TURING_INITIALIZATION_VERSION, summary: '从已有首根完整 K 线初始化；初期无定义的指标等待，不补造历史。与完整历史预热读数不同，原方案保留。' }] : [];
  if(plan.router){
    validateQualityRouter(plan.router);
    return [...initialization,{key:'router',part:'条件分支',name:'结构为底·强势进攻',version:plan.router.version+' · 参数 #'+routerFingerprint(plan.router),summary:routerVersionSummary(plan.router)},...(['structure','attack'] as const).flatMap(branch=>qualityPlanVersions(plan.router![branch]).map(e=>({...e,key:branch+':'+e.key,part:(branch==='structure'?'结构分支 · ':'进攻分支 · ')+e.part})))];
  }
  // 【用户要求】2026-11-03 旧引擎方案：整套交给冻结的 10-31 引擎，版本＝引擎＋全部参数指纹
  if (isLegacyQualityPlan(plan)) return legacyPlanVersions(plan);
  const out: PlanVersionEntry[] = [...initialization];
  const historicalVetoes=[...(plan.preEntryThreeStage?.additionVetoes??[]),...(plan.preEntryConditions?.entryVetoes??[]),...(plan.addition?.enabled?[plan.addition,...(plan.addition.rounds??[]),...(plan.addition.alternativeRounds??[])].flatMap(r=>r.entryVetoes??[]):[])].filter(v=>v.enabled&&v.historyHours!=null);
  if(historicalVetoes.length)out.push({key:'veto-history',part:'一票否决',name:'独立历史扫描范围',version:VETO_HISTORY_VERSION+' · 参数 #'+shortFishHash(JSON.stringify(historicalVetoes)),summary:'按每次判断时点向前回看，包含入选和持仓之前的行情；影线与插针扫描整个历史窗口，高震荡检查窗口内观测，急跌检查窗口内分钟线；未收复高点锁定不因重筛或窗口滑动清除。旧范围另行保留。'});
  const lowerWicks=[...(plan.preEntryThreeStage?.additionVetoes??[]),...(plan.preEntryConditions?.entryVetoes??[]),...(plan.addition?.enabled?[plan.addition,...(plan.addition.rounds??[]),...(plan.addition.alternativeRounds??[])].flatMap(r=>r.entryVetoes??[]):[])].filter(v=>v.enabled&&v.kind==='lower-wick');
  if(lowerWicks.length)out.push({key:'lower-wick-veto',part:'一票否决',name:'长下影线',version:LOWER_WICK_VETO_VERSION+' · 参数 #'+shortFishHash(JSON.stringify(lowerWicks)),summary:'只读已收盘 5 分钟 K 线；下影＝min(开盘,收盘)−最低价，长度达到 ATR 倍数且占整根振幅达到比例时否决，与长上影线对称。'});
  if (plan.preEntryThreeStage) out.push({key:'pre-entry-three-stage',part:'动态筛选',name:'三阶同刻准入',version:plan.preEntryThreeStage.version+' · 参数 #'+threeStageFingerprint(plan.preEntryThreeStage),summary:plan.preEntryThreeStage.observationBasis==='retry-origin-v2'?'多条准入算法取或，必要条件和排除门槛仍须同刻通过；否决后从下一分钟重建观察起点；原门槛和总截止时间不变；指标保留预热，原生防守线不重启、旧事件不延期兑现。':'加仓共用资格、完整卖出排除及原生防守线更新同刻判断；观察起点固定，旧事件不延期兑现。'});
  if (plan.preEntryConditions) out.push({ key: 'pre-entry-conditions', part: '动态筛选', name: '入选条件与三组否决', version: preEntryConditionsVersion(plan), summary: '同一分钟入选条件全部满足且无否决；从筛选起点累计观察，不模拟持仓，旧轮次不升级。' });
  const add = (key: string, part: string, name: string, version: string, summary: string) => out.push({ key, part, name, version, summary });
  const s = plan.snapshot;
  if(plan.advantage)add('advantage','优势筛选与退出灵敏度','逐次筛选 · 软退出动态确认',QUALITY_ADVANTAGE_VERSION+' · 参数 #'+qualityAdvantageFingerprint(plan),
    `W 同步走弱筛选${plan.advantage.screenWeak?'开':'关'}；首加前确认${plan.advantage.beforeFirst?'开':'关'}，加仓后 A 级确认${plan.advantage.afterAddition?'开':'关'}，${plan.advantage.confirmations} 根已完成 1 分钟；其余单次，原定量/K/硬止损不变；候选未验证收益。`);
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
  vetoes.filter(v=>v.kind===BOX_STOP_KIND).forEach((v,i)=>{const r=v.boxStop!,versions=structureVersions(r.structure);add(`hard-stop-box-${i}`, '硬性终止',boxStopLabel(r),[r.version,versions.box,versions.guard].filter(Boolean).join(' · '),isBoxBreak(r)?'仅在原生 DBL-5 防守线红叉确认后，按下一分钟开盘价全仓卖出；不将影线或缺失线当断裂':'独立箱体止损；只用已收盘 5 分钟结构，触价或收盘确认由用户选择');});
  const a = plan.addition;
  if (a?.enabled) {
    const doubleDrops=[a,...(a.rounds??[]),...(a.alternativeRounds??[])].map(r=>(r.entryVetoes??[]).filter(v=>v.enabled&&v.kind==='double-drop')).filter(r=>r.length);
    if(doubleDrops.length)add('addition-support-quality','加仓否决','二次急跌未收复前高',DOUBLE_DROP_VERSION+' · 参数 #'+shortFishHash(JSON.stringify(doubleDrops)), '首次急跌前高与 ATR 固定；连续下跌只计一次，反弹脱离急跌区后再跌计第二次；5 分钟收盘收复前高才恢复。原箱体和防守线输出不变。');
    if(a.kStopVersion)add('addition-k-stop','加仓 K 止损','K / K′ 即时触价全仓卖出',a.kStopVersion,'盘中低于或等于 K 即触发，影线计入；开盘越线按开盘价，否则按 K。保本底线仍用于原定量，防守线收盘确认不再延迟 K。');
    const rounds = a.rounds?.length ? a.rounds : [a];
    // 加仓引擎本身（平衡公式、轮次、门槛、否决、减仓等），不含箱体——箱体按轮单列
    add('addition', '加仓规则', `最多 ${a.maxRounds ?? rounds.length} 次`, join([...versionTags(additionIdentity({ ...a, structure: undefined, rounds: a.rounds?.map(r => ({ ...r, structure: undefined })) })), ...versionTags(additionMirrorIdentity(a, plan.mirrorTakeProfit))]),
      '镜像止盈后按平衡公式 Q×(K−S)+P＝新增币数×(T−K) 定量，碰到 K 卖出');
    rounds.forEach((r, i) => {
      if (r.source === 'structure' && r.structure) {
        const v = structureVersions(r.structure), box = boxAlgorithmVersion(v.box), guard = v.guard ? boxAlgorithmVersion(v.guard) : undefined;
        const k = structureKSourceLabel(r.structure);
        add(`box-${i + 1}`, `第 ${i + 1} 次加仓 · 箱体算法`, join([box?.label ?? v.box, guard?.label, `K＝${k}−${r.structure.buffer}${r.structure.bufferUnit === 'atr' ? 'ATR' : '%'}${r.structure.minDistancePct != null ? `（离现价 ≥ ${r.structure.minDistancePct}%）` : ''}`]),
          join([v.box, v.guard, ...versionTags(additionIdentity({ ...a, rounds: undefined, source: 'structure', structure: r.structure })).filter(t => t.startsWith('k-from') || t.startsWith('box-addition') || t.startsWith('k-min-distance') || t.startsWith('guard-trend-only'))]),
          join([box?.summary, guard?.summary]));
      }
      // 2026-11-04 指标 S/T/K：触发指标的公式也进版本清单（之前只登记了同时满足的其它指标）
      if (r.source === 'custom') { const t = qualityAdditionConditions(r)[0]; if (t) add(`trigger-${i + 1}`, `第 ${i + 1} 次加仓 · 位置`, `${t.label} ${t.direction} ${t.threshold}${r.entryDistanceAtr != null ? ` · T≥S+${r.entryDistanceAtr}ATR` : ''} · K=T−${r.supportOffsetAtr ?? 1.5}ATR`, formulaFingerprint(t.snapshot), '指标 · S / T / K：指标达标且入场距离够时加仓'); }
      const dp = activeDetectorPrerequisite(r);
      if (dp) add(`detector-${i + 1}`, `第 ${i + 1} 次加仓 · 方向`, `${dp.featureId ?? '原探测算法（全部）'} 探测值提高 ≥ ${dp.stricterPct}%`, 'detector-prerequisite-v1', '加仓那一刻，探测读数须达到原门槛再提高这个百分比');
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
  for (const e of frozen) { const c = now.get(e.key); if (!c || c.version !== e.version && !(e.key==='router'&&equivalentRouterVersion(e.version,c.version))) out.push({ key: e.key, part: e.part, name: e.name, from: e.version, to: c?.version ?? null }); }
  for (const c of current) if (!was.has(c.key)) out.push({ key: c.key, part: c.part, name: c.name, from: null, to: c.version });
  return out;
}
export const planVersionChangeText = (changes: readonly PlanVersionChange[]) => changes.map(c => `${c.part}「${c.name}」：${c.from ?? '（无）'} → ${c.to ?? '（已不存在）'}`).join('；');

/** 方案里每个箱体规则写下所用版本（防守线参数写成明确值）。 */
export function withFrozenStructures(plan: QualityGroup): QualityGroup {
  if (plan.preEntryThreeStage) plan = { ...plan, preEntryThreeStage:freezePreEntryThreeStage(plan.preEntryThreeStage) };
  if (plan.preEntryConditions) plan = { ...plan, preEntryConditions: freezePreEntryConditions(plan.preEntryConditions) };
  if(plan.router)return {...plan,router:{...plan.router,structure:withFrozenStructures(plan.router.structure),attack:withFrozenStructures(plan.router.attack)}};
  const freezeVeto=(v:import('./qualityVeto').QualityHoldingVeto)=>v.boxStop?{...v,boxStop:freezeBoxStop(v.boxStop)}:v;
  if(plan.holdingVetoes?.some(v=>v.boxStop)||plan.vetoStages?.some(s=>s.conditions.some(v=>v.boxStop)))plan={...plan,holdingVetoes:plan.holdingVetoes?.map(freezeVeto),vetoStages:plan.vetoStages?.map(s=>({...s,conditions:s.conditions.map(freezeVeto)}))};
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
    // 旧引擎方案只读：始终沿用已冻结的清单（来自模板或上次保存），参数若被改动，运行时按版本不符拦下，不因「保存」而认可
    if (isLegacyQualityPlan(p)) return { ...b, frozenVersions: prev?.frozenVersions ?? p.frozenVersions ?? qualityPlanVersions(b) };
    if (prev?.frozenVersions && JSON.stringify(body(prev)) === JSON.stringify(b)) return { ...b, frozenVersions: prev.frozenVersions };
    return { ...b, frozenVersions: qualityPlanVersions(b) };
  });
}
/** 方案冻结的版本与当前代码的差异；没冻结过的旧方案视为当前版本。 */
export function planVersionChanges(plan: QualityGroup): PlanVersionChange[] {
  if (!plan.frozenVersions) return [];
  const current = body(plan);
  return comparePlanVersions(plan.frozenVersions, qualityPlanVersions(current)).filter(change => {
    const path = change.key.split(':'), key = path.pop();
    if (key !== 'hard-stop-params' || !change.from || !change.to) return true;
    let branch = current;
    for (const part of path) {
      if (!branch.router || (part !== 'structure' && part !== 'attack')) return true;
      branch = branch.router[part];
    }
    return !compatibleHoldingParameterOrder(branch.holdingVetoes, change.from);
  });
}
/**
 * 【用户要求】2026-11-03 模板里 11-01 之前形态的方案（带入场距离）只可能是旧引擎算的：标上旧引擎，
 * 换掉 11-03「从战役存模板」按当前代码误记的版本清单。这样新建出来的方案按 10-31 引擎算，结果与原战役一致。
 */
const needsLegacyEngine = (plan: QualityGroup) => !plan.engine && hasPreBoxAdditionShape(plan);
/** 打开时补记：还没冻结的方案与模板，按当前代码补一份清单（之后代码再变就能查出来）；旧形态的模板标为旧引擎。 */
export function backfillPlanVersions<S extends { sellPlans?: QualityGroup[]; planTemplates?: import('./qualityPlanTemplates').QualityPlanTemplate[] }>(study: S): S {
  const plans = study.sellPlans?.some(p => !p.frozenVersions), templates = study.planTemplates?.some(t => !t.deleted && t.plan && (!t.plan.frozenVersions || needsLegacyEngine(t.plan)));
  if (!plans && !templates) return study;
  return { ...study,
    ...(plans ? { sellPlans: study.sellPlans!.map(p => p.frozenVersions ? p : freezeQualityPlan(p)) } : {}),
    ...(templates ? { planTemplates: study.planTemplates!.map(t => !t.deleted && t.plan && needsLegacyEngine(t.plan) ? { ...t, plan: withLegacyEngine(t.plan) }
      : !t.deleted && t.plan && !t.plan.frozenVersions ? { ...t, plan: freezeQualityPlan(t.plan), versionsBackfilledAt: Date.now() } : t) } : {}) };
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
