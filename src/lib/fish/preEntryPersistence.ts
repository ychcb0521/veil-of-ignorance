import { emptyPreEntryLibrary, mergePreEntryLibraries, type PreEntryLibrary } from './preEntryMonitor';
import { mergePreEntryTableClears, validPreEntryTableClears, withPreEntryTableClears, type PreEntryTableClears } from './preEntryTableClears';

// Same database/version/store. Keep the legacy key intact, add independent
// record checkpoints and display marks, and reconstruct the original wire shape.
const DATABASE = 'veil-pre-entry-monitor-v6', STORE = 'libraries';
const keyOf = (owner?: string) => owner ? `user:${owner}` : 'anonymous';
const clearKey = (owner?: string) => `table-clears:${keyOf(owner)}`;
const metaKey = (owner?: string) => `incremental:${keyOf(owner)}:meta`;
const rowPrefix = (owner?: string) => `incremental:${keyOf(owner)}:record:`;
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
  const marks = await readPreEntryTableClears(owner);
  const db = await open();
  try { return await new Promise<PreEntryLibrary | undefined>((resolve,reject)=>{
    // Metadata and rows must come from the same atomic checkpoint revision.
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE);
    let library:PreEntryLibrary|undefined,rows=new Map<string,PreEntryLibrary['records'][number]>(),failure:unknown;
    const stop=(error:unknown)=>{failure=error;tx.abort();};
    const base=store.get(keyOf(owner));
    base.onsuccess=()=>{if(base.result!=null&&!validPreEntryLibrary(base.result)){stop(Error('入选库存档格式无效'));return;}library=base.result;};
    const meta=store.get(metaKey(owner));
    meta.onsuccess=()=>{
      if(meta.result!=null&&!validPreEntryLibrary(meta.result)){stop(Error('筛选增量目录格式无效'));return;}
      if(meta.result)library=mergePreEntryLibraries(library??emptyPreEntryLibrary(),meta.result);
      rows=new Map(library?.records.map(record=>[record.id,record]));
      if(library)library={...library,records:[]};
    };
    const prefix=rowPrefix(owner),request=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    request.onsuccess=()=>{
      const cursor=request.result;if(!cursor)return;
      const record=cursor.value;
      if(!record||typeof record.id!=='string'||!Number.isFinite(record.updatedAt)){stop(Error('筛选增量记录格式无效'));return;}
      const previous=rows.get(record.id);
      rows.set(record.id,previous?mergePreEntryLibraries({version:1,rounds:[],records:[previous]},{version:1,rounds:[],records:[record]}).records[0]:record);
      cursor.continue();
    };
    tx.oncomplete=()=>resolve(!library&&!rows.size&&!Object.keys(marks).length?undefined:withPreEntryTableClears({...library??emptyPreEntryLibrary(),records:[...rows.values()]},marks));
    tx.onerror=tx.onabort=()=>reject(failure??tx.error??Error('入选库读取失败'));
  }); } finally { db.close(); }
}

/** Separate key in the existing store: erasing reads/writes kilobytes, never the library. */
export async function readPreEntryTableClears(owner?: string): Promise<PreEntryTableClears> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(clearKey(owner));
    request.onsuccess = () => request.result == null ? resolve({}) : validPreEntryTableClears(request.result) ? resolve(request.result) : reject(Error('筛选清除标记格式无效'));
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function writePreEntryTableClears(owner: string | undefined, marks: PreEntryTableClears): Promise<void> {
  if (!validPreEntryTableClears(marks)) throw Error('筛选清除标记格式无效');
  const db = await open();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), request = store.get(clearKey(owner));
    let failure: unknown;
    request.onsuccess = () => {
      try {
        if (request.result != null && !validPreEntryTableClears(request.result)) throw Error('筛选清除标记格式无效');
        store.put(mergePreEntryTableClears(request.result, marks), clearKey(owner));
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? Error('筛选清除标记保存失败'));
  }); } finally { db.close(); }
}
/** Atomic record-level checkpoints. The original monolithic library is left
 * untouched for already-open legacy pages; every new reader/export merges it
 * with these durable rows. A stale legacy save cannot erase the new histories. */
export async function writePreEntrySnapshot(owner: string | undefined, delta: PreEntryLibrary): Promise<void> {
  if (!validPreEntryLibrary(delta)) throw Error('入选库存档格式无效');
  const db = await open();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
    let failure: unknown;
    const update = (key: string, incoming: PreEntryLibrary, row = false) => {
      const request = store.get(key);
      request.onsuccess = () => { try {
        const previous = row && request.result ? {version:1 as const,rounds:[],records:[request.result]} : request.result;
        if (previous != null && !validPreEntryLibrary(previous)) throw Error('入选库存档格式无效');
        const merged = mergePreEntryLibraries(previous ?? emptyPreEntryLibrary(), incoming);
        store.put(row ? merged.records[0] : merged, key);
      } catch (error) { failure=error; tx.abort(); } };
    };
    update(metaKey(owner), {...delta, records:[]});
    for (const record of delta.records) update(rowPrefix(owner)+record.id, {version:1,rounds:[],records:[record]}, true);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? Error('入选库保存失败'));
  }); } finally { db.close(); }
}
