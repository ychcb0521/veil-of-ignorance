import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFishQuality } from '@/hooks/useFishQuality';
import { newQualityStudy, importQualityFish, qualityResultKey, qualityComparisonRows, qualityDisplayRows, qualityRunSamples, type QualityRunOptions } from '@/lib/fish/quality';
import { definitionKey, BSS_DEF, STATE_DEF, FEATURES_KEY } from '@/lib/deepDig/features';
import { __resetNotificationCenterForTests, isNotificationHistoryOnly } from '@/lib/notificationCenter';
import type { TradeSignal } from '@/lib/signalLibrary';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/fish/qualityStore', () => ({ loadQualityStudy: storage.load, saveQualityStudy: storage.save }));
const T = Date.UTC(2026, 9, 20);
const signal: TradeSignal = { id: 'a', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: '结果', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: .1, direction: '>', scale: 1 } };
beforeEach(() => { __resetNotificationCenterForTests(); vi.useFakeTimers(); storage.load.mockReset().mockImplementation(async () => ({ study: newQualityStudy() })); storage.save.mockReset().mockResolvedValue(true); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear(); });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const chooseAndStart = (h: { result: { current: ReturnType<typeof useFishQuality> } }) => {
  act(() => h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id)));
  act(() => { void h.result.current.start(); });
};
it('reads a Deep dig formula edit before the next run instead of reusing the mounted sell snapshot', async () => {
  const tasks: QualityRunOptions[] = [];
  const h=renderHook(()=>useFishQuality('a',[signal],async o=>{tasks.push(o);}));
  await flush(); chooseAndStart(h); await flush();
  const first=tasks[0].study.sellPlans![0].snapshot.definitionKey;
  const def={...STATE_DEF,formula:STATE_DEF.formula.replace('wb = 1 ','wb = 3 ')};
  localStorage.setItem('sim_anon_'+FEATURES_KEY,JSON.stringify([def]));
  act(()=>{void h.result.current.start();}); await flush();
  expect(tasks[1].study.sellPlans![0].snapshot.definitionKey).toBe(definitionKey({...def,interval:'5m'}));
  expect(tasks[1].study.sellPlans![0].snapshot.definitionKey).not.toBe(first);
  expect(tasks[0].study.sellPlans![0].snapshot.definitionKey).toBe(first);
});

it('automatically imports cabin and fresh fish while panel is absent, preserves copies after source deletion, and persists on unmount', async () => {
  const run = vi.fn(async () => {});
  const h = renderHook(({ rows }) => useFishQuality('a', rows, run), { initialProps: { rows: [signal] } }); await flush();
  expect(h.result.current.study.samples).toHaveLength(1); expect(h.result.current.study.groups[0].rule).toBeUndefined();
  h.rerender({ rows: [] }); await flush(); chooseAndStart(h); await flush(1100); expect(h.result.current.study.samples).toHaveLength(1); expect(run).toHaveBeenCalledTimes(1);
  h.unmount(); expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ samples: expect.arrayContaining([expect.objectContaining({ source: signal })]) }));
});
it('applies edited group rules, hides old-rule results, rejects late callbacks and recalculates after manual edits', async () => {
  const tasks: QualityRunOptions[] = [];
  const run = vi.fn(async (o: QualityRunOptions) => { tasks.push(o); });
  const h = renderHook(() => useFishQuality('a', [signal], run)); await flush(); chooseAndStart(h); await flush(1100);
  const old = tasks[0], s = old.study.samples[0], g = old.study.groups[0];
  act(() => h.result.current.setRule(g.id, { metric: 'capture', direction: '<', threshold: .06 }));
  act(() => old.onResult({ key: qualityResultKey(s, g, old.study.observeHours), sampleId: s.id, groupId: g.id, evaluatedAt: T, status: 'closed', returnPct: 999 }));
  expect(h.result.current.study.results).toHaveLength(0);
  await flush(); chooseAndStart(h); await flush(1100); expect(run.mock.calls.at(-1)![0].study.groups[0].rule?.threshold).toBe(.06);
});
it('cancels pending work on account changes and ignores late results from the previous account', async () => {
  const tasks: QualityRunOptions[] = [];
  const run = vi.fn((o: QualityRunOptions) => new Promise<void>(resolve => { tasks.push(o); o.signal.addEventListener('abort', () => resolve()); }));
  const h = renderHook(({ owner, rows }) => useFishQuality(owner, rows, run), { initialProps: { owner: 'a', rows: [signal] } }); await flush(); chooseAndStart(h); await flush(1100);
  const old = tasks[0], s = old.study.samples[0], g = old.study.groups[0];
  h.rerender({ owner: 'b', rows: [] }); await flush();
  expect(old.signal.aborted).toBe(true); expect(h.result.current.study.samples).toHaveLength(0);
  act(() => old.onResult({ key: qualityResultKey(s, g, old.study.observeHours), sampleId: s.id, groupId: g.id, evaluatedAt: T, status: 'closed' }));
  expect(h.result.current.study.results).toHaveLength(0); await flush(500);
  expect(storage.save.mock.calls.filter(([owner]) => owner === 'b').every(([, study]) => study.samples.length === 0)).toBe(true);
});
it('retains samples when saving fails and retries without stopping new catches', async () => {
  storage.save.mockResolvedValue(false);
  const run = vi.fn(async () => {}), h = renderHook(({ rows }) => useFishQuality('a', rows, run), { initialProps: { rows: [signal] } });
  await flush(); await flush(500); expect(h.result.current.warning).toContain('未能保存');
  h.rerender({ rows: [signal, { ...signal, id: 'b', symbol: 'BBBUSDT' }] }); await flush(500);
  expect(h.result.current.study.samples).toHaveLength(2);
  storage.save.mockResolvedValue(true); await flush(16_000); expect(h.result.current.warning).toBe('');
});
it.each([true,false])('keeps source imports available but never periodically restarts returns with legacy tracking %s', async tracking => {
  storage.load.mockResolvedValue({study:{...newQualityStudy(),tracking}});
  const run=vi.fn(async()=>{});
  const h=renderHook(({rows})=>useFishQuality('a',rows,run),{initialProps:{rows:[signal]}});
  await flush(61_000);expect(run).not.toHaveBeenCalled();
  chooseAndStart(h);await flush();expect(run).toHaveBeenCalledTimes(1);
  await flush(180_000);expect(run).toHaveBeenCalledTimes(1);
  h.rerender({rows:[signal,{...signal,id:'b',symbol:'BBBUSDT'}]});await flush(1000);
  expect(h.result.current.study.samples).toHaveLength(2);expect(run).toHaveBeenCalledTimes(1);
});
// 【用户要求】2026-10-26「历史鱼按捕捞时刻买入」
it('restores existing signal-time copies at capture time before reevaluating and saves the migrated study without dropping chosen exits', async () => {
  const imported = importQualityFish(newQualityStudy(T + 1), [{ ...signal, fish: { ...signal.fish!, cutoffMs: T + 3600_000 } }]);
  const legacy = { ...imported, entryMode: 'signal' as const, samples: [{ ...imported.samples[0], enteredAt: T, basis: 'signal' as const }] };
  const sample = legacy.samples[0], group = legacy.groups[0];
  group.rule = { metric: 'capture', direction: '<', threshold: .06 };
  legacy.results.push({ key: qualityResultKey(sample, group, 0), sampleId: sample.id, groupId: group.id, evaluatedAt: T, status: 'closed', returnPct: 99 });
  storage.load.mockResolvedValue({ study: legacy });
  const run = vi.fn(async (_options: QualityRunOptions) => {}), h = renderHook(() => useFishQuality('a', [], run));
  await flush();
  expect(h.result.current.study.samples[0]).toMatchObject({ enteredAt: T + 3600_000, basis: 'capture' });
  expect(h.result.current.study.groups[0].rule).toEqual(group.rule); expect(h.result.current.study.results).toHaveLength(0);
  chooseAndStart(h); await flush(1100);
  expect(run.mock.calls[0][0].study.samples[0].enteredAt).toBe(T + 3600_000);
  expect(storage.save).toHaveBeenCalledWith('a', expect.objectContaining({ entryMode: 'capture', groups: legacy.groups, results: [] }));
  expect(legacy.samples[0].enteredAt).toBe(T);
});
it('persists a selected common sell plan, invalidates changed thresholds, and accepts only the matching matrix result', async () => {
  const tasks: QualityRunOptions[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); }));
  await flush(); chooseAndStart(h); await flush(1100);
  const plan = h.result.current.study.sellPlans![0];
  act(() => h.result.current.setRule(plan.id, { metric: 'state', direction: '<', threshold: .45 }));
  await flush(1100);
  const latest = tasks.at(-1)!, row = qualityComparisonRows(latest.study)[0], applied = latest.study.sellPlans![0];
  act(() => latest.onResult({ key: qualityResultKey(row, applied, 0), sampleId: row.id, groupId: applied.id, evaluatedAt: T, status: 'closed', returnPct: 12 }));
  expect(h.result.current.study.results).toHaveLength(1);
  act(() => h.result.current.selectSell(plan.id));
  await flush(500);
  expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ selectedSellId: plan.id }));
  act(() => h.result.current.setRule(plan.id, { metric: 'state', direction: '<', threshold: .4 }));
  expect(h.result.current.study.selectedSellId).toBeUndefined();
  act(() => latest.onResult({ key: qualityResultKey(row, applied, 0), sampleId: row.id, groupId: applied.id, evaluatedAt: T, status: 'closed', returnPct: 999 }));
  expect(h.result.current.study.results[0].returnPct).toBe(12);
});

it('imports signal-library signals as library rows, separately from fish, and keeps them after removal from the library', async () => {
  const lib = { id: 'lib', symbol: 'ZZZUSDT', timeMs: T, timeLabel: '', fallbackZone: '' };
  const h = renderHook(({ library }) => useFishQuality('a', [signal], vi.fn(async () => {}), library), { initialProps: { library: [lib] } }); await flush();
  expect(h.result.current.study.samples.map(s => [s.source.symbol, s.origin ?? 'fish'])).toEqual([['AAAUSDT', 'fish'], ['ZZZUSDT', 'library']]);
  h.rerender({ library: [] }); await flush();
  expect(h.result.current.study.samples).toHaveLength(2);
});

it('holds a history-only notification scope during a run and releases it immediately on cancel/unmount even if the runner is still pending', async () => {
  const resolvers: (() => void)[] = [];
  const run = vi.fn(() => { expect(isNotificationHistoryOnly()).toBe(true); return new Promise<void>(resolve => resolvers.push(resolve)); });
  const h = renderHook(() => useFishQuality('a', [signal], run)); await flush(); chooseAndStart(h); await flush(1100);
  expect(isNotificationHistoryOnly()).toBe(true);
  act(() => h.result.current.cancel()); expect(isNotificationHistoryOnly()).toBe(false);
  resolvers.shift()!(); await flush();
  act(() => { void h.result.current.start(); }); expect(isNotificationHistoryOnly()).toBe(true);
  h.unmount(); expect(isNotificationHistoryOnly()).toBe(false);
  resolvers.shift()!(); await flush(); expect(isNotificationHistoryOnly()).toBe(false);
});
it('restores notification delivery after a failed quality run', async () => {
  const h = renderHook(() => useFishQuality('a', [signal], async () => { expect(isNotificationHistoryOnly()).toBe(true); throw new Error('test failure'); }));
  await flush(); chooseAndStart(h); await flush(1100);
  expect(h.result.current.error).toBe('test failure'); expect(isNotificationHistoryOnly()).toBe(false);
});

it('waits for an explicit selection and manual run, preserves it in storage, and never includes unselected/new rows', async () => {
  const options: QualityRunOptions[] = [], run = vi.fn(async (o: QualityRunOptions) => { options.push(o); });
  const other = { ...signal, id: 'b', symbol: 'BBBUSDT' };
  const h = renderHook(({ rows }) => useFishQuality('a', rows, run), { initialProps: { rows: [signal, other] } });
  await flush(); await flush(61_000); expect(run).not.toHaveBeenCalled();
  const chosen = qualityDisplayRows(h.result.current.study)[0], id = chosen.id;
  act(() => h.result.current.setSelectedRows([id])); await flush(61_000); expect(run).not.toHaveBeenCalled();
  act(() => { void h.result.current.start(); }); await flush(500);
  expect(run).toHaveBeenCalledTimes(1); expect(qualityRunSamples(options[0].study).map(r => r.id)).toEqual([chosen.signalId]);
  expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ selectedRowIds: [id] }));
  h.rerender({ rows: [signal, other, { ...signal, id: 'c', symbol: 'CCCUSDT' }] }); await flush(61_000);
  expect(options.every(o => qualityRunSamples(o.study).map(r => r.id).join() === chosen.signalId)).toBe(true);
  act(() => h.result.current.setSelectedRows([])); const calls = run.mock.calls.length;
  await flush(61_000); act(() => { void h.result.current.start(); }); await flush(); expect(run).toHaveBeenCalledTimes(calls);
});
it('freezes old trials before applying holding vetoes, reruns selected rows and rejects old callbacks',async()=>{
 const {makeQualityHoldingVeto}=await import('@/lib/fish/qualityFilters');
 const tasks:QualityRunOptions[]=[];const h=renderHook(()=>useFishQuality('a',[signal],async o=>{tasks.push(o);}));
 await flush();chooseAndStart(h);await flush();
 const id=h.result.current.study.sellPlans![0].id;act(()=>h.result.current.setRule(id,{metric:'state',direction:'<',threshold:.5}));await flush(600);
 const old=tasks.at(-1)!,row=qualityComparisonRows(old.study)[0],plan=old.study.sellPlans![0];
 const result={key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T,status:'closed' as const,entryTime:T,entryPrice:100,endTime:T+60000,endPrice:110,returnPct:10,pnl:10};
 act(()=>old.onResult(result));expect(h.result.current.study.campaignRuns).toHaveLength(1);
 const veto=makeQualityHoldingVeto('static-drawdown','>=',10);
 act(()=>h.result.current.setFilters(id,[], [veto]));await flush(600);
 // 【用户要求】2026-10-26 过滤与卖出算法绑定：只改这一套方案
 expect(tasks.at(-1)!.study.sellPlans!.map(p=>p.holdingVetoes?.[0]?.threshold)).toEqual([10,undefined]);
 expect(h.result.current.study.campaignRuns![0].plan.holdingVetoes).toBeUndefined();
 const latestPlan=tasks.at(-1)!.study.sellPlans![0];expect(qualityResultKey(row,latestPlan,0)).not.toBe(result.key);
 act(()=>old.onResult({...result,returnPct:999}));expect(h.result.current.study.results[0].returnPct).toBe(10);
 await flush(500);expect(storage.save).toHaveBeenLastCalledWith('a',expect.objectContaining({sellPlans:expect.arrayContaining([expect.objectContaining({holdingVetoes:[veto]})])}));
});

it('applies buy edits in filter mode, preserves sell snapshots and only recalculates when effective holding vetoes change', async () => {
  const { makeQualityBuyFilter, makeQualityHoldingVeto } = await import('@/lib/fish/qualityFilters');
  const tasks: QualityRunOptions[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); }));
  await flush();
  act(() => h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id)));
  act(() => h.result.current.setFilters(h.result.current.study.sellPlans![0].id, [makeQualityBuyFilter('state:state', '>', .7)], []));
  await flush(600);
  expect(tasks.at(-1)!.mode).toBe('filter-only');
  await flush(60_000); expect(tasks).toHaveLength(1); // filtering before Run does not authorize evaluation
  act(() => { void h.result.current.start(); }); await flush();
  const original = tasks.at(-1)!.study.sellPlans;
  const def = { ...STATE_DEF, formula: STATE_DEF.formula.replace('wb = 1 ', 'wb = 3 ') };
  localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify([def]));
  act(() => h.result.current.setFilters(h.result.current.study.sellPlans![0].id, [makeQualityBuyFilter('state:state', '<', .5)], [])); await flush(600);
  expect(tasks.at(-1)!.mode).toBe('filter-only');
  expect(tasks.at(-1)!.study.sellPlans!.map(p => p.snapshot)).toEqual(original!.map(p => p.snapshot));
  const disabled = { ...makeQualityHoldingVeto('static-drawdown', '>=', 10), enabled: false };
  act(() => h.result.current.setFilters(h.result.current.study.sellPlans![0].id, [], [disabled])); await flush(600);
  expect(tasks.at(-1)!.mode).toBe('filter-only');
  expect(h.result.current.study.sellPlans![0].holdingVetoes).toEqual([disabled]);
  act(() => h.result.current.setFilters(h.result.current.study.sellPlans![0].id, [], [{ ...disabled, enabled: true }])); await flush(600);
  expect(tasks.at(-1)!.mode).toBeUndefined();
});

it('does not queue monitoring or interrupt it when only filtering settings change', async () => {
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush(); chooseAndStart(h); await flush();
  act(() => h.result.current.setFilters(h.result.current.study.sellPlans![0].id, [], [])); await flush(600);
  expect(tasks[0].signal.aborted).toBe(false); expect(tasks).toHaveLength(1);
  releases.shift()!(); await flush();
  expect(tasks).toHaveLength(1);
});

it('filters fully cached trades without calling the runner, including after restoring saved results', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const { qualityFilterReadingKey } = await import('@/lib/fish/quality');
  const f = makeQualityBuyFilter('state:state', '>', .7);
  const run = vi.fn(async (o: QualityRunOptions) => {
    for (const row of qualityRunSamples(o.study)) {
      o.onFilterReading?.({ key: qualityFilterReadingKey(row, f), value: .75 });
      for (const plan of o.study.sellPlans!) o.onResult({ key: qualityResultKey(row, plan, o.study.observeHours), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'open', entryTime: T, entryPrice: 100, returnPct: 1 });
    }
  });
  const {enableQualityComparison} = await import('@/lib/fish/qualityComparison');
  const initial = enableQualityComparison(importQualityFish(newQualityStudy(T),[signal]));
  initial.sellPlans![0].buyFilters = [f];
  storage.load.mockResolvedValue({study:initial});
  const h = renderHook(() => useFishQuality('a', [signal], run)); await flush(); chooseAndStart(h); await flush();
  const planId = h.result.current.study.sellPlans![0].id;
  act(() => h.result.current.setFilters(planId, [f], [])); await flush(600);
  expect(run).toHaveBeenCalledTimes(1);
  const saved = h.result.current.study; h.unmount();
  storage.load.mockResolvedValue({ study: saved });
  const restored = renderHook(() => useFishQuality('a', [], run)); await flush();
  act(() => restored.result.current.setFilters(planId, [{ ...f, threshold: .8 }], [])); await flush(600);
  expect(run).toHaveBeenCalledTimes(1);
  expect(restored.result.current.study.results).toEqual(saved.results);
});

it('finishes the frozen selection after rows change, preserving results of deselected rows', async () => {
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const other = { ...signal, id: 'b', symbol: 'BBBUSDT' };
  const h = renderHook(() => useFishQuality('a', [signal, other], async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush(); chooseAndStart(h); await flush();
  const task = tasks[0], rows = qualityRunSamples(task.study), plan = task.study.sellPlans![0];
  act(() => h.result.current.setSelectedRows([]));
  await flush(61_000);
  expect(task.signal.aborted).toBe(false); expect(h.result.current.running).toBe(true);
  for (const row of rows) act(() => task.onResult({ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'open', entryTime: T, entryPrice: 100, returnPct: 1 }));
  expect(h.result.current.study.results).toHaveLength(2);
  await flush(500);
  expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ results: expect.arrayContaining([expect.objectContaining({ sampleId: rows[1].id })]) }));
  releases.shift()!(); await flush();
  expect(h.result.current.running).toBe(false); expect(tasks).toHaveLength(1);
});

it('archives an in-flight old rule after edits, then evaluates the new rule without interrupting the old batch', async () => {
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush();
  act(() => h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id)));
  const id = h.result.current.study.sellPlans![0].id;
  act(() => h.result.current.setRule(id, { metric: 'state', direction: '<', threshold: .5 })); await flush(600);
  const old = tasks[0], row = qualityRunSamples(old.study)[0], plan = old.study.sellPlans![0];
  act(() => h.result.current.setRule(id, { metric: 'state', direction: '<', threshold: .4 })); await flush(600);
  expect(old.signal.aborted).toBe(false); expect(tasks).toHaveLength(1);
  const result = { key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: id, evaluatedAt: T, status: 'closed' as const, entryTime: T, entryPrice: 100, endTime: T + 60000, endPrice: 110, returnPct: 10, pnl: 10 };
  act(() => old.onResult(result));
  expect(h.result.current.study.results).toHaveLength(0);
  expect(h.result.current.study.campaignRuns![0].plan.rule?.threshold).toBe(.5);
  releases.shift()!(); await flush();
  expect(tasks).toHaveLength(2); expect(tasks[1].study.sellPlans![0].rule?.threshold).toBe(.4);
  expect(h.result.current.study.campaignRuns![0].result).toEqual(result);
  act(() => h.result.current.cancel()); releases.shift()!(); await flush(61_000);
  expect(tasks).toHaveLength(2); expect(h.result.current.running).toBe(false);
});

it('restarts immediately with the latest selection and settings, rejects late old callbacks and drops pending follow-ups', async () => {
  const { makeQualityBuyFilter, makeQualityHoldingVeto } = await import('@/lib/fish/qualityFilters');
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const fish = [signal, { ...signal, id: 'b', symbol: 'BBBUSDT' }];
  const h = renderHook(() => useFishQuality('a', fish, async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush();
  act(() => h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id)));
  const id = h.result.current.study.sellPlans![0].id;
  act(() => h.result.current.setRule(id, { metric: 'state', direction: '<', threshold: .5 })); await flush(600);
  const old = tasks[0], row = qualityRunSamples(old.study)[0], plan = old.study.sellPlans![0];
  const prior = { key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: id, evaluatedAt: T, status: 'closed' as const, complete: true, entryTime: T, entryPrice: 100, endTime: T + 60000, endPrice: 110, returnPct: 10, pnl: 10 };
  act(() => { old.onResult(prior); old.onProgress({ done: 1, total: 4, current: 'AAAUSDT' }); });
  act(() => h.result.current.setRule(id, { metric: 'state', direction: '<', threshold: .4 }));
  act(() => h.result.current.setObserveHours(12));
  const f = makeQualityBuyFilter('state:state', '>', .8), veto = makeQualityHoldingVeto('static-drawdown', '>=', 5);
  act(() => h.result.current.setFilters(id, [f], [veto]));
  act(() => h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).filter(r => r.source.symbol === 'BBBUSDT').map(r => r.id)));
  const def = { ...STATE_DEF, formula: STATE_DEF.formula.replace('wb = 1 ', 'wb = 3 ') };
  localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify([def]));
  act(() => { void h.result.current.restart(); });
  expect(tasks).toHaveLength(2); expect(old.signal.aborted).toBe(true);
  const next = tasks[1];
  expect(next.mode).toBe('restart');
  expect(qualityRunSamples(next.study).map(r => r.source.symbol)).toEqual(['BBBUSDT']);
  expect(next.study.observeHours).toBe(12);
  expect(next.study.sellPlans![0]).toMatchObject({ rule: { threshold: .4 }, buyFilters: [f], holdingVetoes: [veto] });
  expect(next.study.sellPlans![0].snapshot.definitionKey).toBe(definitionKey({ ...def, interval: '5m' }));
  expect(h.result.current.progress).toEqual({ done: 0, total: 2, current: '' });
  expect(h.result.current.study.campaignRuns![0].result).toEqual(prior);
  act(() => { old.onResult({ ...prior, returnPct: 999 }); old.onProgress({ done: 999, total: 999, current: 'old' }); old.onFilterReading?.({ key: 'late', value: 999 }); });
  releases.shift()!(); await flush();
  expect(h.result.current.running).toBe(true); expect(h.result.current.progress?.done).toBe(0);
  expect(h.result.current.study.campaignRuns![0].result).toEqual(prior);
  expect(h.result.current.study.filterReadings?.some(r => r.key === 'late')).not.toBe(true);
  releases.shift()!(); await flush(1000);
  expect(tasks.filter(t => t.task === 'monitor')).toHaveLength(2); expect(h.result.current.running).toBe(false);
  expect(tasks.filter(t => t.task === 'filter')).toHaveLength(1); expect(h.result.current.filterRunning).toBe(true);
  act(() => { void h.result.current.restart(); }); expect(tasks).toHaveLength(4);
  expect(tasks[3].mode).toBe('restart');
  const nextRow = qualityRunSamples(next.study)[0], nextPlan = next.study.sellPlans![0];
  act(() => next.onResult({ ...prior, key: qualityResultKey(nextRow, nextPlan, 12), sampleId: nextRow.id, returnPct: 999 }));
  expect(h.result.current.study.results.some(r => r.returnPct === 999)).toBe(false);
  act(() => { h.result.current.cancel(); h.result.current.cancelFilter(); }); releases.forEach(resolve => resolve()); await flush();
});

it('pause invalidates a pending settings run instead of restarting after the delay', async () => {
  const tasks: QualityRunOptions[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); })); await flush();
  act(() => h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id)));
  act(() => h.result.current.setRule(h.result.current.study.sellPlans![0].id, { metric: 'state', direction: '<', threshold: .5 }));
  act(() => h.result.current.cancel()); await flush(61_000);
  expect(tasks).toHaveLength(0);
});
// 【用户要求】2026-10-26「动态最大回撤这里改了数值之后为啥不起作用」：后台正在跑时改否决条件，立刻按新阈值重新开始
it('restarts at once with the new holding vetoes when they change during a running batch', async () => {
  const { makeQualityHoldingVeto } = await import('@/lib/fish/qualityFilters');
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush();
  act(() => h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id)));
  const id = h.result.current.study.sellPlans![0].id;
  act(() => h.result.current.setRule(id, { metric: 'state', direction: '<', threshold: .5 })); await flush(600);
  expect(tasks).toHaveLength(1);
  act(() => h.result.current.setFilters(id, [], [makeQualityHoldingVeto('dynamic-drawdown', '>=', 10)])); await flush(600);
  expect(tasks[0].signal.aborted).toBe(true);
  expect(tasks).toHaveLength(2);
  expect(tasks[1].study.sellPlans!.find(p => p.id === id)!.holdingVetoes?.[0]).toMatchObject({ kind: 'dynamic-drawdown', threshold: 10 });
  act(() => h.result.current.cancel()); releases.forEach(r => r()); await flush();
});

it('runs filtering and monitoring concurrently with separate progress, cancellation and late-callback guards', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const { qualityFilterReadingKey } = await import('@/lib/fish/quality');
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush();
  const f = makeQualityBuyFilter('state:state', '>', .7);
  act(() => {
    h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id));
    h.result.current.setFilters(h.result.current.study.sellPlans![0].id, [f], []);
    void h.result.current.startFilter();
    void h.result.current.start();
  });
  await flush(600);
  expect(tasks).toHaveLength(2);
  const filtering = tasks.find(t => t.task === 'filter')!, monitoring = tasks.find(t => t.task === 'monitor')!;
  expect(h.result.current.filterRunning).toBe(true); expect(h.result.current.running).toBe(true);
  act(() => { filtering.onProgress({ done: 1, total: 2, current: 'filter' }); monitoring.onProgress({ done: 0, total: 2, current: 'monitor' }); });
  expect(h.result.current.filterProgress?.done).toBe(1); expect(h.result.current.progress?.done).toBe(0);
  const row = qualityRunSamples(filtering.study)[0], plan = filtering.study.sellPlans![0], key = qualityFilterReadingKey(row, f);
  act(() => {
    filtering.onFilterReading?.({ key, value: .9 });
    monitoring.onFilterReading?.({ key, error: 'temporary request error' });
    filtering.onResult({ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, status: 'closed', evaluatedAt: T, returnPct: 999 });
  });
  expect(h.result.current.study.filterReadings?.find(r => r.key === key)?.value).toBe(.9);
  expect(h.result.current.study.results).toHaveLength(0);
  act(() => h.result.current.cancelFilter());
  expect(filtering.signal.aborted).toBe(true); expect(monitoring.signal.aborted).toBe(false);
  act(() => { filtering.onProgress({ done: 999, total: 999, current: 'late' }); filtering.onFilterReading?.({ key: 'late', value: 999 }); });
  expect(h.result.current.filterProgress?.done).toBe(1); expect(h.result.current.study.filterReadings?.some(r => r.key === 'late')).toBe(false);
  // A second uncached condition makes another filter batch, while the old aborted runner is still pending.
  act(() => { h.result.current.setFilters(plan.id, [f, makeQualityBuyFilter('cda:CDA', '>', 0)], []); void h.result.current.startFilter(); });
  const next = tasks.at(-1)!; expect(next.task).toBe('filter'); expect(tasks).toHaveLength(3);
  act(() => h.result.current.cancel());
  expect(monitoring.signal.aborted).toBe(true); expect(next.signal.aborted).toBe(false); expect(h.result.current.filterRunning).toBe(true);
  act(() => h.result.current.cancelFilter()); releases.forEach(resolve => resolve()); await flush(1000);
  expect(tasks).toHaveLength(3); expect(h.result.current.filterRunning).toBe(false); expect(h.result.current.running).toBe(false);
});

it('aborts both independent tasks on account change and rejects their late writes', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const h = renderHook(({ owner, rows }) => useFishQuality(owner, rows, async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }), { initialProps: { owner: 'a', rows: [signal] } });
  await flush();
  act(() => {
    h.result.current.setSelectedRows(qualityDisplayRows(h.result.current.study).map(r => r.id));
    h.result.current.setFilters(h.result.current.study.sellPlans![0].id, [makeQualityBuyFilter('state:state', '>', .7)], []);
    void h.result.current.startFilter(); void h.result.current.start();
  });
  h.rerender({ owner: 'b', rows: [] }); await flush();
  expect(tasks).toHaveLength(2); expect(tasks.every(t => t.signal.aborted)).toBe(true);
  act(() => { for (const t of tasks) t.onFilterReading?.({ key: 'old-account', value: 999 }); });
  releases.forEach(resolve => resolve()); await flush(1000);
  expect(h.result.current.study.filterReadings ?? []).toEqual([]); expect(h.result.current.running).toBe(false); expect(h.result.current.filterRunning).toBe(false);
});

it('imports mined rows without implicitly starting monitoring', async () => {
  const run = vi.fn(async () => {});
  const h = renderHook(({ rows }) => useFishQuality('a', rows, run), { initialProps: { rows: [] as TradeSignal[] } });
  await flush(); h.rerender({ rows: [{ ...signal, mined: { anchorMs: T } }] }); await flush(1000);
  expect(h.result.current.study.selectedRowIds?.length).toBeGreaterThan(0); expect(run).not.toHaveBeenCalled();
});

it('saves every completed monitoring round immediately, reuses identical records and separates new settings', async () => {
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush(); chooseAndStart(h); await flush();
  const task = tasks[0], row = qualityRunSamples(task.study)[0], plan = task.study.sellPlans![0];
  const value = { key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'open' as const, entryTime: T, entryPrice: 100, returnPct: 1 };
  act(() => task.onResult(value)); releases.shift()!(); await flush();
  expect(h.result.current.study.monitorLibrary!.rounds).toHaveLength(1);
  expect(h.result.current.study.monitorLibrary!.rounds[0].state).toBe('complete');
  expect(storage.save).toHaveBeenCalledWith('a', expect.objectContaining({ monitorLibrary: expect.objectContaining({ rounds: [expect.objectContaining({ state: 'complete' })] }) }));
  const count = h.result.current.study.monitorLibrary!.records.length;
  act(() => { void h.result.current.start(); }); releases.shift()!(); await flush();
  expect(h.result.current.study.monitorLibrary!.rounds).toHaveLength(2); expect(h.result.current.study.monitorLibrary!.records).toHaveLength(count);
  act(() => h.result.current.setRule(plan.id, { metric: plan.metric, direction: '<', threshold: .42 })); await flush(600);
  releases.shift()!(); await flush();
  expect(h.result.current.study.monitorLibrary!.rounds).toHaveLength(3);
  expect(h.result.current.study.monitorLibrary!.records.length).toBeGreaterThan(count);
  expect(h.result.current.study.monitorLibrary!.records.some(r => r.result?.returnPct === 1)).toBe(true);
});
it('immediately archives partial work on pause and restart even if the old runner never settles', async () => {
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); }));
  await flush(); chooseAndStart(h); await flush();
  const old = tasks[0], row = qualityRunSamples(old.study)[0], plan = old.study.sellPlans![0];
  const value = { key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'open' as const, entryTime: T, entryPrice: 100, returnPct: 1 };
  act(() => old.onResult(value)); act(() => { void h.result.current.restart(); }); await flush();
  expect(old.signal.aborted).toBe(true); expect(h.result.current.study.monitorLibrary!.rounds.map(r => r.state)).toEqual(['paused', 'running']);
  act(() => old.onResult({ ...value, returnPct: 999 }));
  expect(h.result.current.study.monitorLibrary!.records.some(r => r.result?.returnPct === 999)).toBe(false);
  act(() => h.result.current.cancel()); await flush();
  expect(h.result.current.study.monitorLibrary!.rounds.every(r => r.state === 'paused')).toBe(true);
  expect(storage.save).toHaveBeenCalledWith('a', expect.objectContaining({ monitorLibrary: expect.objectContaining({ rounds: expect.arrayContaining([expect.objectContaining({ state: 'paused' })]) }) }));
  releases.forEach(resolve => resolve()); await flush();
});

it('keeps a completed round in memory and reports a failed durable save instead of silently losing it', async () => {
  storage.save.mockResolvedValue(false);
  const h = renderHook(() => useFishQuality('a', [signal], async () => {}));
  await flush(); chooseAndStart(h); await flush();
  expect(h.result.current.study.monitorLibrary!.rounds[0].state).toBe('complete');
  expect(h.result.current.warning).toContain('监测库未能保存');
  storage.save.mockResolvedValue(true); await flush(16000);
  expect(h.result.current.warning).toBe(''); expect(storage.save).toHaveBeenCalledWith('a', expect.objectContaining({ monitorLibrary: expect.objectContaining({ rounds: [expect.objectContaining({ state: 'complete' })] }) }));
});

// 【用户要求】2026-10-27「买前过滤、持仓监测都只针对被选中的数据」：范围 = 已勾选 ∩ 当前筛选下可见
it('runs monitoring and filtering only on checked rows inside the current view, and widens again when the view resets', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const other: TradeSignal = { ...signal, id: 'b', symbol: 'BBBUSDT', timeMs: T - 3_600_000, fish: { ...signal.fish!, cutoffMs: T - 3_600_000 } };
  const tasks: QualityRunOptions[] = [];
  const h = renderHook(() => useFishQuality('a', [signal, other], async o => { tasks.push(o); }));
  await flush();
  const rows = qualityDisplayRows(h.result.current.study);
  expect(rows).toHaveLength(2);
  act(() => h.result.current.setSelectedRows(rows.map(r => r.id)));
  // 视图只剩 BBB（例如按标的筛选）：两条都勾着，只处理 BBB
  act(() => h.result.current.setScope([rows.find(r => r.source.symbol === 'BBBUSDT')!.id]));
  act(() => { void h.result.current.start(); }); await flush();
  expect(qualityRunSamples(tasks[0].study).map(s => s.source.symbol)).toEqual(['BBBUSDT']);
  // 勾选本身不变
  expect(h.result.current.study.selectedRowIds).toHaveLength(2);
  // 买前过滤同样只处理范围内的
  const plan = h.result.current.study.sellPlans![0];
  act(() => h.result.current.setFilters(plan.id, [makeQualityBuyFilter('state:state', '>', .7)])); await flush(600);
  const filterTask = tasks.find(t => t.task === 'filter')!;
  expect(qualityRunSamples(filterTask.study).map(s => s.source.symbol)).toEqual(['BBBUSDT']);
  // 筛选范围内一条都没勾：不启动
  const count = tasks.length;
  act(() => h.result.current.setScope([]));
  act(() => { void h.result.current.start(); }); await flush();
  expect(tasks).toHaveLength(count);
  // 视图恢复全部：两条都处理
  act(() => h.result.current.setScope(rows.map(r => r.id)));
  act(() => { void h.result.current.start(); }); await flush();
  expect(qualityRunSamples(tasks.at(-1)!.study).map(s => s.source.symbol).sort()).toEqual(['AAAUSDT', 'BBBUSDT']);
});

it('freezes the selected entries for both tasks and rejects readings/results for unselected entries', async () => {
  const {makeQualityBuyFilter} = await import('@/lib/fish/qualityFilters');
  const {qualityFilterReadingKey} = await import('@/lib/fish/quality');
  const {enableQualityComparison} = await import('@/lib/fish/qualityComparison');
  const saved = enableQualityComparison(importQualityFish(newQualityStudy(T),[signal,{...signal,id:'b',symbol:'BBBUSDT'}]));
  const f = makeQualityBuyFilter('state:state','>',.7);
  saved.sellPlans = saved.sellPlans!.map(p=>({...p,buyFilters:[f],rule:{metric:p.metric,direction:'<',threshold:.5}}));
  storage.load.mockResolvedValue({study:saved});
  const tasks: QualityRunOptions[] = [], releases: (()=>void)[] = [];
  const h = renderHook(()=>useFishQuality('a',[],async o=>{tasks.push(o); await new Promise<void>(resolve=>releases.push(resolve));}));
  await flush();
  const displays=qualityDisplayRows(h.result.current.study), selected=displays.find(r=>r.source.symbol==='BBBUSDT')!;
  act(()=>{h.result.current.setSelectedRows([selected.id]);void h.result.current.startFilter();void h.result.current.start();});
  await flush();expect(tasks).toHaveLength(2);
  for(const t of tasks) expect(qualityRunSamples(t.study).map(r=>r.source.symbol)).toEqual(['BBBUSDT']);
  const monitor=tasks.find(t=>t.task==='monitor')!, filtering=tasks.find(t=>t.task==='filter')!;
  const all=qualityComparisonRows(monitor.study), a=all.find(r=>r.source.symbol==='AAAUSDT')!, b=all.find(r=>r.source.symbol==='BBBUSDT')!, plan=monitor.study.sellPlans![0];
  act(()=>{
    for(const task of tasks) task.onFilterReading?.({key:qualityFilterReadingKey(a,f),value:999});
    monitor.onResult({key:qualityResultKey(a,plan,0),sampleId:a.id,groupId:plan.id,status:'closed',evaluatedAt:T,returnPct:999});
    filtering.onFilterReading?.({key:qualityFilterReadingKey(b,f),value:.9});
    monitor.onResult({key:qualityResultKey(b,plan,0),sampleId:b.id,groupId:plan.id,status:'closed',evaluatedAt:T,returnPct:2});
  });
  expect(h.result.current.study.filterReadings?.map(r=>r.key)).toEqual([qualityFilterReadingKey(b,f)]);
  expect(h.result.current.study.results.map(r=>r.sampleId)).toEqual([b.id]);
  expect(h.result.current.study.monitorLibrary?.records.every(r=>r.source.symbol==='BBBUSDT')).toBe(true);
  expect(h.result.current.study.filterLibrary?.records.every(r=>r.source.symbol==='BBBUSDT')).toBe(true);
  act(()=>{h.result.current.cancel();h.result.current.cancelFilter();});releases.forEach(r=>r());await flush();
  act(()=>{h.result.current.setSelectedRows([]);void h.result.current.startFilter();void h.result.current.start();});await flush();expect(tasks).toHaveLength(2);
});
