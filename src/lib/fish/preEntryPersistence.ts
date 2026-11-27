import { DIRECT_ADMISSION_RECORD, emptyPreEntryLibrary, isAutomaticPreEntryRound, mergePreEntryLibraries, preEntryRecordPending, type PreEntryLibrary, type PreEntryRecord, type PreEntryRound } from './preEntryMonitor';
import {screenBrowse} from './screenBrowse';
import type {BrowseGroup,BrowseRow} from './libraryBrowse';
import type {LibraryDirectoryEdits} from './libraryDirectoryEdits';
import { serializeAccountBlobChunks } from '../accountBlobCodec';
import {restorePreEntryRecord,projectPreEntryRecord,projectPreEntryRecords} from './preEntryArchive';
import { mergePreEntryTableClears, validPreEntryTableClears, withPreEntryTableClears, type PreEntryTableClears } from './preEntryTableClears';

// Same database/version/store. Keep the legacy key intact, add independent
// record checkpoints and display marks, and reconstruct the original wire shape.
const DATABASE = 'veil-pre-entry-monitor-v6', STORE = 'libraries';
const keyOf = (owner?: string) => owner ? `user:${owner}` : 'anonymous';
const clearKey = (owner?: string) => `table-clears:${keyOf(owner)}`;
const metaKey = (owner?: string) => `incremental:${keyOf(owner)}:meta`;
const rowPrefix = (owner?: string) => `incremental:${keyOf(owner)}:record:`;
const viewKey=(owner?:string)=>`read-model:${keyOf(owner)}`;
const browseKey=(owner?:string)=>'browse-v1:'+JSON.stringify(owner??null)+':';
export interface LocalScreenCatalog {id:string;groups:BrowseGroup[];edits?:LibraryDirectoryEdits}
interface LocalScreenHeader extends LocalScreenCatalog {meta:string}

function storeScreenIndex(store:IDBObjectStore,owner:string|undefined,library:PreEntryLibrary,meta:string){
  const prefix=browseKey(owner),snapshot=screenBrowse(library,{});
  const retired=store.get('retired:'+prefix);
  retired.onsuccess=()=>{
    const ids=new Set<string>(retired.result??[]);
    store.delete(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    const groups=(snapshot?.groups??[]).filter(group=>!ids.has(group.id));
    const header:LocalScreenHeader={id:crypto.randomUUID(),groups,edits:library.directoryEdits,meta};
    store.put(header,prefix+'header');
    for(const group of groups)for(const key of group.pages)store.put(snapshot!.pages[key],prefix+'page:'+key);
  };
}

/** Keep the raw screening ledger for trading; remove only its browse projection. */
export async function retireScreenDirectory(owner:string,ids:readonly string[]){
  if(!ids.length||typeof indexedDB==='undefined')return;
  const db=await open();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),prefix=browseKey(owner);
    const retired=store.get('retired:'+prefix),header=store.get(prefix+'header');
    header.onsuccess=()=>{
      const marks=new Set<string>(retired.result??[]);
      for(const id of ids)marks.add(id);
      if(marks.size!==(retired.result?.length??0))store.put([...marks],'retired:'+prefix);
      const old=header.result as LocalScreenHeader|undefined;
      if(!old)return;
      const groups=old.groups.filter(group=>!marks.has(group.id));
      if(groups.length===old.groups.length)return;
      const shared=new Set(groups.flatMap(group=>group.pages));
      for(const group of old.groups)if(marks.has(group.id))for(const key of group.pages)if(!shared.has(key))store.delete(prefix+'page:'+key);
      store.put({...old,id:crypto.randomUUID(),groups},prefix+'header');
    };
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??Error('本机目录删除失败'));
  });}finally{db.close();}
}

/** Explicit compatibility action for accounts with a verified pre-index local snapshot. */
export async function indexExistingScreenSnapshot(owner:string):Promise<void>{
  const db=await open();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
    const view=store.get(viewKey(owner)),metadata=store.get(metaKey(owner));
    let indexed=false;
    metadata.onsuccess=()=>{
      const cached=view.result,meta=JSON.stringify(metadata.result??null);
      if(!validReadModel(cached)||!cached.complete||cached.meta!==meta)return;
      storeScreenIndex(store,owner,cached.library,meta); indexed=true;
    };
    tx.oncomplete=()=>indexed?resolve():reject(Error('本机没有可核验的完整 v6 快照'));
    tx.onerror=tx.onabort=()=>reject(tx.error??Error('本机筛选目录建立失败'));
  });}finally{db.close();}
}

async function readScreenBrowsePart(owner:string, page?:{catalogId:string;key:string}):Promise<LocalScreenCatalog|BrowseRow[]|undefined>{
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE),prefix=browseKey(owner);
    const manifest=store.get(prefix+'header'),meta=store.get(metaKey(owner));
    let value:LocalScreenCatalog|BrowseRow[]|undefined;
    meta.onsuccess=()=>{
      const header=manifest.result as LocalScreenHeader|undefined;
      if(!header||header.meta!==JSON.stringify(meta.result??null))return;
      if(!page){value={id:header.id,groups:header.groups,edits:header.edits};return;}
      if(page.catalogId!==header.id||!header.groups.some(group=>group.pages.includes(page.key)))return;
      const body=store.get(prefix+'page:'+page.key),clears=store.get(clearKey(owner));
      clears.onsuccess=()=>{
        if(!Array.isArray(body.result))return;
        const marks=clears.result??{};
        value=(body.result as BrowseRow[]).map(row=>marks[row[3]]&&!row[2].endsWith('组合表已清除')?[row[0],row[1],row[2]+' · 组合表已清除',row[3]]:row);
      };
    };
    tx.oncomplete=()=>resolve(value);
    tx.onerror=tx.onabort=()=>reject(tx.error??Error('本机筛选目录读取失败'));
  });}finally{db.close();}
}
export const readScreenCatalog=(owner:string)=>readScreenBrowsePart(owner) as Promise<LocalScreenCatalog|undefined>;
export async function readScreenPage(owner:string,catalogId:string,key:string){
  const rows=await readScreenBrowsePart(owner,{catalogId,key});
  if(!Array.isArray(rows))throw Error('本机筛选目录已更新，请重新读取');
  return rows;
}
interface ReadModel {version:1;complete:boolean;library:PreEntryLibrary;generation?:string;meta?:string}
export interface PreEntryCacheRevision {generation?:string;meta:string}
const validReadModel=(value:unknown):value is ReadModel=>{const v=value as ReadModel;return v?.version===1&&typeof v.complete==='boolean'&&validPreEntryLibrary(v.library);};
export function validPreEntryLibrary(value: unknown): value is PreEntryLibrary {
  const data = value as PreEntryLibrary;
  return data?.version === 1 && Array.isArray(data.rounds) && Array.isArray(data.records);
}
/** Read open positions' canonical admissions without materializing the history or its display cache. */
export async function readOpenAdmissionCheckpoints(owner: string, recordIds: readonly string[]): Promise<PreEntryLibrary> {
  const result = emptyPreEntryLibrary();
  if (!recordIds.length) return result;
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'), store = tx.objectStore(STORE);
      const meta = store.get(metaKey(owner));
      meta.onsuccess = () => {
        const rounds = new Map((validPreEntryLibrary(meta.result) ? meta.result.rounds : [])
          .filter(round => isAutomaticPreEntryRound(round) && round.state === 'complete').map(round => [round.id, round]));
        for (const id of new Set(recordIds)) {
          const row = store.get(rowPrefix(owner) + id);
          row.onsuccess = () => {
            const record: PreEntryRecord | undefined = row.result;
            const round = record && rounds.get(record.roundId);
            if (!round || record?.id !== id || record.status !== 'matched' || !(record.matchedAt! > 0)) return;
            result.rounds.push(round);
            result.records.push(record);
          };
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('即时持仓记录读取失败'));
    });
    if (result.records.length !== new Set(recordIds).size) throw Error('有持仓的原始入选记录待恢复');
    return result;
  } finally { db.close(); }
}

/** Read just one automatic round and its row when another tab handed off the job. */
export async function readAutomaticPreEntryCheckpoint(owner: string, id: string, requireIntact = false): Promise<PreEntryLibrary | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'), store = tx.objectStore(STORE);
      const meta = store.get(metaKey(owner));
      let value: PreEntryLibrary | undefined;
      meta.onsuccess = () => {
        if (meta.result == null) return;
        if (!validPreEntryLibrary(meta.result)) { if (requireIntact) reject(Error('自动筛选进度目录无效')); return; }
        const round = meta.result.rounds.find(round => round.id === id);
        if (!round) return;
        const planId = round.instantTrading && round.directAdmission ? DIRECT_ADMISSION_RECORD : round.plans?.[0]?.id;
        if (!isAutomaticPreEntryRound(round) || !planId) { if (requireIntact) reject(Error('自动筛选的冻结方案不完整')); return; }
        const row = store.get(rowPrefix(owner) + `${id}:0:${planId}`);
        row.onsuccess = () => {
          const record = row.result as PreEntryRecord | undefined;
          if (record?.roundId === id && record.id === `${id}:0:${planId}`) value = { version: 1, rounds: [round], records: [record] };
          else if (requireIntact) reject(Error('自动筛选的原始进度不完整'));
        };
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('读取自动筛选进度失败'));
    });
  } finally { db.close(); }
}
function compactSaleRecord(record: PreEntryRecord): PreEntryRecord {
  const { exclusionProcess: _process, processRef: _ref, ...display } = record;
  return display;
}

/** Recover sale metadata without retaining the corresponding screening audit bodies. */
export async function readAutomaticPreEntrySales(owner: string, recordIds: readonly string[]): Promise<{record: PreEntryRecord; round: PreEntryLibrary['rounds'][number]}[]> {
  if (!recordIds.length) return [];
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'), store = tx.objectStore(STORE);
      const result: {record: PreEntryRecord; round: PreEntryLibrary['rounds'][number]}[] = [];
      const meta = store.get(metaKey(owner)), view = store.get(viewKey(owner));
      view.onsuccess = () => {
        const incremental = validPreEntryLibrary(meta.result) ? meta.result : undefined;
        const indexed = validReadModel(view.result) && view.result.meta === JSON.stringify(meta.result ?? null) ? view.result.library : undefined;
        const rounds = new Map([...(indexed?.rounds ?? []), ...(incremental?.rounds ?? [])]
          .filter(round => isAutomaticPreEntryRound(round) && round.state === 'complete').map(round => [round.id, round]));
        const ids = new Set(recordIds);
        const indexedRecords = new Map(indexed?.records.filter(record => ids.has(record.id)).map(record => [record.id, record]));
        const pending = ids.values();
        const next = () => {
          const item = pending.next();
          if (item.done) return;
          const id = item.value;
          const row = store.get(rowPrefix(owner) + id);
          row.onsuccess = () => {
            const record = (row.result ?? indexedRecords.get(id)) as PreEntryRecord | undefined;
            const round = record?.id === id ? rounds.get(record.roundId) : undefined;
            if (record && round && record.status === 'matched') result.push({ record: compactSaleRecord(record), round });
            next();
          };
        };
        next();
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('读取筛选鱼卖出记录失败'));
    });
  } finally { db.close(); }
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
    metadata.onsuccess=()=>{
      const old=validReadModel(request.result)?request.result:undefined,meta=JSON.stringify(metadata.result??null);
      if(expected&&(expected.generation!==old?.generation||expected.meta!==meta))return;
      const previous=old?.library??emptyPreEntryLibrary();
      // An authoritative rebuild must not carry forward rows already removed
      // from the canonical checkpoint or reinstate a stale reader's cache.
      merged=complete&&!preferIncoming&&expected?library:preferIncoming?mergePreEntryLibraries(previous,library):mergePreEntryLibraries(library,previous);
      const isComplete=complete||!!old?.complete&&old.meta===meta;
      store.put({version:1,generation:old?.generation,meta,complete:isComplete,library:merged},viewKey(owner));
      if(isComplete)storeScreenIndex(store,owner,merged,meta);
      else store.delete(browseKey(owner)+'header');
    };
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
export async function readPreEntrySnapshot(owner?: string, projected = false): Promise<PreEntryLibrary | undefined> {
  const marks = await readPreEntryTableClears(owner);
  const db = await open();
  try { return await new Promise<PreEntryLibrary | undefined>((resolve,reject)=>{
    // Metadata and rows must come from the same atomic checkpoint revision.
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE);
    let library:PreEntryLibrary|undefined,rows=new Map<string,PreEntryRecord>(),failure:unknown;
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
    // Keep the read snapshot across body writes. Wait for each body before
    // advancing the cursor, so the accumulated rows contain only the directory.
    const compact = (record: PreEntryRecord, next: (value: PreEntryRecord) => void) => {
      if (!projected) { next(record); return; }
      try {
        const projection = projectPreEntryRecord(record, owner);
        if (!projection.saved) { next(projection.record); return; }
        let complete = false, failed = false, error: unknown;
        void projection.saved.then(() => { complete = true; }, cause => { failed = true; error = cause; });
        const keepAlive = () => {
          try {
            if (failed) { stop(error); return; }
            if (complete) { next(projection.record); return; }
            // Count an exact key without materializing any other record.
            const pulse = store.count(metaKey(owner));
            pulse.onsuccess = keepAlive;
          } catch (cause) { stop(cause); }
        };
        keepAlive();
      } catch (error) { stop(error); }
    };
    const prefix=rowPrefix(owner),request=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    request.onsuccess=()=>{
      const cursor=request.result;
      if (!cursor) {
        // Older monolithic records have no cursor entries. Project those too.
        if (projected) {
          const entries = rows.entries();
          const compactLegacy = () => {
            for (let item = entries.next(); !item.done; item = entries.next()) {
              const [id, record] = item.value;
              if (record.processRef || (record.exclusionProcess?.entries.length ?? 0) <= 16) continue;
              compact(record, value => { rows.set(id, value); compactLegacy(); });
              return;
            }
          };
          compactLegacy();
        }
        return;
      }
      const record=cursor.value;
      if(!record||typeof record.id!=='string'||!Number.isFinite(record.updatedAt)){stop(Error('筛选增量记录格式无效'));return;}
      const previous=rows.get(record.id);
      const merged = previous ? mergePreEntryLibraries({version:1,rounds:[],records:[previous]},{version:1,rounds:[],records:[record]}).records[0] : record;
      const id = record.id;
      compact(merged, value => { rows.set(id, value); cursor.continue(); });
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
export async function writePreEntrySnapshot(owner: string | undefined, delta: PreEntryLibrary, immediate = false): Promise<void> {
  if (!validPreEntryLibrary(delta)) throw Error('入选库存档格式无效');
  let completeIndex=false;
  const generation=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let checkpointMeta='null';
  let previousMeta='null';
  let committed=false;
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
    store.delete(browseKey(owner)+'header');
    update(metaKey(owner), {...delta, records:[]});
    const updateRow=(index:number)=>{
      if(index>=delta.records.length)return;
      const save=(record:PreEntryLibrary['records'][number])=>update(rowPrefix(owner)+record.id,{version:1,rounds:[],records:[record]},true,()=>{
        if(staged)store.delete(stageKey(index));
        updateRow(index+1);
      });
      if(!staged){save(delta.records[index]);return;}
      const request=store.get(stageKey(index));
      request.onsuccess=()=>{try{const record=request.result;if(!record||record.id!==delta.records[index].id||record.processRef)throw Error('筛选恢复暂存不完整，原库保留');save(record);}catch(error){failure=error;tx.abort();}};
    };
    updateRow(0);
    if (!immediate) {
      const cached=store.get(viewKey(owner));
      cached.onsuccess=()=>{try{const previous=validReadModel(cached.result)?cached.result:undefined;completeIndex=!!previous?.complete&&previous.meta===previousMeta;store.put({version:1,generation,complete:false,library:previous?.library??emptyPreEntryLibrary()},viewKey(owner));}catch(error){failure=error;tx.abort();}};
    }
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? Error('入选库保存失败'));
  }); committed=true; } finally {
    if(staged&&!committed){try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);for(let i=0;i<delta.records.length;i++)store.delete(stageKey(i));tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});}catch{/* Only this attempt's private staging keys; canonical history is untouched. */}}
    db.close();
  }
  // A live save only acknowledges the canonical row. The metadata comparison
  // invalidates any older read index, which can be rebuilt off this path.
  if (immediate) return;
  // Canonical data is durable FIRST. A cache/quota failure cannot undo a saved
  // result; the incomplete flag makes the next read rebuild from the original.
  try{
    // An active/paused row is just as large as a completed one. This private
    // directory is never an engine input; restore its acknowledged body on use.
    const projected=await projectPreEntryRecords(delta.records,owner),views=new Map(projected.map(record=>[record.id,record]));
    await cachePreEntryReadModel(owner,{...delta,records:delta.records.map(record=>views.get(record.id)??record)},completeIndex,true,{generation,meta:checkpointMeta});
  }catch{/* The canonical checkpoint remains saved and the read index incomplete. */}
}

/** Compare the complete persisted wire without materializing two large strings. */
function sameStoredScreening(left: unknown, right: unknown): boolean {
  const a = serializeAccountBlobChunks(left), b = serializeAccountBlobChunks(right);
  for (;;) {
    const nextA = a.next(), nextB = b.next();
    if (nextA.done || nextB.done) return !!nextA.done && !!nextB.done;
    if (nextA.value !== nextB.value) return false;
  }
}

function samePublishedRound(draft: PreEntryRound | undefined, saved: PreEntryRound | undefined): boolean {
  if (!draft?.workspaceDraft || draft.workspaceSaved || draft.state !== 'complete' ||
      !saved?.workspaceSaved || saved.workspaceDraft || saved.state !== 'complete' ||
      !(saved.updatedAt > draft.updatedAt)) return false;
  const { workspaceDraft, updatedAt: _draftAt, ...draftContents } = draft;
  const { workspaceSaved, updatedAt: _savedAt, ...savedContents } = saved;
  return sameStoredScreening(draftContents, savedContents);
}

/** Remove a completed local draft only when the full durable public copy still
 * matches. Recheck both stores in one transaction to protect other open tabs. */
export async function removePublishedPreEntryDrafts(draftOwner: string, owner: string | undefined, roundIds: readonly string[]): Promise<void> {
  if (!roundIds.length) return;
  const db = await open();
  try {
    // Release the write lock between rounds so live checkpoints can proceed.
    for (const roundId of new Set(roundIds)) {
      // Workspace rounds are generated without a colon; each row is roundId:index:planId.
      if (!roundId || roundId.includes(':')) continue;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
        const draft = store.get(metaKey(draftOwner)), saved = store.get(metaKey(owner));
        const legacy = store.count(keyOf(draftOwner));
        let failure: unknown;
        const stop = (cause: unknown) => { failure = cause; tx.abort(); };
        legacy.onsuccess = () => {
          try {
            // Leave an unexpected legacy draft layout or non-incremental data intact.
            if (legacy.result || !validPreEntryLibrary(draft.result) || draft.result.records.length ||
                !validPreEntryLibrary(saved.result)) return;
            const find = (library: PreEntryLibrary) => library.rounds.find(round => round.id === roundId);
            if (!samePublishedRound(find(draft.result), find(saved.result))) return;
            const draftPrefix = rowPrefix(draftOwner), prefix = draftPrefix + roundId + ':';
            const cursorRequest = store.openKeyCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
            const matched: IDBValidKey[] = [];
            cursorRequest.onsuccess = () => {
              try {
                const cursor = cursorRequest.result;
                if (!cursor) {
                  if (!matched.length) return;
                  store.put({...draft.result,rounds:draft.result.rounds.filter((round: PreEntryRound) => round.id !== roundId)},metaKey(draftOwner));
                  for (const key of matched) store.delete(key);
                  store.delete(viewKey(draftOwner));
                  store.delete(browseKey(draftOwner)+'header');
                  return;
                }
                const key = cursor.primaryKey as string, id = key.slice(draftPrefix.length);
                const draftRow = store.get(key), savedRow = store.get(rowPrefix(owner) + id);
                savedRow.onsuccess = () => {
                  try {
                    const a = draftRow.result as PreEntryRecord | undefined, b = savedRow.result as PreEntryRecord | undefined;
                    if (!a || !b || a.id !== id || b.id !== id || a.roundId !== roundId || b.roundId !== roundId ||
                        a.processRef || b.processRef || preEntryRecordPending(a) || !sameStoredScreening(a,b)) return;
                    matched.push(key);
                    cursor.continue();
                  } catch (cause) { stop(cause); }
                };
              } catch (cause) { stop(cause); }
            };
          } catch (cause) { stop(cause); }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? Error('清理已保存的筛选草稿失败'));
      });
    }
  } finally { db.close(); }
}
