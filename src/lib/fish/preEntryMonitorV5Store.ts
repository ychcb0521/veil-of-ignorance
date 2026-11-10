import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { emptyPreEntryLibrary, mergePreEntryLibraries, type PreEntryLibrary } from './preEntryMonitor';

// Isolate entry exclusions from v1/v2/v3/v4 pages; only the new library is written.
const DATABASE = 'veil-pre-entry-monitor-v5', STORE = 'libraries';
const queues = new Map<string, Promise<unknown>>();
const keyOf = (owner?: string) => owner ? `user:${owner}` : 'anonymous';
function valid(value: unknown): value is PreEntryLibrary {
  const data = value as PreEntryLibrary;
  return data?.version === 1 && Array.isArray(data.rounds) && Array.isArray(data.records);
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(Error('入选库存储不可用')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(Error('入选库存储超时')); }, 8000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { expired = true; clearTimeout(timer); reject(Error('入选库存储不可用')); };
  });
}
async function read(owner?: string): Promise<PreEntryLibrary | undefined> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(keyOf(owner));
    request.onsuccess = () => { if (request.result == null) resolve(undefined); else if (valid(request.result)) resolve(request.result); else reject(Error('入选库存档格式无效')); };
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
function write(owner: string | undefined, library: PreEntryLibrary): Promise<void> {
  const key = keyOf(owner), copy = structuredClone(library);
  const task = async () => {
    const db = await open();
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), request = store.get(key);
      request.onsuccess = () => {
        if (request.result != null && !valid(request.result)) { tx.abort(); return; }
        store.put(mergePreEntryLibraries(request.result ?? emptyPreEntryLibrary(), copy), key);
      };
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? Error('入选库保存失败'));
    }); } finally { db.close(); }
  };
  const pending = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, pending.catch(() => undefined));
  return pending;
}
export const preEntryV5AccountBlob: AccountBlobAdapter<PreEntryLibrary> = {
  name: 'pre-entry-monitor-v5',
  async read(owner) { await queues.get(keyOf(owner)); return read(owner); },
  async write(owner, value) { if (value) { if (!valid(value)) throw Error('入选库云端存档格式无效'); await write(owner, value); } },
  async mergeRemote(owner, value) { if (value) await preEntryV5AccountBlob.write(owner, value); },
  weight: library => library ? library.records.length + library.rounds.length + (library.settings ? 1 : 0) : 0,
};
export async function loadPreEntryLibraryV5(owner?: string): Promise<PreEntryLibrary> {
  const status = await syncAccountBlobOnLoad(preEntryV5AccountBlob, owner,30_000);
  await queues.get(keyOf(owner));
  const local = await read(owner);
  if (!local && (status === 'failed' || status === 'timed_out')) throw Error('无法读取账号入选库，请重试');
  return local ?? emptyPreEntryLibrary();
}
export async function savePreEntryLibraryV5(owner: string | undefined, library: PreEntryLibrary): Promise<void> {
  await write(owner, library);
  void noteAccountBlobSaved(preEntryV5AccountBlob, owner);
}
