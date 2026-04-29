import { useState, useRef, useEffect, useMemo } from 'react';
import type { OrderSide, OrderType, MarginMode } from '@/types/trading';
import { ORDER_TYPE_INFO, getMaxLeverageForNotional, getLeverageTierInfo, MAINTENANCE_MARGIN_RATE, calcUnrealizedPnl } from '@/types/trading';
import { ChevronDown, Check, AlertTriangle, Crosshair, ArrowLeftRight, Calculator, Gauge, Info } from 'lucide-react';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { formatUSDT, formatPrice as fmtPrice } from '@/lib/formatters';

// Re-export for convenience
export type { PlaceOrderParams };

// === Selector types (kept for compatibility) ===
export type PriceSelection = 'MARKET' | 'LIMIT' | 'BEST';
export type TriggerType = 'MARK' | 'LAST';
export type CurrencyUnit = 'BASE' | 'USDT';
export type UsdtInputMode = 'ORDER_VALUE' | 'INITIAL_MARGIN';
export type ActionMode = 'OPEN' | 'CLOSE';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

interface Props {
  currentPrice: number;
  disabled: boolean;
  symbol: string;
  onPlaceOrder: (order: PlaceOrderParams) => void;
  coolingOff?: boolean;
  coolingOffLabel?: string;
  onOpenCoolingOff?: () => void;
  priceProtection?: boolean;
  onTogglePriceProtection?: () => void;
  pricePrecision?: number;
  quantityPrecision?: number;
  crosshairPrice?: number | null;
  pickMode?: boolean;
  onPickModeChange?: (active: boolean) => void;
  pickedPrice?: number | null;
}

// Order types shown in the horizontal tab strip (top 3 + dropdown for the rest)
const PRIMARY_ORDER_TABS: { value: OrderType; label: string }[] = [
  { value: 'LIMIT', label: '限价' },
  { value: 'MARKET', label: '市价' },
  { value: 'LIMIT_TP_SL', label: '限价止盈止损' },
];

export function OrderPanel({
  currentPrice, onPlaceOrder, disabled, symbol,
  coolingOff, coolingOffLabel, onOpenCoolingOff,
  priceProtection, onTogglePriceProtection,
  pricePrecision = 2, quantityPrecision = 3,
  crosshairPrice, pickMode, onPickModeChange, pickedPrice,
}: Props) {
  const baseCoin = symbol.replace('USDT', '') || 'BTC';

  // ===== Live account info pulled from context (for available balance + risk panel) =====
  const ctx = useTradingContext();
  const positions = ctx.positionsMap[symbol] || [];

  let totalMargin = 0;
  let totalMaintenance = 0;
  let totalPnl = 0;
  for (const ps of Object.values(ctx.positionsMap)) {
    for (const p of ps) {
      totalMargin += p.margin;
      totalMaintenance += p.quantity * (ctx.priceMap[symbol] ?? p.entryPrice) * MAINTENANCE_MARGIN_RATE;
      totalPnl += calcUnrealizedPnl(p, ctx.priceMap[symbol] ?? p.entryPrice);
    }
  }
  const equity = ctx.balance + totalPnl;
  const available = ctx.balance - totalMargin;
  const marginRatio = equity > 0 ? (totalMaintenance / equity) * 100 : 0;
  const ratioColor = marginRatio > 80 ? 'text-red-400' : marginRatio > 50 ? 'text-yellow-400' : 'text-emerald-400';
  const ratioBg = marginRatio > 80 ? 'bg-red-400' : marginRatio > 50 ? 'bg-yellow-400' : 'bg-emerald-400';

  // ===== Top-level state =====
  const [actionMode, setActionMode] = useState<ActionMode>('OPEN');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [marginMode, setMarginMode] = useState<MarginMode>('isolated');

  // Symbol-scoped persisted leverage
  const [symbolLeverage, setSymbolLeverage] = usePersistedState<Record<string, number>>('symbol_leverage', {});
  const leverage = symbolLeverage[symbol] ?? 35;
  const setLeverage = (v: number | ((prev: number) => number)) => {
    setSymbolLeverage(prev => {
      const current = prev[symbol] ?? 35;
      const next = typeof v === 'function' ? v(current) : v;
      return { ...prev, [symbol]: Math.floor(Math.max(1, Math.min(125, next))) };
    });
  };

  // ===== Existing selectors / payload state =====
  const [priceSelection, setPriceSelection] = useState<PriceSelection>('LIMIT');
  const [triggerType, setTriggerType] = useState<TriggerType>('LAST');
  const [currencyUnit, setCurrencyUnit] = useState<CurrencyUnit>('USDT');
  const [usdtInputMode, setUsdtInputMode] = useState<UsdtInputMode>('ORDER_VALUE');
  const [tif, setTif] = useState<TimeInForce>('GTC');

  const [showCurrencySelector, setShowCurrencySelector] = useState(false);
  const [showOrderTypeMenu, setShowOrderTypeMenu] = useState(false);
  const [showTifMenu, setShowTifMenu] = useState(false);
  const orderTypeMenuRef = useRef<HTMLDivElement>(null);
  const tifMenuRef = useRef<HTMLDivElement>(null);

  // Inputs
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [percent, setPercent] = useState(0);

  // TP/SL inline checkbox state
  const [enableTpSl, setEnableTpSl] = useState(false);
  const [tpTrigger, setTpTrigger] = useState('');
  const [slTrigger, setSlTrigger] = useState('');

  // Trailing / TWAP / Conditional / Scaled defaults (kept for payload compatibility)
  const [callbackRate] = useState('1');
  const [trailingExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [trailingLimitPrice] = useState('');
  const [twapDuration] = useState('60');
  const [twapInterval] = useState('5');
  const [condExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [condLimitPrice] = useState('');
  const [scaledCount] = useState('5');
  const [scaledStartPrice] = useState('');
  const [scaledEndPrice] = useState('');

  // Sync priceSelection ↔ orderType
  useEffect(() => {
    if (orderType === 'MARKET' || orderType === 'MARKET_TP_SL') setPriceSelection('MARKET');
    else if (orderType === 'LIMIT' || orderType === 'POST_ONLY' || orderType === 'LIMIT_TP_SL') setPriceSelection('LIMIT');
  }, [orderType]);

  // Picked-from-chart price → fill stopPrice
  useEffect(() => {
    if (pickedPrice != null && pickMode) {
      setStopPrice(pickedPrice.toFixed(pricePrecision));
      onPickModeChange?.(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedPrice]);

  // Close popovers on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (orderTypeMenuRef.current && !orderTypeMenuRef.current.contains(e.target as Node)) setShowOrderTypeMenu(false);
      if (tifMenuRef.current && !tifMenuRef.current.contains(e.target as Node)) setShowTifMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ===== Derived values =====
  const inputAmount = parseFloat(quantity) || 0;
  const effectivePrice = priceSelection === 'LIMIT' ? (parseFloat(price) || currentPrice) : currentPrice;

  let effectiveQty = 0;
  let margin = 0;
  if (currencyUnit === 'BASE') {
    effectiveQty = inputAmount;
    margin = (effectiveQty * effectivePrice) / leverage;
  } else if (usdtInputMode === 'ORDER_VALUE') {
    effectiveQty = effectivePrice > 0 ? inputAmount / effectivePrice : 0;
    margin = inputAmount / leverage;
  } else {
    margin = inputAmount;
    effectiveQty = effectivePrice > 0 ? (inputAmount * leverage) / effectivePrice : 0;
  }

  const notionalValue = effectiveQty * effectivePrice;
  const maxAllowedLeverage = getMaxLeverageForNotional(notionalValue);
  const leverageExceeded = leverage > maxAllowedLeverage && notionalValue > 0;
  const tierInfo = getLeverageTierInfo(notionalValue);
  const orderDisabled = disabled || leverageExceeded || !!coolingOff;

  // Max buy/sell capacity in USDT (notional)
  const maxNotional = Math.max(0, available) * leverage;
  const unitLabel = currencyUnit === 'BASE' ? baseCoin : 'USDT';

  // ===== Handlers =====
  const fillBBO = () => {
    if (currentPrice > 0) setPrice(currentPrice.toFixed(pricePrecision));
  };

  const applyPercent = (p: number) => {
    setPercent(p);
    if (currencyUnit === 'USDT') {
      const target = usdtInputMode === 'ORDER_VALUE' ? maxNotional : Math.max(0, available);
      setQuantity((target * (p / 100)).toFixed(2));
    } else {
      const maxBase = effectivePrice > 0 ? maxNotional / effectivePrice : 0;
      setQuantity((maxBase * (p / 100)).toFixed(quantityPrecision));
    }
  };

  const handleOrder = (rawSide: OrderSide) => {
    if (orderDisabled || effectiveQty <= 0) return;
    // CLOSE mode flips intent: closing LONG = SHORT side, closing SHORT = LONG side
    // We delegate actual close to position panel normally — here we just place an opposite order if user is in CLOSE mode.
    const side: OrderSide = rawSide;

    const finalType: OrderType = enableTpSl
      ? (orderType === 'MARKET' ? 'MARKET_TP_SL' : orderType === 'LIMIT' ? 'LIMIT_TP_SL' : orderType)
      : orderType;

    onPlaceOrder({
      side,
      type: finalType,
      price: priceSelection === 'LIMIT' ? (parseFloat(price) || 0) : 0,
      stopPrice: parseFloat(stopPrice) || parseFloat(tpTrigger) || parseFloat(slTrigger) || 0,
      quantity: effectiveQty,
      leverage,
      marginMode,
      priceSelection,
      triggerType,
      currencyUnit,
      usdtInputMode,
      inputAmount,
      callbackRate: parseFloat(callbackRate) / 100 || 0.01,
      trailingExecType,
      trailingLimitPrice: parseFloat(trailingLimitPrice) || 0,
      twapDuration: parseFloat(twapDuration) || 60,
      twapInterval: parseFloat(twapInterval) || 5,
      conditionalExecType: condExecType,
      conditionalLimitPrice: parseFloat(condLimitPrice) || 0,
      scaledCount: parseInt(scaledCount) || 5,
      scaledStartPrice: parseFloat(scaledStartPrice) || 0,
      scaledEndPrice: parseFloat(scaledEndPrice) || 0,
    });
  };

  const isPrimaryTab = PRIMARY_ORDER_TABS.some(t => t.value === orderType);
  const dropdownLabel = isPrimaryTab ? '更多' : (ORDER_TYPE_INFO.find(t => t.value === orderType)?.label ?? '更多');

  const showLimitPriceField = orderType !== 'MARKET' && orderType !== 'MARKET_TP_SL';

  return (
    <div className="flex flex-col h-full bg-[#181a20] text-gray-200 font-sans">
      {/* ============ TOP STATUS BADGES ============ */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2">
        <button
          onClick={() => setMarginMode(m => (m === 'isolated' ? 'cross' : 'isolated'))}
          className="px-2 py-0.5 rounded bg-[#2b3139] hover:bg-[#363c45] text-[11px] text-gray-200 transition-colors"
        >
          {marginMode === 'isolated' ? '逐仓' : '全仓'}
        </button>
        <button
          onClick={() => {
            const next = prompt('设置杠杆 (1-125)', String(leverage));
            if (next) {
              const v = parseInt(next);
              if (!isNaN(v)) setLeverage(v);
            }
          }}
          className="px-2 py-0.5 rounded bg-[#2b3139] hover:bg-[#363c45] text-[11px] text-gray-200 transition-colors"
        >
          {leverage}x
        </button>
        <button
          className="w-6 h-[22px] flex items-center justify-center rounded bg-[#2b3139] hover:bg-[#363c45] text-[11px] text-gray-300 transition-colors"
          title="单币模式"
        >
          S
        </button>

        {onOpenCoolingOff && (
          <button
            onClick={onOpenCoolingOff}
            className="ml-auto text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            🧊 冷静期
          </button>
        )}
      </div>

      {/* ============ OPEN / CLOSE PILL ============ */}
      <div className="px-3 pb-2">
        <div className="flex bg-[#2b3139] rounded-md p-0.5">
          {(['OPEN', 'CLOSE'] as const).map(m => (
            <button
              key={m}
              onClick={() => setActionMode(m)}
              className={`flex-1 py-1 rounded text-[12px] font-medium transition-all ${
                actionMode === m
                  ? 'bg-[#363c45] text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {m === 'OPEN' ? '开仓' : '平仓'}
            </button>
          ))}
        </div>
      </div>

      {/* ============ ORDER TYPE TABS (with active yellow underline) ============ */}
      <div className="px-3 pb-1 flex items-center gap-3 text-[12px] border-b border-[#2b3139]">
        {PRIMARY_ORDER_TABS.map(t => {
          const active = orderType === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setOrderType(t.value)}
              className={`relative pb-1.5 transition-colors ${
                active ? 'text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
              {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-yellow-500 rounded-full" />}
            </button>
          );
        })}
        <div className="relative" ref={orderTypeMenuRef}>
          <button
            onClick={() => setShowOrderTypeMenu(s => !s)}
            className={`relative pb-1.5 flex items-center gap-0.5 transition-colors ${
              !isPrimaryTab ? 'text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {dropdownLabel}
            <ChevronDown className="w-3 h-3" />
            {!isPrimaryTab && <span className="absolute left-0 right-3 -bottom-px h-[2px] bg-yellow-500 rounded-full" />}
          </button>
          {showOrderTypeMenu && (
            <div className="absolute z-40 top-full mt-1 left-0 min-w-[160px] rounded-md border border-[#2b3139] bg-[#1e2329] shadow-xl">
              {ORDER_TYPE_INFO.filter(t => !PRIMARY_ORDER_TABS.some(p => p.value === t.value)).map(t => (
                <button
                  key={t.value}
                  onClick={() => { setOrderType(t.value); setShowOrderTypeMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#2b3139] transition-colors ${
                    orderType === t.value ? 'text-yellow-500' : 'text-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ MAIN BODY ============ */}
      <div className="flex-1 overflow-y-auto px-3 pt-2.5 space-y-2.5">

        {/* Available balance row */}
        <div className="flex items-center justify-between text-[12px]">
          <div className="text-gray-400">
            可用 <span className="text-gray-200 font-mono tabular-nums">{formatUSDT(available)}</span>
            <span className="text-gray-500 ml-1">USDT</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400">
            <button className="hover:text-gray-200 transition-colors" title="资金划转">
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
            <button className="hover:text-gray-200 transition-colors" title="计算器">
              <Calculator className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Limit price input (with BBO button) */}
        {showLimitPriceField && (
          <div className="flex items-stretch gap-1.5">
            <div className="flex-1 flex items-center bg-[#2b3139] rounded-md h-9 px-3">
              <span className="text-[11px] text-gray-500 mr-2">价格</span>
              <input
                type="text"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder={currentPrice > 0 ? currentPrice.toFixed(pricePrecision) : '0.00'}
                className="flex-1 bg-transparent text-right text-[13px] text-gray-100 font-mono tabular-nums outline-none placeholder:text-gray-600"
              />
              <span className="text-[11px] text-gray-500 ml-2">USDT</span>
            </div>
            <button
              onClick={fillBBO}
              className="px-2.5 rounded-md bg-[#2b3139] hover:bg-[#363c45] text-[11px] text-gray-300 font-medium transition-colors"
              title="Best Bid Offer — 填入当前最新价"
            >
              BBO
            </button>
          </div>
        )}

        {/* Market price hint */}
        {!showLimitPriceField && (
          <div className="flex items-center bg-[#2b3139] rounded-md h-9 px-3">
            <span className="text-[11px] text-gray-500 mr-2">价格</span>
            <span className="flex-1 text-right text-[13px] text-gray-400">市价</span>
            <span className="text-[11px] text-gray-500 ml-2">USDT</span>
          </div>
        )}

        {/* Trigger price (TP/SL or conditional types) */}
        {(orderType === 'LIMIT_TP_SL' || orderType === 'MARKET_TP_SL' || orderType === 'CONDITIONAL' || orderType === 'TRAILING_STOP') && (
          <div className="flex items-center bg-[#2b3139] rounded-md h-9 px-3">
            <span className="text-[11px] text-gray-500 mr-2">触发价</span>
            <input
              type="text"
              value={stopPrice}
              onChange={e => setStopPrice(e.target.value)}
              placeholder={pickMode && crosshairPrice != null ? crosshairPrice.toFixed(pricePrecision) : '0.00'}
              className={`flex-1 bg-transparent text-right text-[13px] text-gray-100 font-mono tabular-nums outline-none placeholder:text-gray-600 ${
                pickMode ? 'placeholder:text-yellow-500/70' : ''
              }`}
            />
            <button
              onClick={() => onPickModeChange?.(!pickMode)}
              className={`ml-2 p-0.5 rounded transition-colors ${
                pickMode ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="从图表取价"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-gray-500 ml-2">USDT</span>
          </div>
        )}

        {/* Quantity input with currency unit selector */}
        <div className="flex items-center bg-[#2b3139] rounded-md h-9 px-3">
          <span className="text-[11px] text-gray-500 mr-2">数量</span>
          <input
            type="text"
            value={quantity}
            onChange={e => { setQuantity(e.target.value); setPercent(0); }}
            placeholder="0"
            className="flex-1 bg-transparent text-right text-[13px] text-gray-100 font-mono tabular-nums outline-none placeholder:text-gray-600"
          />
          <button
            onClick={() => setShowCurrencySelector(true)}
            className="ml-2 flex items-center gap-0.5 text-[11px] text-gray-300 hover:text-white"
          >
            {unitLabel} <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        {/* Slider with 5 diamond anchors */}
        <div className="px-1 pt-1 pb-2">
          <div className="relative h-5 flex items-center">
            <input
              type="range" min={0} max={100} step={1}
              value={percent}
              onChange={e => applyPercent(parseInt(e.target.value))}
              className="absolute inset-0 w-full h-5 opacity-0 cursor-pointer z-10"
            />
            {/* Track */}
            <div className="relative h-[3px] w-full rounded-full bg-[#2b3139]">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-yellow-500"
                style={{ width: `${percent}%` }}
              />
              {/* Diamond anchors */}
              {[0, 25, 50, 75, 100].map(p => (
                <div
                  key={p}
                  className={`absolute top-1/2 w-2 h-2 rotate-45 -translate-x-1/2 -translate-y-1/2 ${
                    percent >= p ? 'bg-yellow-500' : 'bg-[#474d57]'
                  }`}
                  style={{ left: `${p}%` }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            {[0, 25, 50, 75, 100].map(p => (
              <button
                key={p}
                onClick={() => applyPercent(p)}
                className={`tabular-nums ${percent === p ? 'text-yellow-500' : 'hover:text-gray-300'}`}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        {/* TP/SL + TIF row */}
        <div className="flex items-center justify-between text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer text-gray-300">
            <input
              type="checkbox"
              checked={enableTpSl}
              onChange={e => setEnableTpSl(e.target.checked)}
              className="w-3 h-3 accent-yellow-500"
            />
            <span>止盈/止损</span>
          </label>

          <div className="relative" ref={tifMenuRef}>
            <button
              onClick={() => setShowTifMenu(s => !s)}
              className="flex items-center gap-0.5 text-gray-300 hover:text-white"
            >
              {tif} <ChevronDown className="w-3 h-3" />
            </button>
            {showTifMenu && (
              <div className="absolute z-40 right-0 top-full mt-1 min-w-[120px] rounded-md border border-[#2b3139] bg-[#1e2329] shadow-xl">
                {(['GTC', 'IOC', 'FOK'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => { setTif(t); setShowTifMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#2b3139] ${
                      tif === t ? 'text-yellow-500' : 'text-gray-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Inline TP/SL trigger fields */}
        {enableTpSl && (
          <div className="space-y-1.5">
            <div className="flex items-center bg-[#2b3139] rounded-md h-8 px-3">
              <span className="text-[11px] text-emerald-400 mr-2">止盈</span>
              <input
                type="text" value={tpTrigger} onChange={e => setTpTrigger(e.target.value)}
                placeholder="触发价"
                className="flex-1 bg-transparent text-right text-[12px] text-gray-100 font-mono outline-none placeholder:text-gray-600"
              />
              <span className="text-[11px] text-gray-500 ml-2">USDT</span>
            </div>
            <div className="flex items-center bg-[#2b3139] rounded-md h-8 px-3">
              <span className="text-[11px] text-red-400 mr-2">止损</span>
              <input
                type="text" value={slTrigger} onChange={e => setSlTrigger(e.target.value)}
                placeholder="触发价"
                className="flex-1 bg-transparent text-right text-[12px] text-gray-100 font-mono outline-none placeholder:text-gray-600"
              />
              <span className="text-[11px] text-gray-500 ml-2">USDT</span>
            </div>
          </div>
        )}

        {/* Tier exceeded warning */}
        {leverageExceeded && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>名义价值超出当前 {leverage}x 杠杆上限（最高 {maxAllowedLeverage}x）</span>
          </div>
        )}

        {/* ===== ACTION BUTTONS + PRE-TRADE INFO ===== */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => handleOrder('LONG')}
            disabled={orderDisabled}
            className="h-10 rounded-md bg-[#0ecb81] hover:bg-[#0bb574] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-all"
          >
            {coolingOff ? '🧊 冷静中' : (actionMode === 'OPEN' ? '开多 / Buy' : '平空 / Buy')}
          </button>
          <button
            onClick={() => handleOrder('SHORT')}
            disabled={orderDisabled}
            className="h-10 rounded-md bg-[#f6465d] hover:bg-[#e23e54] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition-all"
          >
            {coolingOff ? '🧊 冷静中' : (actionMode === 'OPEN' ? '开空 / Sell' : '平多 / Sell')}
          </button>
        </div>

        {/* Pre-trade calculation: left aligned for LONG, right aligned for SHORT */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono tabular-nums">
          <div className="text-left space-y-0.5">
            <div className="text-gray-500">保证金 <span className="text-gray-300">{formatUSDT(margin)}</span> USDT</div>
            <div className="text-gray-500">可开 <span className="text-gray-300">{formatUSDT(maxNotional)}</span> USDT</div>
          </div>
          <div className="text-right space-y-0.5">
            <div className="text-gray-500">保证金 <span className="text-gray-300">{formatUSDT(margin)}</span> USDT</div>
            <div className="text-gray-500">可开 <span className="text-gray-300">{formatUSDT(maxNotional)}</span> USDT</div>
          </div>
        </div>

        {/* Fee tier link */}
        <button className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 transition-colors">
          <Info className="w-3 h-3" />
          手续费等级
          <span className="text-gray-500 ml-0.5">· {tierInfo.tierLabel}</span>
        </button>

        {/* ===== ACCOUNT RISK PANEL ===== */}
        <div className="border-t border-[#2b3139] pt-3 mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-gray-200">账户</span>
            <button className="text-gray-500 hover:text-gray-300" title="切换">
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">保证金比率</span>
            <div className="flex items-center gap-1.5">
              <Gauge className={`w-3.5 h-3.5 ${ratioColor}`} />
              <span className={`font-mono tabular-nums ${ratioColor}`}>{marginRatio.toFixed(2)}%</span>
            </div>
          </div>
          {/* mini gauge bar */}
          <div className="h-1 w-full rounded-full bg-[#2b3139] overflow-hidden">
            <div className={`h-full ${ratioBg} transition-all`} style={{ width: `${Math.min(100, marginRatio)}%` }} />
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">维持保证金</span>
            <span className="font-mono tabular-nums text-gray-200">{formatUSDT(totalMaintenance, 4)} USDT</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">保证金余额</span>
            <span className="font-mono tabular-nums text-gray-200">{formatUSDT(equity, 4)} USDT</span>
          </div>

          <button className="w-full h-9 mt-1 rounded-md bg-[#2b3139] hover:bg-[#363c45] text-[12px] text-gray-200 font-medium transition-colors">
            单币保证金模式
          </button>
        </div>
      </div>

      {/* ===== Currency unit bottom sheet (kept) ===== */}
      {showCurrencySelector && (
        <BottomSheet title="货币单位" onClose={() => setShowCurrencySelector(false)}>
          <button
            onClick={() => { setCurrencyUnit('BASE'); setShowCurrencySelector(false); }}
            className="w-full text-left px-4 py-3 hover:bg-[#2b3139] transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-100 font-medium">{baseCoin}</span>
              {currencyUnit === 'BASE' && <Check className="w-4 h-4 text-yellow-500" />}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">输入并显示以 {baseCoin} 表示的订单金额。</p>
          </button>
          <div className="border-t border-[#2b3139]" />
          <button
            onClick={() => { setCurrencyUnit('USDT'); setShowCurrencySelector(false); }}
            className="w-full text-left px-4 py-3 hover:bg-[#2b3139] transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-100 font-medium">USDT</span>
              {currencyUnit === 'USDT' && <Check className="w-4 h-4 text-yellow-500" />}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              输入并显示以 USDT 表示的订单金额。
            </p>
            {currencyUnit === 'USDT' && (
              <div className="flex gap-3 mt-2 ml-1">
                {([
                  { value: 'ORDER_VALUE' as UsdtInputMode, label: '订单金额' },
                  { value: 'INITIAL_MARGIN' as UsdtInputMode, label: '初始保证金' },
                ]).map(m => (
                  <label key={m.value} className="flex items-center gap-1.5 cursor-pointer">
                    <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                      usdtInputMode === m.value ? 'border-yellow-500' : 'border-gray-500'
                    }`}>
                      {usdtInputMode === m.value && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
                    </span>
                    <span className={`text-xs ${usdtInputMode === m.value ? 'text-gray-100' : 'text-gray-400'}`}>
                      {m.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </button>
        </BottomSheet>
      )}
    </div>
  );
}

// ===== Reusable: Bottom Sheet Overlay =====
function BottomSheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm rounded-t-xl border-t border-[#2b3139] overflow-hidden animate-in slide-in-from-bottom duration-200 bg-[#1e2329]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b3139]">
          <h3 className="text-sm font-medium text-gray-100">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-100 text-xs">✕</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
