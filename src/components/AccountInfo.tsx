import { Wallet, TrendingUp } from 'lucide-react';
import type { Position } from '@/types/trading';
import { calcUnrealizedPnl } from '@/types/trading';

const INITIAL_CAPITAL = 1_000_000;

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
  const totalReturn = equity - INITIAL_CAPITAL;
  const totalReturnPct = (totalReturn / INITIAL_CAPITAL) * 100;

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
      <div className="ml-auto text-muted-foreground/60">
        初始资金: {INITIAL_CAPITAL.toLocaleString()} USDT
      </div>
    </div>
  );
}
