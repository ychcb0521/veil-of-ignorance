/**
 * 批次 25：对冲单专属常量与计算。
 *
 * 第一性原理：对冲不是下注，是把"未知、不可控的无限风险"，换成"已知、可衡量的极小摩擦成本"。
 *
 * 两根滑块各司其职，互不污染：
 *  - 必要性（外部 → 定大小）：行情越不安全，保险越大。只由客观特征驱动。
 *  - 把握性（内部 → 定成色）：我多确定这个对冲是想清楚的决定，而不是吓出来的反应。
 * 铁律：把握性永远不能直接缩小对冲。大小归客观，把握归成色。
 * 因此本文件里，necessity 的推导【绝不引用】conviction。
 */
import type { HedgeBoundaryStance, HedgeType, HedgeOrderMethod, HedgeWorthIt } from '@/types/journal';

export interface HedgeTypeMeta {
  id: HedgeType;
  label: string;
  /** 适用场景一行话。 */
  sub: string;
  /** 边界价输入框的占位提示。 */
  boundaryHint: string;
  /** 是否需要"锁定微利%"字段（仅追踪型）。 */
  lockProfit: boolean;
  /** 向上分支预案默认值（可编辑，不可清空）。 */
  resolutionUpDefault: string;
  /** 向下分支预案默认值（可编辑，不可清空）。 */
  resolutionDownDefault: string;
}

export const HEDGE_TYPES: readonly HedgeTypeMeta[] = [
  {
    id: 'filter',
    label: '滤波对冲',
    sub: '无序震荡 · 保住下限',
    boundaryHint: 'N 倍 ATR 之外的噪音边界价',
    lockProfit: false,
    resolutionUpDefault: '向上击穿边界 → 混沌转秩序(上涨)，拆对冲顺势',
    resolutionDownDefault: '向下击穿边界 → 混沌转秩序(下跌)，观察后多空双平',
  },
  {
    id: 'trailing',
    label: '追踪锁定',
    sub: '单边拉升 · 把利润锁成新下限',
    boundaryHint: '新震荡中枢下沿偏下',
    lockProfit: true,
    resolutionUpDefault: '继续上涨 → 上移防线 / 拆对冲，继续骑',
    resolutionDownDefault: '被打到 → 带微利离场（不让浮盈熬成浮亏）',
  },
  {
    id: 'ratio',
    label: '比例对冲',
    sub: '主升浪/巨大浮盈 · 立于不败',
    boundaryHint: '关键阻力位',
    lockProfit: false,
    resolutionUpDefault: '假衰续涨 → 等于减仓，未对冲部分继续吃单边',
    resolutionDownDefault: '真跌(天地针) → 对冲激活，锁死已有利润',
  },
] as const;

export const HEDGE_DOWN_BRANCH_DEFAULTS = {
  chop: '小周期高点拆多单、低点拆空单（在区间里收割震荡）',
  trend: '多空双平——假设已被证伪，离场',
  rebound: '择机拆空单、只保留多单——刚才是假摔，回到方向',
} as const;

export function getHedgeType(id: HedgeType | null | undefined): HedgeTypeMeta | null {
  if (!id) return null;
  return HEDGE_TYPES.find(t => t.id === id) ?? null;
}

export const HEDGE_TYPE_LABELS: Record<HedgeType, string> = {
  filter: '滤波对冲',
  trailing: '追踪锁定',
  ratio: '比例对冲',
};

export const HEDGE_ORDER_METHOD_LABELS: Record<HedgeOrderMethod, string> = {
  limit_preset: '预先挂的限价单',
  market_chase: '现在市价追',
};

export const HEDGE_BOUNDARY_STANCE_LABELS: Record<HedgeBoundaryStance, string> = {
  early: '偏早',
  at_crossover: '大致在交叉点',
  late: '偏晚',
};

export const HEDGE_WORTH_IT_LABELS: Record<HedgeWorthIt, string> = {
  yes: '值',
  partial: '部分',
  no: '不值',
};

/** 值回成本评分：yes=1 / partial=0.5 / no=0，供对冲校准曲线计算"值回率"。 */
export const HEDGE_WORTH_IT_SCORE: Record<HedgeWorthIt, number> = {
  yes: 1,
  partial: 0.5,
  no: 0,
};

/** 必要性建议的谦逊偏移（百分点）：宁可多买一点保险——封下限的事不交给乐观。 */
export const NECESSITY_HUMILITY_OFFSET = 15;

/** 对冲大小硬顶：与主仓等额。 */
export const NECESSITY_MAX_PCT = 100;

export interface NecessitySuggestion {
  /** 尾部风险概率估计（0–100）。 */
  tailRiskPct: number;
  /** 风险烈度归一化估计（0–100）。 */
  magnitudePct: number;
  /** 未加谦逊偏移的原始必要性。 */
  necessityRaw: number;
  /** 加了 +15 谦逊偏移、并封顶 100 后的建议值。 */
  suggested: number;
}

/**
 * 由三个客观锚点推导必要性建议值（幽灵刻度）。
 * 注意：入参【只有】客观风险维度，绝不接受把握性 conviction —— 大小归客观。
 *
 * P_tail = (5 - (strength + regularity)/2) / 4
 * mag = riskMagnitude / 5
 * necessity_raw = P_tail × mag × 100
 * suggested = min(100, necessity_raw + 谦逊偏移)
 */
export function computeNecessitySuggestion(
  strength: number,
  regularity: number,
  riskMagnitude: number,
): NecessitySuggestion {
  const avg = (strength + regularity) / 2;
  const tailRisk = (5 - avg) / 4;
  const magnitude = riskMagnitude / 5;
  const necessityRaw = tailRisk * magnitude * 100;
  const suggested = Math.min(NECESSITY_MAX_PCT, Math.round(necessityRaw + NECESSITY_HUMILITY_OFFSET));
  return {
    tailRiskPct: Math.round(tailRisk * 100),
    magnitudePct: Math.round(magnitude * 100),
    necessityRaw: Math.round(necessityRaw),
    suggested,
  };
}
