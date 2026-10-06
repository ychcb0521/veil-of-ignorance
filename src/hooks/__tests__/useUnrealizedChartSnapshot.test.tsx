import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignMetricSeriesInput } from '@/lib/campaignMetricSeries';
import {
  clearUnrealizedChartSnapshotMemoryForTests,
  MAX_SAMPLES_PER_PARTITION,
  UNREALIZED_CHART_SNAPSHOT_CACHE_PREFIX,
  useUnrealizedChartSnapshot,
  type UnrealizedChartSnapshotOptions,
} from '@/hooks/useUnrealizedChartSnapshot';

const owner = 'owner-a';
const noPending = new Set<string>();
const storageKey = (user = owner, scope = 'active') => `${UNREALIZED_CHART_SNAPSHOT_CACHE_PREFIX}${JSON.stringify([user, scope])}`;
const sample = (id: string, value: number | null, overrides: Partial<CampaignMetricSeriesInput> = {}): CampaignMetricSeriesInput => ({
  campaignId: id, title: id, symbol: 'BTCUSDT', value, operationTime: id === 'b' ? 2_000 : 1_000,
  pnl: 20, payoffRatio: 2, ...overrides,
});
const options = (samples: CampaignMetricSeriesInput[], pendingIds = noPending, overrides: Partial<UnrealizedChartSnapshotOptions> = {}): UnrealizedChartSnapshotOptions => ({
  owner, scope: 'active', samples, pendingIds, ready: true, ...overrides,
});
const seed = (samples: CampaignMetricSeriesInput[], user = owner, scope = 'active') => {
  localStorage.setItem(storageKey(user, scope), JSON.stringify({ samples }));
};
/** Writes of the snapshot itself: each one is followed by a headroom probe on another key, which is not a rewrite. */
const snapshotWrites = (write: { mock: { calls: unknown[][] } }) =>
  write.mock.calls.filter(([key]) => String(key).startsWith(UNREALIZED_CHART_SNAPSHOT_CACHE_PREFIX)).length;
const values = (series: ReturnType<typeof useUnrealizedChartSnapshot>['series']) => series.points.map(point => [point.campaignId, point.value]);

beforeEach(() => {
  localStorage.clear();
  clearUnrealizedChartSnapshotMemoryForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useUnrealizedChartSnapshot', () => {
  it('renders a cold persisted snapshot on the first frame and atomically replaces the entire old graph when ready', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const frames: ReturnType<typeof useUnrealizedChartSnapshot>[] = [];
    const { result, rerender } = renderHook((props: UnrealizedChartSnapshotOptions) => {
      const frame = useUnrealizedChartSnapshot(props);
      frames.push(frame);
      return frame;
    }, { initialProps: options([sample('a', null), sample('b', null)], new Set(['a', 'b'])) });
    expect(values(frames[0].series)).toEqual([['a', 10], ['b', 20]]);
    expect(frames[0].cachedCount).toBe(2);
    const frozenSeries = result.current.series;

    rerender(options([sample('a', 30), sample('b', null)], new Set(['b'])));
    expect(values(result.current.series)).toEqual([['a', 10], ['b', 20]]);
    expect(result.current.series).toBe(frozenSeries);
    expect(JSON.parse(localStorage.getItem(storageKey())!).samples[0].value).toBe(10);

    rerender(options([sample('a', 30), sample('b', 40)]));
    expect(values(result.current.series)).toEqual([['a', 30], ['b', 40]]);
    expect(result.current.cachedCount).toBe(0);
    expect(JSON.parse(localStorage.getItem(storageKey())!).samples.map((item: CampaignMetricSeriesInput) => item.value)).toEqual([30, 40]);
  });

  it('keeps value, operation time, color and tooltip fields from one old reading after input edits', () => {
    seed([sample('a', 10, { title: 'previous title', pnl: -100, payoffRatio: -5, stackBelow: true })]);
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null, { title: 'new title', pnl: 800, payoffRatio: 7, stackBelow: false })], new Set(['a'])),
    });
    expect(result.current.series.points[0]).toMatchObject({ value: 10, title: 'previous title', pnl: -100, payoffRatio: -5, stackBelow: true });
    rerender(options([sample('a', 100, { title: 'new title', pnl: 800, payoffRatio: 7, stackBelow: false })]));
    expect(result.current.series.points[0]).toMatchObject({ value: 100, title: 'new title', pnl: 800, payoffRatio: 7, stackBelow: false });
  });

  it('progressively draws the first scan and adds newly ready campaigns while known cached points stay stable', () => {
    seed([sample('a', 10)]);
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', null), sample('c', null)], new Set(['a', 'b', 'c'])),
    });
    expect(values(result.current.series)).toEqual([['a', 10]]);
    rerender(options([sample('a', null), sample('b', 40), sample('c', null)], new Set(['a', 'c'])));
    expect(values(result.current.series)).toEqual([['a', 10], ['b', 40]]);
    rerender(options([sample('a', 30), sample('b', 40), sample('c', 50)]));
    expect(values(result.current.series)).toEqual([['a', 30], ['c', 50], ['b', 40]]);
  });

  it('has no fabricated points on an uncached first scan and keeps partial successes across a remount', () => {
    const first = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', null)], new Set(['a', 'b'])),
    });
    expect(first.result.current.series.points).toHaveLength(0);
    expect(first.result.current.cachedCount).toBe(0);
    first.rerender(options([sample('a', 30), sample('b', null)], new Set(['b'])));
    expect(values(first.result.current.series)).toEqual([['a', 30]]);
    first.unmount();
    clearUnrealizedChartSnapshotMemoryForTests();
    const second = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', null)], new Set(['a', 'b'])),
    });
    expect(values(second.result.current.series)).toEqual([['a', 30]]);
  });

  it('filters membership immediately, preserves other date ranges and rejects a changed operation time', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', null)], new Set(['a', 'b'])),
    });
    rerender(options([sample('b', null)], new Set(['b'])));
    expect(values(result.current.series)).toEqual([['b', 20]]);
    rerender(options([sample('a', null)], new Set(['a'])));
    expect(values(result.current.series)).toEqual([['a', 10]]);
    rerender(options([sample('a', null, { operationTime: 9_000 })], new Set(['a'])));
    expect(result.current.series.points).toHaveLength(0);
    expect(result.current.cachedCount).toBe(0);
    rerender(options([]));
    expect(result.current.series.points).toHaveLength(0);
  });

  it('never uses another owner or recycle-bin snapshot, including during an owner switch', () => {
    seed([sample('a', 10)]);
    seed([sample('a', 99)], owner, 'deleted');
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null)], new Set(['a'])),
    });
    expect(values(result.current.series)).toEqual([['a', 10]]);
    rerender(options([sample('a', null)], new Set(['a']), { owner: 'owner-b' }));
    expect(result.current.series.points).toHaveLength(0);
    rerender(options([sample('a', null)], new Set(['a']), { scope: 'deleted' }));
    expect(values(result.current.series)).toEqual([['a', 99]]);
    rerender(options([sample('a', null)], new Set(['a']), { owner: '' }));
    expect(result.current.series.points).toHaveLength(0);
  });

  it('excludes terminally unavailable rows immediately without destroying prior successful snapshots', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', null)], new Set(['a', 'b'])),
    });
    rerender(options([sample('a', null), sample('b', null)], new Set(['b'])));
    expect(values(result.current.series)).toEqual([['b', 20]]);
    expect(result.current.cachedCount).toBe(1);
    expect(result.current.series.excludedMissingValueCount).toBe(1);
    rerender(options([sample('a', null), sample('b', 40)]));
    expect(values(result.current.series)).toEqual([['b', 40]]);
    expect(result.current.cachedCount).toBe(0);
    expect(JSON.parse(localStorage.getItem(storageKey())!).samples.find((item: CampaignMetricSeriesInput) => item.campaignId === 'a').value).toBe(10);
  });

  it('releases the whole-graph freeze while the queue is stalled: recalculated rows show and persist their new reading, waiting rows keep the old point', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', 30), sample('b', null)], new Set(['b'])),
    });
    // Normal refresh: a is recalculated but stays frozen with the rest of the graph.
    expect(values(result.current.series)).toEqual([['a', 10], ['b', 20]]);
    expect(result.current.cachedCount).toBe(2);

    rerender(options([sample('a', 30), sample('b', null)], new Set(['b']), { stalled: true }));
    expect(values(result.current.series)).toEqual([['a', 30], ['b', 20]]);
    expect(result.current.cachedCount).toBe(1);
    expect(JSON.parse(localStorage.getItem(storageKey())!).samples.map((item: CampaignMetricSeriesInput) => [item.campaignId, item.value]))
      .toEqual([['b', 20], ['a', 30]]);

    // The queue recovers: the graph freezes again on what is already shown, it does not jump back to 10.
    rerender(options([sample('a', 30), sample('b', null)], new Set(['b'])));
    expect(values(result.current.series)).toEqual([['a', 30], ['b', 20]]);
    expect(result.current.cachedCount).toBe(1);
    rerender(options([sample('a', 30), sample('b', 40)]));
    expect(values(result.current.series)).toEqual([['a', 30], ['b', 40]]);
    expect(result.current.cachedCount).toBe(0);
  });

  it('counts only points that stand in for a value still being refreshed, never points that are already current', () => {
    // First scan without any snapshot: nothing is "kept" however many batches land.
    const first = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', null), sample('c', null)], new Set(['a', 'b', 'c'])),
    });
    first.rerender(options([sample('a', 30), sample('b', null), sample('c', null)], new Set(['b', 'c'])));
    expect(first.result.current.cachedCount).toBe(0);
    first.rerender(options([sample('a', 30), sample('b', 40), sample('c', null)], new Set(['c'])));
    expect(values(first.result.current.series)).toEqual([['a', 30], ['b', 40]]);
    expect(first.result.current.cachedCount).toBe(0);
    first.rerender(options([sample('a', 30), sample('b', 40), sample('c', 50)]));
    first.unmount();

    // One new campaign is being calculated; every drawn point is already current.
    const next = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', 30), sample('b', 40), sample('c', 50), sample('new', null)], new Set(['new'])),
    });
    expect(next.result.current.series.points).toHaveLength(3);
    expect(next.result.current.cachedCount).toBe(0);
  });

  it('lets a recalculated row with a moved operation time join at once and overwrite its old snapshot during a refresh', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const { result } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', 30, { operationTime: 9_000 }), sample('b', null)], new Set(['b'])),
    });
    expect(values(result.current.series)).toEqual([['b', 20], ['a', 30]]);
    expect(result.current.cachedCount).toBe(1);
    const stored = JSON.parse(localStorage.getItem(storageKey())!).samples.find((item: CampaignMetricSeriesInput) => item.campaignId === 'a');
    expect(stored).toMatchObject({ value: 30, operationTime: 9_000 });
  });

  it('shows the last successful point again when a row that was judged unavailable is being retried', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', 20)]),
    });
    expect(values(result.current.series)).toEqual([['b', 20]]);
    rerender(options([sample('a', null), sample('b', 20)], new Set(['a'])));
    expect(values(result.current.series)).toEqual([['a', 10], ['b', 20]]);
    expect(result.current.cachedCount).toBe(1);
  });

  it('does not rewrite storage when nothing drawn has changed', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { rerender } = renderHook(useUnrealizedChartSnapshot, { initialProps: options([sample('a', 10), sample('b', 20)]) });
    rerender(options([sample('a', 10), sample('b', 20)]));
    rerender(options([sample('a', 10), sample('b', 20)], new Set(['elsewhere'])));
    expect(write).not.toHaveBeenCalled();
    rerender(options([sample('a', 11), sample('b', 20)]));
    expect(snapshotWrites(write)).toBe(1);
  });

  it('does not use or persist snapshots before the row membership is complete', () => {
    seed([sample('a', 10), sample('b', 20)]);
    const stored = localStorage.getItem(storageKey());
    const write = vi.spyOn(Storage.prototype, 'setItem');
    // b is complete and differs from its snapshot: only the `ready` guard keeps it from being written.
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null), sample('b', 25)], new Set(['a']), { ready: false }),
    });
    expect(values(result.current.series)).toEqual([['b', 25]]);
    expect(result.current.cachedCount).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey())).toBe(stored);
    rerender(options([sample('a', null), sample('b', 25)], new Set(['a'])));
    expect(values(result.current.series)).toEqual([['a', 10], ['b', 20]]);
    expect(result.current.cachedCount).toBe(2);
    rerender(options([sample('a', 15), sample('b', 25)]));
    expect(snapshotWrites(write)).toBe(1);
    expect(JSON.parse(localStorage.getItem(storageKey())!).samples.map((item: CampaignMetricSeriesInput) => item.value)).toEqual([15, 25]);
  });

  it.each(['invalid JSON', 'invalid samples'])('ignores %s and continues to render successful fresh data', kind => {
    localStorage.setItem(storageKey(), kind === 'invalid JSON' ? '{broken' : JSON.stringify({ samples: [null, {}, sample('a', null), sample('b', 20, { operationTime: null })] }));
    const { result, rerender } = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null)], new Set(['a'])),
    });
    expect(result.current.series.points).toHaveLength(0);
    rerender(options([sample('a', 30)]));
    expect(values(result.current.series)).toEqual([['a', 30]]);
  });

  it.each(['getItem', 'setItem'] as const)('remains usable when localStorage.%s throws', method => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException('Storage unavailable'); });
    const first = renderHook(useUnrealizedChartSnapshot, { initialProps: options([sample('a', 30)]) });
    expect(values(first.result.current.series)).toEqual([['a', 30]]);
    first.unmount();
    const next = renderHook(useUnrealizedChartSnapshot, { initialProps: options([sample('a', null)], new Set(['a'])) });
    expect(values(next.result.current.series)).toEqual([['a', 30]]);
  });

  it('ignores pending IDs outside the current filter and writes storage only after rendering', () => {
    seed([sample('a', 10)]);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => {
      const frame = useUnrealizedChartSnapshot(options([sample('a', 30)], new Set(['elsewhere'])));
      expect(write).not.toHaveBeenCalled();
      return frame;
    });
    expect(values(result.current.series)).toEqual([['a', 30]]);
    expect(result.current.cachedCount).toBe(0);
    expect(snapshotWrites(write)).toBe(1);
  });

  it('bounds optional memory across accounts while keeping the most recently used account available', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage full'); });
    for (let index = 0; index < 9; index += 1) {
      const hook = renderHook(useUnrealizedChartSnapshot, {
        initialProps: options([sample('a', index + 1)], noPending, { owner: `account-${index}` }),
      });
      hook.unmount();
    }
    const latest = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null)], new Set(['a']), { owner: 'account-8' }),
    });
    expect(values(latest.result.current.series)).toEqual([['a', 9]]);
    const oldest = renderHook(useUnrealizedChartSnapshot, {
      initialProps: options([sample('a', null)], new Set(['a']), { owner: 'account-0' }),
    });
    expect(oldest.result.current.series.points).toHaveLength(0);
  });

  it('bounds persisted history without dropping fresh points from the current graph', () => {
    const samples = Array.from({ length: MAX_SAMPLES_PER_PARTITION + 1 }, (_, index) => sample(`campaign-${index}`, index));
    const { result } = renderHook(useUnrealizedChartSnapshot, { initialProps: options(samples) });
    expect(result.current.series.points).toHaveLength(MAX_SAMPLES_PER_PARTITION + 1);
    const persisted = JSON.parse(localStorage.getItem(storageKey())!).samples as CampaignMetricSeriesInput[];
    // 【用户要求】缓存适当清理：每个分区最多留 800 场，最新的那一场一定在
    expect(MAX_SAMPLES_PER_PARTITION).toBe(800);
    expect(persisted).toHaveLength(MAX_SAMPLES_PER_PARTITION);
    expect(persisted.some(item => item.campaignId === `campaign-${MAX_SAMPLES_PER_PARTITION}`)).toBe(true);
    expect(persisted.some(item => item.campaignId === 'campaign-0')).toBe(false);
  });
});
