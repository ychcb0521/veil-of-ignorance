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

export function OrderBook({ currentPrice, symbol, previousPrice }: Props) {
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
    if (step >= 0.1) return 1;
    if (step >= 0.01) return 2;
    if (step >= 0.001) return 3;
    if (step >= 0.0001) return 4;
    return 5;
  }, [step]);

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

  const priceUp = previousPrice ? currentPrice >= previousPrice : true;

  if (currentPrice <= 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        等待价格数据...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-[10px] font-mono select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-[10px] font-semibold text-foreground">盘口</span>
        <span className="text-[10px] text-muted-foreground">{symbol.replace('USDT', '/USDT')}</span>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-2 py-1 text-[9px] text-muted-foreground border-b border-border/50">
        <span className="flex-1">价格</span>
        <span className="w-16 text-right">数量</span>
        <span className="w-16 text-right">累计</span>
      </div>

      {/* Asks (sells) - red, reversed so lowest ask is at bottom */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {asks.map((entry, i) => {
          const isBestAsk = i === asks.length - 1;
          return (
            <div key={`a-${i}`}
              className={`relative flex items-center px-2 py-[1px] hover:bg-accent/20 transition-colors duration-150 ${
                isBestAsk && flash === 'down' ? 'bg-destructive/20' : isBestAsk && flash === 'up' ? 'bg-destructive/10' : ''
              }`}>
              <div
                className="absolute right-0 top-0 bottom-0 bg-destructive/10"
                style={{ width: `${(entry.total / maxTotal) * 100}%` }}
              />
              <span className={`flex-1 relative z-10 text-destructive ${isBestAsk && flash ? 'font-bold' : ''}`}>
                {entry.price.toFixed(decimals)}
              </span>
              <span className="w-16 text-right relative z-10 text-foreground/70">{entry.quantity.toFixed(3)}</span>
              <span className="w-16 text-right relative z-10 text-foreground/50">{entry.total.toFixed(1)}</span>
            </div>
          );
        })}
      </div>

      {/* Current price center */}
      <div className={`flex items-center justify-center py-1.5 border-y border-border transition-colors duration-200 ${
        flash === 'up' ? 'bg-green-900/30' : flash === 'down' ? 'bg-red-900/30' : 'bg-card'
      }`}>
        <span className={`text-sm font-bold transition-colors ${priceUp ? 'trading-green' : 'trading-red'}`}>
          {currentPrice.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        </span>
        <span className="ml-1.5 text-[9px] text-muted-foreground">
          {priceUp ? '▲' : '▼'}
        </span>
      </div>

      {/* Bids (buys) - green */}
      <div className="flex-1 overflow-hidden">
        {bids.map((entry, i) => {
          const isBestBid = i === 0;
          return (
            <div key={`b-${i}`}
              className={`relative flex items-center px-2 py-[1px] hover:bg-accent/20 transition-colors duration-150 ${
                isBestBid && flash === 'up' ? 'bg-green-900/20' : isBestBid && flash === 'down' ? 'bg-green-900/10' : ''
              }`}>
              <div
                className="absolute right-0 top-0 bottom-0 bg-primary/8"
                style={{ width: `${(entry.total / maxTotal) * 100}%` }}
              />
              <span className={`flex-1 relative z-10 trading-green ${isBestBid && flash ? 'font-bold' : ''}`}>
                {entry.price.toFixed(decimals)}
              </span>
              <span className="w-16 text-right relative z-10 text-foreground/70">{entry.quantity.toFixed(3)}</span>
              <span className="w-16 text-right relative z-10 text-foreground/50">{entry.total.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
