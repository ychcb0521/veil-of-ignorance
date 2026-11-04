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
 */
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { QualityBuyFilter, QualityGroup } from './quality';
import { freezeStructureVersions } from './boxAlgorithmVersions';
import { defaultStructureAddition } from './qualityAdditionStructure';
import { validateQualityAddition, type QualityAdditionRoundRule, type QualityAdditionRule } from './qualityAddition';
import type { QualityAdditionEntryVeto } from './qualityAdditionVeto';
import { makeQualityBuyFilter, makeQualityHoldingVeto } from './qualityFilters';
import { validateQualityMirror } from './qualityMirror';
import { QUALITY_ROUTER_VERSION, validateQualityRouter } from './qualityPlanRouter';
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
/** 第二次加仓成交时的已收盘状态 S 高于它走进攻分支。 */
export const FUSION_ROUTER_THRESHOLD = 0.85;

const needs = (definitions: readonly DeepDigFeatureDef[], featureId: string, name: string) => {
  if (!definitions.some(d => d.id === featureId)) throw new Error(`内置模板需要账号公式「${name}」（${featureId}），请先在特征值里恢复它`);
};

/** RAVE×SAPIEN 融合方案（条件分支）。 */
export function buildFusionTemplatePlan(definitions: readonly DeepDigFeatureDef[], id = newQualitySellPlanId(), label = FUSION_TEMPLATE_NAME): QualityGroup {
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
  const firstTwo = [box('raise', 0.1), box('confirm', 0.3)];
  const structure: QualityGroup = { ...structuredClone(shared), id: `${id}:structure`, label: '结构分支（SAPIEN 5069）',
    addition: addition([...structuredClone(firstTwo), box('confirm', 0.5), box('raise', 0.7), box('raise', 0.9), box('raise', 1.1), box('raise', 1.3)]),
    sellStages: [{ afterAdditions: 3, label: sell.label, metric: sell.metric, snapshot: structuredClone(sell.snapshot), rule: { metric: sell.metric, direction: '<', threshold: 0.5 } }] };
  const attack: QualityGroup = { ...structuredClone(shared), id: `${id}:attack`, label: '进攻分支（RAVE 组合2）',
    addition: addition([...structuredClone(firstTwo), stk(0.8, 12, 2, 1.5), stk(0.85, 13, 2, 1.5), stk(0.9, 14, 2, 1.5), stk(0.9, 15, 3, 2), stk(0.9, 10, 3, 2), stk(0.9, 10, 3.5, 2.5)]) };
  for (const branch of [structure, attack]) {
    validateQualityAddition(branch.addition); validateQualityMirror(branch.mirrorTakeProfit); validatePayoffStops(branch.holdingVetoes);
    validateQualitySellStages(branch); validateQualityVetoStages(branch);
  }
  const plan: QualityGroup = { ...structuredClone(structure), id, label, router: { version: QUALITY_ROUTER_VERSION, afterAdditions: 2, threshold: FUSION_ROUTER_THRESHOLD, structure, attack } };
  validateQualityRouter(plan.router!);
  return plan;
}

export const BUILTIN_QUALITY_TEMPLATES: readonly QualityBuiltinTemplate[] = [{
  id: FUSION_TEMPLATE_ID, name: FUSION_TEMPLATE_NAME,
  summary: `前两次按 SAPIEN 5069 的 DBL-5 箱体加仓；第二次成交时已收盘状态 S > ${FUSION_ROUTER_THRESHOLD} 则第 3–8 次改用 RAVE 组合2 的指标 S/T/K 进攻（补冲高回落否决），否则第 3–7 次继续箱体。基础止损 5% / 15%；第 2、3 次加仓后加 1 分钟 5%、5 分钟 7% 急跌否决。`,
  build: buildFusionTemplatePlan,
}];
