import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BAND_RAIL_W,
  CHART_AXIS_VAR,
  CHART_GRID_VAR,
  CHART_SURFACE_VAR,
  CHART_THRESHOLD_VAR,
  HIT_MIN,
  MARK_R,
  MARK_RING_W,
  MARK_FOOTPRINT,
  MIN_PITCH,
  PLOT_INSET,
  clampedChevronPath,
  markShapePath,
  seriesTokenVar,
  type ChartSeriesToken,
  type ClampDirection,
  type ScatterMarkShape,
} from '@/lib/chartTokens';
import { stackLayout, type ScatterStackScale } from './stackLayout';
import { useChartSize } from './useChartSize';

export type { ScatterStackScale } from './stackLayout';

export type ScatterSeries = {
  id: string;
  label: string;
  token: ChartSeriesToken;
  shape: ScatterMarkShape;
};

export type ScatterPoint = {
  id: string;
  /** ordinal 模式下是序号 0..N-1；category 模式下是类目值；linear 模式下是真实数值。 */
  x: number;
  y: number;
  seriesId: string;
  valueText: string;
  label: string;
  metaText?: string;
  ariaLabel: string;
  testId?: string;
  dataAttrs?: Record<string, string | number | undefined>;
};

export type ScatterTick = {
  value: number;
  label: string;
  testId?: string;
  dataAttrs?: Record<string, string | number>;
  gridTestId?: string;
  gridDataAttrs?: Record<string, string | number>;
  /** 纵轴栏里不重复画这一条刻度文字（-1R 由参考线标签接管）。 */
  hideLabel?: boolean;
};

export type ScatterGutterLabel = {
  value: number;
  text: string;
  testId?: string;
};

export type ScatterYAxis = {
  mode?: 'value';
  min: number;
  max: number;
  ticks: ScatterTick[];
  gutterLabels?: ScatterGutterLabel[];
};

/**
 * 场数轴：纵轴不再是数值，而是「落在这一档的第几个」。刻度由元件按像素步距自己派生，
 * 因为只有元件知道图有多高、一行占几个像素。只能与 xAxis.mode === 'linear' 搭配。
 */
export type ScatterCountAxis = {
  mode: 'count';
  tickTestId?: string;
  gridTestId?: string;
  /** 只缀在最顶一格刻度后（如「30 场」），轴自己报一次单位。 */
  unit?: string;
};

export type ScatterXAxis =
  | { mode: 'ordinal'; count: number; labelAt: (index: number) => string | null }
  | { mode: 'linear'; min: number; max: number; labels?: { at: number; text: string }[] }
  | { mode: 'category'; categories: { value: number; label: string }[] };

export type ScatterReferenceLine = {
  value: number;
  kind: 'zero' | 'threshold';
  /** 默认 'y'（横向参考线）；'x' 是竖向参考线，只在 linear 横轴下有意义。 */
  axis?: 'x' | 'y';
  /** 只有竖向参考线会画文字标签，贴在绘图区顶端，用墨色而不是线色。 */
  label?: string;
  /** 标签落在线的哪一侧；缺省时 value ≤ 0 靠左、否则靠右，贴边时自动翻转。 */
  labelSide?: 'left' | 'right';
  testId?: string;
  dataAttrs?: Record<string, string | number>;
};

export type ScatterBandCounts = {
  testId: string;
  ariaLabel?: string;
  items: { key: string; top: number; count: number; lower: number; upper: number; label: string }[];
};

export type ScatterPlotProps = {
  points: ScatterPoint[];
  series: ScatterSeries[];
  /** 数值轴（默认）或场数轴（堆叠布局，仅 linear 横轴）。 */
  yAxis: ScatterYAxis | ScatterCountAxis;
  xAxis: ScatterXAxis;
  referenceLines?: ScatterReferenceLine[];
  /** 只在场数轴下调用：画在参考线之后、点位之前，并被裁进绘图区。 */
  overlay?: (scale: ScatterStackScale) => ReactNode;
  bandCounts?: ScatterBandCounts;
  onSelect?: (id: string) => void;
  onActiveChange?: (id: string | null) => void;
  emptyMessage: string;
  testId: string;
  scrollAreaTestId: string;
  rootDataAttrs?: Record<string, string | number | undefined>;
  scrollAreaDataAttrs?: Record<string, string | number | undefined>;
  header?: ReactNode;
  guidePanel?: ReactNode;
  legendExtra?: ReactNode;
  footnote?: ReactNode;
  directionHint?: ReactNode;
};

type PlacedPoint = ScatterPoint & {
  cx: number;
  cy: number;
  yPct: number;
  clamped: ClampDirection | null;
  series: ScatterSeries;
};

type StackOverflowGlyph = { bin: number; cx: number; cy: number; yPct: number; count: number };

type StackInfo = {
  pitchY: number;
  rowsFit: number;
  binWidth: number;
  binPx: number;
  tallest: number;
  requiredPlotHeight: number;
  overflow: StackOverflowGlyph[];
};

/** 场数轴的盒子最高撑到这里（44rem）：再高就让最高一档合成一个三角并在脚注报数。 */
const STACK_BOX_CAP = 704;
/** 与绘图盒 class 里的 min-h-[18rem] 同值，行内 minHeight 不能把手机上的下限压掉。 */
const STACK_BOX_FLOOR = 288;
/** 绘图盒上下各 1px 边框不在测量区内，撑高时要把它们算进去，否则最高一档差 2px 装不下。 */
const STACK_BOX_BORDER = 2;
/** 堆叠布局里提示框挂在点位侧面、垂直居中；四行文字约 68px 高，锚点离盒子上下缘至少留这么多。 */
const STACK_TOOLTIP_HALF = 40;

/** 场数轴刻度步距：只用 1/2/5 × 10ⁿ，让 4~6 条网格线落在整数计数上。 */
function countTickStep(rows: number) {
  const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  return candidates.find(step => rows / step <= 5) ?? candidates[candidates.length - 1];
}

/** 9px 等宽字的估算宽度：拉丁 0.6em、CJK 1em，用来判断标签会不会撞到绘图区边缘。 */
function estimateLabelWidth(text: string) {
  let width = 0;
  for (const char of text) width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 9 : 5.4;
  return width;
}

type XReferenceLabelPlacement = {
  line: ScatterReferenceLine;
  x: number;
  side: 'left' | 'right';
  row: number;
};

/**
 * 竖向参考线的标签排位：先试本线偏好的一侧，再试另一侧，两侧都撞（绘图区边缘或已放好的标签）
 * 才下移一行。窄屏上「−1R 止损」被挤到墙右侧时，「0 盈亏平衡」应当贴到 0 线右侧，
 * 而不是换行后横跨止损墙、和自己的线脱开。
 */
function placeXReferenceLabels(
  lines: ScatterReferenceLine[],
  xOf: (value: number) => number,
  lineLeft: number,
  lineRight: number,
): XReferenceLabelPlacement[] {
  const placed: (XReferenceLabelPlacement & { box: [number, number] })[] = [];
  for (const line of lines) {
    const x = xOf(line.value);
    const width = estimateLabelWidth(line.label ?? '');
    const preferred: 'left' | 'right' = line.labelSide ?? (line.value <= 0 ? 'left' : 'right');
    const sides: ('left' | 'right')[] = preferred === 'left' ? ['left', 'right'] : ['right', 'left'];
    const boxFor = (side: 'left' | 'right'): [number, number] => (
      side === 'left' ? [x - 4 - width, x - 4] : [x + 4, x + 4 + width]
    );
    const fits = (side: 'left' | 'right', row: number) => {
      const box = boxFor(side);
      if (box[0] < lineLeft || box[1] > lineRight) return false;
      return !placed.some(other => other.row === row && box[0] < other.box[1] + 4 && other.box[0] < box[1] + 4);
    };
    let choice: { side: 'left' | 'right'; row: number } | null = null;
    for (let row = 0; row < 4 && !choice; row += 1) {
      const side = sides.find(candidate => fits(candidate, row));
      if (side) choice = { side, row };
    }
    // 两侧都出界（绘图区窄过标签本身）：按偏好侧放，宁可裁掉也不省略。
    const { side, row } = choice ?? { side: preferred, row: placed.length };
    placed.push({ line, x, side, row, box: boxFor(side) });
  }
  return placed.map(({ line, x, side, row }) => ({ line, x, side, row }));
}

function fractionOf(axis: { min: number; max: number }, value: number) {
  const span = axis.max - axis.min || 1;
  return 1 - (value - axis.min) / span;
}

/**
 * 稳健纵轴窗口：极端 R 会把 -1R~+1R 的主群压成一条线，取 p2–p98 分位，
 * 越界点由元件贴边画成三角并计数，不丢弃也不篡改数值。
 * 决策散点与心态-收益共用同一份，两边各写一份就会出现两套窗口规则。
 */
export function robustRDomain(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0;
  const low = Math.min(-2, Math.floor(at(0.02)));
  const high = Math.max(2, Math.ceil(at(0.98)));
  const step = Math.max(1, Math.ceil((high - low) / 6));
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = max; value >= min - 1e-9; value -= step) ticks.push(Number(value.toFixed(6)));
  return { min, max, ticks };
}

function applyDataAttrs(attrs?: Record<string, string | number | undefined>) {
  const out: Record<string, string | number> = {};
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * 蜂群排布：同一列里 y 相距不足一个点位占地的点，向两侧确定性地让开。
 * 只在横轴位置本身不携带含义的模式（类目 / 量化后的连续轴）使用，
 * 并且永远只动横轴——纵轴是数值本身，位移会毁掉判读。
 */
function beeswarm(entries: { baseX: number; cy: number }[], budget: number) {
  const placed: { x: number; cy: number }[] = [];
  return entries.map(entry => {
    for (let slot = 0; slot < 24; slot += 1) {
      const direction = slot % 2 === 0 ? 1 : -1;
      const step = Math.ceil(slot / 2);
      const candidate = entry.baseX + direction * step * MIN_PITCH;
      // 让开的位移不能超出预算：类目模式是本列宽度，量化横轴则只有一格步距，
      // 否则「让开」就变成谎报横轴数值。超出预算就直接叠着画，靠 2px 表面环分离。
      if (Math.abs(candidate - entry.baseX) > budget) break;
      const collides = placed.some(
        other => Math.abs(other.x - candidate) < MIN_PITCH - 0.5
          && Math.abs(other.cy - entry.cy) < MARK_FOOTPRINT,
      );
      if (!collides) {
        placed.push({ x: candidate, cy: entry.cy });
        return candidate;
      }
    }
    placed.push({ x: entry.baseX, cy: entry.cy });
    return entry.baseX;
  });
}

export function ScatterPlot({
  points,
  series,
  yAxis,
  xAxis,
  referenceLines = [],
  overlay,
  bandCounts,
  onSelect,
  onActiveChange,
  emptyMessage,
  testId,
  scrollAreaTestId,
  rootDataAttrs,
  scrollAreaDataAttrs,
  header,
  guidePanel,
  legendExtra,
  footnote,
  directionHint,
}: ScatterPlotProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { ref: trackRef, size } = useChartSize<HTMLDivElement>();
  const buttonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  const seriesById = useMemo(() => new Map(series.map(item => [item.id, item])), [series]);
  const boxHeight = size.height;
  const plotHeight = Math.max(1, boxHeight - PLOT_INSET.top - PLOT_INSET.bottom);
  const trackWidth = Math.max(1, size.width);
  const innerWidth = Math.max(1, trackWidth - PLOT_INSET.left - PLOT_INSET.right);

  // 场数轴的 min/max 要等布局算出行距才知道，所以数值轴在这里单独收窄；
  // 现有调用方 valueYAxis === yAxis，一切照旧。
  const stackMode = yAxis.mode === 'count';
  const valueYAxis: ScatterYAxis | null = yAxis.mode === 'count' ? null : yAxis;
  const valueMin = valueYAxis?.min ?? 0;
  const valueMax = valueYAxis?.max ?? 1;
  const valueFraction = useCallback(
    (value: number) => {
      const span = valueMax - valueMin || 1;
      return 1 - (value - valueMin) / span;
    },
    [valueMax, valueMin],
  );

  const layout = useMemo(() => {
    const count = points.length;
    if (count === 0) {
      return { contentWidth: trackWidth, pitch: MIN_PITCH, fitMode: 'fit' as const, placed: [] as PlacedPoint[], stack: null as StackInfo | null };
    }

    if (stackMode && xAxis.mode === 'linear') {
      // 场数轴：横轴铺满、永不滚动；点位按档吸附、从底线往上堆，纵轴就是计数。
      const contentWidth = trackWidth;
      const result = stackLayout(points.map(point => ({ id: point.id, x: point.x })), {
        xMin: xAxis.min,
        xMax: xAxis.max,
        left: PLOT_INSET.left,
        right: contentWidth - PLOT_INSET.right,
        top: PLOT_INSET.top,
        plotHeight,
      });
      const byId = new Map(points.map(point => [point.id, point]));
      const placed = result.placed.flatMap(item => {
        const point = byId.get(item.id);
        if (!point) return [];
        return [{
          ...point,
          cx: item.cx,
          cy: item.cy,
          yPct: item.yPct,
          clamped: item.clamped,
          series: seriesById.get(point.seriesId) ?? series[0],
        }];
      });
      return {
        contentWidth,
        pitch: result.binPx,
        fitMode: 'fit' as const,
        placed,
        stack: {
          pitchY: result.pitchY,
          rowsFit: result.rowsFit,
          binWidth: result.binWidth,
          binPx: result.binPx,
          tallest: result.tallest,
          requiredPlotHeight: result.requiredPlotHeight,
          overflow: result.overflow.map(({ bin, cx, cy, yPct, count: n }) => ({ bin, cx, cy, yPct, count: n })),
        } as StackInfo,
      };
    }
    if (stackMode) {
      // 场数轴只对 linear 横轴有定义；其它模式不能悄悄改读成别的意思。
      console.error('ScatterPlot: yAxis.mode === "count" 只能与 xAxis.mode === "linear" 搭配，已退回数值布局。');
    }

    const clampY = (value: number) => {
      if (value > valueMax) return { fraction: 0, clamped: 'up' as const };
      if (value < valueMin) return { fraction: 1, clamped: 'down' as const };
      return { fraction: valueFraction(value), clamped: null };
    };

    if (xAxis.mode === 'ordinal') {
      // 每场战役独占一列：需要的宽度就是列数 × 最小步距，装不下就横向滚动。
      const required = xAxis.count * MIN_PITCH + PLOT_INSET.left + PLOT_INSET.right;
      const contentWidth = Math.max(trackWidth, required);
      const usable = contentWidth - PLOT_INSET.left - PLOT_INSET.right;
      const pitch = usable / Math.max(1, xAxis.count);
      const placed = points.map(point => {
        const { fraction, clamped } = clampY(point.y);
        return {
          ...point,
          cx: PLOT_INSET.left + pitch * (point.x + 0.5),
          cy: PLOT_INSET.top + fraction * plotHeight,
          yPct: fraction * 100,
          clamped,
          series: seriesById.get(point.seriesId) ?? series[0],
        };
      });
      return { contentWidth, pitch, fitMode: required > trackWidth ? ('scroll' as const) : ('fit' as const), placed, stack: null as StackInfo | null };
    }

    // category / linear：先按占用数算出需要多宽，再做蜂群排布。
    const columnKey = (point: ScatterPoint) => (
      xAxis.mode === 'category' ? String(point.x) : String(Math.round(point.x * 1000))
    );
    const columns = new Map<string, ScatterPoint[]>();
    for (const point of points) {
      const key = columnKey(point);
      const bucket = columns.get(key);
      if (bucket) bucket.push(point);
      else columns.set(key, [point]);
    }
    // 横轴本身携带含义（类目 / 量化）时永不横向滚动：滚动会把类目或 D-score 区间
    // 挪出视口，读者看到的就是一张没有横轴的散点图。这两种模式一律铺满可视宽度，
    // 密度靠 2px 表面环 + 有预算的蜂群让开，装不下就叠着画。
    const contentWidth = trackWidth;
    const usable = contentWidth - PLOT_INSET.left - PLOT_INSET.right;

    const baseX = (point: ScatterPoint) => {
      if (xAxis.mode === 'category') {
        const index = xAxis.categories.findIndex(item => item.value === point.x);
        const slot = index < 0 ? 0 : index;
        return PLOT_INSET.left + (usable / Math.max(1, xAxis.categories.length)) * (slot + 0.5);
      }
      const span = xAxis.max - xAxis.min || 1;
      return PLOT_INSET.left + ((point.x - xAxis.min) / span) * usable;
    };

    const swarmBudget = xAxis.mode === 'category'
      // 类目内的横向位置不携带含义，可以用满本列宽度的一半。
      ? Math.max(0, usable / Math.max(1, xAxis.categories.length) / 2 - MARK_FOOTPRINT / 2)
      // 量化横轴上位移就是误差，只给一格步距。
      : MIN_PITCH;

    const ordered = [...points].sort((a, b) => baseX(a) - baseX(b) || a.y - b.y);
    const entries = ordered.map(point => ({ baseX: baseX(point), cy: PLOT_INSET.top + clampY(point.y).fraction * plotHeight }));
    const xs = beeswarm(entries, swarmBudget);
    const xById = new Map(ordered.map((point, index) => [point.id, xs[index]]));

    const placed = points.map(point => {
      const { fraction, clamped } = clampY(point.y);
      const cx = Math.min(
        contentWidth - PLOT_INSET.right,
        Math.max(PLOT_INSET.left, xById.get(point.id) ?? baseX(point)),
      );
      return {
        ...point,
        cx,
        cy: PLOT_INSET.top + fraction * plotHeight,
        yPct: fraction * 100,
        clamped,
        series: seriesById.get(point.seriesId) ?? series[0],
      };
    });

    return {
      contentWidth,
      pitch: MIN_PITCH,
      fitMode: 'fit' as const,
      placed,
      stack: null as StackInfo | null,
    };
  }, [innerWidth, plotHeight, points, series, seriesById, stackMode, trackWidth, xAxis, valueMax, valueMin, valueFraction]);

  const { contentWidth, pitch, fitMode, placed, stack } = layout;
  const activePoint = placed.find(point => point.id === activeId) ?? null;
  const clampedCount = placed.filter(point => point.clamped != null).length;

  // 场数轴由布局派生：max = 图高 ÷ 行距（非整数），这样 count c 的网格线恰好落在
  // 第 c 个点位的上沿——「这条线下面有 c 个点」。
  const renderAxis = useMemo<ScatterYAxis>(() => {
    if (!stack || yAxis.mode !== 'count') return valueYAxis ?? { min: 0, max: 1, ticks: [] };
    const max = plotHeight / stack.pitchY;
    const step = countTickStep(stack.rowsFit);
    const ticks: ScatterTick[] = [];
    for (let value = Math.floor(stack.rowsFit / step) * step; value >= 0; value -= step) {
      const topmost = value + step > stack.rowsFit;
      ticks.push({
        value,
        label: topmost && yAxis.unit ? `${value} ${yAxis.unit}` : String(value),
        testId: yAxis.tickTestId,
        dataAttrs: { 'data-tick-value': value },
        gridTestId: yAxis.gridTestId,
        gridDataAttrs: { 'data-grid-value': value },
      });
    }
    return { min: 0, max, ticks };
  }, [plotHeight, stack, valueYAxis, yAxis]);
  const yFraction = (value: number) => fractionOf(renderAxis, value);
  const xFraction = (value: number) => {
    if (xAxis.mode !== 'linear') return 0;
    const span = xAxis.max - xAxis.min || 1;
    return (value - xAxis.min) / span;
  };
  // 堆得比图高还高时先把盒子撑高（有上限），而不是把点丢掉；盒子高度只由宽度决定，
  // 不会和测量结果互相追着改。
  const stackBoxMinHeight = stack
    ? Math.max(STACK_BOX_FLOOR, Math.min(STACK_BOX_CAP, stack.requiredPlotHeight + PLOT_INSET.top + PLOT_INSET.bottom + STACK_BOX_BORDER))
    : null;
  const stackOverflowCount = stack ? stack.overflow.reduce((sum, glyph) => sum + glyph.count, 0) : 0;
  const clipPathId = `${testId}-plot-clip`;

  // 时序图挂载时滚到最右端，先看到最新的战役；左侧渐隐提示还有更早的点位。
  useEffect(() => {
    const node = trackRef.current;
    if (!node || layout.fitMode !== 'scroll') return;
    node.scrollLeft = node.scrollWidth;
  }, [layout.contentWidth, layout.fitMode, trackRef]);

  const setActive = useCallback(
    (id: string | null) => {
      setActiveId(id);
      onActiveChange?.(id);
    },
    [onActiveChange],
  );

  const focusIndex = useCallback(
    (index: number) => {
      const target = placed[Math.max(0, Math.min(placed.length - 1, index))];
      if (!target) return;
      buttonsRef.current.get(target.id)?.focus();
      setActive(target.id);
    },
    [placed, setActive],
  );

  // 指针离开图区必须清掉激活态：提示框是浮层，不清就会永远钉在图上。
  // 但键盘焦点还停在某个点位时不清——否则鼠标扫过一下就把键盘用户的读数抹掉。
  const clearHover = useCallback(() => {
    const focused = typeof document === 'undefined' ? null : document.activeElement;
    if (focused && [...buttonsRef.current.values()].includes(focused as HTMLButtonElement)) return;
    setActive(null);
  }, [setActive]);

  if (points.length === 0) {
    return (
      <div
        data-testid={testId}
        {...applyDataAttrs(rootDataAttrs)}
        className="px-4 py-7 text-center text-[11px] text-muted-foreground"
      >
        {emptyMessage}
      </div>
    );
  }

  const lineLeft = PLOT_INSET.left;
  const lineRight = contentWidth - PLOT_INSET.right;
  const gutterStyle: CSSProperties = { top: PLOT_INSET.top, bottom: PLOT_INSET.bottom };
  // 命中区宽度不超过列距，否则相邻按钮会盖住彼此圆心，点错战役。
  const hitWidth = Math.max(8, Math.min(HIT_MIN, pitch));
  const hitHeight = stack ? stack.pitchY : xAxis.mode === 'ordinal' ? HIT_MIN : MIN_PITCH;
  const tabbableId = activeId ?? placed[0]?.id ?? null;

  return (
    <div data-testid={testId} {...applyDataAttrs(rootDataAttrs)} className="px-3 pb-4 pt-2 sm:px-4">
      <figure className="mx-auto w-full max-w-[58rem] text-[color:var(--chart-ink)]">
        {header}
        {guidePanel}

        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-y border-[color:var(--chart-border)] px-1 py-2 text-[9px] text-[color:var(--chart-ink-muted)]">
          {/* 左槽即使为空也要占位，否则没有 legendExtra 的图会把图例甩到左边，三张图对不齐。 */}
          <div className="min-w-0">{legendExtra}</div>
          <ul className="flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0" aria-label="图例">
            {series.map(item => (
              <li key={item.id} className="inline-flex items-center gap-1.5">
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                  <ScatterMark shape={item.shape} token={item.token} cx={6} cy={6} ringed={false} />
                </svg>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-2.5">
          <div className="relative h-full font-mono text-[9px] text-[color:var(--chart-ink-muted)]" aria-hidden="true">
            <div className="absolute inset-x-0" style={gutterStyle}>
              {renderAxis.ticks.map(tick => ((tick.hideLabel || (renderAxis.gutterLabels ?? []).some(
                label => Math.abs(yFraction(label.value) - yFraction(tick.value)) * plotHeight < 11,
              )) ? null : (
                <span
                  key={`tick-${tick.value}`}
                  data-testid={tick.testId}
                  {...applyDataAttrs(tick.dataAttrs)}
                  className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
                  style={{ top: `${yFraction(tick.value) * 100}%` }}
                >
                  {tick.label}
                </span>
              )))}
              {renderAxis.gutterLabels?.map(label => (
                <span
                  key={`gutter-${label.value}`}
                  data-testid={label.testId}
                  className="absolute right-0 -translate-y-1/2 whitespace-nowrap font-medium"
                  style={{ top: `${yFraction(label.value) * 100}%` }}
                >
                  {label.text}
                </span>
              ))}
            </div>
          </div>

          <div
            data-testid={scrollAreaTestId}
            {...applyDataAttrs(scrollAreaDataAttrs)}
            data-fit-mode={fitMode}
            data-mark-size={MARK_R * 2}
            data-mark-pitch={Math.round(pitch * 10) / 10}
            // data-layout 由元件自己挂，不由调用方传：三张图的绘图盒必须是同一个盒子。
            data-layout="campaign-scatter-landscape"
            onMouseLeave={clearHover}
            className="relative aspect-[8/5] min-h-[18rem] min-w-0 overflow-hidden rounded-[6px] border border-[color:var(--chart-border)] bg-[color:var(--chart-surface)] sm:min-h-0"
            // 带 aspect-ratio 的网格项一旦被 min-height 撑高，浏览器会反过来按比例推宽度而不是
            // 拉伸到列宽（justify-self: normal 对有比例的盒子按 start 处理）；写死 100% 宽度切断这条回路。
            style={stackBoxMinHeight == null ? undefined : { minHeight: stackBoxMinHeight, width: '100%' }}
          >
            <div
              ref={trackRef}
              className={`absolute inset-y-0 left-0 ${fitMode === 'scroll' ? 'overflow-x-auto overscroll-x-contain' : 'overflow-hidden'} [scrollbar-width:thin]`}
              // 没有 n= 计数栏的图不留这 32px：否则右边界会空出一条与其它图不一致的死白。
              style={{ right: bandCounts ? BAND_RAIL_W : 0 }}
            >
              <div className="relative h-full" style={{ minWidth: contentWidth }}>
                <svg
                  aria-hidden="true"
                  className="absolute left-0 top-0"
                  width={contentWidth}
                  height={boxHeight}
                  viewBox={`0 0 ${contentWidth} ${boxHeight}`}
                >
                  {stack ? (
                    <defs>
                      <clipPath id={clipPathId}>
                        <rect x={lineLeft} y={PLOT_INSET.top} width={Math.max(0, lineRight - lineLeft)} height={plotHeight} />
                      </clipPath>
                    </defs>
                  ) : null}
                  {renderAxis.ticks.map(tick => {
                    const y = Math.round(PLOT_INSET.top + yFraction(tick.value) * plotHeight) + 0.5;
                    return (
                      <line
                        key={`grid-${tick.value}`}
                        data-testid={tick.gridTestId}
                        {...applyDataAttrs(tick.gridDataAttrs)}
                        x1={lineLeft}
                        x2={lineRight}
                        y1={y}
                        y2={y}
                        shapeRendering="crispEdges"
                        style={{ stroke: CHART_GRID_VAR, strokeWidth: 1 }}
                      />
                    );
                  })}
                  {referenceLines.map(line => {
                    if (line.axis === 'x') {
                      const x = Math.round(lineLeft + xFraction(line.value) * (lineRight - lineLeft)) + 0.5;
                      return (
                        <line
                          key={`ref-x-${line.kind}-${line.value}`}
                          data-testid={line.testId}
                          data-reference-kind={line.kind}
                          data-reference-axis="x"
                          {...applyDataAttrs(line.dataAttrs)}
                          x1={x}
                          x2={x}
                          y1={PLOT_INSET.top}
                          y2={PLOT_INSET.top + plotHeight}
                          shapeRendering="crispEdges"
                          strokeDasharray={line.kind === 'threshold' ? '4 3' : undefined}
                          style={{
                            stroke: line.kind === 'threshold' ? CHART_THRESHOLD_VAR : CHART_AXIS_VAR,
                            strokeWidth: 1,
                          }}
                        />
                      );
                    }
                    const y = Math.round(PLOT_INSET.top + yFraction(line.value) * plotHeight) + 0.5;
                    return (
                      <line
                        key={`ref-${line.kind}-${line.value}`}
                        data-testid={line.testId}
                        data-reference-kind={line.kind}
                        {...applyDataAttrs(line.dataAttrs)}
                        x1={lineLeft}
                        x2={lineRight}
                        y1={y}
                        y2={y}
                        shapeRendering="crispEdges"
                        strokeDasharray={line.kind === 'threshold' ? '4 3' : undefined}
                        style={{
                          stroke: line.kind === 'threshold' ? CHART_THRESHOLD_VAR : CHART_AXIS_VAR,
                          strokeWidth: 1,
                        }}
                      />
                    );
                  })}
                  {stack && overlay ? (
                    <g aria-hidden="true" clipPath={`url(#${clipPathId})`}>
                      {overlay({
                        x: value => lineLeft + xFraction(value) * (lineRight - lineLeft),
                        countY: count => PLOT_INSET.top + plotHeight - count * stack.pitchY,
                        binWidth: stack.binWidth,
                        binPx: stack.binPx,
                        pitchY: stack.pitchY,
                        rowsFit: stack.rowsFit,
                        n: points.length,
                        plot: { left: lineLeft, right: lineRight, top: PLOT_INSET.top, bottom: PLOT_INSET.top + plotHeight },
                        clipPathId,
                      })}
                    </g>
                  ) : null}
                  {activePoint ? (
                    <g style={{ stroke: CHART_AXIS_VAR, strokeWidth: 1 }} shapeRendering="crispEdges">
                      {/* 堆叠布局里横向十字线会被读成「数值」，只留竖线指向所在档。 */}
                      {stack ? null : (
                        <line
                          data-testid="chart-crosshair-value"
                          x1={lineLeft}
                          x2={lineRight}
                          y1={Math.round(activePoint.cy) + 0.5}
                          y2={Math.round(activePoint.cy) + 0.5}
                        />
                      )}
                      <line
                        data-testid="chart-crosshair-column"
                        x1={Math.round(activePoint.cx) + 0.5}
                        x2={Math.round(activePoint.cx) + 0.5}
                        y1={PLOT_INSET.top}
                        y2={PLOT_INSET.top + plotHeight}
                      />
                    </g>
                  ) : null}
                  {placed.map(point => (
                    <g key={`mark-${point.id}`} data-mark-for={point.id}>
                      {point.clamped ? (
                        <path
                          d={clampedChevronPath(point.cx, point.cy, point.clamped)}
                          paintOrder="stroke"
                          style={{
                            fill: seriesTokenVar(point.series.token),
                            stroke: CHART_SURFACE_VAR,
                            strokeWidth: MARK_RING_W,
                          }}
                        />
                      ) : (
                        <ScatterMark
                          shape={point.series.shape}
                          token={point.series.token}
                          cx={point.cx}
                          cy={point.cy}
                          ringed
                          emphasized={point.id === activeId}
                        />
                      )}
                    </g>
                  ))}
                  {stack?.overflow.map(glyph => (
                    // 图高放不下的那一截：一档一个朝上的三角，不把 N 个点叠在同一像素上。
                    <path
                      key={`overflow-${glyph.bin}`}
                      data-testid="chart-stack-overflow"
                      data-overflow-count={glyph.count}
                      d={clampedChevronPath(glyph.cx, glyph.cy, 'up')}
                      paintOrder="stroke"
                      style={{ fill: 'var(--chart-ink-muted)', stroke: CHART_SURFACE_VAR, strokeWidth: MARK_RING_W }}
                    />
                  ))}
                  {stack ? placeXReferenceLabels(
                    referenceLines.filter(line => line.axis === 'x' && line.label),
                    value => Math.round(lineLeft + xFraction(value) * (lineRight - lineLeft)) + 0.5,
                    // 标签可以借用 12px 内边距，硬边是 SVG 两端：窄屏上「−1R 止损」才留得在墙左边。
                    0,
                    contentWidth,
                  ).map(({ line, x, side, row }) => {
                    // 标签贴在绘图区顶端、用墨色，位置由 placeXReferenceLabels 决定；
                    // 文字带表面色描边，堆到顶也能读。
                    return (
                      <text
                        key={`ref-label-${line.value}`}
                        data-testid={line.testId ? `${line.testId}-label` : undefined}
                        x={side === 'left' ? x - 4 : x + 4}
                        y={PLOT_INSET.top + 9 + row * 12}
                        textAnchor={side === 'left' ? 'end' : 'start'}
                        paintOrder="stroke"
                        className="font-mono"
                        style={{ fontSize: 9, fontWeight: 500, fill: 'var(--chart-ink-muted)', stroke: CHART_SURFACE_VAR, strokeWidth: 3 }}
                      >
                        {line.label}
                      </text>
                    );
                  }) : null}
                </svg>

                <div className="absolute left-0" style={{ top: PLOT_INSET.top, bottom: PLOT_INSET.bottom, width: contentWidth }}>
                  {stack?.overflow.map(glyph => (
                    <button
                      key={`overflow-${glyph.bin}`}
                      type="button"
                      data-testid="chart-stack-overflow-hit"
                      data-overflow-count={glyph.count}
                      aria-label={`该档另有 ${glyph.count} 场超出图高，未逐点绘制`}
                      tabIndex={-1}
                      title={`另有 ${glyph.count} 场超出图高`}
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full bg-transparent outline-none"
                      style={{ left: `${glyph.cx}px`, top: `${glyph.yPct}%`, width: `${hitWidth}px`, height: `${hitHeight}px` }}
                    />
                  ))}
                  {placed.map((point, index) => (
                    <button
                      key={point.id}
                      ref={node => {
                        if (node) buttonsRef.current.set(point.id, node);
                        else buttonsRef.current.delete(point.id);
                      }}
                      type="button"
                      data-testid={point.testId}
                      data-series-id={point.seriesId}
                      data-series-token={point.series.token}
                      data-marker-shape={point.series.shape}
                      {...applyDataAttrs(point.dataAttrs)}
                      aria-pressed={point.id === activeId}
                      aria-label={point.ariaLabel}
                      tabIndex={point.id === tabbableId ? 0 : -1}
                      onMouseEnter={() => setActive(point.id)}
                      onFocus={() => setActive(point.id)}
                      onBlur={event => {
                        // 焦点还在同一张图的另一个点位上时不清：那个点位的 onFocus 会接手。
                        const next = event.relatedTarget as Node | null;
                        if (next && event.currentTarget.parentElement?.contains(next)) return;
                        setActive(null);
                      }}
                      onClick={() => onSelect?.(point.id)}
                      onKeyDown={event => {
                        if (event.key === 'ArrowRight') { event.preventDefault(); focusIndex(index + 1); }
                        else if (event.key === 'ArrowLeft') { event.preventDefault(); focusIndex(index - 1); }
                        else if (event.key === 'Home') { event.preventDefault(); focusIndex(0); }
                        else if (event.key === 'End') { event.preventDefault(); focusIndex(placed.length - 1); }
                      }}
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      style={{
                        left: `${point.cx}px`,
                        top: `${point.yPct}%`,
                        width: `${hitWidth}px`,
                        height: `${hitHeight}px`,
                      }}
                    />
                  ))}
                </div>

                {activePoint ? (
                  <div
                    data-testid="chart-tooltip"
                    // 内容与按钮的 aria-label 完全重复，再挂 role="status" 会让读屏
                    // 每移动一个点位就念两遍（表头那条 aria-live 是第三遍）。视觉浮层，读屏静音。
                    aria-hidden="true"
                    className={`pointer-events-none absolute z-20 max-w-[15rem] rounded-[4px] border border-[color:var(--chart-border)] bg-[color:var(--chart-surface-raised)] px-2 py-1.5 text-left shadow-[0_2px_8px_rgba(0,0,0,0.18)] ${
                      // 堆叠布局里提示框挂在点位旁边而不是上方，否则会盖住正在读的这一柱。
                      stack ? '-translate-y-1/2' : '-translate-x-1/2 -translate-y-full'
                    }`}
                    style={stack ? {
                      // 右侧放不下 15rem 时改用 right 锚到点位左侧：用 left + translate 翻转会让
                      // 绝对定位盒子只剩锚点右侧那点可用宽度，文字被挤成两行。
                      ...(activePoint.cx + 12 + 240 > contentWidth
                        ? { right: `${contentWidth - (activePoint.cx - 12)}px` }
                        : { left: `${activePoint.cx + 12}px` }),
                      // 上下各留半个提示框：底行点位（分布图里最多的那些）的提示框不能被盒子裁掉下缘。
                      top: `${Math.min(boxHeight - STACK_TOOLTIP_HALF, Math.max(PLOT_INSET.top + STACK_TOOLTIP_HALF, activePoint.cy))}px`,
                    } : {
                      left: `${Math.min(contentWidth - 90, Math.max(90, activePoint.cx))}px`,
                      top: `${Math.max(38, activePoint.cy - 10)}px`,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
                        <rect x="0" y="4" width="10" height="2" rx="1" style={{ fill: seriesTokenVar(activePoint.series.token) }} />
                      </svg>
                      <span className="font-mono text-[12px] font-semibold tabular-nums text-[color:var(--chart-ink)]">
                        {activePoint.valueText}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[color:var(--chart-ink-secondary)]">{activePoint.label}</div>
                    {activePoint.metaText ? (
                      <div className="text-[9px] text-[color:var(--chart-ink-muted)]">{activePoint.metaText}</div>
                    ) : null}
                    {onSelect ? (
                      <div className="text-[9px] text-[color:var(--chart-ink-muted)]">点击进入战役</div>
                    ) : null}
                  </div>
                ) : null}

                <div
                  className="absolute bottom-0 left-0 text-center font-mono text-[9px] text-[color:var(--chart-ink-muted)]"
                  style={{ height: PLOT_INSET.bottom, width: contentWidth }}
                  aria-hidden="true"
                >
                  {xAxis.mode === 'ordinal'
                    ? Array.from({ length: xAxis.count }, (_, index) => {
                      const label = xAxis.labelAt(index);
                      if (!label) return null;
                      const usable = contentWidth - PLOT_INSET.left - PLOT_INSET.right;
                      const step = usable / Math.max(1, xAxis.count);
                      return (
                        <span
                          key={`xl-${index}`}
                          className="absolute -translate-x-1/2 whitespace-nowrap pt-1"
                          style={{ left: `${PLOT_INSET.left + step * (index + 0.5)}px`, top: 0 }}
                        >
                          {label}
                        </span>
                      );
                    })
                    : null}
                  {xAxis.mode === 'category'
                    ? xAxis.categories.map((category, index) => {
                      const usable = contentWidth - PLOT_INSET.left - PLOT_INSET.right;
                      const step = usable / Math.max(1, xAxis.categories.length);
                      return (
                        <span
                          key={`xc-${category.value}`}
                          className="absolute -translate-x-1/2 whitespace-nowrap pt-1"
                          style={{ left: `${PLOT_INSET.left + step * (index + 0.5)}px`, top: 0 }}
                        >
                          {category.label}
                        </span>
                      );
                    })
                    : null}
                  {xAxis.mode === 'linear'
                    ? xAxis.labels?.map(label => {
                      const usable = contentWidth - PLOT_INSET.left - PLOT_INSET.right;
                      const span = xAxis.max - xAxis.min || 1;
                      const fraction = (label.at - xAxis.min) / span;
                      // 首尾刻度落在绘图盒边界上，居中就会被裁掉半个字；两端改成贴边对齐。
                      const align = fraction <= 0.02
                        ? 'translate-x-0'
                        : fraction >= 0.98 ? '-translate-x-full' : '-translate-x-1/2';
                      return (
                        <span
                          key={`xn-${label.at}-${label.text}`}
                          className={`absolute whitespace-nowrap pt-1 ${align}`}
                          style={{ left: `${PLOT_INSET.left + fraction * usable}px`, top: 0 }}
                        >
                          {label.text}
                        </span>
                      );
                    })
                    : null}
                </div>
              </div>
            </div>

            {fitMode === 'scroll' ? (
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-6"
                  style={{ background: 'linear-gradient(to right, var(--chart-surface), transparent)' }}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 w-6"
                  style={{ right: bandCounts ? BAND_RAIL_W : 0, background: 'linear-gradient(to left, var(--chart-surface), transparent)' }}
                />
              </>
            ) : null}

            {bandCounts ? (
              <div
                className="pointer-events-none absolute right-0 border-l border-[color:var(--chart-border)]"
                style={{ ...gutterStyle, width: BAND_RAIL_W }}
                aria-label={bandCounts.ariaLabel ?? '纵轴区间散点数量'}
              >
                {bandCounts.items.map(band => (
                  <span
                    key={band.key}
                    data-testid={bandCounts.testId}
                    data-count={band.count}
                    data-band-lower={band.lower}
                    data-band-upper={band.upper}
                    aria-label={`${band.label}，${band.count} 场`}
                    className={`absolute right-0 -translate-y-1/2 pr-1 font-mono text-[8px] leading-none tabular-nums ${
                      band.count > 0 ? 'text-[color:var(--chart-ink-muted)]' : 'text-[color:var(--chart-axis)]'
                    }`}
                    style={{ top: `${band.top}%` }}
                  >
                    n={band.count}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-3 text-[9px] text-[color:var(--chart-ink-muted)]">
          <span>
            {directionHint}
            {fitMode === 'scroll' ? ' · 可左右滚动查看全部点位' : ''}
            {clampedCount > 0 ? ` · ${clampedCount} 个点位超出显示区间，已贴边标记` : ''}
            {stack && stackOverflowCount > 0
              ? ` · 最高一档 ${stack.tallest} 场，图高只放下 ${stack.rowsFit - 1} 场，另 ${stackOverflowCount} 场以顶端三角合并标记`
              : ''}
          </span>
          {footnote}
        </figcaption>
      </figure>
    </div>
  );
}

function ScatterMark({
  shape,
  token,
  cx,
  cy,
  ringed,
  emphasized,
}: {
  shape: ScatterMarkShape;
  token: ChartSeriesToken;
  cx: number;
  cy: number;
  ringed: boolean;
  emphasized?: boolean;
}) {
  // paint-order: stroke 让 2px 表面环画在 8px 实心之外；
  // 旧实现用 border-white 把 4px 点位吃掉一半，正是用户看到的模糊来源。
  const ring: CSSProperties = ringed
    ? { stroke: CHART_SURFACE_VAR, strokeWidth: MARK_RING_W }
    : {};
  const paintOrder = ringed ? 'stroke' : undefined;
  const fill = seriesTokenVar(token);
  const scale = emphasized ? 1.25 : 1;
  const r = MARK_R * scale;

  if (shape === 'ring') {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r - 1}
        style={{ fill: CHART_SURFACE_VAR, stroke: fill, strokeWidth: 2 }}
      />
    );
  }
  if (shape === 'circle') {
    return <circle cx={cx} cy={cy} r={r} paintOrder={paintOrder} style={{ fill, ...ring }} />;
  }
  return (
    <path
      d={markShapePath(shape, cx, cy)}
      paintOrder={paintOrder}
      style={{ fill, ...ring, transformOrigin: `${cx}px ${cy}px`, transform: emphasized ? 'scale(1.25)' : undefined }}
    />
  );
}
