import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFishQuality } from '@/hooks/useFishQuality';
import { newQualityStudy, importQualityFish, qualityResultKey, qualityComparisonRows, type QualityRunOptions } from '@/lib/fish/quality';
import { definitionKey, BSS_DEF } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/fish/qualityStore', () => ({ loadQualityStudy: storage.load, saveQualityStudy: storage.save }));
const T = Date.UTC(2026, 9, 20);
const signal: TradeSignal = { id: 'a', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: '结果', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: .1, direction: '>', scale: 1 } };
beforeEach(() => { vi.useFakeTimers(); storage.load.mockReset().mockImplementation(async () => ({ study: newQualityStudy() })); storage.save.mockReset().mockResolvedValue(true); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

it('automatically imports cabin and fresh fish while panel is absent, preserves copies after source deletion, and persists on unmount', async () => {
  const run = vi.fn(async () => {});
  const h = renderHook(({ rows }) => useFishQuality('a', rows, run), { initialProps: { rows: [signal] } }); await flush();
  expect(h.result.current.study.samples).toHaveLength(1); expect(h.result.current.study.groups[0].rule).toBeUndefined();
  h.rerender({ rows: [] }); await flush(); await flush(1100); expect(h.result.current.study.samples).toHaveLength(1); expect(run).toHaveBeenCalledTimes(1);
  h.unmount(); expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ samples: expect.arrayContaining([expect.objectContaining({ source: signal })]) }));
});
it('applies edited group rules, hides old-rule results, rejects late callbacks and recalculates even if auto tracking is paused', async () => {
  const tasks: QualityRunOptions[] = [];
  const run = vi.fn(async (o: QualityRunOptions) => { tasks.push(o); });
  const h = renderHook(() => useFishQuality('a', [signal], run)); await flush(); await flush(1100);
  const old = tasks[0], s = old.study.samples[0], g = old.study.groups[0];
  act(() => h.result.current.setTracking(false));
  act(() => h.result.current.setRule(g.id, { metric: 'capture', direction: '<', threshold: .06 }));
  act(() => old.onResult({ key: qualityResultKey(s, g, old.study.observeHours), sampleId: s.id, groupId: g.id, evaluatedAt: T, status: 'closed', returnPct: 999 }));
  expect(h.result.current.study.results).toHaveLength(0);
  await flush(); await flush(1100); expect(run.mock.calls.at(-1)![0].study.groups[0].rule?.threshold).toBe(.06);
});
it('cancels pending work on account changes and ignores late results from the previous account', async () => {
  const tasks: QualityRunOptions[] = [];
  const run = vi.fn((o: QualityRunOptions) => new Promise<void>(resolve => { tasks.push(o); o.signal.addEventListener('abort', () => resolve()); }));
  const h = renderHook(({ owner, rows }) => useFishQuality(owner, rows, run), { initialProps: { owner: 'a', rows: [signal] } }); await flush(); await flush(1100);
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
it('imports catches received while paused as soon as automatic tracking resumes', async () => {
  const h = renderHook(({ rows }) => useFishQuality('a', rows, vi.fn(async () => {})), { initialProps: { rows: [signal] } });
  await flush(); act(() => h.result.current.setTracking(false));
  h.rerender({ rows: [signal, { ...signal, id: 'b', symbol: 'BBBUSDT' }] }); await flush();
  expect(h.result.current.study.samples).toHaveLength(1);
  act(() => h.result.current.setTracking(true)); await flush();
  expect(h.result.current.study.samples).toHaveLength(2);
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
  await flush(1100);
  expect(run.mock.calls[0][0].study.samples[0].enteredAt).toBe(T + 3600_000);
  expect(storage.save).toHaveBeenCalledWith('a', expect.objectContaining({ entryMode: 'capture', groups: legacy.groups, results: [] }));
  expect(legacy.samples[0].enteredAt).toBe(T);
});
it('persists a selected common sell plan and a fixed batch, invalidates changed thresholds, and accepts only the matching matrix result', async () => {
  const tasks: QualityRunOptions[] = [];
  const h = renderHook(() => useFishQuality('a', [signal], async o => { tasks.push(o); }));
  await flush(); await flush(1100);
  const plan = h.result.current.study.sellPlans![0];
  act(() => h.result.current.setRule(plan.id, { metric: 'state', direction: '<', threshold: .45 }));
  await flush(1100);
  const latest = tasks.at(-1)!, row = qualityComparisonRows(latest.study)[0], applied = latest.study.sellPlans![0];
  act(() => latest.onResult({ key: qualityResultKey(row, applied, 0), sampleId: row.id, groupId: applied.id, evaluatedAt: T, status: 'closed', returnPct: 12 }));
  expect(h.result.current.study.results).toHaveLength(1);
  act(() => h.result.current.selectSell(plan.id)); act(() => h.result.current.setCohort([row.id]));
  await flush(500);
  expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ selectedSellId: plan.id, cohortIds: [row.id] }));
  act(() => h.result.current.setRule(plan.id, { metric: 'state', direction: '<', threshold: .4 }));
  expect(h.result.current.study.selectedSellId).toBeUndefined();
  act(() => latest.onResult({ key: qualityResultKey(row, applied, 0), sampleId: row.id, groupId: applied.id, evaluatedAt: T, status: 'closed', returnPct: 999 }));
  expect(h.result.current.study.results[0].returnPct).toBe(12);
});
