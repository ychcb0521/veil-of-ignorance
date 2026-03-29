import { useState, useRef, useEffect } from 'react';
import type { OrderSide, OrderType, MarginMode } from '@/types/trading';
import { ORDER_TYPE_INFO } from '@/types/trading';
import { ChevronDown } from 'lucide-react';

export interface PlaceOrderParams {
  side: OrderSide;
  type: OrderType;
  price: number;
  stopPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  // Trailing stop
  callbackRate?: number;
  trailingExecType?: 'MARKET' | 'LIMIT';
  trailingLimitPrice?: number;
  // TWAP
  twapDuration?: number;   // total duration in minutes
  twapInterval?: number;   // interval in minutes
  // Conditional
  conditionalExecType?: 'MARKET' | 'LIMIT';
  conditionalLimitPrice?: number;
  // Scaled
  scaledCount?: number;
  scaledStartPrice?: number;
  scaledEndPrice?: number;
}

interface Props {
  currentPrice: number;
  disabled: boolean;
  onPlaceOrder: (order: PlaceOrderParams) => void;
}

export function OrderPanel({ currentPrice, onPlaceOrder, disabled }: Props) {
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [marginMode, setMarginMode] = useState<MarginMode>('cross');
  const [leverage, setLeverage] = useState(20);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Shared fields
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [quantity, setQuantity] = useState('0.01');

  // Trailing stop fields
  const [callbackRate, setCallbackRate] = useState('1');
  const [trailingExecType, setTrailingExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [trailingLimitPrice, setTrailingLimitPrice] = useState('');

  // TWAP fields
  const [twapDuration, setTwapDuration] = useState('60');   // minutes
  const [twapInterval, setTwapInterval] = useState('5');    // minutes

  // Conditional fields
  const [condExecType, setCondExecType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [condLimitPrice, setCondLimitPrice] = useState('');

  // Scaled fields
  const [scaledCount, setScaledCount] = useState('5');
  const [scaledStartPrice, setScaledStartPrice] = useState('');
  const [scaledEndPrice, setScaledEndPrice] = useState('');

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const effectivePrice = (orderType === 'MARKET' || orderType === 'MARKET_TP_SL')
    ? currentPrice
    : (parseFloat(price) || currentPrice);
  const qty = parseFloat(quantity) || 0;
  const margin = effectivePrice > 0 ? (qty * effectivePrice / leverage) : 0;
  const fee = effectivePrice * qty * 0.0004;

  const handleOrder = (side: OrderSide) => {
    if (disabled || qty <= 0) return;
    onPlaceOrder({
      side,
      type: orderType,
      price: ['MARKET', 'MARKET_TP_SL'].includes(orderType) ? 0 : (parseFloat(price) || 0),
      stopPrice: parseFloat(stopPrice) || 0,
      quantity: qty,
      leverage,
      marginMode,
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

  // Whether this order type needs a trigger/stop price
  const needsTrigger = ['LIMIT_TP_SL', 'MARKET_TP_SL', 'CONDITIONAL', 'TRAILING_STOP'].includes(orderType);
  // Whether this order type needs a limit price
  const needsLimitPrice = ['LIMIT', 'POST_ONLY', 'LIMIT_TP_SL', 'CONDITIONAL', 'SCALED'].includes(orderType)
    || (orderType === 'TRAILING_STOP' && trailingExecType === 'LIMIT')
    || (orderType === 'CONDITIONAL' && condExecType === 'LIMIT');

  return (
    <div className="flex flex-col h-full" style={{ background: '#0B0E11' }}>
      {/* Margin Mode + Leverage Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2.5">
        <div className="flex gap-1">
          {(['cross', 'isolated'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMarginMode(m)}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
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
              background: `linear-gradient(to right, #F0B90B ${(leverage / 125) * 100}%, #1B1F26 ${(leverage / 125) * 100}%)`,
            }}
          />
          <div className="flex justify-between mt-1">
            {[1, 25, 50, 75, 100, 125].map(v => (
              <button
                key={v} onClick={() => setLeverage(v)}
                className={`text-[10px] font-mono px-1 rounded transition-colors ${
                  leverage === v ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Order Type Dropdown Selector (Binance-style) */}
      <div className="px-3 pt-2 pb-1 relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium bg-accent text-foreground hover:bg-accent/80 transition-colors"
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
                className={`w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors flex items-center justify-between ${
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

      {/* Order Inputs */}
      <div className="px-3 space-y-2 flex-1 overflow-y-auto pb-2">

        {/* === Trigger / Stop Price === */}
        {needsTrigger && (
          <InputField label="触发价 (USDT)" value={stopPrice} onChange={setStopPrice} placeholder="触发价格" />
        )}

        {/* === Limit Price === */}
        {needsLimitPrice && orderType !== 'SCALED' && orderType !== 'CONDITIONAL' && (
          <InputField label="价格 (USDT)" value={price} onChange={setPrice} placeholder={currentPrice.toFixed(2)} />
        )}

        {/* === Market price display === */}
        {(orderType === 'MARKET' || orderType === 'MARKET_TP_SL') && (
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">价格</label>
            <div className="input-dark w-full text-right text-xs flex items-center justify-end">
              <span className="text-muted-foreground">市价</span>
            </div>
          </div>
        )}

        {/* === Post Only: same as limit, just a note === */}
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
                    className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                      trailingExecType === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t === 'MARKET' ? '市价' : '限价'}
                  </button>
                ))}
              </div>
            </div>
            {trailingExecType === 'LIMIT' && (
              <InputField label="限价 (USDT)" value={trailingLimitPrice} onChange={setTrailingLimitPrice} placeholder={currentPrice.toFixed(2)} />
            )}
          </>
        )}

        {/* === Conditional Order specific === */}
        {orderType === 'CONDITIONAL' && (
          <>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">触发后执行</label>
              <div className="flex gap-1">
                {(['MARKET', 'LIMIT'] as const).map(t => (
                  <button key={t} onClick={() => setCondExecType(t)}
                    className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                      condExecType === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t === 'MARKET' ? '市价' : '限价'}
                  </button>
                ))}
              </div>
            </div>
            {condExecType === 'LIMIT' && (
              <InputField label="限价 (USDT)" value={condLimitPrice} onChange={setCondLimitPrice} placeholder={currentPrice.toFixed(2)} />
            )}
          </>
        )}

        {/* === TWAP specific === */}
        {orderType === 'TWAP' && (
          <>
            <InputField label="总时长 (分钟)" value={twapDuration} onChange={setTwapDuration} placeholder="60" suffix="min" />
            <InputField label="下单间隔 (分钟)" value={twapInterval} onChange={setTwapInterval} placeholder="5" suffix="min" />
            <div className="text-[10px] text-muted-foreground px-1">
              将拆分为 {Math.max(1, Math.floor((parseFloat(twapDuration) || 60) / (parseFloat(twapInterval) || 5)))} 笔子订单，
              每笔 {(qty / Math.max(1, Math.floor((parseFloat(twapDuration) || 60) / (parseFloat(twapInterval) || 5)))).toFixed(4)}
            </div>
          </>
        )}

        {/* === Scaled Order specific === */}
        {orderType === 'SCALED' && (
          <>
            <InputField label="子订单数" value={scaledCount} onChange={setScaledCount} placeholder="5" />
            <InputField label="起始价 (USDT)" value={scaledStartPrice} onChange={setScaledStartPrice} placeholder={currentPrice.toFixed(2)} />
            <InputField label="终点价 (USDT)" value={scaledEndPrice} onChange={setScaledEndPrice} placeholder={currentPrice.toFixed(2)} />
            <div className="text-[10px] text-muted-foreground px-1">
              {(() => {
                const count = parseInt(scaledCount) || 5;
                const sp = parseFloat(scaledStartPrice) || 0;
                const ep = parseFloat(scaledEndPrice) || 0;
                const step = count > 1 ? (ep - sp) / (count - 1) : 0;
                return `${count} 笔限价单，步长 ${step.toFixed(2)}，每笔 ${(qty / count).toFixed(4)}`;
              })()}
            </div>
          </>
        )}

        {/* === Quantity === */}
        <div>
          <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">
            {orderType === 'TWAP' ? '总数量' : '数量'}
          </label>
          <div className="relative">
            <input type="text" value={quantity} onChange={e => setQuantity(e.target.value)}
              className="input-dark w-full text-right pr-14 text-xs" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">BTC</span>
          </div>
          <div className="flex gap-1 mt-1.5">
            {[25, 50, 75, 100].map(pct => (
              <button key={pct}
                className="flex-1 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground hover:bg-accent transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

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

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pb-3">
          <button onClick={() => handleOrder('LONG')} disabled={disabled}
            className="btn-long disabled:opacity-30 text-xs py-2.5">
            <div>开多 / Buy</div>
            {orderType === 'MARKET' && currentPrice > 0 && (
              <div className="text-[10px] opacity-80 mt-0.5">{currentPrice.toFixed(2)}</div>
            )}
          </button>
          <button onClick={() => handleOrder('SHORT')} disabled={disabled}
            className="btn-short disabled:opacity-30 text-xs py-2.5">
            <div>开空 / Sell</div>
            {orderType === 'MARKET' && currentPrice > 0 && (
              <div className="text-[10px] opacity-80 mt-0.5">{currentPrice.toFixed(2)}</div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Reusable input field component
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
