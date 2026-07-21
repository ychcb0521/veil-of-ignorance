import { useMemo } from 'react';
import { CandlestickChart, type AnalysisChartAnnotations, type AnalysisDraggablePriceLine, type AnalysisDraggableVerticalLine } from '@/components/CandlestickChart';
import type { KlineData } from '@/hooks/useBinanceData';
import { normalizeReplayKlines, sliceReplayKlines } from '@/lib/replayKlineWindow';
import type { ChartMarker, PriceLine, TimeBoundPriceLine, VerticalLine } from './ReplayCandleChart';

interface Props {
  klines: KlineData[];
  currentTime: number;
  intervalMs: number;
  symbol: string;
  markers?: ChartMarker[];
  priceLines?: PriceLine[];
  timeBoundPriceLines?: TimeBoundPriceLine[];
  verticalLines?: VerticalLine[];
  historyCandles?: number;
  /** Optional viewport anchor. `currentTime` still controls which future annotations are hidden. */
  viewportCenterTime?: number | null;
  /** 透传给主图的时区；不传则沿用 CandlestickChart 默认（Asia/Shanghai）。 */
  timezone?: string;
  /** 战役详情：保留全部 K 线，并把指定的初始时间范围缩放到铺满视口。 */
  fitAll?: boolean;
  /** fitAll 时首次铺满的时间范围；完整 klines 仍保留，缩小后可查看范围外数据。 */
  initialVisibleStartTime?: number | null;
  initialVisibleEndTime?: number | null;
  /** 是否显示最新价水平线；战役截取盘面默认关闭，避免干扰复盘标注。 */
  showLastPriceLine?: boolean;
  /** 可拖动的横向价格线（What-if 对冲/止盈触发价）。 */
  draggablePriceLines?: AnalysisDraggablePriceLine[];
  /** 拖动结束回调：返回线 id 和新价格。 */
  onDragPriceLine?: (id: string, price: number) => void;
  /** 可拖动的竖向时间线（What-if leg 开/平时间）。 */
  draggableVerticalLines?: AnalysisDraggableVerticalLine[];
  /** 拖动结束回调：返回线 id 和新时间戳。 */
  onDragVerticalLine?: (id: string, time: number) => void;
  /** 点击或拖动盘面竖线时，返回线 id。 */
  onSelectVerticalLine?: (id: string) => void;
}

function inferPricePrecision(values: number[]) {
  const valid = values.filter(value => Number.isFinite(value) && value > 0);
  if (valid.length === 0) return 2;
  const reference = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  if (reference >= 1000) return 2;
  if (reference >= 100) return 3;
  if (reference >= 1) return 4;
  if (reference >= 0.1) return 6;
  if (reference >= 0.01) return 7;
  return 8;
}

export function ReplayKlineChart({
  klines,
  currentTime,
  intervalMs,
  symbol,
  markers = [],
  priceLines = [],
  timeBoundPriceLines = [],
  verticalLines = [],
  historyCandles = 720,
  viewportCenterTime = null,
  timezone,
  fitAll = false,
  initialVisibleStartTime = null,
  initialVisibleEndTime = null,
  showLastPriceLine = true,
  draggablePriceLines,
  onDragPriceLine,
  draggableVerticalLines,
  onDragVerticalLine,
  onSelectVerticalLine,
}: Props) {
  const normalizedKlines = useMemo(() => normalizeReplayKlines(klines), [klines]);

  const replayData = useMemo(() => {
    // 战役详情用 fitAll：直接渲染全部已拉取的 K 线（最多 51 倍时间范围），
    // 由主图缩放到铺满视口；竖线/标记仍由下方 annotations 按 currentTime 过滤。
    if (fitAll) return normalizedKlines;
    return sliceReplayKlines(normalizedKlines, currentTime, historyCandles, viewportCenterTime);
  }, [fitAll, normalizedKlines, currentTime, historyCandles, viewportCenterTime]);

  const pricePrecision = useMemo(() => inferPricePrecision([
    ...replayData.flatMap(item => [item.open, item.high, item.low, item.close]),
    ...markers.map(item => item.price),
    ...priceLines.map(item => item.price),
    ...timeBoundPriceLines.map(item => item.price),
  ]), [replayData, markers, priceLines, timeBoundPriceLines]);

  const annotations = useMemo<AnalysisChartAnnotations>(() => {
    if (replayData.length === 0) return {};
    const latestCandleTime = replayData[replayData.length - 1].time;
    const dataEndTime = latestCandleTime + intervalMs;
    const cursorLine: VerticalLine = {
      time: Math.min(currentTime, latestCandleTime),
      color: 'rgba(240, 185, 11, 0.72)',
      width: 0.8,
    };

    return {
      markers: markers.filter(marker => marker.time <= currentTime),
      priceLines: priceLines.filter(line => !line.dim),
      timeBoundPriceLines: timeBoundPriceLines
        .filter(line => line.startTime <= currentTime)
        .map(line => ({
          ...line,
          endTime: Math.min(line.endTime, dataEndTime, currentTime),
          dim: line.dim,
        })),
      verticalLines: [
        ...verticalLines.filter(line => line.alwaysVisible || line.time <= currentTime),
        cursorLine,
      ],
    };
  }, [currentTime, intervalMs, markers, priceLines, replayData, timeBoundPriceLines, verticalLines]);

  if (replayData.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">
        无 K 线数据
      </div>
    );
  }

  return (
    <CandlestickChart
      data={replayData}
      symbol={symbol}
      rawSymbol={symbol}
      pricePrecision={pricePrecision}
      quantityPrecision={3}
      analysisMode
      analysisAnnotations={annotations}
      analysisFocusTime={viewportCenterTime ?? currentTime}
      analysisFitAll={fitAll}
      analysisVisibleStartTime={initialVisibleStartTime}
      analysisVisibleEndTime={initialVisibleEndTime}
      showLastPriceLine={showLastPriceLine}
      draggablePriceLines={draggablePriceLines}
      onDragPriceLine={onDragPriceLine}
      draggableVerticalLines={draggableVerticalLines}
      onDragVerticalLine={onDragVerticalLine}
      onSelectVerticalLine={onSelectVerticalLine}
      timezone={timezone}
    />
  );
}
