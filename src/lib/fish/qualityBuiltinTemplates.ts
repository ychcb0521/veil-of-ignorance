/**
 * 【用户要求】2026-11-04 内置模板：把两场赢单复盘出的优势合成一套方案，直接放进「持仓监测 → 条件设置 → 从模板新建」的模板库。
 *
 * 两场赢单（持仓监测导出表，2026-11-04）：
 *  - RAVEUSDT · 3-3 卖出算法组合2：指标 S/T/K 加仓 7 次，状态 S 门槛逐轮抬高 0.7→0.9、涨幅门槛 10%→15%，
 *    基础止损 5% / 15%，15% 动态回撤止损收尾，+16,276（21.9%）。弱点：最后一次加仓后 1 分钟即止损（加在冲高回落里）。
 *  - SAPIENUSDT · 5069：DBL-5 箱体加仓 6 次，K＝新 C−0.1…1.3 ATR，状态 S > 0.65、涨幅 ≥ 3%，冲高回落否决；
 *    第 2 / 3 次加仓后换上 15% 动态回撤 + 1 分钟 5% + 5 分钟 7% 急跌否决，+57,025（20.5%）。弱点：基础动态回撤 30% 单独用会先碰 K 归零。
 *  两场的利润都来自第二层退出（回撤 / 急跌否决），CDA / 状态 S 指标卖出一次没触发；平衡公式让每轮加仓后 K 恰等于新均价。
 *
 * 合成（条件分支「结构为底·强势进攻」）：
 *  - 公共部分：CDA 原始值 < 0.5 → 涨 5.1% 后状态 S < 0.5；镜像 5% 卖 0.01%；基础止损取 RAVE 的 5% / 15%（不用 SAPIEN 的 30%）；
 *    第 2 次与第 3 次加仓后加 SAPIEN 的 1 分钟 5% / 5 分钟 7% 急跌否决（退出灵敏度随敞口收紧）；前两次加仓用 SAPIEN 的箱体位置、门槛与冲高回落否决。
 *  - 第二次加仓成交时读已收盘状态 S：> 0.85 走进攻分支（RAVE 第 3–8 次的 S/T/K 参数，再加上 RAVE 原来没有的冲高回落否决）；
 *    否则保持结构分支（SAPIEN 第 3–7 次的箱体参数、第 3 次后改用 CDA 卖出、支撑下移减仓）。
 *    0.85 取自两场读数：RAVE 各次加仓时状态 S 最低 0.904，SAPIEN 最高 0.796，两侧各留余量。
 *
 * 内置模板是代码里的配方：点「新建」那一刻按账号当前公式生成完整方案（CDA / 状态 S / DBL-5 的公式全文随之冻结），
 * 保存时再冻结版本清单——与手工新建的方案走完全相同的保存路径；不写入账号模板目录，也不能删除。
 *
 * 【用户要求】2026-11-05 版本 2（1081 信号库回放，510 场跑完、鱼质量-20261105084139）：
 *  - v1 的全部利润来自 3 场（SAPIEN +57,025、RAVE ×2 +49,328），36 场有加仓的里 27 场碰 K 归零；进攻分支只有 3 场到达——
 *    分流点在第二次结构加仓，而直线拉升的币（45 场峰值 ≥ 15%，中位 72 分钟到 +15%）最多只形成一个箱体，等不到第二次。
 *  - 1 分钟 K 线复盘：第一次箱体加仓碰 K 不是「K 太近」——把 K 放到新 C 下 0.3 / 0.5 / 1.0 ATR，27 场归零里 12 小时内还活着的仍只有 4 场；
 *    按 K 离加仓价 ≥ 5% 放宽才能多活 8 场，但加仓量缩到 24%、7 场根本加不进。首个箱体失守是方向问题，不是冗余问题，参数不改。
 *  - 首仓止损 4%–8%、动态回撤 10%–30%、+8% 后保本等对照，在 474 场无加仓里最多只差 ±73 USDT，维持 5% / 15%。
 *  因此 v2 只改一处：分流提前到第一次结构加仓成交时（已收盘状态 S > 0.85 走进攻，第 2–8 次用 RAVE 组合2 的第 2–8 次 S/T/K），
 *  其余与 v1 完全相同。两版同时保留，供同一批信号对照。
 */
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { QualityBuyFilter, QualityGroup } from './quality';
import { freezeStructureVersions } from './boxAlgorithmVersions';
import { defaultStructureAddition } from './qualityAdditionStructure';
import { validateQualityAddition, type QualityAdditionRoundRule, type QualityAdditionRule } from './qualityAddition';
import type { QualityAdditionEntryVeto } from './qualityAdditionVeto';
import { makeQualityBuyFilter, makeQualityHoldingVeto } from './qualityFilters';
import { validateQualityMirror } from './qualityMirror';
import { routerVersionFor, validateQualityRouter } from './qualityPlanRouter';
import { makeQualitySellPlan, newQualitySellPlanId } from './qualitySellPlans';
import { validateQualitySellStages } from './qualitySellStages';
import { validatePayoffStops, type QualityHoldingVeto } from './qualityVeto';
import { validateQualityVetoStages } from './qualityVetoStages';

export interface QualityBuiltinTemplate {
  id: string; name: string;
  /** 模板列表里的一段说明。 */
  summary: string;
  /** 用账号当前公式生成一套完整方案（新编号、新名称）；缺公式时抛出可读错误。 */
  build: (definitions: readonly DeepDigFeatureDef[], id?: string, label?: string) => QualityGroup;
}

export const FUSION_TEMPLATE_ID = 'builtin-structure-attack-fusion-2026-11-04';
export const FUSION_TEMPLATE_NAME = '结构为底·强势进攻（RAVE×SAPIEN 融合）';
/** 分流那一次加仓成交时的已收盘状态 S 高于它走进攻分支（两版共用）。 */
export const FUSION_ROUTER_THRESHOLD = 0.85;
export const FUSION_V2_TEMPLATE_ID = 'builtin-structure-attack-fusion-v2-2026-11-05';
export const FUSION_V2_TEMPLATE_NAME = '结构为底·强势进攻 v2（首次加仓即分流）';

const needs = (definitions: readonly DeepDigFeatureDef[], featureId: string, name: string) => {
  if (!definitions.some(d => d.id === featureId)) throw new Error(`内置模板需要账号公式「${name}」（${featureId}），请先在特征值里恢复它`);
};

/** 两版共用的配方；decideAt＝分流发生在第几次结构加仓（v1＝2，v2＝1）。 */
function buildFusionPlan(definitions: readonly DeepDigFeatureDef[], id: string, label: string, decideAt: 1 | 2): QualityGroup {
  needs(definitions, 'cda', 'CDA 买方阻力'); needs(definitions, 'state', '多空状态 S');
  // 同一门槛的方向条件只编译一次（每次 makeQualityBuyFilter 都会编译全部账号公式）
  const gates = new Map<number, QualityBuyFilter>();
  const stateGate = (threshold: number): QualityBuyFilter => { let f = gates.get(threshold); if (!f) { f = makeQualityBuyFilter('state:state', '>', threshold, true, definitions); gates.set(threshold, f); } return structuredClone(f); };
  const pullback = (): QualityAdditionEntryVeto => ({ kind: 'pullback', enabled: true, atr: 2.5, pct: 4, join: 'and' });
  // SAPIEN 的箱体位置：DBL-5 v2、K＝新 C − buffer×ATR，状态 S > 0.65、相对最新成本线涨 ≥ 3%，冲高回落（≥ 2.5 ATR 且 ≥ 4%）不加
  const box = (trigger: 'raise' | 'confirm', buffer: number): QualityAdditionRoundRule => ({ source: 'structure', stricterPct: 10,
    structure: freezeStructureVersions({ ...defaultStructureAddition('dbl5', definitions), trigger, buffer, kSource: 'current' }),
    prerequisites: [stateGate(0.65)], minGainPct: 3, entryVetoes: [pullback()] });
  // RAVE 的指标位置：状态 S 原始值 > 门槛、相对持仓均价涨 ≥ minGainPct、T ≥ S＋entryDistanceAtr×ATR、K＝T−supportOffsetAtr×ATR；补上冲高回落否决
  const stk = (threshold: number, minGainPct: number, entryDistanceAtr: number, supportOffsetAtr: number): QualityAdditionRoundRule => ({ source: 'custom', stricterPct: 10,
    condition: stateGate(threshold), minGainPct, gainBasis: 'average', entryDistanceAtr, supportOffsetAtr, entryVetoes: [pullback()] });
  // 与加仓编辑器保存时的形状一致：逐轮独立条件，第一轮同时写在顶层；支撑下移减仓用 v2（减仓所得不重复计入）
  const addition = (rounds: QualityAdditionRoundRule[]): QualityAdditionRule => ({ enabled: true, quantityMode: 'calculator', quantity: 1, repeat: true, maxRounds: rounds.length, rounds, ...rounds[0],
    supportReduction: { enabled: true, minDropAtr: 0.1, maxPct: 80, version: 2 } });

  const sell = makeQualitySellPlan('cda:CDA', '<', 0.5, definitions, undefined, id);
  const after = makeQualitySellPlan('state:state', '<', 0.5, definitions);
  const stop = (kind: 'static-drawdown' | 'dynamic-drawdown' | 'drop-1m' | 'drop-5m', threshold: number): QualityHoldingVeto => makeQualityHoldingVeto(kind, '>=', threshold, true, definitions);
  const stage = (afterAdditions: number) => ({ afterAdditions, conditions: [stop('dynamic-drawdown', 15), stop('drop-1m', 5), stop('drop-5m', 7)] });
  const shared: QualityGroup = { ...sell,
    combo: { switchPct: 5.1, beforeLabel: sell.label, after: { label: after.label, metric: after.metric, snapshot: after.snapshot, rule: after.rule! } },
    mirrorTakeProfit: { enabled: true, gainPct: 5, sellPct: 0.01 },
    holdingVetoes: [stop('static-drawdown', 5), stop('dynamic-drawdown', 15)],
    vetoStages: [stage(2), stage(3)], vetoStageMode: 'overlay', vetoPeakBasis: 'stage' };
  // 公共历史：分流前的箱体加仓两条分支逐位相同（v1 前两次、v2 第一次）
  const sapienBoxes = () => [box('raise', 0.1), box('confirm', 0.3), box('confirm', 0.5), box('raise', 0.7), box('raise', 0.9), box('raise', 1.1), box('raise', 1.3)];
  // RAVE 组合2 的第 2–8 次（S 0.75→0.9、涨幅 11%→15%→10%、入场距离 2→3.5 ATR、K 1.5→2.5 ATR）；分流后的每一次按同一次序取用
  const raveRounds = () => [stk(0.75, 11, 2, 1.5), stk(0.8, 12, 2, 1.5), stk(0.85, 13, 2, 1.5), stk(0.9, 14, 2, 1.5), stk(0.9, 15, 3, 2), stk(0.9, 10, 3, 2), stk(0.9, 10, 3.5, 2.5)];
  const structure: QualityGroup = { ...structuredClone(shared), id: `${id}:structure`, label: '结构分支（SAPIEN 5069）',
    addition: addition(sapienBoxes()),
    sellStages: [{ afterAdditions: 3, label: sell.label, metric: sell.metric, snapshot: structuredClone(sell.snapshot), rule: { metric: sell.metric, direction: '<', threshold: 0.5 } }] };
  const attack: QualityGroup = { ...structuredClone(shared), id: `${id}:attack`, label: decideAt === 2 ? '进攻分支（RAVE 组合2）' : '进攻分支（RAVE 组合2 第 2–8 次）',
    addition: addition([...sapienBoxes().slice(0, decideAt), ...raveRounds().slice(decideAt - 1)]) };
  for (const branch of [structure, attack]) {
    validateQualityAddition(branch.addition); validateQualityMirror(branch.mirrorTakeProfit); validatePayoffStops(branch.holdingVetoes);
    validateQualitySellStages(branch); validateQualityVetoStages(branch);
  }
  const plan: QualityGroup = { ...structuredClone(structure), id, label, router: { version: routerVersionFor(decideAt), afterAdditions: decideAt, threshold: FUSION_ROUTER_THRESHOLD, structure, attack } };
  validateQualityRouter(plan.router!);
  return plan;
}

/** v1：RAVE×SAPIEN 融合方案（第二次结构加仓成交时分流）。 */
export function buildFusionTemplatePlan(definitions: readonly DeepDigFeatureDef[], id = newQualitySellPlanId(), label = FUSION_TEMPLATE_NAME): QualityGroup {
  return buildFusionPlan(definitions, id, label, 2);
}
/** v2：同一套参数，分流提前到第一次结构加仓成交时。 */
export function buildFusionV2TemplatePlan(definitions: readonly DeepDigFeatureDef[], id = newQualitySellPlanId(), label = FUSION_V2_TEMPLATE_NAME): QualityGroup {
  return buildFusionPlan(definitions, id, label, 1);
}

export const BUILTIN_QUALITY_TEMPLATES: readonly QualityBuiltinTemplate[] = [{
  id: FUSION_V2_TEMPLATE_ID, name: FUSION_V2_TEMPLATE_NAME,
  summary: `与 v1 同一套买卖、止损与箱体参数，只把分流提前到第一次结构加仓成交时：已收盘状态 S > ${FUSION_ROUTER_THRESHOLD} 则第 2–8 次改用 RAVE 组合2 的第 2–8 次指标 S/T/K 进攻，否则第 2–7 次继续箱体。依据 2026-11-05 的 1081 信号回放：v1 只有 3/510 场到达进攻分支，直线拉升的币最多只形成一个箱体。`,
  build: buildFusionV2TemplatePlan,
}, {
  id: FUSION_TEMPLATE_ID, name: FUSION_TEMPLATE_NAME,
  summary: `前两次按 SAPIEN 5069 的 DBL-5 箱体加仓；第二次成交时已收盘状态 S > ${FUSION_ROUTER_THRESHOLD} 则第 3–8 次改用 RAVE 组合2 的指标 S/T/K 进攻（补冲高回落否决），否则第 3–7 次继续箱体。基础止损 5% / 15%；第 2、3 次加仓后加 1 分钟 5%、5 分钟 7% 急跌否决。`,
  build: buildFusionTemplatePlan,
}];
