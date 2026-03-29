import { useState } from 'react';

export interface Order {
  id: string;
  side: 'LONG' | 'SHORT';
  type: 'MARKET' | 'LIMIT';
  price: number;
  quantity: number;
  leverage: number;
  entryPrice: number;
  timestamp: number;
}

export interface Position {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  leverage: number;
  margin: number;
}

interface Props {
  currentPrice: number;
  onPlaceOrder: (order: Omit<Order, 'id' | 'entryPrice' | 'timestamp'>) => void;
  disabled: boolean;
}

export function OrderPanel({ currentPrice, onPlaceOrder, disabled }: Props) {
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('0.01');
  const [leverage, setLeverage] = useState(10);

  const LEVERAGE_OPTIONS = [1, 2, 5, 10, 20, 50, 125];

  const handleSubmit = () => {
    if (disabled) return;
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return;

    const orderPrice = orderType === 'MARKET'
      ? currentPrice
      : parseFloat(price);

    if (isNaN(orderPrice) || orderPrice <= 0) return;

    onPlaceOrder({
      side,
      type: orderType,
      price: orderPrice,
      quantity: qty,
      leverage,
    });
  };

  const margin = currentPrice > 0
    ? ((parseFloat(quantity) || 0) * currentPrice / leverage).toFixed(2)
    : '0.00';

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">下单</h3>
      </div>

      {/* Order Type Tabs */}
      <div className="flex gap-4 border-b border-border">
        {(['MARKET', 'LIMIT'] as const).map(t => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={orderType === t ? 'tab-active' : 'tab-inactive'}
          >
            {t === 'MARKET' ? '市价' : '限价'}
          </button>
        ))}
      </div>

      {/* Leverage */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">杠杆倍数</label>
        <div className="flex gap-1 flex-wrap">
          {LEVERAGE_OPTIONS.map(lev => (
            <button
              key={lev}
              onClick={() => setLeverage(lev)}
              className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                leverage === lev
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
            >
              {lev}x
            </button>
          ))}
        </div>
      </div>

      {/* Price (for Limit) */}
      {orderType === 'LIMIT' && (
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">价格 (USDT)</label>
          <input
            type="text"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder={currentPrice.toFixed(2)}
            className="input-dark w-full"
          />
        </div>
      )}

      {/* Quantity */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">数量 (BTC)</label>
        <input
          type="text"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          className="input-dark w-full"
        />
      </div>

      {/* Margin Info */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>保证金</span>
        <span className="font-mono">{margin} USDT</span>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => { setSide('LONG'); handleSubmit(); }}
          disabled={disabled}
          className="btn-long disabled:opacity-40"
        >
          开多 / Long
        </button>
        <button
          onClick={() => { setSide('SHORT'); handleSubmit(); }}
          disabled={disabled}
          className="btn-short disabled:opacity-40"
        >
          开空 / Short
        </button>
      </div>
    </div>
  );
}
