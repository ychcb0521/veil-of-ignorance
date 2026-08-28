import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Position } from '@/types/trading';
import { firstLiquidationPrice } from '@/lib/positionGroupRisk';
import { allocateMarginUsd } from '@/lib/marginAllocation';
import { formatPrice, formatUSDT } from '@/lib/formatters';
import { formatCoinAmount, getSettlementAsset } from '@/lib/coinMargined';
import { isCoinSettled } from '@/lib/tradingSettlement';

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  position: Position;
  /** Global available balance (for Add max) */
  availableBalance: number;
  /**
   * 实时标记价。USD ↔ 币的换算**必须**用它，不能用开仓价：
   * 真正记账的那一步就是按标记价折的（handleAdjustMargin 里 actual / priceMap），
   * 用开仓价算给用户看，等于展示一个不会发生的币量。
   * 合并组更明显——合成仓位的"开仓价"是加权均价，等于谁的开仓价都不是。
   */
  markPrice: number;
  /** 可减到的地板（USD）。由调用方按逐笔算好——币本位的地板与价无关，U 本位按各自开仓价。 */
  initialMarginUsd: number;
  /**
   * 这组下面的**每一笔**逐仓仓位。强平价必须逐笔算再取最先撞线的那个：
   * 逐仓爆仓是逐仓位判的，把整组拼成一笔虚构仓位算出来的价既不是最先也不是最后。
   */
  legs: Position[];
  /** 同一张卡上被排除在外的全仓腿数量——为 0 时不提示。 */
  excludedCrossLegs?: number;
  /** signedDelta > 0 = add, < 0 = remove */
  onConfirm: (signedDelta: number) => void;
}

type Mode = 'add' | 'remove';

export function AdjustMarginModal({
  open, onClose, symbol, position, availableBalance, markPrice, initialMarginUsd, legs, excludedCrossLegs = 0, onConfirm,
}: Props) {
  const [mode, setMode] = useState<Mode>('add');
  const [amountStr, setAmountStr] = useState<string>('');

  const isCoinMargined = isCoinSettled(position);
  const baseCoin = getSettlementAsset(symbol);
  const quoteUnitLabel = isCoinMargined ? 'USD' : 'USDT';
  const currentMargin = position.isolatedMargin ?? position.margin;
  /**
   * 地板由调用方给。币本位此前取的是 position.margin —— 而它开仓时就等于初始保证金、
   * 追加时又跟着一起涨，于是"可减 = 当前 − 地板"**恒为 0**：
   * 币本位仓位从开出来的那一刻起就一分钱都减不掉，不是"加过之后才不能减"。
   */
  const initialMargin = initialMarginUsd;
  const maxRemovable = Math.max(0, currentMargin - initialMargin);
  const maxAddable = Math.max(0, availableBalance);
  const max = mode === 'add' ? maxAddable : maxRemovable;
  /** 换算价：标记价优先，取不到才退回开仓价（与记账那一步同源）。 */
  const conversionPrice = markPrice > 0 ? markPrice : position.entryPrice;
  const maxCoin = isCoinMargined && conversionPrice > 0 ? max / conversionPrice : 0;

  const amount = useMemo(() => {
    const n = parseFloat(amountStr);
    if (isNaN(n) || n <= 0) return 0;
    return Math.min(n, max);
  }, [amountStr, max]);

  // 强平价：整组里**最先**撞线的那一笔。单笔时就是它自己。
  const currentLiq = useMemo(
    () => firstLiquidationPrice(legs, position.side) ?? NaN,
    [legs, position.side],
  );

  /**
   * 【回归】预估强平价此前对币本位**恒等于当前强平价**。
   *
   * 它只覆写了 isolatedMargin，而 calcLiquidationPrice 的币本位分支读的是
   * `marginCoin ?? margin / entryPrice` —— 两个都没动。于是无论填多少，
   * 箭头右边的数永远和左边一样。而用户全程币本位，这个模态框里唯一有决策价值的
   * 那个数，一直是个常数；点确认之后卡上的强平价却真的跳了。
   * 三个保证金字段一起更新，币量按**标记价**折（与真正记账的那一步同源）。
   */
  const projectedLiq = useMemo(() => {
    const signed = mode === 'add' ? amount : -amount;
    if (signed === 0) return currentLiq;
    if (currentMargin + signed <= 0) return NaN;
    // 按真正会执行的那套分摊算，再逐笔重算强平价——否则模态框承诺的是一个不会发生的数。
    const allocations = allocateMarginUsd({ symbol, positions: legs, deltaUsd: signed, markPrice: conversionPrice });
    const byId = new Map(allocations.map(a => [a.positionId, a.deltaUsd]));
    const projected = legs.map(p => {
      const d = byId.get(p.id) ?? 0;
      if (d === 0) return p;
      const coin = isCoinSettled(p) && conversionPrice > 0 ? d / conversionPrice : 0;
      const baseCoin = p.marginCoin ?? (p.entryPrice > 0 ? p.margin / p.entryPrice : 0);
      return {
        ...p,
        isolatedMargin: Math.max(0, (p.isolatedMargin ?? p.margin) + d),
        margin: Math.max(0, p.margin + d),
        marginCoin: isCoinSettled(p) ? Math.max(0, baseCoin + coin) : p.marginCoin,
      };
    });
    return firstLiquidationPrice(projected, position.side) ?? NaN;
  }, [legs, symbol, currentLiq, currentMargin, amount, mode, conversionPrice, position.side]);

  const handleMax = () => setAmountStr(max > 0 ? String(max.toFixed(2)) : '0');

  const handleSwitchMode = (next: string) => {
    setMode(next as Mode);
    setAmountStr('');
  };

  const canSubmit = amount > 0 && amount <= max + 1e-9;

  const handleConfirm = () => {
    if (!canSubmit) return;
    const signed = mode === 'add' ? amount : -amount;
    /**
     * 不在这里报成功。调用方可能因为"可用余额不足"/"已达初始保证金下限"
     * 直接返回并弹错误提示——此前这两条提示会和这里的"调整成功"**同时**出现在
     * 同一次点击上。成功与否由真正动账的那一方说。
     */
    onConfirm(signed);
    setAmountStr('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">调整保证金</DialogTitle>
          <DialogDescription className="text-xs">
            {baseCoin}/{quoteUnitLabel} 永续 ·{' '}
            <span className={position.side === 'LONG' ? 'text-trading-green' : 'text-trading-red'}>
              {position.side === 'LONG' ? '多' : '空'} {position.leverage}x
            </span>{' '}
            · 逐仓
            {legs.length > 1 && <> · <span className="text-foreground/80">{legs.length} 笔合并</span></>}
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
                  {isCoinMargined && max > 0 && (
                    <span className="text-muted-foreground/80 ml-1">≈ {formatCoinAmount(maxCoin, baseCoin)}</span>
                  )}
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
                  <span className="text-[11px] text-muted-foreground pr-2">USDT{isCoinMargined ? '等值' : ''}</span>
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
              {legs.length > 1 && (
                <div className="text-[10px] leading-4 text-muted-foreground/80 pt-0.5">
                  这组有 {legs.length} 笔逐仓仓位，按名义等比摊到每一笔；
                  强平价取<strong className="text-foreground/80">最先撞线</strong>的那一笔——逐仓爆仓是逐仓位判的。
                </div>
              )}
              {excludedCrossLegs > 0 && (
                <div className="text-[10px] leading-4 text-amber-500 dark:text-amber-400 pt-0.5">
                  本组另有 {excludedCrossLegs} 笔<strong>全仓</strong>仓位未计入：全仓共用一个保证金池，不支持单仓位追加。
                </div>
              )}
              <Row
                label={legs.length > 1 ? '预估强平价（最先）' : '预估强平价'}
                value={
                  <span className="flex items-center gap-1.5">
                    <span className={isFinite(currentLiq) ? 'text-trading-red/80' : 'text-muted-foreground'}>
                      {isFinite(currentLiq) ? formatPrice(currentLiq, symbol) : '--'}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className={
                      !isFinite(projectedLiq)
                        ? 'text-muted-foreground'
                        : (mode === 'add' ? 'text-trading-green' : 'text-trading-red')
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
