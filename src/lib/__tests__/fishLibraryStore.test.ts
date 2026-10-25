import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TradeSignal } from '@/lib/signalLibrary';
import { archiveFishForNextRound, fishDedupKey } from '@/lib/fish/records';
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: vi.fn() }));

// Disk survives module reloads; transactions report completion only after put/abort.
const disk = new Map<string, unknown>();
let failWrites = false;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); disk.clear(); localStorage.clear(); failWrites = false;
  const database = { close() {}, createObjectStore() {}, transaction() {
    const tx: { oncomplete?: () => void; onabort?: () => void; objectStore?: () => object; abort?: () => void } = {};
    tx.abort = () => queueMicrotask(() => tx.onabort?.());
    tx.objectStore = () => ({
      get(k: string) { const r: { result?: unknown; onsuccess?: () => void } = {}; queueMicrotask(() => { r.result = structuredClone(disk.get(k)); r.onsuccess?.(); }); return r; },
      put(v: unknown, k: string) { if (failWrites) { tx.abort!(); return; } disk.set(k, structuredClone(v)); queueMicrotask(() => tx.oncomplete?.()); },
    }); return tx;
  } };
  vi.stubGlobal('indexedDB', { open() { const r: { result?: unknown; onsuccess?: () => void } = {}; queueMicrotask(() => { r.result = database; r.onsuccess?.(); }); return r; } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });
const fish = (i = 0, caughtAt = 100): TradeSignal => ({ id: `fish-${i}`, symbol: `COIN${i}USDT`, timeMs: i + 1, timeLabel: '2026-10-25 08:00:00', fallbackZone: '', freshCatch: true, caughtAt, quality: 4, fish: { featureId: 'state', featureShort: 'S', statistic: 'state', average: .71, cbi2: .71, startAverage: .71, previousAverage: .69, threshold: .7, cutoffMs: 2 } });

it('localStorage quota does not discard 609 full snapshots; a module reload restores every round from IndexedDB', async () => {
  const cache = await import('@/lib/fishSignals');
  const store = await import('@/lib/fish/libraryStore');
  const storage = await import('@/lib/persistedStateStorage');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  const round = Array.from({ length: 203 }, (_, i) => fish(i));
  const rows = [...archiveFishForNextRound(round, 200), ...archiveFishForNextRound(round.map(s => ({ ...s, caughtAt: 250 })), 300), ...round.map(s => ({ ...s, caughtAt: 301 }))];
  expect(cache.saveFishSignals(rows, 'alice')).toBe(false);
  expect((await store.loadFishLibraryBackup('alice'))?.signals).toHaveLength(609);
  storage.clearPersistedStateMemoryForTests(); vi.resetModules();
  const reloadedStore = await import('@/lib/fish/libraryStore');
  const reloadedCache = await import('@/lib/fishSignals');
  const restored = reloadedCache.restoreFishSignals(await reloadedStore.loadFishLibraryBackup('alice'), [], 'alice');
  expect(restored).toHaveLength(609);
  expect(restored.filter(s => s.freshCatch)).toHaveLength(203);
  expect(restored.filter(s => s.fishArchive)).toHaveLength(406);
  expect(restored.every(s => s.quality === 4 && s.fish?.average === .71)).toBe(true);
  expect(new Set(restored.map(fishDedupKey)).size).toBe(609);
  await reloadedStore.loadFishLibraryBackup('alice');
});

it('coalesces rapid writes, keeps other-tab history and isolates each account', async () => {
  const store = await import('@/lib/fish/libraryStore');
  await store.saveFishLibraryBackup('alice', { signals: archiveFishForNextRound([fish(1)], 200), tombstones: {} });
  const writes = Array.from({ length: 8 }, (_, i) => store.saveFishLibraryBackup('alice', { signals: [fish(i + 2, 301)], tombstones: {} }));
  await Promise.all(writes);
  expect((await store.loadFishLibraryBackup('alice'))?.signals).toHaveLength(9);
  expect(await store.loadFishLibraryBackup('bob')).toBeNull();
  await store.saveFishLibraryBackup('bob', { signals: [fish(99)], tombstones: {} });
  expect((await store.loadFishLibraryBackup('bob'))?.signals.map(s => s.symbol)).toEqual(['COIN99USDT']);
  expect(await store.loadFishLibraryBackup(undefined)).toBeNull();
});

it('keeps manual deletion durable and never turns it into a recovered archive', async () => {
  const cache = await import('@/lib/fishSignals');
  const store = await import('@/lib/fish/libraryStore');
  const current = fish(); cache.saveFishSignals([current], 'alice');
  const stale = (await store.loadFishLibraryBackup('alice'))!;
  cache.recordFishDeletion([current], 'alice', 200);
  cache.saveFishSignals([], 'alice');
  expect((await store.loadFishLibraryBackup('alice'))?.signals).toEqual([]);
  expect(cache.restoreFishSignals(stale, [], 'alice', 300)).toEqual([]);
  // Even another stale writer cannot bring it back into IndexedDB.
  await store.saveFishLibraryBackup('alice', stale);
  expect((await store.loadFishLibraryBackup('alice'))?.signals).toEqual([]);
});

it('delayed recovery archives only missing old catches, preserves current fresh fish and avoids duplicate archives', async () => {
  const cache = await import('@/lib/fishSignals');
  const store = await import('@/lib/fish/libraryStore');
  const prior = [fish(), { ...fish(1), freshCatch: undefined }];
  const cabin = archiveFishForNextRound(prior, 200);
  const fresh = fish(0, 201);
  const recovered = cache.restoreFishSignals({ signals: [...prior, fish(2)], tombstones: {} }, [...cabin, fresh], 'alice', 200);
  expect(recovered).toHaveLength(4);
  expect(recovered.filter(s => s.freshCatch).map(s => s.caughtAt)).toEqual([201]);
  expect(recovered.filter(s => s.fishArchive)).toHaveLength(3);
  expect(recovered.some(s => s.symbol === 'COIN2USDT' && s.fishArchive?.at === 200)).toBe(true);
  await store.loadFishLibraryBackup('alice');
});

it('clearing the fresh flag is not undone by an older durable copy', async () => {
  const store = await import('@/lib/fish/libraryStore');
  await store.saveFishLibraryBackup('alice', { signals: [fish()], tombstones: {} });
  await store.saveFishLibraryBackup('alice', { signals: [{ ...fish(), freshCatch: undefined, quality: 5 }], tombstones: {} });
  expect((await store.loadFishLibraryBackup('alice'))?.signals[0]).toMatchObject({ freshCatch: undefined, quality: 5 });
  await store.saveFishLibraryBackup('alice', { signals: [{ ...fish(), freshCatch: undefined, quality: undefined }], tombstones: {} });
  expect((await store.loadFishLibraryBackup('alice'))?.signals[0]).toMatchObject({ freshCatch: undefined, quality: undefined });
});

it('temporary IndexedDB failure retains pending history and retries independently', async () => {
  const store = await import('@/lib/fish/libraryStore');
  failWrites = true;
  expect(await store.saveFishLibraryBackup('alice', { signals: archiveFishForNextRound([fish()], 200), tombstones: {} })).toBe(false);
  expect((await store.loadFishLibraryBackup('alice'))?.signals).toHaveLength(1);
  failWrites = false;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(disk.has('user:alice')).toBe(true);
  expect((await store.loadFishLibraryBackup('alice'))?.signals[0].fishArchive?.at).toBe(200);
});

it('a newer durable copy wins over stale localStorage after quota failure, including cancelled ratings and fresh flags', async () => {
  const cache = await import('@/lib/fishSignals');
  const store = await import('@/lib/fish/libraryStore');
  cache.saveFishSignals([fish()], 'alice'); await store.loadFishLibraryBackup('alice');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  vi.setSystemTime(Date.now() + 1000);
  cache.saveFishSignals([{ ...fish(), freshCatch: undefined, quality: undefined }], 'alice');
  await store.loadFishLibraryBackup('alice');
  (await import('@/lib/persistedStateStorage')).clearPersistedStateMemoryForTests(); vi.resetModules();
  const reloaded = await import('@/lib/fishSignals');
  const diskStore = await import('@/lib/fish/libraryStore');
  const stale = reloaded.loadFishSignals(); expect(stale[0]).toMatchObject({ freshCatch: true, quality: 4 });
  const restored = reloaded.restoreFishSignals(await diskStore.loadFishLibraryBackup('alice'), stale, 'alice');
  expect(restored[0]).toMatchObject({ freshCatch: undefined, quality: undefined });
  await diskStore.loadFishLibraryBackup('alice');
});

it('a newer localStorage copy wins if the IndexedDB update had failed', async () => {
  const cache = await import('@/lib/fishSignals');
  const store = await import('@/lib/fish/libraryStore');
  cache.saveFishSignals([fish()], 'alice'); await store.loadFishLibraryBackup('alice');
  failWrites = true; vi.setSystemTime(Date.now() + 1000);
  cache.saveFishSignals([{ ...fish(), freshCatch: undefined, quality: undefined }], 'alice');
  await store.loadFishLibraryBackup('alice');
  (await import('@/lib/persistedStateStorage')).clearPersistedStateMemoryForTests(); vi.resetModules();
  const reloaded = await import('@/lib/fishSignals');
  const diskStore = await import('@/lib/fish/libraryStore');
  const restored = reloaded.restoreFishSignals(await diskStore.loadFishLibraryBackup('alice'), reloaded.loadFishSignals(), 'alice');
  expect(restored[0]).toMatchObject({ freshCatch: undefined, quality: undefined });
  failWrites = false; await diskStore.loadFishLibraryBackup('alice');
});

it('a delayed older writer keeps its unique history without reverting the latest rating', async () => {
  const store = await import('@/lib/fish/libraryStore');
  await store.saveFishLibraryBackup('alice', { signals: [{ ...fish(), quality: undefined }], tombstones: {}, updatedAt: 200 });
  await store.saveFishLibraryBackup('alice', { signals: [fish(), fish(1)], tombstones: {}, updatedAt: 100 });
  const restored = (await store.loadFishLibraryBackup('alice'))!;
  expect(restored.signals).toHaveLength(2);
  expect(restored.signals.find(s => s.symbol === fish().symbol)?.quality).toBeUndefined();
  expect(restored.updatedAt).toBe(200);
});
