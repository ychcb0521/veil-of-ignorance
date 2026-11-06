import type { TradeSignal } from './signalLibrary';
import { formatUTC8 } from './timeFormat';
import { TURING_REPLAY_MINUTE_MS, type TuringReplayArchive } from './turingCupReplayArchive';
import { turingCupSymbol } from './turingCupSymbol';

// Fish Quality reads the last closed 5m bar in addition to its 48h window.
const HISTORY_MINUTES = 48 * 60 + 5;
const FOLLOWUP_MINUTES = 5;

/** One reproducible comparison entry per market, based on candle availability. */
export function turingReplaySamples(archive: TuringReplayArchive): TradeSignal[] {
  const shortArchive = archive.minutes < HISTORY_MINUTES + FOLLOWUP_MINUTES;
  const history = shortArchive ? Math.floor(archive.minutes / 2) : HISTORY_MINUTES;
  const followup = shortArchive ? 1 : FOLLOWUP_MINUTES;
  return Object.entries(archive.markets).flatMap(([ticker, minutes]) => {
    let gaps = 0;
    let bestGaps = Number.POSITIVE_INFINITY;
    let entry = -1;
    for (let slot = 0; slot <= archive.minutes - followup; slot++) {
      const time = archive.anchorMs + slot * TURING_REPLAY_MINUTE_MS;
      if (slot >= history && time % (5 * TURING_REPLAY_MINUTE_MS) === 0
        && minutes.slice(slot, slot + followup).every(Boolean) && gaps < bestGaps) {
        entry = slot;
        bestGaps = gaps;
        if (!gaps) break;
      }
      if (!minutes[slot]) gaps++;
      if (slot >= history && !minutes[slot - history]) gaps--;
    }
    if (entry < 0) entry = minutes.findIndex(minute => minute !== null);
    if (entry < 0) return [];
    const symbol = turingCupSymbol(ticker);
    const timeMs = archive.anchorMs + entry * TURING_REPLAY_MINUTE_MS;
    return [{ id: `turing-replay-sample-v1:${symbol}@${timeMs}`, symbol, timeMs, timeLabel: formatUTC8(timeMs),
      fallbackZone: '', turingReplaySample: true }];
  });
}
