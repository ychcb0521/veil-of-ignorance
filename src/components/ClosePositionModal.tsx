import { useState, useMemo, useEffect } from 'react';
import type { Position } from '@/types/trading';
import { calcUnrealizedPnl } from '@/types/trading';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { formatPrice, formatAmount, formatUSDT, formatSignedUSDT } from '@/lib/formatters';

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
const QTY_PRECISION = 4;
const MIN_QTY = 1 / Math.pow(10, QTY_PRECISION);

function roundQty(v: number) {
  const f = Math.pow(10, QTY_PRECISION);
  return Math.round(v * f) / f;
}

export function ClosePositionModal({ open, onClose, symbol, position, posIndex, currentPrice, pricePrecision, onConfirm }: Props) {
  // Single source of truth: absolute close amount (in base coin)
  const [closeAmount, setCloseAmount] = useState<number>(position.quantity);
  // Raw input string so users can freely type (e.g. "0.", "0.00")
  const [amountInput, setAmountInput] = useState<string>(roundQty(position.quantity).toString());
  const baseCoin = symbol.replace('USDT', '');

  // Reset when modal opens for a different position
  useEffect(() => {
    if (open) {
      const initial = roundQty(position.quantity);
      setCloseAmount(initial);
      setAmountInput(initial.toString());
    }
  }, [open, position.quantity, position.id]);

  const totalPnl = useMemo(() => calcUnrealizedPnl(position, currentPrice), [position, currentPrice]);
  const ratio = position.quantity > 0 ? Math.min(1, Math.max(0, closeAmount / position.quantity)) : 0;
  const currentPercentage = ratio * 100;
  const sliderPct = Math.round(currentPercentage);
  const estimatedPnl = totalPnl * ratio;
  const isProfit = estimatedPnl >= 0;
  const notionalValue = closeAmount * currentPrice;
  const releasedMargin = position.margin * ratio;

  const clampAmount = (v: number): number => {
    if (!isFinite(v) || isNaN(v) || v < 0) return 0;
    if (v > position.quantity) return position.quantity;
    return roundQty(v);
  };

  const setAmountFromInput = (raw: string) => {
    setAmountInput(raw);
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    // Live-update SoT but DO NOT clamp upward while typing — clamp on blur/submit
    if (parsed < 0) {
      setCloseAmount(0);
    } else if (parsed > position.quantity) {
      setCloseAmount(position.quantity);
    } else {
      setCloseAmount(parsed);
    }
  };

  const handleAmountBlur = () => {
    const parsed = parseFloat(amountInput);
    const clamped = clampAmount(isNaN(parsed) ? 0 : parsed);
    setCloseAmount(clamped);
    setAmountInput(clamped.toString());
  };

  const setFromPercent = (pct: number) => {
    const next = clampAmount(position.quantity * (pct / 100));
    setCloseAmount(next);
    setAmountInput(next.toString());
  };

  const handleMax = () => {
    const max = roundQty(position.quantity);
    setCloseAmount(max);
    setAmountInput(max.toString());
  };

  const handleConfirm = () => {
    const parsed = parseFloat(amountInput);
    const finalAmount = clampAmount(isNaN(parsed) ? closeAmount : parsed);
    if (finalAmount < MIN_QTY || position.quantity <= 0) return;
    const finalRatio = Math.min(1, finalAmount / position.quantity);
    onConfirm(symbol, posIndex, finalRatio);
    onClose();
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) onClose();
  };

  const submitDisabled = closeAmount < MIN_QTY;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">市价平仓</DialogTitle>
          <DialogDescription className="sr-only">输入或拖动选择平仓数量并确认</DialogDescription>
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
              {formatPrice(position.entryPrice, symbol)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">标记价格</span>
            <div className="font-mono font-medium text-primary mt-0.5 animate-pulse">
              {formatPrice(currentPrice, symbol)}
            </div>
          </div>
        </div>

        {/* Amount input + Slider */}
        <div className="space-y-3 pt-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">平仓数量</span>
            <span className="text-[11px] font-mono text-muted-foreground">
              可用 {roundQty(position.quantity)} {baseCoin}
            </span>
          </div>

          {/* Precise input */}
          <div className="flex items-center h-10 rounded-md border border-border bg-secondary/40 focus-within:ring-1 focus-within:ring-primary/60 transition">
            <input
              type="number"
              inputMode="decimal"
              value={amountInput}
              min={0}
              max={position.quantity}
              step={MIN_QTY}
              onChange={(e) => setAmountFromInput(e.target.value)}
              onBlur={handleAmountBlur}
              className="flex-1 h-full bg-transparent px-3 text-sm font-mono font-semibold text-foreground outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder="0.0000"
            />
            <span className="px-2 text-xs font-medium text-muted-foreground select-none">{baseCoin}</span>
            <button
              type="button"
              onClick={handleMax}
              className="h-full px-3 text-[11px] font-bold text-primary hover:bg-primary/10 border-l border-border transition-colors"
            >
              全部
            </button>
          </div>

          {/* Slider */}
          <div className="space-y-2">
            <Slider
              value={[sliderPct]}
              onValueChange={(v) => setFromPercent(v[0])}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground font-mono">
                ≈ {currentPercentage.toFixed(1)}% · {formatUSDT(notionalValue)} USDT
              </span>
              <div className="flex gap-1">
                {QUICK_PERCENTAGES.map(pct => {
                  const active = sliderPct === pct;
                  return (
                    <button
                      key={pct}
                      onClick={() => setFromPercent(pct)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                      }`}
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Estimated Result */}
        <div className="rounded-lg border border-border bg-accent/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">仓位总数量</span>
            <span className="font-mono text-foreground">{formatAmount(position.quantity, QTY_PRECISION)} {baseCoin}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">平仓数量</span>
            <span className="font-mono text-foreground">{formatAmount(closeAmount, QTY_PRECISION)} {baseCoin}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">平仓价值</span>
            <span className="font-mono text-foreground">{formatUSDT(notionalValue)} USDT</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">预计退回保证金</span>
            <span className="font-mono text-foreground">{formatUSDT(releasedMargin)} USDT</span>
          </div>
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">预计盈亏</span>
            <span className={`text-sm font-bold font-mono tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatSignedUSDT(estimatedPnl)} USDT
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1">
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitDisabled}
            className={`flex-1 ${
              position.side === 'LONG'
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
          >
            确认平仓 ({sliderPct}%)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
