import { useState, useMemo, useCallback } from 'react';
import {
  X, Search, TrendingUp, TrendingDown, Target, Activity,
  BarChart3, Calendar, ChevronDown, ChevronUp, Clock, Crosshair,
} from 'lucide-react';
import type { TradeRecord } from '@/types/trading';
import { formatUTC8 } from '@/lib/timeFormat';

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
  /** Initial symbol to pre-select */
  initialSymbol?: string;
  /** Callback: jump main chart to a specific time */
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
  return formatUTC8(ts).slice(0, 16); // YYYY-MM-DD HH:mm
}

function parseMinuteInput(str: string): number | null {
  // Accept "YYYY-MM-DD HH:mm" — interpret as UTC+8
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h - 8, +mi);
  return utc;
}

/* ===== Component ===== */
export function TradeInsightsPanel({ open, onClose, tradeHistory, initialSymbol, onJumpToTime }: Props) {
  const tradedCoins = useMemo(() => buildTradedCoins(tradeHistory), [tradeHistory]);
  const [selectedCoin, setSelectedCoin] = useState(initialSymbol || tradedCoins[0] || '');
  const [coinSearch, setCoinSearch] = useState('');
  const [showCoinList, setShowCoinList] = useState(false);

  // Time range state — minute precision
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [quickRange, setQuickRange] = useState<string>('all');

  const QUICK_RANGES = [
    { key: '24h', label: '24小时', ms: 24 * 3600_000 },
    { key: '7d', label: '7天', ms: 7 * 24 * 3600_000 },
    { key: '30d', label: '30天', ms: 30 * 24 * 3600_000 },
    { key: 'all', label: '全部', ms: Infinity },
  ];

  // Effective time range
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

  // Filtered trades for selected coin + time range
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

    // Max drawdown on equity curve
    let equity = 0, peak = 0, maxDrawdown = 0;
    let maxDrawdownTime = 0;
    const sorted = [...closes].sort((a, b) => a.closeTime - b.closeTime);
    const equityCurve: { equity: number; time: number }[] = [];
    for (const t of sorted) {
      equity += t.pnl;
      equityCurve.push({ equity, time: t.closeTime });
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDrawdown) { maxDrawdown = dd; maxDrawdownTime = t.closeTime; }
    }

    const avgHoldMs = pairs.length > 0 ? pairs.reduce((s, p) => s + p.holdDurationMs, 0) / pairs.length : 0;

    return {
      total, wins: wins.length, losses: losses.length,
      winRate, plRatio, expectancy, totalPnl, totalFees,
      maxDrawdown, maxDrawdownTime, avgWin, avgLoss, equityCurve, avgHoldMs,
    };
  }, [filteredTrades, pairs]);

  const handleSelectCoin = useCallback((coin: string) => {
    setSelectedCoin(coin);
    setShowCoinList(false);
    setCoinSearch('');
  }, []);

  const handleQuickRange = useCallback((key: string) => {
    setQuickRange(key);
    if (key !== 'custom') { setStartStr(''); setEndStr(''); }
  }, []);

  const handleCustomApply = useCallback(() => {
    setQuickRange('custom');
  }, []);

  const handleJump = useCallback((ts: number) => {
    onJumpToTime?.(selectedCoin, ts);
  }, [onJumpToTime, selectedCoin]);

  const filteredCoinList = useMemo(() => {
    if (!coinSearch) return tradedCoins;
    const q = coinSearch.toUpperCase();
    return tradedCoins.filter(c => c.includes(q));
  }, [tradedCoins, coinSearch]);

  // Equity curve SVG
  const curve = stats.equityCurve;
  const W = 440, H = 90;
  const minEq = curve.length > 0 ? Math.min(...curve.map(c => c.equity)) : 0;
  const maxEq = curve.length > 0 ? Math.max(...curve.map(c => c.equity)) : 0;
  const eqRange = maxEq - minEq || 1;
  const isPositive = (curve[curve.length - 1]?.equity ?? 0) >= 0;

  if (!open) return null;

  const baseCoin = selectedCoin.replace('USDT', '');

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-5xl max-h-[88vh] mx-4 rounded-xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col"
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

        {/* ===== Toolbar: Coin Selector + Time Range ===== */}
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

          {/* Divider */}
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

          {/* Custom range inputs */}
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
              <button
                onClick={handleCustomApply}
                className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium active:scale-95 transition-all"
              >
                应用
              </button>
            </div>
          )}

          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            {stats.total} 笔闭环交易 · {pairs.length} 对
          </span>
        </div>

        {/* ===== Main Content ===== */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex gap-0 min-h-0">
            {/* Left: Trade Pairs */}
            <div className="flex-1 border-r border-border/50 p-4 space-y-4">
              <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-primary" />
                交易对映射 (Trade Mapping)
              </h3>

              {pairs.length === 0 ? (
                <div className="py-16 text-center text-xs text-muted-foreground space-y-2">
                  <div className="text-3xl">📊</div>
                  <p>该时间段内暂无闭环交易记录</p>
                  <p className="text-[10px]">请选择有交易记录的币种和时间范围</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1 custom-scrollbar">
                  {pairs.map((pair, idx) => {
                    const isProfit = pair.pnl >= 0;
                    return (
                      <div
                        key={idx}
                        className={`rounded-lg border p-3 transition-all hover:shadow-md cursor-pointer group ${
                          isProfit
                            ? 'border-emerald-500/20 hover:border-emerald-500/40 bg-emerald-500/5'
                            : 'border-red-500/20 hover:border-red-500/40 bg-red-500/5'
                        }`}
                        onClick={() => handleJump(pair.open.openTime)}
                        title="点击跳转至开仓时间点"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              pair.open.side === 'LONG'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-red-500/15 text-red-400'
                            }`}>
                              {pair.open.side === 'LONG' ? '▲ 多' : '▼ 空'} {pair.open.leverage}x
                            </span>
                            {pair.close.action === 'LIQUIDATION' && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-destructive/20 text-destructive">💀爆仓</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground font-mono">
                              <Clock className="w-3 h-3 inline mr-0.5" />{formatDuration(pair.holdDurationMs)}
                            </span>
                            <Crosshair className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>

                        {/* Trade flow */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1">
                            <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${isProfit ? 'bg-emerald-400' : 'bg-red-400'}`} />
                              开仓 (Entry)
                            </div>
                            <div className="text-xs font-mono font-bold text-foreground tabular-nums">{pair.open.entryPrice.toFixed(2)}</div>
                            <div className="text-[9px] text-muted-foreground font-mono">{formatMinute(pair.open.openTime)}</div>
                          </div>

                          {/* Gradient connection line */}
                          <div className="flex-1 flex items-center relative py-1">
                            <div className={`h-[2px] flex-1 rounded-full ${
                              isProfit
                                ? 'bg-gradient-to-r from-emerald-400/60 to-emerald-400'
                                : 'bg-gradient-to-r from-red-400/60 to-red-400'
                            }`} />
                            <div className={`absolute inset-0 flex items-center justify-center`}>
                              <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${
                                isProfit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                              }`}>
                                {isProfit ? '+' : ''}{pair.pnl.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          <div className="flex-1 text-right">
                            <div className="text-[9px] text-muted-foreground flex items-center justify-end gap-1">
                              平仓 (Exit)
                              <span className={`w-1.5 h-1.5 rounded-full ${isProfit ? 'bg-emerald-400' : 'bg-red-400'}`} />
                            </div>
                            <div className="text-xs font-mono font-bold text-foreground tabular-nums">{pair.close.exitPrice.toFixed(2)}</div>
                            <div className="text-[9px] text-muted-foreground font-mono">{formatMinute(pair.close.closeTime)}</div>
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between pt-1.5 border-t border-border/30">
                          <div className="flex items-center gap-3">
                            <div>
                              <span className="text-[9px] text-muted-foreground">ROE </span>
                              <span className={`text-xs font-mono font-bold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}{pair.roe.toFixed(2)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-[9px] text-muted-foreground">数量 </span>
                              <span className="text-[10px] font-mono text-foreground tabular-nums">{pair.open.quantity.toFixed(4)}</span>
                            </div>
                          </div>
                          <div className="text-[9px] text-muted-foreground font-mono tabular-nums">
                            手续费 {pair.close.fee.toFixed(4)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Stats Dashboard */}
            <div className="w-[320px] shrink-0 p-4 space-y-4 overflow-y-auto">
              <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
                数学统计面板
              </h3>

              {/* Core stats */}
              <div className="space-y-1.5">
                <StatRow label="期望值 (Expectancy)" value={`${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(2)}`}
                  color={stats.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                <StatRow label="总胜率 (Win Rate)" value={`${stats.winRate.toFixed(1)}%`}
                  color={stats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'} />
                <StatRow label="盈亏比 (P/L Ratio)" value={stats.plRatio === Infinity ? '∞' : stats.plRatio.toFixed(2)}
                  color={stats.plRatio >= 1 ? 'text-emerald-400' : 'text-red-400'} />
                <StatRow
                  label="最大回撤 (Max DD)"
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

              {/* Equity Curve */}
              <div>
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">
                  {baseCoin} 权益曲线 (Equity Curve)
                </div>
                {curve.length < 2 ? (
                  <div className="h-[80px] flex items-center justify-center text-[10px] text-muted-foreground rounded border border-border/30">
                    需要至少 2 笔交易
                  </div>
                ) : (
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[80px]">
                    {(() => {
                      const y = H - ((0 - minEq) / eqRange) * H;
                      return <line x1={0} y1={y} x2={W} y2={y} stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="3 2" />;
                    })()}
                    <polyline
                      fill="none"
                      stroke={isPositive ? '#0ECB81' : '#F6465D'}
                      strokeWidth={1.5}
                      points={curve.map((c, i) => {
                        const x = (i / (curve.length - 1)) * W;
                        const y = H - ((c.equity - minEq) / eqRange) * H;
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    <polygon
                      fill={isPositive ? 'rgba(14,203,129,0.08)' : 'rgba(246,70,93,0.08)'}
                      points={[
                        `0,${H}`,
                        ...curve.map((c, i) => {
                          const x = (i / (curve.length - 1)) * W;
                          const y = H - ((c.equity - minEq) / eqRange) * H;
                          return `${x},${y}`;
                        }),
                        `${W},${H}`,
                      ].join(' ')}
                    />
                  </svg>
                )}
              </div>

              {/* Trade distribution by hour */}
              <div>
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">交易时段分布</div>
                <HourDistribution pairs={pairs} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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

function HourDistribution({ pairs }: { pairs: TradePair[] }) {
  const hours = useMemo(() => {
    const bins = new Array(24).fill(0);
    for (const p of pairs) {
      const h = new Date(p.open.openTime + 8 * 3600_000).getUTCHours();
      bins[h]++;
    }
    return bins;
  }, [pairs]);

  const max = Math.max(...hours, 1);

  return (
    <div className="flex items-end gap-px h-[40px]">
      {hours.map((count, h) => (
        <div key={h} className="flex-1 flex flex-col items-center justify-end">
          <div
            className="w-full rounded-t-sm bg-primary/40 hover:bg-primary/70 transition-colors"
            style={{ height: `${(count / max) * 100}%`, minHeight: count > 0 ? '2px' : '0' }}
            title={`${h.toString().padStart(2, '0')}:00 UTC+8 — ${count} 笔`}
          />
        </div>
      ))}
    </div>
  );
}
