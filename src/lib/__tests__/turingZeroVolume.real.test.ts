import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { BUILTIN_FEATURES } from '../deepDig/features';
import { PRE_ENTRY_INTRABAR_VERSION, PRE_ENTRY_ZERO_TRADE_VERSION, preEntrySignal, type PreEntryRecord } from '../fish/preEntryMonitor';
import { FishScanner } from '../fishScanner';
import { loadTuringReplayArchive, parseTuringReplayArchive } from '../turingCupReplayArchive';
import { turingReplaySamples } from '../turingReplaySamples';
import { createTuringQualityPlan } from '../fish/qualityTuringPlan';
import { makeQualitySellPlan } from '../fish/qualitySellPlans';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows } from '../fish/quality';

vi.mock('../turingCupReplayArchive', async original => ({ ...await original<typeof import('../turingCupReplayArchive')>(), loadTuringReplayArchive: vi.fn() }));

it.skipIf(!process.env.TURING_REPLAY_FIXTURE)('preserves the v2 error, waits in v3, admits only a recovered hit and stops at the real archive gap', async () => {
  const archive = parseTuringReplayArchive(readFileSync(process.env.TURING_REPLAY_FIXTURE!, 'utf8'));
  const zero = archive.markets['TURING 50'][990]!;
  expect(zero).not.toBeNull(); expect(zero.slice(4)).toEqual([0, 0, 0, 0]);
  expect(archive.markets['TURING 50'].slice(0, 1020).every(Boolean)).toBe(true);
  vi.mocked(loadTuringReplayArchive).mockResolvedValue(archive);
  const source = turingReplaySamples(archive).find(s => s.symbol === 'TURING:TURING 50')!;
  const study = importQualityLibrary(newQualityStudy(), [source], Date.now(), 'turing');
  study.selectedRowIds = qualityComparisonRows(study).map(r => r.id);
  const plan = createTuringQualityPlan(makeQualitySellPlan('cda:CDA', '>', 1000, BUILTIN_FEATURES), BUILTIN_FEATURES, 'buy');
  let record: PreEntryRecord = { id: 'zero', planId: plan.id, roundId: 'r', sample: qualityComparisonRows(study)[0], status: 'queued', startTime: source.timeMs, cursor: source.timeMs, readings: [], updatedAt: 1 };
  const network = vi.fn(async () => { throw Error('Offline replay requested an exchange'); });
  await new FishScanner(network).quality({ study, task: 'pre-entry', signal: new AbortController().signal, onProgress: vi.fn(), onResult: vi.fn(), preEntry: {
    round: { id: 'r', engine: PRE_ENTRY_INTRABAR_VERSION, plans: [plan], filters: [], hours: 17, state: 'running', startedAt: 1, updatedAt: 1 }, records: [record], onRecord: r => { record = r; },
  } });
  expect(record.status).toBe('error');
  expect(record.detail).toContain('观测 2026-03-30 05:31:00');
  const originalError = structuredClone(record);
  record = { ...record, status: 'queued', cursor: source.timeMs, endTime: undefined, detail: undefined };
  const runNew = async (hours: number) => new FishScanner(network).quality({ study, task: 'pre-entry', signal: new AbortController().signal, onProgress: vi.fn(), onResult: vi.fn(), preEntry: {
    round: { id: 'r', engine: PRE_ENTRY_ZERO_TRADE_VERSION, plans: [plan], filters: [], hours, state: 'running', startedAt: 1, updatedAt: 1 }, records: [record], onRecord: r => { record = r; },
  } });
  await runNew(17);
  expect(record.status, record.detail).toBe('unmatched'); expect(record.cursor).toBe(source.timeMs + 1020 * 60000);
  expect(record.zeroTradeWait!.lastAt).toBe(source.timeMs + 1017 * 60000);
  expect(preEntrySignal(record)).toBeNull(); expect(originalError.status).toBe('error');
  // Extend the identical frozen formula to the archive's real missing minute; do not skip it.
  record = { ...record, status: 'paused', endTime: undefined };
  await runNew(0);
  expect(record.status).toBe('error'); expect(record.detail).not.toContain('盘中指标存在缺失读数');
  expect(archive.markets['TURING 50'][3538]).toBeNull();
  expect(record.cursor).toBe(source.timeMs + 3538 * 60000);
  expect(record.detail).toMatch(/缺口|缺根|不连续|历史不足/);
  expect(preEntrySignal(record)).toBeNull();
  const lateStart = source.timeMs + 991 * 60000;
  const recoveredPlan = createTuringQualityPlan(makeQualitySellPlan('cda:CDA', '<', 1000, BUILTIN_FEATURES), BUILTIN_FEATURES, 'recovered');
  record = { id: 'recovered', roundId: 'recovered', planId: recoveredPlan.id, status: 'queued', startTime: lateStart, cursor: lateStart, updatedAt: 1, readings: [],
    sample: { ...qualityComparisonRows(study)[0], enteredAt: lateStart, source: { ...source, timeMs: lateStart } } };
  await new FishScanner(network).quality({ study, task: 'pre-entry', signal: new AbortController().signal, onProgress: vi.fn(), onResult: vi.fn(), preEntry: {
    round: { id: 'recovered', engine: PRE_ENTRY_ZERO_TRADE_VERSION, plans: [recoveredPlan], filters: [], hours: 1, state: 'running', startedAt: 1, updatedAt: 1 }, records: [record], onRecord: r => { record = r; },
  } });
  expect(record.status,record.detail).toBe('matched'); expect(record.matchedAt).toBe(lateStart + 60000);
  expect(record.zeroTradeWait).toEqual({ count: 1, firstAt: lateStart, lastAt: lateStart });
  expect(preEntrySignal(record)?.timeMs).toBe(lateStart + 60000);
  expect(Number.isFinite(record.readings[0].value)).toBe(true);
  console.log('ZERO_TRADE_COMPARISON', JSON.stringify({ original: originalError.detail, waitedAt: record.zeroTradeWait?.lastAt, matchedAt: record.matchedAt, reading: record.readings[0].value }));
  expect(network).not.toHaveBeenCalled();
}, 60000);
