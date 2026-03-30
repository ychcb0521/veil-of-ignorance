import { useMemo } from 'react';
import { X, Download, TrendingUp, TrendingDown, Target, BarChart3 } from 'lucide-react';
import type { TradeRecord } from '@/types/trading';
import type { PositionsMap, PriceMap } from '@/contexts/TradingContext';
import { calcUnrealizedPnl } from '@/types/trading';

interface Props {
  open: boolean;
  onClose: () => void;
  tradeHistory: TradeRecord[];
  balance: number;
  positionsMap: PositionsMap;
  priceMap: PriceMap;
  initialCapital: number;
}

export function AnalyticsPanel({ open, onClose, tradeHistory, balance, positionsMap, priceMap, initialCapital }: Props) {
  const stats = useMemo(() => {
    const closes = tradeHistory.filter(t => t.action === 'CLOSE' || t.action === 'LIQUIDATION');
    const wins = closes.filter(t => t.pnl > 0);
    const losses = closes.filter(t => t.pnl <= 0);

    const winRate = closes.length > 0 ? (wins.length / closes.length) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const plRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    const totalPnl = closes.reduce((s, t) => s + t.pnl, 0);
    const totalFees = tradeHistory.reduce((s, t) => s + t.fee, 0);
    const fundingTotal = tradeHistory.filter(t => t.action === 'FUNDING').reduce((s, t) => s + t.pnl, 0);
    const netProfit = totalPnl - fundingTotal; // fees already included in pnl for closes

    // Equity curve & max drawdown
    let equity = initialCapital;
    let peak = equity;
    let maxDrawdown = 0;
    const equityCurve: { index: number; equity: number; time: number }[] = [{ index: 0, equity, time: 0 }];

    const sortedTrades = [...tradeHistory].sort((a, b) => (a.closeTime || a.openTime) - (b.closeTime || b.openTime));
    sortedTrades.forEach((t, i) => {
      if (t.action === 'CLOSE' || t.action === 'LIQUIDATION') {
        equity += t.pnl;
      } else if (t.action === 'FUNDING') {
        equity += t.pnl;
      }
      // Skip OPEN as it doesn't change equity (margin is locked)
      if (t.action !== 'OPEN') {
        equityCurve.push({ index: i + 1, equity, time: t.closeTime || t.openTime });
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    });

    return {
      totalTrades: closes.length, wins: wins.length, losses: losses.length,
      winRate, plRatio, totalPnl, totalFees, fundingTotal, netProfit,
      maxDrawdown, avgWin, avgLoss, equityCurve,
    };
  }, [tradeHistory, initialCapital]);

  const exportCSV = () => {
    const headers = ['时间', '标的', '方向', '操作', '杠杆', '成交价', '平仓价', '数量', '盈亏', '手续费', '滑点'];
    const rows = tradeHistory.map(t => [
      new Date(t.closeTime || t.openTime).toISOString(),
      t.symbol, t.side,
      t.action, t.leverage,
      t.entryPrice.toFixed(2), t.exitPrice > 0 ? t.exitPrice.toFixed(2) : '',
      t.quantity.toFixed(6), t.pnl.toFixed(4), t.fee.toFixed(4), t.slippage.toFixed(4),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Futures_Trade_History_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  // Current total equity
  let totalPnl = 0;
  for (const [sym, positions] of Object.entries(positionsMap)) {
    const price = priceMap[sym] || 0;
    for (const pos of positions) totalPnl += calcUnrealizedPnl(pos, price);
  }
  const currentEquity = balance + totalPnl;

  // Simple SVG equity curve
  const curve = stats.equityCurve;
  const minEq = Math.min(...curve.map(c => c.equity));
  const maxEq = Math.max(...curve.map(c => c.equity));
  const range = maxEq - minEq || 1;
  const W = 560, H = 120;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-2xl mx-4 rounded-lg border border-border overflow-hidden"
        style={{ background: 'hsl(var(--card))' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" /> 数据归因 Analytics
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors">
              <Download className="w-3 h-3" /> 导出交割单
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="总交易" value={`${stats.totalTrades} 笔`} icon={<Target className="w-3.5 h-3.5" />} />
            <StatCard label="胜率" value={`${stats.winRate.toFixed(1)}%`}
              color={stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}
              icon={stats.winRate >= 50 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />} />
            <StatCard label="盈亏比" value={stats.plRatio === Infinity ? '∞' : stats.plRatio.toFixed(2)}
              color={stats.plRatio >= 1 ? 'text-green-400' : 'text-red-400'} />
            <StatCard label="最大回撤" value={`${stats.maxDrawdown.toFixed(2)}%`} color="text-red-400" />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <StatCard label="净利润" value={`${stats.netProfit >= 0 ? '+' : ''}${stats.netProfit.toFixed(2)}`}
              color={stats.netProfit >= 0 ? 'text-green-400' : 'text-red-400'} />
            <StatCard label="总手续费" value={`-${stats.totalFees.toFixed(2)}`} color="text-muted-foreground" />
            <StatCard label="资金费总计" value={`${stats.fundingTotal >= 0 ? '+' : ''}${stats.fundingTotal.toFixed(2)}`}
              color={stats.fundingTotal >= 0 ? 'text-green-400' : 'text-red-400'} />
            <StatCard label="当前权益" value={currentEquity.toFixed(2)}
              color={currentEquity >= initialCapital ? 'text-green-400' : 'text-red-400'} />
          </div>

          {/* Equity Curve */}
          <div>
            <h3 className="text-[11px] text-muted-foreground mb-2 font-medium">资金曲线 (Equity Curve)</h3>
            {curve.length < 2 ? (
              <div className="h-[120px] flex items-center justify-center text-xs text-muted-foreground">
                需要至少一笔平仓记录
              </div>
            ) : (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[120px]">
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map(pct => (
                  <line key={pct} x1={0} y1={H * pct} x2={W} y2={H * pct}
                    stroke="hsl(var(--border))" strokeWidth={0.5} />
                ))}
                {/* Baseline at initial capital */}
                {(() => {
                  const y = H - ((initialCapital - minEq) / range) * H;
                  return <line x1={0} y1={y} x2={W} y2={y}
                    stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="4 2" />;
                })()}
                {/* Curve */}
                <polyline
                  fill="none"
                  stroke={currentEquity >= initialCapital ? '#0ECB81' : '#F6465D'}
                  strokeWidth={1.5}
                  points={curve.map((c, i) => {
                    const x = (i / (curve.length - 1)) * W;
                    const y = H - ((c.equity - minEq) / range) * H;
                    return `${x},${y}`;
                  }).join(' ')}
                />
                {/* Fill area */}
                <polygon
                  fill={currentEquity >= initialCapital ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)'}
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

          {/* Win/Loss bar */}
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-green-400">胜 {stats.wins}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-red-500/30">
              <div className="h-full bg-green-400 rounded-full"
                style={{ width: `${stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : 0}%` }} />
            </div>
            <span className="text-red-400">负 {stats.losses}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md px-3 py-2 border border-border/50" style={{ background: 'hsl(var(--accent) / 0.3)' }}>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
        {icon} {label}
      </div>
      <div className={`text-sm font-mono font-bold ${color || 'text-foreground'}`}>{value}</div>
    </div>
  );
}
