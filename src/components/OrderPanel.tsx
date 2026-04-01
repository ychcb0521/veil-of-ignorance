import { useState, useRef, useEffect, useMemo } from 'react';
import type { OrderSide, OrderType, MarginMode } from '@/types/trading';
import { ORDER_TYPE_INFO, getMaxLeverageForNotional, getLeverageTierInfo } from '@/types/trading';
import { ChevronDown, Check, Info, AlertTriangle } from 'lucide-react';
import type { PlaceOrderParams } from '@/contexts/TradingContext';

// Re-export for convenience
export type { PlaceOrderParams };

// === New selector types ===
export type PriceSelection = 'MARKET' | 'LIMIT' | 'BEST';
export type TriggerType = 'MARK' | 'LAST';
export type CurrencyUnit = 'BASE' | 'USDT';
export type UsdtInputMode = 'ORDER_VALUE' | 'INITIAL_MARGIN';



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
  /** Crosshair Y-axis price from chart for conditional trigger price sync */
  crosshairPrice?: number | null;
}

export function OrderPanel({ currentPrice, onPlaceOrder, disabled, symbol, coolingOff, coolingOffLabel, onOpenCoolingOff, priceProtection, onTogglePriceProtection, pricePrecision = 2, quantityPrecision = 3, crosshairPrice }: Props) {
  const baseCoin = symbol.replace('USDT', '') || 'BTC';

  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [marginMode, setMarginMode] = useState<MarginMode>('cross');
  const [leverage, setLeverage] = useState(20);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // === Three new selectors ===
  const [priceSelection, setPriceSelection] = useState<PriceSelection>('MARKET');
  const [triggerType, setTriggerType] = useState<TriggerType>('LAST');
  const [currencyUnit, setCurrencyUnit] = useState<CurrencyUnit>('USDT');
  const [usdtInputMode, setUsdtInputMode] = useState<UsdtInputMode>('ORDER_VALUE');

  // Selector visibility
  const [showPriceSelector, setShowPriceSelector] = useState(false);
  const [showTriggerSelector, setShowTriggerSelector] = useState(false);
  const [showCurrencySelector, setShowCurrencySelector] = useState(false);

  // Shared fields
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [quantity, setQuantity] = useState('0.01');

  // Trailing stop fields
  const [callbackRate, setCallbackRate] = useState('1');
  const [trailingExecType, setTrailingExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [trailingLimitPrice, setTrailingLimitPrice] = useState('');

  // TWAP fields
  const [twapDuration, setTwapDuration] = useState('60');
  const [twapInterval, setTwapInterval] = useState('5');

  // Conditional fields
  const [condExecType, setCondExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [condLimitPrice, setCondLimitPrice] = useState('');

  // Scaled fields
  const [scaledCount, setScaledCount] = useState('5');
  const [scaledStartPrice, setScaledStartPrice] = useState('');
  const [scaledEndPrice, setScaledEndPrice] = useState('');

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Sync priceSelection with orderType
  useEffect(() => {
    if (['MARKET', 'MARKET_TP_SL'].includes(orderType)) {
      setPriceSelection('MARKET');
    } else if (['LIMIT', 'POST_ONLY', 'LIMIT_TP_SL'].includes(orderType)) {
      setPriceSelection('LIMIT');
    }
  }, [orderType]);

  const inputAmount = parseFloat(quantity) || 0;

  // Calculate effective quantity and margin based on currency unit and input mode
  const effectivePrice = priceSelection === 'LIMIT' ? (parseFloat(price) || currentPrice) : currentPrice;

  let effectiveQty: number;
  let margin: number;

  if (currencyUnit === 'BASE') {
    // Input is in base coin (e.g. BTC)
    effectiveQty = inputAmount;
    margin = (effectiveQty * effectivePrice) / leverage;
  } else {
    // Input is in USDT
    if (usdtInputMode === 'ORDER_VALUE') {
      // USDT amount = order value
      effectiveQty = effectivePrice > 0 ? inputAmount / effectivePrice : 0;
      margin = inputAmount / leverage;
    } else {
      // USDT amount = initial margin (user specifies collateral directly)
      margin = inputAmount;
      effectiveQty = effectivePrice > 0 ? (inputAmount * leverage) / effectivePrice : 0;
    }
  }

  const fee = effectivePrice * effectiveQty * 0.0004;
  const notionalValue = effectiveQty * effectivePrice;

  // Tiered leverage validation
  const maxAllowedLeverage = getMaxLeverageForNotional(notionalValue);
  const leverageExceeded = leverage > maxAllowedLeverage && notionalValue > 0;
  const tierInfo = getLeverageTierInfo(notionalValue);

  const orderDisabled = disabled || leverageExceeded || !!coolingOff;

  const handleOrder = (side: OrderSide) => {
    if (orderDisabled || effectiveQty <= 0) return;
    onPlaceOrder({
      side,
      type: orderType,
      price: priceSelection === 'LIMIT' ? (parseFloat(price) || 0) : 0,
      stopPrice: parseFloat(stopPrice) || 0,
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

  const selectedInfo = ORDER_TYPE_INFO.find(t => t.value === orderType)!;

  const needsTrigger = ['LIMIT_TP_SL', 'MARKET_TP_SL', 'CONDITIONAL', 'TRAILING_STOP'].includes(orderType);
  const needsLimitPrice = ['LIMIT', 'POST_ONLY', 'LIMIT_TP_SL', 'CONDITIONAL', 'SCALED'].includes(orderType)
    || (orderType === 'TRAILING_STOP' && trailingExecType === 'LIMIT')
    || (orderType === 'CONDITIONAL' && condExecType === 'LIMIT');

  const unitLabel = currencyUnit === 'BASE' ? baseCoin : 'USDT';

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Margin Mode + Leverage Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2.5">
        <div className="flex gap-1">
          {(['cross', 'isolated'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMarginMode(m)}
              className={`flex-1 py-1 rounded text-xs font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
                marginMode === m
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'cross' ? '全仓' : '逐仓'}
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">杠杆</span>
            <span className="font-mono text-xs font-bold text-primary">{leverage}x</span>
          </div>
          <input
            type="range" min={1} max={125} value={leverage}
            onChange={e => setLeverage(parseInt(e.target.value))}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, hsl(var(--primary)) ${(leverage / 125) * 100}%, hsl(var(--secondary)) ${(leverage / 125) * 100}%)`,
            }}
          />
          <div className="flex justify-between mt-1">
            {[1, 25, 50, 75, 100, 125].map(v => (
              <button
                key={v} onClick={() => setLeverage(v)}
                className={`text-[10px] font-mono px-1 rounded transition-all duration-75 ease-out active:scale-[0.95] ${
                  leverage === v ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>

        {/* Price Protection + Cooling Off toggles */}
        <div className="flex items-center justify-between text-[10px] pt-1">
          {onTogglePriceProtection && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={priceProtection ?? true} onChange={() => onTogglePriceProtection()}
                className="w-3 h-3 rounded accent-primary" />
              <span className="text-muted-foreground">价格保护</span>
            </label>
          )}
          {onOpenCoolingOff && (
            <button onClick={onOpenCoolingOff}
              className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors font-medium">
              🧊 冷静期
            </button>
          )}
        </div>
      </div>

      {/* Order Type Dropdown */}
      <div className="px-3 pt-2 pb-1 relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium bg-accent text-foreground hover:bg-accent/80 transition-all duration-100 ease-out active:scale-[0.98]"
        >
          <span>{selectedInfo.label} <span className="text-muted-foreground ml-1">{selectedInfo.desc}</span></span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <div className="absolute left-3 right-3 top-full z-50 mt-0.5 rounded border border-border bg-card shadow-xl max-h-[300px] overflow-y-auto">
            {ORDER_TYPE_INFO.map(t => (
              <button
                key={t.value}
                onClick={() => { setOrderType(t.value); setDropdownOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors duration-100 ease-out flex items-center justify-between ${
                  orderType === t.value ? 'bg-accent/30 text-primary' : 'text-foreground'
                }`}
              >
                <span className="font-medium">{t.label}</span>
                <span className="text-muted-foreground text-[10px]">{t.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ===== THREE BINANCE-STYLE SELECTORS ===== */}
      <div className="px-3 py-1 space-y-1">
        {/* --- Trigger Type Selector (for conditional/TP-SL orders) --- */}
        {needsTrigger && (
          <SelectorRow
            label="触发价"
            value={triggerType === 'MARK' ? '标记价格' : '最新价格'}
            onClick={() => setShowTriggerSelector(true)}
          />
        )}

        {/* --- Currency Unit Selector --- */}
        <SelectorRow
          label="货币单位"
          value={currencyUnit === 'BASE' ? baseCoin : 'USDT'}
          onClick={() => setShowCurrencySelector(true)}
        />
      </div>

      {/* Order Inputs */}
      <div className="px-3 space-y-2 flex-1 overflow-y-auto pb-2">

        {/* === Trigger / Stop Price === */}
        {needsTrigger && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">触发价 (USDT)</label>
              <span className="text-[10px] text-muted-foreground">{triggerType === 'MARK' ? '标记' : '最新'}</span>
            </div>
            <div className="relative">
              <input type="text" value={stopPrice} onChange={e => setStopPrice(e.target.value)}
                placeholder="触发价格"
                className="input-dark w-full text-right pr-14 text-xs" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">USDT</span>
            </div>
          </div>
        )}

        {/* === Price input area with price type selector === */}
        {needsLimitPrice && orderType !== 'SCALED' && orderType !== 'CONDITIONAL' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">价格 (USDT)</label>
              <button
                onClick={() => setShowPriceSelector(true)}
                className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
              >
                {priceSelection === 'MARKET' ? '市价' : priceSelection === 'BEST' ? '最优价' : '限价'}
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="relative">
              <input type="text" value={price} onChange={e => setPrice(e.target.value)}
                placeholder={currentPrice.toFixed(pricePrecision)}
                className="input-dark w-full text-right pr-14 text-xs" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">USDT</span>
            </div>
          </div>
        )}

        {/* === Market price display === */}
        {(orderType === 'MARKET' || orderType === 'MARKET_TP_SL') && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">价格</label>
              <button
                onClick={() => setShowPriceSelector(true)}
                className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
              >
                {priceSelection === 'BEST' ? '最优价' : '市价'}
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="input-dark w-full text-right text-xs flex items-center justify-end">
              <span className="text-muted-foreground">{priceSelection === 'BEST' ? '最优价' : '市价'}</span>
            </div>
          </div>
        )}

        {/* === Post Only note === */}
        {orderType === 'POST_ONLY' && (
          <div className="text-[10px] text-primary/70 px-1">
            ⚠ 如果会立即成交则自动撤回
          </div>
        )}

        {/* === Trailing Stop specific === */}
        {orderType === 'TRAILING_STOP' && (
          <>
            <InputField label="回调幅度 (%)" value={callbackRate} onChange={setCallbackRate} placeholder="1.0" suffix="%" />
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">触发后执行</label>
              <div className="flex gap-1">
                {(['MARKET', 'LIMIT'] as const).map(t => (
                  <button key={t} onClick={() => setTrailingExecType(t)}
                    className={`flex-1 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
                      trailingExecType === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t === 'MARKET' ? '市价' : '限价'}
                  </button>
                ))}
              </div>
            </div>
            {trailingExecType === 'LIMIT' && (
              <InputField label="限价 (USDT)" value={trailingLimitPrice} onChange={setTrailingLimitPrice} placeholder={currentPrice.toFixed(pricePrecision)} />
            )}
          </>
        )}

        {/* === Conditional Order === */}
        {orderType === 'CONDITIONAL' && (
          <>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">触发后执行</label>
              <div className="flex gap-1">
                {(['MARKET', 'LIMIT'] as const).map(t => (
                  <button key={t} onClick={() => setCondExecType(t)}
                    className={`flex-1 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
                      condExecType === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t === 'MARKET' ? '市价' : '限价'}
                  </button>
                ))}
              </div>
            </div>
            {condExecType === 'LIMIT' && (
              <InputField label="限价 (USDT)" value={condLimitPrice} onChange={setCondLimitPrice} placeholder={currentPrice.toFixed(pricePrecision)} />
            )}
          </>
        )}

        {/* === TWAP === */}
        {orderType === 'TWAP' && (
          <>
            <InputField label="总时长 (分钟)" value={twapDuration} onChange={setTwapDuration} placeholder="60" suffix="min" />
            <InputField label="下单间隔 (分钟)" value={twapInterval} onChange={setTwapInterval} placeholder="5" suffix="min" />
            <div className="text-[10px] text-muted-foreground px-1">
              将拆分为 {Math.max(1, Math.floor((parseFloat(twapDuration) || 60) / (parseFloat(twapInterval) || 5)))} 笔子订单，
              每笔 {(effectiveQty / Math.max(1, Math.floor((parseFloat(twapDuration) || 60) / (parseFloat(twapInterval) || 5)))).toFixed(4)}
            </div>
          </>
        )}

        {/* === Scaled Order === */}
        {orderType === 'SCALED' && (
          <>
            <InputField label="子订单数" value={scaledCount} onChange={setScaledCount} placeholder="5" />
            <InputField label="起始价 (USDT)" value={scaledStartPrice} onChange={setScaledStartPrice} placeholder={currentPrice.toFixed(pricePrecision)} />
            <InputField label="终点价 (USDT)" value={scaledEndPrice} onChange={setScaledEndPrice} placeholder={currentPrice.toFixed(pricePrecision)} />
            <div className="text-[10px] text-muted-foreground px-1">
              {(() => {
                const count = parseInt(scaledCount) || 5;
                const sp = parseFloat(scaledStartPrice) || 0;
                const ep = parseFloat(scaledEndPrice) || 0;
                const step = count > 1 ? (ep - sp) / (count - 1) : 0;
                return `${count} 笔限价单，步长 ${step.toFixed(pricePrecision)}，每笔 ${(effectiveQty / count).toFixed(quantityPrecision)}`;
              })()}
            </div>
          </>
        )}

        {/* === Quantity with currency unit === */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {orderType === 'TWAP' ? '总数量' : '数量'} ({unitLabel})
            </label>
            {currencyUnit === 'USDT' && (
              <div className="flex gap-1">
                {([
                  { value: 'ORDER_VALUE' as UsdtInputMode, label: '订单金额' },
                  { value: 'INITIAL_MARGIN' as UsdtInputMode, label: '初始保证金' },
                ] as const).map(m => (
                  <button key={m.value} onClick={() => setUsdtInputMode(m.value)}
                    className={`text-[9px] px-1.5 py-0.5 rounded transition-all duration-100 ease-out active:scale-[0.95] ${
                      usdtInputMode === m.value
                        ? 'bg-primary/20 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <input type="text" value={quantity} onChange={e => setQuantity(e.target.value)}
              className="input-dark w-full text-right pr-14 text-xs"
              placeholder={currencyUnit === 'BASE' ? '0.01' : '100'} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{unitLabel}</span>
          </div>
          <div className="flex gap-1 mt-1.5">
            {[25, 50, 75, 100].map(pct => (
              <button key={pct}
                className="flex-1 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground hover:bg-accent transition-all duration-100 ease-out active:scale-[0.95]"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Computed display */}
        {currencyUnit === 'USDT' && effectiveQty > 0 && (
          <div className="text-[10px] text-muted-foreground px-1">
            ≈ {effectiveQty.toFixed(quantityPrecision)} {baseCoin}
            {usdtInputMode === 'INITIAL_MARGIN' && (
              <span className="ml-2">（仓位价值 ≈ {(effectiveQty * effectivePrice).toFixed(2)} USDT）</span>
            )}
          </div>
        )}
        {currencyUnit === 'BASE' && effectiveQty > 0 && (
          <div className="text-[10px] text-muted-foreground px-1">
            ≈ {(effectiveQty * effectivePrice).toFixed(2)} USDT
          </div>
        )}

        {/* Order Summary */}
        <div className="space-y-1 py-2 border-t border-border text-[11px] font-mono">
          <div className="flex justify-between text-muted-foreground">
            <span>保证金</span>
            <span className="text-foreground">{margin.toFixed(2)} USDT</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>手续费</span>
            <span className="text-foreground">{fee.toFixed(4)} USDT</span>
          </div>
        </div>

        {/* Leverage warning */}
        {leverageExceeded && notionalValue > 0 && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] bg-destructive/10 text-destructive border border-destructive/20">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>名义价值 {notionalValue.toFixed(0)} USDT 超出当前 {leverage}x 杠杆上限（最高 {maxAllowedLeverage}x），请降低杠杆或减小仓位</span>
          </div>
        )}

        {/* Tier info */}
        {notionalValue > 0 && (
          <div className="text-[9px] text-muted-foreground px-1">
            当前层级: {tierInfo.tierLabel} · 最高 {tierInfo.maxLeverage}x
          </div>
        )}

        {/* Cooling off countdown */}
        {coolingOff && coolingOffLabel && (
          <div className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
            🧊 冷静期中: {coolingOffLabel}
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pb-3">
          <button onClick={() => handleOrder('LONG')} disabled={orderDisabled}
            className="btn-long disabled:opacity-30 disabled:cursor-not-allowed text-xs py-2.5">
            <div>{coolingOff ? '🧊 冷静中' : '开多 / Buy'}</div>
            {!coolingOff && (orderType === 'MARKET' || priceSelection === 'MARKET') && currentPrice > 0 && (
              <div className="text-[10px] opacity-80 mt-0.5">{currentPrice.toFixed(pricePrecision)}</div>
            )}
          </button>
          <button onClick={() => handleOrder('SHORT')} disabled={orderDisabled}
            className="btn-short disabled:opacity-30 disabled:cursor-not-allowed text-xs py-2.5">
            <div>{coolingOff ? '🧊 冷静中' : '开空 / Sell'}</div>
            {!coolingOff && (orderType === 'MARKET' || priceSelection === 'MARKET') && currentPrice > 0 && (
              <div className="text-[10px] opacity-80 mt-0.5">{currentPrice.toFixed(pricePrecision)}</div>
            )}
          </button>
        </div>
      </div>

      {/* ===== BOTTOM SHEET: Price Type Selector (image_1) ===== */}
      {showPriceSelector && (
        <BottomSheet title="市价" onClose={() => setShowPriceSelector(false)}>
          {([
            { value: 'MARKET' as PriceSelection, label: '市价', desc: '' },
            { value: 'LIMIT' as PriceSelection, label: '限价', desc: '' },
            { value: 'BEST' as PriceSelection, label: '最优价', desc: '' },
          ]).map(item => (
            <button key={item.value}
              onClick={() => { setPriceSelection(item.value); setShowPriceSelector(false); }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors duration-100 ease-out"
            >
              <span className="text-sm text-foreground">{item.label}</span>
              {priceSelection === item.value && <Check className="w-4 h-4 text-primary" />}
            </button>
          ))}
        </BottomSheet>
      )}

      {/* ===== BOTTOM SHEET: Trigger Type Selector (image_2) ===== */}
      {showTriggerSelector && (
        <BottomSheet title="选择触发类型" onClose={() => setShowTriggerSelector(false)}>
          <button
            onClick={() => { setTriggerType('MARK'); setShowTriggerSelector(false); }}
            className="w-full text-left px-4 py-3 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground font-medium">标记价格</span>
              {triggerType === 'MARK' && <Check className="w-4 h-4 text-primary" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              标记价格为合约的预估公允价值，用于强制平仓计算。
            </p>
          </button>
          <div className="border-t border-border" />
          <button
            onClick={() => { setTriggerType('LAST'); setShowTriggerSelector(false); }}
            className="w-full text-left px-4 py-3 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground font-medium">最新价格</span>
              {triggerType === 'LAST' && <Check className="w-4 h-4 text-primary" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              最新价格为该合约的最新成交价格
            </p>
          </button>
        </BottomSheet>
      )}

      {/* ===== BOTTOM SHEET: Currency Unit Selector (image_3) ===== */}
      {showCurrencySelector && (
        <BottomSheet title="货币单位" onClose={() => setShowCurrencySelector(false)}>
          <button
            onClick={() => { setCurrencyUnit('BASE'); setShowCurrencySelector(false); }}
            className="w-full text-left px-4 py-3 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground font-medium">{baseCoin}</span>
              {currencyUnit === 'BASE' && <Check className="w-4 h-4 text-primary" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              输入并显示以 {baseCoin} 表示的订单金额。
            </p>
          </button>
          <div className="border-t border-border" />
          <button
            onClick={() => { setCurrencyUnit('USDT'); setShowCurrencySelector(false); }}
            className="w-full text-left px-4 py-3 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground font-medium">USDT</span>
              {currencyUnit === 'USDT' && <Check className="w-4 h-4 text-primary" />}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              输入并显示以 USDT 表示的订单金额。如需使用初始保证金下单，请选择"初始保证金"选项，并输入相应金额。
            </p>
            {currencyUnit === 'USDT' && (
              <div className="flex gap-3 mt-2 ml-1">
                {([
                  { value: 'ORDER_VALUE' as UsdtInputMode, label: '订单金额' },
                  { value: 'INITIAL_MARGIN' as UsdtInputMode, label: '初始保证金' },
                ]).map(m => (
                  <label key={m.value} className="flex items-center gap-1.5 cursor-pointer">
                    <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                      usdtInputMode === m.value ? 'border-primary' : 'border-muted-foreground'
                    }`}>
                      {usdtInputMode === m.value && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </span>
                    <span className={`text-xs ${usdtInputMode === m.value ? 'text-foreground' : 'text-muted-foreground'}`}>
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
        className="relative w-full max-w-sm rounded-t-xl border-t border-border overflow-hidden animate-in slide-in-from-bottom duration-200"
        style={{ background: 'hsl(var(--card))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

// ===== Reusable: Selector Row (compact inline trigger) =====
function SelectorRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-2 py-1 rounded text-[10px] hover:bg-accent/30 transition-colors duration-100 ease-out active:scale-[0.98]"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground flex items-center gap-0.5">
        {value} <ChevronDown className="w-2.5 h-2.5" />
      </span>
    </button>
  );
}

// ===== Reusable: Input Field =====
function InputField({ label, value, onChange, placeholder, suffix = 'USDT' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; suffix?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-dark w-full text-right pr-14 text-xs" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}
