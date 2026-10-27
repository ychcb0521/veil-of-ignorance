/**
 * 挖掘库的本机存储（IndexedDB，按账号一份）+ 账号云端存档（accountBlobSync，键 idb:fish-mining-library）。
 * 写入按账号串行：读 → 合并 → 写在同一个事务里，另一个标签页的写入不会被覆盖。
 */
import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { emptyMiningLibrary, mergeMiningLibraries, normalizeMiningLibrary, type FishMiningLibrary } from './miningLibrary';

export const MINING_LIBRARY_EVENT = 'fish-mining-library-saved';
const DATABASE = 'veil-fish-mining-library-v1', STORE = 'libraries';
const keyOf = (owner: string | null | undefined) => owner ? `user:${owner}` : 'anonymous';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('挖掘库存储超时')); }, 8_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('挖掘库存储不可用')); };
  });
}
async function readRaw(key: string): Promise<FishMiningLibrary | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result == null ? undefined : normalizeMiningLibrary(request.result));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
/** 在一个事务里读出、变换、写回。apply 原样返回同一个对象 = 没有改动，不写。 */
async function transform(key: string, apply: (library: FishMiningLibrary) => FishMiningLibrary): Promise<boolean> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      let changed = false;
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), read = store.get(key);
      read.onsuccess = () => {
        try {
          const before = read.result == null ? emptyMiningLibrary() : normalizeMiningLibrary(read.result), after = apply(before);
          if (after !== before) { store.put(after, key); changed = true; }
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(changed);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, run.catch(() => undefined));
  return run;
}
const announce = (owner: string | null | undefined) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MINING_LIBRARY_EVENT, { detail: { owner: owner ?? null } }));
};

/** 读挖掘库（先与账号云端对一次账）。读不到返回空库。 */
export async function loadMiningLibrary(owner: string | null | undefined): Promise<FishMiningLibrary> {
  if (typeof indexedDB === 'undefined') return emptyMiningLibrary();
  await syncAccountBlobOnLoad(miningLibraryAccountBlob, owner ?? undefined);
  const key = keyOf(owner);
  await queues.get(key);
  try { return await readRaw(key) ?? emptyMiningLibrary(); } catch { return emptyMiningLibrary(); }
}
/** 改挖掘库：排队、在事务里合并写入；成功后通知界面并安排上传。失败不抛（挖掘本身不受影响）。 */
export function updateMiningLibrary(owner: string | null | undefined, apply: (library: FishMiningLibrary) => FishMiningLibrary): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(false);
  const key = keyOf(owner);
  return enqueue(key, async () => {
    try {
      if (await transform(key, apply)) { announce(owner); noteAccountBlobSaved(miningLibraryAccountBlob, owner ?? undefined); }
      return true;
    } catch { return false; }
  });
}

export const miningLibraryAccountBlob: AccountBlobAdapter<FishMiningLibrary> = {
  name: 'fish-mining-library',
  async read(owner) { const key = keyOf(owner); await queues.get(key); try { return await readRaw(key); } catch { return undefined; } },
  write(owner, library) {
    const key = keyOf(owner);
    // 取回云端那份时与本机合并（本机可能有还没上传的档）；只增不减
    return enqueue(key, async () => { await transform(key, local => library ? mergeMiningLibraries(local, normalizeMiningLibrary(library)) : local); announce(owner); });
  },
  weight: library => library ? library.records.length + library.anchors.length : 0,
};
