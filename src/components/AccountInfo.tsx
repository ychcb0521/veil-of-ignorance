import { Wallet, TrendingUp } from 'lucide-react';
import type { Position } from '@/types/trading';
import { calcUnrealizedPnl } from '@/types/trading';
import type { PositionsMap, PriceMap } from '@/contexts/TradingContext';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  balance: number;
  positionsMap: PositionsMap;
  priceMap: PriceMap;
}

export function AccountInfo({ balance, positionsMap, priceMap }: Props) {
  const { profile } = useAuth();
  const initialCapital = profile?.initial_capital ?? 1_000_000;

  // Calculate global PnL across ALL symbols
  let totalPnl = 0;
  let totalMargin = 0;
  let symbolCount = 0;

  for (const [symbol, positions] of Object.entries(positionsMap)) {
    const price = priceMap[symbol] || 0;
    if (positions.length === 0) continue;
    symbolCount++;
    for (const pos of positions) {
      totalPnl += calcUnrealizedPnl(pos, price);
      totalMargin += pos.margin;
    }
  }

  const equity = balance + totalPnl;
  const available = balance - totalMargin;
  const totalReturn = equity - initialCapital;
  const totalReturnPct = (totalReturn / initialCapital) * 100;

  return (
    <div className="flex items-center gap-5 px-4 py-1.5 text-[11px] font-mono border-b border-border" style={{ background: '#0B0E11' }}>
      <div className="flex items-center gap-1.5">
        <Wallet className="w-3 h-3 text-primary" />
        <span className="text-muted-foreground">总权益</span>
        <span className="font-semibold text-foreground">{equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div>
        <span className="text-muted-foreground">可用余额 </span>
        <span className="font-semibold text-foreground">{available.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div>
        <span className="text-muted-foreground">已用保证金 </span>
        <span className="font-semibold text-foreground">{totalMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
      <div>
        <span className="text-muted-foreground">未实现盈亏 </span>
        <span className={`font-semibold ${totalPnl >= 0 ? 'trading-green' : 'trading-red'}`}>
          {totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <TrendingUp className="w-3 h-3 text-muted-foreground" />
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
      <div className="ml-auto text-muted-foreground/60">
        初始资金: {initialCapital.toLocaleString()} USDT
      </div>
    </div>
  );
}
