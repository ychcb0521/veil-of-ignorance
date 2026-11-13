import { ADDITION_INDICATOR_TIME_VERSION, INDICATOR_FORMULA_TIME_VERSION, INDICATOR_PERIOD_VERSION, hasAdditionMetricTime, hasMetricPeriodOverride, hasMetricFormulaTimeOverride } from './qualityAdditionMetric';
import { expressionConditions } from './preEntryThreeStage';
import {HOLDING_LEDGER_ADDITION_VERSION} from './qualityHoldingLedger';
import {BOX_STOP_KIND,freezeBoxStop,isBoxBreak,boxStopLabel,boxStopIdentity} from './qualityBoxStop';
import { freezePreEntryConditions, preEntryConditionsVersion } from './preEntryConditions';
import { TURING_INITIALIZATION_VERSION } from './qualityInitialization';
import { routerFingerprint, routerVersionSummary, validateQualityRouter, equivalentRouterVersion } from './qualityPlanRouter';
import { qualityAdvantageFingerprint, validateQualityAdvantage, QUALITY_ADVANTAGE_VERSION } from './qualityAdvantage';
import { DOUBLE_DROP_VERSION } from './qualityDoubleDrop';
import { LOWER_WICK_VETO_VERSION, VETO_HISTORY_VERSION, GUARD_DISTANCE_VETO_VERSION, additionVetoIdentity, isFiveMinuteShapeVeto } from './qualityAdditionVeto';
import { compatibleHoldingParameterOrder, compatibleAdditionParameterOrder } from './qualityPlanParameterCompatibility';
import { freezePreEntryThreeStage, threeStageFingerprint, stableEntryJson, PRE_ENTRY_OPTIONAL_STAGES_VERSION, PRE_ENTRY_SIGNAL_ANCHOR_VERSION } from './preEntryThreeStage';
import { ENTRY_STALL_TURN_5M_VERSION, PULLBACK_NEW_HIGH_5M_VERSION } from './preEntryStallTurn5m';
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
import { isStaticDrawdownSell, qualityExitThresholdText, STATIC_DRAWDOWN_SELL_LABEL, STATIC_DRAWDOWN_SELL_VERSION } from './qualityStaticDrawdownSell';
import { activeHoldingVetoes, holdingVetoIdentity, holdingVetoLabel } from './qualityVeto';
import { mirrorExecutionIdentity, mirrorIdentity } from './qualityMirror';
import { activeDetectorPrerequisite, additionIdentity, additionIncreaseIdentity, additionMirrorIdentity, qualityAdditionConditions, qualityAdditionPrerequisites } from './qualityAddition';
import { qualityVetoStagesIdentity } from './qualityVetoStages';
import { qualitySellStagesIdentity } from './qualitySellStages';
import { BOX_K_EXECUTION_VERSIONS, boxAlgorithmVersion, freezeStructureVersions, structureVersions } from './boxAlgorithmVersions';
import { structureKSourceLabel } from './qualityAdditionStructure';
import type { FishSnapshot } from './algorithm';
import { hasPreBoxAdditionShape, isLegacyQualityPlan, legacyPlanVersions, withLegacyEngine } from './qualityLegacyEngine';

export interface PlanVersionEntry {
  /** 稳定键：同一方案前后比较时按它对齐。 */
  key: string;
  /** 所属部分：卖出算法、镜像平衡减仓、硬性终止、加仓、箱体算法…… */
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
  const stallTurn=plan.preEntryThreeStage?.stallTurn;
  if(stallTurn?.enabled)out.push({key:'entry-stall-turn',part:'动态筛选·一票否决',name:'上涨后滞涨转弱／猛烈回调未创新高',version:stallTurn.version+' · 参数 #'+shortFishHash(stableEntryJson(stallTurn)),summary:stallTurn.version===ENTRY_STALL_TURN_5M_VERSION?'仅用已收盘5分钟K线；三段时间为5分钟整数倍，涨不动且转弱时锁定；连续5分钟收盘递升并收复局部高点才解除。猛烈回调锁定须5分钟收盘严格突破冻结前高。盘中不更新触发或解除，独立历史重建；原1分钟模板继续按原版本执行。':'上涨、滞涨、转弱依次成立时锁定，连续收盘递升且收复局部收盘高点才解除；可同时启用猛烈回调锁定，须分钟收盘严格突破冻结前高才解除。两者任一成立即否决，仅用已收盘分钟，独立历史重建。研究初值，不改变旧模板。'});
  const sharedVetoes=[...(plan.preEntryThreeStage?.additionVetoes??[]),...(plan.preEntryConditions?.entryVetoes??[]),...(plan.addition?.enabled?[plan.addition,...(plan.addition.rounds??[]),...(plan.addition.alternativeRounds??[])].flatMap(r=>r.entryVetoes??[]):[])].filter(v=>v.enabled);
  const historicalVetoes=sharedVetoes.filter(v=>v.historyHours!=null&&!isFiveMinuteShapeVeto(v));
  if(historicalVetoes.length)out.push({key:'veto-history',part:'一票否决',name:'独立历史扫描范围',version:VETO_HISTORY_VERSION+' · 参数 #'+shortFishHash(JSON.stringify(historicalVetoes)),summary:'按每次判断时点向前回看，包含入选和持仓之前的行情；影线与插针扫描整个历史窗口，高震荡检查窗口内观测，急跌检查窗口内分钟线；未收复高点锁定不因重筛或窗口滑动清除。旧范围另行保留。'});
  const distances=sharedVetoes.filter(v=>v.kind==='guard-distance');
  if(distances.length)out.push({key:'shared-guard-distance',part:'共用一票否决',name:'距 DBL-5 防守线过远',version:GUARD_DISTANCE_VETO_VERSION+' · 参数 #'+shortFishHash(stableEntryJson(additionVetoIdentity(distances))),summary:'候选时点的最近 1 分钟收盘价高出已收盘 5 分钟防守线超过 N 倍原生 ATR(14) 即否决；缺有效读数时暂不放行。'});
  const shapeVetoes=sharedVetoes.filter(isFiveMinuteShapeVeto);
  for(const kind of ['stall-turn','pullback-new-high'] as const){const rules=shapeVetoes.filter(v=>v.kind===kind);if(rules.length)out.push({key:'shared-'+kind,part:'共用一票否决',name:kind==='stall-turn'?'滞涨转弱（5分钟）':'猛烈回调未创新高（5分钟）',version:(kind==='stall-turn'?ENTRY_STALL_TURN_5M_VERSION:PULLBACK_NEW_HIGH_5M_VERSION)+' · 参数 #'+shortFishHash(stableEntryJson(rules)),summary:'动态筛选与持仓加仓共用、独立开关；只在5分钟收盘后更新，独立回看和恢复锁定，不改写旧模板。'});}
  const lowerWicks=[...(plan.preEntryThreeStage?.additionVetoes??[]),...(plan.preEntryConditions?.entryVetoes??[]),...(plan.addition?.enabled?[plan.addition,...(plan.addition.rounds??[]),...(plan.addition.alternativeRounds??[])].flatMap(r=>r.entryVetoes??[]):[])].filter(v=>v.enabled&&v.kind==='lower-wick');
  if(lowerWicks.length)out.push({key:'lower-wick-veto',part:'一票否决',name:'长下影线',version:LOWER_WICK_VETO_VERSION+' · 参数 #'+shortFishHash(JSON.stringify(lowerWicks)),summary:'只读已收盘 5 分钟 K 线；下影＝min(开盘,收盘)−最低价，长度达到 ATR 倍数且占整根振幅达到比例时否决，与长上影线对称。'});
  if (plan.preEntryThreeStage) out.push({key:'pre-entry-three-stage',part:'动态筛选',name:'三阶同刻准入',version:plan.preEntryThreeStage.version+' · 参数 #'+threeStageFingerprint(plan.preEntryThreeStage),summary:plan.preEntryThreeStage.version===PRE_ENTRY_SIGNAL_ANCHOR_VERSION?'跳过事件准入时，按原信号时点或动态门槛首次达标时点检查排除，检查通过后在该时点入选。启用事件准入时，按通过排除检查的候选事件时点入选。':plan.preEntryThreeStage.version===PRE_ENTRY_OPTIONAL_STAGES_VERSION?'必要条件、事件准入、排除检查各自启用或跳过。首次具备资格时，已达标的准入指标可立即产生候选。否决后继续观察，沿用原总截止时间。':plan.preEntryThreeStage.version==='pre-entry-three-stage-v9'?'两项均启用时先判静态门槛。静态达标即观察新事件，未通过才进入动态追踪，沿用原总截止时间。':plan.preEntryThreeStage.version==='pre-entry-three-stage-v8'?'必要条件只在原信号时点判定一次；任一新事件触发候选后向前检查排除条件，否决后继续找下一次新事件。首次满足时间为通过排除检查的新事件时刻。':plan.preEntryThreeStage.observationBasis==='retry-origin-v2'?'多条准入算法取或，必要条件和排除门槛仍须同刻通过；否决后从下一分钟重建观察起点；原门槛和总截止时间不变；指标保留预热，原生防守线不重启、旧事件不延期兑现。':'加仓共用资格、完整卖出排除及原生防守线更新同刻判断；观察起点固定，旧事件不延期兑现。'});
  if (plan.preEntryConditions) out.push({ key: 'pre-entry-conditions', part: '动态筛选', name: '入选条件与三组否决', version: preEntryConditionsVersion(plan), summary: '同一分钟入选条件全部满足且无否决；从筛选起点累计观察，不模拟持仓，旧轮次不升级。' });
  const add = (key: string, part: string, name: string, version: string, summary: string) => out.push({ key, part, name, version, summary });
  const s = plan.snapshot;
  const screening = plan.preEntryThreeStage;
  const metricSnapshots = [
    s, plan.combo?.after.snapshot, ...(plan.buyFilters??[]).map(rule=>rule.snapshot),
    ...(plan.holdingVetoes??[]).map(rule=>rule.snapshot),
    ...(plan.vetoStages??[]).flatMap(stage=>stage.conditions.map(rule=>rule.snapshot)),
    ...(plan.sellStages??[]).map(stage=>stage.snapshot),
    ...[plan.addition,...(plan.addition?.rounds??[]),...(plan.addition?.alternativeRounds??[])].flatMap(round=>round ? [
      ...qualityAdditionConditions(round),...qualityAdditionPrerequisites(round),...(round.indicatorIncrease?.metrics??[]),
    ].map(rule=>rule.snapshot) : []),
    ...(screening?.required??[]).map(rule=>rule.snapshot), ...(screening?.admission?.algorithms??[]).map(rule=>rule.snapshot),
    ...(screening?.sellRules??[]).flatMap(rule=>expressionConditions(rule.expression).map(condition=>condition.snapshot)),
    ...(screening?.hardVetoes??[]).map(rule=>rule.snapshot),
  ].filter((snapshot):snapshot is FishSnapshot=>!!snapshot);
  const periodSnapshots = metricSnapshots.filter(hasMetricPeriodOverride);
  if (periodSnapshots.length) add('indicator-period','指标周期','逐条冻结 K 线周期',
    join([INDICATOR_PERIOD_VERSION,...new Set(periodSnapshots.map(formulaFingerprint))]),
    '按每条指标保存的周期读数或逐分钟复原，时间参数随公式快照冻结。');
  const formulaTimes = metricSnapshots.filter(hasMetricFormulaTimeOverride);
  if (formulaTimes.length) add('indicator-formula-time','指标时间参数','逐条冻结计算窗口与公式参数',
    join([INDICATOR_FORMULA_TIME_VERSION,...new Set(formulaTimes.map(formulaFingerprint))]),
    '同一条均值序列可独立设置公式本身的回看或半衰期，以及均值窗口。');
  if(plan.advantage)add('advantage','优势筛选与退出灵敏度','逐次筛选 · 软退出动态确认',QUALITY_ADVANTAGE_VERSION+' · 参数 #'+qualityAdvantageFingerprint(plan),
    `W 同步走弱筛选${plan.advantage.screenWeak?'开':'关'}；首加前确认${plan.advantage.beforeFirst?'开':'关'}，加仓后 A 级确认${plan.advantage.afterAddition?'开':'关'}，${plan.advantage.confirmations} 根已完成 1 分钟；其余单次，原定量/K/硬止损不变；候选未验证收益。`);
  if (isStaticDrawdownSell(plan.rule)) add('sell', '卖出算法', `${STATIC_DRAWDOWN_SELL_LABEL} ${qualityExitThresholdText(plan.rule)}`,
    `${STATIC_DRAWDOWN_SELL_VERSION} · 参数 #${shortFishHash(JSON.stringify(plan.rule))}`, '按首仓买入价计算止损线，按分钟行情触价或跳空开盘价成交。');
  else if (plan.rule || plan.combo) add('sell', '卖出算法', `${s.featureShort ?? plan.label} ${plan.rule ? `${plan.rule.direction} ${plan.rule.threshold}` : ''}`.trim(), formulaFingerprint(s),
    `${plan.definitionSource === 'account' ? '账号公式（保存时冻结全文）' : '历史公式'} · ${s.interval ?? '5m'}`);
  if (plan.combo) {
    const a = plan.combo.after;
    add('combo', '组合切换', `涨 ${plan.combo.switchPct}% 后改用 ${a.snapshot.featureShort ?? a.label} ${qualityExitThresholdText(a.rule)}`,
      join([...versionTags(qualityComboIdentity(plan)), formulaFingerprint(a.snapshot)]), '持仓最高价首次比买入价高出切换涨幅的那一分钟收盘起，改用后段算法');
  }
  if (isStaticDrawdownSell(plan.combo?.after.rule)) add('sell-after-static', '卖出算法后段', STATIC_DRAWDOWN_SELL_LABEL,
    `${STATIC_DRAWDOWN_SELL_VERSION} · 参数 #${shortFishHash(JSON.stringify(plan.combo.after.rule))}`, '切换后的首根分钟起，按首仓买入价的固定止损线模拟成交。');
  const closePeriod = hasMetricPeriodOverride(s) ? s.interval : undefined;
  add('execution', '卖出执行', plan.execution === 'intrabar-1m' ? '盘中达标 · 1 分钟复原' : (closePeriod??'5 分钟')+'收盘确认', plan.execution === 'intrabar-1m' ? 'intrabar-1m-v1' : 'close-confirm',
    plan.execution === 'intrabar-1m' ? (periodSnapshots.length ? '用 1 分钟线复原所选周期指标，盘中达标即卖' : '用 1 分钟线复原 5 分钟指标，盘中达标即卖') : '只认 '+(closePeriod??'5 分钟')+'收盘读数');
  const mirror = [...versionTags(mirrorIdentity(plan.mirrorTakeProfit)), ...versionTags(mirrorExecutionIdentity(plan))];
  if (plan.mirrorTakeProfit?.enabled) add('mirror', '镜像平衡减仓', `涨 ${plan.mirrorTakeProfit.gainPct}% 卖 ${plan.mirrorTakeProfit.sellPct}%`, join(mirror), '限价镜像止盈，只卖一次');
  const vetoes = activeHoldingVetoes(plan.holdingVetoes);
  if (vetoes.length) add('hard-stop', '硬性终止', vetoes.map(v => holdingVetoLabel(v)).join(' 或 '),
    join([qualityVetoVersion(plan), ...vetoes.filter(v => v.snapshot?.definitionKey).map(v => formulaFingerprint(v.snapshot!))]),
    plan.vetoFill === 'stop' ? '回撤止损盘中触及按止损价成交' : '回撤否决下一分钟开盘成交');
  vetoes.filter(v => v.kind === BOX_STOP_KIND).forEach((v, i) => {
    const r = v.boxStop!, versions = structureVersions(r.structure);
    const version = join([r.version, versions.box, versions.guard, r.guardRegime && '参数 #' + shortFishHash(JSON.stringify(boxStopIdentity(r)))]);
    const summary = BOX_K_EXECUTION_VERSIONS.find(item => item.id === r.version)?.summary
      ?? (isBoxBreak(r) ? '仅在原生 DBL-5 防守线红叉确认后，按下一分钟开盘价全仓卖出；不将影线或缺失线当断裂' : '独立箱体止损；只用已收盘 5 分钟结构，触价或收盘确认由用户选择');
    add(`hard-stop-box-${i}`, '硬性终止', boxStopLabel(r), version, summary);
  });
  const a = plan.addition;
  if (a?.enabled) {
    const doubleDrops=[a,...(a.rounds??[]),...(a.alternativeRounds??[])].map(r=>(r.entryVetoes??[]).filter(v=>v.enabled&&v.kind==='double-drop')).filter(r=>r.length);
    if(doubleDrops.length)add('addition-support-quality','加仓否决','二次急跌未收复前高',DOUBLE_DROP_VERSION+' · 参数 #'+shortFishHash(JSON.stringify(doubleDrops)), '首次急跌前高与 ATR 固定；连续下跌只计一次，反弹脱离急跌区后再跌计第二次；5 分钟收盘收复前高才恢复。原箱体和防守线输出不变。');
    if(a.kStopVersion)add('addition-k-stop','加仓 K 止损','K / K′ 即时触价全仓卖出',a.kStopVersion,'盘中低于或等于 K 即触发，影线计入；开盘越线按开盘价，否则按 K。保本底线仍用于原定量，防守线收盘确认不再延迟 K。');
    const rounds = a.rounds?.length ? a.rounds : [a];
    const timed = [
      ...[...rounds, ...(a.alternativeRounds ?? [])].flatMap(round => [
        ...(round.source === 'custom' ? qualityAdditionConditions(round) : qualityAdditionPrerequisites(round)),
        ...(round.indicatorIncrease?.metrics ?? []),
      ]),
      ...(plan.sellStages ?? []),
    ].filter(metric => hasAdditionMetricTime(metric.snapshot));
    if (timed.length) add('addition-indicator-time', '加仓指标时间', [...new Set(timed.map(metric => metric.label))].join('、'),
      ADDITION_INDICATOR_TIME_VERSION + ' · 参数 #' + shortFishHash(JSON.stringify(timed.map(metric => [metric.metric, metric.snapshot.definitionKey]))),
      '在单条条件中冻结公式时间参数。avg₂ 使用近到远 4∶3∶2∶1 四段加权，递增比较的两个时点使用同一份公式。');
    // 加仓引擎本身（平衡公式、轮次、门槛、否决、减仓等），不含箱体——箱体按轮单列
    add('addition', '加仓规则', `最多 ${a.maxRounds ?? rounds.length} 次`, join([...versionTags(additionIdentity({ ...a, structure: undefined, rounds: a.rounds?.map(r => ({ ...r, structure: undefined })) })), ...versionTags(additionMirrorIdentity(a, plan.mirrorTakeProfit))]),
      a.positionVersion===HOLDING_LEDGER_ADDITION_VERSION?'通用持仓账：Q×K−剩余成本＋已实现净盈亏＝新增币数×(T−K)；镜像可选，实际成交后才计入账本':'镜像止盈后按平衡公式 Q×(K−S)+P＝新增币数×(T−K) 定量，碰到 K 卖出');
    const addIncreaseVersions = (rules: readonly import('./qualityAddition').QualityAdditionRoundRule[], alternative = false) => {
      rules.forEach((round, index) => {
        const growth = round.indicatorIncrease;
        if (!growth) return;
        add(`addition-increase-${alternative ? 'alternative-' : ''}${index+1}`,
          `第 ${index+1} 次加仓 · ${alternative ? '进攻备选 · ' : ''}方向`,
          growth.metrics.map(metric => metric.label).join('、'),
          growth.version+' · 参数 #'+shortFishHash(JSON.stringify(additionIncreaseIdentity(growth))),
          '所选指标的已收盘读数均须严格高于上一次实际加仓时的同算法读数。首次加仓以首仓买入时为基准。');
      });
    };
    addIncreaseVersions(rounds);
    if (a.alternativeRounds) addIncreaseVersions(a.alternativeRounds, true);
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
    if (!key || !['hard-stop-params','lower-wick-veto','veto-history','addition-support-quality'].includes(key) || !change.from || !change.to) return true;
    let branch = current;
    for (const part of path) {
      if (!branch.router || (part !== 'structure' && part !== 'attack')) return true;
      branch = branch.router[part];
    }
    return !(key === 'hard-stop-params' ? compatibleHoldingParameterOrder(branch.holdingVetoes, change.from) : compatibleAdditionParameterOrder(branch, key, change.from));
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
