import { expect, it, vi } from 'vitest';
import { collectFishQuality, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityFilterNeedsData, qualityFilterReadingKey, type QualityFilterReading } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { qualityFilterCell, qualityFilterColumns } from '@/lib/fish/qualityFilterColumns';
import { collapseQualityTableRows } from '@/lib/fish/qualityTableRows';
import { buildQualitySheets } from '@/lib/fish/qualityExport';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';

const T = Date.UTC(2026, 9, 20), M = 60_000;
const def = { id: 'test', name: '测试', short: 'T', definition: '', formula: 'raw = C', scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const, halfLifeHours: 6, avgHours: 24 };
const filter = (threshold = 5) => makeQualityBuyFilter('test:raw', '>', threshold, true, [def]);
const base = () => importQualityLibrary(enableQualityComparison(newQualityStudy(T)), ['LOWUSDT', 'HIGHUSDT'].map((symbol, i) => ({ id: symbol, symbol, timeMs: T + (i + 1) * 5 * M, timeLabel: '', fallbackZone: '' })));

it('runs only filters without any sell rules or price simulation, reuses readings and exports independent results', async () => {
  const study = base(), f = filter(), rows = qualityComparisonRows(study);
  study.sellPlans = study.sellPlans!.map(p => ({ ...p, buyFilters: [f] }));
  study.selectedRowIds = rows.map(r => r.id);
  const load: FishReconstructionLoader = vi.fn(async (row, from, cut, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => ({ openTime: from + i * plan.step, open: 1, close: row.symbol === 'LOWUSDT' ? 2 : 8, high: 9, low: 1, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 50, takerBuyVolume: .5 })));
  const results = vi.fn(), progress = vi.fn(), readings: QualityFilterReading[] = [];
  const run = () => collectFishQuality({ study, signal: new AbortController().signal, onResult: results, onProgress: progress, onFilterReading: r => readings.push(r) }, load, T + 30 * M);
  await run();
  expect(results).not.toHaveBeenCalled(); expect(readings).toHaveLength(2); expect(load).toHaveBeenCalledTimes(2);
  for (const [source, , cut, plan] of vi.mocked(load).mock.calls) { expect(plan.step).toBe(5 * M); expect(cut).toBeLessThanOrEqual(rows.find(r => r.source.symbol === source.symbol)!.enteredAt!); }
  expect(progress).toHaveBeenLastCalledWith({ done: 4, total: 4, current: '' });
  study.filterReadings = readings;
  expect(qualityFilterNeedsData(study, 'filter')).toBe(false);
  expect(qualityFilterColumns(study)).toHaveLength(1);
  const map = new Map(readings.map(r => [r.key, r]));
  expect(rows.map(row => qualityFilterCell(row, f, map))).toMatchObject([{ value: '2', status: '不满足' }, { value: '8', status: '满足' }]);
  const sheet = buildQualitySheets(study, rows)[0];
  expect(sheet.columns[5].header).toContain('过滤 · T raw'); expect(sheet.rows[0].slice(5, 7)).toEqual([2, '不满足']);
  study.sellPlans[0].buyFilters = [filter(1)];
  expect(qualityFilterColumns(study)).toHaveLength(2); // Same metric, different thresholds.
  expect(qualityFilterNeedsData(study, 'filter')).toBe(false);
  await run(); expect(load).toHaveBeenCalledTimes(2);
  expect(qualityFilterCell(rows[0], filter(1), map).status).toBe('满足');
});

it('keeps different entries in merged rows and distinguishes pending, errors, strict thresholds and measured zero', () => {
  const study = base(), row = qualityComparisonRows(study)[0], f = filter(0);
  const later = { ...row, id: 'later', enteredAt: row.enteredAt! + M };
  const rows = collapseQualityTableRows([row, { ...row, id: 'detector-copy', signalId: row.id }, later]);
  const map = new Map<string, QualityFilterReading>();
  expect(qualityFilterCell(rows[0], f, map)).toMatchObject({ value: '—', state: 'pending', status: '待计算 2/2' });
  map.set(qualityFilterReadingKey(row, f), { key: qualityFilterReadingKey(row, f), value: 0 });
  expect(qualityFilterCell(row, f, map)).toMatchObject({ value: '0', state: 'fail', status: '不满足' });
  map.set(qualityFilterReadingKey(later, f), { key: qualityFilterReadingKey(later, f), value: 1 });
  expect(qualityFilterCell(rows[0], f, map)).toMatchObject({ value: '0～1', state: 'mixed', status: '满足 1/2' });
  map.set(qualityFilterReadingKey(later, f), { key: qualityFilterReadingKey(later, f), error: '历史不足' });
  expect(qualityFilterCell(rows[0], f, map)).toMatchObject({ value: '—', state: 'error', status: '缺数据 1/2' });
  expect(qualityFilterCell(rows[0], f, map).detail).toContain('历史不足');
  study.sellPlans![0].buyFilters = [{ ...f, enabled: false }];
  expect(qualityFilterColumns(study)).toEqual([]);
});
