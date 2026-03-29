import { useEffect, useRef, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, PriceLineOptions, LineStyle } from 'lightweight-charts';
import type { KlineData } from '@/hooks/useBinanceData';
import { useDrawing } from '@/hooks/useDrawing';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { IndicatorConfig } from '@/hooks/useIndicators';
import { calcSMA, calcEMA, calcBOLL, calcRSI, calcMACD, calcATR, INDICATOR_PRESETS, IMPLEMENTED_TYPES } from '@/hooks/useIndicators';
import { ChartToolbar } from './ChartToolbar';
import { DrawingOverlay } from './DrawingOverlay';

interface Props {
  data: KlineData[];
  symbol: string;
}

export function CandlestickChart({ data, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<any>(null);
  // Track indicator line series refs for cleanup
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

  const [indicators, setIndicators] = usePersistedState<IndicatorConfig[]>('indicators', []);
  const drawing = useDrawing();

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

  // Update candle + volume data
  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || data.length === 0) return;

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
  }, [data]);

  // =====================================================================
  // INDICATOR RENDERING: Add/remove/update line series for each indicator
  // =====================================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;

    const activeKeys = new Set<string>();

    for (const ind of indicators) {
      if (!ind.enabled) continue;
      const key = `${ind.type}_${ind.period}`;
      activeKeys.add(key);
      const preset = INDICATOR_PRESETS.find(p => p.type === ind.type);
      if (!preset) continue;

      let lineData: { time: Time; value: number }[] = [];

      // Calculate indicator values
      switch (ind.type) {
        case 'MA':
          lineData = calcSMA(data, ind.period).map(p => ({ time: (p.time / 1000) as Time, value: p.value }));
          break;
        case 'EMA':
          lineData = calcEMA(data, ind.period).map(p => ({ time: (p.time / 1000) as Time, value: p.value }));
          break;
        case 'BOLL': {
          // BOLL produces 3 lines — we use 3 keys
          const boll = calcBOLL(data, ind.period);
          const keyUpper = `${key}_upper`;
          const keyLower = `${key}_lower`;
          activeKeys.add(keyUpper);
          activeKeys.add(keyLower);

          const middleData = boll.map(b => ({ time: (b.time / 1000) as Time, value: b.middle }));
          const upperData = boll.map(b => ({ time: (b.time / 1000) as Time, value: b.upper }));
          const lowerData = boll.map(b => ({ time: (b.time / 1000) as Time, value: b.lower }));

          ensureLineSeries(chart, key, ind.color || '#8B5CF6', middleData);
          ensureLineSeries(chart, keyUpper, '#8B5CF640', upperData, 1);
          ensureLineSeries(chart, keyLower, '#8B5CF640', lowerData, 1);
          continue; // skip default handling
        }
        case 'RSI':
          lineData = calcRSI(data, ind.period).map(p => ({ time: (p.time / 1000) as Time, value: p.value }));
          break;
        case 'MACD': {
          const macd = calcMACD(data, ind.period);
          const keySignal = `${key}_signal`;
          const keyHist = `${key}_hist`;
          activeKeys.add(keySignal);
          activeKeys.add(keyHist);

          const macdData = macd.map(m => ({ time: (m.time / 1000) as Time, value: m.macd }));
          const signalData = macd.map(m => ({ time: (m.time / 1000) as Time, value: m.signal }));

          ensureLineSeries(chart, key, '#10B981', macdData, 1, 'macd');
          ensureLineSeries(chart, keySignal, '#EF4444', signalData, 1, 'macd');

          // Histogram as separate handling via existing series
          let histSeries = indicatorSeriesRef.current.get(keyHist);
          if (!histSeries) {
            histSeries = chart.addHistogramSeries({
              priceScaleId: 'macd',
              color: '#3B82F680',
            } as any) as any;
            chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
            indicatorSeriesRef.current.set(keyHist, histSeries as any);
          }
          (histSeries as any).setData(macd.map(m => ({
            time: (m.time / 1000) as Time,
            value: m.histogram,
            color: m.histogram >= 0 ? '#0ECB8180' : '#F6465D80',
          })));
          continue;
        }
        case 'ATR':
          lineData = calcATR(data, ind.period).map(p => ({ time: (p.time / 1000) as Time, value: p.value }));
          break;
        case 'CHOP':
          lineData = calcCHOP(data, ind.period).map(p => ({ time: (p.time / 1000) as Time, value: p.value }));
          break;
      }

      if (lineData.length > 0) {
        const scaleId = preset.isOverlay ? undefined : ind.type.toLowerCase();
        ensureLineSeries(chart, key, ind.color || '#F0B90B', lineData, 2, scaleId);
      }
    }

    // Remove series that are no longer active
    for (const [existingKey, series] of indicatorSeriesRef.current.entries()) {
      if (!activeKeys.has(existingKey)) {
        try { chart.removeSeries(series); } catch {}
        indicatorSeriesRef.current.delete(existingKey);
      }
    }
  }, [data, indicators]);

  // Helper: create or update a line series
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
    <div className="flex flex-col h-full" style={{ background: '#0B0E11' }}>
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
      </div>

      {/* Chart area with toolbars and drawing overlay */}
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="absolute inset-0" style={{ left: 32 }} />

        {/* Toolbar */}
        <ChartToolbar
          activeTool={drawing.activeDrawingTool}
          onToolChange={drawing.setActiveDrawingTool}
          indicators={indicators}
          onIndicatorsChange={setIndicators}
          onClearDrawings={drawing.clearAllDrawings}
        />

        {/* SVG Drawing Overlay */}
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
