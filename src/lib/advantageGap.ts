/**
 * 优势边际 gap —— 一块纯读数的仪表。
 *
 * 基线概率 P₀ =（S − K）÷（T − K）
 *   在没有任何优势的市场里，价格从 S 出发先摸到 T 而不是先摸到 K 的概率。
 *   它是市场免费给的胜率：把止损放得越远、目标放得越近，P₀ 越高。
 *   S 越界时不截断：跌破止损为负、越过目标 >1。
 * 优势边际 gap = P − P₀
 *   主观胜率 P 高出基线的部分，才是真正属于你的边际。gap ≤ 0 即优势已耗尽。
 *
 * 方向由 T 相对 K 的位置定义：T 在 K 之上为多头，反之为空头（T === K 时退化，不出数字）。
 * S 不必落在 K 与 T 之间——冲破止损则 P₀ < 0、越过目标则 P₀ > 1，如实反映越界事实。
 * 但线性式只在 K 与 T 之间才是首达概率：S 越过 K 后该事件已判负（真实概率为 0），
 * 故此时只显示 P₀ 的越界值，不再输出 gap。
 */

export type AdvantageGapDirection = 'long' | 'short';

export type AdvantageGapInvalidReason =
  /** S / K / T 里有非有限数（含尚未填写）。 */
  | 'incomplete'
  /** T === K，|T − K| 为 0，基线概率无意义。 */
  | 'degenerate'
  /** 保留以兼容既有调用；方向不再因 S 越界而判负。 */
  | 'direction';

export type AdvantageGapResult =
  | { valid: false; reason: AdvantageGapInvalidReason }
  | {
      valid: true;
      direction: AdvantageGapDirection;
      /**
       * 基线概率 =（S − K）÷（T − K）。S 在 K 与 T 之间时落在 0–1；
       * S 冲破止损时为负、越过目标时大于 1——越界值如实呈现，不做截断。
       */
      baseline: number;
      /**
       * 动态赔率 b = (T − S) ÷ (S − K)：这一刻的盈亏比——赚一份要走的距离
       * 相对亏一份要走的距离。S 落在 K 与 T 之间时为正；S 越界时随之转负。
       *
       * 恒等式：1 ÷ (1 + b) ≡ P₀。把 b 代入即得
       *   1/(1+b) = (S−K) / ((S−K)+(T−S)) = (S−K)/(T−K) = P₀
       * 也就是说，「市场免费给的胜率」正是这一刻赔率下的盈亏平衡胜率。
       */
      payoffRatio: number;
      /**
       * 价格是否已触及/越过止损 K（多头 S ≤ K，空头 S ≥ K）。
       * 此时这笔的前提已被证伪，「优势边际」不再有意义——见 gap 的说明。
       */
      stopBreached: boolean;
      /**
       * 优势边际 = P − P₀；P 未填写时为 null。
       * **止损已被触及时同样为 null**：P₀ 的线性式只在 K 与 T 之间是首达概率，
       * S 越过 K 后「先摸到 T」这个事件早已判负、真实概率为 0，而线性外推却给出
       * 负的 P₀，代入 gap = P − P₀ 会变成 P + |P₀|，凭空虚增出优势
       * （K=90/T=110/S=80/P=72% ⇒ 虚假的「+122%」）。破了止损反而显示优势最大，
       * 是把仪表读反了，因此此处不出数、只出状态。
       */
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

  // 方向由 T 相对 K 的位置定义（T 在 K 之上即多头），不再要求 S 落在两者之间。
  const direction: AdvantageGapDirection = t > k ? 'long' : 'short';

  // 教科书写法，不取绝对值：K<S<T 时落在 0–1；S 冲破止损则为负，S 越过目标则 >1。
  // 越界值不是错误，而是「S 已跑出 K–T 区间」这一事实的如实读数。
  const baseline = (s - k) / (t - k);
  if (!Number.isFinite(baseline)) return { valid: false, reason: 'degenerate' };

  const payoffRatio = (t - s) / (s - k);
  if (!Number.isFinite(payoffRatio)) return { valid: false, reason: 'degenerate' };

  // 止损已被触及：不再计算优势边际（理由见 gap 的类型说明）。
  // S 越过目标 T 那一侧不必特判——P₀ ≥ 1 会让 gap ≤ 0 自然读作「优势已耗尽」。
  const stopBreached = direction === 'long' ? s <= k : s >= k;
  const gap = !stopBreached && isFinitePrice(p) ? p - baseline : null;
  return { valid: true, direction, baseline, payoffRatio, stopBreached, gap };
}
