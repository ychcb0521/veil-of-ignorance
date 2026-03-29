import { useState } from 'react';
import type { OrderSide, OrderType, MarginMode } from '@/types/trading';

interface Props {
  currentPrice: number;
  disabled: boolean;
  onPlaceOrder: (order: {
    side: OrderSide;
    type: OrderType;
    price: number;
    stopPrice: number;
    quantity: number;
    leverage: number;
    marginMode: MarginMode;
  }) => void;
}

const LEVERAGE_MARKS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125];

export function OrderPanel({ currentPrice, onPlaceOrder, disabled }: Props) {
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [marginMode, setMarginMode] = useState<MarginMode>('cross');
  const [leverage, setLeverage] = useState(20);
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [quantity, setQuantity] = useState('0.01');

  const effectivePrice = orderType === 'MARKET' ? currentPrice : (parseFloat(price) || currentPrice);
  const qty = parseFloat(quantity) || 0;
  const margin = effectivePrice > 0 ? (qty * effectivePrice / leverage) : 0;
  const fee = effectivePrice * qty * 0.0004;

  const handleOrder = (side: OrderSide) => {
    if (disabled || qty <= 0) return;
    onPlaceOrder({
      side,
      type: orderType,
      price: orderType === 'MARKET' ? 0 : (parseFloat(price) || 0),
      stopPrice: (orderType === 'STOP_LIMIT' || orderType === 'STOP_MARKET') ? (parseFloat(stopPrice) || 0) : 0,
      quantity: qty,
      leverage,
      marginMode,
    });
  };

  const ORDER_TYPES: { value: OrderType; label: string }[] = [
    { value: 'MARKET', label: '市价' },
    { value: 'LIMIT', label: '限价' },
    { value: 'STOP_MARKET', label: '止损市价' },
    { value: 'STOP_LIMIT', label: '止损限价' },
  ];

  return (
    <div className="flex flex-col h-full" style={{ background: '#0B0E11' }}>
      {/* Margin Mode + Leverage Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2.5">
        {/* Margin Mode Toggle */}
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

        {/* Leverage Slider */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">杠杆</span>
            <span className="font-mono text-xs font-bold text-primary">{leverage}x</span>
          </div>
          <input
            type="range"
            min={1}
            max={125}
            value={leverage}
            onChange={e => setLeverage(parseInt(e.target.value))}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #F0B90B ${(leverage / 125) * 100}%, #1B1F26 ${(leverage / 125) * 100}%)`,
            }}
          />
          <div className="flex justify-between mt-1">
            {[1, 25, 50, 75, 100, 125].map(v => (
              <button
                key={v}
                onClick={() => setLeverage(v)}
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

      {/* Order Type Tabs */}
      <div className="px-3 pt-2">
        <div className="flex gap-1 mb-3">
          {ORDER_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setOrderType(t.value)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                orderType === t.value
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Order Inputs */}
      <div className="px-3 space-y-2.5 flex-1">
        {/* Stop Price (for stop orders) */}
        {(orderType === 'STOP_LIMIT' || orderType === 'STOP_MARKET') && (
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">触发价 (USDT)</label>
            <div className="relative">
              <input
                type="text"
                value={stopPrice}
                onChange={e => setStopPrice(e.target.value)}
                placeholder="触发价格"
                className="input-dark w-full text-right pr-14 text-xs"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">USDT</span>
            </div>
          </div>
        )}

        {/* Limit Price */}
        {(orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && (
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">价格 (USDT)</label>
            <div className="relative">
              <input
                type="text"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder={currentPrice.toFixed(2)}
                className="input-dark w-full text-right pr-14 text-xs"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">USDT</span>
            </div>
          </div>
        )}

        {/* Market price display */}
        {orderType === 'MARKET' && (
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">价格</label>
            <div className="input-dark w-full text-right text-xs flex items-center justify-end">
              <span className="text-muted-foreground">市价</span>
            </div>
          </div>
        )}

        {/* Quantity */}
        <div>
          <label className="text-[10px] text-muted-foreground mb-1 block uppercase tracking-wider">数量</label>
          <div className="relative">
            <input
              type="text"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="input-dark w-full text-right pr-14 text-xs"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              {/* Extract base asset from pair */}
              BTC
            </span>
          </div>
          {/* Quick percent buttons */}
          <div className="flex gap-1 mt-1.5">
            {[25, 50, 75, 100].map(pct => (
              <button
                key={pct}
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
          <button
            onClick={() => handleOrder('LONG')}
            disabled={disabled}
            className="btn-long disabled:opacity-30 text-xs py-2.5"
          >
            <div>开多 / Buy</div>
            {orderType === 'MARKET' && currentPrice > 0 && (
              <div className="text-[10px] opacity-80 mt-0.5">{currentPrice.toFixed(2)}</div>
            )}
          </button>
          <button
            onClick={() => handleOrder('SHORT')}
            disabled={disabled}
            className="btn-short disabled:opacity-30 text-xs py-2.5"
          >
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
