/**
 * KlineCharts v9 based candlestick chart with native drawing tools and indicators.
 * Uses applyNewData / updateData / applyMoreData for data feeding.
 */

import { useEffect, useRef, useCallback, useState, memo } from 'react';
import { init, dispose, CandleType, LineType, TooltipShowRule, TooltipShowType, type Chart, type KLineData, type OverlayCreate } from 'klinecharts';
import type { KlineData } from '@/hooks/useBinanceData';
import type { PendingOrder } from '@/types/trading';
import { useTheme } from '@/contexts/ThemeContext';
import { DrawingToolbar } from './DrawingToolbar';
import { IndicatorMenu } from './IndicatorMenu';
import { BarChart3, X } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { TradeRecord } from '@/types/trading';
import { registerCustomIndicators, CUSTOM_INDICATOR_MAP } from '@/lib/customIndicators';

// Mapping from our indicator IDs to klinecharts indicator names (built-in + custom)
const KLINE_INDICATOR_MAP: Record<string, string> = { ...CUSTOM_INDICATOR_MAP };

// IDs that render on the main (candle) pane as overlays
const OVERLAY_INDICATOR_IDS = new Set([
  'MA', 'EMA', 'SMA', 'WMA', 'BOLL', 'SAR',
  'DEMA', 'TEMA', 'SMMA', 'HMA', 'ALMA', 'LSMA', 'KAMA', 'HAMA', 'MCGD',
  'DMA', 'TMA', 'MMA', 'GMMA', 'MACHAN', 'EMA_CROSS', 'MA_EMA_CROSS',
  'KC', 'DC', 'PC', 'ENV', 'SEB',
  'ICH', 'ST', 'ZIGZAG', 'CRSI_STOP', 'PIVOT', 'W52HL', 'FRAC', 'ALLIGATOR', 'LRC',
  'MEDP', 'TYPP', 'AVGP', 'VWAP',
]);

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
  pricePrecision?: number;
  quantityPrecision?: number;
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
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
    },
  },
  xAxis: { show: true, tickText: { color: '#848E9C' } },
  yAxis: { show: true, tickText: { color: '#848E9C' } },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { show: true, color: '#F0B90B33', style: LineType.Dashed },
      text: { show: true, color: '#FFFFFF', borderColor: '#F0B90B', backgroundColor: '#363A45' },
    },
    vertical: {
      show: true,
      line: { show: true, color: '#F0B90B33', style: LineType.Dashed },
      text: { show: true, color: '#FFFFFF', borderColor: '#F0B90B', backgroundColor: '#363A45' },
    },
  },
  indicator: {
    lastValueMark: {
      show: true,
      text: {
        show: true,
        color: '#FFFFFF',
        borderColor: 'inherit',
        borderRadius: 2,
        size: 10,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 2,
        paddingBottom: 2,
      },
    },
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
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
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
    },
  },
  xAxis: { show: true, tickText: { color: '#474D57' } },
  yAxis: { show: true, tickText: { color: '#474D57' } },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { show: true, color: '#B7BDC6', style: LineType.Dashed },
      text: { show: true, color: '#1E2329', borderColor: '#B7BDC6', backgroundColor: '#F0F1F2' },
    },
    vertical: {
      show: true,
      line: { show: true, color: '#B7BDC6', style: LineType.Dashed },
      text: { show: true, color: '#1E2329', borderColor: '#B7BDC6', backgroundColor: '#F0F1F2' },
    },
  },
  indicator: {
    lastValueMark: {
      show: true,
      text: {
        show: true,
        color: '#1E2329',
        borderColor: 'inherit',
        borderRadius: 2,
        size: 10,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 2,
        paddingBottom: 2,
      },
    },
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
    },
  },
  separator: { color: '#EAECEF' },
};

function CandlestickChartComponent({ data, symbol, onLoadOlder, loadingOlder, tradeHistory, rawSymbol, pricePrecision = 2, quantityPrecision = 3 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const prevDataLenRef = useRef(0);
  const prevOldestRef = useRef<number>(0);
  const prevNewestRef = useRef<number>(0);
  const prevLastSigRef = useRef('');
  const prevSymbolRef = useRef<string>(symbol);

  const [indicators, setIndicators] = usePersistedState<IndicatorConfig[]>('indicators', []);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const { theme } = useTheme();

  const activeIndicatorPanes = useRef<Map<string, string | null>>(new Map());

  // ============================================================
  // Clear overlays on symbol change to prevent cross-symbol pollution
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (prevSymbolRef.current !== symbol) {
      // Wipe all user-drawn overlays from the canvas
      chart.removeOverlay();
      // Reset data tracking refs so applyNewData fires cleanly for the new symbol
      prevDataLenRef.current = 0;
      prevOldestRef.current = 0;
      prevNewestRef.current = 0;
      prevLastSigRef.current = '';
      prevSymbolRef.current = symbol;
    }
  }, [symbol]);

  // ============================================================
  // Chart creation (once)
  // ============================================================
  useEffect(() => {
    if (!containerRef.current) return;

    // Register custom indicators before chart init to ensure klinecharts knows them
    registerCustomIndicators();

    const chart = init(containerRef.current, {
      styles: theme === 'light' ? LIGHT_STYLES : DARK_STYLES,
      timezone: 'Asia/Shanghai',
    });

    if (!chart) return;

    chartRef.current = chart;

    // ResizeObserver for responsive container sizing
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.resize();
        }
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
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
  // Price/Volume precision
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setPriceVolumePrecision(pricePrecision, quantityPrecision);
  }, [pricePrecision, quantityPrecision]);

  // ============================================================
  // Feed data to chart when props change (v9 API)
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;

    const klineData = data.map(toKLineData);
    const currentOldest = data[0].time;
    const lastCandle = klineData[klineData.length - 1];
    const lastSig = `${lastCandle.timestamp}|${lastCandle.open}|${lastCandle.high}|${lastCandle.low}|${lastCandle.close}|${lastCandle.volume}`;

    const wasPrepend = prevDataLenRef.current > 0
      && data.length > prevDataLenRef.current
      && currentOldest < prevOldestRef.current;

    const unchangedSnapshot =
      data.length === prevDataLenRef.current
      && currentOldest === prevOldestRef.current
      && lastSig === prevLastSigRef.current;

    if (unchangedSnapshot) return;

    const needsFit = prevDataLenRef.current === 0;

    if (wasPrepend) {
      // Older data prepended — feed older portion via applyMoreData
      const newCount = data.length - prevDataLenRef.current;
      const olderData = klineData.slice(0, newCount);
      chart.applyMoreData(olderData, true);
    } else if (prevDataLenRef.current === 0) {
      // Initial load
      chart.applyNewData(klineData, true);
    } else if (data.length > prevDataLenRef.current && data.length - prevDataLenRef.current <= 2) {
      // New candle appended (sim tick)
      chart.updateData(lastCandle);
    } else if (data.length === prevDataLenRef.current && lastCandle.timestamp === prevNewestRef.current) {
      // Same bar evolving: only update last candle to keep crosshair/interaction state stable
      chart.updateData(lastCandle);
    } else {
      // Data replaced (symbol/interval/window replacement)
      chart.applyNewData(klineData, true);
    }

    // Auto-fit content on initial load or full data replacement to fill the viewport
    if (needsFit || (!wasPrepend && prevDataLenRef.current > 0 && data.length !== prevDataLenRef.current && !(data.length > prevDataLenRef.current && data.length - prevDataLenRef.current <= 2))) {
      requestAnimationFrame(() => {
        chartRef.current?.scrollByDistance(0, 0);
        // klinecharts v9 does not have fitContent; use scrollToRealTime to snap to latest
        chartRef.current?.scrollToRealTime();
      });
    }

    prevDataLenRef.current = data.length;
    prevOldestRef.current = currentOldest;
    prevNewestRef.current = lastCandle.timestamp as number;
    prevLastSigRef.current = lastSig;
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

      const isOverlay = OVERLAY_INDICATOR_IDS.has(ind.type);
      // Determine the klinecharts indicator name: mapped, or fallback
      let kcName = KLINE_INDICATOR_MAP[ind.type];
      if (!kcName) {
        kcName = isOverlay ? 'FALLBACK_OVERLAY' : 'FALLBACK_OSCILLATOR';
      }

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
          const isOverlay = OVERLAY_INDICATOR_IDS.has(type);
          let kcName = KLINE_INDICATOR_MAP[type];
          if (!kcName) kcName = isOverlay ? 'FALLBACK_OVERLAY' : 'FALLBACK_OSCILLATOR';
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
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border flex-wrap min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-base font-bold text-foreground whitespace-nowrap">{symbol}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">永续</span>
        </div>
        {last && (
          <>
            <div className="flex flex-col shrink-0">
              <span className={`font-mono text-xl font-bold whitespace-nowrap ${isUp ? 'trading-green' : 'trading-red'}`}>
                {last.close.toLocaleString(undefined, { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision })}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono flex-wrap min-w-0">
              <div className="whitespace-nowrap shrink-0">
                <span className="text-muted-foreground">24h涨跌</span>
                <span className={`ml-1.5 font-medium ${priceChange >= 0 ? 'trading-green' : 'trading-red'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(pricePrecision)} ({priceChangePct >= 0 ? '+' : ''}{priceChangePct.toFixed(2)}%)
                </span>
              </div>
              <div className="whitespace-nowrap shrink-0">
                <span className="text-muted-foreground">最高</span>
                <span className="ml-1.5 text-foreground">{last.high.toLocaleString(undefined, { minimumFractionDigits: pricePrecision })}</span>
              </div>
              <div className="whitespace-nowrap shrink-0">
                <span className="text-muted-foreground">最低</span>
                <span className="ml-1.5 text-foreground">{last.low.toLocaleString(undefined, { minimumFractionDigits: pricePrecision })}</span>
              </div>
              <div className="whitespace-nowrap shrink-0">
                <span className="text-muted-foreground">成交量</span>
                <span className="ml-1.5 text-foreground">{last.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          </>
        )}
        {loadingOlder && (
          <span className="text-[10px] text-primary animate-pulse font-mono ml-auto shrink-0 whitespace-nowrap">加载更早数据...</span>
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
        <div className="absolute right-12 top-0 z-20 flex items-center gap-1 py-1.5 px-2 max-w-[60%] overflow-x-auto">
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
            <span key={ind.type} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium whitespace-nowrap shrink-0"
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

function areChartPropsEqual(prev: Props, next: Props) {
  const prevLen = prev.data.length;
  const nextLen = next.data.length;

  const prevFirst = prevLen > 0 ? prev.data[0].time : 0;
  const nextFirst = nextLen > 0 ? next.data[0].time : 0;
  const prevLast = prevLen > 0 ? prev.data[prevLen - 1] : null;
  const nextLast = nextLen > 0 ? next.data[nextLen - 1] : null;

  const sameDataShape =
    prevLen === nextLen &&
    prevFirst === nextFirst &&
    (prevLast?.time ?? 0) === (nextLast?.time ?? 0) &&
    (prevLast?.open ?? 0) === (nextLast?.open ?? 0) &&
    (prevLast?.high ?? 0) === (nextLast?.high ?? 0) &&
    (prevLast?.low ?? 0) === (nextLast?.low ?? 0) &&
    (prevLast?.close ?? 0) === (nextLast?.close ?? 0) &&
    (prevLast?.volume ?? 0) === (nextLast?.volume ?? 0);

  return (
    sameDataShape &&
    prev.symbol === next.symbol &&
    prev.loadingOlder === next.loadingOlder &&
    prev.rawSymbol === next.rawSymbol &&
    prev.pricePrecision === next.pricePrecision &&
    prev.quantityPrecision === next.quantityPrecision &&
    prev.tradeHistory === next.tradeHistory &&
    prev.onLoadOlder === next.onLoadOlder
  );
}

export const CandlestickChart = memo(CandlestickChartComponent, areChartPropsEqual);
export default CandlestickChart;
