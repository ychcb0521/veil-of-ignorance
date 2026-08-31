import { useState, useEffect, useMemo } from 'react';
import { getMaxLeverageForNotional, getLeverageTierInfo, type PendingOrder, type Position, type SettlementMode } from '@/types/trading';
import { maxNotionalForLeverage, planLeverageChange } from '@/lib/leverageRestatement';
import { formatPrice, formatUSDT } from '@/lib/formatters';
import { getSettlementAsset } from '@/lib/coinMargined';
import { Slider } from '@/components/ui/slider';
import { Minus, Plus, X } from 'lucide-react';

interface Props {
  symbol: string;
  currentLeverage: number;
  onClose: () => void;
  onConfirm: (leverage: number) => void;
  /** Optional notional for tier display */
  notional?: number;
  settlementMode?: SettlementMode;
  /** 该标的下的持仓与挂单——用来算下限、立即强平上限，以及确认前的前后对比。 */
  positions?: Position[];
  orders?: PendingOrder[];
  markPrice?: number;
  availableBalance?: number;
}

const MAX_LEVERAGE = 125;

export function LeverageModal({
  symbol,
  currentLeverage,
  onClose,
  onConfirm,
  notional = 0,
  settlementMode = 'usdt',
  positions = [],
  orders = [],
  markPrice = 0,
  availableBalance = 0,
}: Props) {
  const maxLev = notional > 0 ? getMaxLeverageForNotional(notional) : MAX_LEVERAGE;
  const [leverage, setLeverage] = useState(currentLeverage);
  const [inputValue, setInputValue] = useState(String(currentLeverage));
  const tierInfo = notional > 0 ? getLeverageTierInfo(notional) : null;
  const baseCoin = getSettlementAsset(symbol);
  const quoteUnitLabel = settlementMode === 'coin' ? 'USD' : 'USDT';

  /**
   * 有持仓时**只能升不能降**（与币安一致）。降杠杆要倒扣余额，而在下单面板拖一下滑块
   * 就该扣钱是不能接受的；更要命的是扣款可能失败，一旦失败 leverageMap 与
   * position.leverage 就分叉，而合并键把杠杆算在内——下一笔成交会另开一张卡。
   * 所以下限直接卡在滑块上，而不是等用户点了确认再弹一个提示。
   */
  const held = positions.filter(p => p && (p.quantity > 0 || (p.contracts ?? 0) > 0));
  const minLev = held.length > 0
    ? Math.max(1, ...held.map(p => Math.max(1, p.leverage || 1)))
    : 1;

  const plan = useMemo(() => planLeverageChange({
    symbol, positions: held, orders, markPrice,
    currentLeverage, nextLeverage: leverage,
  }), [symbol, held, orders, markPrice, currentLeverage, leverage]);

  // Keep input in sync with slider/buttons
  useEffect(() => { setInputValue(String(leverage)); }, [leverage]);

  const clamp = (v: number) => Math.floor(Math.max(minLev, Math.min(maxLev, v)));

  const handleInputChange = (val: string) => {
    setInputValue(val);
    const v = parseInt(val);
    if (!isNaN(v) && v >= minLev && v <= maxLev) {
      setLeverage(Math.floor(v));
    }
  };

  const handleInputBlur = () => {
    const v = parseInt(inputValue);
    const clamped = clamp(isNaN(v) ? 1 : v);
    setLeverage(clamped);
    setInputValue(String(clamped));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[340px] rounded-xl bg-card border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-bold text-foreground">调整杠杆</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-5">
          {/* Symbol info */}
          <div className="text-xs text-muted-foreground text-center">
            {baseCoin}/{quoteUnitLabel} 永续 · 当前 {currentLeverage}x
          </div>

          {/* Leverage display with +/- and direct input */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setLeverage(v => clamp(v - 1))}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-accent active:scale-95 transition-all"
            >
              <Minus className="w-4 h-4 text-foreground" />
            </button>
            <div className="relative w-24">
              <input
                type="number"
                min={minLev}
                max={maxLev}
                value={inputValue}
                onChange={e => handleInputChange(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                className="w-full text-center text-2xl font-bold font-mono text-foreground tabular-nums bg-transparent border border-border rounded-lg px-1 py-0.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground pointer-events-none">x</span>
            </div>
            <button
              onClick={() => setLeverage(v => clamp(v + 1))}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-accent active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4 text-foreground" />
            </button>
          </div>

          {/* Slider */}
          <Slider
            value={[leverage]}
            min={minLev}
            max={maxLev}
            step={1}
            onValueChange={([v]) => setLeverage(v)}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>1x</span>
            <span>{maxLev}x</span>
          </div>

          {/* Tier info */}
          {tierInfo && (
            <div className="rounded-lg bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>名义价值</span>
                <span className="font-mono">{notional.toFixed(2)} {quoteUnitLabel}</span>
              </div>
              <div className="flex justify-between">
                <span>最大杠杆</span>
                <span className="font-mono">{tierInfo.maxLeverage}x ({tierInfo.tierLabel})</span>
              </div>
            </div>
          )}

          {/* 确认前必须看得见后果:保证金、强平价、释放额,以及被拒的原因 */}
          {held.length > 0 && (
            <div data-testid="leverage-preview" className="rounded-lg border border-border bg-secondary/40 px-3 py-2 space-y-1 text-[10px] font-mono tabular-nums">
              {plan.legs.map(leg => (
                <div key={leg.positionId} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{leg.side === 'LONG' ? '多' : '空'} 保证金</span>
                  <span className="text-foreground">
                    {formatUSDT(leg.marginBefore)} → {formatUSDT(leg.marginAfter)}
                  </span>
                </div>
              ))}
              {plan.legs.map(leg => (
                <div key={`${leg.positionId}-liq`} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">强平价</span>
                  <span className="text-trading-red">
                    {leg.liqBefore != null ? formatPrice(leg.liqBefore, symbol) : '--'}
                    {' → '}
                    {leg.liqAfter != null ? formatPrice(leg.liqAfter, symbol) : '--'}
                  </span>
                </div>
              ))}
              {plan.ok && plan.totalReleaseUsd > 1e-9 && (
                <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1">
                  <span className="text-muted-foreground">释放保证金</span>
                  <span className="text-trading-green">
                    +{formatUSDT(plan.totalReleaseUsd)} → 可用 {formatUSDT(availableBalance + plan.totalReleaseUsd)}
                  </span>
                </div>
              )}
              <div className="text-[9px] leading-4 text-muted-foreground/80 pt-0.5">
                当前杠杆倍数最高可开 {maxNotionalForLeverage(leverage).toLocaleString('en-US')} USDT
                {held.length > 0 && ` · 逐仓有持仓时只能提高杠杆（当前下限 ${minLev}x）`}
                <br />ROE% 的分母是「名义 ÷ 杠杆」，提杠杆后同一笔盈亏的 ROE 会同比放大。
              </div>
            </div>
          )}

          {/* Warning for unified leverage */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10px] text-amber-400">
            ⚠️ 杠杆倍数将同时应用于 {baseCoin}/{quoteUnitLabel} 的多单和空单
            {orders.some(o => !o.reduceOnly) && <><br />杠杆调整将同时影响当前仓位和挂单的杠杆</>}
          </div>

          {!plan.ok && plan.refusal && plan.refusal.code !== 'no-change' && (
            <div data-testid="leverage-refusal" className="rounded-lg bg-trading-red/10 border border-trading-red/30 px-3 py-2 text-[10px] text-trading-red">
              {plan.refusal.message}
            </div>
          )}

          {/* Confirm button */}
          <button
            data-testid="leverage-confirm"
            disabled={!plan.ok && plan.refusal?.code !== 'no-change'}
            onClick={() => onConfirm(leverage)}
            className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
              !plan.ok && plan.refusal?.code !== 'no-change'
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.98]'
            }`}
          >
            确认 — {leverage}x
          </button>
        </div>
      </div>
    </div>
  );
}
