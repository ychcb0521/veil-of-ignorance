import { ArrowLeftRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatSignedUSDT } from '@/lib/formatters';
import { formatBeijingTime } from '@/lib/timeFormat';

export const positionCardClass = 'rounded-lg border border-border bg-card shadow-sm overflow-hidden';
export const positionDetailsClass = 'grid grid-cols-3 gap-x-4 gap-y-2 px-3 pb-2.5';
export const positionActionsClass = 'flex border-t border-border/50';

export function PositionCardHeader({ asset, contract, long, leverage, mode, openedAt, children }: {
  asset: string; contract: string; long: boolean; leverage: number; mode: string; openedAt?: number; children?: ReactNode;
}) {
  return <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/50">
    <span className="text-sm font-bold text-foreground font-mono">{asset}</span>
    <span className="text-xs text-muted-foreground">/ {contract}</span>
    <span className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${long ? 'bg-trading-green/15 text-trading-green' : 'bg-trading-red/15 text-trading-red'}`}>
      {long ? '多' : '空'} {leverage}x {mode}
    </span>
    {children}
    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums" data-testid="position-open-time">
      开仓时间 {formatBeijingTime(openedAt)}
    </span>
  </div>;
}

export function PositionCardPnl({ pnl, roe }: { pnl: number | null; roe: number | null }) {
  const color = pnl == null ? 'text-muted-foreground' : pnl >= 0 ? 'text-trading-green' : 'text-trading-red';
  return <div className="flex items-start justify-between px-3 py-2.5">
    <div>
      <div className="text-[10px] text-muted-foreground mb-0.5">未实现盈亏 (USDT)</div>
      <div className={`text-lg font-bold font-mono tabular-nums ${color}`}>{pnl == null ? '—' : formatSignedUSDT(pnl)}</div>
    </div>
    <div className="text-right">
      <div className="text-[10px] text-muted-foreground mb-0.5">ROE</div>
      <div className={`text-lg font-bold font-mono tabular-nums ${color}`}>{roe == null ? '—' : `${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%`}</div>
    </div>
  </div>;
}

export function EntryPriceCell({ mode, onToggle, entryText, breakevenText, breakevenTitle }: {
  mode: 'breakeven' | 'entry';
  onToggle: () => void;
  entryText: string;
  breakevenText: string;
  breakevenTitle: string;
}) {
  const breakeven = mode === 'breakeven';
  const label = breakeven ? '保本线' : '开仓均价';
  const other = breakeven ? '开仓均价' : '保本线';
  const value = breakeven ? breakevenText : entryText;
  return (
    <button
      type="button"
      data-testid="position-entry-cell"
      data-mode={mode}
      onClick={event => { event.stopPropagation(); onToggle(); }}
      aria-label={`${label} ${value}，点击切换为${other}`}
      title={`${breakeven ? breakevenTitle : '开仓均价：各笔成交价按币量加权，不扣已落袋的利润。'}点一下切换为「${other}」。`}
      className="group/entry min-w-0 text-left"
    >
      <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
        <span className="truncate">{label}</span>
        <ArrowLeftRight aria-hidden="true" className="h-2.5 w-2.5 shrink-0 opacity-40 transition-opacity group-hover/entry:opacity-100" />
      </div>
      <div className="text-xs font-mono tabular-nums text-foreground">{value}</div>
    </button>
  );
}

export function DetailCell({ label, value, valueClassName, title }: {
  label: string; value: string; valueClassName?: string; title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[10px] text-muted-foreground truncate">{label}</div>
      <div className={`text-xs font-mono tabular-nums text-foreground ${valueClassName || ''}`}>{value}</div>
    </div>
  );
}

export function ActionBtn({ label, onClick, danger, disabled }: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-2 text-xs font-medium transition-all active:scale-95 border-r border-border/50 last:border-r-0 ${
        danger
          ? 'text-trading-red hover:bg-trading-red/10'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      } disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
