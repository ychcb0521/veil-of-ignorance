import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreEntryMonitor } from '../usePreEntryMonitor';
import { emptyPreEntryLibrary } from '@/lib/fish/preEntryMonitor';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows, type QualityRunOptions } from '@/lib/fish/quality';
import { definitionKey } from '@/lib/deepDig/features';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/fish/preEntryMonitorStore', () => ({ loadPreEntryLibrary: storage.load, savePreEntryLibrary: storage.save }));
const t = Date.UTC(2026, 2, 29, 5);
function study() {
  const s = importQualityLibrary(newQualityStudy(), [{ id: 's', symbol: 'TURING:TURING 1', timeMs: t, timeLabel: '', fallbackZone: '' }], t, 'turing');
  const def = { id: 'test', short: 'test', name: 'test', definition: '', formula: 'raw = C', scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const };
  return { ...s, independentFilters: true as const, selectedRowIds: qualityComparisonRows(s).map(r => r.id), buyFilters: [{ id: 'f', label: '买盘', enabled: true, metric: 'raw', direction: '>' as const, threshold: 100,
    snapshot: { featureId: def.id, featureShort: def.short, definitionKey: definitionKey(def), statistic: 'raw', interval: '5m' as const, scale: 1, direction: '>' as const, threshold: 100, cutoffMs: t, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 } }] };
}
beforeEach(() => { vi.clearAllMocks(); storage.load.mockImplementation(async () => emptyPreEntryLibrary()); storage.save.mockResolvedValue(undefined); });
describe('买前监测独立任务', () => {
  it('freezes selected rows and filters before starting and saves matches independently', async () => {
    let task!: QualityRunOptions, finish!: () => void;
    const run = vi.fn(async (options: QualityRunOptions) => { task = options; await new Promise<void>(resolve => { finish = resolve; }); });
    const { result } = renderHook(() => usePreEntryMonitor('alice', true, run));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const input = study(); let started!: Promise<void>;
    act(() => { started = result.current.start(input, 12); });
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    input.buyFilters[0].threshold = 999;
    expect(task.preEntry!.round.filters[0].threshold).toBe(100);
    expect(task.preEntry!.records).toHaveLength(1);
    expect(storage.save).toHaveBeenCalledWith('alice', expect.objectContaining({ rounds: [expect.objectContaining({ hours: 12 })] }));
    act(() => task.preEntry!.onRecord({ ...task.preEntry!.records[0], status: 'matched', matchedAt: t + 300000, updatedAt: Date.now() }));
    await act(async () => { finish(); await started; });
    expect(result.current.library.records[0].status).toBe('matched');
    expect(result.current.library.rounds[0].state).toBe('complete');
    expect(result.current.running).toBe(false);
  });
  it('ignores late results after switching accounts and cancels only its own task', async () => {
    let task!: QualityRunOptions, finish!: () => void;
    const run = async (options: QualityRunOptions) => { task = options; await new Promise<void>(resolve => { finish = resolve; }); };
    const { result, rerender } = renderHook(({ owner }) => usePreEntryMonitor(owner, true, run), { initialProps: { owner: 'alice' } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let started!: Promise<void>; act(() => { started = result.current.start(study(), 0); });
    await waitFor(() => expect(task).toBeDefined());
    rerender({ owner: 'bob' }); await waitFor(() => expect(result.current.ready).toBe(true));
    expect(task.signal.aborted).toBe(true);
    act(() => task.preEntry!.onRecord({ ...task.preEntry!.records[0], status: 'matched', matchedAt: t + 300000 }));
    await act(async () => { finish(); await started; });
    expect(result.current.library.records).toHaveLength(0);
    expect(storage.save.mock.calls.filter(([owner]) => owner === 'bob')).toHaveLength(0);
  });
  it('does not execute an unsaved round when local persistence fails', async () => {
    storage.save.mockRejectedValue(Error('磁盘写入失败'));
    const run = vi.fn(); const { result } = renderHook(() => usePreEntryMonitor('alice', true, run));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.start(study(), 0));
    expect(run).not.toHaveBeenCalled(); expect(result.current.error).toContain('磁盘写入失败');
    expect(result.current.library.rounds[0].state).toBe('paused');
  });
});
