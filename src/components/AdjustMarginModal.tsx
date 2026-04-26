import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import { formatPrice, formatUSDT } from '@/lib/formatters';

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  position: Position;
  /** Global available balance (for Add max) */
  availableBalance: number;
  /** signedDelta > 0 = add, < 0 = remove */
  onConfirm: (signedDelta: number) => void;
}

type Mode = 'add' | 'remove';

export function AdjustMarginModal({
  open, onClose, symbol, position, availableBalance, onConfirm,
}: Props) {
  const [mode, setMode] = useState<Mode>('add');
  const [amountStr, setAmountStr] = useState<string>('');

  const currentMargin = position.isolatedMargin ?? position.margin;
  const initialMargin = (position.quantity * position.entryPrice) / position.leverage;
  const maxRemovable = Math.max(0, currentMargin - initialMargin);
  const maxAddable = Math.max(0, availableBalance);
  const max = mode === 'add' ? maxAddable : maxRemovable;

  const amount = useMemo(() => {
    const n = parseFloat(amountStr);
    if (isNaN(n) || n <= 0) return 0;
    return Math.min(n, max);
  }, [amountStr, max]);

  // Compute current & projected liq prices
  const currentLiq = useMemo(() => calcLiquidationPrice({
    ...position,
    marginMode: 'isolated',
    isolatedMargin: currentMargin,
  }), [position, currentMargin]);

  const projectedLiq = useMemo(() => {
    const signed = mode === 'add' ? amount : -amount;
    const newMargin = currentMargin + signed;
    if (newMargin <= 0) return NaN;
    return calcLiquidationPrice({
      ...position,
      marginMode: 'isolated',
      isolatedMargin: newMargin,
    });
  }, [position, currentMargin, amount, mode]);

  const handleMax = () => setAmountStr(max > 0 ? String(max.toFixed(2)) : '0');

  const handleSwitchMode = (next: string) => {
    setMode(next as Mode);
    setAmountStr('');
  };

  const canSubmit = amount > 0 && amount <= max + 1e-9;

  const handleConfirm = () => {
    if (!canSubmit) return;
    const signed = mode === 'add' ? amount : -amount;
    onConfirm(signed);
    toast.success('保证金调整成功', {
      description: `${mode === 'add' ? '追加' : '减少'} ${amount.toFixed(2)} USDT`,
      position: 'top-center',
    });
    setAmountStr('');
    onClose();
  };

  const baseCoin = symbol.replace('USDT', '');

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">调整保证金</DialogTitle>
          <DialogDescription className="text-xs">
            {baseCoin}/USDT 永续 ·{' '}
            <span className={position.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
              {position.side === 'LONG' ? '多' : '空'} {position.leverage}x
            </span>{' '}
            · 逐仓
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={handleSwitchMode} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="add">追加保证金</TabsTrigger>
            <TabsTrigger value="remove">减少保证金</TabsTrigger>
          </TabsList>

          <TabsContent value={mode} className="space-y-4 mt-4">
            {/* Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] text-muted-foreground">数量</label>
                <div className="text-[11px] text-muted-foreground">
                  {mode === 'add' ? '可追加' : '可减少'}：
                  <span className="text-foreground font-mono ml-1">{formatUSDT(max)} USDT</span>
                </div>
              </div>
              <div className="relative">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0.00"
                  className="pr-24 font-mono tabular-nums"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleMax}
                    disabled={max <= 0}
                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    最大
                  </button>
                  <span className="text-[11px] text-muted-foreground pr-2">USDT</span>
                </div>
              </div>
              {mode === 'remove' && maxRemovable <= 0 && (
                <div className="text-[10px] text-amber-400 mt-1">
                  当前保证金已是最低初始保证金，无法继续减少
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 text-[11px] font-mono tabular-nums">
              <Row
                label="当前保证金"
                value={`${formatUSDT(currentMargin)} USDT`}
              />
              <Row
                label="调整后保证金"
                value={`${formatUSDT(currentMargin + (mode === 'add' ? amount : -amount))} USDT`}
                highlight
              />
              <div className="h-px bg-border my-1" />
              <Row
                label="预估强平价"
                value={
                  <span className="flex items-center gap-1.5">
                    <span className={isFinite(currentLiq) ? 'text-red-400/80' : 'text-muted-foreground'}>
                      {isFinite(currentLiq) ? formatPrice(currentLiq, symbol) : '--'}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className={
                      !isFinite(projectedLiq)
                        ? 'text-muted-foreground'
                        : (mode === 'add' ? 'text-emerald-400' : 'text-red-400')
                    }>
                      {!isFinite(projectedLiq) ? '--' : formatPrice(projectedLiq, symbol)}
                    </span>
                  </span>
                }
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={handleConfirm}
            className={mode === 'add' ? '' : 'bg-amber-500 hover:bg-amber-500/90 text-white'}
          >
            确认{mode === 'add' ? '追加' : '减少'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? 'text-foreground font-bold' : 'text-foreground'}>{value}</span>
    </div>
  );
}
