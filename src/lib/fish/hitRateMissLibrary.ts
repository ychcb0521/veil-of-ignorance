import type { FishHitRateMode, FishHitRateTimeWindow, FishHitRateWindow } from './hitRate';
import type { TradeSignal } from '@/lib/signalLibrary';

export interface FishMissRoundSummary {
  id: string;
  completedAt: number;
  mode: FishHitRateMode;
  count: number;
  window: FishHitRateTimeWindow;
}
export interface FishMissRound extends FishMissRoundSummary {
  version: 1;
  windows: FishHitRateWindow[];
}
export interface FishMissDirectory { version: 1; rounds: FishMissRoundSummary[] }

export const missSampleKey = (sample: TradeSignal) =>
  `${sample.exchange ?? 'binance'}|${sample.market ?? 'crypto'}|${sample.symbol}|${sample.timeMs}`;

export function makeFishMissRound(summary: Omit<FishMissRoundSummary, 'count'>, windows: readonly FishHitRateWindow[]): FishMissRound | null {
  const misses = windows.flatMap(({ startMs, anchorMs, rows }) => {
    const missed = rows.filter(row => row.status === 'miss').map(({ hit: _hit, ...row }) => row);
    return missed.length ? [{ startMs, anchorMs, rows: missed, hits: [] }] : [];
  });
  const count = misses.reduce((total, window) => total + window.rows.length, 0);
  return count ? { version: 1, ...summary, count, windows: misses } : null;
}

export function fishMissRoundSummary(round: FishMissRound): FishMissRoundSummary {
  const { id, completedAt, mode, count, window } = round;
  return { id, completedAt, mode, count, window };
}

export function mergeFishMissDirectories(local?: FishMissDirectory, incoming?: FishMissDirectory): FishMissDirectory {
  const rounds = new Map(local?.rounds.map(round => [round.id, round]));
  for (const round of incoming?.rounds ?? []) rounds.set(round.id, round);
  return { version: 1, rounds: [...rounds.values()].sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id)) };
}
