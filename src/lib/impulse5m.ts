export const IMPULSE_5M_VERSION = 'impulse-low-5m-v1';
export const IMPULSE_5M_STEP = 300_000;
export const IMPULSE_5M_BASELINE = 24;
export interface Impulse5mBar {
  timestamp: number; open: number; high: number; low: number; close: number;
  turnover?: number | null; takerBuyTurnover?: number | null;
}

function median(values: number[]) {
  values.sort((a, b) => a - b);
  return (values[11] + values[12]) / 2;
}

/** Inputs are closed Binance 5m candles, with no BTC reference. */
export function confirmedImpulse5m(tip: Impulse5mBar, baseline: readonly Impulse5mBar[], preceding?: Impulse5mBar) {
  const STEP = IMPULSE_5M_STEP;
  if (baseline.length !== IMPULSE_5M_BASELINE || tip.turnover == null || tip.takerBuyTurnover == null ||
      !(tip.turnover > 0) || !(tip.high > tip.low)) return;
  const volumes = baseline.map(candle => candle.turnover ?? NaN);
  const ranges = baseline.map((candle, i) => {
    const prior = i === 0 ? preceding : baseline[i - 1];
    return !prior || candle.timestamp - prior.timestamp !== STEP ? candle.high - candle.low :
      Math.max(candle.high - candle.low, Math.abs(candle.high - prior.close), Math.abs(candle.low - prior.close));
  });
  const typicalRange = median(ranges);
  const volume = median(volumes);
  const body = tip.close - tip.open;
  const width = tip.high - tip.low;
  const ceiling = Math.max(...baseline.slice(-6).map(candle => candle.high));
  const base = Math.min(...baseline.slice(-4).map(candle => candle.low));
  if (volumes.every(value => Number.isFinite(value) && value >= 0) && typicalRange > 0 && volume > 0 && base > 0 && tip.open > 0 &&
    body / tip.open >= .006 && body >= 1.45 * typicalRange && tip.close > ceiling + .1 * typicalRange &&
    body / width >= .55 && (tip.close - tip.low) / width >= .77 && tip.open / base - 1 <= .025 &&
    tip.turnover >= 1.5 * volume && tip.takerBuyTurnover / tip.turnover >= .58 && tip.takerBuyTurnover <= tip.turnover) {
    return { low: tip.low, high: tip.high, close: tip.close, confirmedAt: tip.timestamp + IMPULSE_5M_STEP };
  }
}
