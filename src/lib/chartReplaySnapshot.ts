interface TimedCandle { timestamp: number }

/** The imperative replay loop can be ahead of React's 250ms snapshot. Do not
 * replace its data (and clear async indicators) when it already holds every
 * timestamp, including candles waiting for an indicator callback. A missing
 * candle inside native history still requires the complete snapshot. */
export function liveChartCoversSnapshot(snapshot: readonly TimedCandle[], native: readonly TimedCandle[], queued: readonly TimedCandle[]): boolean {
  if (!snapshot.length || !native.length) return false;
  let index = 0;
  for (const bar of native) {
    if (bar.timestamp !== snapshot[index].timestamp) return false;
    if (++index === snapshot.length) return true;
  }
  let last = native[native.length - 1].timestamp;
  for (const bar of queued) {
    if (bar.timestamp <= last) continue;
    if (bar.timestamp !== snapshot[index].timestamp) return false;
    last = bar.timestamp;
    if (++index === snapshot.length) return true;
  }
  return false;
}
