import { useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, PriceLineOptions, LineStyle } from 'lightweight-charts';
import type { KlineData } from '@/hooks/useBinanceData';
import { useDrawing } from '@/hooks/useDrawing';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { IndicatorConfig } from '@/hooks/useIndicators';
import { calculateIndicator, INDICATOR_PRESETS } from '@/hooks/useIndicators';
import { ChartToolbar } from './ChartToolbar';
import { DrawingOverlay } from './DrawingOverlay';

interface Props {
  data: KlineData[];
  symbol: string;
  /** Called when user scrolls near the left edge — parent should load older data */
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
}

export function CandlestickChart({ data, symbol, onLoadOlder, loadingOlder }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<any>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

  // Track previous data length to know if we prepended (older) or appended (new candle)
  const prevDataLenRef = useRef(0);
  const prevOldestRef = useRef<number>(0);

  const [indicators, setIndicators] = usePersistedState<IndicatorConfig[]>('indicators', []);
  const drawing = useDrawing();

  // ============================================================
  // Chart creation (once)
  // ============================================================
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0B0E11' },
        textColor: '#848E9C',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1B1F26' },
        horzLines: { color: '#1B1F26' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: '#F0B90B', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#F0B90B' },
        horzLine: { color: '#F0B90B', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#363A45' },
      },
      rightPriceScale: {
        borderColor: '#1B1F26',
        scaleMargins: { top: 0.05, bottom: 0.25 },
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: '#1B1F26',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#0ECB81',
      downColor: '#F6465D',
      borderUpColor: '#0ECB81',
      borderDownColor: '#F6465D',
      wickUpColor: '#0ECB81',
      wickDownColor: '#F6465D',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      indicatorSeriesRef.current.clear();
    };
  }, []);

  // ============================================================
  // Lazy-load trigger: subscribe to visible range changes
  // When user scrolls near the left edge (logicalRange.from < 50),
  // call onLoadOlder to fetch more historical data.
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onLoadOlder) return;

    const handler = (range: { from: number; to: number } | null) => {
      if (!range || loadingOlder) return;
      // When the leftmost visible bar index is near 0, request more data
      if (range.from < 50) {
        onLoadOlder();
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [onLoadOlder, loadingOlder]);

  // ============================================================
  // Update candle + volume data
  // Smart: detect prepend vs append to preserve scroll position
  // ============================================================
  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || data.length === 0) return;
    const chart = chartRef.current;
    if (!chart) return;

    const currentOldest = data[0].time;
    const wasPrepend = prevDataLenRef.current > 0
      && data.length > prevDataLenRef.current
      && currentOldest < prevOldestRef.current;

    // Save current visible range before setting data (for scroll preservation)
    let savedRange: { from: number; to: number } | null = null;
    if (wasPrepend) {
      savedRange = chart.timeScale().getVisibleLogicalRange();
    }

    const candles: CandlestickData[] = data.map(d => ({
      time: (d.time / 1000) as Time,
      open: d.open, high: d.high, low: d.low, close: d.close,
    }));

    const volumes = data.map(d => ({
      time: (d.time / 1000) as Time,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(14, 203, 129, 0.25)' : 'rgba(246, 70, 93, 0.25)',
    }));

    seriesRef.current.setData(candles);
    volumeRef.current.setData(volumes);

    // Preserve scroll position after prepending older data
    // The new data added N bars to the left, so shift the visible range by N
    if (wasPrepend && savedRange) {
      const prependedCount = data.length - prevDataLenRef.current;
      chart.timeScale().setVisibleLogicalRange({
        from: savedRange.from + prependedCount,
        to: savedRange.to + prependedCount,
      });
    }

    // Update price line
    const lastCandle = data[data.length - 1];
    const isUp = lastCandle.close >= lastCandle.open;
    const color = isUp ? '#0ECB81' : '#F6465D';

    if (priceLineRef.current) {
      seriesRef.current.removePriceLine(priceLineRef.current);
    }
    priceLineRef.current = seriesRef.current.createPriceLine({
      price: lastCandle.close, color, lineWidth: 1,
      lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '',
    } as PriceLineOptions);

    prevDataLenRef.current = data.length;
    prevOldestRef.current = currentOldest;
  }, [data]);

  // ============================================================
  // INDICATOR RENDERING
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;

    const activeKeys = new Set<string>();

    // Track how many sub-chart oscillators are active for layout
    const subChartTypes = new Set<string>();

    for (const ind of indicators) {
      if (!ind.enabled) continue;
      const key = `${ind.type}_${ind.period}`;
      activeKeys.add(key);
      const preset = INDICATOR_PRESETS.find(p => p.type === ind.type);
      if (!preset) continue;

      const result = calculateIndicator(ind.type, data, ind.period);
      if (!result) continue;

      const scaleId = preset.isOverlay ? '' : ind.type.toLowerCase();
      if (!preset.isOverlay) subChartTypes.add(scaleId);

      switch (result.kind) {
        case 'line': {
          const lineData = result.data.map(p => ({ time: (p.time / 1000) as Time, value: p.value }));
          ensureLineSeries(chart, key, ind.color || preset.color, lineData, 2, scaleId || undefined);
          break;
        }
        case 'boll':
        case 'channel': {
          const chData = result.data;
          const keyUpper = `${key}_upper`;
          const keyLower = `${key}_lower`;
          activeKeys.add(keyUpper);
          activeKeys.add(keyLower);
          const color = ind.color || preset.color;
          ensureLineSeries(chart, key, color, chData.map(b => ({ time: (b.time / 1000) as Time, value: b.middle })), 2);
          ensureLineSeries(chart, keyUpper, color + '60', chData.map(b => ({ time: (b.time / 1000) as Time, value: b.upper })), 1);
          ensureLineSeries(chart, keyLower, color + '60', chData.map(b => ({ time: (b.time / 1000) as Time, value: b.lower })), 1);
          break;
        }
        case 'macd': {
          const keySignal = `${key}_signal`;
          const keyHist = `${key}_hist`;
          activeKeys.add(keySignal);
          activeKeys.add(keyHist);

          ensureLineSeries(chart, key, '#10B981', result.data.map(m => ({ time: (m.time / 1000) as Time, value: m.macd })), 1, scaleId);
          ensureLineSeries(chart, keySignal, '#EF4444', result.data.map(m => ({ time: (m.time / 1000) as Time, value: m.signal })), 1, scaleId);

          let histSeries = indicatorSeriesRef.current.get(keyHist);
          if (!histSeries) {
            histSeries = chart.addHistogramSeries({ priceScaleId: scaleId, color: '#3B82F680' } as any) as any;
            indicatorSeriesRef.current.set(keyHist, histSeries as any);
          }
          (histSeries as any).setData(result.data.map(m => ({
            time: (m.time / 1000) as Time, value: m.histogram,
            color: m.histogram >= 0 ? '#0ECB8180' : '#F6465D80',
          })));
          break;
        }
        case 'stoch': {
          const keyD = `${key}_d`;
          activeKeys.add(keyD);
          ensureLineSeries(chart, key, ind.color || preset.color, result.data.map(s => ({ time: (s.time / 1000) as Time, value: s.k })), 1, scaleId);
          ensureLineSeries(chart, keyD, '#EF4444', result.data.map(s => ({ time: (s.time / 1000) as Time, value: s.d })), 1, scaleId);
          break;
        }
        case 'dmi': {
          const keyMdi = `${key}_mdi`;
          const keyAdx = `${key}_adx`;
          activeKeys.add(keyMdi);
          activeKeys.add(keyAdx);
          ensureLineSeries(chart, key, '#0ECB81', result.data.map(d => ({ time: (d.time / 1000) as Time, value: d.pdi })), 1, scaleId);
          ensureLineSeries(chart, keyMdi, '#F6465D', result.data.map(d => ({ time: (d.time / 1000) as Time, value: d.mdi })), 1, scaleId);
          ensureLineSeries(chart, keyAdx, ind.color || preset.color, result.data.map(d => ({ time: (d.time / 1000) as Time, value: d.adx })), 2, scaleId);
          break;
        }
        case 'ichimoku': {
          const keyBase = `${key}_base`;
          const keySpanA = `${key}_spanA`;
          const keySpanB = `${key}_spanB`;
          activeKeys.add(keyBase);
          activeKeys.add(keySpanA);
          activeKeys.add(keySpanB);
          ensureLineSeries(chart, key, '#2962FF', result.data.map(d => ({ time: (d.time / 1000) as Time, value: d.conversion })), 1);
          ensureLineSeries(chart, keyBase, '#B71C1C', result.data.map(d => ({ time: (d.time / 1000) as Time, value: d.base })), 1);
          ensureLineSeries(chart, keySpanA, '#0ECB8160', result.data.map(d => ({ time: (d.time / 1000) as Time, value: d.spanA })), 1);
          ensureLineSeries(chart, keySpanB, '#F6465D60', result.data.map(d => ({ time: (d.time / 1000) as Time, value: d.spanB })), 1);
          break;
        }
      }
    }

    // Dynamically allocate sub-chart space based on count
    const subCount = subChartTypes.size;
    if (subCount > 0) {
      const spacePerSub = Math.min(0.15, 0.4 / subCount);
      let topStart = 1 - subCount * spacePerSub;
      for (const sid of subChartTypes) {
        chart.priceScale(sid).applyOptions({
          scaleMargins: { top: topStart, bottom: 1 - topStart - spacePerSub + 0.01 },
        });
        topStart += spacePerSub;
      }
    }

    // Cleanup removed indicators
    for (const [existingKey, series] of indicatorSeriesRef.current.entries()) {
      if (!activeKeys.has(existingKey)) {
        try { chart.removeSeries(series); } catch {}
        indicatorSeriesRef.current.delete(existingKey);
      }
    }
  }, [data, indicators]);

  function ensureLineSeries(
    chart: IChartApi, key: string, color: string,
    lineData: { time: Time; value: number }[],
    lineWidth: number = 2, priceScaleId?: string
  ) {
    let series = indicatorSeriesRef.current.get(key);
    if (!series) {
      series = chart.addLineSeries({
        color,
        lineWidth: lineWidth as any,
        priceScaleId: priceScaleId || '',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      if (priceScaleId && priceScaleId !== '') {
        chart.priceScale(priceScaleId).applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
      }
      indicatorSeriesRef.current.set(key, series);
    }
    series.setData(lineData);
  }

  const last = data.length > 0 ? data[data.length - 1] : null;
  const prev = data.length > 1 ? data[data.length - 2] : null;
  const priceChange = last && prev ? last.close - prev.close : 0;
  const priceChangePct = last && prev ? (priceChange / prev.close) * 100 : 0;
  const isUp = last ? last.close >= last.open : true;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Price header bar */}
      <div className="flex items-center gap-6 px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-bold text-foreground">{symbol}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">永续</span>
        </div>
        {last && (
          <>
            <div className="flex flex-col">
              <span className={`font-mono text-xl font-bold ${isUp ? 'trading-green' : 'trading-red'}`}>
                {last.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-x-6 gap-y-0.5 text-xs font-mono">
              <div>
                <span className="text-muted-foreground">24h涨跌</span>
                <span className={`ml-1.5 font-medium ${priceChange >= 0 ? 'trading-green' : 'trading-red'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(2)}%)
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">最高</span>
                <span className="ml-1.5 text-foreground">{last.high.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">最低</span>
                <span className="ml-1.5 text-foreground">{last.low.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div>
                <span className="text-muted-foreground">成交量</span>
                <span className="ml-1.5 text-foreground">{last.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          </>
        )}

        {/* Loading older indicator */}
        {loadingOlder && (
          <span className="text-[10px] text-primary animate-pulse font-mono ml-auto">加载更早数据...</span>
        )}
      </div>

      {/* Chart area with toolbars and drawing overlay */}
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="absolute inset-0" style={{ left: 32 }} />

        <ChartToolbar
          activeTool={drawing.activeDrawingTool}
          onToolChange={drawing.setActiveDrawingTool}
          indicators={indicators}
          onIndicatorsChange={setIndicators}
          onClearDrawings={drawing.clearAllDrawings}
        />

        <div className="absolute inset-0" style={{ left: 32 }}>
          <DrawingOverlay
            chart={chartRef.current}
            series={seriesRef.current}
            drawings={drawing.drawings}
            activeTool={drawing.activeDrawingTool}
            isDrawing={drawing.isDrawing}
            currentDrawingRef={drawing.currentDrawingRef}
            onStartDrawing={drawing.startDrawing}
            onUpdateDrawing={drawing.updateDrawing}
            onFinishDrawing={drawing.finishDrawing}
            onAddBrush={drawing.addBrushDrawing}
            onAddText={drawing.addTextDrawing}
            onAddMarker={drawing.addMarkerDrawing}
          />
        </div>
      </div>
    </div>
  );
}
