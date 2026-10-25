import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newQualityStudy } from '@/lib/fish/quality';
const disk = new Map<string, unknown>();
let fail = false;
beforeEach(() => {
  disk.clear(); localStorage.clear(); fail = false;
  const db = { close() {}, createObjectStore() {}, transaction() {
    const tx: any = {};
    tx.objectStore = () => ({ get(k: string) { const req: any = {}; queueMicrotask(() => { req.result = structuredClone(disk.get(k)); req.onsuccess?.(); }); return req; },
      put(v: unknown, k: string) { queueMicrotask(() => { if (fail) tx.onabort?.(); else { disk.set(k, structuredClone(v)); tx.oncomplete?.(); } }); } });
    return tx;
  } };
  vi.stubGlobal('indexedDB', { open() { const req: any = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('persists independently of full localStorage, restores rules/results after reload, and isolates accounts', async () => {
  const store = await import('@/lib/fish/qualityStore');
  const study = newQualityStudy(); study.observeHours = 72; study.tracking = false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(await store.saveQualityStudy('a', study)).toBe(true);
  vi.resetModules(); const reloaded = await import('@/lib/fish/qualityStore');
  expect((await reloaded.loadQualityStudy('a')).study).toEqual(study);
  expect((await reloaded.loadQualityStudy('b')).study.observeHours).toBe(168);
  expect((await reloaded.loadQualityStudy()).study.observeHours).toBe(168);
});
it('serializes rapid account writes, falls back on database failure and reports loss of both storage options', async () => {
  const store = await import('@/lib/fish/qualityStore');
  await Promise.all([1, 2, 3].map(n => store.saveQualityStudy('a', { ...newQualityStudy(), observeHours: n })));
  expect((await store.loadQualityStudy('a')).study.observeHours).toBe(3);
  fail = true;
  expect(await store.saveQualityStudy('a', { ...newQualityStudy(), observeHours: 5 })).toBe(true);
  expect((await store.loadQualityStudy('a')).study.observeHours).toBe(5);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(await store.saveQualityStudy('a', newQualityStudy())).toBe(false);
});
