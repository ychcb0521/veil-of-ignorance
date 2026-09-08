import { MARK_FOOTPRINT, MIN_PITCH, type ClampDirection } from '@/lib/chartTokens';

/**
 * 频数堆叠布局（Wilkinson 点图）：横轴是数值本身，纵轴是「落在这一档的第几个」。
 *
 * 为什么不是随机抖动：抖动出来的纵向位置看起来像数据但其实是噪声，读者会把更高的点
 * 读成「更多」；确定性地从底线往上堆，纵轴才真的等于计数。
 * 为什么是固定档而不是滑动窗口：档宽 = 一个点位步距（≥14px），柱高 = 这一档的精确计数，
 * 与密度曲线换算出来的「每档期望场数」是同一个量；点位横向吸附到档中心，相邻档恰好
 * 隔一个步距，永远不会叠画。精确数值留在提示框与 aria-label 里。
 */
export type StackLayoutPoint = { id: string; x: number };

export type StackLayoutOptions = {
  xMin: number;
  xMax: number;
  /** 绘图区左右边缘（px）。 */
  left: number;
  right: number;
  /** 绘图区顶边（px）与高度（px）。 */
  top: number;
  plotHeight: number;
};

export type StackPlacedPoint = {
  id: string;
  cx: number;
  cy: number;
  /** 相对绘图区高度的百分比，供按钮层 top:% 使用。 */
  yPct: number;
  bin: number;
  rank: number;
  clamped: ClampDirection | null;
};

/** 图高放不下的那部分：每档合成一个朝上的三角，不逐点叠画。 */
export type StackOverflow = {
  bin: number;
  cx: number;
  cy: number;
  yPct: number;
  count: number;
  ids: string[];
};

export type StackLayoutResult = {
  placed: StackPlacedPoint[];
  overflow: StackOverflow[];
  /** 档宽（px），≥ MIN_PITCH，恰好铺满可用宽度。 */
  binPx: number;
  /** 档宽（数值单位），密度曲线换算「每档期望场数」时用它。 */
  binWidth: number;
  binCount: number;
  /** 纵向步距：默认 14px；最高一档装不下时退到 12px（环贴环，2px 表面环仍是分隔）。 */
  pitchY: number;
  /** 当前图高能装下的行数。 */
  rowsFit: number;
  /** 最高一档的场数。 */
  tallest: number;
  /** 以 12px 步距装下最高一档所需的绘图区高度；调用方据此把盒子撑高而不是丢点。 */
  requiredPlotHeight: number;
  /** 每档计数，按档序号索引。 */
  binCounts: number[];
};

export type ScatterStackScale = {
  /** 数值 → 像素 x（不做越界夹取）。 */
  x: (value: number) => number;
  /** 场数 → 像素 y：count 个点堆到多高，0 即底线。 */
  countY: (count: number) => number;
  binWidth: number;
  binPx: number;
  pitchY: number;
  rowsFit: number;
  n: number;
  plot: { left: number; right: number; top: number; bottom: number };
  clipPathId: string;
};

export function stackLayout(points: StackLayoutPoint[], options: StackLayoutOptions): StackLayoutResult {
  const { xMin, xMax, left, right, top, plotHeight } = options;
  const usable = Math.max(1, right - left);
  const span = xMax - xMin || 1;
  // 档边界必须落在整数 R 上：止损墙（−1）与盈亏平衡（0）都是档边界，−1.05R 的亏损才不会
  // 因为吸附到档中心而画到墙右边。整数窗口下每 1R 切 k 档（k = 每 R 像素 ÷ 步距取整）；
  // 窄到 1R 都放不下一个步距、或窗口不是整数时，退回「按像素等分」。
  const perUnit = Number.isInteger(xMin) && Number.isInteger(span) ? Math.floor(usable / span / MIN_PITCH) : 0;
  const binCount = perUnit >= 1 ? span * perUnit : Math.max(1, Math.floor(usable / MIN_PITCH));
  const binPx = usable / binCount;
  const binWidth = (binPx / usable) * span;
  const xPx = (value: number) => left + ((value - xMin) / span) * usable;

  // 先分档：越出显示区间的点落到最边上的一档，并记下方向，之后画成三角。
  const entries = points.map(point => {
    const clamped: ClampDirection | null = point.x < xMin ? 'left' : point.x > xMax ? 'right' : null;
    const px = clamped === 'left' ? left : clamped === 'right' ? right : xPx(point.x);
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor((px - left) / binPx)));
    return { id: point.id, x: point.x, bin, clamped };
  });

  const byBin = new Map<number, typeof entries>();
  for (const entry of entries) {
    const bucket = byBin.get(entry.bin);
    if (bucket) bucket.push(entry);
    else byBin.set(entry.bin, [entry]);
  }
  // 档内按数值升序、再按 id 排，重复渲染永远得到同一张图。
  const rankById = new Map<string, number>();
  const binCounts = Array.from({ length: binCount }, () => 0);
  let tallest = 0;
  for (const [bin, bucket] of byBin) {
    bucket.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    bucket.forEach((entry, rank) => rankById.set(entry.id, rank));
    binCounts[bin] = bucket.length;
    tallest = Math.max(tallest, bucket.length);
  }

  const pitchY = tallest * MIN_PITCH <= plotHeight ? MIN_PITCH : MARK_FOOTPRINT;
  const rowsFit = Math.max(1, Math.floor(plotHeight / pitchY));
  const baseline = top + plotHeight;
  const cyAt = (rank: number) => baseline - (rank + 0.5) * pitchY;
  const pctAt = (cy: number) => ((cy - top) / plotHeight) * 100;
  const cxAt = (bin: number) => left + (bin + 0.5) * binPx;

  const placed: StackPlacedPoint[] = [];
  const overflowByBin = new Map<number, StackOverflow>();
  for (const entry of entries) {
    const rank = rankById.get(entry.id) ?? 0;
    const cx = cxAt(entry.bin);
    // 这一档装不下时，最顶一格让给合成三角：三角代表「从这格起还有多少场」。
    if (binCounts[entry.bin] > rowsFit && rank >= rowsFit - 1) {
      const cy = cyAt(rowsFit - 1);
      const existing = overflowByBin.get(entry.bin);
      if (existing) {
        existing.count += 1;
        existing.ids.push(entry.id);
      } else {
        overflowByBin.set(entry.bin, { bin: entry.bin, cx, cy, yPct: pctAt(cy), count: 1, ids: [entry.id] });
      }
      continue;
    }
    const cy = cyAt(rank);
    placed.push({ id: entry.id, cx, cy, yPct: pctAt(cy), bin: entry.bin, rank, clamped: entry.clamped });
  }

  return {
    placed,
    overflow: [...overflowByBin.values()].sort((a, b) => a.bin - b.bin),
    binPx,
    binWidth,
    binCount,
    pitchY,
    rowsFit,
    tallest,
    requiredPlotHeight: tallest * MARK_FOOTPRINT,
    binCounts,
  };
}
