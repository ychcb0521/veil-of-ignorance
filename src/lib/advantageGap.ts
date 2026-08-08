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
      /** 优势边际 = P − P₀；P 未填写时为 null。 */
      gap: number | null;
    };

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

  const gap = isFinitePrice(p) ? p - baseline : null;
  return { valid: true, direction, baseline, gap };
}
