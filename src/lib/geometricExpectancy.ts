/**
 * 几何期望（每笔）：把「算术期望」升级为「复利期望」。
 *
 * 算术期望 E = p·b − (1−p) 只看加法边际；它看不见「波动拖累」——同一个 edge 押太大，
 * 算术期望仍为正、几何却翻负，账户长期归零。几何增长才是本金真正的长期命运：
 *
 *   单笔几何增长  G = (1+b·x)^p · (1−x)^(1−p)      （赢 ×(1+bx)，亏 ×(1−x)，按胜率复利）
 *   n 笔复利      W = G^n
 *
 * x = 每笔按资金比例的「最大预期回撤 / 下注比例」。给定 (p,b) 时，令 G 最大的
 * x* = (p·b − (1−p)) / b 即 Kelly 最优仓位。G−1 就是「每笔真实复利率」。
 */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 单笔几何增长因子 G = (1+bx)^p·(1−x)^(1−p)。
 * x≤0（不下注）→ 1（不增不减）；x≥1 或亏损腿 ≤0（会亏光）→ 0（判死）。
 */
export function geometricGrowthFactor(winRate: number, payoffRatio: number, drawdownFraction: number): number {
  const p = clamp01(winRate);
  const b = payoffRatio;
  const x = drawdownFraction;
  if (!Number.isFinite(x) || x <= 0) return 1;
  if (x >= 1 || !Number.isFinite(b)) return 0;
  const winLeg = 1 + b * x;
  const lossLeg = 1 - x;
  if (winLeg <= 0 || lossLeg <= 0) return 0;
  return Math.pow(winLeg, p) * Math.pow(lossLeg, 1 - p);
}

/** Kelly 最优下注比例 x* = (p·b − (1−p)) / b，夹在 [0, 1)。负 edge → 0（不该下注）。 */
export function optimalDrawdownFraction(winRate: number, payoffRatio: number): number {
  const p = clamp01(winRate);
  const b = payoffRatio;
  if (!Number.isFinite(b) || b <= 0) return 0;
  const f = (p * b - (1 - p)) / b;
  if (!Number.isFinite(f) || f <= 0) return 0;
  return Math.min(f, 0.999);
}

export interface GeometricExpectancy {
  /** 实际用于计算的下注比例 x（未显式给定时 = Kelly 最优 x*）。 */
  drawdownFraction: number;
  /** Kelly 最优下注比例 x*（0 = 负 edge，不该下注）。 */
  optimalFraction: number;
  /** 单笔几何增长因子 G。 */
  growthFactor: number;
  /** 每笔几何期望 = G − 1（每笔真实复利率）。 */
  geometricEdge: number;
  /** ln(G)，对数增长率（可跨 n 相加）。G≤0 时为 −Infinity。 */
  logGrowth: number;
  /** 是否长期缩水：G < 1（正算术期望也可能中招）。 */
  bleeds: boolean;
}

/**
 * 计算几何期望。未给 drawdownFraction 时用 Kelly 最优 x*（= 该 edge 在最优下注下的复利潜力，
 * 与 n 无关、可横向排序）。给了 drawdownFraction（包括显式的 0）则按该实际仓位算；
 * 这也允许带符号的 b<0 在固定正仓位下呈现负几何期望，而不是被最优仓位 0 吞掉。
 * 实际 x 不封顶：x≥1 代表最大预期亏损已经覆盖全部账户权益，几何增长按 0 处理。
 * 入参不足（p / b 缺失）→ null。
 */
export function computeGeometricExpectancy(
  winRate: number | null | undefined,
  payoffRatio: number | null | undefined,
  drawdownFraction?: number | null,
): GeometricExpectancy | null {
  if (winRate == null || payoffRatio == null || !Number.isFinite(winRate) || !Number.isFinite(payoffRatio)) {
    return null;
  }
  const optimalFraction = optimalDrawdownFraction(winRate, payoffRatio);
  const x = drawdownFraction != null && Number.isFinite(drawdownFraction)
    ? Math.max(0, drawdownFraction)
    : optimalFraction;
  const growthFactor = geometricGrowthFactor(winRate, payoffRatio, x);
  return {
    drawdownFraction: x,
    optimalFraction,
    growthFactor,
    geometricEdge: growthFactor - 1,
    logGrowth: growthFactor > 0 ? Math.log(growthFactor) : Number.NEGATIVE_INFINITY,
    bleeds: growthFactor < 1,
  };
}
