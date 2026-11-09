import { emptyPreEntryLibrary, mergePreEntryLibraries, type PreEntryLibrary } from './preEntryMonitor';

// The database, key, schema and merge rules are unchanged, including for old tabs.
const DATABASE = 'veil-pre-entry-monitor-v6', STORE = 'libraries';
const keyOf = (owner?: string) => owner ? `user:${owner}` : 'anonymous';
export function validPreEntryLibrary(value: unknown): value is PreEntryLibrary {
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
export async function readPreEntrySnapshot(owner?: string): Promise<PreEntryLibrary | undefined> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(keyOf(owner));
    request.onsuccess = () => { if (request.result == null) resolve(undefined); else if (validPreEntryLibrary(request.result)) resolve(request.result); else reject(Error('入选库存档格式无效')); };
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
/** Run the full-library read/merge/write in a worker, not in Chrome's UI thread. */
export async function writePreEntrySnapshot(owner: string | undefined, delta: PreEntryLibrary): Promise<void> {
  const db = await open();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), request = store.get(keyOf(owner));
    let failure: unknown;
    request.onsuccess = () => {
      try {
        if (request.result != null && !validPreEntryLibrary(request.result)) throw Error('入选库存档格式无效');
        store.put(mergePreEntryLibraries(request.result ?? emptyPreEntryLibrary(), delta), keyOf(owner));
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? Error('入选库保存失败'));
  }); } finally { db.close(); }
}
