import { useState, useEffect, useMemo } from 'react';
import type { PendingOrder, Position, SettlementMode } from '@/types/trading';
import { planLeverageChange } from '@/lib/leverageRestatement';
import { formatTierAmount, maxPositionAtLeverage, resolveSymbolTiers } from '@/lib/leverageTiers';
import { newlyDoomedTriggerOrders, triggerRiskMessage } from '@/lib/positionLimit';
import { formatPrice, formatUSDT } from '@/lib/formatters';
import { getSettlementAsset } from '@/lib/coinMargined';
import { UNLIMITED_MAX_LEVERAGE, isUnlimitedLimitMode, type PositionLimitMode } from '@/lib/positionLimitMode';
import { Slider } from '@/components/ui/slider';
import { Minus, Plus, X } from 'lucide-react';

interface Props {
  symbol: string;
  currentLeverage: number;
  onClose: () => void;
  onConfirm: (leverage: number) => void;
  /**
   * @deprecated 不再读取。分层上限按该标的的持仓与挂单现算（与下单面板同一个判定），
   * 传进来的单一名义会让两边给出不同的答案。
   */
  notional?: number;
  settlementMode?: SettlementMode;
  /** 该标的下的持仓与挂单——用来算下限、立即强平上限，以及确认前的前后对比。 */
  positions?: Position[];
  orders?: PendingOrder[];
  markPrice?: number;
  availableBalance?: number;
  /**
   * 持仓限制模式（下单面板、持仓卡从 TradingContext 取来传进来）。缺省按币安标准——对话框只靠 props 渲染，
   * 不读 context。无限制：滑块 1–150x，有持仓也能降（追加的保证金从可用余额扣），不显示分层上限。
   */
  limitMode?: PositionLimitMode | null;
}

/**
 * 杠杆对话框的上限与「当前杠杆倍数最高可持有头寸」都来自币安按合约的分层
 * （leverageTiers）；是否放行读 planLeverageChange 的判定，它与下单面板、引擎下单
 * 共用 positionLimit，三处不可能给出两个答案。无限制模式下上限是 150x、没有分层上限（lib/positionLimitMode）。
 */
export function LeverageModal({
  symbol,
  currentLeverage,
  onClose,
  onConfirm,
  settlementMode = 'usdt',
  positions = [],
  orders = [],
  markPrice = 0,
  availableBalance = 0,
  limitMode,
}: Props) {
  const unlimited = isUnlimitedLimitMode(limitMode);
  const tiers = resolveSymbolTiers(symbol, settlementMode);
  /** 滑块上限 = 这个合约第 1 档的最高杠杆（KAITOUSDT 75x、BTCUSDT 150x、BTCUSD 125x）；无限制模式一律 150x。 */
  const maxLev = unlimited ? UNLIMITED_MAX_LEVERAGE : tiers.maxLeverage;
  const initialLeverage = Math.max(1, Math.min(maxLev, Math.round(currentLeverage) || 1));
  const [leverage, setLeverage] = useState(initialLeverage);
  const [inputValue, setInputValue] = useState(String(initialLeverage));
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

  /**
   * 旧版本允许到 125x：一笔 125x 的旧仓位放在只到 75x 的合约上时，下限会高过上限。
   * 滑块只能停在上限，确认被 below-floor 拒绝——逐仓有持仓不能降杠杆，与币安一致。
   * 无限制模式没有这个下限：有持仓也能降，追加的保证金从可用余额扣（补不上由 planLeverageChange 拒绝）。
   */
  const sliderMin = unlimited ? 1 : Math.min(minLev, maxLev);

  const plan = useMemo(() => planLeverageChange({
    symbol, positions: held, orders, markPrice,
    currentLeverage, nextLeverage: leverage, settlementMode,
    limitMode, availableBalance,
  }), [symbol, held, orders, markPrice, currentLeverage, leverage, settlementMode, limitMode, availableBalance]);
  /** 滑块当前值下最多能持有的头寸（档位单位）。 */
  const capAtLeverage = maxPositionAtLeverage(tiers.tiers, leverage);
  /**
   * 已挂的触发类开仓单会被一并重述到新杠杆、触发时按新杠杆的上限判——币安改杠杆时不拦，触发时才拒。
   * 这里不拦确认，只在确认之前说清楚：调到这个杠杆后，哪张单到时会被撤销。
   */
  const triggerRisk = useMemo(() => (plan.ok && !unlimited
    ? triggerRiskMessage(newlyDoomedTriggerOrders({ symbol, positions: held, orders, leverage: plan.to, markPrice }), `杠杆调到 ${plan.to}x 后`)
    : null), [plan, unlimited, symbol, held, orders, markPrice]);
  const exposure = plan.tierExposure;

  // Keep input in sync with slider/buttons
  useEffect(() => { setInputValue(String(leverage)); }, [leverage]);

  const clamp = (v: number) => Math.floor(Math.max(sliderMin, Math.min(maxLev, v)));

  const handleInputChange = (val: string) => {
    setInputValue(val);
    const v = parseInt(val);
    if (!isNaN(v) && v >= sliderMin && v <= maxLev) {
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
                data-testid="leverage-input"
                min={sliderMin}
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
            min={sliderMin}
            max={maxLev}
            step={1}
            onValueChange={([v]) => setLeverage(v)}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span data-testid="leverage-min-label">{sliderMin}x</span>
            <span data-testid="leverage-max-label">{maxLev}x</span>
          </div>

          {/* 币安同位文案：滑块停在哪，就报那个杠杆下最多能持有多少（按合约分层、按合约的单位）。
              无限制模式没有分层上限：换成一行说明。 */}
          {unlimited ? (
            <div
              data-testid="leverage-unlimited-note"
              className="rounded-lg bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground"
            >
              无限制模式：任何币种 1–{UNLIMITED_MAX_LEVERAGE}x，不设持仓上限
            </div>
          ) : (
          <div className="rounded-lg bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
            <div data-testid="leverage-max-position" className="flex justify-between gap-2">
              <span>当前杠杆倍数最高可持有头寸：</span>
              <span className="font-mono text-foreground">{formatTierAmount(capAtLeverage, tiers.unit)}</span>
            </div>
            {exposure > 0 && (
              <div data-testid="leverage-exposure" className="flex justify-between gap-2">
                <span>持仓和当前委托价值</span>
                <span className="font-mono">
                  {formatTierAmount(exposure, plan.tierUnit)}
                  {Number.isFinite(plan.tierMaxLeverage) && (plan.tierMaxLeverage > 0
                    ? ` · 最高 ${plan.tierMaxLeverage}x`
                    : ' · 超过该合约最大可持有头寸')}
                </span>
              </div>
            )}
            {tiers.note && (
              <div data-testid="leverage-tier-note" className="text-[9px] leading-4 text-amber-500/90">{tiers.note}</div>
            )}
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
                    +{formatUSDT(plan.totalReleaseUsd)} → 可用 {formatUSDT(availableBalance + plan.totalReleaseUsd)} {quoteUnitLabel}
                  </span>
                </div>
              )}
              {/* 无限制模式下降杠杆：追加保证金，从可用余额扣。补不上时不投影一个负的「可用」，照实写可用多少、不足 */}
              {plan.totalReleaseUsd < -1e-9 && (
                <div data-testid="leverage-margin-topup" className="flex items-center justify-between gap-2 border-t border-border/60 pt-1">
                  <span className="text-muted-foreground">追加保证金</span>
                  {plan.refusal?.code === 'insufficient-balance' ? (
                    <span className="text-trading-red">
                      −{formatUSDT(-plan.totalReleaseUsd)} {quoteUnitLabel} · 可用只有 {formatUSDT(Math.max(0, availableBalance))} {quoteUnitLabel}（不足）
                    </span>
                  ) : (
                    <span className={plan.ok ? 'text-foreground' : 'text-trading-red'}>
                      −{formatUSDT(-plan.totalReleaseUsd)} → 可用 {formatUSDT(Math.max(0, availableBalance + plan.totalReleaseUsd))} {quoteUnitLabel}
                    </span>
                  )}
                </div>
              )}
              <div className="text-[9px] leading-4 text-muted-foreground/80 pt-0.5">
                {unlimited
                  ? '无限制模式：有持仓时也能降杠杆，降杠杆要从可用余额追加保证金'
                  : `逐仓有持仓时只能提高杠杆（当前下限 ${minLev}x）`}
                <br />ROE% 的分母是「名义 ÷ 杠杆」，提杠杆后同一笔盈亏的 ROE 会同比放大。
              </div>
            </div>
          )}

          {/* Warning for unified leverage */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10px] text-amber-400">
            ⚠️ 杠杆倍数将同时应用于 {baseCoin}/{quoteUnitLabel} 的多单和空单
            {orders.some(o => !o.reduceOnly) && <><br />杠杆调整将同时影响当前仓位和挂单的杠杆</>}
          </div>

          {triggerRisk && (
            <div data-testid="leverage-trigger-risk" className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[10px] text-amber-500 space-y-0.5">
              <div>{triggerRisk.title}</div>
              <div className="text-[9px] opacity-80">{triggerRisk.description}</div>
            </div>
          )}

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
