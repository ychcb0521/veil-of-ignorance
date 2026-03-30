/**
 * KlineCharts-based candlestick chart with native drawing tools and indicators.
 * Replaces the old lightweight-charts + SVG overlay approach.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { init, dispose, Chart, OverlayCreate } from 'klinecharts';
import type { KlineData } from '@/hooks/useBinanceData';
import { DrawingToolbar } from './DrawingToolbar';
import { IndicatorMenu } from './IndicatorMenu';
import { BarChart3, X } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { TradeRecord } from '@/types/trading';

// Mapping from our indicator config to klinecharts built-in indicator names
const KLINE_INDICATOR_MAP: Record<string, string> = {
  MA: 'MA', EMA: 'EMA', SMA: 'SMA', WMA: 'WMA',
  BOLL: 'BOLL', SAR: 'SAR',
  RSI: 'RSI', MACD: 'MACD', KDJ: 'KDJ',
  ATR: 'ATR', CCI: 'CCI', OBV: 'OBV', ROC: 'ROC',
  STOCH: 'KDJ', VOL: 'VOL',
  DMI: 'DMI', TRIX: 'TRIX', EMV: 'EMV',
  WR: 'WR', MFI: 'MFI',
};

// Overlay tool name mapping for klinecharts
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

export function CandlestickChart({ data, symbol, onLoadOlder, loadingOlder, tradeHistory, rawSymbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const prevDataLenRef = useRef(0);
  const prevOldestRef = useRef<number>(0);

  const [indicators, setIndicators] = usePersistedState<IndicatorConfig[]>('indicators', []);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);

  // Active indicator pane IDs for cleanup
  const activeIndicatorPanes = useRef<Map<string, string | null>>(new Map());

  // ============================================================
  // Chart creation (once)
  // ============================================================
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = init(containerRef.current, {
      styles: {
        grid: {
          show: true,
          horizontal: { color: '#1B1F26' },
          vertical: { color: '#1B1F26' },
        },
        candle: {
          type: 'candle_solid',
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
              line: { show: true, style: 'dash', dashValue: [4, 4] },
            },
          },
        },
        indicator: {
          lastValueMark: { show: true },
        },
        xAxis: {
          show: true,
          tickText: { color: '#848E9C' },
        },
        yAxis: {
          show: true,
          tickText: { color: '#848E9C' },
        },
        crosshair: {
          show: true,
          horizontal: {
            show: true,
            line: { color: '#F0B90B33', style: 'dash' },
            text: { color: '#FFFFFF', borderColor: '#F0B90B', backgroundColor: '#363A45' },
          },
          vertical: {
            show: true,
            line: { color: '#F0B90B33', style: 'dash' },
            text: { color: '#FFFFFF', borderColor: '#F0B90B', backgroundColor: '#363A45' },
          },
        },
        overlay: {
          point: { activeColor: '#F0B90B', color: '#F0B90B88' },
          line: { color: '#F0B90B' },
          rect: { color: '#F0B90B33', borderColor: '#F0B90B' },
          text: { color: '#F0B90B' },
        },
        separator: { color: '#1B1F26' },
      },
    });

    // Create VOL sub-pane by default
    chart.createIndicator('VOL', false, { height: 60 });

    chartRef.current = chart;

    // Handle keyboard delete for selected overlays
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // klinecharts handles overlay deletion when selected natively via removeOverlay
        // We need to check if an overlay is selected and remove it
        const chart = chartRef.current;
        if (chart) {
          // Remove all selected overlays (klinecharts doesn't expose getSelectedOverlay easily,
          // but pressing delete while an overlay is selected should work with this approach)
          // We'll use a custom approach: listen for overlay click events
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      dispose(containerRef.current!);
      chartRef.current = null;
    };
  }, []);

  // ============================================================
  // Lazy-load trigger: scroll left detection
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onLoadOlder) return;

    // klinecharts fires 'onVisibleRangeChange' — we check if near left edge
    const sub = chart.subscribeAction('onVisibleRangeChange', (data: any) => {
      if (loadingOlder) return;
      if (data && data.from !== undefined && data.from < 50) {
        onLoadOlder();
      }
    });

    return () => {
      chart.unsubscribeAction('onVisibleRangeChange');
    };
  }, [onLoadOlder, loadingOlder]);

  // ============================================================
  // Update candle + volume data
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;

    const klineData = data.map(d => ({
      timestamp: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

    const currentOldest = data[0].time;
    const wasPrepend = prevDataLenRef.current > 0
      && data.length > prevDataLenRef.current
      && currentOldest < prevOldestRef.current;

    if (wasPrepend) {
      // For prepend, we use applyMoreData to add older data to the left
      const newCount = data.length - prevDataLenRef.current;
      const olderData = klineData.slice(0, newCount);
      chart.applyMoreData(olderData);
    } else if (prevDataLenRef.current === 0) {
      // Initial load
      chart.applyNewData(klineData);
    } else if (data.length > prevDataLenRef.current) {
      // New candle appended (sim tick)
      const lastCandle = klineData[klineData.length - 1];
      chart.updateData(lastCandle);
    } else {
      // Data replaced (e.g. interval change)
      chart.applyNewData(klineData);
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

    // Remove old trade markers
    chart.removeOverlay({ groupId: 'trade_markers' });

    const symbolTrades = tradeHistory.filter(t => t.symbol === rawSymbol);
    for (const trade of symbolTrades) {
      const ts = trade.action === 'OPEN' ? trade.openTime : trade.closeTime;
      if (ts <= 0) continue;
      const isBuy = (trade.action === 'OPEN' && trade.side === 'LONG') || (trade.action === 'CLOSE' && trade.side === 'SHORT');
      const price = trade.action === 'OPEN' ? trade.entryPrice : trade.exitPrice;

      chart.createOverlay({
        name: 'simpleAnnotation',
        groupId: 'trade_markers',
        points: [{ timestamp: ts, value: price }],
        styles: {
          text: {
            color: isBuy ? '#0ECB81' : '#F6465D',
            size: 12,
          },
        },
        extendData: isBuy ? '▲ B' : '▼ S',
        lock: true,
      });
    }
  }, [tradeHistory, rawSymbol, data]);

  // ============================================================
  // INDICATOR MANAGEMENT using klinecharts native system
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
            {
              name: kcName,
              calcParams: [ind.period],
            },
            isOverlay,
            isOverlay ? { id: 'candle_pane' } : { height: 80 }
          );
          activeIndicatorPanes.current.set(ind.type, paneId);
        } catch (e) {
          console.warn(`Failed to create indicator ${ind.type}:`, e);
        }
      } else {
        // Update params
        try {
          chart.overrideIndicator({
            name: kcName,
            calcParams: [ind.period],
          });
        } catch {}
      }
    }

    // Remove indicators that are no longer active
    for (const [type, paneId] of activeIndicatorPanes.current.entries()) {
      if (!currentActive.has(type)) {
        try {
          const kcName = KLINE_INDICATOR_MAP[type] || type;
          if (paneId && paneId !== 'candle_pane') {
            chart.removeIndicator(paneId, kcName);
          } else {
            chart.removeIndicator('candle_pane', kcName);
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
      chart.createOverlay({
        name: overlayName,
        mode: 'weak_magnet',
      });
    }
  }, []);

  const handleClearDrawings = useCallback(() => {
    const chart = chartRef.current;
    if (chart) {
      chart.removeOverlay();
      // Re-add trade markers
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
  // Price info from data
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
        {/* Chart container - offset left for toolbar */}
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ left: 34, backgroundColor: '#0B0E11' }}
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
