import { useState, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Target, Activity, BarChart3, Calendar, ChevronDown } from 'lucide-react';
import type { TradeRecord } from '@/types/trading';

/* ===== Time range presets ===== */
const TIME_RANGES = [
  { key: '24h', label: '24小时', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: '7天', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: '30天', ms: 30 * 24 * 60 * 60 * 1000 },
  { key: 'all', label: '全部', ms: Infinity },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  tradeHistory: TradeRecord[];
}

/** Pair structure: an opening trade matched with its closing trade */
interface TradePair {
  open: TradeRecord;
  close: TradeRecord;
  pnl: number;
  roe: number;
  holdDurationMs: number;
}

export function TradePerformancePanel({ open, onClose, symbol, tradeHistory }: Props) {
  const [rangeKey, setRangeKey] = useState<string>('all');
  const baseCoin = symbol.replace('USDT', '');

  // Filter trades for this symbol
  const symbolTrades = useMemo(
    () => tradeHistory.filter(t => t.symbol === symbol),
    [tradeHistory, symbol],
  );

  // Apply time range filter
  const filteredTrades = useMemo(() => {
    const range = TIME_RANGES.find(r => r.key === rangeKey);
    if (!range || range.ms === Infinity) return symbolTrades;
    const cutoff = Date.now() - range.ms;
    return symbolTrades.filter(t => (t.closeTime || t.openTime) >= cutoff);
  }, [symbolTrades, rangeKey]);

  // Build trade pairs: match OPEN → CLOSE/LIQUIDATION
  const { pairs, closedTrades } = useMemo(() => {
    const opens = filteredTrades.filter(t => t.action === 'OPEN');
    const closes = filteredTrades.filter(t => t.action === 'CLOSE' || t.action === 'LIQUIDATION');
    const pairs: TradePair[] = [];
    const usedCloseIds = new Set<string>();

    for (const op of opens) {
      // Find matching close by same side + closest time after open
      const match = closes.find(c =>
        !usedCloseIds.has(c.id) &&
        c.side === op.side &&
        c.closeTime >= op.openTime,
      );
      if (match) {
        usedCloseIds.add(match.id);
        const margin = (op.entryPrice * op.quantity) / op.leverage;
        pairs.push({
          open: op,
          close: match,
          pnl: match.pnl,
          roe: margin > 0 ? (match.pnl / margin) * 100 : 0,
          holdDurationMs: match.closeTime - op.openTime,
        });
      }
    }
    return { pairs, closedTrades: closes };
  }, [filteredTrades]);

  // Deep statistics
  const stats = useMemo(() => {
    const total = closedTrades.length;
    const wins = closedTrades.filter(t => t.pnl > 0);
    const losses = closedTrades.filter(t => t.pnl <= 0);
    const winRate = total > 0 ? (wins.length / total) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const plRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
    const expectancy = total > 0
      ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss
      : 0;
    const totalPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
    const totalFees = closedTrades.reduce((s, t) => s + t.fee, 0);

    // Max drawdown on equity curve for this symbol
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const sorted = [...closedTrades].sort((a, b) => a.closeTime - b.closeTime);
    const equityCurve: { equity: number; time: number }[] = [];
    for (const t of sorted) {
      equity += t.pnl;
      equityCurve.push({ equity, time: t.closeTime });
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Avg hold time
    const avgHoldMs = pairs.length > 0
      ? pairs.reduce((s, p) => s + p.holdDurationMs, 0) / pairs.length
      : 0;

    return {
      total, wins: wins.length, losses: losses.length,
      winRate, plRatio, expectancy, totalPnl, totalFees,
      maxDrawdown, avgWin, avgLoss, equityCurve, avgHoldMs,
    };
  }, [closedTrades, pairs]);

  if (!open) return null;

  const formatDuration = (ms: number) => {
    if (ms < 60_000) return `${(ms / 1000).toFixed(0)}秒`;
    if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}分`;
    if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}时`;
    return `${(ms / 86_400_000).toFixed(1)}天`;
  };

  // SVG equity curve
  const curve = stats.equityCurve;
  const W = 500, H = 100;
  const minEq = curve.length > 0 ? Math.min(...curve.map(c => c.equity)) : 0;
  const maxEq = curve.length > 0 ? Math.max(...curve.map(c => c.equity)) : 0;
  const range = maxEq - minEq || 1;
  const isPositive = (curve[curve.length - 1]?.equity ?? 0) >= 0;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-4xl max-h-[85vh] mx-4 rounded-xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col"
        style={{ background: 'hsl(var(--card))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-foreground">{baseCoin}/USDT 交易绩效分析</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">永续</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Time range filter */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border/50 shrink-0">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">时间范围：</span>
          {TIME_RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all active:scale-95 ${
                rangeKey === r.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            {stats.total} 笔闭环交易
          </span>
        </div>

        {/* Content area - scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex gap-0 min-h-0">
            {/* Left: Trade pairs visualization */}
            <div className="flex-1 border-r border-border/50 p-4 space-y-4">
              <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-primary" />
                交易对明细 (Trade Pairs)
              </h3>

              {pairs.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  该时间段内暂无闭环交易记录
                </div>
              ) : (
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {pairs.map((pair, idx) => {
                    const isProfit = pair.pnl >= 0;
                    return (
                      <div
                        key={idx}
                        className={`rounded-lg border p-3 transition-all hover:shadow-md ${
                          isProfit
                            ? 'border-emerald-500/20 hover:border-emerald-500/40 bg-emerald-500/5'
                            : 'border-red-500/20 hover:border-red-500/40 bg-red-500/5'
                        }`}
                      >
                        {/* Pair header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              pair.open.side === 'LONG'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-red-500/15 text-red-400'
                            }`}>
                              {pair.open.side === 'LONG' ? '多' : '空'} {pair.open.leverage}x
                            </span>
                            {pair.close.action === 'LIQUIDATION' && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-destructive/20 text-destructive">💀爆仓</span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {formatDuration(pair.holdDurationMs)}
                          </span>
                        </div>

                        {/* Trade flow visualization */}
                        <div className="flex items-center gap-2 mb-2">
                          {/* Open point */}
                          <div className="flex-1">
                            <div className="text-[9px] text-muted-foreground">开仓</div>
                            <div className="text-xs font-mono font-bold text-foreground">{pair.open.entryPrice.toFixed(2)}</div>
                            <div className="text-[9px] text-muted-foreground font-mono">
                              {new Date(pair.open.openTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>

                          {/* Connection line */}
                          <div className="flex-1 flex items-center">
                            <div className={`h-0.5 flex-1 rounded ${isProfit ? 'bg-emerald-400/40' : 'bg-red-400/40'}`} />
                            <div className={`mx-1 text-[10px] font-bold font-mono ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                              →
                            </div>
                            <div className={`h-0.5 flex-1 rounded ${isProfit ? 'bg-emerald-400/40' : 'bg-red-400/40'}`} />
                          </div>

                          {/* Close point */}
                          <div className="flex-1 text-right">
                            <div className="text-[9px] text-muted-foreground">平仓</div>
                            <div className="text-xs font-mono font-bold text-foreground">{pair.close.exitPrice.toFixed(2)}</div>
                            <div className="text-[9px] text-muted-foreground font-mono">
                              {new Date(pair.close.closeTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>

                        {/* PnL & ROE */}
                        <div className="flex items-center justify-between pt-1.5 border-t border-border/30">
                          <div className="flex items-center gap-3">
                            <div>
                              <span className="text-[9px] text-muted-foreground">盈亏 </span>
                              <span className={`text-xs font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}{pair.pnl.toFixed(2)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[9px] text-muted-foreground">ROE </span>
                              <span className={`text-xs font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isProfit ? '+' : ''}{pair.roe.toFixed(2)}%
                              </span>
                            </div>
                          </div>
                          <div className="text-[9px] text-muted-foreground font-mono">
                            数量 {pair.open.quantity.toFixed(4)} · 手续费 {pair.close.fee.toFixed(4)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Statistics dashboard */}
            <div className="w-[300px] shrink-0 p-4 space-y-4">
              <h3 className="text-xs font-bold text-foreground">深度统计</h3>

              {/* Core stats */}
              <div className="space-y-2">
                <MiniStat label="总期望值 (Expectancy)" value={`${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(2)}`}
                  color={stats.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                <MiniStat label="总胜率 (Win Rate)" value={`${stats.winRate.toFixed(1)}%`}
                  color={stats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'} />
                <MiniStat label="盈亏比 (P/L Ratio)" value={stats.plRatio === Infinity ? '∞' : stats.plRatio.toFixed(2)}
                  color={stats.plRatio >= 1 ? 'text-emerald-400' : 'text-red-400'} />
                <MiniStat label="最大回撤 (Max DD)" value={`${stats.maxDrawdown.toFixed(2)}%`} color="text-red-400" />
              </div>

              <div className="border-t border-border/50 pt-2 space-y-2">
                <MiniStat label="总盈亏" value={`${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}`}
                  color={stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                <MiniStat label="总手续费" value={`-${stats.totalFees.toFixed(2)}`} color="text-muted-foreground" />
                <MiniStat label="平均盈利" value={`+${stats.avgWin.toFixed(2)}`} color="text-emerald-400" />
                <MiniStat label="平均亏损" value={`-${stats.avgLoss.toFixed(2)}`} color="text-red-400" />
                <MiniStat label="平均持仓时长" value={formatDuration(stats.avgHoldMs)} color="text-foreground" />
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

              {/* Equity curve */}
              <div>
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">
                  {baseCoin} 权益曲线
                </div>
                {curve.length < 2 ? (
                  <div className="h-[80px] flex items-center justify-center text-[10px] text-muted-foreground rounded border border-border/30">
                    需要至少 2 笔交易
                  </div>
                ) : (
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[80px]">
                    {/* Zero line */}
                    {(() => {
                      const y = H - ((0 - minEq) / range) * H;
                      return <line x1={0} y1={y} x2={W} y2={y}
                        stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="3 2" />;
                    })()}
                    <polyline
                      fill="none"
                      stroke={isPositive ? '#0ECB81' : '#F6465D'}
                      strokeWidth={1.5}
                      points={curve.map((c, i) => {
                        const x = (i / (curve.length - 1)) * W;
                        const y = H - ((c.equity - minEq) / range) * H;
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    <polygon
                      fill={isPositive ? 'rgba(14,203,129,0.08)' : 'rgba(246,70,93,0.08)'}
                      points={[
                        `0,${H}`,
                        ...curve.map((c, i) => {
                          const x = (i / (curve.length - 1)) * W;
                          const y = H - ((c.equity - minEq) / range) * H;
                          return `${x},${y}`;
                        }),
                        `${W},${H}`,
                      ].join(' ')}
                    />
                  </svg>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
