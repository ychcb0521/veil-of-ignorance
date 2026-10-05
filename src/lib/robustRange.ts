/**
 * 稳健窗口：坐标轴留给主体，极端值贴边。
 *
 * 【用户要求】散点图要看得清分布的比例：几场极端值把轴撑开几十倍，主体就被挤进一两格里摞成一柱，
 * 读不出比例、反而误导。盈亏比分布靠 +10R 封顶避开了这件事（用户认可那张图的样子）；别的指标没有
 * 天然的封顶，这里给一条与单位无关的规则——p2–p98 之内（时序图的纵轴不套这一层），再用 Tukey 远栅栏压住长尾：
 *
 *   下界 = max(p2, min(Q1 − k·IQR, p10))　　上界 = min(p98, max(Q3 + k·IQR, p90))　　（k 缺省 3，统计里「极端离群」的界）
 *
 * 几条护栏，都是为了「裁掉的只能是极端值，不能是主体的一部分」：
 *   · 不足 10 场不裁：四分位数那时只是相邻的两三个值，量不出主体，普通战役会被当成离群；
 *   · 栅栏不许切进 p10–p90：每一侧最多约一成的战役贴边（亏损都挤在 −1R、盈利散得很开时，盈利那一半不能整个被裁掉）；
 *   · 栅栏退到 p10 / p90 之后省不出三分之一的轴长，这一侧就不裁：那说明栅栏外面是紧挨着的一群
 *     （八成战役在 0 附近、两成在 100 附近），裁掉的点只比边界高一点点，主体照样挤着——裁了点却换不来空间；
 *   · 同一个值占住中位数到某个四分位（四分之一以上的战役取同一个值）时，IQR 只是一两个值的间距，
 *     换 max(IQR, (p90 − p10) ÷ 2) 当尺度。
 *
 * 裁的是显示窗口，不裁样本：窗口外的点由图表贴边画成三角并在脚注报数，统计、提示框都用原值。
 */

/** 与 oddsDistribution 同一套最近秩分位数。输入须已升序。 */
export function quantileOfSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index];
}

export type RobustRange = {
  low: number;
  high: number;
  /** 用来量主体宽度的尺度（IQR，或并列太多时的替代尺度）；0 = 没上栅栏（样本太少或量不出），窗口就是外层的界。 */
  spread: number;
};

/** Tukey 栅栏的倍数：3 = 远栅栏（极端离群），1.5 = 近栅栏。 */
export const ROBUST_FENCE_FACTOR = 3;
/** 少于这么多场不上栅栏：四分位数只是相邻的两三个次序统计量，量不出「主体」。 */
export const ROBUST_FENCE_MIN_SAMPLES = 10;
/** 每一侧最多让这么大比例的战役贴边（栅栏不许切进 p10–p90）。 */
export const ROBUST_MAX_CLIPPED_SHARE = 0.1;
/** 栅栏退到 p10 / p90 的那一侧，至少要省出这么大比例的轴长才裁；省不出来就整侧不裁。 */
export const ROBUST_MIN_CLIP_GAIN = 1 / 3;

export type RobustRangeOptions = {
  /**
   * 外层再套不套 p2–p98：分布图的窗口套（两头各让出 2% 给贴边的三角，刻度再向外取整）；
   * 时序图的纵轴不套——没有离群值时一个点都不该贴边，只有真越过栅栏的才裁。
   */
  quantileBounds?: boolean;
};

export function robustFenceRange(
  values: readonly number[],
  factor: number = ROBUST_FENCE_FACTOR,
  { quantileBounds = true }: RobustRangeOptions = {},
): RobustRange {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { low: 0, high: 0, spread: 0 };
  const outerLow = quantileBounds ? quantileOfSorted(sorted, 0.02) : sorted[0];
  const outerHigh = quantileBounds ? quantileOfSorted(sorted, 0.98) : sorted[sorted.length - 1];
  if (sorted.length < ROBUST_FENCE_MIN_SAMPLES) return { low: outerLow, high: outerHigh, spread: 0 };
  const q1 = quantileOfSorted(sorted, 0.25);
  const median = quantileOfSorted(sorted, 0.5);
  const q3 = quantileOfSorted(sorted, 0.75);
  const p10 = quantileOfSorted(sorted, ROBUST_MAX_CLIPPED_SHARE);
  const p90 = quantileOfSorted(sorted, 1 - ROBUST_MAX_CLIPPED_SHARE);
  const iqr = q3 - q1;
  // 同一个值占住了中位数到某个四分位：IQR 可能是 0，也可能只是一个相邻次序统计量的间距
  const tied = q1 === median || q3 === median;
  const spread = tied ? Math.max(iqr, (p90 - p10) / 2) : iqr;
  if (!(spread > 0)) return { low: outerLow, high: outerHigh, spread: 0 };
  const fenceLow = q1 - factor * spread;
  const fenceHigh = q3 + factor * spread;
  const guardedLow = Math.max(outerLow, Math.min(fenceLow, p10));
  const guardedHigh = Math.min(outerHigh, Math.max(fenceHigh, p90));
  // 栅栏切进了 p10–p90 的那一侧：一成以上的战役在栅栏外，那不是几场极端值。退到 p10 / p90 裁——前提是真能省出轴长
  const worthClipping = (saved: number, extent: number) => extent > 0 && saved >= ROBUST_MIN_CLIP_GAIN * extent;
  return {
    low: fenceLow > p10 && !worthClipping(p10 - outerLow, guardedHigh - outerLow) ? outerLow : guardedLow,
    high: fenceHigh < p90 && !worthClipping(outerHigh - p90, outerHigh - guardedLow) ? outerHigh : guardedHigh,
    spread,
  };
}
