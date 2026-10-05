import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateSimState, type HydrateResult } from '@/lib/simStateSync';
import { useSimStateHydration } from '@/hooks/useSimStateHydration';

vi.mock('@/lib/simStateSync', () => ({ hydrateSimState: vi.fn() }));

function deferred() {
  let resolve!: (value: HydrateResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<HydrateResult>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const hydrated: HydrateResult = { status: 'hydrated', applied: 1 };

beforeEach(() => { vi.useFakeTimers(); vi.mocked(hydrateSimState).mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('account-scoped startup hydration', () => {
  it('does not block or hydrate a signed-out session; a signed-in account waits for its own data', async () => {
    const request = deferred();
    vi.mocked(hydrateSimState).mockReturnValue(request.promise);
    const hook = renderHook(({ userId }) => useSimStateHydration(userId), {
      initialProps: { userId: null as string | null },
    });
    expect(hook.result.current).toBe(true);
    expect(hydrateSimState).not.toHaveBeenCalled();
    hook.rerender({ userId: 'account-a' });
    expect(hook.result.current).toBe(false);
    await act(async () => { request.resolve(hydrated); });
    expect(hook.result.current).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases after exactly four seconds and remains ready when hydration completes late', async () => {
    const request = deferred();
    vi.mocked(hydrateSimState).mockReturnValue(request.promise);
    const hook = renderHook(() => useSimStateHydration('account-a'));
    act(() => vi.advanceTimersByTime(3_999));
    expect(hook.result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current).toBe(true);
    await act(async () => { request.resolve(hydrated); });
    expect(hook.result.current).toBe(true);
    expect(hydrateSimState).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reuse account A readiness for account B', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(hydrateSimState).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = renderHook(({ userId }) => useSimStateHydration(userId), { initialProps: { userId: 'account-a' } });
    await act(async () => { first.resolve(hydrated); });
    expect(hook.result.current).toBe(true);
    hook.rerender({ userId: 'account-b' });
    expect(hook.result.current).toBe(false);
    await act(async () => { second.resolve(hydrated); });
    expect(hook.result.current).toBe(true);
    expect(vi.mocked(hydrateSimState).mock.calls.map(([id]) => id)).toEqual(['account-a', 'account-b']);
  });

  it('ignores an old account response and cancels its timeout after switching', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(hydrateSimState).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = renderHook(({ userId }) => useSimStateHydration(userId), { initialProps: { userId: 'account-a' } });
    act(() => vi.advanceTimersByTime(3_000));
    hook.rerender({ userId: 'account-b' });
    await act(async () => { first.resolve(hydrated); });
    act(() => vi.advanceTimersByTime(1_000));
    expect(hook.result.current).toBe(false);
    act(() => vi.advanceTimersByTime(3_000));
    expect(hook.result.current).toBe(true);
  });

  it('waits again after signing out and signing back into the same account', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(hydrateSimState).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = renderHook(({ userId }) => useSimStateHydration(userId), {
      initialProps: { userId: 'account-a' as string | null },
    });
    await act(async () => { first.resolve(hydrated); });
    hook.rerender({ userId: null });
    expect(hook.result.current).toBe(true);
    hook.rerender({ userId: 'account-a' });
    expect(hook.result.current).toBe(false);
    await act(async () => { second.resolve(hydrated); });
    expect(hook.result.current).toBe(true);
  });

  it('releases on unexpected hydration rejection instead of trapping offline users', async () => {
    const request = deferred();
    vi.mocked(hydrateSimState).mockReturnValue(request.promise);
    const hook = renderHook(() => useSimStateHydration('account-a'));
    await act(async () => { request.reject(new Error('offline')); });
    expect(hook.result.current).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up the startup timer on unmount and ignores a subsequent completion', async () => {
    const request = deferred();
    vi.mocked(hydrateSimState).mockReturnValue(request.promise);
    const hook = renderHook(() => useSimStateHydration('account-a'));
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { request.resolve(hydrated); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
