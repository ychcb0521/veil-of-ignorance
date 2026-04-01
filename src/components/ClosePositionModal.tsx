import { useState, useMemo } from 'react';
import type { Position } from '@/types/trading';
import { calcUnrealizedPnl } from '@/types/trading';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  position: Position;
  posIndex: number;
  currentPrice: number;
  pricePrecision: number;
  onConfirm: (symbol: string, index: number, percentage: number) => void;
}

const QUICK_PERCENTAGES = [25, 50, 75, 100];

export function ClosePositionModal({ open, onClose, symbol, position, posIndex, currentPrice, pricePrecision, onConfirm }: Props) {
  const [percentage, setPercentage] = useState(100);
  const baseCoin = symbol.replace('USDT', '');

  const totalPnl = useMemo(() => calcUnrealizedPnl(position, currentPrice), [position, currentPrice]);
  const closeQty = position.quantity * (percentage / 100);
  const estimatedPnl = totalPnl * (percentage / 100);
  const isProfit = estimatedPnl >= 0;
  const notionalValue = closeQty * currentPrice;

  const handleConfirm = () => {
    if (percentage <= 0 || closeQty <= 0) return;
    onConfirm(symbol, posIndex, percentage / 100);
    onClose();
    setPercentage(100);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      onClose();
      setPercentage(100);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">市价平仓</DialogTitle>
          <DialogDescription className="sr-only">选择平仓比例并确认</DialogDescription>
        </DialogHeader>

        {/* Position Info */}
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <span className="text-sm font-bold font-mono text-foreground">{baseCoin}/USDT 永续</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            position.side === 'LONG'
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400'
          }`}>
            {position.side === 'LONG' ? '多' : '空'} {position.leverage}x
          </span>
        </div>

        {/* Price Info */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">开仓价格</span>
            <div className="font-mono font-medium text-foreground mt-0.5">
              {position.entryPrice.toFixed(pricePrecision)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">标记价格</span>
            <div className="font-mono font-medium text-primary mt-0.5 animate-pulse">
              {currentPrice.toFixed(pricePrecision)}
            </div>
          </div>
        </div>

        {/* Slider */}
        <div className="space-y-3 pt-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">平仓比例</span>
            <span className="text-sm font-bold font-mono text-foreground">
              {percentage}%
              <span className="text-xs font-normal text-muted-foreground ml-1.5">
                (≈ {closeQty.toFixed(4)} {baseCoin})
              </span>
            </span>
          </div>
          <Slider
            value={[percentage]}
            onValueChange={(v) => setPercentage(v[0])}
            min={1}
            max={100}
            step={1}
            className="w-full"
          />
          <div className="flex gap-1.5">
            {QUICK_PERCENTAGES.map(pct => (
              <button
                key={pct}
                onClick={() => setPercentage(pct)}
                className={`flex-1 py-1 rounded text-[10px] font-medium border transition-colors ${
                  percentage === pct
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Estimated Result */}
        <div className="rounded-lg border border-border bg-accent/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">仓位总数量</span>
            <span className="font-mono text-foreground">{position.quantity.toFixed(4)} {baseCoin}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">平仓数量</span>
            <span className="font-mono text-foreground">{closeQty.toFixed(4)} {baseCoin}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">平仓价值</span>
            <span className="font-mono text-foreground">{notionalValue.toFixed(2)} USDT</span>
          </div>
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">预计盈亏</span>
            <span className={`text-sm font-bold font-mono tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
              {isProfit ? '+' : ''}{estimatedPnl.toFixed(2)} USDT
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1">
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            className={`flex-1 ${
              position.side === 'LONG'
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
          >
            确认平仓 ({percentage}%)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
