import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import { useFishReconstruction } from '@/hooks/useFishReconstruction';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { reconstructionCacheKey, reconstructionStorageKey, readReconstructionCache, saveReconstructionCache, type ReconstructionCard } from '@/lib/fish/reconstructionCache';
import type { FishReconstructionOptions, FishReconstructionResult } from '@/lib/fish/reconstruction';
import type { TradeSignal } from '@/lib/signalLibrary';

vi.mock('@/hooks/useFishFeatures', () => ({ useFishFeatures: vi.fn() }));
const def = { ...CBI2_DEF, id: 'reconstruction-ui', short: 'TEST', formula: 'avg_X = avg(C, 1)', scale: 1 };
const cards: ReconstructionCard[] = [{ id: 'first', featureId: def.id, enabled: true, pref: { statistic: '结果', direction: '>', threshold: '2', constraints: [] } }];
const signals: TradeSignal[] = [{ id: 'one', symbol: 'AAAUSDT', timeMs: Date.UTC(2026, 5, 20), timeLabel: '', fallbackZone: '' }];
const report = (createdAt = 1000) => ({ createdAt, algorithms: [] } as unknown as FishReconstructionResult);
function login(account: string) {
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: account } }));
  localStorage.setItem(`sim_${account}_fish-cards.v1`, JSON.stringify(cards));
}
function deferred() {
  let resolve!: (value: FishReconstructionResult) => void;
  const promise = new Promise<FishReconstructionResult>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.mocked(useFishFeatures).mockReturnValue([def]); login('account-a'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('local-only reconstruction lifecycle', () => {
  it('restores and evaluates all 50 saved rules instead of truncating to six', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...cards[0], id: `rule-${i}`,
      pref: { ...cards[0].pref, threshold: String(i + 2) } }));
    localStorage.setItem('sim_account-a_fish-cards.v1', JSON.stringify(many));
    const execute = vi.fn(async (_options: FishReconstructionOptions) => report());
    const hook = renderHook(() => useFishReconstruction('account-a', signals, execute));
    await act(async () => { await hook.result.current.start(); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].plans).toHaveLength(50);
    expect(execute.mock.calls[0][0].plans[49].settings.threshold).toBe(51);
  });
  it('mount and settings changes never start evaluation; explicit start saves locally without mutating signals', async () => {
    const execute = vi.fn(async (_options: FishReconstructionOptions) => report());
    const originalSignals = JSON.stringify(signals);
    const hook = renderHook(() => useFishReconstruction('account-a', signals, execute));
    expect(execute).not.toHaveBeenCalled(); expect(hook.result.current.result).toBeNull();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => { await hook.result.current.start(); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ plans: [expect.objectContaining({ settings: expect.objectContaining({ statistic: '结果', direction: '>', threshold: 2 }) })] }));
    expect(hook.result.current.result).toEqual(report());
    expect(writes.mock.calls.map(([key]) => key)).toEqual([reconstructionStorageKey('account-a')]);
    expect(JSON.stringify(signals)).toBe(originalSignals);
    act(() => hook.result.current.onCardsChange([{ ...cards[0], pref: { ...cards[0].pref, threshold: '3' } }]));
    expect(hook.result.current.stale).toBe(true); expect(execute).toHaveBeenCalledTimes(1);
  });

  it('exact cache hits show immediately and explicit start does not call the runner', async () => {
    const key = reconstructionCacheKey('account-a', cards, [def], signals);
    saveReconstructionCache('account-a', key, report());
    const execute = vi.fn(async () => report(2000));
    const hook = renderHook(() => useFishReconstruction('account-a', signals, execute));
    expect(hook.result.current.result).toEqual(report()); expect(hook.result.current.stale).toBe(false);
    await act(async () => { await hook.result.current.start(); });
    expect(execute).not.toHaveBeenCalled(); expect(hook.result.current.result).toEqual(report());
  });

  it('threshold, selected sequence, definition and signal changes expire old results without fetching', () => {
    const key = reconstructionCacheKey('account-a', cards, [def], signals);
    saveReconstructionCache('account-a', key, report());
    const execute = vi.fn(async (_options: FishReconstructionOptions) => report());
    const hook = renderHook(({ samples }) => useFishReconstruction('account-a', samples, execute), { initialProps: { samples: signals } });
    for (const patch of [{ threshold: '3' }, { statistic: 'avg_X' }, { direction: '<' as const }]) {
      act(() => hook.result.current.onCardsChange([{ ...cards[0], pref: { ...cards[0].pref, ...patch } }]));
      expect(hook.result.current.stale).toBe(true);
      act(() => hook.result.current.onCardsChange(cards));
      expect(hook.result.current.stale).toBe(false);
    }
    hook.rerender({ samples: [{ ...signals[0], timeMs: signals[0].timeMs + 300000 }] });
    expect(hook.result.current.stale).toBe(true); expect(hook.result.current.result).toEqual(report());
    hook.rerender({ samples: signals }); expect(hook.result.current.stale).toBe(false);
    vi.mocked(useFishFeatures).mockReturnValue([{ ...def, formula: 'avg_X = avg(C, 2)' }]);
    hook.rerender({ samples: signals }); expect(hook.result.current.stale).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("accounts never display or reuse another account's cache", async () => {
    saveReconstructionCache('account-a', reconstructionCacheKey('account-a', cards, [def], signals), report(1000));
    saveReconstructionCache('account-b', reconstructionCacheKey('account-b', cards, [def], signals), report(2000));
    const execute = vi.fn(async () => report(3000));
    const hook = renderHook(({ account }) => useFishReconstruction(account, signals, execute), { initialProps: { account: 'account-a' } });
    expect(hook.result.current.result?.createdAt).toBe(1000);
    login('account-b'); hook.rerender({ account: 'account-b' });
    expect(hook.result.current.result?.createdAt).toBe(2000); expect(hook.result.current.stale).toBe(false);
    await act(async () => { await hook.result.current.start(); }); expect(execute).not.toHaveBeenCalled();
    login('account-c'); hook.rerender({ account: 'account-c' });
    expect(hook.result.current.result).toBeNull();
    expect(reconstructionStorageKey(undefined)).not.toBe(reconstructionStorageKey('account-a'));
  });

  it('cancelled late resolutions cannot replace a result or enter the cache', async () => {
    const request = deferred();
    let options!: FishReconstructionOptions;
    const execute = vi.fn((o: FishReconstructionOptions) => { options = o; o.onProgress({ status: 'running', phase: 'loading', done: 1, total: 2, current: 'AAAUSDT' } as FishReconstructionOptions['onProgress'] extends (p: infer P) => void ? P : never); return request.promise; });
    const hook = renderHook(() => useFishReconstruction('account-a', signals, execute));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.start(); });
    expect(hook.result.current.running).toBe(true);
    act(() => hook.result.current.cancel()); expect(options.signal.aborted).toBe(true);
    await act(async () => { request.resolve(report()); await pending; });
    expect(hook.result.current.running).toBe(false); expect(hook.result.current.result).toBeNull();
    expect(readReconstructionCache('account-a')).toBeNull();
    expect(hook.result.current.progress?.status).toBe('cancelled');
  });

  it('switching accounts aborts old work and ignores its late result', async () => {
    const request = deferred(); let options!: FishReconstructionOptions;
    const execute = vi.fn((o: FishReconstructionOptions) => { options = o; return request.promise; });
    const hook = renderHook(({ account }) => useFishReconstruction(account, signals, execute), { initialProps: { account: 'account-a' } });
    let pending!: Promise<void>; act(() => { pending = hook.result.current.start(); });
    login('account-b'); hook.rerender({ account: 'account-b' }); expect(options.signal.aborted).toBe(true);
    await act(async () => { request.resolve(report()); await pending; });
    expect(hook.result.current.result).toBeNull(); expect(hook.result.current.running).toBe(false);
    expect(readReconstructionCache('account-a')).toBeNull(); expect(readReconstructionCache('account-b')).toBeNull();
  });

  it('changing the library during a run aborts it and never saves the obsolete signal set', async () => {
    const request = deferred(); let options!: FishReconstructionOptions;
    const execute = vi.fn((o: FishReconstructionOptions) => { options = o; return request.promise; });
    const hook = renderHook(({ samples }) => useFishReconstruction('account-a', samples, execute), { initialProps: { samples: signals } });
    let pending!: Promise<void>; act(() => { pending = hook.result.current.start(); });
    hook.rerender({ samples: [...signals, { ...signals[0], id: 'two', timeMs: signals[0].timeMs + 300000 }] });
    expect(options.signal.aborted).toBe(true);
    await act(async () => { request.resolve(report()); await pending; });
    expect(hook.result.current.result).toBeNull(); expect(readReconstructionCache('account-a')).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
