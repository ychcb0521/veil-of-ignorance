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
export type StackLayoutPoint = {
  id: string;
  x: number;
  /**
   * 类目柱状专用：同一列里相邻两点的 group 不同时，后一个另起一行——一行里不会混着两组（盈利 / 亏损泾渭分明）。
   * 缺省 = 不分组，照原样一格接一格码放。
   */
  group?: string;
};

export type StackLayoutBoundary = {
  value: number;
  /** Which interval owns points exactly on the boundary. */
  inclusiveSide: 'left' | 'right';
};

export type StackLayoutOptions = {
  xMin: number;
  xMax: number;
  /** 绘图区左右边缘（px）。 */
  left: number;
  right: number;
  /** 绘图区顶边（px）与高度（px）。 */
  top: number;
  plotHeight: number;
  /** Exceptional values (e.g. G=0 on a log chart) form a separate, non-numeric column. */
  isolatedLeft?: { ids: readonly string[]; cx: number };
  /** R axes keep integer boundaries; transformed axes need only the zero boundary. */
  integerBoundaries?: boolean;
  /** Hard semantic boundaries; zero remains a boundary when this mode is enabled. */
  boundaries?: readonly StackLayoutBoundary[];
};

function interiorBoundaries(xMin: number, xMax: number, boundaries: readonly StackLayoutBoundary[]) {
  const byValue = new Map<number, StackLayoutBoundary>();
  for (const boundary of [{ value: 0, inclusiveSide: 'right' as const }, ...boundaries]) {
    if (Number.isFinite(boundary.value) && boundary.value > xMin && boundary.value < xMax) {
      byValue.set(boundary.value, boundary);
    }
  }
  return [...byValue.values()].sort((a, b) => a.value - b.value);
}

/**
 * Minimum usable track width for hard-boundary mode (excludes plot insets).
 * Callers must allow horizontal scrolling when the viewport is narrower: shrinking a
 * one-R interval below a marker cannot preserve both truthful positions and legibility.
 */
export function minimumBoundaryPlotWidth(
  xMin: number,
  xMax: number,
  boundaries: readonly StackLayoutBoundary[] = [],
): number {
  if (boundaries.length === 0 || !(xMax > xMin)) return MIN_PITCH;
  const edges = [xMin, ...interiorBoundaries(xMin, xMax, boundaries).map(item => item.value), xMax];
  const narrowest = Math.min(...edges.slice(1).map((edge, index) => edge - edges[index]));
  return Math.ceil((xMax - xMin) / narrowest * MIN_PITCH);
}

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
  /** 标准档宽（px）；硬边界模式各区实际等分宽度略有差异。 */
  binPx: number;
  /** 标准档宽（数值单位），密度曲线按此近似换算「每档期望场数」。 */
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
  const { xMin, xMax, left, right, top, plotHeight, isolatedLeft } = options;
  const isolatedIds = new Set(isolatedLeft?.ids);
  const usable = Math.max(1, right - left);
  const span = xMax - xMin || 1;
  // 档边界必须落在整数 R 上：止损墙（−1）与盈亏平衡（0）都是档边界，−1.05R 的亏损才不会
  // 因为吸附到档中心而画到墙右边。整数窗口下每 1R 切 k 档（k = 每 R 像素 ÷ 步距取整）；
  // 窄到 1R 都放不下一个步距、或窗口不是整数时，退回「按像素等分」。
  const perUnit = options.integerBoundaries !== false && Number.isInteger(xMin) && Number.isInteger(span)
    ? Math.floor(usable / span / MIN_PITCH) : 0;
  const nominalBinCount = perUnit >= 1 ? span * perUnit : Math.max(1, Math.floor(usable / MIN_PITCH));
  const binPx = usable / nominalBinCount;
  const binWidth = (binPx / usable) * span;
  const xPx = (value: number) => left + ((value - xMin) / span) * usable;

  /**
   * 档的网格锚在 **0** 上，而不是绘图区左缘。
   *
   * 否则「按像素等分」那一支会让某一档横跨 0：一场 +0.2% 的盈利吸附到档中心后，
   * 可能被画到盈亏平衡线**左边**，读者看到的是「绿点在亏损区」。整数窗口下
   * 0 本来就是档边界，这里只是把同一条规则推广到任意窗口——对整数窗口结果不变。
   */
  const zeroPx = xPx(0);
  const firstBin = Math.floor((left - zeroPx) / binPx + 1e-9);
  const lastBin = Math.ceil((right - zeroPx) / binPx - 1e-9) - 1;
  const hardBoundaries = options.boundaries?.length
    ? interiorBoundaries(xMin, xMax, options.boundaries)
    : null;
  // Each semantic interval gets its own equal-width bins. The shared nominal width
  // remains the KDE's standard-bin unit; each interval's actual width may differ slightly.
  // minimumBoundaryPlotWidth lets the caller keep every interval >= MIN_PITCH wide.
  let hardBinCount = 0;
  const hardEdges = hardBoundaries ? [xMin, ...hardBoundaries.map(item => item.value), xMax] : [];
  const hardSections = hardEdges.slice(0, -1).map((lower, index) => {
    const upper = hardEdges[index + 1];
    const sectionLeft = xPx(lower);
    const sectionWidth = xPx(upper) - sectionLeft;
    const count = Math.max(1, Math.floor(sectionWidth / binPx + 1e-9));
    const section = { lower, upper, firstBin: hardBinCount, count, left: sectionLeft, binPx: sectionWidth / count };
    hardBinCount += count;
    return section;
  });
  const numericBinCount = hardBoundaries ? hardBinCount : Math.max(1, lastBin - firstBin + 1);
  const binCount = numericBinCount + (isolatedIds.size > 0 ? 1 : 0);

  // 先分档：越出显示区间的点落到最边上的一档，并记下方向，之后画成三角。
  const entries = points.map(point => {
    if (isolatedIds.has(point.id)) return { id: point.id, x: point.x, bin: numericBinCount, clamped: null };
    const clamped: ClampDirection | null = point.x < xMin ? 'left' : point.x > xMax ? 'right' : null;
    if (hardBoundaries) {
      const sectionIndex = hardBoundaries.findIndex(boundary => (
        point.x < boundary.value || (point.x === boundary.value && boundary.inclusiveSide === 'left')
      ));
      const section = hardSections[sectionIndex < 0 ? hardSections.length - 1 : sectionIndex];
      const fraction = (point.x - section.lower) / (section.upper - section.lower);
      const within = Math.min(section.count - 1, Math.max(0, Math.floor(fraction * section.count)));
      return { id: point.id, x: point.x, bin: section.firstBin + within, clamped };
    }
    const px = clamped === 'left' ? left : clamped === 'right' ? right : xPx(point.x);
    const bin = Math.min(numericBinCount - 1, Math.max(0, Math.floor((px - zeroPx) / binPx) - firstBin));
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
  const cxAt = (bin: number) => {
    if (bin === numericBinCount && isolatedLeft) return isolatedLeft.cx;
    if (hardBoundaries) {
      const section = hardSections.find(item => bin < item.firstBin + item.count)!;
      return section.left + (bin - section.firstBin + 0.5) * section.binPx;
    }
    return zeroPx + (firstBin + bin + 0.5) * binPx;
  };

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

  if (hardBoundaries) {
    // Keep the overflow picker in the same value/id order as the visible stack.
    for (const overflow of overflowByBin.values()) {
      overflow.ids.sort((a, b) => (rankById.get(a) ?? 0) - (rankById.get(b) ?? 0));
    }
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

export type ColumnStackOptions = {
  /** 类目取值，按横轴从左到右的顺序；点位按 x 精确匹配吸附到对应列。 */
  columns: number[];
  /** 绘图区左右边缘（px）。 */
  left: number;
  right: number;
  /** 绘图区顶边（px）与高度（px）。 */
  top: number;
  plotHeight: number;
  /**
   * 排版用的参考高度（px）：每行放几个点只按它和列宽算，不看实测高度。
   * 这样「撑高盒子」不会反过来改每行点数，两者互相追着长到上限。
   */
  referenceHeight: number;
};

export type ColumnStackResult = {
  placed: StackPlacedPoint[];
  overflow: StackOverflow[];
  /** 一列的宽度（px）。 */
  columnPx: number;
  /** 同一行里相邻两点的间距（px）——命中区不能比它宽，否则会盖住旁边那一场。 */
  pitchX: number;
  /** 每行摆几个点——纵轴一格因此代表 perRow 场，刻度必须同步放大，否则轴在说谎。 */
  perRow: number;
  pitchY: number;
  /** 图高能装下的行数。 */
  rowsFit: number;
  /** 最多的一列有多少场。 */
  tallest: number;
  /** 以 12px 行距把最高一柱完整画出来所需的绘图区高度；调用方据此撑高盒子而不是丢点。 */
  requiredPlotHeight: number;
  /** 每列场数，按列序号索引。 */
  columnCounts: number[];
};

/**
 * 类目柱状堆叠：每个类目一根柱，柱由该类目的点位自底向上码成方阵。
 *
 * 为什么一行要放多个点：离散指标（镜像止盈档位、重要度）的同一档往往有上百场，
 * 一行一场的柱子要一千多像素高，只能溢出成三角——那等于把数据藏起来。改成方阵后
 * 柱高 = 场数 ÷ 每行点数，最高的一柱正好占满图高，每个点仍是一场、仍可点击。
 * 代价是纵轴一格等于 perRow 场，所以这个数要报给调用方去缩放刻度。
 */
export function columnStackLayout(points: StackLayoutPoint[], options: ColumnStackOptions): ColumnStackResult {
  const { columns, left, right, top, plotHeight, referenceHeight } = options;
  const slots = Math.max(1, columns.length);
  const columnPx = Math.max(MIN_PITCH, (right - left) / slots);
  const centerAt = (index: number) => left + columnPx * (index + 0.5);

  const indexOf = (x: number) => {
    const exact = columns.indexOf(x);
    if (exact >= 0) return exact;
    // 落在类目之外的点不丢弃，归到最近的一列；类目轴上「最近」就是唯一说得通的解释。
    let nearest = 0;
    for (let index = 1; index < columns.length; index += 1) {
      if (Math.abs(columns[index] - x) < Math.abs(columns[nearest] - x)) nearest = index;
    }
    return nearest;
  };

  const buckets = Array.from({ length: slots }, () => [] as StackLayoutPoint[]);
  // 列内**按调用方给的顺序**自底向上码放：谁在前谁在下。
  // 这里不再自作主张按 id 排——排序键是有含义的（镜像止盈按 |b| 从小到大往上堆），
  // 只有调用方知道那是什么。确定性因此也由调用方负责：给一个稳定的顺序进来。
  for (const point of points) buckets[indexOf(point.x)].push(point);

  const columnCounts = buckets.map(bucket => bucket.length);
  const tallest = columnCounts.reduce((max, count) => Math.max(max, count), 0);

  /** 每个点在列内的格位：换组时跳到下一行开头；返回格位与占用的总格数。 */
  const slotRanks = (bucket: StackLayoutPoint[], perRow: number) => {
    const ranks: number[] = [];
    let cursor = 0;
    bucket.forEach((point, index) => {
      if (index > 0 && point.group !== bucket[index - 1].group && cursor % perRow !== 0) {
        cursor += perRow - (cursor % perRow);
      }
      ranks.push(cursor);
      cursor += 1;
    });
    return { ranks, cells: cursor };
  };

  // 每行点数只由「一列能并排放几个」和参考高度决定：最高一柱正好占满参考高度。
  // 实测高度不参与，否则撑高盒子会让 perRow 变小、柱变高、又要撑高，一路顶到上限。
  const widest = Math.max(1, Math.floor(columnPx / MIN_PITCH));
  const targetRows = Math.max(1, Math.floor(referenceHeight / MARK_FOOTPRINT));
  const perRow = Math.min(widest, Math.max(1, Math.ceil(tallest / targetRows)));
  const slotted = buckets.map(bucket => slotRanks(bucket, perRow));
  const tallestCells = slotted.reduce((max, item) => Math.max(max, item.cells), 0);
  const rowsNeeded = Math.max(1, Math.ceil(tallestCells / perRow));
  // 行距和 linear 一路一样：装得下就用 14px，装不下退到 12px（环贴环）。
  const pitchY = rowsNeeded * MIN_PITCH <= plotHeight ? MIN_PITCH : MARK_FOOTPRINT;
  const rowsFit = Math.max(1, Math.floor(plotHeight / pitchY));
  const pitchX = Math.min(MIN_PITCH, columnPx / perRow);

  const baseline = top + plotHeight;
  const pctAt = (cy: number) => ((cy - top) / plotHeight) * 100;

  const placed: StackPlacedPoint[] = [];
  const overflow: StackOverflow[] = [];
  buckets.forEach((bucket, index) => {
    const center = centerAt(index);
    const { ranks, cells } = slotted[index];
    const rows = Math.ceil(cells / perRow);
    bucket.forEach((point, rank) => {
      const row = Math.floor(ranks[rank] / perRow);
      const slot = ranks[rank] % perRow;
      // 方阵左右边缘取齐（不逐行居中），柱子才有直边；最顶一行没填满是可以数出来的。
      const cx = center + (slot - (perRow - 1) / 2) * pitchX;
      // 图高仍然装不下时（列窄到 perRow 被夹住），最顶一行让给合成三角。
      if (rows > rowsFit && row >= rowsFit - 1) {
        const cy = baseline - (rowsFit - 0.5) * pitchY;
        const existing = overflow.find(item => item.bin === index);
        if (existing) {
          existing.count += 1;
          existing.ids.push(point.id);
        } else {
          overflow.push({ bin: index, cx: center, cy, yPct: pctAt(cy), count: 1, ids: [point.id] });
        }
        return;
      }
      const cy = baseline - (row + 0.5) * pitchY;
      placed.push({ id: point.id, cx, cy, yPct: pctAt(cy), bin: index, rank, clamped: null });
    });
  });

  return { placed, overflow, columnPx, pitchX, perRow, pitchY, rowsFit, tallest, requiredPlotHeight: rowsNeeded * MARK_FOOTPRINT, columnCounts };
}
