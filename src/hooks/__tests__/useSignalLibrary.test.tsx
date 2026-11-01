import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSignalLibrary } from '../useSignalLibrary';
import { loadSignals, setSignalQuality, SIGNAL_LIBRARY_STORAGE_KEY, SIGNAL_LIBRARY_DEFAULT_VERSION_KEY, SIGNAL_LIBRARY_DEFAULT_VERSION, type TradeSignal } from '@/lib/signalLibrary';
import { clearPersistedStateMemoryForTests, notifyPersistedStateHydrated, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { queueSimStatePush } from '@/lib/simStateSync';
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: vi.fn() }));
const original: TradeSignal[] = [{ id: 's', symbol: 'AAAUSDT', timeMs: 100, timeLabel: '', fallbackZone: '1' }];
beforeEach(() => { localStorage.clear(); clearPersistedStateMemoryForTests(); vi.mocked(queueSimStatePush).mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); clearPersistedStateMemoryForTests(); });
const fullStorage = () => vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
it('does not upload bundled defaults while an account restore is still pending', () => {
  const h = renderHook(useSignalLibrary);
  expect(h.result.current[0].length).toBeGreaterThan(0);
  expect(queueSimStatePush).not.toHaveBeenCalled(); expect(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY)).toBeNull();
});
it('reads restored ratings from session memory when full storage still contains an unrated old copy', () => {
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(original)); fullStorage();
  const rated = [{ ...original[0], quality: 4 }];
  expect(writePersistedStateRaw(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(rated), { source: 'remote', updatedAt: 200 })).toBe(false);
  expect(loadSignals()).toEqual(rated);
  const h = renderHook(useSignalLibrary); expect(h.result.current[0]).toEqual(rated);
  expect(queueSimStatePush).not.toHaveBeenCalled();
});
it('adopts a late cloud restore without publishing the old mounted list over it', async () => {
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(original));
  const h = renderHook(useSignalLibrary); const rated = [{ ...original[0], quality: 5 }]; fullStorage();
  await act(async () => {
    writePersistedStateRaw(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(rated), { source: 'remote', updatedAt: 200 });
    notifyPersistedStateHydrated(SIGNAL_LIBRARY_STORAGE_KEY);
  });
  expect(h.result.current[0]).toEqual(rated); expect(queueSimStatePush).not.toHaveBeenCalled();
});
it('persists new ratings and explicit withdrawals through quota failures, without a local refresh loop', async () => {
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(original));
  localStorage.setItem(SIGNAL_LIBRARY_DEFAULT_VERSION_KEY, SIGNAL_LIBRARY_DEFAULT_VERSION);
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'rating-owner' } }));
  const h = renderHook(useSignalLibrary); fullStorage();
  await act(async () => h.result.current[1](before => setSignalQuality(before, 's', 3)));
  expect(loadSignals()[0].quality).toBe(3); expect(h.result.current[0][0].quality).toBe(3);
  expect(queueSimStatePush).toHaveBeenLastCalledWith('rating-owner', 'signal_library_v1', expect.arrayContaining([expect.objectContaining({ quality: 3 })]));
  await act(async () => h.result.current[1](before => setSignalQuality(before, 's', 3)));
  expect(loadSignals()[0].quality).toBeUndefined(); expect(h.result.current[0][0].quality).toBeUndefined();
  expect(queueSimStatePush).toHaveBeenCalledTimes(2);
});
