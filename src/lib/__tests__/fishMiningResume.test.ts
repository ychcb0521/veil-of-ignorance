import { expect, it, vi } from 'vitest';
import { FishScanner, type FishScanCheckpoint } from '@/lib/fishScanner';
import type { FishDataAdapter } from '@/lib/fish/adapters';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { intervalMs } from '@/lib/deepRsa/marketData';
import type { TradeSignal } from '@/lib/signalLibrary';
const cut = Date.UTC(2026, 3, 10, 16), step = 300_000;
const feature = { ...CBI2_DEF, id: 'resume', formula: 'P = C', scale: 1, unit: '' };
const algorithm = { direction: '>' as const, threshold: 100, constraints: [] };
function adapter(): FishDataAdapter {
  const markets = ['AAA', 'BBB', 'CCC', 'DDD'].map(base => ({ base, symbol: `${base}USDT`, instrument: `${base}USDT`, multiplier: 1 }));
  return { exchange: 'binance', list: vi.fn(async () => markets), btc: () => markets[0], taker: async (_market, bars) => bars,
    candles: vi.fn(async (_market, cutoff, _signal, query) => Array.from({ length: query!.count }, (_, i) => {
      const time = cutoff - (query!.count - i) * intervalMs(query!.interval), close = time < cut - 5 * step ? 99 : 101;
      return { openTime: time, open: close, close, high: close + 1, low: close - 1, volume: 100, quoteVolume: 10000, takerBuyQuoteVolume: 6000, takerBuyVolume: null };
    })) };
}
it.each([false, true])('resumes an interrupted mining anchor without fetching or calculating completed markets again (multi=%s)', async multi => {
  const venue = adapter(), checkpoint: FishScanCheckpoint = new Map();
  const scanner = new FishScanner(vi.fn(async () => new Response(JSON.stringify({ serverTime: cut + step }))) as typeof fetch, undefined, undefined, { binance: venue });
  const settings = { anchorMs: cut, feature, algorithm, ...(multi ? { algorithms: [{ feature, algorithm }, { feature, algorithm: { ...algorithm, threshold: 100.5 } }], combination: 'or' as const } : {}) };
  const first = new AbortController();
  const interrupted = await scanner.scan({ ...settings, checkpoint, signal: first.signal, onProgress: () => {}, onSignal: () => first.abort() });
  expect(interrupted.status).toBe('cancelled'); expect(checkpoint.size).toBe(multi ? 2 : 1);
  const completedBefore = [...checkpoint.values()].flatMap(results => [...results.keys()]);
  expect(completedBefore).toContain('binance|crypto|AAAUSDT');
  const hits: TradeSignal[] = [], progress = vi.fn();
  const result = await scanner.scan({ ...settings, checkpoint, signal: new AbortController().signal, onProgress: progress, onSignal: s => hits.push(s) });
  expect(result.status).toBe('complete'); expect(result.done).toBe(4); expect(result.counts.hit).toBe(4);
  expect(hits.map(s => s.symbol).sort()).toEqual(['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT']);
  expect(vi.mocked(venue.candles).mock.calls.filter(([market]) => market.symbol === 'AAAUSDT')).toHaveLength(1);
  const changed = { ...settings, algorithms: undefined, algorithm: { ...algorithm, threshold: 110 } };
  const changedHits = vi.fn();
  await scanner.scan({ ...changed, checkpoint, signal: new AbortController().signal, onProgress: () => {}, onSignal: changedHits });
  expect(changedHits).not.toHaveBeenCalled(); // A different rule must never reuse previous decisions.
  expect(vi.mocked(venue.candles).mock.calls.filter(([market]) => market.symbol === 'AAAUSDT')).toHaveLength(2);
  const baseline: TradeSignal[] = [];
  await scanner.scan({ ...settings, signal: new AbortController().signal, onProgress: () => {}, onSignal: s => baseline.push(s) });
  const ordered = (rows: TradeSignal[]) => rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  expect(ordered(hits)).toEqual(ordered(baseline)); // Resume must preserve every signal and detector snapshot.
});


it('retries transiently failed markets instead of caching an error as a completed decision', async () => {
  const venue = adapter(), load = venue.candles;
  let failed = false;
  venue.candles = vi.fn(async (...args: Parameters<typeof load>) => {
    if (args[0].symbol === 'AAAUSDT' && !failed) { failed = true; throw new Error('temporary network failure'); }
    return load(...args);
  });
  const checkpoint: FishScanCheckpoint = new Map();
  const scanner = new FishScanner(vi.fn(async () => new Response(JSON.stringify({ serverTime: cut + step }))) as typeof fetch, undefined, undefined, { binance: venue });
  const settings = { anchorMs: cut, feature, algorithm, checkpoint, onProgress: () => {}, signal: new AbortController().signal };
  const first = await scanner.scan({ ...settings, onSignal: () => {} });
  expect(first.counts.failed).toBe(1);
  const hits: TradeSignal[] = [];
  const second = await scanner.scan({ ...settings, onSignal: s => hits.push(s) });
  expect(second.counts.failed).toBe(0); expect(hits).toHaveLength(4);
  expect(vi.mocked(venue.candles).mock.calls.filter(([market]) => market.symbol === 'AAAUSDT')).toHaveLength(2);
  expect(vi.mocked(venue.candles).mock.calls.filter(([market]) => market.symbol === 'BBBUSDT')).toHaveLength(1);
});
