import type { CampaignMetricPoint } from '@/lib/campaignMetricSeries';
import type { ScatterStackScale } from '@/components/charts/stackLayout';
import { gaussianKde, silvermanBandwidth } from '@/lib/kernelDensity';
import { FIXED_DRAWDOWN_FRACTION } from '@/lib/geometricExpectancy';

/** 固定 10% 风险下注的本金归零界限；不是用户真实账户的强平判定。 */
export const CAPITAL_RUIN_THRESHOLD = -1 / FIXED_DRAWDOWN_FRACTION;
export const isFixedBetRuin = (payoffRatio: number) => Number.isFinite(payoffRatio) && payoffRatio <= CAPITAL_RUIN_THRESHOLD;

export type OddsDistributionDomain = {
  min: number;
  max: number;
  /** 升序刻度值。 */
  ticks: number[];
};

export type OddsDistributionSummary = {
  n: number;
  min: number;
  max: number;
  median: number;
  mean: number;
  winCount: number;
  /** b > 0 占比，0..1。 */
  winRate: number;
  /** 右尾：b > TAIL_THRESHOLD 的场数，按原始值算，与显示窗口无关。 */
  tailCount: number;
};

export type OddsDistributionModel = {
  domain: OddsDistributionDomain;
  summary: OddsDistributionSummary;
  bandwidth: number;
  /** 按 b 升序、再按 campaignId 排：键盘左右键就是沿横轴走。 */
  sortedPoints: CampaignMetricPoint[];
  values: number[];
};

/** 右尾计数阈值（R）。 */
export const TAIL_THRESHOLD = 5;

/** 显示窗口上限（R）：p98 再高也不把 −1R~+1R 主群压到几十像素里，超出者贴边计数。 */
export const DOMAIN_CAP = 10;

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index];
}

/**
 * 分布图的横轴窗口：low = min(−2, ⌊p2⌋)，high = max(2, min(10, ⌈p98⌉))，再吸附到 ≤ 6 格的整数步距。
 * 存在 b ≤ −10 时改用 −12R 左界，确保归零线可见，极端亏损贴边但不丢样本。
 * 正向上限封顶——右尾 +38R 会把 p98 推到 +15R 以上，
 * 那时主群只剩几十像素宽，止损墙与盈亏平衡线之间读不出任何结构。
 * −1 永远在窗口内（low ≤ −2），所以止损墙永远画得出来。
 */
export function oddsDistributionDomain(values: number[]): OddsDistributionDomain {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.some(isFixedBetRuin)) {
    // 把归零界限留在视野内，且左侧保留 2R 给越界三角；极端亏损不挤压正常主群。
    // 裁的是显示窗口，不裁样本：原始 b、统计、提示框和极端点均保留。
    const min = CAPITAL_RUIN_THRESHOLD - 2;
    const high = Math.max(2, Math.min(DOMAIN_CAP, Math.ceil(quantile(sorted, 0.98))));
    const step = Math.max(1, Math.ceil((high - min) / 6));
    const max = Math.min(DOMAIN_CAP, Math.ceil(high / step) * step);
    const ticks: number[] = [];
    for (let value = min; value <= max; value += step) ticks.push(value);
    if (ticks[ticks.length - 1] !== max) ticks.push(max);
    return { min, max, ticks };
  }
  const low = Math.min(-2, Math.floor(quantile(sorted, 0.02)));
  const high = Math.max(2, Math.min(DOMAIN_CAP, Math.ceil(quantile(sorted, 0.98))));
  const step = Math.max(1, Math.ceil((high - low) / 6));
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + 1e-9; value += step) ticks.push(Number(value.toFixed(6)));
  return { min, max, ticks };
}

/** 1 / 2 / 5 × 10ⁿ 里取一个不小于 raw 的步距——刻度落在人能心算的数上。 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exponent;
  // 容差：base 在浮点里常是 1.0000000000000002，不留余地会一路顶到 2。
  const multiplier = base <= 1 + 1e-9 ? 1 : base <= 2 + 1e-9 ? 2 : base <= 5 + 1e-9 ? 5 : 10;
  return multiplier * 10 ** exponent;
}

/**
 * 通用分布窗口：给盈亏比以外的指标用。
 *
 * 与 oddsDistributionDomain 的差别全在假设上——那一个把窗口硬撑到 [−2, …] 并封顶 +10，
 * 因为 b 的语义里「−1R 止损墙」必须永远画得出来、右尾 +38R 必须被压住。
 * 别的指标没有这两条，硬套过去只会在左边留出一大片空白（比如几何期望永远 ≥ −1）。
 * 这里只做两件事：用 p2 / p98 抗离群，以及无论如何把 0 圈进窗口——0 是盈亏分界，
 * 它一旦被挤出视野，读者就失去了唯一的参照点。
 *
 * anchors：除 0 之外还必须留在视野里的参照值（加仓&止盈效用的 1.00「加仓没有额外放大」）。
 * 参照线画在窗口外等于没画，所以和 0 一样，窗口只许把它们圈进来、不许裁掉；
 * 而且不许让它们压在窗口边上——那样线外一侧永远是空的，读不出「有没有战役越过这条线」。
 */
export function metricDistributionDomain(values: number[], anchors: readonly number[] = []): OddsDistributionDomain {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const extraAnchors = anchors.filter(anchor => Number.isFinite(anchor) && anchor !== 0);
  const pinned = [0, ...extraAnchors];
  /** 按步距铺刻度；额外锚点压在边缘上时向外多让一格。 */
  const finish = (rawMin: number, rawMax: number, step: number): OddsDistributionDomain => {
    let min = rawMin;
    let max = rawMax;
    for (const anchor of extraAnchors) {
      if (anchor >= max - step * 1e-9) max += step;
      if (anchor <= min + step * 1e-9) min -= step;
    }
    const ticks: number[] = [];
    for (let value = min; value <= max + step * 1e-9; value += step) {
      ticks.push(Number(value.toFixed(6)));
    }
    return { min: Number(min.toFixed(6)), max: Number(max.toFixed(6)), ticks };
  };
  if (sorted.length === 0) {
    // 没有样本时按整数格铺开：缺省正好还原成 [−1, 0, 1]。
    const step = Math.max(1, niceStep((Math.max(1, ...pinned) - Math.min(-1, ...pinned)) / 6));
    return finish(Math.floor(Math.min(-1, ...pinned) / step) * step, Math.ceil(Math.max(1, ...pinned) / step) * step, step);
  }

  const smallest = sorted[0];
  const largest = sorted[sorted.length - 1];
  const p2 = quantile(sorted, 0.02);
  const p98 = quantile(sorted, 0.98);
  /**
   * 样本小到分位数切不动尾巴时（n ≲ 26，p98 就等于最大值），换 Tukey 栅栏兜底。
   * 否则一场 Gᵢ = 12 会把窗口撑成二十几倍，其余几十场全挤进最左边那一档——
   * 盈亏比那一套靠 +10R 硬封顶避开了这件事，通用窗口没有天然的封顶可用。
   */
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowRaw = p2 > smallest || iqr <= 0 ? p2 : Math.max(p2, q1 - 3 * iqr);
  const highRaw = p98 < largest || iqr <= 0 ? p98 : Math.min(p98, q3 + 3 * iqr);
  const low = Math.min(lowRaw, ...pinned);
  const high = Math.max(highRaw, ...pinned);
  // 按 6 格切而不是 5：span 略大于 5 时，/5 会把步距从 1 顶成 2，窗口白白多出一倍空白。
  const step = niceStep((high - low || 1) / 6);
  let min = Math.floor(low / step) * step;
  let max = Math.ceil(high / step) * step;
  // 全是 0（例如时间段筛出来的全是进行中战役）时窗口会塌成一个点：左右各放一格。
  if (max - min < step / 2) {
    min -= step;
    max += step;
  }
  return finish(min, max, step);
}

function median(sorted: number[]) {
  if (sorted.length === 0) return 0;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

export type DistributionModelOptions = {
  /** 窗口算法；缺省用盈亏比那一套（带 −1R 止损墙与 +10R 封顶）。 */
  domain?: (values: number[]) => OddsDistributionDomain;
  /** 右尾阈值；缺省 +5R。 */
  tailThreshold?: number;
};

export function buildOddsDistributionModel(
  points: CampaignMetricPoint[],
  options: DistributionModelOptions = {},
): OddsDistributionModel {
  const sortedPoints = [...points].sort((a, b) => (
    a.value - b.value || a.campaignId.localeCompare(b.campaignId)
  ));
  const values = sortedPoints.map(point => point.value);
  const n = values.length;
  const winCount = values.filter(value => value > 0).length;
  const tailThreshold = options.tailThreshold ?? TAIL_THRESHOLD;
  return {
    domain: (options.domain ?? oddsDistributionDomain)(values),
    summary: {
      n,
      min: n ? values[0] : 0,
      max: n ? values[n - 1] : 0,
      median: median(values),
      mean: n ? values.reduce((sum, value) => sum + value, 0) / n : 0,
      winCount,
      winRate: n ? winCount / n : 0,
      tailCount: values.filter(value => value > tailThreshold).length,
    },
    bandwidth: silvermanBandwidth(values),
    sortedPoints,
    values,
  };
}

/**
 * 把核密度换算成「每档期望场数」= f̂(x) · n · 档宽，与堆叠的柱高共用同一条场数轴——
 * 不是第二条坐标轴。只在 [数据最小值, 数据最大值] ∩ 显示窗口 内每 2px 采样一次；
 * 高斯核本身已经平滑，折线即可，不做贝塞尔拟合。整段只使用一个子路径：低密度长尾也
 * 连续贴近底线，避免被误读为「曲线只加载了一半」或后台仍在补点。
 */
export function kdeCountPath(
  values: number[],
  domain: { min: number; max: number },
  scale: ScatterStackScale,
  bandwidth = silvermanBandwidth(values),
) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return '';
  const start = Math.max(domain.min, Math.min(...finite));
  const end = Math.min(domain.max, Math.max(...finite));
  if (!(end >= start)) return '';
  const density = gaussianKde(finite, bandwidth);
  const stepValue = Math.max(1e-9, (scale.binWidth * 2) / scale.binPx);
  const samples: number[] = [];
  for (let x = start; x < end; x += stepValue) samples.push(x);
  samples.push(end);

  return samples.map((x, index) => {
    const count = density(x) * finite.length * scale.binWidth;
    const px = scale.x(x).toFixed(2);
    const py = scale.countY(count).toFixed(2);
    return `${index === 0 ? 'M' : 'L'} ${px} ${py}`;
  }).join(' ');
}
