/**
 * Mock Order Book with animated bid/ask walls.
 * Generates synthetic depth around currentPrice using deterministic noise.
 * Features flash effect on best bid/ask when price ticks.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { getPriceStep } from '@/types/trading';

interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

interface Props {
  currentPrice: number;
  symbol: string;
  previousPrice?: number;
  pricePrecision?: number;
  onMinimize?: () => void;
  onClose?: () => void;
}

const DEPTH_LEVELS = 12;

function generateDepth(basePrice: number, step: number, levels: number, isBid: boolean, seed: number): OrderBookEntry[] {
  const entries: OrderBookEntry[] = [];
  let total = 0;
  for (let i = 0; i < levels; i++) {
    const offset = (i + 1) * step;
    const price = isBid ? basePrice - offset : basePrice + offset;
    const noise = Math.abs(Math.sin(price * 1000 + seed * 7.13)) * 0.8 + 0.2;
    const quantity = +(noise * (5 + Math.random() * 45)).toFixed(3);
    total += quantity;
    entries.push({ price: +price.toFixed(8), quantity, total: +total.toFixed(3) });
  }
  return entries;
}

export function OrderBook({ currentPrice, symbol, previousPrice, pricePrecision: propPrecision, onMinimize, onClose }: Props) {
  const [seed, setSeed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPriceRef = useRef(currentPrice);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  // Refresh depth every 500ms
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSeed(s => s + 1);
    }, 500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Flash effect when price changes
  useEffect(() => {
    if (currentPrice <= 0 || prevPriceRef.current <= 0) {
      prevPriceRef.current = currentPrice;
      return;
    }
    if (currentPrice !== prevPriceRef.current) {
      setFlash(currentPrice > prevPriceRef.current ? 'up' : 'down');
      prevPriceRef.current = currentPrice;
      const timer = setTimeout(() => setFlash(null), 300);
      return () => clearTimeout(timer);
    }
  }, [currentPrice]);

  const step = useMemo(() => getPriceStep(currentPrice), [currentPrice]);
  const decimals = useMemo(() => {
    if (propPrecision != null) return propPrecision;
    if (step >= 0.1) return 1;
    if (step >= 0.01) return 2;
    if (step >= 0.001) return 3;
    if (step >= 0.0001) return 4;
    return 5;
  }, [step, propPrecision]);

  const asks = useMemo(() => {
    if (currentPrice <= 0) return [];
    return generateDepth(currentPrice, step, DEPTH_LEVELS, false, seed).reverse();
  }, [currentPrice, step, seed]);

  const bids = useMemo(() => {
    if (currentPrice <= 0) return [];
    return generateDepth(currentPrice, step, DEPTH_LEVELS, true, seed);
  }, [currentPrice, step, seed]);

  const maxTotal = useMemo(() => {
    const askMax = asks.length > 0 ? asks[0].total : 0;
    const bidMax = bids.length > 0 ? bids[bids.length - 1].total : 0;
    return Math.max(askMax, bidMax, 1);
  }, [asks, bids]);

  // Buy/sell ratio from total bid vs ask volume
  const { buyPct, sellPct } = useMemo(() => {
    const bidSum = bids.reduce((s, e) => s + e.quantity, 0);
    const askSum = asks.reduce((s, e) => s + e.quantity, 0);
    const total = bidSum + askSum;
    if (total <= 0) return { buyPct: 50, sellPct: 50 };
    const b = (bidSum / total) * 100;
    return { buyPct: +b.toFixed(2), sellPct: +(100 - b).toFixed(2) };
  }, [bids, asks]);

  const priceUp = previousPrice ? currentPrice >= previousPrice : true;

  if (currentPrice <= 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        等待价格数据...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden text-[10px] font-mono tabular-nums select-none bg-white dark:bg-[#1e2329]">
      {/* Header (frozen) — group enables hover-reveal of close icon */}
      <div className="group flex-none flex items-center justify-between px-3 h-10 border-b border-gray-200 dark:border-[#2b3139]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-900 dark:text-[#EAECEF]">订单簿</span>
          {/* Layout preset icons: split / bids only / asks only */}
          <div className="flex items-center space-x-2 text-gray-500 dark:text-[#848e9c]">
            <button type="button" title="买卖盘" className="hover:opacity-100 opacity-80 cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="12" height="5.5" rx="0.5" fill="#f6465d" opacity="0.85" />
                <rect x="1" y="7.5" width="12" height="5.5" rx="0.5" fill="#0ecb81" opacity="0.85" />
              </svg>
            </button>
            <button type="button" title="仅买盘" className="hover:opacity-100 opacity-80 cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="12" height="12" rx="0.5" fill="#0ecb81" opacity="0.85" />
              </svg>
            </button>
            <button type="button" title="仅卖盘" className="hover:opacity-100 opacity-80 cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="12" height="12" rx="0.5" fill="#f6465d" opacity="0.85" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-gray-500 dark:text-[#848e9c]">
          <button
            type="button"
            className="flex items-center gap-0.5 text-[11px] hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors"
            title="深度聚合"
          >
            {step.toString()}
            <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {onMinimize && (
            <button
              type="button"
              title="最小化"
              onClick={onMinimize}
              className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2.5 9h7" />
              </svg>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              title="关闭"
              onClick={onClose}
              className="opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer hover:text-gray-900 dark:hover:text-white"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Column headers (frozen) — 3 equal columns */}
      <div className="flex-none grid grid-cols-3 px-3 h-6 items-center text-[9px] text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]/60">
        <span className="text-left">价格(USDT)</span>
        <span className="text-right">数量(USDT)</span>
        <span className="text-right">合计(USDT)</span>
      </div>

      {/* Scrollable middle: asks + price + bids inside one scroll container */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b3139] scrollbar-track-transparent flex flex-col">
        {/* Asks (sells) */}
        <div className="flex flex-col justify-end">
          {asks.map((entry, i) => {
            const isBestAsk = i === asks.length - 1;
            return (
              <div key={`a-${i}`}
                className={`relative grid grid-cols-3 items-center px-3 py-[1px] hover:bg-accent/20 transition-colors duration-150 ${
                  isBestAsk && flash === 'down' ? 'bg-destructive/20' : isBestAsk && flash === 'up' ? 'bg-destructive/10' : ''
                }`}>
                <div
                  className="absolute right-0 top-0 bottom-0 bg-destructive/10"
                  style={{ width: `${(entry.total / maxTotal) * 100}%` }}
                />
                <span className={`relative z-10 text-left text-destructive ${isBestAsk && flash ? 'font-bold' : ''}`}>
                  {entry.price.toFixed(decimals)}
                </span>
                <span className="relative z-10 text-right text-foreground/70">{entry.quantity.toFixed(3)}</span>
                <span className="relative z-10 text-right text-foreground/50">{entry.total.toFixed(1)}</span>
              </div>
            );
          })}
        </div>

        {/* Current price band (sticky inside scroll area) */}
        <div className={`sticky top-0 z-20 flex items-center justify-center py-1.5 border-y border-border transition-colors duration-200 ${
          flash === 'up' ? 'bg-green-900/30' : flash === 'down' ? 'bg-red-900/30' : 'bg-card'
        }`}>
          <span className={`text-sm font-bold transition-colors ${priceUp ? 'trading-green' : 'trading-red'}`}>
            {currentPrice.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
          </span>
          <span className="ml-1.5 text-[9px] text-muted-foreground">{priceUp ? '▲' : '▼'}</span>
        </div>

        {/* Bids (buys) */}
        <div className="flex flex-col">
          {bids.map((entry, i) => {
            const isBestBid = i === 0;
            return (
              <div key={`b-${i}`}
                className={`relative grid grid-cols-3 items-center px-3 py-[1px] hover:bg-accent/20 transition-colors duration-150 ${
                  isBestBid && flash === 'up' ? 'bg-green-900/20' : isBestBid && flash === 'down' ? 'bg-green-900/10' : ''
                }`}>
                <div
                  className="absolute right-0 top-0 bottom-0 bg-primary/8"
                  style={{ width: `${(entry.total / maxTotal) * 100}%` }}
                />
                <span className={`relative z-10 text-left trading-green ${isBestBid && flash ? 'font-bold' : ''}`}>
                  {entry.price.toFixed(decimals)}
                </span>
                <span className="relative z-10 text-right text-foreground/70">{entry.quantity.toFixed(3)}</span>
                <span className="relative z-10 text-right text-foreground/50">{entry.total.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Buy/Sell ratio bar (frozen, bottom) */}
      <div className="flex-none flex items-center gap-2 px-3 h-6 border-t border-gray-200 dark:border-[#2b3139] bg-white dark:bg-[#1e2329]">
        <span className="text-[10px] font-medium text-trading-green tabular-nums whitespace-nowrap">
          B {buyPct.toFixed(2)}%
        </span>
        <div className="h-1 flex-1 flex rounded-full overflow-hidden bg-[#2b3139]">
          <div className="bg-trading-green h-full" style={{ width: `${buyPct}%` }} />
          <div className="bg-trading-red h-full" style={{ width: `${sellPct}%` }} />
        </div>
        <span className="text-[10px] font-medium text-trading-red tabular-nums whitespace-nowrap">
          {sellPct.toFixed(2)}% S
        </span>
      </div>
    </div>
  );
}
