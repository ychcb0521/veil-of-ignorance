import type { TradeSignal } from './signalLibrary';
import { formatUTC8 } from './timeFormat';
import { TURING_REPLAY_MINUTE_MS, type TuringReplayArchive } from './turingCupReplayArchive';
import { turingCupSymbol } from './turingCupSymbol';

export function isDelayedTuringReplaySample(signal: Pick<TradeSignal, 'id' | 'turingReplaySample'>): boolean {
  return signal.turingReplaySample === true && signal.id.startsWith('turing-replay-sample-v1:');
}

/** One comparison entry per market at its first available minute candle. */
export function turingReplaySamples(archive: TuringReplayArchive): TradeSignal[] {
  return Object.entries(archive.markets).flatMap(([ticker, minutes]) => {
    const firstCandle = minutes.findIndex(minute => minute !== null);
    if (firstCandle < 0) return [];
    const symbol = turingCupSymbol(ticker);
    const timeMs = archive.anchorMs + firstCandle * TURING_REPLAY_MINUTE_MS;
    return [{ id: `turing-replay-sample-v2:${symbol}@${timeMs}`, symbol, timeMs, timeLabel: formatUTC8(timeMs),
      fallbackZone: '', turingReplaySample: true }];
  });
}
