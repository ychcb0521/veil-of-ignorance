import type { ResearchBar } from '@/lib/deepRsa/window';

/** Existing, valid quotes with explicitly zero amounts; missing fields are never zero. */
export function completeZeroTradeBar(bar: ResearchBar | undefined): boolean {
  return !!bar && Number.isFinite(bar.openTime)
    && [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0)
    && bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close)
    && bar.volume === 0 && bar.quoteVolume === 0 && bar.takerBuyVolume === 0 && bar.takerBuyQuoteVolume === 0;
}

/** Wait only for the undefined suffix associated with a verified zero-trade candle.
 * Once a finite reading returns, a later unrelated missing reading is an error again.
 * This also reconstructs the pending state on resume, without altering formula inputs. */
export function zeroTradeReadingPending(bars: readonly ResearchBar[], values: ArrayLike<number>, index: number): boolean {
  if (Number.isFinite(values[index])) return false;
  for (let i = index; i >= 0; i--) {
    // A delayed input such as prev(E) can first become undefined AFTER the zero bar.
    if (completeZeroTradeBar(bars[i])) return true;
    if (Number.isFinite(values[i])) return false;
  }
  return false;
}
