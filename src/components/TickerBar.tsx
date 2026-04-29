/**
 * Binance-style top ticker bar.
 * Displays: symbol, last/mark/index price, funding rate countdown, 24h stats.
 * All numeric data is derived from visible kline data + current price (no extra fetches).
 */
import { useEffect, useMemo, useState } from 'react';
import type { KlineData } from '@/hooks/useBinanceData';

const FUNDING_INTERVAL_HOURS = [0, 8, 16];
const FUNDING_RATE = 0.0001; // 0.01%

interface Props {
  symbol: string;            // e.g. "BTCUSDT"
  currentPrice: number;
  visibleData: KlineData[];
  pricePrecision: number;
  effectiveSimTime: number;  // ms — used for funding countdown so it respects time travel
}

function formatNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatVolume(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '--';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function TickerBar({ symbol, currentPrice, visibleData, pricePrecision, effectiveSimTime }: Props) {
  const baseCoin = symbol.replace('USDT', '');
  const display = `${baseCoin}USDT`;

  // 24h stats derived from last ~24h of candles (works regardless of interval)
  const stats = useMemo(() => {
    if (visibleData.length === 0 || currentPrice <= 0) {
      return { high: 0, low: 0, volume: 0, change: 0, changePct: 0, openPrice: 0 };
    }
    const lastTime = visibleData[visibleData.length - 1].time;
    const cutoff = lastTime - 24 * 60 * 60 * 1000;
    const window = visibleData.filter(c => c.time >= cutoff);
    const slice = window.length > 0 ? window : visibleData.slice(-Math.min(visibleData.length, 1440));

    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume * c.close;
    }
    const openPrice = slice[0].open;
    const change = currentPrice - openPrice;
    const changePct = openPrice > 0 ? (change / openPrice) * 100 : 0;
    return { high, low, volume, change, changePct, openPrice };
  }, [visibleData, currentPrice]);

  // Funding countdown — ticks every second, but anchored on the simulated time
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const baseTime = effectiveSimTime > 0 ? effectiveSimTime + (Date.now() - now > 5_000 ? 0 : 0) : Date.now();
  const fundingMs = useMemo(() => {
    const t = effectiveSimTime > 0 ? effectiveSimTime : now;
    const d = new Date(t);
    const utcHour = d.getUTCHours();
    const next = FUNDING_INTERVAL_HOURS.find(h => h > utcHour) ?? 24;
    const target = new Date(d);
    target.setUTCHours(next, 0, 0, 0);
    if (next === 24) target.setUTCDate(target.getUTCDate());
    return target.getTime() - t;
  }, [effectiveSimTime, now]);

  const isUp = stats.change >= 0;
  const priceColor = isUp ? 'text-trading-green' : 'text-trading-red';
  const priceText = currentPrice > 0
    ? currentPrice.toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision })
    : '--';

  return (
    <div className="flex items-center gap-6 px-4 h-14 border-b border-[#2b3139] bg-[#0b0e11] overflow-x-auto">
      {/* Symbol + last price block */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-white tracking-tight">{display}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">永续</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className={`text-lg font-bold font-mono tabular-nums ${priceColor}`}>{priceText}</span>
          <span className="text-[10px] text-[#B7BDC6] font-mono tabular-nums">
            ≈ ${formatNum(currentPrice, pricePrecision)}
          </span>
        </div>
      </div>

      {/* Mark price */}
      <Stat label="标记价格" value={formatNum(currentPrice, pricePrecision)} />

      {/* Index price (mock = current with tiny offset) */}
      <Stat label="指数价格" value={formatNum(currentPrice * 0.9998, pricePrecision)} />

      {/* Funding / countdown */}
      <div className="flex flex-col leading-tight shrink-0">
        <span className="text-[10px] text-[#848e9c]">资金费率 / 倒计时</span>
        <div className="flex items-center gap-1.5 font-mono tabular-nums">
          <span className="text-xs text-trading-green font-semibold">
            {(FUNDING_RATE * 100).toFixed(4)}%
          </span>
          <span className="text-xs text-white">{formatCountdown(fundingMs)}</span>
        </div>
      </div>

      {/* Spacer pushes 24h block right */}
      <div className="flex-1 min-w-4" />

      {/* 24h stats */}
      <Stat
        label="24h 涨跌"
        value={`${isUp ? '+' : ''}${formatNum(stats.change, pricePrecision)}`}
        valueClass={isUp ? 'text-trading-green' : 'text-trading-red'}
        sub={`${isUp ? '+' : ''}${stats.changePct.toFixed(2)}%`}
        subClass={isUp ? 'text-trading-green' : 'text-trading-red'}
      />
      <Stat label="24h 最高" value={formatNum(stats.high, pricePrecision)} />
      <Stat label="24h 最低" value={formatNum(stats.low, pricePrecision)} />
      <Stat label={`24h 成交量(${baseCoin})`} value={formatVolume(stats.volume / Math.max(currentPrice, 1))} />
      <Stat label="24h 成交额(USDT)" value={formatVolume(stats.volume)} />
    </div>
  );
}

function Stat({
  label, value, sub, valueClass = 'text-white', subClass = 'text-[#848e9c]',
}: {
  label: string; value: string; sub?: string; valueClass?: string; subClass?: string;
}) {
  return (
    <div className="flex flex-col leading-tight shrink-0">
      <span className="text-[10px] text-[#848e9c] whitespace-nowrap">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-xs font-mono tabular-nums font-semibold whitespace-nowrap ${valueClass}`}>{value}</span>
        {sub && <span className={`text-[10px] font-mono tabular-nums ${subClass}`}>{sub}</span>}
      </div>
    </div>
  );
}
