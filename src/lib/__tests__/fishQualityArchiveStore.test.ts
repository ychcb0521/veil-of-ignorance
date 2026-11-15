import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { monitorArchiveFixture, ARCHIVE_T } from '@/lib/fish/__tests__/monitorArchive.fixture';
import { archiveQualityMonitorStudy } from '@/lib/fish/qualityMonitorLibrary';
import type { FishQualityStudy } from '@/lib/fish/quality';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn(), auth: { getSession: async () => ({ data: { session: null } }) } } }));

/** 内存版 IndexedDB：所有库共用一个 Map（键里带账号与归档 id，不会相撞）。 */
const disk = new Map<string, unknown>();
const reads: string[]=[];
let failPut: (key: string) => boolean = () => false;
beforeEach(() => {
  disk.clear(); reads.length=0; localStorage.clear(); failPut = () => false;
  const db = { close() {}, createObjectStore() {}, transaction() {
    const tx: any = {};
    tx.objectStore = () => ({
      get(k: string) { reads.push(k); const req: any = {}; queueMicrotask(() => { req.result = structuredClone(disk.get(k)); req.onsuccess?.(); }); return req; },
      put(v: unknown, k: string) { queueMicrotask(() => { if (failPut(k)) tx.onabort?.(); else { disk.set(k, structuredClone(v)); tx.oncomplete?.(); } }); },
    });
    return tx;
  } };
  vi.stubGlobal('indexedDB', { open() { const req: any = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

/** 两份完整归档的总表（旧版本就是这样整条存的）。 */
function legacyStudy(): FishQualityStudy {
  const once = archiveQualityMonitorStudy(monitorArchiveFixture(), ARCHIVE_T + 4_000_000);
  return archiveQualityMonitorStudy({ ...once, results: once.results.map(r => ({ ...r, returnPct: 3 })) }, ARCHIVE_T + 5_000_000);
}
const archiveKeys = () => [...disk.keys()].filter(k => k.includes('\u0000monitor-archive-'));
const inline = (value: unknown) => ((value as FishQualityStudy).monitorLibrary?.archives ?? []).filter(a => a.study).length;

it('moves archive bodies out of a legacy study before the campaign worker reads it, once per device', async () => {
  const legacy = legacyStudy(), bodies = legacy.monitorLibrary!.archives!.map(a => a.study);
  disk.set('fish-quality:legacy', legacy);
  const store = await import('@/lib/fish/qualityStore');
  await store.prepareQualityCampaignRead('legacy');
  const slim = disk.get('fish-quality:legacy') as FishQualityStudy;
  expect(inline(slim)).toBe(0);
  expect(slim.monitorLibrary!.archives!.map(a => a.id)).toEqual(legacy.monitorLibrary!.archives!.map(a => a.id));
  expect(slim.results).toEqual(legacy.results);
  expect(archiveKeys()).toHaveLength(2);
  expect(localStorage.getItem('veil-fish-quality-archives-detached-v1:legacy')).toBe('1');
  const { loadQualityMonitorArchive } = await import('@/lib/fish/qualityArchiveStore');
  const opened = await Promise.all(slim.monitorLibrary!.archives!.map(a => loadQualityMonitorArchive('legacy', a, slim)));
  expect(opened).toEqual(bodies);
  expect(opened[0].results[0].returnPct).not.toBe(opened[1].results[0].returnPct);
});

it('keeps a body inline when it cannot be written to the archive store, and finishes the move on a later save', async () => {
  const store = await import('@/lib/fish/qualityStore');
  failPut = key => key.includes('\u0000monitor-archive-');
  const legacy = legacyStudy();
  expect(await store.saveQualityStudy('retry', legacy)).toBe(true);
  expect(inline(disk.get('fish-quality:retry'))).toBe(2);
  expect(inline(await store.qualityAccountBlob.read('retry'))).toBe(2);
  await expect(store.qualityAccountBlob.prepareStored!('retry')).rejects.toThrow('暂缓云端备份');
  localStorage.setItem('fish-quality:retry', JSON.stringify(legacy));
  await expect(store.qualityAccountBlob.prepareStored!('retry')).rejects.toThrow('暂缓云端备份');
  expect(localStorage.getItem('veil-fish-quality-archives-detached-v1:retry')).toBeNull();
  failPut = () => false;
  expect(await store.saveQualityStudy('retry', legacy)).toBe(true);
  expect(inline(disk.get('fish-quality:retry'))).toBe(0);
  expect(archiveKeys()).toHaveLength(2);
});

it('never hands archive bodies to the account upload, and detaches bodies arriving from the cloud', async () => {
  const store = await import('@/lib/fish/qualityStore');
  await store.qualityAccountBlob.write('cloud', legacyStudy());
  expect(inline(disk.get('fish-quality:cloud'))).toBe(0);
  expect(archiveKeys()).toHaveLength(2);
  disk.set('fish-quality:stale-tab', legacyStudy());
  const upload = await store.qualityAccountBlob.read('stale-tab');
  expect(inline(upload)).toBe(0);
  expect(upload!.monitorLibrary!.archives).toHaveLength(2);
});

it('keeps only directory entries in memory after a restart is saved', async () => {
  const store = await import('@/lib/fish/qualityStore'), archives = await import('@/lib/fish/qualityArchiveStore');
  const archived = archiveQualityMonitorStudy(monitorArchiveFixture(), ARCHIVE_T + 4_000_000);
  expect(await store.saveQualityStudy('memory', archived)).toBe(true);
  expect(inline(archives.stripStoredQualityArchiveBodies('memory', archived))).toBe(0);
  expect(inline(archives.stripStoredQualityArchiveBodies('someone-else', archived))).toBe(1);
});

it('leaves detached legacy bodies cold at startup and reads only the archive explicitly opened', async () => {
  const store = await import('@/lib/fish/qualityStore');
  const {loadQualityMonitorArchive}=await import('@/lib/fish/qualityArchiveStore');
  const account = await import('@/lib/accountBlobSync');
  vi.spyOn(account,'hasSyncedImmutableAccountBlob').mockResolvedValue(true);
  const legacy=legacyStudy();
  await store.qualityAccountBlob.write('counted',legacy);
  const slim=disk.get('fish-quality:counted') as FishQualityStudy;
  expect(slim.monitorLibrary!.archives!.every(a=>!a.study&&Number.isFinite(a.resultCount))).toBe(true);
  const uncounted={...slim,monitorLibrary:{...slim.monitorLibrary!,archives:slim.monitorLibrary!.archives!.map(({resultCount:_n,...a})=>a)}};
  disk.set('fish-quality:counted',uncounted);
  reads.length=0;
  const {study}=await store.loadQualityStudy('counted');
  const archiveReads=()=>reads.filter(key=>!key.startsWith('purged:')&&key.includes('\u0000monitor-archive-'));
  expect(archiveReads()).toEqual([]);
  const first=study.monitorLibrary!.archives![0],onCount=vi.fn();
  expect(await loadQualityMonitorArchive('counted',first,study,onCount)).toEqual(legacy.monitorLibrary!.archives![0].study);
  expect(archiveReads()).toEqual([expect.stringContaining(first.id)]);
  expect(onCount).toHaveBeenCalledExactlyOnceWith(slim.monitorLibrary!.archives![0].resultCount);
});

it('uses immutable backup receipts to skip already-synced archives, without skipping one still pending', async () => {
  const legacy = legacyStudy(), [acknowledged, pending] = legacy.monitorLibrary!.archives!;
  const account = await import('@/lib/accountBlobSync');
  const receipt = vi.spyOn(account, 'hasSyncedImmutableAccountBlob').mockImplementation(async name => name.endsWith(acknowledged.id));
  const sync = vi.spyOn(account, 'syncAccountBlobFully').mockResolvedValue('pushed');
  const { detachQualityArchiveBodies, syncStoredQualityArchiveBodies } = await import('@/lib/fish/qualityArchiveStore');
  const directory = await detachQualityArchiveBodies('archive-fixture',legacy);
  await syncStoredQualityArchiveBodies('archive-fixture',directory);
  expect(receipt).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({name:`fish-quality-archive/${pending.id}`}), 'archive-fixture');
});
