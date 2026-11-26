import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FISH_INSTANT_MONITOR_KEY } from '@/lib/fish/instantMonitorSettings';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { pushSimStateImmediately } from '@/lib/simStateSync';
import { useInstantMonitorSettings } from '../useInstantMonitorSettings';

vi.mock('@/lib/simStateSync', () => ({ pushSimStateImmediately: vi.fn() }));

const owner = 'monitor-settings-fixture';
const key = getUserPrefix(owner) + FISH_INSTANT_MONITOR_KEY;

afterEach(() => {
  cleanup();
  localStorage.removeItem(key);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('acknowledges local persistence before the cloud replies and keeps syncing', async () => {
  let reply!: (confirmed: boolean) => void;
  vi.mocked(pushSimStateImmediately).mockReturnValueOnce(new Promise(resolve => { reply = resolve; }));
  const { result } = renderHook(() => useInstantMonitorSettings(owner));
  await waitFor(() => expect(result.current.restoreStatus).toBe('ready'));
  await act(async () => { await result.current.save(); });
  expect(localStorage.getItem(key)).toBe('null');
  expect(result.current.pendingCloud).toBe(true);
  await act(async () => { reply(true); });
  expect(result.current.pendingCloud).toBe(false);
});

it('automatically retries a failed cloud acknowledgment without reopening settings', async () => {
  vi.useFakeTimers();
  const push = vi.mocked(pushSimStateImmediately);
  push.mockClear().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { result } = renderHook(() => useInstantMonitorSettings(owner));
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(async () => { await result.current.save(); });
  expect(result.current.pendingCloud).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(push).toHaveBeenCalledTimes(2);
  expect(result.current.pendingCloud).toBe(false);
});
