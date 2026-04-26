/**
 * AdjustMarginModal — Add (or later, Remove) margin for a single position.
 *
 * Closed-loop financial flow:
 *   1. Validate amount > 0 and amount <= globalAvailable.
 *   2. Live-preview the new liquidation price using a synthetic position
 *      with `margin` (cross) or `isolatedMargin` (isolated) bumped by `amount`.
 *   3. On submit, delegate to `onConfirm(amount)` which calls the engine.
 *
 * IMPORTANT: never mutates `quantity` or `entryPrice`.
 */

import { useState, useMemo, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Minus, ArrowRight } from 'lucide-react';
import type { Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import { formatPrice, formatUSDT } from '@/lib/formatters';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  symbol: string;
  position: Position;
  available: number;
  onConfirm: (amount: number) => void;
}

export function AdjustMarginModal({ open, onOpenChange, symbol, position, available, onConfirm }: Props) {
  const [tab, setTab] = useState<'add' | 'remove'>('add');
  const [input, setInput] = useState('');

  useEffect(() => {
    if (open) {
      setInput('');
      setTab('add');
    }
  }, [open, position.id]);

  const baseCoin = symbol.replace('USDT', '');
  const sideLabel = position.side === 'LONG' ? '做多' : '做空';
  const sideColor = position.side === 'LONG' ? 'text-emerald-400' : 'text-red-400';
  const currentEffectiveMargin =
    position.marginMode === 'isolated' && position.isolatedMargin != null
      ? position.isolatedMargin
      : position.margin;

  const amount = useMemo(() => {
    const n = parseFloat(input);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [input]);

  const overBalance = amount > available + 1e-8;

  const currentLiq = useMemo(() => calcLiquidationPrice(position), [position]);

  const previewLiq = useMemo(() => {
    if (amount <= 0) return currentLiq;
    const synthetic: Position =
      position.marginMode === 'isolated'
        ? {
            ...position,
            margin: position.margin + amount,
            isolatedMargin: (position.isolatedMargin ?? position.margin) + amount,
          }
        : {
            // Cross: approximate liq pushback by simulating an effective leverage drop:
            // newEffectiveLeverage = (entry * qty) / (margin + amount)
            ...position,
            marginMode: 'isolated' as const,
            margin: position.margin + amount,
            isolatedMargin: position.margin + amount,
          };
    return calcLiquidationPrice(synthetic);
  }, [amount, position, currentLiq]);

  const liqImproves =
    position.side === 'LONG' ? previewLiq < currentLiq : previewLiq > currentLiq;

  const handleMax = () => {
    const max = Math.max(0, Math.floor(available * 100) / 100);
    setInput(String(max));
  };

  const handleSubmit = () => {
    if (amount <= 0 || overBalance) return;
    onConfirm(amount);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-2">
          <DialogTitle className="text-base">调整保证金</DialogTitle>
          <DialogDescription className="text-xs">
            追加保证金可降低强平风险，不会改变持仓数量与开仓均价
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-2 space-y-3">
          {/* Position summary */}
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs space-y-1 font-mono tabular-nums">
            <div className="flex justify-between">
              <span className="text-muted-foreground">合约</span>
              <span className="font-medium">{baseCoin}/USDT 永续</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">方向 / 杠杆</span>
              <span>
                <span className={`font-bold ${sideColor}`}>{sideLabel}</span>
                <span className="text-muted-foreground"> · </span>
                <span>{position.leverage}x</span>
                <span className="text-muted-foreground"> · </span>
                <span>{position.marginMode === 'cross' ? '全仓' : '逐仓'}</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">当前保证金</span>
              <span>{formatUSDT(currentEffectiveMargin)} USDT</span>
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'add' | 'remove')}>
            <TabsList className="grid grid-cols-2 w-full h-9">
              <TabsTrigger value="add" className="text-xs">
                <Plus className="w-3 h-3 mr-1" />追加
              </TabsTrigger>
              <TabsTrigger value="remove" disabled className="text-xs">
                <Minus className="w-3 h-3 mr-1" />减少
              </TabsTrigger>
            </TabsList>

            <TabsContent value="add" className="mt-3 space-y-3">
              {/* Input */}
              <div>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="请输入追加金额"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="pr-24 font-mono tabular-nums"
                    min={0}
                    step="0.01"
                  />
                  <div className="absolute inset-y-0 right-2 flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">USDT</span>
                    <button
                      type="button"
                      onClick={handleMax}
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      最大
                    </button>
                  </div>
                </div>
                <div className="flex justify-between mt-1.5 text-[11px] font-mono tabular-nums">
                  <span className="text-muted-foreground">可用余额</span>
                  <span className={overBalance ? 'text-red-400' : 'text-foreground'}>
                    {formatUSDT(available)} USDT
                  </span>
                </div>
                {overBalance && (
                  <div className="mt-1 text-[11px] text-red-400">超出可用余额</div>
                )}
              </div>

              {/* Live Liquidation Preview */}
              <div className="rounded-md border border-border bg-card px-3 py-2.5">
                <div className="text-[10px] text-muted-foreground mb-1">强平价格预览</div>
                <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                  <div className="text-sm">
                    <div className="text-[10px] text-muted-foreground">当前</div>
                    <div className="text-red-400 font-bold">{formatPrice(currentLiq, symbol)}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <div className="text-sm text-right">
                    <div className="text-[10px] text-muted-foreground">追加后</div>
                    <div className={`font-bold ${amount > 0 && liqImproves ? 'text-emerald-400' : 'text-foreground'}`}>
                      {amount > 0 ? formatPrice(previewLiq, symbol) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="remove" className="mt-3">
              <div className="text-xs text-muted-foreground py-4 text-center">
                减少保证金功能即将上线
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={amount <= 0 || overBalance || tab !== 'add'}
          >
            确认追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
