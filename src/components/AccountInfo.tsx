import { Wallet, TrendingUp, AlertTriangle } from 'lucide-react';
import type { Position } from '@/types/trading';
import { calcUnrealizedPnl, MAINTENANCE_MARGIN_RATE } from '@/types/trading';
import type { PositionsMap, PriceMap } from '@/contexts/TradingContext';
import { useAuth } from '@/contexts/AuthContext';
import { Progress } from '@/components/ui/progress';

interface Props {
  balance: number;
  positionsMap: PositionsMap;
  priceMap: PriceMap;
}

export function AccountInfo({ balance, positionsMap, priceMap }: Props) {
  const { profile } = useAuth();
  const initialCapital = profile?.initial_capital ?? 1_000_000;

  let totalPnl = 0;
  let totalMargin = 0;
  let totalMaintenanceMargin = 0;
  let symbolCount = 0;

  for (const [symbol, positions] of Object.entries(positionsMap)) {
    const price = priceMap[symbol] || 0;
    if (positions.length === 0) continue;
    symbolCount++;
    for (const pos of positions) {
      totalPnl += calcUnrealizedPnl(pos, price);
      totalMargin += pos.margin;
      totalMaintenanceMargin += pos.quantity * price * MAINTENANCE_MARGIN_RATE;
    }
  }

  const equity = balance + totalPnl;
  const available = balance - totalMargin;
  const totalReturn = equity - initialCapital;
  const totalReturnPct = (totalReturn / initialCapital) * 100;

  // Margin ratio: maintenance margin / equity * 100%
  const marginRatio = equity > 0 ? (totalMaintenanceMargin / equity) * 100 : 0;
  const isHighRisk = marginRatio > 80;
  const isMedRisk = marginRatio > 50;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 text-[11px] font-mono border-b border-border bg-card flex-wrap min-h-[28px]">
      <div className="flex items-center gap-1.5 shrink-0">
        <Wallet className="w-3 h-3 text-primary shrink-0" />
        <span className="text-muted-foreground whitespace-nowrap">总权益</span>
        <span className="font-semibold text-foreground whitespace-nowrap">{equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div className="shrink-0 whitespace-nowrap">
        <span className="text-muted-foreground">可用余额 </span>
        <span className="font-semibold text-foreground">{available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div className="shrink-0 whitespace-nowrap">
        <span className="text-muted-foreground">已用保证金 </span>
        <span className="font-semibold text-foreground">{totalMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div className="shrink-0 whitespace-nowrap">
        <span className="text-muted-foreground">未实现盈亏 </span>
        <span className={`font-semibold ${totalPnl >= 0 ? 'trading-green' : 'trading-red'}`}>
          {totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Margin Ratio Gauge */}
      {totalMargin > 0 && (
        <div className="flex items-center gap-1.5 min-w-[120px]">
          {isHighRisk && <AlertTriangle className="w-3 h-3 text-destructive animate-pulse" />}
          <span className="text-muted-foreground">风险率</span>
          <div className="flex items-center gap-1 flex-1">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-secondary">
              <div
                className={`h-full rounded-full transition-all ${isHighRisk ? 'bg-destructive' : isMedRisk ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(marginRatio, 100)}%` }}
              />
            </div>
            <span className={`font-semibold text-[10px] ${isHighRisk ? 'text-destructive' : isMedRisk ? 'text-yellow-500' : 'text-green-500'}`}>
              {marginRatio.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
        <TrendingUp className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">收益率 </span>
        <span className={`font-semibold ${totalReturn >= 0 ? 'trading-green' : 'trading-red'}`}>
          {totalReturn >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
        </span>
      </div>
      {symbolCount > 1 && (
        <div>
          <span className="text-muted-foreground">活跃合约 </span>
          <span className="font-semibold text-primary">{symbolCount}</span>
        </div>
      )}
      <div className="ml-auto text-muted-foreground/60 shrink-0 whitespace-nowrap">
        初始资金: {initialCapital.toLocaleString()} USDT
      </div>
    </div>
  );
}
