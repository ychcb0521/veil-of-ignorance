import type { KlineData } from "@/hooks/useBinanceData";

const PRICE_POLLUTION_MIN_RATIO = 0.2;
const PRICE_POLLUTION_MAX_RATIO = 5;

export function applyCurrentPriceToVisibleData(visibleData: KlineData[], currentPrice: number): KlineData[] {
  if (visibleData.length === 0 || currentPrice <= 0 || !Number.isFinite(currentPrice)) return visibleData;

  const last = visibleData[visibleData.length - 1];
  const referencePrice = last.close > 0 ? last.close : (last.high + last.low) / 2;
  if (referencePrice > 0) {
    const ratio = currentPrice / referencePrice;
    if (ratio > PRICE_POLLUTION_MAX_RATIO || ratio < PRICE_POLLUTION_MIN_RATIO) return visibleData;
  }

  const next = [...visibleData];
  next[next.length - 1] = {
    ...last,
    close: currentPrice,
    high: Math.max(last.high, currentPrice),
    low: Math.min(last.low, currentPrice),
  };
  return next;
}
