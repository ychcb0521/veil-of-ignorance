/**
 * KlineCharts v9 based candlestick chart with native drawing tools and indicators.
 * Uses applyNewData / updateData / applyMoreData for data feeding.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { init, dispose, CandleType, LineType, type Chart, type KLineData, type OverlayCreate } from 'klinecharts';
import type { KlineData } from '@/hooks/useBinanceData';
import { useTheme } from '@/hooks/useTheme';
import { DrawingToolbar } from './DrawingToolbar';
import { IndicatorMenu } from './IndicatorMenu';
import { BarChart3, X } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { TradeRecord } from '@/types/trading';

// Mapping from our indicator IDs to klinecharts built-in indicator names
const KLINE_INDICATOR_MAP: Record<string, string> = {
  MA: 'MA', EMA: 'EMA', SMA: 'SMA', WMA: 'WMA',
  BOLL: 'BOLL', SAR: 'SAR',
  RSI: 'RSI', MACD: 'MACD', KDJ: 'KDJ',
  ATR: 'ATR', CCI: 'CCI', OBV: 'OBV', ROC: 'ROC',
  STOCH: 'KDJ', VOL: 'VOL',
  DMI: 'DMI', TRIX: 'TRIX',
  WR: 'WR', MFI: 'MFI',
};

// Overlay tool name mapping for klinecharts built-in overlays
const OVERLAY_MAP: Record<string, string> = {
  TrendLine: 'segment',
  Ray: 'rayLine',
  ExtendedLine: 'straightLine',
  HorizontalLine: 'horizontalStraightLine',
  VerticalLine: 'verticalStraightLine',
  ParallelChannel: 'parallelStraightLine',
  FibRetracement: 'fibonacciLine',
  Rectangle: 'rect',
  Circle: 'circle',
  Brush: 'segment',
  Text: 'simpleAnnotation',
  Marker: 'simpleTag',
  Measure: 'priceLine',
  LongPosition: 'priceLine',
  ShortPosition: 'priceLine',
  PriceLine: 'priceLine',
};

export interface IndicatorConfig {
  type: string;
  period: number;
  color?: string;
  enabled: boolean;
}

interface Props {
  data: KlineData[];
  symbol: string;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  tradeHistory?: TradeRecord[];
  rawSymbol?: string;
}

// Convert our KlineData to klinecharts KLineData
function toKLineData(d: KlineData): KLineData {
  return {
    timestamp: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  };
}

// Dark theme styles
const DARK_STYLES = {
  grid: {
    show: true,
    horizontal: { color: '#1B1F26' },
    vertical: { color: '#1B1F26' },
  },
  candle: {
    type: CandleType.CandleSolid,
    bar: {
      upColor: '#0ECB81',
      downColor: '#F6465D',
      upBorderColor: '#0ECB81',
      downBorderColor: '#F6465D',
      upWickColor: '#0ECB81',
      downWickColor: '#F6465D',
    },
    priceMark: {
      show: true,
      last: {
        show: true,
        upColor: '#0ECB81',
        downColor: '#F6465D',
        line: { show: true, style: LineType.Dashed, dashedValue: [4, 4] },
      },
    },
  },
  xAxis: { show: true, tickText: { color: '#848E9C' } },
  yAxis: { show: true, tickText: { color: '#848E9C' } },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { color: '#F0B90B33', style: LineType.Dashed },
      text: { color: '#FFFFFF', borderColor: '#F0B90B', backgroundColor: '#363A45' },
    },
    vertical: {
      show: true,
      line: { color: '#F0B90B33', style: LineType.Dashed },
      text: { color: '#FFFFFF', borderColor: '#F0B90B', backgroundColor: '#363A45' },
    },
  },
  separator: { color: '#1B1F26' },
};

// Light theme styles
const LIGHT_STYLES = {
  grid: {
    show: true,
    horizontal: { color: '#EAECEF' },
    vertical: { color: '#EAECEF' },
  },
  candle: {
    type: CandleType.CandleSolid,
    bar: {
      upColor: '#0ECB81',
      downColor: '#F6465D',
      upBorderColor: '#0ECB81',
      downBorderColor: '#F6465D',
      upWickColor: '#0ECB81',
      downWickColor: '#F6465D',
    },
    priceMark: {
      show: true,
      last: {
        show: true,
        upColor: '#0ECB81',
        downColor: '#F6465D',
        line: { show: true, style: LineType.Dashed, dashedValue: [4, 4] },
      },
    },
  },
  xAxis: { show: true, tickText: { color: '#474D57' } },
  yAxis: { show: true, tickText: { color: '#474D57' } },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { color: '#B7BDC6', style: LineType.Dashed },
      text: { color: '#1E2329', borderColor: '#B7BDC6', backgroundColor: '#F0F1F2' },
    },
    vertical: {
      show: true,
      line: { color: '#B7BDC6', style: LineType.Dashed },
      text: { color: '#1E2329', borderColor: '#B7BDC6', backgroundColor: '#F0F1F2' },
    },
  },
  separator: { color: '#EAECEF' },
};

export function CandlestickChart({ data, symbol, onLoadOlder, loadingOlder, tradeHistory, rawSymbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const prevDataLenRef = useRef(0);
  const prevOldestRef = useRef<number>(0);

  const [indicators, setIndicators] = usePersistedState<IndicatorConfig[]>('indicators', []);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const { theme } = useTheme();

  const activeIndicatorPanes = useRef<Map<string, string | null>>(new Map());

  // ============================================================
  // Chart creation (once)
  // ============================================================
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = init(containerRef.current, {
      styles: theme === 'light' ? LIGHT_STYLES : DARK_STYLES,
    });

    if (!chart) return;

    // Create VOL sub-pane
    chart.createIndicator('VOL', false, { height: 60 });

    chartRef.current = chart;

    return () => {
      dispose(containerRef.current!);
      chartRef.current = null;
    };
  }, []);

  // ============================================================
  // Theme reactivity
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setStyles(theme === 'light' ? LIGHT_STYLES : DARK_STYLES);
  }, [theme]);

  // ============================================================
  // Feed data to chart when props change (v9 API)
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;

    const klineData = data.map(toKLineData);
    const currentOldest = data[0].time;
    const wasPrepend = prevDataLenRef.current > 0
      && data.length > prevDataLenRef.current
      && currentOldest < prevOldestRef.current;

    if (wasPrepend) {
      // Older data prepended — feed older portion via applyMoreData
      const newCount = data.length - prevDataLenRef.current;
      const olderData = klineData.slice(0, newCount);
      chart.applyMoreData(olderData, true);
    } else if (prevDataLenRef.current === 0) {
      // Initial load
      chart.applyNewData(klineData, true);
    } else if (data.length > prevDataLenRef.current && data.length - prevDataLenRef.current <= 2) {
      // New candle appended (sim tick) — update last candle
      const lastCandle = klineData[klineData.length - 1];
      chart.updateData(lastCandle);
    } else {
      // Data replaced (interval change, symbol change, etc.)
      chart.applyNewData(klineData, true);
    }

    prevDataLenRef.current = data.length;
    prevOldestRef.current = currentOldest;
  }, [data]);

  // ============================================================
  // TRADE MARKERS as overlays
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !tradeHistory || !rawSymbol || data.length === 0) return;

    // v9: removeOverlay accepts id or no args
    try { chart.removeOverlay('trade_markers'); } catch {}

    const symbolTrades = tradeHistory.filter(t => t.symbol === rawSymbol);
    for (const trade of symbolTrades) {
      const ts = trade.action === 'OPEN' ? trade.openTime : trade.closeTime;
      if (ts <= 0) continue;
      const isBuy = (trade.action === 'OPEN' && trade.side === 'LONG') || (trade.action === 'CLOSE' && trade.side === 'SHORT');
      const price = trade.action === 'OPEN' ? trade.entryPrice : trade.exitPrice;

      chart.createOverlay({
        name: 'simpleAnnotation',
        id: 'trade_markers',
        points: [{ timestamp: ts, value: price }],
        lock: true,
        extendData: isBuy ? '▲ B' : '▼ S',
      } as OverlayCreate);
    }
  }, [tradeHistory, rawSymbol, data]);

  // ============================================================
  // INDICATOR MANAGEMENT
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentActive = new Set<string>();

    for (const ind of indicators) {
      if (!ind.enabled) continue;
      currentActive.add(ind.type);

      const kcName = KLINE_INDICATOR_MAP[ind.type] || ind.type;
      const isOverlay = ['MA', 'EMA', 'SMA', 'WMA', 'BOLL', 'SAR'].includes(ind.type);

      if (!activeIndicatorPanes.current.has(ind.type)) {
        try {
          const paneId = chart.createIndicator(
            { name: kcName, calcParams: [ind.period] },
            isOverlay,
            isOverlay ? { id: 'candle_pane' } : { height: 80 }
          );
          activeIndicatorPanes.current.set(ind.type, paneId);
        } catch (e) {
          console.warn(`Failed to create indicator ${ind.type}:`, e);
        }
      } else {
        try {
          chart.overrideIndicator({ name: kcName, calcParams: [ind.period] });
        } catch {}
      }
    }

    // Remove indicators that are no longer active
    for (const [type, paneId] of activeIndicatorPanes.current.entries()) {
      if (!currentActive.has(type)) {
        try {
          const kcName = KLINE_INDICATOR_MAP[type] || type;
          // v9 API: removeIndicator(paneId, name?)
          if (paneId) {
            chart.removeIndicator(paneId, kcName);
          }
        } catch {}
        activeIndicatorPanes.current.delete(type);
      }
    }
  }, [indicators]);

  // ============================================================
  // Drawing tool activation
  // ============================================================
  const handleToolChange = useCallback((tool: string | null) => {
    setActiveDrawingTool(tool);
    const chart = chartRef.current;
    if (!chart || !tool) return;

    const overlayName = OVERLAY_MAP[tool];
    if (overlayName) {
      chart.createOverlay({ name: overlayName, mode: 'weak_magnet' } as OverlayCreate);
    }
  }, []);

  const handleClearDrawings = useCallback(() => {
    const chart = chartRef.current;
    if (chart) {
      chart.removeOverlay();
    }
  }, []);

  const handleToggleDrawingsVisible = useCallback(() => {
    setDrawingsVisible(prev => {
      const newVal = !prev;
      const chart = chartRef.current;
      if (chart) {
        chart.overrideOverlay({ visible: newVal });
      }
      return newVal;
    });
  }, []);

  // ============================================================
  // Price info
  // ============================================================
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
        {loadingOlder && (
          <span className="text-[10px] text-primary animate-pulse font-mono ml-auto">加载更早数据...</span>
        )}
      </div>

      {/* Chart area with toolbar */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ left: 34, backgroundColor: theme === 'light' ? '#FFFFFF' : '#0B0E11' }}
        />

        <DrawingToolbar
          activeTool={activeDrawingTool}
          onToolChange={handleToolChange}
          onClearDrawings={handleClearDrawings}
          drawingsVisible={drawingsVisible}
          onToggleDrawingsVisible={handleToggleDrawingsVisible}
        />

        {/* Right side: indicator buttons */}
        <div className="absolute right-12 top-0 z-20 flex items-center gap-1 py-1.5 px-2">
          <button
            onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              showIndicatorPanel ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>指标</span>
          </button>

          {indicators.map(ind => (
            <span key={ind.type} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium"
              style={{ background: `${ind.color}20`, color: ind.color }}>
              {ind.type} {ind.period}
              <button onClick={() => setIndicators(indicators.filter(i => i.type !== ind.type))} className="hover:opacity-70">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}

          <IndicatorMenu
            open={showIndicatorPanel}
            onClose={() => setShowIndicatorPanel(false)}
            indicators={indicators}
            onIndicatorsChange={setIndicators}
          />
        </div>
      </div>
    </div>
  );
}
