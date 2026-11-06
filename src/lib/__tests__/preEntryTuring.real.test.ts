/** Opt-in, read-only verification against the user's local archive; no market data is committed. */
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { FishScanner } from '@/lib/fishScanner';
import { loadTuringReplayArchive, parseTuringReplayArchive, readArchiveKlines } from '@/lib/turingCupReplayArchive';
import { turingReplaySamples } from '@/lib/turingReplaySamples';
import { importQualityLibrary, migrateQualityCaptureEntries, newQualityStudy, qualityComparisonRows, qualityMetricPlan, type QualityBuyFilter, type QualityResult } from '@/lib/fish/quality';
import { preEntrySignal, type PreEntryRecord } from '@/lib/fish/preEntryMonitor';

vi.mock('@/lib/turingCupReplayArchive', async original => ({ ...await original<typeof import('@/lib/turingCupReplayArchive')>(), loadTuringReplayArchive: vi.fn() }));
it.skipIf(!process.env.TURING_REPLAY_FIXTURE)('real Turing 50: explains initial history failure, finds a valid new entry and completes holding monitoring', async () => {
  const archive = parseTuringReplayArchive(readFileSync(process.env.TURING_REPLAY_FIXTURE!, 'utf8'));
  vi.mocked(loadTuringReplayArchive).mockResolvedValue(archive);
  const source = turingReplaySamples(archive).find(s => s.symbol === 'TURING:TURING 50')!;
  expect(source).toBeDefined();
  const def = { id: 'real-pipeline-check', name: 'pipeline', short: 'pipeline', definition: '', formula: 'raw = C', scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const };
  const f: QualityBuyFilter = { id: 'positive-close', label: '正价格链路验证', enabled: true, metric: 'raw', direction: '>', threshold: 0,
    snapshot: { featureId: def.id, featureShort: def.short, definitionKey: definitionKey(def), statistic: 'raw', interval: '5m', scale: 1, direction: '>', threshold: 0, cutoffMs: 0, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 } };
  const study = migrateQualityCaptureEntries(structuredClone(importQualityLibrary(newQualityStudy(), [source], Date.now(), 'turing')));
  expect(study.samples[0].enteredAt).toBe(archive.anchorMs);
  study.sellPlans = [{ id: 'sell', label: '链路验证', metric: 'raw', snapshot: f.snapshot, rule: { metric: 'raw', direction: '>', threshold: 0 } }];
  study.selectedRowIds = qualityComparisonRows(study).map(r => r.id);
  const network = vi.fn(async () => { throw Error('Offline pipeline reached an exchange'); });
  const scanner = new FishScanner(network);
  let initial!: QualityResult;
  await scanner.quality({ study, task: 'monitor', signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => { initial = r; } });
  expect(initial.status).toBe('error'); expect(initial.reason).toContain('图灵杯历史不足');
  const sample = qualityComparisonRows(study)[0], at = Date.now();
  let record: PreEntryRecord = { id: 'real', roundId: 'real-round', sample, status: 'queued', startTime: source.timeMs, cursor: source.timeMs, readings: [], updatedAt: at };
  await scanner.quality({ study, task: 'pre-entry', signal: new AbortController().signal, onProgress: vi.fn(), onResult: vi.fn(),
    preEntry: { round: { id: 'real-round', filters: [f], hours: 0, startedAt: at, updatedAt: at, state: 'running' }, records: [record], onRecord: r => { record = r; } } });
  const { plan } = qualityMetricPlan(f.snapshot, f.metric);
  expect(record.status).toBe('matched'); expect(record.matchedAt).toBe(archive.anchorMs + (plan.warm + 1) * plan.step);
  const signal = preEntrySignal(record)!;
  const follow = migrateQualityCaptureEntries(structuredClone(importQualityLibrary({ ...study, selectedRowIds: [] }, [signal], at, 'pre-entry')));
  expect(follow.samples.find(r => r.origin === 'pre-entry')!.enteredAt).toBe(record.matchedAt);
  follow.selectedRowIds = qualityComparisonRows(follow).filter(r => r.origin === 'pre-entry').map(r => r.id);
  let held!: QualityResult;
  await scanner.quality({ study: follow, task: 'monitor', signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => { held = r; } });
  const [entry] = readArchiveKlines(archive, 'TURING 50', '1m', { startTime: record.matchedAt, limit: 1 });
  expect(held.status, held.reason).toBe('closed'); expect(held.entryTime).toBe(record.matchedAt); expect(held.entryPrice).toBe(Number(entry[1]));
  expect(network).not.toHaveBeenCalled(); expect(source.timeMs).toBe(archive.anchorMs);
});
