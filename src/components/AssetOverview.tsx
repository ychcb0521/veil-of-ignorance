import { useState } from 'react';
import { Wallet, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ChevronRight, Eye, EyeOff, TrendingUp, TrendingDown } from 'lucide-react';
import type { AssetState } from '@/types/assets';
import { AssetReportModal } from './AssetReportModal';

interface Props {
  assets: AssetState;
}

export function AssetOverview({ assets }: Props) {
  const [reportOpen, setReportOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  const { totalBalance, todayPnl, todayPnlPct, accounts } = assets;
  const isProfit = todayPnl >= 0;

  const fmt = (v: number) => hidden ? '****' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Total Balance Section */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">预估总资产 (USD)</span>
            </div>
            <button
              onClick={() => setHidden(!hidden)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="font-mono text-2xl font-bold text-foreground tracking-tight mb-3">
            {hidden ? '********' : `$${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>

          {/* Today's PnL - clickable */}
          <button
            onClick={() => setReportOpen(true)}
            className="flex items-center gap-2 group hover:bg-accent/50 -mx-2 px-2 py-1.5 rounded transition-colors w-full text-left"
          >
            {isProfit ? (
              <TrendingUp className="w-3.5 h-3.5 trading-green shrink-0" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 trading-red shrink-0" />
            )}
            <span className="text-xs text-muted-foreground">今日盈亏</span>
            <span className={`font-mono text-sm font-semibold ${isProfit ? 'trading-green' : 'trading-red'}`}>
              {isProfit ? '+' : ''}{fmt(todayPnl)}
            </span>
            <span className={`font-mono text-xs ${isProfit ? 'trading-green' : 'trading-red'}`}>
              ({isProfit ? '+' : ''}{hidden ? '**' : todayPnlPct.toFixed(2)}%)
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex border-t border-border">
          {[
            { icon: ArrowDownLeft, label: '添加资金', labelEn: 'Deposit' },
            { icon: ArrowUpRight, label: '转出', labelEn: 'Withdraw' },
            { icon: ArrowLeftRight, label: '划转', labelEn: 'Transfer' },
          ].map(({ icon: Icon, label }) => (
            <button
              key={label}
              className="flex-1 flex flex-col items-center gap-1 py-3 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors border-r border-border last:border-r-0"
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>

        {/* Account Breakdown */}
        <div className="border-t border-border">
          <div className="px-4 py-2">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">账户资金分布</span>
          </div>
          {accounts.map((acc, i) => (
            <div
              key={acc.labelEn}
              className={`flex items-center justify-between px-4 py-2.5 hover:bg-accent/20 transition-colors ${
                i < accounts.length - 1 ? 'border-b border-border/50' : ''
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-primary">{acc.labelEn[0]}</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-foreground">{acc.label}</div>
                  <div className="text-[10px] text-muted-foreground">{acc.labelEn}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs font-medium text-foreground">{fmt(acc.balance)}</div>
                <div className="text-[10px] text-muted-foreground">可用 {fmt(acc.available)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AssetReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        assets={assets}
      />
    </>
  );
}
