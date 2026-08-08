/**
 * 最新成交 — 币安式实时成交流水。
 * 目前仍是静态骨架：以 currentPrice 为中心做确定性抖动的模拟数据。
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

export function TradeTape({ currentPrice, pricePrecision }: Props) {
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex-none flex items-center px-3 h-6 text-[9px] text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]/60">
        <span className="flex-1">价格(USDT)</span>
        <span className="w-16 text-right">数量</span>
        <span className="w-14 text-right">时间</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b3139] scrollbar-track-transparent">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-[#848e9c]">等待数据...</div>
        ) : (
          trades.map(t => (
            <div key={t.id} className="flex items-center px-3 h-[20px] hover:bg-gray-50 dark:hover:bg-[#2b3139]/40 tabular-nums">
              <span className={`flex-1 ${t.side === 'BUY' ? 'text-trading-green' : 'text-trading-red'}`}>
                {t.price.toFixed(pricePrecision)}
              </span>
              <span className="w-16 text-right text-gray-600 dark:text-[#B7BDC6]">{t.qty.toFixed(3)}</span>
              <span className="w-14 text-right text-gray-500 dark:text-[#848e9c]">{formatTime(t.time)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
