import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePersistedState } from '@/hooks/usePersistedState';
import { queueSimStatePush } from '@/lib/simStateSync';
import { clearPersistedStateMemoryForTests, notifyPersistedStateHydrated, readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';

vi.mock('@/lib/userStoragePrefix', () => ({ getUserId: () => 'quota-test', getUserPrefix: () => 'sim_quota-test_' }));
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: vi.fn() }));

beforeEach(() => { localStorage.clear(); clearPersistedStateMemoryForTests(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); clearPersistedStateMemoryForTests(); });

it('keeps new orders visible to non-React readers and remounts after storage failure, while still backing them up to the cloud', () => {
  localStorage.setItem('sim_quota-test_cancelled_orders', '[]');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  const first = renderHook(() => usePersistedState<string[]>('cancelled_orders', []));
  act(() => first.result.current[1](['protection-a', 'protection-b']));
  expect(first.result.current[0]).toEqual(['protection-a', 'protection-b']);
  expect(readPersistedStateRaw('sim_quota-test_cancelled_orders')).toBe('["protection-a","protection-b"]');
  expect(localStorage.getItem('sim_quota-test_cancelled_orders')).toBe('[]');
  expect(queueSimStatePush).toHaveBeenCalledWith('quota-test', 'cancelled_orders', ['protection-a', 'protection-b']);
  first.unmount();
  const second = renderHook(() => usePersistedState<string[]>('cancelled_orders', []));
  expect(second.result.current[0]).toEqual(['protection-a', 'protection-b']);
  act(() => second.result.current[1](before => [...before, 'protection-c']));
  expect(second.result.current[0]).toHaveLength(3);
});

it('does not upload unchanged mount-time defaults before a slow cloud restore', () => {
  const hook = renderHook(() => usePersistedState<Record<string, unknown>>('positions_map', {}));
  const write = vi.spyOn(Storage.prototype, 'setItem');
  act(() => hook.result.current[1](before => before));
  expect(write).not.toHaveBeenCalled();
  expect(queueSimStatePush).not.toHaveBeenCalled();
});

it.each([false, true])('adopts late cloud orders without remounting or uploading them, quota=%s', (quota) => {
  const hook = renderHook(() => usePersistedState<string[]>('cancelled_orders', []));
  if (quota) vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  act(() => {
    writePersistedStateRaw('sim_quota-test_cancelled_orders', '["restored-protection"]', { source: 'remote', updatedAt: 100 });
    notifyPersistedStateHydrated('sim_quota-test_cancelled_orders');
  });
  expect(hook.result.current[0]).toEqual(['restored-protection']);
  expect(queueSimStatePush).not.toHaveBeenCalled();
  act(() => {
    writePersistedStateRaw('sim_other_cancelled_orders', '["other-account"]', { source: 'remote', updatedAt: 200 });
    notifyPersistedStateHydrated('sim_other_cancelled_orders');
  });
  expect(hook.result.current[0]).toEqual(['restored-protection']);
  act(() => hook.result.current[1](before => [...before, 'new-local-order']));
  expect(hook.result.current[0]).toEqual(['restored-protection', 'new-local-order']);
  expect(queueSimStatePush).toHaveBeenCalledWith('quota-test', 'cancelled_orders', ['restored-protection', 'new-local-order']);
});

it('keeps a batched functional local edit when a cloud restore notification arrives before React renders', async () => {
  const hook = renderHook(() => {
    const [, bump] = useState(0);
    const orders = usePersistedState<string[]>('cancelled_orders', []);
    return { orders, bump };
  });
  await act(async () => {
    // The unrelated update makes React defer the following functional updater.
    hook.result.current.bump(1);
    hook.result.current.orders[1](before => [...before, 'new-local']);
    writePersistedStateRaw('sim_quota-test_cancelled_orders', '["restored-cloud"]', { source: 'remote', updatedAt: 100 });
    notifyPersistedStateHydrated('sim_quota-test_cancelled_orders');
  });
  expect(hook.result.current.orders[0]).toEqual(['new-local']);
  expect(readPersistedStateRaw('sim_quota-test_cancelled_orders')).toBe('["new-local"]');
  expect(queueSimStatePush).toHaveBeenCalledWith('quota-test', 'cancelled_orders', ['new-local']);
});
