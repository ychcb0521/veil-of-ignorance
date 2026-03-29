import { Wallet } from 'lucide-react';
import type { Position } from './OrderPanel';

interface Props {
  balance: number;
  positions: Position[];
  currentPrice: number;
}

export function AccountInfo({ balance, positions, currentPrice }: Props) {
  const totalPnl = positions.reduce((sum, pos) => {
    const diff = pos.side === 'LONG'
      ? currentPrice - pos.entryPrice
      : pos.entryPrice - currentPrice;
    return sum + diff * pos.quantity;
  }, 0);

  const totalMargin = positions.reduce((sum, pos) => sum + pos.margin, 0);
  const equity = balance + totalPnl;

  return (
    <div className="panel px-4 py-3">
      <div className="flex items-center gap-6 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5 text-primary" />
          <span className="text-muted-foreground">余额</span>
          <span className="font-semibold text-foreground">{balance.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">净值 </span>
          <span className="font-semibold text-foreground">{equity.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">已用保证金 </span>
          <span className="font-semibold text-foreground">{totalMargin.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">未实现盈亏 </span>
          <span className={`font-semibold ${totalPnl >= 0 ? 'trading-green' : 'trading-red'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
