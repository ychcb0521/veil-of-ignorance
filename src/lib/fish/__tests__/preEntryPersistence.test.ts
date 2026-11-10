import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyPreEntryLibrary, type PreEntryLibrary } from '../preEntryMonitor';
import { readPreEntrySnapshot, writePreEntrySnapshot, readPreEntryTableClears, writePreEntryTableClears } from '../preEntryPersistence';
import { withPreEntryTableClears } from '../preEntryTableClears';
import { qualityScreeningResults } from '../qualityScreeningResults';
import { persistPreEntrySnapshot } from '../preEntryPersistenceClient';
import { encodeStoredPreEntry } from '../preEntryBackupEncoding';
import { prepareStoredPreEntry } from '../preEntryBackup';
import { prepareAccountBlobEncoding } from '@/lib/accountBlobCodec';

const disk = new Map<string, unknown>();
const reads: string[] = [], puts: string[] = [];
let fail = false;
beforeEach(() => {
 disk.clear(); reads.length=0; puts.length=0; fail=false;
 vi.stubGlobal('IDBKeyRange',{bound:(lower:string,upper:string)=>({lower,upper})});
 const db={close:vi.fn(),createObjectStore:vi.fn(),transaction(){
  const staged=new Map<string,unknown>();let timer:ReturnType<typeof setTimeout>,aborted=false;
  const complete=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(aborted)return;if(fail&&staged.size){tx.onabort?.();return;}for(const [k,v]of staged)disk.set(k,v);tx.oncomplete?.();},0);};
  const tx={oncomplete:undefined as (()=>void)|undefined,onabort:undefined as (()=>void)|undefined,abort(){aborted=true;clearTimeout(timer);queueMicrotask(()=>tx.onabort?.());},objectStore:()=>({
   get(key:string){reads.push(key);const request:{result?:unknown;onsuccess?:()=>void}={};queueMicrotask(()=>{request.result=structuredClone(disk.get(key));request.onsuccess?.();complete();});return request;},
   put(value:unknown,key:string){puts.push(key);staged.set(key,structuredClone(value));complete();},
   openCursor(range:{lower:string;upper:string}){const entries=[...disk].filter(([k])=>k>=range.lower&&k<=range.upper).sort(([a],[b])=>a.localeCompare(b));const request:{result?:unknown;onsuccess?:()=>void}={};let i=0;const step=()=>queueMicrotask(()=>{const item=entries[i++];request.result=item?{value:structuredClone(item[1]),continue:step}:null;request.onsuccess?.();complete();});step();return request;}
  })};return tx;
 }};
 vi.stubGlobal('indexedDB',{open(){const request:{result?:typeof db;onsuccess?:()=>void}={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture():PreEntryLibrary{return {...emptyPreEntryLibrary(),settings:{updatedAt:1,plans:[],hours:48},rounds:[{id:'r',state:'paused',startedAt:1,updatedAt:1,filters:[],hours:48}],records:[{id:'a',roundId:'r',status:'paused',startTime:1,cursor:2,updatedAt:2,readings:[],sample:{id:'a',source:{id:'a',symbol:'TESTUSDT',timeMs:1,timeLabel:'',fallbackZone:''},groups:[],importedAt:1,enteredAt:1,basis:'signal'},exclusionProcess:{version:1,startedAt:1,entries:[{kind:'observation',from:1,through:2,count:1,reason:'锁定',status:'blocked'}]}}]};}
it('checkpoints only changed rows without reading or rewriting the legacy library or unrelated records',async()=>{
 const initial=fixture(),legacy=structuredClone(initial);disk.set('user:alice',legacy);
 await writePreEntrySnapshot('alice',initial);reads.length=0;puts.length=0;
 const updated={...initial.records[0],cursor:4,updatedAt:4};await writePreEntrySnapshot('alice',{version:1,rounds:[],records:[updated]});
 expect(reads).toEqual(['incremental:user:alice:meta','incremental:user:alice:record:a']);expect(puts).toEqual(reads);expect(disk.get('user:alice')).toBe(legacy);expect((await readPreEntrySnapshot('alice'))!.records).toEqual([updated]);
 // An old tab can still update its original payload; the newer durable row wins.
 disk.set('user:alice',initial);expect((await readPreEntrySnapshot('alice'))!.records).toEqual([updated]);
});
it('erases with metadata only, survives stale old-page saves, and keeps all evidence and settings exact',async()=>{
 const initial=fixture();await writePreEntrySnapshot('alice',initial);const original=disk.get('incremental:user:alice:record:a');reads.length=0;puts.length=0;
 await writePreEntryTableClears('alice',{a:10,snapshot:10});
 expect(reads).toEqual(['table-clears:user:alice']);expect(puts).toEqual(['table-clears:user:alice']);expect(disk.get('incremental:user:alice:record:a')).toBe(original);
 let loaded=(await readPreEntrySnapshot('alice'))!;expect(loaded).toEqual(withPreEntryTableClears(initial,{a:10,snapshot:10}));expect(qualityScreeningResults({},loaded)).toEqual([]);expect(qualityScreeningResults({},loaded,true)).toHaveLength(1);
 await writePreEntrySnapshot('alice',initial);await writePreEntryTableClears('alice',{a:3});loaded=(await readPreEntrySnapshot('alice'))!;expect(loaded.records[0].tableClearedAt).toBe(10);expect(loaded.records[0].exclusionProcess).toEqual(initial.records[0].exclusionProcess);expect(loaded.settings).toEqual(initial.settings);
 const renewed={...initial,records:[{...initial.records[0],updatedAt:11,cursor:11}]};await writePreEntrySnapshot('alice',renewed);loaded=(await readPreEntrySnapshot('alice'))!;expect(qualityScreeningResults({},loaded)).toHaveLength(1);
 expect(await readPreEntryTableClears('bob')).toEqual({});expect(initial.records[0].tableClearedAt).toBeUndefined();
});
it('does not clear on failed metadata writes and rejects malformed marks without touching history',async()=>{
 const initial=fixture();await writePreEntrySnapshot('alice',initial);fail=true;
 await expect(writePreEntryTableClears('alice',{a:10})).rejects.toThrow();expect((await readPreEntrySnapshot('alice'))!.records[0].tableClearedAt).toBeUndefined();
 fail=false;await expect(writePreEntryTableClears('alice',{a:NaN})).rejects.toThrow('格式无效');expect(await readPreEntrySnapshot('alice')).toEqual(initial);
});
it('masks frozen table snapshots using persisted marks while retaining them for historical entry-time lookup',()=>{
 const library=fixture(),record={...library.records[0],id:'snapshot'},study={screeningResults:[record],screeningRounds:library.rounds};
 const marked=withPreEntryTableClears(library,{a:10,snapshot:10});expect(qualityScreeningResults(study,marked)).toEqual([]);expect(qualityScreeningResults(study,marked,true)).toHaveLength(2);expect(study.screeningResults[0]).toBe(record);
});
it('keeps the exact existing database payload readable by old pages and merges deltas with stale writes',async()=>{
 const initial=fixture(),snapshot=structuredClone(initial);await writePreEntrySnapshot('alice',initial);
 const updated={...initial.records[0],status:'matched' as const,cursor:4,matchedAt:4,updatedAt:4,exclusionProcess:{...initial.records[0].exclusionProcess!,entries:[...initial.records[0].exclusionProcess!.entries,{kind:'matched' as const,from:4,through:4,count:1,reason:'首次满足'}]}};
 await writePreEntrySnapshot('alice',{version:1,rounds:[],records:[updated]});
 await writePreEntrySnapshot('alice',snapshot);
 expect(await readPreEntrySnapshot('alice')).toEqual({...initial,records:[updated]});
 expect(disk.has('user:alice')).toBe(false);
 expect(await readPreEntrySnapshot('bob')).toBeUndefined();expect(initial).toEqual(snapshot);
});
it('does not replace durable history on transaction failure or malformed stored data',async()=>{
 const initial=fixture();await writePreEntrySnapshot('alice',initial);fail=true;
 await expect(writePreEntrySnapshot('alice',{...initial,records:[]})).rejects.toThrow();expect(await readPreEntrySnapshot('alice')).toEqual(initial);
 fail=false;disk.set('user:broken',{version:99});await expect(readPreEntrySnapshot('broken')).rejects.toThrow('格式无效');expect(disk.get('user:broken')).toEqual({version:99});
});
it('writes in a dedicated worker and returns only an acknowledgement, releasing worker memory',async()=>{
 const stopped=vi.fn(),posted:unknown[]=[],urls:URL[]=[];
 class Writer{onmessage:(event:unknown)=>void;onerror:()=>void;onmessageerror:()=>void;constructor(url:URL){urls.push(url);}terminate(){stopped();}postMessage(body:{owner?:string;delta:PreEntryLibrary}){posted.push(body);queueMicrotask(async()=>{await writePreEntrySnapshot(body.owner,body.delta);this.onmessage({data:{ok:true}});});}}
 vi.stubGlobal('Worker',Writer);const value=fixture();await persistPreEntrySnapshot('alice',value);
 expect(urls[0].pathname).toMatch(/preEntryPersistence.worker.ts$/);expect(posted).toEqual([{owner:'alice',delta:value}]);expect(stopped).toHaveBeenCalledOnce();expect(await readPreEntrySnapshot('alice')).toEqual(value);
});
it('reports worker failures without retrying a large write on the UI thread',async()=>{
 const stopped=vi.fn();class Writer{onerror:()=>void;terminate(){stopped();}postMessage(){queueMicrotask(()=>this.onerror());}}
 vi.stubGlobal('Worker',Writer);await expect(persistPreEntrySnapshot('alice',fixture())).rejects.toThrow('后台保存失败');expect(stopped).toHaveBeenCalledOnce();expect(disk.size).toBe(0);
});
it('encodes the durable library in a worker using only its owner key and the unchanged wire fingerprint',async()=>{
 const value=fixture();await writePreEntrySnapshot('alice',value);
 const expected=await prepareAccountBlobEncoding(await readPreEntrySnapshot('alice')),posted:unknown[]=[],stopped=vi.fn();
 class Encoder{onmessage:(event:unknown)=>void;terminate=stopped;postMessage(body:{owner:string;knownHash?:string}){posted.push(body);queueMicrotask(async()=>this.onmessage({data:{ok:true,result:await encodeStoredPreEntry(body.owner,body.knownHash)}}));}}
 vi.stubGlobal('Worker',Encoder);
 expect(await prepareStoredPreEntry('alice')).toEqual(expected);
 expect(await prepareStoredPreEntry('alice',expected.hash)).toEqual({hash:expected.hash});
 expect(await prepareStoredPreEntry('bob')).toBeUndefined();
 expect(posted).toEqual([{owner:'alice',knownHash:undefined},{owner:'alice',knownHash:expected.hash},{owner:'bob',knownHash:undefined}]);expect(stopped).toHaveBeenCalledTimes(3);expect(await readPreEntrySnapshot('alice')).toEqual(value);
});
