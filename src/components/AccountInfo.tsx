import { Wallet } from 'lucide-react';
import type { Position } from '@/types/trading';
import { calcUnrealizedPnl } from '@/types/trading';

interface Props {
  balance: number;
  positions: Position[];
  currentPrice: number;
}

export function AccountInfo({ balance, positions, currentPrice }: Props) {
  const totalPnl = positions.reduce((sum, pos) => sum + calcUnrealizedPnl(pos, currentPrice), 0);
  const totalMargin = positions.reduce((sum, pos) => sum + pos.margin, 0);
  const equity = balance + totalPnl;
  const available = balance - totalMargin;

  return (
    <div className="flex items-center gap-6 px-4 py-1.5 text-[11px] font-mono border-b border-border" style={{ background: '#0B0E11' }}>
      <div className="flex items-center gap-1.5">
        <Wallet className="w-3 h-3 text-primary" />
        <span className="text-muted-foreground">余额</span>
        <span className="font-semibold text-foreground">{balance.toFixed(2)}</span>
      </div>
      <div>
        <span className="text-muted-foreground">净值 </span>
        <span className="font-semibold text-foreground">{equity.toFixed(2)}</span>
      </div>
      <div>
        <span className="text-muted-foreground">可用 </span>
        <span className="font-semibold text-foreground">{available.toFixed(2)}</span>
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
  );
}
