/**
 * 捕捞库的本机存储（IndexedDB，按账号一份）+ 账号云端存档（accountBlobSync，键 idb:fish-mining-library）。
 * 写入按账号串行：读 → 合并 → 写在同一个事务里，另一个标签页的写入不会被覆盖。
 */
import { noteAccountBlobSaved, syncAccountBlobOnLoad, syncAccountBlobFully, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import {pruneMiningDeletions,mergeSourceDeletions} from './libraryDeletion';
import { emptyMiningLibrary, mergeMiningLibraries, normalizeMiningLibrary, restoreMiningImport, type FishMiningLibrary } from './miningLibrary';

export const MINING_LIBRARY_EVENT = 'fish-mining-library-saved';
const DATABASE = 'veil-fish-mining-library-v1', STORE = 'libraries';
const keyOf = (owner: string | null | undefined) => owner ? `user:${owner}` : 'anonymous';
const deletionKeyOf = (key: string) => `deleted:${key}`;
type MiningDeletions = Pick<FishMiningLibrary, 'deletedRecords' | 'clearedAt'>;

function mergeDeletions(a?: MiningDeletions, b?: MiningDeletions): MiningDeletions {
  return {
    deletedRecords: mergeSourceDeletions(a?.deletedRecords, b?.deletedRecords),
    clearedAt: Math.max(a?.clearedAt ?? 0, b?.clearedAt ?? 0) || undefined,
  };
}

function hasDeletions(value?: MiningDeletions) {
  return !!(value?.clearedAt || Object.keys(value?.deletedRecords ?? {}).length);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('捕捞库存储超时')); }, 8_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('捕捞库存储不可用')); };
  });
}
async function readRaw(key: string): Promise<FishMiningLibrary | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE), store = tx.objectStore(STORE);
      const request = store.get(key), marks = store.get(deletionKeyOf(key));
      marks.onsuccess = () => {
        if (request.result == null && !marks.result) { resolve(undefined); return; }
        const library = normalizeMiningLibrary(request.result);
        resolve(pruneMiningDeletions({ ...library, ...mergeDeletions(library, marks.result) }));
      };
      request.onerror = marks.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
/** 在一个事务里读出、变换、写回。apply 原样返回同一个对象 = 没有改动，不写。 */
async function transform(key: string, apply: (library: FishMiningLibrary) => FishMiningLibrary): Promise<{ changed: boolean; marked: boolean }> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      let changed = false, marked = false;
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), read = store.get(key);
      const marks = store.get(deletionKeyOf(key));
      marks.onsuccess = () => {
        try {
          const original = normalizeMiningLibrary(read.result);
          const before = pruneMiningDeletions({ ...original, ...mergeDeletions(original, marks.result) }), applied = apply(before);
          const deletions = mergeDeletions(before, applied);
          const after = applied === before ? before : pruneMiningDeletions({ ...applied, ...deletions });
          if (after !== before) { store.put(after, key); changed = true; }
          if (hasDeletions(deletions) && JSON.stringify(mergeDeletions(marks.result)) !== JSON.stringify(deletions)) {
            store.put(deletions, deletionKeyOf(key));
            marked = true;
          }
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve({ changed, marked });
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

/** Old pages write the original library key. New pages keep deletion marks independently of those writes. */
const miningDeletionsAccountBlob: AccountBlobAdapter<MiningDeletions> = {
  name: 'fish-mining-deletions-v1',
  async read(owner) {
    const key = keyOf(owner);
    await queues.get(key);
    const library = await readRaw(key);
    return hasDeletions(library) ? mergeDeletions(library) : undefined;
  },
  async write(owner, value) {
    if (!hasDeletions(value)) return;
    const key = keyOf(owner);
    await enqueue(key, () => transform(key, library => ({ ...library, ...mergeDeletions(library, value) })));
    announce(owner);
  },
  mergeRemote(owner, value) { return miningDeletionsAccountBlob.write(owner, value); },
  weight: value => Object.keys(value?.deletedRecords ?? {}).length + Number(!!value?.clearedAt),
};

async function reconcileMiningLibrary(owner?: string, fresh = false) {
  await Promise.all([
    syncAccountBlobOnLoad(miningDeletionsAccountBlob, owner, undefined, fresh),
    syncAccountBlobOnLoad(miningLibraryAccountBlob, owner, undefined, fresh),
  ]);
}

/** 读捕捞库（先与账号云端对一次账）。读不到返回空库。 */
export async function loadMiningLibrary(owner: string | null | undefined): Promise<FishMiningLibrary> {
  if (typeof indexedDB === 'undefined') return emptyMiningLibrary();
  await reconcileMiningLibrary(owner ?? undefined);
  const key = keyOf(owner);
  await queues.get(key);
  try { return await readRaw(key) ?? emptyMiningLibrary(); } catch { return emptyMiningLibrary(); }
}
/** Full downloads must report storage failure instead of quietly exporting an empty library. */
export async function loadMiningLibraryForTransfer(owner?:string):Promise<FishMiningLibrary>{
 await reconcileMiningLibrary(owner, true);await queues.get(keyOf(owner));return await readRaw(keyOf(owner))??emptyMiningLibrary();
}
/** 改捕捞库：排队、在事务里合并写入；成功后通知界面并安排上传。失败不抛（挖掘本身不受影响）。 */
export function updateMiningLibrary(owner: string | null | undefined, apply: (library: FishMiningLibrary) => FishMiningLibrary): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(false);
  const key = keyOf(owner);
  return enqueue(key, async () => {
    try {
      const { changed, marked } = await transform(key, apply);
      if (changed) { announce(owner); void noteAccountBlobSaved(miningLibraryAccountBlob, owner ?? undefined); }
      if (marked) void noteAccountBlobSaved(miningDeletionsAccountBlob, owner ?? undefined);
      return true;
    } catch { return false; }
  });
}

export const miningLibraryAccountBlob: AccountBlobAdapter<FishMiningLibrary> = {
  name: 'fish-mining-library',
  async mergeRemote(owner,value){await miningLibraryAccountBlob.write(owner,value);},
  async read(owner) { const key = keyOf(owner); await queues.get(key); try { return await readRaw(key); } catch { return undefined; } },
  write(owner, library) {
    const key = keyOf(owner);
    // 取回云端那份时与本机合并（本机可能有还没上传的档）；只增不减
    return enqueue(key, async () => {
      const { marked } = await transform(key, local => library ? mergeMiningLibraries(local, normalizeMiningLibrary(library)) : local);
      if (marked) void noteAccountBlobSaved(miningDeletionsAccountBlob, owner);
      announce(owner);
    });
  },
  weight: library => library ? Object.keys(library.deletedRecords??{}).length + library.records.length + library.anchors.length + Number(!!library.clearedAt) : 0,
};

export async function syncMiningLibraryChange(owner?: string, deleted = false): Promise<boolean> {
  if (!owner) return true;
  const adapters = deleted ? [miningDeletionsAccountBlob, miningLibraryAccountBlob] : [miningLibraryAccountBlob];
  const states = await Promise.all(adapters.map(async adapter => {
    await noteAccountBlobSaved(adapter, owner);
    return syncAccountBlobFully(adapter, owner, 12_000, true);
  }));
  return states.every(status => status === 'pushed' || status === 'unchanged');
}

export async function importMiningLibraries(owner: string | undefined, incoming: readonly FishMiningLibrary[]) {
  await reconcileMiningLibrary(owner, true);
  if (!await updateMiningLibrary(owner, library => incoming.reduce((current, next) => restoreMiningImport(current, next), library))) {
    throw Error('捕捞库未能保存导入记录，请重试');
  }
  return syncMiningLibraryChange(owner);
}
