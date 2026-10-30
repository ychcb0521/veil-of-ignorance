import { expect, it, vi } from 'vitest';
import { definitionKey, BSS_DEF } from '@/lib/deepDig/features';
import { collectFishQuality, importQualityFish, importQualityLibrary, migrateQualityCaptureEntries, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityResultKey, qualityRunSamples, type FishQualityStudy, type QualityResult } from '@/lib/fish/quality';
import { enableQualityComparison, qualityComparisonStats, qualityDistribution, qualityPairedRows, qualityBatchRows } from '@/lib/fish/qualityComparison';
import { buildQualitySheets } from '@/lib/fish/qualityExport';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishSnapshot } from '@/lib/fish/algorithm';
const T = Date.UTC(2026, 9, 20), M = 60_000;
const snapshot = (threshold: number): FishSnapshot => ({ featureId: 'bss', featureShort: 'BSS', statistic: 'BSS', definitionKey: definitionKey({ ...BSS_DEF, formula: 'BSS = C' }), interval: '5m', scale: 1, threshold, direction: '>', average: 123, previousAverage: 0, startAverage: 1, cbi2: 1, cutoffMs: T });
const fish = (symbol: string, threshold: number): TradeSignal => ({ id: `${symbol}-${threshold}`, symbol, timeMs: T, timeLabel: '', fallbackZone: '', fish: snapshot(threshold) });
function study() { return enableQualityComparison(importQualityFish(newQualityStudy(T + M), [fish('AAAUSDT', 1), fish('AAAUSDT', 2), fish('BBBUSDT', 1), fish('CCCUSDT', 2)])); }
function seed(study: FishQualityStudy) {
  const rows = qualityComparisonRows(study), plans = study.sellPlans!;
  plans.forEach(p => { p.rule = { metric: p.metric, direction: '<', threshold: -1 }; });
  const result = (i: number, j: number, pct: number, extra: Partial<QualityResult> = {}): QualityResult => ({ key: qualityResultKey(rows[i], plans[j], 0), sampleId: rows[i].id, groupId: plans[j].id, evaluatedAt: T + 10 * M, status: 'closed', returnPct: pct, pnl: pct, ...extra });
  study.results = [result(0, 0, 10), result(0, 1, -5), result(1, 0, -20), result(1, 1, 3), result(2, 0, 999)];
  return { rows, plans, result };
}
it('keeps original captures/rules/results, freezes exactly two raw sell formulas and collapses duplicate fish across detecting rules', () => {
  const original = importQualityFish(newQualityStudy(T + M), [fish('AAAUSDT', 1), fish('AAAUSDT', 2)]);
  original.groups[0].rule = { metric: 'capture', direction: '<', threshold: 5 };
  const before = structuredClone(original), enabled = enableQualityComparison(original), rows = qualityComparisonRows(enabled);
  expect(enabled.sellPlans!.map(p => [p.snapshot.featureId, p.snapshot.statistic, p.rule])).toEqual([['state', 'state', undefined], ['cda', 'CDA', undefined]]);
  expect(enabled.sellPlans![0].snapshot.definitionKey).toContain('state ='); expect(enabled.sellPlans![1].snapshot.definitionKey).toContain('CDA =');
  expect(enabled.groups).toBe(original.groups); expect(original).toEqual(before); expect(enableQualityComparison(enabled)).toBe(enabled);
  expect(rows).toHaveLength(1); expect(rows[0].groups).toHaveLength(2); expect(Object.keys(rows[0].readings!)).toHaveLength(2);
  expect(enabled.samples).toHaveLength(2); expect(rows[0].enteredAt).toBe(T);
});
it('runs both independent sell algorithms on every fish with identical entries, regardless of which detector caught it', async () => {
  const s = study(), rows = qualityComparisonRows(s), results: QualityResult[] = [];
  const load = vi.fn(async (_r, from: number, cut: number, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => ({ openTime: from + i * plan.step, open: 100, high: 101, low: 99, close: 100, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 50, takerBuyVolume: .5 })));
  s.selectedRowIds = qualityComparisonRows(s).map(r => r.id);
  await collectFishQuality({ study: s, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => results.push(r) }, load, T + 10 * M);
  expect(results).toHaveLength(rows.length * 2);
  for (const row of rows) expect(results.filter(r => r.sampleId === row.id).map(r => [r.entryTime, r.entryPrice])).toEqual([[T, 100], [T, 100]]);
  for (const cohortIds of [[], [rows[1].id]]) {
    const legacy = { ...s, cohortIds }, unrestricted: QualityResult[] = [];
    expect(qualityBatchRows(legacy)).toEqual(rows); expect(qualityRunSamples(legacy)).toEqual(rows);
    await collectFishQuality({ study: legacy, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => unrestricted.push(r) }, load, T + 10 * M);
    expect(unrestricted).toHaveLength(rows.length * 2);
  }
  expect(qualityRunSamples({ ...s, cohortIds: [], selectedRowIds: [rows[1].id] })).toEqual([rows[1]]);
});
it('uses paired common valid samples instead of separate denominators and excludes stale/missing/unclosed results', () => {
  const s = study(), { rows, plans, result } = seed(s);
  const stats = qualityComparisonStats(s, rows, true);
  expect(stats.paired).toHaveLength(2); expect(stats.sells.map(v => [v.n, v.mean, v.worst])).toEqual([[2, -5, -20], [2, -1, -5]]);
  s.results[1] = result(0, 1, -5, { status: 'error' }); expect(qualityPairedRows(s, rows, true)).toEqual([rows[1]]);
  s.results[1] = result(0, 1, -5, { status: 'open' }); expect(qualityPairedRows(s, rows, true)).toEqual([rows[1]]);
  expect(qualityPairedRows(s, rows, false)).toHaveLength(2);
  s.results.push(result(2, 1, 7, { status: 'open', evaluatedAt: T + 11 * M }));
  expect(qualityPairedRows(s, rows, false)).not.toContain(rows[0]); // old floating valuation is not compared with a newer one
  plans[0].rule!.threshold = 5; expect(qualityPairedRows(s, rows, true)).toHaveLength(0);
});
it('compares detectors only through the selected shared sell rule, preserves overlapping membership and reports coverage', () => {
  const s = study(), { rows, plans } = seed(s);
  expect(qualityComparisonStats(s, rows, true).detectors.every(v => v.n === 0)).toBe(true);
  s.selectedSellId = plans[1].id;
  const selected = qualityComparisonStats(s, rows, true);
  expect(selected.detectors.map(v => [v.total, v.n, v.mean])).toEqual([[2, 2, -1], [2, 1, -5]]);
  s.selectedSellId = plans[0].id;
  expect(qualityComparisonStats(s, rows, true).detectors.map(v => v.mean)).toEqual([-5, 504.5]);
  expect(qualityComparisonStats(s, rows.slice(0, 1), true).detectors.map(v => v.n)).toEqual([1, 1]);
});
it('computes disjoint return bins, interpolated quantiles and no-sample values without inventing zeros', () => {
  const values = [-11, -10, -5, -.1, 0, 5, 10];
  const d = qualityDistribution(values.map(returnPct => ({ status: 'closed', returnPct } as QualityResult)));
  expect(d.bins).toEqual([1, 1, 2, 1, 1, 1]); expect(d.median).toBe(-.1); expect(d.p10).toBeCloseTo(-10.4); expect(d.winRate).toBeCloseTo(2 / 7 * 100);
  expect(qualityDistribution([])).toMatchObject({ n: 0, mean: null, worst: null, p10: null, winRate: null });
});
it('exports one row per detector with a single detector column and shared sell returns', () => {
  const s = study(), { rows } = seed(s); s.results[0] = {...s.results[0],adversePct:-4,drawdownPct:7,peakPct:12}; s.results[1] = {...s.results[1],adversePct:-9,drawdownPct:15,peakPct:17};
  const sheet = buildQualitySheets(s, rows.slice(0, 1))[0];
  expect(sheet.rows).toHaveLength(2); expect(sheet.columns).toHaveLength(43);
  expect(sheet.columns[1].header).toBe('运行状态（过滤 / 监测）');
  expect(sheet.rows[0][2]).toBe('鱼');
  // 每套方案：收益率、静态回撤、峰值涨幅、镜像涨幅及状态、持仓小时。
  expect(sheet.rows.map(r=>[...r.slice(7,10),...r.slice(24,27)])).toEqual([[10,4,12,-5,9,17],[10,4,12,-5,9,17]]);
  expect(sheet.columns.map(c => c.header).filter(h => h.endsWith('持仓小时'))).toHaveLength(2);
  expect(sheet.rows[0][41]).not.toEqual(sheet.rows[1][41]);
  expect(sheet.columns.slice(6).map(c => c.header)).toEqual(expect.arrayContaining([expect.stringContaining('状态 S 原始值'), expect.stringContaining('CDA 原始值')]));
});
it('compiles and evaluates the real S and CDA raw series as sells independently of any capture formula', async () => {
  const s = enableQualityComparison(importQualityFish(newQualityStudy(T + M), [fish('AAAUSDT', 1)]));
  s.sellPlans!.forEach(p => { p.rule = { metric: p.metric, direction: '<', threshold: p.metric === 'state' ? 2 : 101 }; });
  const results: QualityResult[] = [];
  s.selectedRowIds = qualityComparisonRows(s).map(r => r.id);
  await collectFishQuality({ study: s, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => results.push(r) }, async (_row, from, cut, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => { const time = from + i * plan.step, x = (time - T) / (5 * M), price = plan.step === M ? 100 : 100 + Math.sin(x / 7) + x * .001, q = 10000 * (1 + .1 * Math.cos(x / 5)); return { openTime: time, open: price, high: price + 1, low: price - 1, close: price, volume: q / price, quoteVolume: q, takerBuyQuoteVolume: q * (.55 + .1 * Math.sin(x / 9)), takerBuyVolume: q * .55 / price, refClose: 200 + Math.cos(x / 13) + x * .002 }; }), T + 10 * M);
  expect(results).toHaveLength(2);
  expect(results.map(r => r.reason)).not.toEqual(expect.arrayContaining([expect.stringContaining("缺失")]));
  expect(results.map(r => [r.status, r.entryTime, r.endTime, r.returnPct])).toEqual([['closed', T, T, 0], ['closed', T, T, 0]]);
  expect(results.every(r => Number.isFinite(r.exitReading))).toBe(true);
});

// 【用户要求】2026-10-26「在检查卖出算法时，需要将信号库中的信号也纳入进来（注意要与鱼舱里的鱼做区分）」
const libSignal = (symbol: string, patch: Partial<TradeSignal> = {}): TradeSignal => ({ id: `lib-${symbol}`, symbol, timeMs: T - 30 * M, timeLabel: '', fallbackZone: '', ...patch });
it('copies signal-library signals once at their signal time, keeps them apart from same-coin fish and leaves them out of capture-time migration', () => {
  const base = study(), withLib = importQualityLibrary(base, [libSignal('AAAUSDT', { timeMs: T }), libSignal('ZZZUSDT')], T + 2 * M);
  expect(importQualityLibrary(withLib, [libSignal('AAAUSDT', { timeMs: T }), libSignal('ZZZUSDT')])).toBe(withLib);
  const lib = withLib.samples.filter(v => v.origin === 'library');
  expect(lib.map(v => [v.source.symbol, v.enteredAt, v.basis, v.groups])).toEqual([['AAAUSDT', T, 'signal', []], ['ZZZUSDT', T - 30 * M, 'signal', []]]);
  // 与 AAAUSDT 那条鱼同币同时，仍各占一行
  const rows = qualityComparisonRows(withLib);
  expect(rows.filter(r => r.source.symbol === 'AAAUSDT').map(r => r.origin ?? 'fish').sort()).toEqual(['fish', 'library']);
  expect(qualityComparisonRows(base).map(r => r.id)).toEqual(rows.filter(r => r.origin !== 'library').map(r => r.id));
  expect(migrateQualityCaptureEntries(withLib).samples.filter(v => v.origin === 'library')).toEqual(lib);
  expect(importQualityLibrary({ ...base, tracking: false }, [libSignal('ZZZUSDT')]).samples).toHaveLength(base.samples.length + 1);
  const missing = importQualityLibrary(base, [libSignal('YYYUSDT', { timeMs: NaN })]).samples.at(-1)!;
  expect(missing).toMatchObject({ enteredAt: null, basis: 'missing', origin: 'library' });
});
it('runs the shared sells on library signals, counts them in the sell comparison and never in a detector', async () => {
  const s = importQualityLibrary(study(), [libSignal('ZZZUSDT')], T + 2 * M), rows = qualityComparisonRows(s), lib = rows.find(r => r.origin === 'library')!;
  const results: QualityResult[] = [];
  const load = vi.fn(async (_r, from: number, cut: number, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => ({ openTime: from + i * plan.step, open: 100, high: 101, low: 99, close: 100, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 50, takerBuyVolume: .5 })));
  s.selectedRowIds = qualityComparisonRows(s).map(r => r.id);
  await collectFishQuality({ study: s, signal: new AbortController().signal, onProgress: vi.fn(), onResult: r => results.push(r) }, load, T + 10 * M);
  expect(results.filter(r => r.sampleId === lib.id).map(r => [r.groupId, r.entryTime])).toEqual(s.sellPlans!.map(p => [p.id, T - 30 * M]));
  const plans = s.sellPlans!; plans.forEach(p => { p.rule = { metric: p.metric, direction: '<', threshold: -1 }; });
  s.results = rows.flatMap(row => plans.map(p => ({ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed' as const, returnPct: row === lib ? 50 : 1, pnl: 1 })));
  s.selectedSellId = plans[0].id;
  const stats = qualityComparisonStats(s, rows, true);
  expect(stats.paired).toContain(lib); expect(stats.sells[0].n).toBe(rows.length);
  expect(stats.detectors.every(d => d.total === rows.filter(r => r.groups.includes(d.group.id)).length && d.mean === 1)).toBe(true);
  const sheet = buildQualitySheets(s, [lib])[0];
  expect([sheet.rows[0][0],sheet.rows[0][2]]).toEqual(['ZZZUSDT', '信号库']); expect(sheet.rows[0][4]).toBe('');
});
it('does no market work without a choice and evaluates only the selected signal with both sell plans', async () => {
  const s = study(), rows = qualityComparisonRows(s), load = vi.fn(async (_row, from, cut, p) => Array.from({length:(cut-from)/p.step}, (_,i) => ({openTime:from+i*p.step,open:100,high:101,low:99,close:100,volume:1,takerBuyVolume:.5})));
  const onResult = vi.fn(), options = {study:s,signal:new AbortController().signal,onProgress:vi.fn(),onResult};
  await collectFishQuality(options,load,T+10*M); expect(load).not.toHaveBeenCalled(); expect(onResult).not.toHaveBeenCalled();
  s.selectedRowIds = [rows[1].id]; await collectFishQuality(options,load,T+10*M);
  expect(onResult).toHaveBeenCalledTimes(2); expect(onResult.mock.calls.every(([r])=>r.sampleId===rows[1].id)).toBe(true);
});

it('expands detector rows without multiplying trades, counts a signal once for sells, and attributes only the selected detector rows', async () => {
  const s = study(), {rows, plans} = seed(s), displays = qualityDisplayRows(s).filter(r => r.signalId === rows[0].id);
  expect(displays).toHaveLength(2); s.selectedRowIds = displays.map(r=>r.id);
  const values: QualityResult[] = [];
  await collectFishQuality({study:{...s,results:[],sellPlans:plans.map(p=>({...p,rule:undefined}))},signal:new AbortController().signal,onProgress:vi.fn(),onResult:r=>values.push(r)},async(_r,from,cut,p)=>Array.from({length:(cut-from)/p.step},(_,i)=>({openTime:from+i*p.step,open:100,high:100,low:100,close:100,volume:1,takerBuyVolume:.5})),T+10*M);
  expect(values).toHaveLength(2); expect(new Set(values.map(r=>r.sampleId))).toEqual(new Set([rows[0].id]));
  const all = qualityComparisonStats(s, displays, true); expect(all.sells.map(v=>v.n)).toEqual([1,1]);
  s.selectedSellId = plans[0].id;
  expect(qualityComparisonStats(s,displays.slice(0,1),true).detectors.map(v=>v.n)).toEqual([1,0]);
});
// 【用户要求】2026-10-26「运行完的币种，结果要立即显示出来」：按界面顺序评估，看得见的先出结果
it('evaluates rows in the on-screen order, re-reads that order after every row and finishes all sells of a row together', async () => {
  const s = importQualityLibrary(study(), [libSignal('XXXUSDT'), libSignal('ZZZUSDT')], T + 2 * M), rows = qualityComparisonRows(s);
  s.selectedRowIds = rows.map(r => r.id);
  expect(qualityComparisonRows(s)).toBe(rows); // 样本不变时复用
  const load = vi.fn(async (_r, from: number, cut: number, plan) => Array.from({ length: (cut - from) / plan.step }, (_, i) => ({ openTime: from + i * plan.step, open: 100, high: 101, low: 99, close: 100, volume: 1, quoteVolume: 100, takerBuyQuoteVolume: 50, takerBuyVolume: .5 })));
  const order: string[] = [], last = rows.at(-1)!.id, second = rows.at(-2)!.id;
  let priority: string[] = [last];
  await collectFishQuality({ study: s, signal: new AbortController().signal, onProgress: vi.fn(), priority: () => priority,
    onResult: r => { order.push(r.sampleId); if (order.length === 2) priority = [second, last]; } }, load, T + 10 * M);
  const rowsInOrder = order.filter((id, i) => order[i - 1] !== id);
  expect(rowsInOrder.slice(0, 2)).toEqual([last, second]);
  expect(order.slice(0, 4)).toEqual([last, last, second, second]);
  expect(new Set(order).size).toBe(rows.length); expect(order).toHaveLength(rows.length * 2);
});
