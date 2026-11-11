import type { FishHitRateRow, FishHitRateMode, FishHitRateTimeWindow, FishHitRateWindow } from './hitRate';
import type { TradeSignal } from '@/lib/signalLibrary';

export interface FishMissRoundSummary {
  id: string;
  completedAt: number;
  startedAt?: number;
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
  const { id, completedAt, startedAt, mode, count, window } = round;
  return { id, completedAt, mode, count, window, ...(startedAt === undefined ? {} : { startedAt }) };
}

export function mergeFishMissDirectories(local?: FishMissDirectory, incoming?: FishMissDirectory): FishMissDirectory {
  const rounds = new Map(local?.rounds.map(round => [round.id, round]));
  for (const round of incoming?.rounds ?? []) rounds.set(round.id, round);
  return { version: 1, rounds: [...rounds.values()].sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id)) };
}

interface FishMissEvidence { row: FishHitRateRow; startMs: number; anchorMs: number }
export interface FishMissUpdate {
  key: string;
  startedAt: number;
  runId: string;
  miss?: FishMissEvidence;
}
export interface FishActiveMisses { version: 1; updates: FishMissUpdate[]; indexedRounds: string[] }

export function fishMissUpdates(runId: string, startedAt: number, windows: readonly FishHitRateWindow[]): FishMissUpdate[] {
  return windows.flatMap(({ startMs, anchorMs, rows }) => rows.flatMap(row => {
    if (row.status === 'unverified') return [];
    const update = { key: missSampleKey(row.sample), startedAt, runId };
    if (row.status === 'hit') return [update];
    const { hit: _hit, ...evidence } = row;
    return [{ ...update, miss: { row: evidence, startMs, anchorMs } }];
  }));
}

export function mergeFishActiveMisses(local?: FishActiveMisses, incoming?: FishActiveMisses): FishActiveMisses {
  const updates = new Map(local?.updates.map(update => [update.key, update]));
  for (const update of incoming?.updates ?? []) {
    const previous = updates.get(update.key);
    if (!previous || update.startedAt > previous.startedAt || (update.startedAt === previous.startedAt && update.runId >= previous.runId)) {
      updates.set(update.key, update);
    }
  }
  return { version: 1, updates: [...updates.values()].sort((a, b) => a.key.localeCompare(b.key)),
    indexedRounds: [...new Set([...(local?.indexedRounds ?? []), ...(incoming?.indexedRounds ?? [])])].sort() };
}

export function activeMissWindows(state: FishActiveMisses): FishHitRateWindow[] {
  const windows = new Map<string, FishHitRateWindow>();
  for (const { miss } of state.updates) {
    if (!miss) continue;
    const { row, startMs, anchorMs } = miss;
    const key = `${startMs}|${anchorMs}`;
    const window = windows.get(key) ?? { startMs, anchorMs, rows: [], hits: [] };
    window.rows.push(row);
    windows.set(key, window);
  }
  return [...windows.values()];
}
