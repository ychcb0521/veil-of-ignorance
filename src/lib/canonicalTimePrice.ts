import type { KlineData } from "@/hooks/useBinanceData";

export interface CanonicalTimePrice {
  high: number;
  low: number;
  close: number;
}

export const CANONICAL_PRICE_INTERVAL = "1m";
export const CANONICAL_PRICE_INTERVAL_MS = 60_000;

export function deriveCanonicalTimePrice(
  candle: KlineData,
  currentTime: number,
  intervalMs = CANONICAL_PRICE_INTERVAL_MS,
  nowMs = Date.now(),
): CanonicalTimePrice {
  const candleEnd = candle.time + intervalMs;
  if (currentTime >= candleEnd) {
    return { high: candle.high, low: candle.low, close: candle.close };
  }

  const isLiveCandle = candleEnd > nowMs - intervalMs;
  const progress = Math.max(0, Math.min(1, (currentTime - candle.time) / intervalMs));
  const close = isLiveCandle ? candle.close : candle.open + (candle.close - candle.open) * progress;
  const hlReveal = Math.min(1, progress * 1.5);
  const rawHigh = isLiveCandle ? candle.high : candle.open + (candle.high - candle.open) * hlReveal;
  const rawLow = isLiveCandle ? candle.low : candle.open + (candle.low - candle.open) * hlReveal;

  return {
    high: isLiveCandle ? candle.high : Math.max(candle.open, close, rawHigh),
    low: isLiveCandle ? candle.low : Math.min(candle.open, close, rawLow),
    close,
  };
}

export async function fetchCanonicalTimePriceAt(
  symbol: string,
  currentTime: number,
  fetchFn: typeof fetch = fetch,
): Promise<CanonicalTimePrice | null> {
  if (!symbol || !Number.isFinite(currentTime) || currentTime <= 0) return null;

  const candleOpenTime = Math.floor(currentTime / CANONICAL_PRICE_INTERVAL_MS) * CANONICAL_PRICE_INTERVAL_MS;
  const qs = new URLSearchParams({
    symbol,
    interval: CANONICAL_PRICE_INTERVAL,
    limit: "1",
    startTime: String(candleOpenTime),
    endTime: String(candleOpenTime + CANONICAL_PRICE_INTERVAL_MS - 1),
  });

  const res = await fetchFn(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
  if (!res.ok) return null;

  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0 || !Array.isArray(raw[0])) return null;
  const k = raw[0];
  const candle: KlineData = {
    time: Number(k[0]),
    open: Number.parseFloat(String(k[1])),
    high: Number.parseFloat(String(k[2])),
    low: Number.parseFloat(String(k[3])),
    close: Number.parseFloat(String(k[4])),
    volume: Number.parseFloat(String(k[5] ?? 0)),
  };
  if (
    !Number.isFinite(candle.time) ||
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close)
  ) {
    return null;
  }

  return deriveCanonicalTimePrice(candle, currentTime, CANONICAL_PRICE_INTERVAL_MS);
}
