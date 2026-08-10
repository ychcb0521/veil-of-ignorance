/**
 * 优势边际 gap —— 一块纯读数的仪表。
 *
 * 基线概率 P₀ = |S − K| ÷ |T − K|
 *   在没有任何优势的市场里，价格从 S 出发先摸到 T 而不是先摸到 K 的概率。
 *   它是市场免费给的胜率：把止损放得越远、目标放得越近，P₀ 越高。
 * 优势边际 gap = P − P₀
 *   主观胜率 P 高出基线的部分，才是真正属于你的边际。gap ≤ 0 即优势已耗尽。
 *
 * 方向由 S、K、T 的相对位置推断，不由用户选择：
 *   多头 K < S < T；空头 T < S < K。两者都不成立（含 T === K）时不出数字。
 */

export type AdvantageGapDirection = 'long' | 'short';

export type AdvantageGapInvalidReason =
  /** S / K / T 里有非有限数（含尚未填写）。 */
  | 'incomplete'
  /** T === K，|T − K| 为 0，基线概率无意义。 */
  | 'degenerate'
  /** 既不满足 K < S < T，也不满足 T < S < K。 */
  | 'direction';

export type AdvantageGapResult =
  | { valid: false; reason: AdvantageGapInvalidReason }
  | {
      valid: true;
      direction: AdvantageGapDirection;
      /** 基线概率，0–1 之间的小数。 */
      baseline: number;
      /**
       * 动态赔率 b = (T − S) ÷ (S − K)：这一刻的盈亏比——赚一份要走的距离
       * 相对亏一份要走的距离。多空两个方向下分子分母同号，b 恒为正。
       *
       * 恒等式：1 ÷ (1 + b) ≡ P₀。把 b 代入即得
       *   1/(1+b) = (S−K) / ((S−K)+(T−S)) = (S−K)/(T−K) = P₀
       * 也就是说，「市场免费给的胜率」正是这一刻赔率下的盈亏平衡胜率。
       */
      payoffRatio: number;
      /** 优势边际 = P − P₀；P 未填写时为 null。 */
      gap: number | null;
    };

/** 盈亏平衡胜率 P = 1 ÷ (1 + b)：赔率 b 下不亏不赚所需的最低胜率。 */
export function breakEvenWinRate(payoffRatio: number): number | null {
  if (!Number.isFinite(payoffRatio) || payoffRatio <= -1) return null;
  return 1 / (1 + payoffRatio);
}

/**
 * 可落袋盈亏比 b_可落袋 —— 此刻立即止盈能拿到几个 R。
 *
 *   b_可落袋 = 当前未实现盈亏 ÷ 该多单的预期最大亏损
 *
 * 注意数量会约掉，所以它等价于纯价格形式：
 *   未实现盈亏 = (S − 开仓价) × 数量
 *   预期最大亏损 L = 名义仓位 × 价距 ÷ 开仓价 = 数量 × 价距
 *   ⇒ b_可落袋 = (S − 开仓价) ÷ (开仓价 − K)
 * 两种读法给出同一个数，与战役里的 bᵢ =（已实现盈亏 ÷ Lᵢ）同一量纲，可直接对照。
 *
 * 多笔多单时传入按数量加权的平均开仓价——加权均价正是让上式对总仓位成立的那个值。
 *
 * @param s 现价
 * @param entryPrice 多单（加权平均）开仓价
 * @param k 止损价，用于度量预期最大亏损的价距
 * @returns 正数=此刻落袋为盈，负数=此刻落袋为亏；无多单或止损不在开仓价下方时为 null
 */
export function computeBankableRatio(
  s: number | null | undefined,
  entryPrice: number | null | undefined,
  k: number | null | undefined,
): number | null {
  if (!isFinitePrice(s) || !isFinitePrice(entryPrice) || !isFinitePrice(k)) return null;
  // 多单的止损必须低于开仓价，否则「预期最大亏损」无意义（价距 ≤ 0）
  const riskDistance = entryPrice - k;
  if (riskDistance <= 0) return null;
  const ratio = (s - entryPrice) / riskDistance;
  return Number.isFinite(ratio) ? ratio : null;
}

function isFinitePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param p 主观胜率，0–1 的小数；null = 用户尚未给出（P 无默认值）。
 */
export function computeAdvantageGap(
  s: number | null | undefined,
  k: number | null | undefined,
  t: number | null | undefined,
  p: number | null | undefined,
): AdvantageGapResult {
  if (!isFinitePrice(s) || !isFinitePrice(k) || !isFinitePrice(t)) {
    return { valid: false, reason: 'incomplete' };
  }
  if (t === k) return { valid: false, reason: 'degenerate' };

  const direction: AdvantageGapDirection | null = k < s && s < t
    ? 'long'
    : t < s && s < k
      ? 'short'
      : null;
  if (direction == null) return { valid: false, reason: 'direction' };

  const baseline = Math.abs(s - k) / Math.abs(t - k);
  if (!Number.isFinite(baseline)) return { valid: false, reason: 'degenerate' };

  const payoffRatio = (t - s) / (s - k);
  if (!Number.isFinite(payoffRatio)) return { valid: false, reason: 'degenerate' };

  const gap = isFinitePrice(p) ? p - baseline : null;
  return { valid: true, direction, baseline, payoffRatio, gap };
}
