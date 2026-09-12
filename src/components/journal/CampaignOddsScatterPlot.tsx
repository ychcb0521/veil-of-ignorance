import { Fragment, useMemo, useState } from 'react';
import { ArrowLeft, CircleHelp } from 'lucide-react';
import {
  createCampaignMetricDomain,
  type CampaignMetricPoint,
} from '@/lib/campaignMetricSeries';
import { formatBeijingTime } from '@/lib/timeFormat';
import {
  ScatterPlot,
  type ScatterCountAxis,
  type ScatterPoint,
  type ScatterReferenceLine,
  type ScatterSeries,
  type ScatterStackScale,
  type ScatterXAxis,
  type ScatterYAxis,
} from '@/components/charts/ScatterPlot';
import { markShapePath, type ChartSeriesToken, type ScatterMarkShape } from '@/lib/chartTokens';
import { buildOddsDistributionModel, kdeCountPath, TAIL_THRESHOLD } from '@/lib/oddsDistribution';

/**
 * 时序：横轴按操作时间排战役；
 * 分布：横轴是指标数值本身（连续），纵轴是落在该档的场数；
 * 柱状：横轴是离散的结果档位，同一档的战役沿纵轴堆成一根柱——柱由点组成，点仍可悬停、点击进战役。
 */
export type CampaignMetricChartView = 'time' | 'distribution' | 'bars';

export type CampaignMetricColorMode =
  | 'signed'
  | 'risk'
  | 'quality'
  | 'importance'
  | 'mirrorTp'
  /** DSI 贡献：样本天然全是亏损战役，统一红色。 */
  | 'downside'
  /** USI 贡献：样本天然全是盈利战役，统一绿色。 */
  | 'upside';

export type CampaignMetricScatterGuide = {
  yAxis: string;
  point: string;
  colors: readonly {
    /** 只能是令牌名，写不出十六进制——图例与点位共用同一份配色，从类型上杜绝漂移。 */
    token: ChartSeriesToken;
    label: string;
  }[];
  referenceLines?: readonly string[];
};

type CampaignMetricScatterPlotProps = {
  points: CampaignMetricPoint[];
  metricKey: string;
  metricLabel: string;
  seriesLabel: string;
  guide: CampaignMetricScatterGuide;
  formatValue: (value: number) => string;
  missingValueLabel: string;
  excludedMissingValueCount?: number;
  excludedMissingOperationTimeCount?: number;
  colorMode?: CampaignMetricColorMode;
  legacyOddsTestIds?: boolean;
  /** 缺省 'time'。'distribution' 只对盈亏比这类以 R 计的带符号指标有意义。 */
  view?: CampaignMetricChartView;
  onBack?: () => void;
  onSelectCampaign: (campaignId: string) => void;
};

type CampaignMetricTick = {
  value: number;
  top: number;
};

type CampaignMetricScale = {
  min: number;
  max: number;
  ticks: CampaignMetricTick[];
};

type CampaignMetricBand = {
  key: string;
  lower: number;
  upper: number;
  top: number;
  count: number;
  label: string;
};

function formatIntegerOddsTick(value: number) {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized}R`;
}

function valuePosition(value: number, min: number, max: number) {
  return 100 - ((value - min) / (max - min)) * 100;
}

function metricPlotValue(metricKey: string, value: number) {
  return metricKey === 'expectedDrawdownPct' ? -Math.abs(value) : value;
}

function niceIntegerTickStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 1) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, multiplier * magnitude);
}

function niceContinuousTickStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10;
  return multiplier * magnitude;
}

function normalizeTickValue(value: number) {
  return Number(value.toPrecision(12));
}

function createIntegerOddsTicks(min: number, max: number) {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  if (lower > upper) return [];

  const step = niceIntegerTickStep((upper - lower) / 5);
  const first = Math.ceil(lower / step) * step;
  const values: number[] = [];

  for (let value = first; value <= upper; value += step) {
    values.push(value);
  }

  return values.reverse().map(value => ({
    value,
    top: valuePosition(value, min, max),
  }));
}

function createContinuousMetricScale(values: number[]): CampaignMetricScale {
  const baseDomain = createCampaignMetricDomain(values);
  let step = niceContinuousTickStep((baseDomain.max - baseDomain.min) / 5);
  let min = Math.floor(baseDomain.min / step) * step;
  let max = Math.ceil(baseDomain.max / step) * step;

  if (min === max) {
    min -= step;
    max += step;
  }

  while (Math.round((max - min) / step) + 1 > 7) {
    step = niceContinuousTickStep(step * 1.5);
    min = Math.floor(baseDomain.min / step) * step;
    max = Math.ceil(baseDomain.max / step) * step;
  }

  min = normalizeTickValue(min);
  max = normalizeTickValue(max);
  const tickCount = Math.round((max - min) / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = normalizeTickValue(max - index * step);
    return { value, top: valuePosition(value, min, max) };
  });

  return { min, max, ticks };
}

function createExpectedDrawdownScale(values: number[]): CampaignMetricScale {
  const finiteValues = values.filter(value => Number.isFinite(value));
  const minValue = finiteValues.length > 0 ? Math.min(...finiteValues, 0) : -1;
  const span = Math.max(Math.abs(minValue), Number.EPSILON);
  let step = niceContinuousTickStep(span / 5);
  let min = Math.floor(minValue / step) * step;

  while (Math.round((0 - min) / step) + 1 > 7) {
    step = niceContinuousTickStep(step * 1.5);
    min = Math.floor(minValue / step) * step;
  }

  if (min === 0) min = -step;
  min = normalizeTickValue(min);
  const max = 0;
  const tickCount = Math.round((max - min) / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = normalizeTickValue(max - index * step);
    return { value, top: valuePosition(value, min, max) };
  });

  return { min, max, ticks };
}

function createDiscreteMetricScale(metricKey: string): CampaignMetricScale | null {
  if (metricKey === 'importance') {
    const min = -0.5;
    const max = 5.5;
    return {
      min,
      max,
      ticks: [5, 4, 3, 2, 1, 0].map(value => ({
        value,
        top: valuePosition(value, min, max),
      })),
    };
  }

  if (metricKey === 'mirrorTp') {
    const min = -0.35;
    const max = 3.35;
    return {
      min,
      max,
      ticks: [3, 2, 1, 0].map(value => ({
        value,
        top: valuePosition(value, min, max),
      })),
    };
  }

  return null;
}

function uniqueSortedValues(values: number[]) {
  return [...new Set(values.map(normalizeTickValue))].sort((left, right) => left - right);
}

function createContinuousMetricBands(
  points: CampaignMetricPoint[],
  scale: CampaignMetricScale,
  formatValue: (value: number) => string,
): CampaignMetricBand[] {
  const boundaries = uniqueSortedValues([
    scale.min,
    ...scale.ticks.map(tick => tick.value),
    scale.max,
  ]);

  return boundaries.slice(0, -1).map((lower, index) => {
    const upper = boundaries[index + 1];
    const isLast = index === boundaries.length - 2;
    const count = points.filter(point => (
      point.value >= lower && (isLast ? point.value <= upper : point.value < upper)
    )).length;

    return {
      key: `${lower}-${upper}`,
      lower,
      upper,
      top: valuePosition((lower + upper) / 2, scale.min, scale.max),
      count,
      label: `${formatValue(lower)} 至 ${formatValue(upper)}`,
    };
  });
}

function createDiscreteMetricBands(
  points: CampaignMetricPoint[],
  scale: CampaignMetricScale,
  formatValue: (value: number) => string,
): CampaignMetricBand[] {
  return scale.ticks.map(tick => ({
    key: String(tick.value),
    lower: tick.value,
    upper: tick.value,
    top: tick.top,
    count: points.filter(point => Math.abs(point.value - tick.value) < 1e-9).length,
    label: `${formatValue(tick.value)} 档`,
  }));
}

function createCampaignMetricBands(
  points: CampaignMetricPoint[],
  scale: CampaignMetricScale,
  metricKey: string,
  formatValue: (value: number) => string,
) {
  return createDiscreteMetricScale(metricKey)
    ? createDiscreteMetricBands(points, scale, formatValue)
    : createContinuousMetricBands(points, scale, formatValue);
}

function visibleLegendLabel(label: string) {
  const withoutColor = label.includes('：') ? label.split('：').slice(1).join('：') : label;
  return withoutColor.split(/[，。]/)[0]?.trim() || label;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

/**
 * 每个配色模式的系列定义顺序必须和 guide.colors 一一对应，
 * 因为图例和点位共用同一份数组——两边分开写就一定会漂移。
 */
function seriesShapeAt(index: number, mode: CampaignMetricColorMode): ScatterMarkShape {
  if (mode === 'mirrorTp') {
    return (['circle', 'square', 'diamond', 'ring'] as const)[index] ?? 'circle';
  }
  // risk 模式过去所有点都是圆：绿红在 deutan 下 ΔE 只有 7.9，属于「必须配次编码」的地板band，
  // 少了形状就是硬性不合规，因此和 signed 用同一套形状。
  if (mode === 'signed' || mode === 'risk') {
    return (['circle', 'diamond', 'ring'] as const)[index] ?? 'circle';
  }
  return 'circle';
}

/** 点位落到 guide.colors 的哪一档；返回的是下标，颜色与形状都由它派生。 */
function metricSeriesIndex(
  value: number,
  mode: CampaignMetricColorMode,
  pnl?: number | null,
) {
  if (mode === 'risk') {
    // 预期回撤的纵轴只表达风险距离，方向由战役已实现盈亏决定。
    if (pnl != null && Number.isFinite(pnl)) {
      if (pnl > 0) return 0;
      if (pnl < 0) return 1;
    }
    return 2;
  }
  if (mode === 'downside' || mode === 'upside' || mode === 'quality' || mode === 'importance') {
    return 0;
  }
  if (mode === 'mirrorTp') {
    if (value >= 3) return 0;
    if (value >= 2) return 1;
    if (value >= 1) return 2;
    return 3;
  }
  if (value > 0) return 0;
  if (value < 0) return 1;
  return 2;
}

export function CampaignMetricScatterPlot({
  points,
  metricKey,
  metricLabel,
  seriesLabel,
  guide,
  formatValue,
  missingValueLabel,
  excludedMissingValueCount = 0,
  excludedMissingOperationTimeCount = 0,
  colorMode = 'signed',
  legacyOddsTestIds = false,
  view = 'time',
  onBack,
  onSelectCampaign,
}: CampaignMetricScatterPlotProps) {
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const distribution = view === 'distribution';
  // 柱状与分布都按横轴堆叠、纵轴读场数；区别只在横轴是离散档位还是连续数值。
  const bars = view === 'bars';
  const stacked = distribution || bars;
  const lossBoundaryValue = metricKey === 'odds' ? -1 : null;
  const chartPoints = useMemo(
    () => points.map(point => ({
      ...point,
      value: metricPlotValue(metricKey, point.value),
    })),
    [metricKey, points],
  );
  const scale = useMemo(() => {
    const values = [
      ...chartPoints.map(point => point.value),
      ...(lossBoundaryValue == null ? [] : [lossBoundaryValue]),
    ];

    if (metricKey === 'odds') {
      const oddsDomain = createCampaignMetricDomain(values);
      return {
        ...oddsDomain,
        ticks: createIntegerOddsTicks(oddsDomain.min, oddsDomain.max),
      };
    }

    if (metricKey === 'expectedDrawdownPct') {
      return createExpectedDrawdownScale(values);
    }

    return createDiscreteMetricScale(metricKey) ?? createContinuousMetricScale(values);
  }, [chartPoints, lossBoundaryValue, metricKey]);
  const domain = scale;
  const ticks = scale.ticks;
  const activePoint = chartPoints.find(point => point.campaignId === activeCampaignId) ?? null;
  // 分布视图的窗口、摘要、带宽都由同一份纯函数派生，和时序视图互不影响。
  const dist = useMemo(
    () => (distribution ? buildOddsDistributionModel(chartPoints) : null),
    [chartPoints, distribution],
  );
  /**
   * 柱状视图的档位表。档位取自该指标的离散刻度（镜像止盈就是 未实现/亏损/持平/盈利 四档），
   * 而不是数据里出现过的值——某一档一场没有时，那根空柱也要留在轴上，
   * 「持平 0 场」本身就是结论。柱状键与它的时序键共用同一套刻度：mirrorTpBars → mirrorTp。
   */
  const barColumns = useMemo(() => {
    if (!bars) return null;
    const discrete = createDiscreteMetricScale(metricKey.replace(/Bars$/, ''));
    const values = discrete
      ? discrete.ticks.map(tick => tick.value).sort((a, b) => a - b)
      : [...new Set(chartPoints.map(point => point.value))].sort((a, b) => a - b);
    return values.map(value => ({
      value,
      label: formatValue(value),
      count: chartPoints.filter(point => point.value === value).length,
    }));
  }, [bars, chartPoints, formatValue, metricKey]);
  const summary = useMemo(() => {
    const values = chartPoints.map(point => point.value);
    if (values.length === 0) {
      return { min: 0, median: 0, max: 0 };
    }

    return {
      min: Math.min(...values),
      median: median(values),
      max: Math.max(...values),
    };
  }, [chartPoints]);
  const bands = useMemo(
    () => createCampaignMetricBands(chartPoints, scale, metricKey, formatValue),
    [chartPoints, formatValue, metricKey, scale],
  );
  const xLabelStep = Math.max(1, Math.ceil(chartPoints.length / 6));
  const plotTestId = legacyOddsTestIds
    ? 'campaign-odds-scatter-plot'
    : 'campaign-metric-scatter-plot';
  const scrollTestId = legacyOddsTestIds
    ? 'campaign-odds-scroll-area'
    : 'campaign-metric-scroll-area';
  const bandCountTestId = legacyOddsTestIds
    ? 'campaign-odds-band-count'
    : 'campaign-metric-band-count';

  const series = useMemo<ScatterSeries[]>(
    () => guide.colors.map((item, index) => ({
      id: `s${index}`,
      label: visibleLegendLabel(item.label),
      token: item.token,
      shape: seriesShapeAt(index, colorMode),
    })),
    [colorMode, guide.colors],
  );

  // 分布视图按 b 升序喂给元件：按钮顺序 = 键盘左右键的漫游顺序 = 沿横轴从左到右。
  const orderedPoints = dist
    ? dist.sortedPoints
    : bars
      ? [...chartPoints].sort((a, b) => a.value - b.value || a.campaignId.localeCompare(b.campaignId))
      : chartPoints;
  const scatterPoints = useMemo<ScatterPoint[]>(
    () => orderedPoints.map((point, index) => {
      const positive = point.value > 0;
      const negative = point.value < 0;
      const valueSign = positive ? 'positive' : negative ? 'negative' : 'zero';
      const pnlSign = point.pnl == null || !Number.isFinite(point.pnl)
        ? 'unknown'
        : point.pnl > 0 ? 'positive' : point.pnl < 0 ? 'negative' : 'zero';
      const seriesIndex = metricSeriesIndex(point.value, colorMode, point.pnl);
      const operationTime = formatBeijingTime(point.operationTime);
      return {
        id: point.campaignId,
        x: stacked ? point.value : index,
        y: stacked ? 0 : point.value,
        seriesId: `s${Math.min(seriesIndex, Math.max(0, series.length - 1))}`,
        valueText: formatValue(point.value),
        label: `#${point.sequence} ${point.title}`,
        metaText: `操作时间 ${operationTime}`,
        ariaLabel: `第 ${point.sequence} 场，${point.title}，${metricLabel} ${formatValue(point.value)}，操作时间 ${operationTime}，进入战役`,
        testId: legacyOddsTestIds
          ? `campaign-odds-point-${point.campaignId}`
          : `campaign-metric-point-${metricKey}-${point.campaignId}`,
        dataAttrs: {
          'data-campaign-id': point.campaignId,
          'data-metric-key': metricKey,
          'data-metric-value': point.value,
          'data-value-sign': valueSign,
          'data-pnl-sign': pnlSign,
          'data-odds-sign': legacyOddsTestIds ? valueSign : undefined,
        },
      };
    }),
    [colorMode, formatValue, legacyOddsTestIds, metricKey, metricLabel, orderedPoints, series.length, stacked],
  );

  const countAxis = useMemo<ScatterCountAxis>(() => ({
    mode: 'count',
    tickTestId: `campaign-metric-y-tick-${metricKey}`,
    gridTestId: `campaign-metric-grid-line-${metricKey}`,
    unit: '场',
  }), [metricKey]);

  const distributionXAxis = useMemo<ScatterXAxis | null>(() => (dist ? {
    mode: 'linear',
    min: dist.domain.min,
    max: dist.domain.max,
    labels: dist.domain.ticks.map(value => ({ at: value, text: formatIntegerOddsTick(value) })),
  } : null), [dist]);

  const barsXAxis = useMemo<ScatterXAxis | null>(() => (barColumns ? {
    mode: 'category',
    categories: barColumns.map(column => ({ value: column.value, label: column.label })),
  } : null), [barColumns]);

  const distributionReferenceLines = useMemo<ScatterReferenceLine[]>(() => (dist ? [
    {
      axis: 'x',
      value: -1,
      kind: 'threshold',
      label: '-1R 止损',
      testId: `campaign-metric-loss-wall-${metricKey}`,
      dataAttrs: { 'data-reference-value': -1 },
    },
    {
      axis: 'x',
      value: 0,
      kind: 'zero',
      label: '0 盈亏平衡',
      testId: `campaign-metric-break-even-${metricKey}`,
      dataAttrs: { 'data-reference-value': 0 },
    },
  ] : []), [dist, metricKey]);

  const densityOverlay = useMemo(() => (dist ? (scale: ScatterStackScale) => (
    <path
      data-testid={`campaign-metric-density-curve-${metricKey}`}
      d={kdeCountPath(dist.values, dist.domain, scale, dist.bandwidth)}
      fill="none"
      style={{ stroke: 'var(--chart-ink-secondary)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }}
    />
  ) : undefined), [dist, metricKey]);

  const yAxis = useMemo<ScatterYAxis>(() => ({
    min: domain.min,
    max: domain.max,
    ticks: ticks.map(tick => ({
      value: tick.value,
      label: metricKey === 'odds' ? formatIntegerOddsTick(tick.value) : formatValue(tick.value),
      testId: metricKey === 'odds' ? 'campaign-odds-y-tick' : `campaign-metric-y-tick-${metricKey}`,
      dataAttrs: { 'data-tick-value': tick.value },
      gridTestId: metricKey === 'odds' ? 'campaign-odds-integer-grid-line' : undefined,
      gridDataAttrs: metricKey === 'odds' ? { 'data-grid-value': tick.value } : undefined,
      hideLabel: lossBoundaryValue === tick.value,
    })),
    gutterLabels: lossBoundaryValue == null
      ? undefined
      // -1R 标签留在不随图滚动的纵轴栏里，否则横向滚动后阈值就没了参照。
      : [{ value: lossBoundaryValue, text: '-1R', testId: 'campaign-odds-loss-boundary-label' }],
  }), [domain.max, domain.min, formatValue, lossBoundaryValue, metricKey, ticks]);

  const referenceLines = useMemo<ScatterReferenceLine[]>(() => {
    const lines: ScatterReferenceLine[] = [];
    if (domain.min < 0 && domain.max > 0) {
      lines.push({ value: 0, kind: 'zero' });
    }
    if (lossBoundaryValue != null) {
      lines.push({
        value: lossBoundaryValue,
        kind: 'threshold',
        testId: 'campaign-odds-loss-boundary-line',
        dataAttrs: { 'data-reference-value': lossBoundaryValue },
      });
    }
    return lines;
  }, [domain.max, domain.min, lossBoundaryValue]);

  const header = (
    <div className="mb-2.5 flex min-h-6 items-center gap-3 text-[10px] text-[color:var(--chart-ink-muted)]">
      <span className="inline-flex shrink-0 items-center gap-0.5">
        <span className="font-semibold text-[color:var(--chart-ink-secondary)]">{seriesLabel}</span>
        <button
          type="button"
          data-testid={`campaign-metric-guide-toggle-${metricKey}`}
          aria-label={`${guideOpen ? '收起' : '查看'}${metricLabel}散点图说明`}
          aria-expanded={guideOpen}
          aria-controls={`campaign-metric-guide-${metricKey}`}
          title="散点图说明"
          onClick={() => setGuideOpen(open => !open)}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--chart-ink-muted)] transition-colors hover:text-[color:var(--chart-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          <CircleHelp aria-hidden="true" className="h-3 w-3" />
        </button>
      </span>
      <span
        className="min-w-0 flex-1 truncate border-l border-[color:var(--chart-border)] pl-3 font-mono"
        aria-live="polite"
      >
        {activePoint
          ? `#${activePoint.sequence} ${activePoint.title} · ${formatValue(activePoint.value)} · ${formatBeijingTime(activePoint.operationTime)}`
          : '悬停或聚焦点位读取数值；点击进入对应战役'}
      </span>
      <span className="shrink-0 font-mono tabular-nums">n={chartPoints.length}</span>
      {onBack ? (
        <button
          type="button"
          data-testid="campaign-metric-chart-back"
          aria-label={`收起${metricLabel}散点图并返回战役列表`}
          title="返回战役列表"
          onClick={onBack}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-transparent px-1.5 text-[9px] transition-colors hover:border-[color:var(--chart-border)] hover:text-[color:var(--chart-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          <ArrowLeft aria-hidden="true" className="h-3 w-3" />
          <span>返回列表</span>
        </button>
      ) : null}
    </div>
  );

  const guidePanel = guideOpen ? (
    <div
      id={`campaign-metric-guide-${metricKey}`}
      data-testid={`campaign-metric-guide-${metricKey}`}
      className="mb-3 rounded-sm border border-[color:var(--chart-border)] bg-[color:var(--chart-surface-raised)] px-3 py-2.5 text-[10px] leading-[1.6] text-[color:var(--chart-ink-secondary)]"
    >
      <dl className="space-y-1.5">
        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
          <dt className="font-medium text-[color:var(--chart-ink)]">横轴</dt>
          {dist ? (
            <dd>横轴就是盈亏比 b 本身，单位 R，线性刻度，不考虑时间先后。显示区间取 p2–p98 的稳健窗口并封顶在 +10R；超出右缘的极端盈利贴边画成三角并在脚注计数，−1R 左侧的亏损照常落在墙外。</dd>
          ) : (
            <dd>按客观操作时间从早到晚等距排列，每一格代表一场战役；横向距离只表示先后顺序，不表示真实时间间隔。战役较多时图区可左右滚动，点位大小固定不缩小。</dd>
          )}
        </div>
        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
          <dt className="font-medium text-[color:var(--chart-ink)]">纵轴</dt>
          <dd>{guide.yAxis}</dd>
        </div>
        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
          <dt className="font-medium text-[color:var(--chart-ink)]">颜色</dt>
          <dd className="flex flex-wrap gap-x-3 gap-y-1">
            {guide.colors.map((item, index) => (
              <span key={item.label} className="inline-flex items-start gap-1">
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="mt-[2px] shrink-0">
                  <GuideSwatch token={item.token} shape={seriesShapeAt(index, colorMode)} />
                </svg>
                <span>{item.label}</span>
              </span>
            ))}
          </dd>
        </div>
        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
          <dt className="font-medium text-[color:var(--chart-ink)]">点位</dt>
          {bars ? (
            <dd>{guide.point} 横向位置只表示所属档位，档内的左右位置不携带含义：一行放不下时点会并排铺开，柱因此有宽度。纵向位置是这一档里的堆叠序号，从底线往上数；左侧刻度已按每行点数折算成场数。</dd>
          ) : dist ? (
            <dd>{guide.point} 横向位置吸附到所在档的中心：每 1R 等分成若干档、每档至少 14px 宽，−1R 与 0 恰好是档边界，越过止损墙的亏损永远画在墙左边；精确 b 看提示框。纵向位置是同一档里的堆叠序号，从底线往上数。图高放不下的档会撑高图盒，撑到上限仍放不下时顶端合成一个三角并在脚注报数。点击任一点进入对应战役。</dd>
          ) : (
            <dd>{guide.point} 横向位置对应操作先后，纵向位置对应本指标数值；点击任一点进入对应战役。右侧 n= 是各纵轴区间的全域点数，可用来读出被长尾压扁的中段密度。</dd>
          )}
        </div>
        {guide.referenceLines?.length ? (
          <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
            <dt className="font-medium text-[color:var(--chart-ink)]">参考线</dt>
            <dd>{guide.referenceLines.join(' ')}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  ) : null;

  return (
    <ScatterPlot
      points={scatterPoints}
      series={series}
      yAxis={stacked ? countAxis : yAxis}
      xAxis={distributionXAxis ?? barsXAxis ?? {
        mode: 'ordinal',
        count: chartPoints.length,
        labelAt: index => {
          const point = chartPoints[index];
          if (!point) return null;
          const show = index === 0 || index === chartPoints.length - 1 || index % xLabelStep === 0;
          return show ? `#${point.sequence}` : null;
        },
      }}
      referenceLines={dist ? distributionReferenceLines : bars ? [] : referenceLines}
      overlay={densityOverlay}
      bandCounts={stacked ? undefined : {
        testId: bandCountTestId,
        items: bands.map(band => ({
          key: band.key,
          top: band.top,
          count: band.count,
          lower: band.lower,
          upper: band.upper,
          label: band.label,
        })),
      }}
      onSelect={onSelectCampaign}
      onActiveChange={setActiveCampaignId}
      emptyMessage={`暂无同时具备客观操作时间与${missingValueLabel}的战役。`}
      testId={plotTestId}
      scrollAreaTestId={scrollTestId}
      rootDataAttrs={{ 'data-metric-key': metricKey }}
      header={header}
      guidePanel={guidePanel}
      legendExtra={dist ? (
        <div
          data-testid={`campaign-metric-summary-${metricKey}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums"
        >
          <span>范围 {formatValue(dist.summary.min)} – {formatValue(dist.summary.max)}</span>
          <span className="text-[color:var(--chart-axis)]">|</span>
          <span>中位数 {formatValue(dist.summary.median)}</span>
          <span className="text-[color:var(--chart-axis)]">|</span>
          <span>均值 {formatValue(dist.summary.mean)}</span>
          <span className="text-[color:var(--chart-axis)]">|</span>
          <span data-testid={`campaign-metric-win-rate-${metricKey}`}>
            胜率 {Math.round(dist.summary.winRate * 100)}% ({dist.summary.winCount}/{dist.summary.n})
          </span>
          <span className="text-[color:var(--chart-axis)]">|</span>
          <span data-testid={`campaign-metric-tail-count-${metricKey}`}>
            右尾 &gt;+{TAIL_THRESHOLD}R {dist.summary.tailCount} 场
          </span>
          <span className="text-[color:var(--chart-axis)]">|</span>
          <span className="inline-flex items-center gap-1.5">
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
              <path d="M 1 9 C 3 9 4 3 6 3 C 8 3 9 9 11 9" fill="none" style={{ stroke: 'var(--chart-ink-secondary)', strokeWidth: 2, strokeLinecap: 'round' }} />
            </svg>
            <span>平滑密度（每档期望场数）</span>
          </span>
        </div>
      ) : barColumns ? (
        <div
          data-testid={`campaign-metric-summary-${metricKey}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums"
        >
          {barColumns.map((column, index) => (
            <Fragment key={column.value}>
              {index > 0 ? <span className="text-[color:var(--chart-axis)]">|</span> : null}
              <span data-testid={`campaign-metric-bar-count-${metricKey}-${column.value}`}>
                {column.label} {column.count} 场
              </span>
            </Fragment>
          ))}
          <span className="text-[color:var(--chart-axis)]">|</span>
          <span>合计 {chartPoints.length} 场</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
          <span>范围 {formatValue(summary.min)} – {formatValue(summary.max)}</span>
          <span className="text-[color:var(--chart-axis)]">|</span>
          <span>中位数 {formatValue(summary.median)}</span>
        </div>
      )}
      directionHint={dist
        ? '横轴 盈亏比 b（R）· 纵轴 场数 · 不按时间排列'
        : bars
          ? `横轴 ${metricLabel}档位 · 纵轴 场数 · 不按时间排列`
          : '早 → 晚 · 横轴每格一场战役'}
      footnote={excludedMissingValueCount > 0 || excludedMissingOperationTimeCount > 0 ? (
        <span>
          未绘制：
          {excludedMissingValueCount > 0
            ? `无${missingValueLabel} ${excludedMissingValueCount} 场`
            : ''}
          {excludedMissingValueCount > 0 && excludedMissingOperationTimeCount > 0 ? ' · ' : ''}
          {excludedMissingOperationTimeCount > 0
            ? `无客观操作时间 ${excludedMissingOperationTimeCount} 场`
            : ''}
        </span>
      ) : null}
    />
  );
}

function GuideSwatch({ token, shape }: { token: ChartSeriesToken; shape: ScatterMarkShape }) {
  const fill = `var(--chart-${token})`;
  if (shape === 'ring') {
    return <circle cx={6} cy={6} r={3} style={{ fill: 'var(--chart-surface)', stroke: fill, strokeWidth: 2 }} />;
  }
  if (shape === 'circle') {
    return <circle cx={6} cy={6} r={4} style={{ fill }} />;
  }
  return <path d={markShapePath(shape, 6, 6)} style={{ fill }} />;
}
