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
  const withReadings = { ...s, filterReadings: readings }, plan = s.sellPlans![0];
  expect(qualityFilterStatus(withReadings, low, plan).state).toBe('fail'); expect(qualityFilterStatus(withReadings, high, plan).state).toBe('pass');
  expect(qualityFilterStatus(s, low, plan).state).toBe('pending');
  expect(qualityFilterStatus({ ...withReadings, buyFilters: [{ ...filter(threshold), enabled: false }] }, low, plan).state).toBe('none');
  const again = vi.fn();
  await collectFishQuality({ study: withReadings, signal: new AbortController().signal, onProgress: vi.fn(), onResult: vi.fn(), onFilterReading: again }, load, T + 90 * M);
  expect(again).not.toHaveBeenCalled(); // 改门槛不需要重新取数
  const broken = { ...s, filterReadings: [{ key: readings[0].key, error: '缺 K 线' }, readings[1]] };
  expect(qualityFilterStatus(broken, low, plan)).toMatchObject({ state: 'error' });
});
it('counts only bought signals in the sell comparison and reports how many were filtered', () => {
  const base = importQualityLibrary(enableQualityComparison(newQualityStudy(T)), [lib('AUSDT', T + 7 * M), lib('BUSDT', T + 40 * M), lib('CUSDT', T + 80 * M)]);
  const rows = qualityComparisonRows(base), plans = base.sellPlans!.map(p => ({ ...p, rule: { metric: p.metric, direction: '<' as const, threshold: -1 } }));
  const f = filter(5);
  const results = rows.flatMap((row, i) => plans.map(p => ({ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed' as const, returnPct: [10, -4, 2][i], pnl: 1 })));
  const study = { ...base, sellPlans: plans, results, buyFilters: [f], filterReadings: [] as QualityFilterReading[] };
  // A 满足、B 不满足、C 没有读数
  expect(rows.every(r => qualityFilterStatus(study, r, plans[0]).detail.includes('待读数'))).toBe(true);
  study.filterReadings = [rows[0], rows[1]].map((r, i) => ({ key: qualityFilterReadingKey(r, f), value: i ? 1 : 9 }));
  const stats = qualityComparisonStats(study, rows, true);
  // 旧版本的全局过滤对两套方案都生效
  expect(stats.filter.plans.map(({ plan: _plan, ...v }) => v)).toEqual([{ on: true, passed: 1, failed: 1, pending: 1, error: 0 }, { on: true, passed: 1, failed: 1, pending: 1, error: 0 }]);
  expect(stats.sells.map(v => v.sample.map(r => r.source.symbol))).toEqual([['AUSDT'], ['AUSDT']]); expect(stats.sells[0].mean).toBe(10);
  const off = qualityComparisonStats({ ...study, buyFilters: [] }, rows, true);
  expect(off.filter.on).toBe(false); expect(off.paired).toHaveLength(3);
});

// 【用户要求】2026-10-26「每一个过滤门槛与卖出算法绑定：每个卖出算法有特定的过滤标准，而不是公用一个过滤标准」
it('binds buy filters to each sell plan: one plan filters, the other buys everything, in evaluation, stats and status', async () => {
  const base = importQualityLibrary(enableQualityComparison(newQualityStudy(T)), [lib('LOWUSDT', T + 7 * M), lib('HIGHUSDT', T + 40 * M)]);
  const rows = qualityComparisonRows(base), [low, high] = rows;
  const threshold = (T / M) % 1000 + 10, [sPlan, cPlan] = base.sellPlans!;
  const s = { ...base, selectedRowIds: rows.map(r => r.id), sellPlans: [{ ...sPlan, buyFilters: [filter(threshold)] }, { ...cPlan, buyFilters: [] }] };
  const readings: QualityFilterReading[] = [], results: QualityResult[] = [];
  await collectFishQuality({ study: s, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => results.push(r), onFilterReading: r => readings.push(r) }, loader(), T + 90 * M);
  // 状态 S 方案只评估满足条件的 HIGH；CDA 方案没设过滤，两条都评估
  expect(results.filter(r => r.groupId === sPlan.id).map(r => r.sampleId)).toEqual([high.id]);
  expect(new Set(results.filter(r => r.groupId === cPlan.id).map(r => r.sampleId))).toEqual(new Set([low.id, high.id]));
  const done = { ...s, filterReadings: readings };
  expect(qualityFilterStatus(done, low, done.sellPlans[0]).state).toBe('fail');
  expect(qualityFilterStatus(done, low, done.sellPlans[1]).state).toBe('none');
  // 统计：各方案只算自己买入的
  const ruled = { ...done, sellPlans: done.sellPlans.map(p => ({ ...p, rule: { metric: p.metric, direction: '<' as const, threshold: -1 } })) };
  ruled.results = rows.flatMap((row, i) => ruled.sellPlans.map(p => ({ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed' as const, returnPct: [3, 7][i], pnl: 1 })));
  const stats = qualityComparisonStats(ruled, rows, true);
  expect(stats.filter.on).toBe(true);
  expect(stats.filter.plans.map(v => [v.on, v.passed, v.failed])).toEqual([[true, 1, 1], [false, 0, 0]]);
  expect(stats.sells.map(v => [v.n, v.mean])).toEqual([[1, 7], [2, 5]]);
});
it('materializes the legacy shared filter onto every plan before one plan is edited', async () => {
  const { materializePlanBuyFilters } = await import('@/lib/fish/quality');
  const base = enableQualityComparison(newQualityStudy(T)), f = filter(1);
  const legacy = { ...base, buyFilters: [f] }, done = materializePlanBuyFilters(legacy);
  expect(done.buyFilters).toBeUndefined();
  expect(done.sellPlans!.map(p => p.buyFilters)).toEqual([[f], [f]]);
  expect(done.sellPlans![0].buyFilters).not.toBe(done.sellPlans![1].buyFilters);
  expect(materializePlanBuyFilters(base)).toBe(base);
});

it('gives the same sell comparison before and after a run and only filters saved open trades on later edits', async () => {
  const base = importQualityLibrary(enableQualityComparison(newQualityStudy(T)), [lib('LOWUSDT', T + 7 * M), lib('HIGHUSDT', T + 40 * M)]);
  const rows = qualityComparisonRows(base);
  const study = { ...base, selectedRowIds: rows.map(r => r.id), sellPlans: [{ ...base.sellPlans![0], snapshot: filter(0).snapshot, metric: 'raw', execution: undefined, rule: { metric: 'raw', direction: '<' as const, threshold: -1 } }] };
  const f = filter(T / M % 1000 + 10);
  const run = async (s: typeof study, mode?: 'filter' | 'filter-only' | 'restart', now = T + 90 * M) => {
    const results = [...s.results], readings = [...(s.filterReadings ?? [])], load = vi.fn(loader());
    await collectFishQuality({ study: s, mode, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => { results.push(r); }, onFilterReading: r => { readings.push(r); } }, load, now);
    return { study: { ...s, results, filterReadings: readings }, load };
  };
  const before = await run({ ...study, buyFilters: [f] });
  const all = await run(study);
  expect(all.study.results.every(r => r.status === 'open' && !r.complete)).toBe(true);
  const after = await run({ ...all.study, buyFilters: [f] }, 'filter');
  expect(after.study.results).toEqual(all.study.results); // no sell callbacks, even for incomplete/open results
  expect(after.load.mock.calls.every(c => c[3].step === STEP)).toBe(true); // entry readings only
  const stats = (s: typeof study) => qualityComparisonStats(s, rows, false);
  expect(stats(after.study).sells[0].sample.map(r => r.id)).toEqual(stats(before.study).sells[0].sample.map(r => r.id));
  expect(stats(after.study).sells).toEqual(stats(before.study).sells);
  for (const filters of [[filter(-1)], [filter(9999)], [{ ...f, direction: '<' as const }], [{ ...f, enabled: false }], []]) {
    const edited = await run({ ...after.study, buyFilters: filters }, 'filter', T + 180 * M);
    expect(edited.load).not.toHaveBeenCalled();
    expect(edited.study.results).toEqual(all.study.results);
  }
  const completed = { ...all.study, results: all.study.results.map(r => ({ ...r, status: 'closed' as const, complete: true, returnPct: 999 })) };
  expect((await run(completed)).load).not.toHaveBeenCalled();
  const restarted = await run(completed, 'restart', T + 180 * M);
  expect(restarted.load).toHaveBeenCalled();
  expect(restarted.study.results.slice(completed.results.length)).toHaveLength(2);
  expect(restarted.study.results.slice(completed.results.length).every(r => r.evaluatedAt === T + 180 * M && r.returnPct !== 999)).toBe(true);
  const replayed = await run(all.study, 'restart', T + 180 * M);
  expect(replayed.load.mock.calls.some(c => c[3].step === M && c[1] === rows[0].enteredAt)).toBe(true);
  const recovered = await run({ ...after.study, filterReadings: after.study.filterReadings.map((r, i) => i ? r : { key: r.key, error: '网络失败' }) }, 'restart');
  expect(recovered.study.filterReadings).toHaveLength(after.study.filterReadings.length + 1);
  const refreshed = await run(all.study, undefined, T + 180 * M);
  expect(refreshed.load).toHaveBeenCalled(); // explicit refresh still advances open trades
  const widened = await run({ ...before.study, buyFilters: [] }, 'filter');
  expect(widened.load.mock.calls.every(c => c[0].symbol === 'LOWUSDT')).toBe(true);
  expect(widened.study.results).toHaveLength(2); // only the previously excluded signal is evaluated
  const changedMetric = await run({ ...after.study, buyFilters: [{ ...f, metric: '结果' }] }, 'filter');
  expect(changedMetric.load).toHaveBeenCalled();
  expect(changedMetric.load.mock.calls.every(c => c[3].step === STEP)).toBe(true);
  expect(changedMetric.study.results).toEqual(all.study.results);
  const notStarted = await run({ ...study, buyFilters: [f] }, 'filter-only');
  expect(notStarted.study.filterReadings).toHaveLength(2);
  expect(notStarted.study.results).toHaveLength(0);
});
