import { emptyPreEntryLibrary, mergePreEntryLibraries, type PreEntryLibrary } from './preEntryMonitor';
import {restorePreEntryRecord,projectPreEntryRecords} from './preEntryArchive';
import { mergePreEntryTableClears, validPreEntryTableClears, withPreEntryTableClears, type PreEntryTableClears } from './preEntryTableClears';

// Same database/version/store. Keep the legacy key intact, add independent
// record checkpoints and display marks, and reconstruct the original wire shape.
const DATABASE = 'veil-pre-entry-monitor-v6', STORE = 'libraries';
const keyOf = (owner?: string) => owner ? `user:${owner}` : 'anonymous';
const clearKey = (owner?: string) => `table-clears:${keyOf(owner)}`;
const metaKey = (owner?: string) => `incremental:${keyOf(owner)}:meta`;
const rowPrefix = (owner?: string) => `incremental:${keyOf(owner)}:record:`;
const viewKey=(owner?:string)=>`read-model:${keyOf(owner)}`;
interface ReadModel {version:1;complete:boolean;library:PreEntryLibrary;generation?:string;meta?:string}
export interface PreEntryCacheRevision {generation?:string;meta:string}
const validReadModel=(value:unknown):value is ReadModel=>{const v=value as ReadModel;return v?.version===1&&typeof v.complete==='boolean'&&validPreEntryLibrary(v.library);};
export function validPreEntryLibrary(value: unknown): value is PreEntryLibrary {
  const data = value as PreEntryLibrary;
  return data?.version === 1 && Array.isArray(data.rounds) && Array.isArray(data.records);
}
/** Complete lightweight index is an additive private cache. Existing canonical
 * keys and old-page writes remain intact; explicit recovery can always rebuild it. */
export async function readPreEntryReadModel(owner?:string):Promise<PreEntryLibrary|undefined>{
  const db=await open();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE),view=store.get(viewKey(owner)),meta=store.get(metaKey(owner));tx.oncomplete=()=>resolve(validReadModel(view.result)&&view.result.complete&&view.result.meta===JSON.stringify(meta.result??null)?view.result.library:undefined);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function readPreEntryCacheRevision(owner?:string):Promise<PreEntryCacheRevision>{
  const db=await open();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE),view=store.get(viewKey(owner)),meta=store.get(metaKey(owner));tx.oncomplete=()=>resolve({generation:validReadModel(view.result)?view.result.generation:undefined,meta:JSON.stringify(meta.result??null)});tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function cachePreEntryReadModel(owner:string|undefined,library:PreEntryLibrary,complete=true,preferIncoming=false,expected?:PreEntryCacheRevision):Promise<PreEntryLibrary>{
  const db=await open();
  let merged=library;
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(viewKey(owner)),metadata=store.get(metaKey(owner));
    metadata.onsuccess=()=>{const old=validReadModel(request.result)?request.result:undefined,previous=old?.library??emptyPreEntryLibrary(),meta=JSON.stringify(metadata.result??null),sameRevision=!expected||expected.generation===old?.generation&&expected.meta===meta;merged=preferIncoming?mergePreEntryLibraries(previous,library):mergePreEntryLibraries(library,previous);store.put({version:1,generation:old?.generation,meta,complete:sameRevision&&(complete||!!old?.complete&&old.meta===meta),library:merged},viewKey(owner));};
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
  return merged;
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
  let completeIndex=false;
  const generation=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let checkpointMeta='null';
  let previousMeta='null';
  const db = await open();
  const staged=delta.records.some(record=>!!record.processRef);
  const stageKey=(index:number)=>`staging:${keyOf(owner)}:${generation}:${index}`;
  try {
    // Imported/resumed directories can reference hundreds of MB of histories.
    // Stage one restored row at a time on disk, keeping the original public
    // records untouched until the following atomic transaction commits them all.
    if(staged)for(let i=0;i<delta.records.length;i++){
      const record=await restorePreEntryRecord(delta.records[i]);
      await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record,stageKey(i));
        tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??Error('筛选恢复暂存失败，原库保留'));
      });
    }
    await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
    let failure: unknown;
    const update = (key: string, incoming: PreEntryLibrary, row = false, next?:()=>void) => {
      const request = store.get(key);
      request.onsuccess = () => { try {
        const previous = row && request.result ? {version:1 as const,rounds:[],records:[request.result]} : request.result;
        if (previous != null && !validPreEntryLibrary(previous)) throw Error('入选库存档格式无效');
        const merged = mergePreEntryLibraries(previous ?? emptyPreEntryLibrary(), incoming);
        if(!row){previousMeta=JSON.stringify(previous??null);checkpointMeta=JSON.stringify(merged);}
        const saved=store.put(row ? merged.records[0] : merged, key);
        if(next)saved.onsuccess=next;
      } catch (error) { failure=error; tx.abort(); } };
    };
    update(metaKey(owner), {...delta, records:[]});
    const updateRow=(index:number)=>{
      if(index>=delta.records.length)return;
      const save=(record:PreEntryLibrary['records'][number])=>update(rowPrefix(owner)+record.id,{version:1,rounds:[],records:[record]},true,()=>updateRow(index+1));
      if(!staged){save(delta.records[index]);return;}
      const request=store.get(stageKey(index));
      request.onsuccess=()=>{try{const record=request.result;if(!record||record.id!==delta.records[index].id||record.processRef)throw Error('筛选恢复暂存不完整，原库保留');save(record);}catch(error){failure=error;tx.abort();}};
    };
    updateRow(0);
    const cached=store.get(viewKey(owner));
    cached.onsuccess=()=>{try{const previous=validReadModel(cached.result)?cached.result:undefined;completeIndex=!!previous?.complete&&previous.meta===previousMeta;store.put({version:1,generation,complete:false,library:previous?.library??emptyPreEntryLibrary()},viewKey(owner));}catch(error){failure=error;tx.abort();}};
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? Error('入选库保存失败'));
  }); } finally {
    if(staged){try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);for(let i=0;i<delta.records.length;i++)store.delete(stageKey(i));tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});}catch{/* Only this attempt's private staging keys; canonical history is untouched. */}}
    db.close();
  }
  // Canonical data is durable FIRST. A cache/quota failure cannot undo a saved
  // result; the incomplete flag makes the next read rebuild from the original.
  try{
    // An active/paused row is just as large as a completed one. This private
    // directory is never an engine input; restore its acknowledged body on use.
    const projected=await projectPreEntryRecords(delta.records,owner),views=new Map(projected.map(record=>[record.id,record]));
    await cachePreEntryReadModel(owner,{...delta,records:delta.records.map(record=>views.get(record.id)??record)},completeIndex,true,{generation,meta:checkpointMeta});
  }catch{/* The canonical checkpoint remains saved and the read index incomplete. */}
}
