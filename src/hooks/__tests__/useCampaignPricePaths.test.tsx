import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import type { CampaignCardData } from '@/lib/campaignListCache';
import { fetchReplayKlineRange } from '@/hooks/useReplayKlines';
import {
  CAMPAIGN_PRICE_PATH_CACHE_PREFIX,
  buildCampaignPricePathTask,
  clearCampaignPricePathMemoryCacheForTests,
  useCampaignPricePathTasks,
  type CampaignPricePathTask,
} from '@/hooks/useCampaignPricePaths';

vi.mock('@/hooks/useReplayKlines', () => ({ fetchReplayKlineRange: vi.fn() }));

const OWNER = 'campaign-owner';
const candles: KlineData[] = [
  { time: 60_000, open: 100, high: 120, low: 95, close: 110, volume: 10 },
  { time: 120_000, open: 110, high: 115, low: 90, close: 105, volume: 10 },
];
const fetchRange = vi.mocked(fetchReplayKlineRange);

function task(id: string, overrides: Partial<CampaignPricePathTask> = {}): CampaignPricePathTask {
  return {
    id, fingerprint: `${id}:original`, symbol: id, side: 'long', entryPrice: 100,
    startMs: 60_000, endMs: 179_999, drawdownStartMs: 60_000, drawdownEndMs: 179_999,
    interval: '1m', barMs: 60_000, historical: true, ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderTaskFrames(tasks: CampaignPricePathTask[], owner = OWNER, enabled = true) {
  const frames: ReturnType<typeof useCampaignPricePathTasks>[] = [];
  const view = renderHook(({ tasks, owner, enabled }) => {
    const frame = useCampaignPricePathTasks(tasks, owner, enabled);
    frames.push(frame);
    return frame;
  }, { initialProps: { tasks, owner, enabled } });
  return { ...view, frames };
}

async function advance(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T13:00:00Z'));
  localStorage.clear();
  clearCampaignPricePathMemoryCacheForTests();
  fetchRange.mockReset().mockResolvedValue(candles);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useCampaignPricePathTasks', () => {
  it('keeps loading all 295 campaigns across batch yields instead of stopping after an early batch', async () => {
    const tasks = Array.from({ length: 295 }, (_, index) => task(`campaign-${index}`));
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));

    await advance(2_000);

    expect(fetchRange).toHaveBeenCalledTimes(295);
    expect(result.current).toMatchObject({ total: 295, processed: 295, loaded: 295, loading: false, retrying: 0 });
    expect(result.current.peaks.size).toBe(295);
    expect(result.current.peaks.get('campaign-294')).toBeCloseTo(20);
    expect(result.current.drawdowns.get('campaign-294')).toBeCloseTo(25);
    expect(localStorage.length).toBe(295);
  });

  it('continues other campaigns after a temporary failure and retries the failed one without counting it as complete', async () => {
    const tasks = Array.from({ length: 13 }, (_, index) => task(`campaign-${index}`));
    fetchRange.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));

    await advance();

    expect(fetchRange).toHaveBeenCalledTimes(13);
    expect(result.current).toMatchObject({ total: 13, processed: 12, loaded: 12, loading: true, retrying: 1 });
    expect(result.current.peaks.has('campaign-0')).toBe(false);
    expect(result.current.unavailable.size).toBe(0);
    await advance(1_999);
    expect(fetchRange).toHaveBeenCalledTimes(13);

    await advance(1);

    expect(fetchRange).toHaveBeenCalledTimes(14);
    expect(result.current).toMatchObject({ processed: 13, loaded: 13, loading: false, retrying: 0 });
    expect(result.current.peaks.get('campaign-0')).toBeCloseTo(20);
  });

  it('respects a rate-limit cooldown and then resumes until every campaign succeeds', async () => {
    fetchRange.mockRejectedValueOnce(Object.assign(new Error('API 429'), { status: 429, retryAfterMs: 5_000 }));
    const tasks = [task('limited'), task('next')];
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));
    await advance();
    expect(result.current).toMatchObject({ processed: 0, loading: true, retrying: 1 });
    await advance(4_999);
    expect(fetchRange).toHaveBeenCalledTimes(1);

    await advance(1);

    expect(fetchRange).toHaveBeenCalledTimes(3);
    expect(fetchRange.mock.calls.map(call => call[0])).toEqual(['limited', 'next', 'limited']);
    expect(result.current).toMatchObject({ processed: 2, loaded: 2, loading: false, retrying: 0, retryAt: null });
  });

  it('keeps temporary failures retryable beyond three attempts until the missing campaign succeeds', async () => {
    fetchRange.mockRejectedValueOnce(new Error('API 503'))
      .mockRejectedValueOnce(new Error('API 503'))
      .mockRejectedValueOnce(new Error('API 503'))
      .mockRejectedValueOnce(new Error('API 503'));
    const tasks = [task('slow-recovery')];
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));

    await advance(14_000);

    expect(fetchRange).toHaveBeenCalledTimes(4);
    expect(result.current).toMatchObject({ processed: 0, loaded: 0, loading: true, retrying: 1 });
    expect(result.current.unavailable.size).toBe(0);
    await advance(16_000);
    expect(fetchRange).toHaveBeenCalledTimes(5);
    expect(result.current).toMatchObject({ processed: 1, loaded: 1, loading: false, retrying: 0 });
  });

  it('publishes a completed tail within two seconds while the next request is still loading', async () => {
    const blocked = deferred<KlineData[]>();
    fetchRange.mockResolvedValueOnce(candles).mockImplementationOnce(() => blocked.promise);
    const tasks = [task('ready'), task('loading')];
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));

    await advance(1_999);
    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(result.current.processed).toBe(0);
    await advance(1);

    expect(result.current).toMatchObject({ processed: 1, loaded: 1, loading: true });
    expect(result.current.peaks.get('ready')).toBeCloseTo(20);
    await act(async () => { blocked.resolve(candles); });
    expect(result.current).toMatchObject({ processed: 2, loaded: 2, loading: false });
  });

  it('keeps the in-flight request when sorting reorders equivalent tasks or the document becomes hidden', async () => {
    const blocked = deferred<KlineData[]>();
    fetchRange.mockImplementationOnce(() => blocked.promise);
    const tasks = [task('first'), task('second'), task('third')];
    const { result, rerender } = renderHook(({ items }) => useCampaignPricePathTasks(items, OWNER, true), { initialProps: { items: tasks } });
    const signal = fetchRange.mock.calls[0][4];
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    rerender({ items: [...tasks].reverse().map(item => ({ ...item })) });

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    await act(async () => { blocked.resolve(candles); });
    await advance();
    expect(fetchRange).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ processed: 3, loaded: 3, loading: false });
  });

  it.each(['getItem', 'setItem'] as const)('finishes all campaigns even when localStorage.%s throws', async method => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException('Storage unavailable'); });
    const tasks = Array.from({ length: 17 }, (_, index) => task(`campaign-${index}`));
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));

    await advance(2_000);

    expect(fetchRange).toHaveBeenCalledTimes(17);
    expect(result.current).toMatchObject({ processed: 17, loaded: 17, loading: false });
    expect(result.current.peaks.get('campaign-16')).toBeCloseTo(20);
  });

  it('reuses successful persisted values after a remount without fetching them again', async () => {
    const tasks = [task('one'), task('two')];
    const first = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));
    await advance();
    expect(first.result.current.loaded).toBe(2);
    first.unmount();
    expect(localStorage.getItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:one`)).not.toBeNull();
    clearCampaignPricePathMemoryCacheForTests();
    fetchRange.mockClear();

    const frames: ReturnType<typeof useCampaignPricePathTasks>[] = [];
    const remounted = renderHook(() => {
      const frame = useCampaignPricePathTasks(tasks.map(item => ({ ...item })), OWNER, true);
      frames.push(frame);
      return frame;
    });
    expect(frames[0]).toMatchObject({ processed: 2, loaded: 2, loading: false });
    expect(frames[0].peaks.get('one')).toBeCloseTo(20);
    expect(frames[0].drawdowns.get('two')).toBeCloseTo(25);
    await advance();

    expect(fetchRange).not.toHaveBeenCalled();
    expect(remounted.result.current).toMatchObject({ processed: 2, loaded: 2, loading: false });
    expect(remounted.result.current.peaks.get('one')).toBeCloseTo(20);
  });

  it('hydrates the first render when tasks arrive after mount without fetching while disabled', async () => {
    const cached = task('cached');
    localStorage.setItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:${cached.id}`, JSON.stringify({
      fingerprint: cached.fingerprint, peak: 20, drawdown: 25, savedAt: Date.now(),
    }));
    const tasks = [cached, task('missing')];
    const view = renderTaskFrames([], OWNER, false);
    view.frames.length = 0;

    view.rerender({ tasks, owner: OWNER, enabled: false });

    expect(view.frames[0]).toMatchObject({ total: 2, processed: 1, loaded: 1, loading: false });
    expect([...view.frames[0].peaks]).toEqual([['cached', 20]]);
    expect([...view.frames[0].drawdowns]).toEqual([['cached', 25]]);
    expect(fetchRange).not.toHaveBeenCalled();
    view.rerender({ tasks, owner: OWNER, enabled: true });
    await advance();
    expect(view.result.current).toMatchObject({ total: 2, processed: 2, loaded: 2, loading: false });
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange.mock.calls[0][0]).toBe('missing');
  });

  it.each([false, true])('hydrates subset-to-all on the first render (storage unavailable: %s)', async storageUnavailable => {
    if (storageUnavailable) vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    const tasks = [task('one'), task('two'), task('three')];
    const view = renderTaskFrames(tasks);
    await advance();
    expect(view.result.current.loaded).toBe(3);
    fetchRange.mockClear();

    view.frames.length = 0;
    view.rerender({ tasks: [tasks[1]], owner: OWNER, enabled: true });
    expect(view.frames[0]).toMatchObject({ total: 1, processed: 1, loaded: 1, loading: false });
    expect([...view.frames[0].peaks.keys()]).toEqual(['two']);
    view.frames.length = 0;
    view.rerender({ tasks, owner: OWNER, enabled: true });

    expect(view.frames[0]).toMatchObject({ total: 3, processed: 3, loaded: 3, loading: false });
    expect([...view.frames[0].peaks.keys()]).toEqual(['one', 'two', 'three']);
    expect([...view.frames[0].drawdowns.values()]).toEqual([25, 25, 25]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps successful results across remount when storage writes fail (reads also fail: %s)', async readsFail => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    if (readsFail) vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage unavailable'); });
    const tasks = [task('one'), task('two')];
    const first = renderTaskFrames(tasks);
    await advance();
    expect(first.result.current.loaded).toBe(2);
    first.unmount();
    expect(localStorage.length).toBe(0);
    fetchRange.mockClear();

    const returned = renderTaskFrames(tasks);

    expect(returned.frames[0]).toMatchObject({ total: 2, processed: 2, loaded: 2, loading: false });
    expect(returned.frames[0].peaks.get('one')).toBeCloseTo(20);
    expect(returned.frames[0].drawdowns.get('two')).toBeCloseTo(25);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it.each(['owner', 'fingerprint'] as const)('does not reuse memory results on the first render after the %s changes', async changed => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    const original = task('edited');
    const view = renderTaskFrames([original]);
    await advance();
    expect(view.result.current.loaded).toBe(1);
    fetchRange.mockClear();
    view.frames.length = 0;
    const replacement = changed === 'fingerprint' ? task('edited', { fingerprint: 'edited:entry-200', entryPrice: 200 }) : original;

    view.rerender({ tasks: [replacement], owner: changed === 'owner' ? 'other-owner' : OWNER, enabled: false });

    expect(view.frames[0]).toMatchObject({ total: 1, processed: 0, loaded: 0, loading: false });
    expect(view.frames[0].peaks.size).toBe(0);
    expect(view.frames[0].drawdowns.size).toBe(0);
    expect(fetchRange).not.toHaveBeenCalled();
    view.frames.length = 0;
    view.rerender({ tasks: [original], owner: OWNER, enabled: false });
    expect(view.frames[0]).toMatchObject({ processed: 1, loaded: 1 });
    expect(view.frames[0].peaks.get('edited')).toBeCloseTo(20);
  });

  it('expires ongoing memory results after exactly one minute without extending their lifetime on a read', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    const tasks = [task('ongoing', { historical: false })];
    const first = renderTaskFrames(tasks);
    await advance();
    first.unmount();
    fetchRange.mockClear();
    await advance(60_000);

    const boundary = renderTaskFrames(tasks);
    expect(boundary.frames[0]).toMatchObject({ processed: 1, loaded: 1, loading: false });
    expect(fetchRange).not.toHaveBeenCalled();
    boundary.unmount();
    await advance(1);
    const pending = deferred<KlineData[]>();
    fetchRange.mockImplementationOnce(() => pending.promise);
    const expired = renderTaskFrames(tasks);
    expect(expired.frames[0]).toMatchObject({ processed: 0, loaded: 0, loading: true });
    expect(expired.frames[0].peaks.size).toBe(0);
    expect(expired.frames[0].drawdowns.size).toBe(0);
    expect(fetchRange).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(candles); });
    expect(expired.result.current).toMatchObject({ processed: 1, loaded: 1, loading: false });
  });

  it('keeps an ongoing result that is already on screen when the chart is closed, reopened, retried or re-scoped after its 60 s cross-mount lifetime', async () => {
    const ongoing = task('ongoing', { historical: false });
    const historical = task('historical');
    const view = renderTaskFrames([ongoing, historical]);
    await advance();
    expect(view.result.current.loaded).toBe(2);
    await advance(60_001);
    fetchRange.mockClear();

    // Closing the chart (enabled -> false) and opening it again must not drop or refetch the value.
    view.frames.length = 0;
    view.rerender({ tasks: [ongoing, historical], owner: OWNER, enabled: false });
    expect(view.frames.every(frame => frame.processed === 2 && frame.loaded === 2)).toBe(true);
    view.frames.length = 0;
    view.rerender({ tasks: [ongoing, historical], owner: OWNER, enabled: true });
    await advance();
    expect(view.frames.every(frame => frame.processed === 2 && !frame.loading)).toBe(true);
    // "重试缺失项" only re-queues what is missing.
    view.frames.length = 0;
    act(() => view.result.current.retry());
    await advance();
    expect(view.frames.every(frame => frame.processed === 2 && !frame.loading)).toBe(true);
    // A narrower date range keeps the same reading as long as the inputs (fingerprint) are unchanged.
    view.frames.length = 0;
    view.rerender({ tasks: [ongoing], owner: OWNER, enabled: false });
    expect(view.frames[0]).toMatchObject({ total: 1, processed: 1, loaded: 1, loading: false });
    expect(view.frames[0].peaks.get('ongoing')).toBeCloseTo(20);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it('remembers an unavailable verdict for the session: reopening, remounting and re-scoping do not probe again, retry does', async () => {
    fetchRange.mockResolvedValue([]);
    const missing = task('no-history');
    const view = renderTaskFrames([missing]);
    await advance(6_000);
    expect(fetchRange).toHaveBeenCalledTimes(3);
    expect(view.result.current).toMatchObject({ processed: 1, loaded: 0, loading: false, retrying: 0 });
    fetchRange.mockClear();

    // Close and reopen the chart.
    view.rerender({ tasks: [missing], owner: OWNER, enabled: false });
    view.frames.length = 0;
    view.rerender({ tasks: [missing], owner: OWNER, enabled: true });
    await advance(6_000);
    expect(view.frames.every(frame => frame.processed === 1 && !frame.loading && frame.unavailable.has('no-history'))).toBe(true);
    // Change the scope (date range) and come back.
    view.rerender({ tasks: [missing, task('other', { unavailableReason: '缺少开仓价' })], owner: OWNER, enabled: true });
    await advance(6_000);
    expect(view.result.current).toMatchObject({ total: 2, processed: 2, loaded: 0, loading: false });
    view.unmount();
    // Return from a detail page: the very first frame already carries the verdict.
    const returned = renderTaskFrames([missing]);
    expect(returned.frames[0]).toMatchObject({ processed: 1, loaded: 0, loading: false });
    expect(returned.frames[0].unavailable.get('no-history')).toBeTruthy();
    await advance(6_000);
    expect(fetchRange).not.toHaveBeenCalled();
    expect(localStorage.getItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:no-history`)).toBeNull();

    // The retry button asks the exchange again, and a later success replaces the verdict.
    fetchRange.mockResolvedValue(candles);
    act(() => returned.result.current.retry());
    await advance();
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(returned.result.current).toMatchObject({ processed: 1, loaded: 1, loading: false });
    expect(returned.result.current.unavailable.size).toBe(0);
    returned.unmount();
    localStorage.clear();
    fetchRange.mockClear();
    const afterSuccess = renderTaskFrames([missing], OWNER, false);
    expect(afterSuccess.frames[0]).toMatchObject({ processed: 1, loaded: 1 });
    expect(afterSuccess.frames[0].unavailable.size).toBe(0);
  });

  it.each([
    { change: 'ten minutes pass', owner: OWNER, replacement: {}, waitMs: 10 * 60_000 + 1 },
    { change: 'the inputs change', owner: OWNER, replacement: { fingerprint: 'no-history:entry-200', entryPrice: 200 }, waitMs: 0 },
    { change: 'another account signs in', owner: 'other-owner', replacement: {}, waitMs: 0 },
  ])('rechecks an unavailable verdict once $change', async ({ owner, replacement, waitMs }) => {
    fetchRange.mockResolvedValue([]);
    const first = renderTaskFrames([task('no-history')]);
    await advance(6_000);
    expect(first.result.current.unavailable.has('no-history')).toBe(true);
    first.unmount();
    await advance(waitMs);
    fetchRange.mockClear();

    const next = renderTaskFrames([task('no-history', replacement)], owner);

    expect(next.frames[0]).toMatchObject({ processed: 0, loaded: 0, loading: true });
    await advance();
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it('keeps an unavailable verdict for exactly ten minutes', async () => {
    fetchRange.mockResolvedValue([]);
    const first = renderTaskFrames([task('no-history')]);
    await advance(6_000);
    expect(first.result.current.unavailable.has('no-history')).toBe(true);
    first.unmount();
    fetchRange.mockClear();

    await advance(10 * 60_000);
    const boundary = renderTaskFrames([task('no-history')]);
    expect(boundary.frames[0]).toMatchObject({ processed: 1, loaded: 0, loading: false });
    await advance();
    expect(fetchRange).not.toHaveBeenCalled();
    boundary.unmount();

    await advance(1);
    const expired = renderTaskFrames([task('no-history')]);
    expect(expired.frames[0]).toMatchObject({ processed: 0, loading: true });
    await advance();
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it('reports a stalled queue while offline without sending requests, and resumes when the connection returns', async () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const view = renderTaskFrames([task('waiting')]);
    await advance();
    expect(view.result.current).toMatchObject({ processed: 0, loading: true, retrying: 0, retryAt: null, offline: true, stalled: true });
    await advance(29_000);
    expect(fetchRange).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await advance();

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(view.result.current).toMatchObject({ processed: 1, loaded: 1, loading: false, offline: false, stalled: false });
  });

  it('is stalled only when everything left is waiting for a retry or a rate-limit cooldown', async () => {
    // "flaky" fails once with a retryable error while "steady" has not been tried yet: the queue still moves.
    const steady = deferred<KlineData[]>();
    fetchRange.mockRejectedValue(new Error('API 503'));
    fetchRange.mockRejectedValueOnce(new Error('API 503')).mockImplementationOnce(() => steady.promise);
    const view = renderTaskFrames([task('flaky'), task('steady')]);
    await advance();
    expect(view.result.current).toMatchObject({ processed: 0, retrying: 1, stalled: false });
    // Once "steady" is done, the only campaign left is the one that keeps waiting for its retry.
    await act(async () => { steady.resolve(candles); });
    await advance(2_000);
    expect(view.result.current).toMatchObject({ processed: 1, retrying: 1, loading: true, stalled: true, offline: false });
    fetchRange.mockResolvedValue(candles);
    await advance(4_000);
    expect(view.result.current).toMatchObject({ processed: 2, retrying: 0, loading: false, stalled: false });
    view.unmount();

    // A rate limit pauses the whole queue even though other campaigns were never tried.
    fetchRange.mockReset().mockRejectedValue(Object.assign(new Error('API 429'), { status: 429, retryAfterMs: 5_000 }));
    const limited = renderTaskFrames([task('limited-one'), task('limited-two')]);
    await advance();
    expect(limited.result.current.retryAt).not.toBeNull();
    expect(limited.result.current).toMatchObject({ processed: 0, retrying: 1, stalled: true, offline: false });
    // Not enabled (the metric is not on screen): nothing is reported as stalled.
    limited.rerender({ tasks: [task('limited-one'), task('limited-two')], owner: OWNER, enabled: false });
    expect(limited.result.current).toMatchObject({ loading: false, stalled: false, offline: false });
  });

  it('does not remember an unavailable verdict for an ongoing campaign', async () => {
    fetchRange.mockRejectedValue(Object.assign(new Error('API 400'), { status: 400 }));
    const first = renderTaskFrames([task('ongoing', { historical: false })]);
    await advance();
    expect(first.result.current.unavailable.has('ongoing')).toBe(true);
    first.unmount();
    fetchRange.mockClear();

    const next = renderTaskFrames([task('ongoing', { historical: false })]);
    await advance();

    expect(next.frames[0]).toMatchObject({ processed: 0, loading: true });
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it('counts only complete cached pairs and explicit unavailable tasks when expanding the task set', () => {
    const complete = task('complete');
    const partial = task('partial');
    localStorage.setItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:${complete.id}`, JSON.stringify({
      fingerprint: complete.fingerprint, peak: 0, drawdown: 0, savedAt: Date.now(),
    }));
    localStorage.setItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:${partial.id}`, JSON.stringify({
      fingerprint: partial.fingerprint, peak: 20, drawdown: null, savedAt: Date.now(),
    }));
    const view = renderTaskFrames([], OWNER, false);
    view.frames.length = 0;

    view.rerender({ tasks: [complete, partial, task('invalid', { unavailableReason: '缺少开仓价' })], owner: OWNER, enabled: false });

    expect(view.frames[0]).toMatchObject({ total: 3, processed: 2, loaded: 1, loading: false });
    expect([...view.frames[0].peaks]).toEqual([['complete', 0], ['invalid', null]]);
    expect([...view.frames[0].drawdowns]).toEqual([['complete', 0], ['invalid', null]]);
    expect([...view.frames[0].unavailable]).toEqual([['invalid', '缺少开仓价']]);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it('bounds the shared memory cache at 1,024 results and evicts the least recently used one', () => {
    const tasks = Array.from({ length: 1_025 }, (_, index) => task(`cached-${index}`));
    const persist = (items: CampaignPricePathTask[]) => items.forEach(item => {
      localStorage.setItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:${item.id}`, JSON.stringify({
        fingerprint: item.fingerprint, peak: 20, drawdown: 25, savedAt: Date.now(),
      }));
    });
    persist(tasks.slice(0, 1_024));
    const filled = renderTaskFrames(tasks.slice(0, 1_024), OWNER, false);
    expect(filled.result.current.loaded).toBe(1_024);
    filled.unmount();
    localStorage.clear();

    // Exactly 1,024 entries fit; reading the oldest one makes it the most recently used.
    const touched = renderTaskFrames([tasks[0], tasks[1_023]], OWNER, false);
    expect([...touched.frames[0].peaks.keys()]).toEqual(['cached-0', 'cached-1023']);
    touched.unmount();
    // One more result evicts the entry that was not read for the longest time (cached-1), not the first inserted.
    persist([tasks[1_024]]);
    renderTaskFrames([tasks[1_024]], OWNER, false).unmount();
    localStorage.clear();

    const returned = renderTaskFrames([tasks[0], tasks[1], tasks[2], tasks[1_024]], OWNER, false);

    expect(returned.frames[0]).toMatchObject({ processed: 3, loaded: 3, total: 4 });
    expect([...returned.frames[0].peaks.keys()]).toEqual(['cached-0', 'cached-2', 'cached-1024']);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it('restores a partial scan on the first render and loads only the remaining campaigns', async () => {
    const tasks = [task('ready'), task('pending')];
    const originalPending = deferred<KlineData[]>();
    fetchRange.mockResolvedValueOnce(candles).mockImplementationOnce(() => originalPending.promise);
    const first = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));
    await advance(2_000);
    expect(first.result.current).toMatchObject({ processed: 1, loading: true });
    first.unmount();
    fetchRange.mockClear();
    const resumedPending = deferred<KlineData[]>();
    fetchRange.mockImplementationOnce(() => resumedPending.promise);

    const frames: ReturnType<typeof useCampaignPricePathTasks>[] = [];
    const remounted = renderHook(() => {
      const frame = useCampaignPricePathTasks(tasks, OWNER, true);
      frames.push(frame);
      return frame;
    });

    expect(frames[0]).toMatchObject({ total: 2, processed: 1, loaded: 1, loading: true });
    expect(frames[0].peaks.get('ready')).toBeCloseTo(20);
    expect(frames[0].drawdowns.get('ready')).toBeCloseTo(25);
    expect(frames[0].peaks.has('pending')).toBe(false);
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(fetchRange.mock.calls[0][0]).toBe('pending');
    await act(async () => { resumedPending.resolve(candles); });
    expect(remounted.result.current).toMatchObject({ processed: 2, loaded: 2, loading: false });
  });

  it.each([
    { reason: 'another owner', owner: 'other-owner', fingerprint: 'cached:original', historical: true, age: 0 },
    { reason: 'changed inputs', owner: OWNER, fingerprint: 'cached:entry-200', historical: true, age: 0 },
    { reason: 'an expired ongoing campaign', owner: OWNER, fingerprint: 'cached:original', historical: false, age: 60_001 },
    { reason: 'an ongoing campaign without a cache timestamp', owner: OWNER, fingerprint: 'cached:original', historical: false, age: null },
  ])('does not show cached values for $reason on the first render', async ({ owner, fingerprint, historical, age }) => {
    localStorage.setItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:cached`, JSON.stringify({
      fingerprint: 'cached:original', peak: 20, drawdown: 25,
      ...(age == null ? {} : { savedAt: Date.now() - age }),
    }));
    const pending = deferred<KlineData[]>();
    fetchRange.mockImplementationOnce(() => pending.promise);
    const tasks = [task('cached', { fingerprint, historical, entryPrice: fingerprint === 'cached:entry-200' ? 200 : 100 })];
    const frames: ReturnType<typeof useCampaignPricePathTasks>[] = [];
    const { result } = renderHook(() => {
      const frame = useCampaignPricePathTasks(tasks, owner, true);
      frames.push(frame);
      return frame;
    });

    expect(frames[0]).toMatchObject({ processed: 0, loaded: 0, loading: true });
    expect(frames[0].peaks.has('cached')).toBe(false);
    expect(frames[0].drawdowns.has('cached')).toBe(false);
    expect(fetchRange).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(candles); });
    expect(result.current).toMatchObject({ processed: 1, loaded: 1, loading: false });
  });

  it('restores an ongoing campaign cache within its one-minute lifetime on the first render', () => {
    const tasks = [task('ongoing', { historical: false })];
    localStorage.setItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:ongoing`, JSON.stringify({
      fingerprint: tasks[0].fingerprint, peak: 20, drawdown: 25, savedAt: Date.now() - 60_000,
    }));
    const frames: ReturnType<typeof useCampaignPricePathTasks>[] = [];
    renderHook(() => {
      const frame = useCampaignPricePathTasks(tasks, OWNER, true);
      frames.push(frame);
      return frame;
    });

    expect(frames[0]).toMatchObject({ processed: 1, loaded: 1, loading: false });
    expect(frames[0].peaks.get('ongoing')).toBe(20);
    expect(frames[0].drawdowns.get('ongoing')).toBe(25);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it('does not reuse another owner\'s persisted or in-memory values', async () => {
    const tasks = [task('same-campaign')];
    const blocked = deferred<KlineData[]>();
    const { result, rerender } = renderHook(({ owner }) => useCampaignPricePathTasks(tasks, owner, true), { initialProps: { owner: OWNER } });
    await advance();
    expect(result.current.loaded).toBe(1);
    fetchRange.mockImplementationOnce(() => blocked.promise);

    rerender({ owner: 'other-owner' });

    expect(result.current.peaks.has('same-campaign')).toBe(false);
    expect(result.current.processed).toBe(0);
    expect(fetchRange).toHaveBeenCalledTimes(2);
    await act(async () => { blocked.resolve(candles); });
    expect(result.current.loaded).toBe(1);
  });

  it('removes an old value immediately when the same campaign\'s calculation fingerprint changes', async () => {
    const original = task('edited');
    const replacement = task('edited', { fingerprint: 'edited:entry-200', entryPrice: 200 });
    const blocked = deferred<KlineData[]>();
    const { result, rerender } = renderHook(({ tasks }) => useCampaignPricePathTasks(tasks, OWNER, true), { initialProps: { tasks: [original] } });
    await advance();
    expect(result.current.peaks.get('edited')).toBeCloseTo(20);
    fetchRange.mockImplementationOnce(() => blocked.promise);

    rerender({ tasks: [replacement] });

    expect(result.current.peaks.has('edited')).toBe(false);
    expect(result.current.processed).toBe(0);
    expect(result.current.loading).toBe(true);
    expect(fetchRange).toHaveBeenCalledTimes(2);
    await act(async () => { blocked.resolve(candles); });
    expect(result.current.peaks.get('edited')).toBe(0);
    expect(result.current.loaded).toBe(1);
  });

  it('keeps completed work from an unpublished tail batch when disabled and resumes remaining work when enabled', async () => {
    const tasks = Array.from({ length: 9 }, (_, index) => task(`campaign-${index}`));
    let pendingSignal: AbortSignal | undefined;
    fetchRange.mockImplementation(async (_symbol, _interval, _start, _end, signal) => {
      if (fetchRange.mock.calls.length === 6) {
        pendingSignal = signal;
        return new Promise<KlineData[]>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      }
      return candles;
    });
    const { result, rerender } = renderHook(({ enabled }) => useCampaignPricePathTasks(tasks, OWNER, enabled), { initialProps: { enabled: true } });
    await advance();
    expect(fetchRange).toHaveBeenCalledTimes(6);
    expect(result.current.processed).toBe(0);

    rerender({ enabled: false });

    expect(pendingSignal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ processed: 5, loaded: 5, loading: false });
    rerender({ enabled: true });
    await advance();
    expect(result.current).toMatchObject({ processed: 9, loaded: 9, loading: false });
    expect(fetchRange).toHaveBeenCalledTimes(10);
    expect(fetchRange.mock.calls.filter(call => call[0] === 'campaign-0')).toHaveLength(1);
  });

  it('aborts in-flight requests on cleanup and never publishes or persists a late partial response', async () => {
    const tasks = [task('cancelled'), task('not-started')];
    const inFlight = deferred<KlineData[]>();
    fetchRange.mockImplementationOnce(() => inFlight.promise);
    const first = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));
    expect(fetchRange).toHaveBeenCalledTimes(1);
    const signal = fetchRange.mock.calls[0][4];

    first.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { inFlight.resolve(candles.slice(0, 1)); });
    await advance(10_000);

    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:cancelled`)).toBeNull();
    const remounted = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));
    await advance();
    expect(fetchRange).toHaveBeenCalledTimes(3);
    expect(remounted.result.current).toMatchObject({ loaded: 2, loading: false });
    expect(remounted.result.current.drawdowns.get('cancelled')).toBeCloseTo(25);
  });

  it('rechecks empty historical responses and then marks unavailable without inventing a zero value or caching failure', async () => {
    fetchRange.mockResolvedValue([]);
    const tasks = [task('no-history')];
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));
    await advance();
    expect(result.current).toMatchObject({ processed: 0, loaded: 0, loading: true, retrying: 1 });
    await advance(2_000);
    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(result.current.processed).toBe(0);

    await advance(4_000);

    expect(fetchRange).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ processed: 1, loaded: 0, loading: false, retrying: 0 });
    expect(result.current.peaks.get('no-history')).toBeNull();
    expect(result.current.drawdowns.get('no-history')).toBeNull();
    expect(result.current.unavailable.get('no-history')).toBeTruthy();
    expect(localStorage.getItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:no-history`)).toBeNull();
  });

  it.each([
    { missing: 'end', partial: candles.slice(0, 1) },
    { missing: 'start', partial: candles.slice(1) },
  ])('rechecks a nonempty historical range missing its $missing instead of treating the partial price path as complete', async ({ partial }) => {
    fetchRange.mockResolvedValue(partial);
    const tasks = [task('partial-history')];
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));
    await advance(2_000);
    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ processed: 0, loaded: 0, loading: true, retrying: 1 });
    expect(result.current.peaks.has('partial-history')).toBe(false);

    await advance(4_000);

    expect(fetchRange).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ processed: 1, loaded: 0, loading: false, retrying: 0 });
    expect(result.current.peaks.get('partial-history')).toBeNull();
    expect(result.current.drawdowns.get('partial-history')).toBeNull();
    expect(result.current.unavailable.get('partial-history')).toBeTruthy();
    expect(localStorage.getItem(`${CAMPAIGN_PRICE_PATH_CACHE_PREFIX}${OWNER}:partial-history`)).toBeNull();
  });

  it('does not spend incomplete-history retries on previous transient network failures', async () => {
    fetchRange.mockRejectedValueOnce(new Error('API 503'))
      .mockRejectedValueOnce(new Error('API 503'))
      .mockResolvedValueOnce(candles.slice(0, 1))
      .mockResolvedValueOnce(candles.slice(0, 1));
    const tasks = [task('eventually-complete')];
    const { result } = renderHook(() => useCampaignPricePathTasks(tasks, OWNER, true));

    await advance(14_000);

    expect(fetchRange).toHaveBeenCalledTimes(4);
    expect(result.current).toMatchObject({ processed: 0, loaded: 0, loading: true, retrying: 1 });
    expect(result.current.unavailable.size).toBe(0);
    await advance(16_000);
    expect(fetchRange).toHaveBeenCalledTimes(5);
    expect(result.current).toMatchObject({ processed: 1, loaded: 1, loading: false, retrying: 0 });
    expect(result.current.drawdowns.get('eventually-complete')).toBeCloseTo(25);
  });

  it('keeps an invalid explicit close time unavailable instead of silently extending the range to today', () => {
    const row = {
      campaign: {
        id: 'invalid-close', symbol: 'BTCUSDT', opened_at: '2026-01-01T00:00:00Z',
        closed_at: 'invalid-date', actual_evolution: [], direction: 'main_long',
      },
      legs: [], tradeRecords: [],
    } as CampaignCardData;

    const invalid = buildCampaignPricePathTask(row);
    const { result } = renderHook(() => useCampaignPricePathTasks([invalid], OWNER, true));

    expect(invalid.endMs).toBeNaN();
    expect(invalid.historical).toBe(true);
    expect(invalid.unavailableReason).toBeTruthy();
    expect(result.current).toMatchObject({ processed: 1, loaded: 0, loading: false });
    expect(result.current.unavailable.has('invalid-close')).toBe(true);
    expect(fetchRange).not.toHaveBeenCalled();
  });
});
