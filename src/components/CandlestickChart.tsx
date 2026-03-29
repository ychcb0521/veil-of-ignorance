import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import type { KlineData } from '@/hooks/useBinanceData';

interface Props {
  data: KlineData[];
  symbol: string;
}

export function CandlestickChart({ data, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: 'hsl(220, 10%, 50%)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'hsl(220, 15%, 10%)' },
        horzLines: { color: 'hsl(220, 15%, 10%)' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'hsl(43, 89%, 50%)', width: 1, style: 2 },
        horzLine: { color: 'hsl(43, 89%, 50%)', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: 'hsl(220, 15%, 15%)',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: 'hsl(220, 15%, 15%)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: 'hsl(160, 72%, 43%)',
      downColor: 'hsl(354, 91%, 62%)',
      borderUpColor: 'hsl(160, 72%, 43%)',
      borderDownColor: 'hsl(354, 91%, 62%)',
      wickUpColor: 'hsl(160, 72%, 43%)',
      wickDownColor: 'hsl(354, 91%, 62%)',
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
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || data.length === 0) return;

    const candles: CandlestickData[] = data.map(d => ({
      time: (d.time / 1000) as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const volumes = data.map(d => ({
      time: (d.time / 1000) as Time,
      value: d.volume,
      color: d.close >= d.open
        ? 'hsla(160, 72%, 43%, 0.3)'
        : 'hsla(354, 91%, 62%, 0.3)',
    }));

    seriesRef.current.setData(candles);
    volumeRef.current.setData(volumes);
  }, [data]);

  return (
    <div className="panel flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <span className="font-mono text-sm font-semibold text-primary">{symbol}</span>
        {data.length > 0 && (
          <>
            <span className={`font-mono text-sm font-bold ${
              data[data.length - 1].close >= data[data.length - 1].open
                ? 'trading-green' : 'trading-red'
            }`}>
              {data[data.length - 1].close.toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              Vol {(data[data.length - 1].volume).toFixed(0)}
            </span>
          </>
        )}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
