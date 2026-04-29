/**
 * Recent Trades — Binance-style real-time trade tape.
 * Static UI scaffold with deterministic mock data that gently jitters around currentPrice.
 */
import { useEffect, useMemo, useState } from 'react';

interface Trade {
  id: number;
  price: number;
  qty: number;
  time: number;
  side: 'BUY' | 'SELL';
}

interface Props {
  currentPrice: number;
  pricePrecision: number;
}

const ROW_COUNT = 22;

function generateMockTrade(idx: number, basePrice: number): Trade {
  const seed = (idx * 9301 + 49297) % 233280;
  const r = seed / 233280;
  const drift = (r - 0.5) * basePrice * 0.0008;
  const qty = +(Math.abs(Math.sin(seed)) * 1.5 + 0.001).toFixed(3);
  return {
    id: idx,
    price: basePrice + drift,
    qty,
    time: Date.now() - idx * 1500,
    side: r > 0.5 ? 'BUY' : 'SELL',
  };
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function RecentTrades({ currentPrice, pricePrecision }: Props) {
  const [tab, setTab] = useState<'trades' | 'movers'>('trades');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 1500);
    return () => window.clearInterval(id);
  }, []);

  const trades = useMemo(() => {
    if (currentPrice <= 0) return [];
    return Array.from({ length: ROW_COUNT }, (_, i) => generateMockTrade(i + tick, currentPrice));
  }, [currentPrice, tick]);

  return (
    <div className="flex flex-col h-full text-[10px] font-mono select-none">
      {/* Tabs */}
      <div className="flex items-center gap-4 px-3 h-8 border-b border-[#2b3139] shrink-0">
        <button
          onClick={() => setTab('trades')}
          className={`text-[11px] font-medium transition-colors ${
            tab === 'trades' ? 'text-white border-b-2 border-primary -mb-px h-8 flex items-center' : 'text-[#848e9c] hover:text-white'
          }`}
        >
          最新成交
        </button>
        <button
          onClick={() => setTab('movers')}
          className={`text-[11px] font-medium transition-colors ${
            tab === 'movers' ? 'text-white border-b-2 border-primary -mb-px h-8 flex items-center' : 'text-[#848e9c] hover:text-white'
          }`}
        >
          市场异动
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-3 h-6 text-[9px] text-[#848e9c] border-b border-[#2b3139]/60 shrink-0">
        <span className="flex-1">价格(USDT)</span>
        <span className="w-16 text-right">数量</span>
        <span className="w-14 text-right">时间</span>
      </div>

      {tab === 'trades' ? (
        <div className="flex-1 overflow-y-auto">
          {trades.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[#848e9c]">等待数据...</div>
          ) : (
            trades.map(t => (
              <div key={t.id} className="flex items-center px-3 h-[20px] hover:bg-[#2b3139]/40 tabular-nums">
                <span className={`flex-1 ${t.side === 'BUY' ? 'text-trading-green' : 'text-trading-red'}`}>
                  {t.price.toFixed(pricePrecision)}
                </span>
                <span className="w-16 text-right text-[#B7BDC6]">{t.qty.toFixed(3)}</span>
                <span className="w-14 text-right text-[#848e9c]">{formatTime(t.time)}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#848e9c] text-[11px]">
          市场异动 · 即将上线
        </div>
      )}
    </div>
  );
}
