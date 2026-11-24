import Decimal from 'decimal.js-light';

// Work in decimal prices so an exact threshold (including fractional ticks) stays equal.
export function staticDblDistancePct(close: number, line: number, atr: number, multiple: number): number {
  const gap = new Decimal(close).minus(line).abs();
  return gap.plus(new Decimal(atr).times(multiple)).times(100).div(close).toNumber();
}
