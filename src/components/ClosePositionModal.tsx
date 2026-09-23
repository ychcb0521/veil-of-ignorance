import { useState, useMemo, useEffect, useRef } from 'react';
import type { Position } from '@/types/trading';
import { calcUnrealizedPnl } from '@/types/trading';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { formatPrice, formatAmount, formatUSDT, formatSignedUSDT } from '@/lib/formatters';
import { formatCoinAmount, getSettlementAsset } from '@/lib/coinMargined';
import {
  formatSettlementQuantity,
  getPositionNotionalUsd,
  getPositionUnits,
  isCoinSettled,
} from '@/lib/tradingSettlement';
import { formatClosePercent, type CardCloseLotSize } from '@/lib/marketLotSize';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  /**
   * 要平的那张卡。卡上多于一笔时传的是**合成仓位**（合计数量、加权开仓价、合计保证金与盈亏），
   * 弹窗只管挑一个成数，成数怎么摊到各笔由调用方决定（PositionPanel 与「止盈/止损」同一个摊法）。
   */
  position: Position;
  currentPrice: number;
  pricePrecision: number;
  /** 这张卡上有几笔仓位；> 1 时提示成数会摊到每一笔。 */
  legCount?: number;
  /** 确认平仓：只回成数（0–1）。按 id 重新解析各笔、下发给引擎都在调用方那一侧。 */
  onConfirm: (percentage: number) => void;
  /**
   * 按成数（0–1）判这次市价平仓会不会超过币安单笔市价上限（lib/marketLotSize.cardCloseLotSize）。
   * 超过时按钮置灰并说明，给一个「按上限平」把数量改到上限——不替用户拆单，也不悄悄只平一部分。
   * 不传就不判（快照里查不到的合约也不设上限）。
   */
  lotSizeCheck?: (fraction: number) => CardCloseLotSize;
}

const QUICK_PERCENTAGES = [25, 50, 75, 100];
const QTY_PRECISION = 4;
const MIN_QTY = 1 / Math.pow(10, QTY_PRECISION);

function roundQty(v: number) {
  const f = Math.pow(10, QTY_PRECISION);
  return Math.round(v * f) / f;
}

export function ClosePositionModal({ open, onClose, symbol, position, currentPrice, pricePrecision, legCount = 1, onConfirm, lotSizeCheck }: Props) {
  const baseCoin = getSettlementAsset(symbol);
  const isCoinMargined = isCoinSettled(position);
  const totalUnits = getPositionUnits(position);
  const minQty = isCoinMargined ? 1 : MIN_QTY;
  const unitLabel = isCoinMargined ? '张' : baseCoin;
  const quoteUnitLabel = isCoinMargined ? 'USD' : 'USDT';

  const formatCloseUnits = (units: number) => (
    isCoinMargined ? `${Math.round(units)} 张` : `${formatAmount(units, QTY_PRECISION)} ${baseCoin}`
  );

  const normalizeAmount = (v: number): number => (
    isCoinMargined ? Math.max(0, Math.round(v)) : roundQty(v)
  );

  // Single source of truth: absolute close amount (base coin for U-M, contracts for COIN-M)
  const [closeAmount, setCloseAmount] = useState<number>(() => normalizeAmount(totalUnits));
  // Raw input string so users can freely type (e.g. "0.", "0.00")
  const [amountInput, setAmountInput] = useState<string>(() => normalizeAmount(totalUnits).toString());

  /**
   * 打开时按全部可用数量起步；弹窗**开着的时候**可用数量变了（卡上有一笔被强平 / 被止盈平掉，
   * 调用方按还活着的腿重算了合成仓位）就按用户已经挑好的成数换算到新的可用数量——
   * 挑的是「50%」，那就仍是剩下那些的 50%，而不是悄悄跳回 100%，也不是停在一个已经不存在的数上。
   */
  const sessionRef = useRef<{ open: boolean; units: number; amount: number }>({ open: false, units: 0, amount: 0 });
  sessionRef.current.amount = closeAmount;
  useEffect(() => {
    const prev = sessionRef.current;
    if (!open) {
      sessionRef.current = { open: false, units: 0, amount: prev.amount };
      return;
    }
    const keepRatio = prev.open && prev.units > 0 && prev.units !== totalUnits;
    const next = keepRatio
      ? normalizeAmount(totalUnits * Math.min(1, Math.max(0, prev.amount / prev.units)))
      : normalizeAmount(totalUnits);
    sessionRef.current = { open: true, units: totalUnits, amount: next };
    setCloseAmount(next);
    setAmountInput(next.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, totalUnits, position.id, isCoinMargined]);

  const totalPnl = useMemo(() => calcUnrealizedPnl(position, currentPrice), [position, currentPrice]);
  const ratio = totalUnits > 0 ? Math.min(1, Math.max(0, closeAmount / totalUnits)) : 0;
  const currentPercentage = ratio * 100;
  const sliderPct = Math.round(currentPercentage);
  const estimatedPnl = totalPnl * ratio;
  const isProfit = estimatedPnl >= 0;
  const notionalValue = getPositionNotionalUsd(
    symbol,
    {
      ...position,
      quantity: isCoinMargined ? position.quantity : closeAmount,
      contracts: isCoinMargined ? closeAmount : position.contracts,
    },
    currentPrice,
  );
  const releasedMargin = position.margin * ratio;
  const releasedMarginLabel = isCoinMargined && position.marginCoin != null
    ? `${formatCoinAmount(position.marginCoin * ratio, baseCoin)} ≈ ${formatUSDT(releasedMargin)} USDT`
    : `${formatUSDT(releasedMargin)} USDT`;

  const clampAmount = (v: number): number => {
    if (!isFinite(v) || isNaN(v) || v < 0) return 0;
    if (v > totalUnits) return normalizeAmount(totalUnits);
    return normalizeAmount(v);
  };

  const setAmountFromInput = (raw: string) => {
    setAmountInput(raw);
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    // Live-update SoT but DO NOT clamp upward while typing — clamp on blur/submit
    if (parsed < 0) {
      setCloseAmount(0);
    } else if (parsed > totalUnits) {
      setCloseAmount(normalizeAmount(totalUnits));
    } else {
      setCloseAmount(isCoinMargined ? Math.round(parsed) : parsed);
    }
  };

  const handleAmountBlur = () => {
    const parsed = parseFloat(amountInput);
    const clamped = clampAmount(isNaN(parsed) ? 0 : parsed);
    setCloseAmount(clamped);
    setAmountInput(clamped.toString());
  };

  const setFromPercent = (pct: number) => {
    const next = clampAmount(totalUnits * (pct / 100));
    setCloseAmount(next);
    setAmountInput(next.toString());
  };

  const handleMax = () => {
    const max = normalizeAmount(totalUnits);
    setCloseAmount(max);
    setAmountInput(max.toString());
  };

  const handleConfirm = () => {
    const parsed = parseFloat(amountInput);
    const finalAmount = clampAmount(isNaN(parsed) ? closeAmount : parsed);
    if (finalAmount < minQty || totalUnits <= 0) return;
    const finalRatio = Math.min(1, finalAmount / totalUnits);
    onConfirm(finalRatio);
    onClose();
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) onClose();
  };

  /**
   * 币安单笔市价上限：这次要平的量超过它就不放行，并给出「按上限平」的数量（向下取整，不超上限；
   * 合成币本位按现价折张、在上限前留 0.2% 余量，见 cardCloseLotSize 的 maxFraction）。
   */
  const lotSize = lotSizeCheck && ratio > 0 ? lotSizeCheck(ratio) : null;
  const lotRefusal = lotSize?.refusal ?? null;
  const lotMaxAmount = (() => {
    if (!lotSize || !lotRefusal) return 0;
    /**
     * 币本位：直接向下取整，不加容差。二分出来的成数 lo 满足「按 lo 平放得下」，而平掉的张数随成数单调不减、
     * ⌊lo × 总张数⌋ ÷ 总张数 ≤ lo，所以这个张数一定放得下。加一丝容差再取整会越过边界：卡上两笔各 1,500 张、
     * 一笔最多 1,000 张时，lo × 3,000 = 1,000.99…，进成 1,001 张，摊到两笔各 500.5 张、各自四舍五入成 501，
     * 合计 1,002 张——按了「按上限平」还是超。
     */
    if (isCoinMargined) return Math.floor(lotSize.maxFraction * totalUnits);
    // U 本位没有逐笔取整，边界就是上限本身：二分的成数比它低一丝（乘回去是 199,999.99999999），取整前吸掉这一丝浮点尾巴
    return Math.floor(lotSize.maxFraction * totalUnits * 10 ** QTY_PRECISION + 1e-3) / 10 ** QTY_PRECISION;
  })();
  const applyLotMax = () => {
    setCloseAmount(lotMaxAmount);
    setAmountInput(lotMaxAmount.toString());
  };
  /** 与警告标题同一种写法（千分位、不补零）：「按上限平 21,766 张」「按上限平 200,000 KAITO」。 */
  const lotMaxLabel = isCoinMargined
    ? `${Math.round(lotMaxAmount).toLocaleString('en-US')} 张`
    : `${lotMaxAmount.toLocaleString('en-US', { maximumFractionDigits: QTY_PRECISION })} ${baseCoin}`;
  const lotFillable = lotMaxAmount >= minQty;

  const submitDisabled = closeAmount < minQty || lotRefusal != null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">市价平仓</DialogTitle>
          <DialogDescription className="sr-only">输入或拖动选择平仓数量并确认</DialogDescription>
        </DialogHeader>

        {/* Position Info */}
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <span className="text-sm font-bold font-mono text-foreground">
            {baseCoin}/{quoteUnitLabel} 永续
          </span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            position.side === 'LONG'
              ? 'bg-trading-green/15 text-trading-green'
              : 'bg-trading-red/15 text-trading-red'
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

        {legCount > 1 && (
          <div className="text-[10px] text-muted-foreground" data-testid="close-leg-note">
            这张卡上有 {legCount} 笔仓位（杠杆 / 保证金模式 / 结算方式 / 维持保证金口径任一不同，没有合并）：
            <strong className="text-foreground">成数摊到每一笔</strong>，各按自己的数量平——
            上面的数量与开仓价是这一组的合计与加权价，所以「100%」盖住的是整张卡。
          </div>
        )}

        {/* Amount input + Slider */}
        <div className="space-y-3 pt-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">平仓数量</span>
            <span className="text-[11px] font-mono text-muted-foreground">
              可用 {formatCloseUnits(totalUnits)}
            </span>
          </div>

          {/* Precise input */}
          <div className="flex items-center h-10 rounded-md border border-border bg-secondary/40 focus-within:ring-1 focus-within:ring-primary/60 transition">
            <input
              type="number"
              inputMode="decimal"
              value={amountInput}
              min={0}
              max={totalUnits}
              step={minQty}
              onChange={(e) => setAmountFromInput(e.target.value)}
              onBlur={handleAmountBlur}
              className="flex-1 h-full bg-transparent px-3 text-sm font-mono font-semibold text-foreground outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder={isCoinMargined ? '0' : '0.0000'}
            />
            <span className="px-2 text-xs font-medium text-muted-foreground select-none">{unitLabel}</span>
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
                ≈ {currentPercentage.toFixed(1)}% · {formatUSDT(notionalValue)} {quoteUnitLabel}
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
            <span className="font-mono text-foreground">{formatSettlementQuantity(position, symbol)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">平仓数量</span>
            <span className="font-mono text-foreground">{formatCloseUnits(closeAmount)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">平仓价值</span>
            <span className="font-mono text-foreground">{formatUSDT(notionalValue)} {quoteUnitLabel}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">预计退回保证金</span>
            <span className="font-mono text-foreground">{releasedMarginLabel}</span>
          </div>
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">预计盈亏</span>
            <span className={`text-sm font-bold font-mono tabular-nums ${isProfit ? 'text-trading-green' : 'text-trading-red'}`}>
              {formatSignedUSDT(estimatedPnl)} USDT
            </span>
          </div>
        </div>

        {lotRefusal && (
          <div
            data-testid="close-lot-size-warning"
            className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[11px] bg-trading-red/10 text-trading-red border border-trading-red/30"
          >
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="space-y-0.5">
              <span className="block">{lotRefusal.title}</span>
              <span className="block text-[10px] opacity-80">
                {lotFillable
                  ? `${lotRefusal.source}。市价平仓也是一笔市价单：请分几次平（每次不超过上限），`
                    + '或在持仓卡上设 100% 的止盈止损（平掉整个仓位的不受此限）。'
                  : `${lotRefusal.source}。连最小的一笔（${isCoinMargined ? '1 张' : `${MIN_QTY} ${baseCoin}`}）都超过上限，市价平仓平不了：`
                    + '请在持仓卡上设 100% 的止盈止损（平掉整个仓位的不受此限），或用「一键平仓」。'}
              </span>
              {lotFillable && (
                <button
                  type="button"
                  data-testid="close-lot-size-fill-max"
                  onClick={applyLotMax}
                  className="mt-0.5 underline hover:no-underline"
                >
                  按上限平 {lotMaxLabel}
                </button>
              )}
            </span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1">
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitDisabled}
            className={`flex-1 ${
              position.side === 'LONG'
                ? 'bg-trading-red hover:bg-trading-red/90 text-white'
                : 'bg-trading-green hover:bg-trading-green/90 text-white'
            }`}
          >
            {/* 成数照引擎真正平掉的写：不到 1% 的不四舍五入成 1% / 0%（见 formatClosePercent） */}
            确认平仓 ({formatClosePercent(ratio)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
