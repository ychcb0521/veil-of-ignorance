import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  X, Search, TrendingUp, TrendingDown, Target, Activity,
  BarChart3, Calendar, ChevronDown, Clock, Crosshair,
} from 'lucide-react';
import { init, dispose, CandleType, LineType, TooltipShowRule, TooltipShowType, type Chart, type KLineData, type OverlayCreate } from 'klinecharts';
import type { TradeRecord } from '@/types/trading';
import type { KlineData } from '@/hooks/useBinanceData';
import { formatUTC8 } from '@/lib/timeFormat';
import { useTheme } from '@/contexts/ThemeContext';

/* ===== Trade Pair ===== */
interface TradePair {
  open: TradeRecord;
  close: TradeRecord;
  pnl: number;
  roe: number;
  holdDurationMs: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tradeHistory: TradeRecord[];
  initialSymbol?: string;
  onJumpToTime?: (symbol: string, timestamp: number) => void;
}

/* ===== Helpers ===== */
function buildTradedCoins(history: TradeRecord[]): string[] {
  const set = new Set<string>();
  for (const t of history) {
    if (t.action !== 'FUNDING') set.add(t.symbol);
  }
  return Array.from(set).sort();
}

function pairTrades(trades: TradeRecord[]): TradePair[] {
  const opens = trades.filter(t => t.action === 'OPEN');
  const closes = trades.filter(t => t.action === 'CLOSE' || t.action === 'LIQUIDATION');
  const pairs: TradePair[] = [];
  const usedIds = new Set<string>();

  for (const op of opens) {
    const match = closes.find(c =>
      !usedIds.has(c.id) && c.side === op.side && c.closeTime >= op.openTime,
    );
    if (match) {
      usedIds.add(match.id);
      const margin = (op.entryPrice * op.quantity) / op.leverage;
      pairs.push({
        open: op, close: match,
        pnl: match.pnl,
        roe: margin > 0 ? (match.pnl / margin) * 100 : 0,
        holdDurationMs: match.closeTime - op.openTime,
      });
    }
  }
  return pairs.sort((a, b) => a.open.openTime - b.open.openTime);
}

function formatDuration(ms: number) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}秒`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}分`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}时`;
  return `${(ms / 86_400_000).toFixed(1)}天`;
}

function formatMinute(ts: number): string {
  return formatUTC8(ts).slice(0, 16);
}

function parseMinuteInput(str: string): number | null {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(+y, +mo - 1, +d, +h - 8, +mi);
}

/* ===== Timeframes ===== */
const REVIEW_TIMEFRAMES = [
  { key: '1m', label: '1分', ms: 60_000 },
  { key: '3m', label: '3分', ms: 3 * 60_000 },
  { key: '5m', label: '5分', ms: 5 * 60_000 },
  { key: '15m', label: '15分', ms: 15 * 60_000 },
  { key: '30m', label: '30分', ms: 30 * 60_000 },
  { key: '1h', label: '1时', ms: 3_600_000 },
  { key: '4h', label: '4时', ms: 4 * 3_600_000 },
  { key: '1d', label: '1日', ms: 86_400_000 },
] as const;

/* ===== Fetch klines from Binance ===== */
async function fetchKlines(
  symbol: string, interval: string,
  startTime: number, endTime: number,
): Promise<KlineData[]> {
  const all: KlineData[] = [];
  let cursor = startTime;
  const limit = 1000;

  while (cursor < endTime) {
    const qs = new URLSearchParams({
      symbol, interval,
      startTime: String(cursor),
      endTime: String(endTime),
      limit: String(limit),
    });
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
    if (!res.ok) break;
    const raw: any[][] = await res.json();
    if (raw.length === 0) break;
    for (const k of raw) {
      all.push({
        time: k[0] as number,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      });
    }
    cursor = (raw[raw.length - 1][0] as number) + 1;
    if (raw.length < limit) break;
  }
  return all;
}

/* ===== Chart theme ===== */
const DARK_CHART_STYLES = {
  grid: { show: true, horizontal: { color: '#1B1F26' }, vertical: { color: '#1B1F26' } },
  candle: {
    type: CandleType.CandleSolid,
    bar: { upColor: '#0ECB81', downColor: '#F6465D', upBorderColor: '#0ECB81', downBorderColor: '#F6465D', upWickColor: '#0ECB81', downWickColor: '#F6465D' },
    priceMark: { show: true, last: { show: false } },
    tooltip: { showRule: TooltipShowRule.FollowCross, showType: TooltipShowType.Standard },
  },
  xAxis: { show: true, tickText: { color: '#848E9C' } },
  yAxis: { show: true, tickText: { color: '#848E9C' } },
  crosshair: {
    show: true,
    horizontal: { show: true, line: { show: true, color: '#F0B90B33', style: LineType.Dashed }, text: { show: true, color: '#FFF', borderColor: '#F0B90B', backgroundColor: '#363A45' } },
    vertical: { show: true, line: { show: true, color: '#F0B90B33', style: LineType.Dashed }, text: { show: true, color: '#FFF', borderColor: '#F0B90B', backgroundColor: '#363A45' } },
  },
  separator: { color: '#1B1F26' },
};

const LIGHT_CHART_STYLES = {
  grid: { show: true, horizontal: { color: '#EAECEF' }, vertical: { color: '#EAECEF' } },
  candle: {
    type: CandleType.CandleSolid,
    bar: { upColor: '#0ECB81', downColor: '#F6465D', upBorderColor: '#0ECB81', downBorderColor: '#F6465D', upWickColor: '#0ECB81', downWickColor: '#F6465D' },
    priceMark: { show: true, last: { show: false } },
    tooltip: { showRule: TooltipShowRule.FollowCross, showType: TooltipShowType.Standard },
  },
  xAxis: { show: true, tickText: { color: '#474D57' } },
  yAxis: { show: true, tickText: { color: '#474D57' } },
  crosshair: {
    show: true,
    horizontal: { show: true, line: { show: true, color: '#B7BDC633', style: LineType.Dashed }, text: { show: true, color: '#1E2329', borderColor: '#B7BDC6', backgroundColor: '#F0F1F2' } },
    vertical: { show: true, line: { show: true, color: '#B7BDC633', style: LineType.Dashed }, text: { show: true, color: '#1E2329', borderColor: '#B7BDC6', backgroundColor: '#F0F1F2' } },
  },
  separator: { color: '#EAECEF' },
};

/* ===== Component ===== */
export function TradeInsightsPanel({ open, onClose, tradeHistory, initialSymbol, onJumpToTime }: Props) {
  const tradedCoins = useMemo(() => buildTradedCoins(tradeHistory), [tradeHistory]);
  const [selectedCoin, setSelectedCoin] = useState(initialSymbol || tradedCoins[0] || '');
  const [coinSearch, setCoinSearch] = useState('');
  const [showCoinList, setShowCoinList] = useState(false);
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [quickRange, setQuickRange] = useState<string>('all');
  const [chartLoading, setChartLoading] = useState(false);
  const [hoveredPair, setHoveredPair] = useState<TradePair | null>(null);
  const [selectedPairIdx, setSelectedPairIdx] = useState<number | null>(null);
  const [selectedTooltip, setSelectedTooltip] = useState<{ x: number; y: number; pair: TradePair } | null>(null);
  const [interval, setInterval] = useState<string>('1m');

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const { theme } = useTheme();

  const QUICK_RANGES = [
    { key: '24h', label: '24小时', ms: 24 * 3600_000 },
    { key: '7d', label: '7天', ms: 7 * 24 * 3600_000 },
    { key: '30d', label: '30天', ms: 30 * 24 * 3600_000 },
    { key: 'all', label: '全部', ms: Infinity },
  ];

  const timeRange = useMemo<{ start: number; end: number }>(() => {
    if (quickRange === 'custom') {
      const s = parseMinuteInput(startStr);
      const e = parseMinuteInput(endStr);
      return { start: s ?? 0, end: e ?? Infinity };
    }
    const r = QUICK_RANGES.find(r => r.key === quickRange);
    if (!r || r.ms === Infinity) return { start: 0, end: Infinity };
    const now = Date.now();
    return { start: now - r.ms, end: now };
  }, [quickRange, startStr, endStr]);

  const filteredTrades = useMemo(() => {
    return tradeHistory.filter(t => {
      if (t.symbol !== selectedCoin) return false;
      if (t.action === 'FUNDING') return false;
      const ts = t.closeTime || t.openTime;
      return ts >= timeRange.start && ts <= timeRange.end;
    });
  }, [tradeHistory, selectedCoin, timeRange]);

  const pairs = useMemo(() => pairTrades(filteredTrades), [filteredTrades]);

  // Stats
  const stats = useMemo(() => {
    const closes = filteredTrades.filter(t => t.action === 'CLOSE' || t.action === 'LIQUIDATION');
    const wins = closes.filter(t => t.pnl > 0);
    const losses = closes.filter(t => t.pnl <= 0);
    const total = closes.length;
    const winRate = total > 0 ? (wins.length / total) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const plRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
    const expectancy = total > 0 ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss : 0;
    const totalPnl = closes.reduce((s, t) => s + t.pnl, 0);
    const totalFees = closes.reduce((s, t) => s + t.fee, 0);

    let equity = 0, peak = 0, maxDrawdown = 0, maxDrawdownTime = 0;
    const sorted = [...closes].sort((a, b) => a.closeTime - b.closeTime);
    for (const t of sorted) {
      equity += t.pnl;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDrawdown) { maxDrawdown = dd; maxDrawdownTime = t.closeTime; }
    }

    const avgHoldMs = pairs.length > 0 ? pairs.reduce((s, p) => s + p.holdDurationMs, 0) / pairs.length : 0;

    return {
      total, wins: wins.length, losses: losses.length,
      winRate, plRatio, expectancy, totalPnl, totalFees,
      maxDrawdown, maxDrawdownTime, avgWin, avgLoss, avgHoldMs,
    };
  }, [filteredTrades, pairs]);

  // ===== Chart lifecycle =====
  useEffect(() => {
    if (!open || !chartContainerRef.current) return;

    const chart = init(chartContainerRef.current, {
      styles: theme === 'light' ? LIGHT_CHART_STYLES : DARK_CHART_STYLES,
      timezone: 'Asia/Shanghai',
    });
    if (!chart) return;
    chartRef.current = chart;

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chartRef.current = null;
      dispose(chartContainerRef.current!);
    };
  }, [open]);

  // Theme sync
  useEffect(() => {
    chartRef.current?.setStyles(theme === 'light' ? LIGHT_CHART_STYLES : DARK_CHART_STYLES);
  }, [theme]);

  // ===== Load klines when coin/time/interval changes =====
  useEffect(() => {
    if (!open || !selectedCoin) return;
    const chart = chartRef.current;
    if (!chart) return;

    // Clear selected state on data change
    setSelectedPairIdx(null);
    setSelectedTooltip(null);

    const coinTrades = tradeHistory.filter(t => t.symbol === selectedCoin && t.action !== 'FUNDING');
    if (coinTrades.length === 0) {
      chart.applyNewData([]);
      return;
    }

    const allTimes = coinTrades.flatMap(t => [t.openTime, t.closeTime].filter(x => x > 0));
    const minTradeTime = Math.min(...allTimes);
    const maxTradeTime = Math.max(...allTimes);

    let effectiveStart = timeRange.start === 0 ? minTradeTime : Math.max(timeRange.start, minTradeTime);
    let effectiveEnd = timeRange.end === Infinity ? maxTradeTime : Math.min(timeRange.end, maxTradeTime);

    const span = effectiveEnd - effectiveStart;
    effectiveStart = Math.max(minTradeTime - span * 0.1, effectiveStart - 3600_000 * 2);
    effectiveEnd = effectiveEnd + span * 0.1 + 3600_000 * 2;

    let cancelled = false;
    setChartLoading(true);

    fetchKlines(selectedCoin, interval, effectiveStart, effectiveEnd).then(klines => {
      if (cancelled || !chartRef.current) return;
      const kcData: KLineData[] = klines.map(k => ({
        timestamp: k.time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
      }));
      chartRef.current.applyNewData(kcData, true);

      requestAnimationFrame(() => {
        chartRef.current?.scrollToRealTime();
      });

      setChartLoading(false);
      renderTradeOverlays(chartRef.current, filteredTrades, pairs, null);
    }).catch(() => {
      if (!cancelled) setChartLoading(false);
    });

    return () => { cancelled = true; };
  }, [open, selectedCoin, timeRange, interval, filteredTrades.length]);

  // Re-render overlays when pairs change or selection changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !open) return;
    renderTradeOverlays(chart, filteredTrades, pairs, selectedPairIdx);
  }, [pairs, filteredTrades, selectedPairIdx]);

  const overlayIdsRef = useRef<string[]>([]);

  function renderTradeOverlays(chart: Chart, trades: TradeRecord[], tradePairs: TradePair[], selectedIdx: number | null) {
    // Clean slate
    for (const oid of overlayIdsRef.current) {
      try { chart.removeOverlay(oid); } catch {}
    }
    overlayIdsRef.current = [];

    // 1. Trade markers
    trades.forEach((trade, idx) => {
      const ts = trade.action === 'OPEN' ? trade.openTime : trade.closeTime;
      if (ts <= 0) return;
      const isBuy = (trade.action === 'OPEN' && trade.side === 'LONG') || (trade.action === 'CLOSE' && trade.side === 'SHORT');
      const price = trade.action === 'OPEN' ? trade.entryPrice : trade.exitPrice;
      const uid = `rv-mk-${trade.id}-${idx}`;

      chart.createOverlay({
        name: 'simpleAnnotation',
        id: uid,
        paneId: 'candle_pane',
        points: [{ timestamp: ts, value: price }],
        lock: true,
        extendData: isBuy ? '▲ B' : '▼ S',
        styles: {
          text: {
            color: isBuy ? '#0ECB81' : '#F6465D',
            size: 10,
            borderColor: isBuy ? '#0ECB8140' : '#F6465D40',
            backgroundColor: isBuy ? '#0ECB8118' : '#F6465D18',
          },
        },
      } as OverlayCreate);
      overlayIdsRef.current.push(uid);
    });

    // 2. Pair connection lines — render non-selected first, selected last (on top)
    const renderOrder = tradePairs.map((p, i) => i);
    if (selectedIdx !== null) {
      const si = renderOrder.indexOf(selectedIdx);
      if (si >= 0) {
        renderOrder.splice(si, 1);
        renderOrder.push(selectedIdx);
      }
    }

    for (const idx of renderOrder) {
      const pair = tradePairs[idx];
      const isProfit = pair.pnl >= 0;
      const isSelected = idx === selectedIdx;
      const baseColor = isProfit ? '#0ECB81' : '#F6465D';
      const color = isSelected ? baseColor : (baseColor + '99');
      const uid = `rv-ln-${pair.open.id}-${pair.close.id}-${idx}`;

      chart.createOverlay({
        name: 'segment',
        id: uid,
        paneId: 'candle_pane',
        points: [
          { timestamp: pair.open.openTime, value: pair.open.entryPrice },
          { timestamp: pair.close.closeTime, value: pair.close.exitPrice },
        ],
        lock: true,
        styles: {
          line: {
            style: isSelected ? ('solid' as any) : ('dashed' as any),
            dashedValue: isSelected ? undefined : [4, 3],
            size: isSelected ? 3 : 1.5,
            color,
          },
        },
        extendData: JSON.stringify({ pairIdx: idx }),
      } as OverlayCreate);
      overlayIdsRef.current.push(uid);
    }
  }

  // Click on chart to select/deselect trade pairs
  const handleChartClick = useCallback((e: React.MouseEvent) => {
    const chart = chartRef.current;
    if (!chart || pairs.length === 0) {
      setSelectedPairIdx(null);
      setSelectedTooltip(null);
      return;
    }

    // Get click position relative to chart container
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Try to find the closest trade pair line to the click
    // We use a simple heuristic: convert each pair's open/close to pixel coords
    // and check distance from click to the line segment
    let bestIdx: number | null = null;
    let bestDist = 30; // max pixel distance threshold

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const openTs = pair.open.openTime;
      const closeTs = pair.close.closeTime;
      const openPrice = pair.open.entryPrice;
      const closePrice = pair.close.exitPrice;

      // Use chart's coordinate conversion
      const p1Raw = chart.convertToPixel({ timestamp: openTs, value: openPrice }, { paneId: 'candle_pane' });
      const p2Raw = chart.convertToPixel({ timestamp: closeTs, value: closePrice }, { paneId: 'candle_pane' });

      if (!p1Raw || !p2Raw) continue;
      const p1 = Array.isArray(p1Raw) ? p1Raw[0] : p1Raw;
      const p2 = Array.isArray(p2Raw) ? p2Raw[0] : p2Raw;
      if (!p1?.x || !p1?.y || !p2?.x || !p2?.y) continue;

      const dist = pointToSegmentDist(clickX, clickY, p1.x, p1.y, p2.x, p2.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx !== null) {
      setSelectedPairIdx(prev => prev === bestIdx ? null : bestIdx);
      if (bestIdx !== selectedPairIdx) {
        setSelectedTooltip({ x: e.clientX, y: e.clientY, pair: pairs[bestIdx] });
      } else {
        setSelectedTooltip(null);
      }
    } else {
      setSelectedPairIdx(null);
      setSelectedTooltip(null);
    }
  }, [pairs, selectedPairIdx]);

  const handleSelectCoin = useCallback((coin: string) => {
    setSelectedCoin(coin);
    setShowCoinList(false);
    setCoinSearch('');
    setSelectedPairIdx(null);
    setSelectedTooltip(null);
  }, []);

  const handleQuickRange = useCallback((key: string) => {
    setQuickRange(key);
    if (key !== 'custom') { setStartStr(''); setEndStr(''); }
    setSelectedPairIdx(null);
    setSelectedTooltip(null);
  }, []);

  const handleIntervalChange = useCallback((tf: string) => {
    setInterval(tf);
    setSelectedPairIdx(null);
    setSelectedTooltip(null);
  }, []);

  const handleJump = useCallback((ts: number) => {
    onJumpToTime?.(selectedCoin, ts);
  }, [onJumpToTime, selectedCoin]);

  const filteredCoinList = useMemo(() => {
    if (!coinSearch) return tradedCoins;
    const q = coinSearch.toUpperCase();
    return tradedCoins.filter(c => c.includes(q));
  }, [tradedCoins, coinSearch]);

  if (!open) return null;

  const baseCoin = selectedCoin.replace('USDT', '');

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-7xl max-h-[92vh] mx-4 rounded-xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col"
        style={{ background: 'hsl(var(--card))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ===== Header ===== */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Crosshair className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-foreground">交易侦查与绩效分析</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">Trade Insights</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ===== Toolbar ===== */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border/50 shrink-0 flex-wrap">
          {/* Coin Selector */}
          <div className="relative">
            <button
              onClick={() => setShowCoinList(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-secondary text-sm font-mono font-bold text-foreground hover:bg-accent transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-primary" />
              {baseCoin || '选择币种'}/USDT
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            {showCoinList && (
              <div
                className="absolute top-full left-0 mt-1 w-56 max-h-64 overflow-y-auto rounded-lg border border-border shadow-xl z-50"
                style={{ background: 'hsl(var(--popover))' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="p-2 border-b border-border/50">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-secondary border border-border">
                    <Search className="w-3 h-3 text-muted-foreground" />
                    <input
                      value={coinSearch}
                      onChange={e => setCoinSearch(e.target.value)}
                      placeholder="搜索币种..."
                      className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                      autoFocus
                    />
                  </div>
                </div>
                {filteredCoinList.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">暂无交易记录</div>
                ) : (
                  filteredCoinList.map(coin => {
                    const base = coin.replace('USDT', '');
                    const isActive = coin === selectedCoin;
                    return (
                      <button
                        key={coin}
                        onClick={() => handleSelectCoin(coin)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-mono transition-colors ${
                          isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                        <span className="font-bold">{base}</span>
                        <span className="text-muted-foreground">/USDT 永续</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-border" />

          {/* Timeframe Switcher */}
          <div className="flex items-center gap-0.5">
            {REVIEW_TIMEFRAMES.map(tf => (
              <button
                key={tf.key}
                onClick={() => handleIntervalChange(tf.key)}
                className={`px-2 py-1 rounded-md text-[11px] font-mono font-medium transition-all active:scale-95 ${
                  interval === tf.key
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-border" />

          {/* Quick Range Pills */}
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground mr-1" />
            {QUICK_RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => handleQuickRange(r.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all active:scale-95 ${
                  quickRange === r.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => handleQuickRange('custom')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all active:scale-95 ${
                quickRange === 'custom'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              自定义
            </button>
          </div>

          {quickRange === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={startStr}
                onChange={e => setStartStr(e.target.value)}
                placeholder="2024-01-15 08:00"
                className="w-[140px] px-2 py-1 rounded-md border border-border bg-secondary text-[11px] font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
              />
              <span className="text-[10px] text-muted-foreground">→</span>
              <input
                type="text"
                value={endStr}
                onChange={e => setEndStr(e.target.value)}
                placeholder="2024-01-20 20:00"
                className="w-[140px] px-2 py-1 rounded-md border border-border bg-secondary text-[11px] font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
              />
            </div>
          )}

          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            {stats.total} 笔闭环 · {pairs.length} 对
          </span>
        </div>

        {/* ===== Main Content: Chart (70%+) + Stats Sidebar ===== */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left: Chart area */}
          <div className="flex-1 min-w-0 flex flex-col relative">
            {chartLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  加载K线数据中...
                </div>
              </div>
            )}
            {filteredTrades.length === 0 && !chartLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-2 px-6">
                  <div className="text-4xl">📊</div>
                  <p className="text-sm text-muted-foreground">该时间段内暂无交易记录</p>
                  <p className="text-[10px] text-muted-foreground">请选择有交易记录的币种和时间范围</p>
                </div>
              </div>
            ) : (
              <div
                ref={chartContainerRef}
                className="flex-1 min-h-0"
                onClick={handleChartClick}
                style={{ backgroundColor: theme === 'light' ? '#FFFFFF' : '#0B0E11' }}
              />
            )}

            {/* Selected trade tooltip (floating) */}
            {selectedTooltip && (
              <div
                className="fixed z-[200] pointer-events-none animate-in fade-in zoom-in-95 duration-150"
                style={{
                  left: Math.min(selectedTooltip.x + 12, window.innerWidth - 240),
                  top: Math.max(selectedTooltip.y - 100, 10),
                }}
              >
                <div className="rounded-lg border border-primary/40 shadow-xl p-3 min-w-[200px]"
                  style={{ background: 'hsl(var(--popover))' }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      selectedTooltip.pair.open.side === 'LONG' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                    }`}>
                      {selectedTooltip.pair.open.side === 'LONG' ? '多' : '空'} {selectedTooltip.pair.open.leverage}x
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatDuration(selectedTooltip.pair.holdDurationMs)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
                    <span className="text-muted-foreground">开仓价</span>
                    <span className="text-foreground tabular-nums">{selectedTooltip.pair.open.entryPrice.toFixed(2)}</span>
                    <span className="text-muted-foreground">平仓价</span>
                    <span className="text-foreground tabular-nums">{selectedTooltip.pair.close.exitPrice.toFixed(2)}</span>
                    <span className="text-muted-foreground">盈亏</span>
                    <span className={`font-bold tabular-nums ${selectedTooltip.pair.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {selectedTooltip.pair.pnl >= 0 ? '+' : ''}{selectedTooltip.pair.pnl.toFixed(2)} USDT
                    </span>
                    <span className="text-muted-foreground">ROE</span>
                    <span className={`font-bold tabular-nums ${selectedTooltip.pair.roe >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {selectedTooltip.pair.roe >= 0 ? '+' : ''}{selectedTooltip.pair.roe.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Trade pair list (compact, below chart) */}
            {pairs.length > 0 && (
              <div className="border-t border-border shrink-0 max-h-[140px] overflow-y-auto">
                <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground flex items-center gap-1.5 border-b border-border/30">
                  <Activity className="w-3 h-3 text-primary" />
                  闭环交易列表 ({pairs.length})
                </div>
                <div className="divide-y divide-border/20">
                  {pairs.map((pair, idx) => {
                    const isProfit = pair.pnl >= 0;
                    const isSelected = idx === selectedPairIdx;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center gap-3 px-3 py-1.5 cursor-pointer transition-colors text-[10px] font-mono ${
                          isSelected
                            ? 'bg-primary/10 border-l-2 border-l-primary'
                            : 'hover:bg-accent/30'
                        }`}
                        onClick={() => {
                          setSelectedPairIdx(prev => prev === idx ? null : idx);
                          setSelectedTooltip(prev => prev && selectedPairIdx === idx ? null : { x: 300, y: 300, pair });
                          handleJump(pair.open.openTime);
                        }}
                        onMouseEnter={() => setHoveredPair(pair)}
                        onMouseLeave={() => setHoveredPair(null)}
                      >
                        <span className={`font-bold px-1 py-0.5 rounded ${
                          pair.open.side === 'LONG' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {pair.open.side === 'LONG' ? '多' : '空'} {pair.open.leverage}x
                        </span>
                        <span className="text-muted-foreground">{formatMinute(pair.open.openTime)}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-muted-foreground">{formatMinute(pair.close.closeTime)}</span>
                        <span className="text-muted-foreground ml-auto">
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" />{formatDuration(pair.holdDurationMs)}
                        </span>
                        <span className={`font-bold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isProfit ? '+' : ''}{pair.pnl.toFixed(2)}
                        </span>
                        <span className={`tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isProfit ? '+' : ''}{pair.roe.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: Stats Dashboard */}
          <div className="w-[280px] shrink-0 border-l border-border p-4 space-y-4 overflow-y-auto">
            <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-primary" />
              统计面板
            </h3>

            <div className="space-y-1.5">
              <StatRow label="期望值" value={`${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(2)}`}
                color={stats.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <StatRow label="胜率" value={`${stats.winRate.toFixed(1)}%`}
                color={stats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'} />
              <StatRow label="盈亏比" value={stats.plRatio === Infinity ? '∞' : stats.plRatio.toFixed(2)}
                color={stats.plRatio >= 1 ? 'text-emerald-400' : 'text-red-400'} />
              <StatRow
                label="最大回撤"
                value={`${stats.maxDrawdown.toFixed(2)}%`}
                color="text-red-400"
                clickable={!!stats.maxDrawdownTime}
                onClick={() => stats.maxDrawdownTime && handleJump(stats.maxDrawdownTime)}
              />
            </div>

            <div className="border-t border-border/50 pt-2 space-y-1.5">
              <StatRow label="总盈亏" value={`${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}`}
                color={stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <StatRow label="总手续费" value={`-${stats.totalFees.toFixed(2)}`} color="text-muted-foreground" />
              <StatRow label="平均盈利" value={`+${stats.avgWin.toFixed(2)}`} color="text-emerald-400" />
              <StatRow label="平均亏损" value={`-${stats.avgLoss.toFixed(2)}`} color="text-red-400" />
              <StatRow label="平均持仓" value={formatDuration(stats.avgHoldMs)} color="text-foreground" />
            </div>

            {/* Win/Loss bar */}
            <div className="flex items-center gap-2 text-[10px] font-mono pt-1">
              <span className="text-emerald-400">胜 {stats.wins}</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden bg-red-500/20">
                <div className="h-full bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${stats.total > 0 ? (stats.wins / stats.total) * 100 : 0}%` }} />
              </div>
              <span className="text-red-400">负 {stats.losses}</span>
            </div>

            {/* Trade pair details on hover */}
            {hoveredPair && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1.5 animate-in fade-in duration-150">
                <div className="text-[10px] font-bold text-primary">交易详情</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
                  <span className="text-muted-foreground">开仓时间</span>
                  <span className="text-foreground">{formatMinute(hoveredPair.open.openTime)}</span>
                  <span className="text-muted-foreground">平仓时间</span>
                  <span className="text-foreground">{formatMinute(hoveredPair.close.closeTime)}</span>
                  <span className="text-muted-foreground">开仓价</span>
                  <span className="text-foreground tabular-nums">{hoveredPair.open.entryPrice.toFixed(2)}</span>
                  <span className="text-muted-foreground">平仓价</span>
                  <span className="text-foreground tabular-nums">{hoveredPair.close.exitPrice.toFixed(2)}</span>
                  <span className="text-muted-foreground">盈亏</span>
                  <span className={`font-bold tabular-nums ${hoveredPair.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {hoveredPair.pnl >= 0 ? '+' : ''}{hoveredPair.pnl.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground">ROE</span>
                  <span className={`font-bold tabular-nums ${hoveredPair.roe >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {hoveredPair.roe >= 0 ? '+' : ''}{hoveredPair.roe.toFixed(2)}%
                  </span>
                  <span className="text-muted-foreground">持仓时长</span>
                  <span className="text-foreground">{formatDuration(hoveredPair.holdDurationMs)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Geometry helper ===== */
function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* ===== Sub-components ===== */
function StatRow({ label, value, color, clickable, onClick }: {
  label: string; value: string; color: string; clickable?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between py-0.5 ${clickable ? 'cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 transition-colors' : ''}`}
      onClick={onClick}
      title={clickable ? '点击跳转至该时间点' : undefined}
    >
      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
        {label}
        {clickable && <Crosshair className="w-2.5 h-2.5 text-primary" />}
      </span>
      <span className={`text-xs font-mono font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
