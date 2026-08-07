import { useMemo, useState } from 'react';
import { ArrowLeft, CircleHelp } from 'lucide-react';
import {
  createCampaignMetricDomain,
  type CampaignMetricPoint,
} from '@/lib/campaignMetricSeries';
import type { CampaignOddsPoint } from '@/lib/campaignOddsSeries';
import { formatBeijingTime } from '@/lib/timeFormat';

export type CampaignMetricColorMode = 'signed' | 'risk' | 'quality' | 'importance' | 'mirrorTp';

export type CampaignMetricScatterGuide = {
  yAxis: string;
  point: string;
  colors: readonly {
    color: string;
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
  onBack?: () => void;
  onSelectCampaign: (campaignId: string) => void;
};

type CampaignOddsScatterPlotProps = {
  points: CampaignOddsPoint[];
  excludedMissingOddsCount?: number;
  excludedMissingOperationTimeCount?: number;
  onSelectCampaign: (campaignId: string) => void;
};

type CampaignMetricMarkerShape = 'circle' | 'diamond' | 'square' | 'ring';

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

function formatOdds(value: number) {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(2)}R`;
}

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

function metricPointColor(value: number, mode: CampaignMetricColorMode) {
  if (mode === 'risk') return '#F0B90B';
  if (mode === 'quality') return '#2B7FFF';
  if (mode === 'importance') return '#D99A00';
  if (mode === 'mirrorTp') {
    if (value >= 3) return '#0ECB81';
    if (value >= 2) return '#F0B90B';
    if (value >= 1) return '#F6465D';
    return '#98A2B3';
  }
  if (value > 0) return '#0ECB81';
  if (value < 0) return '#F6465D';
  return '#98A2B3';
}

function metricPointShape(value: number, mode: CampaignMetricColorMode): CampaignMetricMarkerShape {
  if (mode === 'mirrorTp') {
    if (value >= 3) return 'circle';
    if (value >= 2) return 'square';
    if (value >= 1) return 'diamond';
    return 'ring';
  }

  if (mode === 'signed') {
    if (value > 0) return 'circle';
    if (value < 0) return 'diamond';
    return 'ring';
  }

  return 'circle';
}

function legendMarkerShape(index: number, mode: CampaignMetricColorMode): CampaignMetricMarkerShape {
  if (mode === 'mirrorTp') {
    return (['circle', 'square', 'diamond', 'ring'] as const)[index] ?? 'circle';
  }

  if (mode === 'signed') {
    return (['circle', 'diamond', 'ring'] as const)[index] ?? 'circle';
  }

  return 'circle';
}

function markerShapeClass(shape: CampaignMetricMarkerShape) {
  if (shape === 'diamond') return 'rotate-45 rounded-[2px]';
  if (shape === 'square') return 'rounded-[2px]';
  return 'rounded-full';
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

const ODDS_SCATTER_GUIDE: CampaignMetricScatterGuide = {
  yAxis: '每场战役的实际盈亏比 b，单位为 R。b = 已实现盈亏 ÷ 初始最大预期亏损；正数表示盈利，负数表示亏损。',
  point: '点越高，实际盈亏比越大；点越低，亏损相对初始风险越深。每个点代表一场具备有效风险分母的战役。',
  colors: [
    { color: '#0ECB81', label: '绿色：b > 0，战役盈利。' },
    { color: '#F6465D', label: '红色：b < 0，战役亏损。' },
    { color: '#98A2B3', label: '灰色：b = 0，盈亏持平。' },
  ],
  referenceLines: [
    '灰色零线：盈亏平衡线。',
    '黄色 -1R 虚线：实际亏损等于初始最大预期亏损；低于该线表示亏损超过原定风险边界。',
  ],
};

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
  onBack,
  onSelectCampaign,
}: CampaignMetricScatterPlotProps) {
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
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
  const markerMaxSize = Number(
    Math.max(4, Math.min(10, 10 - Math.max(0, chartPoints.length - 24) * 0.045)).toFixed(1),
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

  if (chartPoints.length === 0) {
    return (
      <div
        data-testid={plotTestId}
        data-metric-key={metricKey}
        className="px-4 py-7 text-center text-[11px] text-muted-foreground"
      >
        暂无同时具备客观操作时间与{missingValueLabel}的战役。
      </div>
    );
  }

  return (
    <div
      data-testid={plotTestId}
      data-metric-key={metricKey}
      className="px-3 pb-4 pt-2 sm:px-4"
    >
      <figure className="mx-auto w-full max-w-[58rem] text-[#172033]">
        <div className="mb-2.5 flex min-h-6 items-center gap-3 text-[10px] text-[#667085]">
          <span className="inline-flex shrink-0 items-center gap-0.5">
            <span className="font-semibold text-[#344054]">{seriesLabel}</span>
            <button
              type="button"
              data-testid={`campaign-metric-guide-toggle-${metricKey}`}
              aria-label={`${guideOpen ? '收起' : '查看'}${metricLabel}散点图说明`}
              aria-expanded={guideOpen}
              aria-controls={`campaign-metric-guide-${metricKey}`}
              title="散点图说明"
              onClick={() => setGuideOpen(open => !open)}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[#98A2B3] transition-colors hover:bg-[#F2F4F7] hover:text-[#475467] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B]/40"
            >
              <CircleHelp aria-hidden="true" className="h-3 w-3" />
            </button>
          </span>
          <span
            className="min-w-0 flex-1 truncate border-l border-[#E4E7EC] pl-3 font-mono text-[#667085]"
            aria-live="polite"
          >
            {activePoint
              ? `#${activePoint.sequence} ${activePoint.title} · ${formatValue(activePoint.value)} · ${formatBeijingTime(activePoint.operationTime)}`
              : '悬停或聚焦点位读取数值；点击进入对应战役'}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-[#667085]">n={chartPoints.length}</span>
          {onBack ? (
            <button
              type="button"
              data-testid="campaign-metric-chart-back"
              aria-label={`收起${metricLabel}散点图并返回战役列表`}
              title="返回战役列表"
              onClick={onBack}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-transparent px-1.5 text-[9px] text-[#667085] transition-colors hover:border-[#D0D5DD] hover:bg-[#F7F9FB] hover:text-[#344054] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B]/45"
            >
              <ArrowLeft aria-hidden="true" className="h-3 w-3" />
              <span>返回列表</span>
            </button>
          ) : null}
        </div>

        {guideOpen ? (
          <div
            id={`campaign-metric-guide-${metricKey}`}
            data-testid={`campaign-metric-guide-${metricKey}`}
            className="mb-3 rounded-sm border border-[#E4E7EC] bg-[#F8FAFC] px-3 py-2.5 text-[10px] leading-[1.6] text-[#667085] shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
          >
            <dl className="space-y-1.5">
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-[#475467]">横轴</dt>
                <dd>按客观操作时间从早到晚等距排列，每一格代表一场战役；横向距离只表示先后顺序，不表示真实时间间隔。</dd>
              </div>
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-[#475467]">纵轴</dt>
                <dd>{guide.yAxis}</dd>
              </div>
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-[#475467]">颜色</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1">
                  {guide.colors.map(item => (
                    <span key={`${item.color}-${item.label}`} className="inline-flex items-start gap-1">
                      <span
                        aria-hidden="true"
                        className="mt-[4px] h-2 w-2 shrink-0 rounded-full border border-white"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{item.label}</span>
                    </span>
                  ))}
                </dd>
              </div>
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-[#475467]">点位</dt>
                <dd>{guide.point} 横向位置对应操作先后，纵向位置对应本指标数值；点击任一点进入对应战役。</dd>
              </div>
              {guide.referenceLines?.length ? (
                <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                  <dt className="font-medium text-[#475467]">参考线</dt>
                  <dd>{guide.referenceLines.join(' ')}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-y border-[#E4E7EC] bg-[#FAFBFC] px-1 py-2 text-[9px] text-[#667085]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-[#475467]">
            <span>范围 {formatValue(summary.min)} – {formatValue(summary.max)}</span>
            <span className="text-[#D0D5DD]">|</span>
            <span>中位数 {formatValue(summary.median)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="图例">
            {guide.colors.map((item, index) => {
              const shape = legendMarkerShape(index, colorMode);
              return (
                <span key={`${item.color}-${item.label}`} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 border border-white shadow-[0_0_0_1px_rgba(15,23,42,0.10)] ${markerShapeClass(shape)}`}
                    style={{
                      backgroundColor: shape === 'ring' ? 'transparent' : item.color,
                      borderColor: shape === 'ring' ? item.color : undefined,
                    }}
                  />
                  <span>{visibleLegendLabel(item.label)}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-2.5">
          <div className="relative h-full text-[9px] font-mono text-[#667085]" aria-hidden="true">
            <div className="absolute inset-x-0 bottom-7 top-3">
              {ticks.map(tick => {
                if (lossBoundaryValue === tick.value) return null;

                return (
                  <span
                    key={tick.value}
                    data-testid={
                      metricKey === 'odds'
                        ? 'campaign-odds-y-tick'
                        : `campaign-metric-y-tick-${metricKey}`
                    }
                    data-tick-value={tick.value}
                    className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
                    style={{ top: `${tick.top}%` }}
                  >
                    {metricKey === 'odds' ? formatIntegerOddsTick(tick.value) : formatValue(tick.value)}
                  </span>
                );
              })}
              {lossBoundaryValue != null ? (
                <span
                  data-testid="campaign-odds-loss-boundary-label"
                  className="absolute right-0 -translate-y-1/2 whitespace-nowrap font-medium text-[#D99A00]"
                  style={{ top: `${valuePosition(lossBoundaryValue, domain.min, domain.max)}%` }}
                >
                  -1R
                </span>
              ) : null}
            </div>
          </div>

          <div
            className="relative aspect-[8/5] min-h-[18rem] min-w-0 overflow-hidden rounded-[6px] border border-[#D9DEE7] bg-[#FCFDFE] shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:min-h-0"
            data-testid={scrollTestId}
            data-layout="campaign-scatter-landscape"
            data-marker-max-size={markerMaxSize}
          >
            <div className="absolute bottom-7 left-3 right-10 top-3">
              {ticks.map(tick => (
                <div
                  key={tick.value}
                  data-testid={metricKey === 'odds' ? 'campaign-odds-integer-grid-line' : undefined}
                  data-grid-value={metricKey === 'odds' ? tick.value : undefined}
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t-[0.5px] border-[#CBD3DE]/45"
                  style={{ top: `${tick.top}%` }}
                />
              ))}
              {domain.min < 0 && domain.max > 0 ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t-[0.5px] border-dashed border-[#667085]/45"
                  style={{ top: `${valuePosition(0, domain.min, domain.max)}%` }}
                />
              ) : null}
              {lossBoundaryValue != null ? (
                <div
                  data-testid="campaign-odds-loss-boundary-line"
                  data-reference-value={lossBoundaryValue}
                  aria-hidden="true"
                  className="absolute inset-x-0 z-[1] border-t border-dashed border-[#F0B90B]/80"
                  style={{ top: `${valuePosition(lossBoundaryValue, domain.min, domain.max)}%` }}
                />
              ) : null}
              {activePoint ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-[2] border-t border-dashed border-[#667085]/30"
                  style={{ top: `${valuePosition(activePoint.value, domain.min, domain.max)}%` }}
                />
              ) : null}

              <div
                className="absolute inset-0 grid"
                style={{ gridTemplateColumns: `repeat(${chartPoints.length}, minmax(0, 1fr))` }}
              >
                {chartPoints.map(point => {
                  const positive = point.value > 0;
                  const negative = point.value < 0;
                  const valueSign = positive ? 'positive' : negative ? 'negative' : 'zero';
                  const pointColor = metricPointColor(point.value, colorMode);
                  const pointShape = metricPointShape(point.value, colorMode);
                  const active = activeCampaignId === point.campaignId;
                  const operationTime = formatBeijingTime(point.operationTime);
                  const pointTestId = legacyOddsTestIds
                    ? `campaign-odds-point-${point.campaignId}`
                    : `campaign-metric-point-${metricKey}-${point.campaignId}`;
                  return (
                    <div key={point.campaignId} className="relative h-full min-w-0">
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 left-1/2 z-[2] border-l border-dashed border-[#667085]/30"
                        />
                      ) : null}
                      <button
                        type="button"
                        data-testid={pointTestId}
                        data-campaign-id={point.campaignId}
                        data-metric-key={metricKey}
                        data-metric-value={point.value}
                        data-value-sign={valueSign}
                        data-odds-sign={legacyOddsTestIds ? valueSign : undefined}
                        data-marker-shape={pointShape}
                        aria-pressed={active}
                        aria-label={`第 ${point.sequence} 场，${point.title}，${metricLabel} ${formatValue(point.value)}，操作时间 ${operationTime}，进入战役`}
                        title={`${point.title}\n${metricLabel} ${formatValue(point.value)}\n操作时间 ${operationTime}`}
                        onMouseEnter={() => setActiveCampaignId(point.campaignId)}
                        onFocus={() => setActiveCampaignId(point.campaignId)}
                        onClick={() => onSelectCampaign(point.campaignId)}
                        className="group absolute left-1/2 z-10 flex h-6 w-full min-w-0 max-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B]/60 focus-visible:ring-offset-1"
                        style={{ top: `${valuePosition(point.value, domain.min, domain.max)}%` }}
                      >
                        <span
                          aria-hidden="true"
                          className={`shrink-0 border border-white shadow-[0_0_0_1px_rgba(15,23,42,0.12)] transition-[transform,box-shadow] duration-150 group-hover:scale-125 group-focus-visible:scale-125 ${markerShapeClass(pointShape)} ${active ? 'scale-125 shadow-[0_0_0_2px_rgba(15,23,42,0.14)]' : ''}`}
                          style={{
                            width: `clamp(3px, 72%, ${markerMaxSize}px)`,
                            aspectRatio: '1 / 1',
                            backgroundColor: pointShape === 'ring' ? 'transparent' : pointColor,
                            borderColor: pointShape === 'ring' ? pointColor : undefined,
                          }}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className="pointer-events-none absolute bottom-7 right-1 top-3 w-8 border-l border-[#E4E7EC]/70"
              aria-label="纵轴区间散点数量"
            >
              {bands.map(band => (
                <span
                  key={band.key}
                  data-testid={bandCountTestId}
                  data-count={band.count}
                  data-band-lower={band.lower}
                  data-band-upper={band.upper}
                  aria-label={`${band.label}，${band.count} 场`}
                  className={`absolute right-0 -translate-y-1/2 font-mono text-[8px] leading-none tabular-nums ${
                    band.count > 0 ? 'text-[#98A2B3]' : 'text-[#D0D5DD]'
                  }`}
                  style={{ top: `${band.top}%` }}
                >
                  n={band.count}
                </span>
              ))}
            </div>

            <div
              className="absolute bottom-0 left-3 right-10 grid h-6 items-end pb-1 text-center text-[9px] font-mono text-[#98A2B3]"
              style={{ gridTemplateColumns: `repeat(${chartPoints.length}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {chartPoints.map((point, index) => {
                const showLabel = index === 0 || index === chartPoints.length - 1 || index % xLabelStep === 0;
                return <span key={point.campaignId}>{showLabel ? `#${point.sequence}` : ''}</span>;
              })}
            </div>
          </div>
        </div>

        <figcaption className="mt-1.5 flex items-center justify-between gap-3 text-[9px] text-[#98A2B3]">
          <span>早 → 晚 · 横轴每格一场战役</span>
          {excludedMissingValueCount > 0 || excludedMissingOperationTimeCount > 0 ? (
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
        </figcaption>
      </figure>
    </div>
  );
}

export function CampaignOddsScatterPlot({
  points,
  excludedMissingOddsCount = 0,
  excludedMissingOperationTimeCount = 0,
  onSelectCampaign,
}: CampaignOddsScatterPlotProps) {
  return (
    <CampaignMetricScatterPlot
      points={points.map(point => ({
        campaignId: point.campaignId,
        title: point.title,
        symbol: point.symbol,
        value: point.odds,
        operationTime: point.operationTime,
        sequence: point.sequence,
      }))}
      metricKey="odds"
      metricLabel="盈亏比"
      seriesLabel="赔率时序"
      guide={ODDS_SCATTER_GUIDE}
      formatValue={formatOdds}
      missingValueLabel="有效赔率"
      excludedMissingValueCount={excludedMissingOddsCount}
      excludedMissingOperationTimeCount={excludedMissingOperationTimeCount}
      legacyOddsTestIds
      onSelectCampaign={onSelectCampaign}
    />
  );
}
