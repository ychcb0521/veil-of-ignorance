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
  onMinimize?: () => void;
  onClose?: () => void;
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

export function RecentTrades({ currentPrice, pricePrecision, onMinimize, onClose }: Props) {
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
    <div className="flex flex-col h-full min-h-0 overflow-hidden text-[10px] font-mono select-none bg-white dark:bg-[#1e2329]">
      {/* Tabs + window controls (frozen) */}
      <div className="flex-none flex items-center justify-between px-3 h-10 border-b border-gray-200 dark:border-[#2b3139]">
        <div className="flex items-center gap-4 h-full">
          <button
            onClick={() => setTab('trades')}
            className={`relative h-full text-sm font-medium transition-colors flex items-center ${
              tab === 'trades' ? 'text-gray-900 dark:text-[#EAECEF]' : 'text-gray-500 dark:text-[#848e9c] hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            最新成交
            {tab === 'trades' && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#fcd535]" />}
          </button>
          <button
            onClick={() => setTab('movers')}
            className={`relative h-full text-sm font-medium transition-colors flex items-center ${
              tab === 'movers' ? 'text-gray-900 dark:text-[#EAECEF]' : 'text-gray-500 dark:text-[#848e9c] hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            市场异动
            {tab === 'movers' && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#fcd535]" />}
          </button>
        </div>
        <div className="flex items-center space-x-2 text-gray-500 dark:text-[#848e9c]">
          <button type="button" title="弹出窗口" className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2h4v4" /><path d="M12 2L7 7" /><path d="M11 8.5V11a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 11V5a1.5 1.5 0 0 1 1.5-1.5H6" />
            </svg>
          </button>
          {onMinimize && (
            <button type="button" title="最小化" onClick={onMinimize} className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2.5 9h7" />
              </svg>
            </button>
          )}
          {onClose && (
            <button type="button" title="关闭" onClick={onClose} className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors">
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Column headers (frozen) */}
      <div className="flex-none flex items-center px-3 h-6 text-[9px] text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]/60">
        <span className="flex-1">价格(USDT)</span>
        <span className="w-16 text-right">数量</span>
        <span className="w-14 text-right">时间</span>
      </div>

      {tab === 'trades' ? (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b3139] scrollbar-track-transparent">
          {trades.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-[#848e9c]">等待数据...</div>
          ) : (
            trades.map(t => (
              <div key={t.id} className="flex items-center px-3 h-[20px] hover:bg-[#2b3139]/40 tabular-nums">
                <span className={`flex-1 ${t.side === 'BUY' ? 'text-trading-green' : 'text-trading-red'}`}>
                  {t.price.toFixed(pricePrecision)}
                </span>
                <span className="w-16 text-right text-gray-600 dark:text-[#B7BDC6]">{t.qty.toFixed(3)}</span>
                <span className="w-14 text-right text-gray-500 dark:text-[#848e9c]">{formatTime(t.time)}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center text-gray-500 dark:text-[#848e9c] text-[11px]">
          市场异动 · 即将上线
        </div>
      )}
    </div>
  );
}
