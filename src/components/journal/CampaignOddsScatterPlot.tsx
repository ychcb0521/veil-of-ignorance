import { useMemo, useState } from 'react';
import {
  createCampaignMetricDomain,
  type CampaignMetricPoint,
} from '@/lib/campaignMetricSeries';
import type { CampaignOddsPoint } from '@/lib/campaignOddsSeries';
import { formatBeijingTime } from '@/lib/timeFormat';

export type CampaignMetricColorMode = 'signed' | 'risk' | 'quality' | 'importance' | 'mirrorTp';

type CampaignMetricScatterPlotProps = {
  points: CampaignMetricPoint[];
  metricKey: string;
  metricLabel: string;
  seriesLabel: string;
  formatValue: (value: number) => string;
  missingValueLabel: string;
  excludedMissingValueCount?: number;
  excludedMissingOperationTimeCount?: number;
  colorMode?: CampaignMetricColorMode;
  legacyOddsTestIds?: boolean;
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

function valuePosition(value: number, min: number, max: number) {
  return 100 - ((value - min) / (max - min)) * 100;
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

export function CampaignMetricScatterPlot({
  points,
  metricKey,
  metricLabel,
  seriesLabel,
  formatValue,
  missingValueLabel,
  excludedMissingValueCount = 0,
  excludedMissingOperationTimeCount = 0,
  colorMode = 'signed',
  legacyOddsTestIds = false,
  onSelectCampaign,
}: CampaignMetricScatterPlotProps) {
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const domain = useMemo(
    () => createCampaignMetricDomain(points.map(point => point.value)),
    [points],
  );
  const ticks = useMemo(
    () => Array.from({ length: 5 }, (_, index) => {
      const value = domain.max - ((domain.max - domain.min) * index) / 4;
      return { value, top: valuePosition(value, domain.min, domain.max) };
    }),
    [domain],
  );
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
          <span className="font-medium text-foreground/70">{seriesLabel}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-foreground/55" aria-live="polite">
            {activePoint
              ? `#${activePoint.sequence} ${activePoint.title} · ${formatValue(activePoint.value)} · ${formatBeijingTime(activePoint.operationTime)}`
              : '按客观操作时间从早到晚排列；点击任一点进入对应战役'}
          </span>
          <span className="shrink-0">{points.length} 场</span>
        </div>

        <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
          <div className="relative h-full text-[9px] font-mono text-muted-foreground/65" aria-hidden="true">
            <div className="absolute inset-x-0 bottom-7 top-3">
              {ticks.map(tick => (
                <span
                  key={tick.value}
                  className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
                  style={{ top: `${tick.top}%` }}
                >
                  {formatValue(tick.value)}
                </span>
              ))}
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
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-border/55"
                  style={{ top: `${tick.top}%` }}
                />
              ))}
              {domain.min < 0 && domain.max > 0 ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-dashed border-foreground/30"
                  style={{ top: `${valuePosition(0, domain.min, domain.max)}%` }}
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
      formatValue={formatOdds}
      missingValueLabel="有效赔率"
      excludedMissingValueCount={excludedMissingOddsCount}
      excludedMissingOperationTimeCount={excludedMissingOperationTimeCount}
      legacyOddsTestIds
      onSelectCampaign={onSelectCampaign}
    />
  );
}
