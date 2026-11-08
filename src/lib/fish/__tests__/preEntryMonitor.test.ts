import { describe, expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectPreEntryMonitor, emptyPreEntryLibrary, mergePreEntryLibraries, preEntrySignal, type PreEntryRecord, type PreEntryRound } from '../preEntryMonitor';
import { evaluateQualityFilter, evaluateQualitySample, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityMetricPlan, type QualityBuyFilter, type QualitySample, type QualityGroup } from '../quality';
import type { FishReconstructionLoader } from '../reconstruction';
import { validateFishBars } from '../shared';

const MINUTE = 60_000, start = Date.UTC(2026, 2, 29, 5);
function filter(threshold = 102, direction: '<' | '>' = '>', formula = 'raw = C', interval = '1m'): QualityBuyFilter {
  const def = { id: 'pre-fixture', name: '买盘', short: '买盘', formula, definition: '', scale: 1, unit: '', positive: '1', control: '0', interval: interval as '1m' };
  return { id: `filter-${threshold}-${direction}`, label: '买盘', enabled: true, metric: 'raw', direction, threshold,
    snapshot: { featureId: def.id, featureShort: def.short, definitionKey: definitionKey(def), statistic: 'raw', interval: interval as '1m',
      scale: 1, direction, threshold, cutoffMs: 0, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 } };
}
const sample: QualitySample = { id: 'sample', source: { id: 'original', symbol: 'TURING:TURING 50', timeMs: start, timeLabel: '', fallbackZone: '' },
  enteredAt: start, basis: 'signal', importedAt: start, groups: [], origin: 'turing' };
function record(): PreEntryRecord { return { id: 'record', roundId: 'round', sample, status: 'queued', startTime: start, cursor: start, readings: [], updatedAt: start }; }
function round(filters = [filter()]): PreEntryRound { return { id: 'round', filters, startedAt: start, updatedAt: start, hours: 0, state: 'running' }; }
const loader: FishReconstructionLoader = async (_row, from, cut, plan, signal) => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return Array.from({ length: (cut - from) / plan.step }, (_, i) => {
    const openTime = from + i * plan.step, close = 100 + (openTime - start) / MINUTE;
    return { openTime, open: close, high: close + 1, low: close - 1, close, volume: 1, takerBuyVolume: .5, quoteVolume: close, takerBuyQuoteVolume: close / 2 };
  });
};
async function run(filters = [filter()], input = record(), load = loader, end = start + 20 * MINUTE, availableStart = start - 3 * 24 * 60 * MINUTE) {
  let last = input;
  await collectPreEntryMonitor({ round: round(filters), records: [input], onRecord: r => { last = r; } }, load, end, new AbortController().signal, vi.fn(), { start: async () => availableStart, end: async () => end });
  return last;
}

describe('动态买前监测', () => {
  it('stops at the first simultaneous strict match using only already closed candles', async () => {
    const result = await run([filter(102), filter(105, '<')]);
    expect(result.status).toBe('matched');
    expect(result.matchedAt).toBe(start + 4 * MINUTE);
    expect(result.readings.map(r => r.value)).toEqual([103, 103]);
    expect(result.readings.every(r => r.at! <= result.matchedAt!)).toBe(true);
    expect(sample.source.timeMs).toBe(start);
  });
  it('matches the static filter calculation at the chosen node, including rolling warmup', async () => {
    const f = filter(104, '>', 'raw = avg(C, 0.05)');
    const result = await run([f]);
    expect(result.status).toBe('matched');
    const staticReading = await evaluateQualityFilter({ ...sample, enteredAt: result.matchedAt! }, f, start + 20 * MINUTE, loader, new AbortController().signal);
    expect(result.readings[0].value).toBe(staticReading.value);
    expect(result.readings[0].at).toBe(staticReading.at);
    const previous = await evaluateQualityFilter({ ...sample, enteredAt: result.matchedAt! - MINUTE }, f, start + 20 * MINUTE, loader, new AbortController().signal);
    expect(previous.value).toBeLessThanOrEqual(f.threshold);
  });
  it('waits for all periods to close and does not use the final close of a forming 5m candle', async () => {
    const result = await run([filter(100, '>', 'raw = C', '5m')]);
    expect(result.matchedAt).toBe(start + 10 * MINUTE);
    expect(result.readings[0]).toMatchObject({ value: 105, at: start + 10 * MINUTE });
  });
  it('reports insufficient warmup without fabricating old candles or running a failing loader', async () => {
    const f = filter(0, '>', 'raw = avg(C, 24)'), load = vi.fn(loader);
    const result = await run([f], record(), load, start + 20 * MINUTE, start);
    expect(result.status).toBe('warming');
    expect(result.detail).toContain('预热');
    expect(load).not.toHaveBeenCalled();
    expect(qualityMetricPlan(f.snapshot, f.metric).plan.warm).toBeGreaterThan(20);
  });
  it('never skips an internal missing candle to find a later match', async () => {
    const missing: FishReconstructionLoader = async (...args) => {
      const bars = (await loader(...args)).filter(b => b.openTime !== start + 2 * MINUTE);
      validateFishBars(bars, args[2], (args[2] - args[1]) / args[3].step, args[3].step);
      return bars;
    };
    const result = await run([filter(110)], record(), missing);
    expect(result.status).toBe('error');
    expect(result.matchedAt).toBeUndefined();
    expect(result.cursor).toBe(start + 3 * MINUTE);
    expect(result.detail).toContain('缺根');
  });
  it('a future gap does not prevent an earlier valid match', async () => {
    const missing: FishReconstructionLoader = async (...args) => {
      const bars = (await loader(...args)).filter(b => b.openTime !== start + 12 * MINUTE);
      return bars;
    };
    expect((await run([filter(102)], record(), missing)).matchedAt).toBe(start + 4 * MINUTE);
  });
  it('pauses at an unevaluated minute and resumes to the same result with frozen filters', async () => {
    const aborter = new AbortController(); let paused = record();
    await expect(collectPreEntryMonitor({ round: round([filter(112)]), records: [paused], onRecord: r => {
      paused = r; if (r.status === 'scanning' && r.cursor >= start + 8 * MINUTE) aborter.abort();
    } }, loader, start + 20 * MINUTE, aborter.signal, vi.fn(), { start: async () => start - 3 * 24 * 60 * MINUTE })).rejects.toThrow();
    expect(paused.status).toBe('paused');
    const resumed = await run([filter(112)], paused);
    expect(resumed.matchedAt).toBe((await run([filter(112)])).matchedAt);
  });
  it('keeps unmatched records out of the downstream library, and preserves earlier rounds during merges', async () => {
    const unmatched = await run([filter(1000)]);
    expect(unmatched.status).toBe('unmatched'); expect(preEntrySignal(unmatched)).toBeNull();
    const saved = { version: 1 as const, rounds: [round()], records: [unmatched] };
    expect(mergePreEntryLibraries(saved, emptyPreEntryLibrary())).toEqual(saved);
  });
  it('imports the match as a new entry and runs the unchanged holding engine at that time', async () => {
    const result = await run(), signal = preEntrySignal(result)!;
    const original = importQualityLibrary(newQualityStudy(), [sample.source], start, 'turing');
    const imported = importQualityLibrary(original, [signal], start, 'pre-entry');
    const rows = qualityComparisonRows(imported);
    expect(rows).toHaveLength(2);
    const entry = rows.find(r => r.origin === 'pre-entry')!;
    expect(entry.enteredAt).toBe(result.matchedAt);
    expect(signal.preEntryMonitor).toMatchObject({ sourceId: 'original', sourceTime: start });
    const f = filter(105), plan: QualityGroup = { id: 'sell', label: 'sell', metric: 'raw', snapshot: f.snapshot, rule: { metric: 'raw', direction: '>', threshold: 105 } };
    const trade = await evaluateQualitySample(entry, plan, 0, start + 20 * MINUTE, loader, new AbortController().signal);
    expect(trade).toMatchObject({ status: 'closed', entryTime: result.matchedAt, entryPrice: 104 });
    expect(trade.endTime).toBeGreaterThan(result.matchedAt!);
    expect(original.samples[0].enteredAt).toBe(start);
  });
});
