import { expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectPreEntryMonitor, preEntrySignal, PRE_ENTRY_INTRABAR_VERSION, PRE_ENTRY_ZERO_TRADE_VERSION, type PreEntryRecord, type PreEntryRound } from '../preEntryMonitor';
import type { QualityGroup } from '../quality';
import type { FishReconstructionLoader } from '../reconstruction';

const M = 60000, T = Date.UTC(2026, 2, 29, 5);
const plan = (formula = 'raw = E'): QualityGroup => ({ id: 'buy', label: '均价', metric: 'raw', initialization: 'turing-origin-v1',
  rule: { metric: 'raw', direction: '>', threshold: 100 }, snapshot: { featureId: 'test', definitionKey: definitionKey({ formula, positive: '1', control: '0', interval: '5m' }),
    statistic: 'raw', interval: '5m', scale: 1, threshold: 100, direction: '>', cutoffMs: T, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 } });
const load: FishReconstructionLoader = async (_row, from, cut, p) => Array.from({ length: (cut - from) / p.step }, (_, i) => {
  const at = from + i * p.step, zero = at === T + 5 * M, quote = at >= T + 6 * M ? 200 : 20;
  return { openTime: at, open: 100, high: 100, low: 100, close: 100, volume: zero ? 0 : 1, quoteVolume: zero ? 0 : quote, takerBuyVolume: zero ? 0 : .5, takerBuyQuoteVolume: zero ? 0 : quote / 2 };
});
async function run(engine: PreEntryRound['engine'], p = plan(), read = load, previous?: PreEntryRecord, symbol = 'TURING:TURING 50') {
  let record: PreEntryRecord = previous ?? { id: 'record', planId: p.id, roundId: 'r', status: 'queued', startTime: T, cursor: T, readings: [], updatedAt: 1,
    sample: { id: 'sample', enteredAt: T, importedAt: T, basis: 'signal', groups: [], source: { id: 'signal', symbol, timeMs: T, timeLabel: '', fallbackZone: '' } } };
  await collectPreEntryMonitor({ round: { id: 'r', engine, plans: [p], filters: [], hours: 0, startedAt: 1, updatedAt: 1, state: 'running' }, records: [record], onRecord: next => { record = next; } },
    read, T + 10 * M, new AbortController().signal, vi.fn(), { start: async () => symbol.startsWith('TURING:') ? T : undefined });
  return record;
}

it('waits at the zero-trade observation and freezes the first recovered hit, while v2 still stops', async () => {
  expect(await run(PRE_ENTRY_INTRABAR_VERSION)).toMatchObject({ status: 'error', detail: expect.stringContaining('缺失读数') });
  const result = await run(PRE_ENTRY_ZERO_TRADE_VERSION);
  expect(result).toMatchObject({ status: 'matched', matchedAt: T + 7 * M, readings: [{ key: 'primary', value: 200, at: T + 7 * M }], zeroTradeWait: { count: 1, firstAt: T + 6 * M, lastAt: T + 6 * M } });
  const resumed = await run(PRE_ENTRY_ZERO_TRADE_VERSION, plan(), load, { ...result, status: 'paused', cursor: T + 6 * M, matchedAt: undefined, readings: [] });
  expect(resumed.matchedAt).toBe(result.matchedAt); expect(resumed.readings).toEqual(result.readings); expect(resumed.zeroTradeWait).toEqual(result.zeroTradeWait);
});

it('does not admit a finite price-only condition during a zero-trade minute', async () => {
  const p = plan(`raw = if(T >= ${T + 5 * M}, C, 0)`); p.rule!.threshold = 50;
  expect(await run(PRE_ENTRY_ZERO_TRADE_VERSION, p)).toMatchObject({ status: 'matched', matchedAt: T + 7 * M, zeroTradeWait: { count: 1 } });
});

it('keeps real gaps, missing amount fields and unrelated later undefined readings as errors', async () => {
  const gap: FishReconstructionLoader = async (...args) => (await load(...args)).filter(b => b.openTime !== T + 6 * M);
  const gapResult = await run(PRE_ENTRY_ZERO_TRADE_VERSION, plan(), gap);
  expect(gapResult.status).toBe('error'); expect(preEntrySignal(gapResult)).toBeNull();
  const missing: FishReconstructionLoader = async (...args) => (await load(...args)).map(b => b.openTime === T + 5 * M ? { ...b, quoteVolume: null } : b);
  const missingResult = await run(PRE_ENTRY_ZERO_TRADE_VERSION, plan(), missing);
  expect(missingResult.status).toBe('error'); expect(preEntrySignal(missingResult)).toBeNull();
  const p = plan(`raw = if(T >= ${T + 5 * M}, 0 / 0, E)`); p.rule!.threshold = 1000;
  const undefinedResult = await run(PRE_ENTRY_ZERO_TRADE_VERSION, p);
  expect(undefinedResult.status).toBe('error'); expect(preEntrySignal(undefinedResult)).toBeNull();
});

it('waits for dependent readings after a fully zero candle and preserves real-market behavior', async () => {
  const p = plan('raw = prev(E)'); p.snapshot.interval = '1m';
  expect(await run(PRE_ENTRY_ZERO_TRADE_VERSION, p)).toMatchObject({ status: 'matched', matchedAt: T + 8 * M, zeroTradeWait: { count: 2 } });
  const real = plan(); delete real.initialization;
  const result = await run(PRE_ENTRY_ZERO_TRADE_VERSION, real, load, undefined, 'AAAUSDT');
  expect(result.status).toBe('error'); expect(result.zeroTradeWait).toBeUndefined();
});
