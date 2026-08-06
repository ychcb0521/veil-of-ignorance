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

function niceIntegerTickStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 1) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, multiplier * magnitude);
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
  const domain = useMemo(
    () => createCampaignMetricDomain([
      ...points.map(point => point.value),
      ...(lossBoundaryValue == null ? [] : [lossBoundaryValue]),
    ]),
    [lossBoundaryValue, points],
  );
  const ticks = useMemo(() => {
    if (metricKey === 'odds') {
      return createIntegerOddsTicks(domain.min, domain.max);
    }

    return Array.from({ length: 5 }, (_, index) => {
      const value = domain.max - ((domain.max - domain.min) * index) / 4;
      return { value, top: valuePosition(value, domain.min, domain.max) };
    });
  }, [domain, metricKey]);
  const activePoint = points.find(point => point.campaignId === activeCampaignId) ?? null;
  const xLabelStep = Math.max(1, Math.ceil(points.length / 5));
  const plotTestId = legacyOddsTestIds
    ? 'campaign-odds-scatter-plot'
    : 'campaign-metric-scatter-plot';
  const scrollTestId = legacyOddsTestIds
    ? 'campaign-odds-scroll-area'
    : 'campaign-metric-scroll-area';

  if (points.length === 0) {
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
      className="px-3 pb-3 pt-1 sm:px-4"
    >
      <div className="mx-auto w-full max-w-[36rem]">
        <div className="mb-2 flex min-h-5 items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex shrink-0 items-center gap-0.5">
            <span className="font-medium text-foreground/70">{seriesLabel}</span>
            <button
              type="button"
              data-testid={`campaign-metric-guide-toggle-${metricKey}`}
              aria-label={`${guideOpen ? '收起' : '查看'}${metricLabel}散点图说明`}
              aria-expanded={guideOpen}
              aria-controls={`campaign-metric-guide-${metricKey}`}
              title="散点图说明"
              onClick={() => setGuideOpen(open => !open)}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/35 transition-colors hover:bg-muted/55 hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B]/40"
            >
              <CircleHelp aria-hidden="true" className="h-3 w-3" />
            </button>
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-foreground/55" aria-live="polite">
            {activePoint
              ? `#${activePoint.sequence} ${activePoint.title} · ${formatValue(activePoint.value)} · ${formatBeijingTime(activePoint.operationTime)}`
              : '按客观操作时间从早到晚排列；点击任一点进入对应战役'}
          </span>
          <span className="shrink-0">{points.length} 场</span>
          {onBack ? (
            <button
              type="button"
              data-testid="campaign-metric-chart-back"
              aria-label={`收起${metricLabel}散点图并返回战役列表`}
              title="返回战役列表"
              onClick={onBack}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-transparent px-1.5 text-[9px] text-muted-foreground/55 transition-colors hover:border-border/70 hover:bg-muted/55 hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B]/45"
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
            className="mb-3 border-y border-border/45 bg-muted/15 px-2.5 py-2 text-[10px] leading-[1.55] text-muted-foreground"
          >
            <dl className="space-y-1.5">
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-foreground/60">横轴</dt>
                <dd>按客观操作时间从早到晚等距排列，每一格代表一场战役；横向距离只表示先后顺序，不表示真实时间间隔。</dd>
              </div>
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-foreground/60">纵轴</dt>
                <dd>{guide.yAxis}</dd>
              </div>
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-foreground/60">颜色</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1">
                  {guide.colors.map(item => (
                    <span key={`${item.color}-${item.label}`} className="inline-flex items-start gap-1">
                      <span
                        aria-hidden="true"
                        className="mt-[4px] h-2 w-2 shrink-0 rounded-full border border-background"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{item.label}</span>
                    </span>
                  ))}
                </dd>
              </div>
              <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                <dt className="font-medium text-foreground/60">点位</dt>
                <dd>{guide.point} 横向位置对应操作先后，纵向位置对应本指标数值；点击任一点进入对应战役。</dd>
              </div>
              {guide.referenceLines?.length ? (
                <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
                  <dt className="font-medium text-foreground/60">参考线</dt>
                  <dd>{guide.referenceLines.join(' ')}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
          <div className="relative h-full text-[9px] font-mono text-muted-foreground/65" aria-hidden="true">
            <div className="absolute inset-x-0 bottom-7 top-3">
              {ticks.map(tick => {
                if (lossBoundaryValue === tick.value) return null;

                return (
                  <span
                    key={tick.value}
                    data-testid={metricKey === 'odds' ? 'campaign-odds-y-tick' : undefined}
                    data-tick-value={metricKey === 'odds' ? tick.value : undefined}
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
            className="relative aspect-square min-w-0 overflow-hidden rounded border border-border/55 bg-background/55"
            data-testid={scrollTestId}
          >
            <div className="absolute inset-x-3 bottom-7 top-3">
              {ticks.map(tick => (
                <div
                  key={tick.value}
                  data-testid={metricKey === 'odds' ? 'campaign-odds-integer-grid-line' : undefined}
                  data-grid-value={metricKey === 'odds' ? tick.value : undefined}
                  aria-hidden="true"
                  className={metricKey === 'odds'
                    ? 'absolute inset-x-0 border-t-[0.5px] border-border/25'
                    : 'absolute inset-x-0 border-t border-border/55'}
                  style={{ top: `${tick.top}%` }}
                />
              ))}
              {domain.min < 0 && domain.max > 0 ? (
                <div
                  aria-hidden="true"
                  className={metricKey === 'odds'
                    ? 'absolute inset-x-0 border-t-[0.5px] border-dashed border-foreground/20'
                    : 'absolute inset-x-0 border-t border-dashed border-foreground/30'}
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

              <div
                className="absolute inset-0 grid"
                style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
              >
                {points.map(point => {
                  const positive = point.value > 0;
                  const negative = point.value < 0;
                  const valueSign = positive ? 'positive' : negative ? 'negative' : 'zero';
                  const pointColor = metricPointColor(point.value, colorMode);
                  const operationTime = formatBeijingTime(point.operationTime);
                  const pointTestId = legacyOddsTestIds
                    ? `campaign-odds-point-${point.campaignId}`
                    : `campaign-metric-point-${metricKey}-${point.campaignId}`;
                  return (
                    <div key={point.campaignId} className="relative h-full min-w-0">
                      <button
                        type="button"
                        data-testid={pointTestId}
                        data-campaign-id={point.campaignId}
                        data-metric-key={metricKey}
                        data-metric-value={point.value}
                        data-value-sign={valueSign}
                        data-odds-sign={legacyOddsTestIds ? valueSign : undefined}
                        aria-label={`第 ${point.sequence} 场，${point.title}，${metricLabel} ${formatValue(point.value)}，操作时间 ${operationTime}，进入战役`}
                        title={`${point.title}\n${metricLabel} ${formatValue(point.value)}\n操作时间 ${operationTime}`}
                        onMouseEnter={() => setActiveCampaignId(point.campaignId)}
                        onMouseLeave={() => setActiveCampaignId(current => (
                          current === point.campaignId ? null : current
                        ))}
                        onFocus={() => setActiveCampaignId(point.campaignId)}
                        onBlur={() => setActiveCampaignId(current => (
                          current === point.campaignId ? null : current
                        ))}
                        onClick={() => onSelectCampaign(point.campaignId)}
                        className="group absolute left-1/2 z-10 flex h-5 w-full min-w-[6px] max-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#F0B90B]/60"
                        style={{ top: `${valuePosition(point.value, domain.min, domain.max)}%` }}
                      >
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full border border-background shadow-[0_0_0_1px_rgba(15,23,42,0.08)] transition-transform group-hover:scale-125 group-focus-visible:scale-125"
                          style={{ backgroundColor: pointColor }}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className="absolute inset-x-3 bottom-0 grid h-6 items-end pb-1 text-center text-[9px] font-mono text-muted-foreground/55"
              style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {points.map((point, index) => {
                const showLabel = index === 0 || index === points.length - 1 || index % xLabelStep === 0;
                return <span key={point.campaignId}>{showLabel ? `#${point.sequence}` : ''}</span>;
              })}
            </div>
          </div>
        </div>

        <div className="mt-1 flex items-center justify-between gap-3 text-[9px] text-muted-foreground/55">
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
        </div>
      </div>
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
