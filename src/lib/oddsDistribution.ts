import type { CampaignMetricPoint } from '@/lib/campaignMetricSeries';
import type { ScatterStackScale } from '@/components/charts/stackLayout';
import { gaussianKde, silvermanBandwidth } from '@/lib/kernelDensity';
import { FIXED_DRAWDOWN_FRACTION } from '@/lib/geometricExpectancy';
import { ROBUST_FENCE_FACTOR, robustFenceRange } from '@/lib/robustRange';

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

/**
 * 1 / 2 / 2.5 / 5 × 10ⁿ 里取一个不小于 raw 的步距——刻度落在人能心算的数上。
 * 2.5 这一档是后加的：窗口按步距对齐，从 2 直接跳到 5 会让窗口白白宽出一倍多，主体又被挤回去。
 * 只在 0.25 及以上用它：0.025 这样的步距印成两位小数会变成 0.03、0.05、0.07，刻度与标签对不上。
 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exponent;
  // 容差：base 在浮点里常是 1.0000000000000002，不留余地会一路顶到 2。
  const multiplier = base <= 1 + 1e-9 ? 1 : base <= 2 + 1e-9 ? 2 : base <= 2.5 + 1e-9 && exponent >= -1 ? 2.5 : base <= 5 + 1e-9 ? 5 : 10;
  return Number((multiplier * 10 ** exponent).toPrecision(12));
}

/**
 * 分布图一屏里大约放得下的列数与行数（桌面：绘图区约 830px 宽、510px 高，每点 14px）。
 * 只用来在几个候选窗口之间挑一个「最高一柱放得下」的，不决定排版；实际尺寸不同也只是挑得保守或激进一点。
 */
export const DISTRIBUTION_NOMINAL_COLUMNS = 54;
/** 按 12px 行距（点位不相互压住的最小行距）一屏约放 43 行；留一点余量，免得最高一柱刚好卡在线上时窗口来回跳。 */
export const DISTRIBUTION_NOMINAL_ROWS = 40;
/** 栅栏倍数的候选：先用远栅栏（3·IQR），最高一柱还是放不下就逐步收紧，让主体占更多列。 */
const FENCE_FACTORS = [ROBUST_FENCE_FACTOR, 2.5, 2, 1.5] as const;

/** 把 [min, max] 等分成 columns 列时最高一列有几场；窗口外的点记在最边上的一列（与图上贴边的三角同一处）。 */
export function tallestColumnEstimate(sorted: readonly number[], min: number, max: number, columns: number): number {
  if (!(max > min) || columns < 1) return sorted.length;
  const counts = new Array<number>(columns).fill(0);
  const width = (max - min) / columns;
  for (const value of sorted) {
    const index = Math.min(columns - 1, Math.max(0, Math.floor((value - min) / width)));
    counts[index] += 1;
  }
  return counts.reduce((tallest, count) => Math.max(tallest, count), 0);
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
 * anchors：除 0 之外还必须留在视野里的参照值（加仓效用的 1.00「加仓没有额外放大」）。
 * 参照线画在窗口外等于没画，所以和 0 一样，窗口只许把它们圈进来、不许裁掉；
 * 而且不许让它们压在窗口边上——那样线外一侧永远是空的，读不出「有没有战役越过这条线」。
 */
export function metricDistributionDomain(
  values: number[],
  anchors: readonly number[] = [],
  /**
   * 估「最高一柱放不放得下」用的容量；缺省是一屏的大致列数与行数。rows 给 Infinity = 只用远栅栏、不收紧。
   * pinZero: false——恒为正的倍数（仓位放大）：0 不是分界，窗口只圈参照值，不为了 0 向左撑开一截空白。
   */
  capacity: { columns?: number; rows?: number; pinZero?: boolean } = {},
): OddsDistributionDomain {
  const columns = capacity.columns ?? DISTRIBUTION_NOMINAL_COLUMNS;
  const rows = capacity.rows ?? DISTRIBUTION_NOMINAL_ROWS;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const extraAnchors = anchors.filter(anchor => Number.isFinite(anchor) && anchor !== 0);
  const pinned = capacity.pinZero === false && extraAnchors.length > 0 ? extraAnchors : [0, ...extraAnchors];
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

  /**
   * 【用户要求】窗口留给主体，长尾贴边——与盈亏比分布同一个思路，只是封顶不是写死的 +10R，
   * 而是 Tukey 栅栏（见 robustRange）：p2–p98 之内，再裁到 Q1 − k·IQR ~ Q3 + k·IQR。
   * 原来只在小样本（p98 就是最大值）时才用栅栏，样本一多就照 p98 走：右尾 +30R 把窗口撑开，
   * 过半数战役挤进同一档里摞成一柱，比例根本读不出来。
   *
   * 先用远栅栏（k = 3）；按一屏的大致容量估一下，最高一柱还是放不下就把 k 收紧一档再试，
   * 都放不下取最高一柱最矮的那个。收紧只是让更多尾部贴边，样本一个不丢。
   */
  const windowFor = (factor: number) => {
    const fence = robustFenceRange(sorted, factor);
    const low = Math.min(fence.low, ...pinned);
    const high = Math.max(fence.high, ...pinned);
    // 按 6 格切而不是 5：span 略大于 5 时，/5 会把步距从 1 顶成 2，窗口白白多出一倍空白。
    const step = niceStep((high - low || 1) / 6);
    let min = Math.floor(low / step + 1e-9) * step;
    let max = Math.ceil(high / step - 1e-9) * step;
    // 全是 0（例如时间段筛出来的全是进行中战役）时窗口会塌成一个点：左右各放一格。
    if (max - min < step / 2) {
      min -= step;
      max += step;
    }
    // 0 压在窗口边上、而边外还有被裁掉的战役：向外多让一格。否则贴边的那一列会画在 0 线的另一侧——
    // 一摞亏损的战役出现在盈利区里（或反过来），正是「档不许跨 0」要防的那种误读。
    if (Math.abs(min) < step * 1e-9 && sorted[0] < 0) min -= step;
    if (Math.abs(max) < step * 1e-9 && sorted[sorted.length - 1] > 0) max += step;
    return { min, max, step };
  };
  let best = windowFor(FENCE_FACTORS[0]);
  let bestTallest = tallestColumnEstimate(sorted, best.min, best.max, columns);
  for (const factor of FENCE_FACTORS.slice(1)) {
    if (bestTallest <= rows) break;
    const candidate = windowFor(factor);
    const tallest = tallestColumnEstimate(sorted, candidate.min, candidate.max, columns);
    if (tallest < bestTallest) {
      best = candidate;
      bestTallest = tallest;
    }
  }
  return finish(best.min, best.max, best.step);
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
  /** -1：画在 0 线下方（镜像堆叠那一侧），场数取负交给 countY。 */
  direction: 1 | -1 = 1,
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
    const count = direction * density(x) * finite.length * scale.binWidth;
    const px = scale.x(x).toFixed(2);
    const py = scale.countY(count).toFixed(2);
    return `${index === 0 ? 'M' : 'L'} ${px} ${py}`;
  }).join(' ');
}
