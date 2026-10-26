// 【用户要求】2026-10-26「在比较卖出的时候，再增加一些买入的过滤机制，比如只有符合状态S大于0.7才买入（选择权给我）」
import { expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectFishQuality, evaluateQualityFilter, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityFilterReadingKey, qualityFilterStatus, qualityResultKey, type QualityBuyFilter, type QualityFilterReading, type QualityResult } from '@/lib/fish/quality';
import { enableQualityComparison, qualityComparisonStats } from '@/lib/fish/qualityComparison';
import { makeQualityBuyFilter, qualityFilterChoices } from '@/lib/fish/qualityFilters';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';

const T = Date.UTC(2026, 9, 20), M = 60_000, STEP = 5 * M;
const def = { id: 'test', name: '测试', short: 'T', definition: '', formula: 'raw = C', scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const, halfLifeHours: 6, avgHours: 24 };
const filter = (threshold: number, direction: '<' | '>' = '>'): QualityBuyFilter => ({ id: 'f', label: '测试原值', metric: 'raw', direction, threshold, enabled: true,
  snapshot: { featureId: 'test', featureShort: 'T', definitionKey: definitionKey(def), statistic: 'raw', interval: '5m', scale: 1, unit: '', threshold, direction, cutoffMs: 0, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 } });
// 收盘价 = 该 K 线开盘时刻的分钟数（便于核对取的是哪根）
const loader = (): FishReconstructionLoader => vi.fn(async (_row, from, cut, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => { const t = from + i * plan.step, c = t / M % 1000; return { openTime: t, open: c, close: c, high: c, low: c, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 50, takerBuyVolume: .5 }; }));
const lib = (symbol: string, timeMs: number) => ({ id: symbol, symbol, timeMs, timeLabel: '', fallbackZone: '' });

it('offers raw / avg / avg₂ of the built-in features and freezes the chosen formula', () => {
  const keys = qualityFilterChoices().map(c => c.key);
  expect(keys).toEqual(expect.arrayContaining(['state:state', 'state:avg_state', 'state:avg_state_2', 'cbi2:CBI2']));
  const f = makeQualityBuyFilter('state:state', '>', .7);
  expect(f).toMatchObject({ label: '状态 S 原始值', metric: 'state', direction: '>', threshold: .7, enabled: true });
  expect(f.snapshot.definitionKey).toContain('state =');
  expect(() => makeQualityBuyFilter('nope:x', '>', 1)).toThrow();
});
it('reads the last bar that closed at or before the entry, never a later one', async () => {
  const entry = T + 7 * M; // 落在 T+5m 那根 K 线内部
  const s = importQualityLibrary(enableQualityComparison(newQualityStudy(T)), [lib('AAAUSDT', entry)]), row = qualityComparisonRows(s)[0];
  const load = loader(), r = await evaluateQualityFilter(row, filter(0), T + 60 * M, load, new AbortController().signal);
  expect(r.at).toBe(T + STEP); // 最后一根已收盘的是 [T, T+5m)
  expect(r.value).toBe((T / M) % 1000);
  expect(vi.mocked(load).mock.calls.every(c => c[2] <= entry)).toBe(true);
});
it('skips the sells of signals that fail, caches readings, and reports missing data instead of buying', async () => {
  const base = importQualityLibrary(enableQualityComparison(newQualityStudy(T)), [lib('LOWUSDT', T + 7 * M), lib('HIGHUSDT', T + 40 * M)]);
  const rows = qualityComparisonRows(base), low = rows[0], high = rows[1];
  const threshold = (T / M) % 1000 + 10; // LOW 读到 T 那根（不满足），HIGH 读到 T+35m 那根（满足）
  const s = { ...base, selectedRowIds: rows.map(r => r.id), buyFilters: [filter(threshold)] };
  const readings: QualityFilterReading[] = [], results: QualityResult[] = [], load = loader();
  await collectFishQuality({ study: s, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => results.push(r), onFilterReading: r => readings.push(r) }, load, T + 90 * M);
  expect(readings).toHaveLength(2);
  expect(new Set(results.map(r => r.sampleId))).toEqual(new Set([high.id]));
  const withReadings = { ...s, filterReadings: readings };
  expect(qualityFilterStatus(withReadings, low).state).toBe('fail'); expect(qualityFilterStatus(withReadings, high).state).toBe('pass');
  expect(qualityFilterStatus(s, low).state).toBe('pending');
  expect(qualityFilterStatus({ ...withReadings, buyFilters: [{ ...filter(threshold), enabled: false }] }, low).state).toBe('none');
  const again = vi.fn();
  await collectFishQuality({ study: withReadings, signal: new AbortController().signal, onProgress: vi.fn(), onResult: vi.fn(), onFilterReading: again }, load, T + 90 * M);
  expect(again).not.toHaveBeenCalled(); // 改门槛不需要重新取数
  const broken = { ...s, filterReadings: [{ key: readings[0].key, error: '缺 K 线' }, readings[1]] };
  expect(qualityFilterStatus(broken, low)).toMatchObject({ state: 'error' });
});
it('counts only bought signals in the sell comparison and reports how many were filtered', () => {
  const base = importQualityLibrary(enableQualityComparison(newQualityStudy(T)), [lib('AUSDT', T + 7 * M), lib('BUSDT', T + 40 * M), lib('CUSDT', T + 80 * M)]);
  const rows = qualityComparisonRows(base), plans = base.sellPlans!.map(p => ({ ...p, rule: { metric: p.metric, direction: '<' as const, threshold: -1 } }));
  const f = filter(5);
  const results = rows.flatMap((row, i) => plans.map(p => ({ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed' as const, returnPct: [10, -4, 2][i], pnl: 1 })));
  const study = { ...base, sellPlans: plans, results, buyFilters: [f], filterReadings: [] as QualityFilterReading[] };
  // A 满足、B 不满足、C 没有读数
  expect(rows.every(r => qualityFilterStatus(study, r).detail.includes('待读数'))).toBe(true);
  study.filterReadings = [rows[0], rows[1]].map((r, i) => ({ key: qualityFilterReadingKey(r, f), value: i ? 1 : 9 }));
  const stats = qualityComparisonStats(study, rows, true);
  expect(stats.filter).toEqual({ on: true, passed: 1, failed: 1, pending: 1, error: 0 });
  expect(stats.paired.map(r => r.source.symbol)).toEqual(['AUSDT']); expect(stats.sells[0].mean).toBe(10);
  const off = qualityComparisonStats({ ...study, buyFilters: [] }, rows, true);
  expect(off.filter.on).toBe(false); expect(off.paired).toHaveLength(3);
});
