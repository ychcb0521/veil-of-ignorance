import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyPreEntryLibrary, type PreEntryLibrary } from '../preEntryMonitor';
import { readPreEntrySnapshot, writePreEntrySnapshot } from '../preEntryPersistence';
import { persistPreEntrySnapshot } from '../preEntryPersistenceClient';
import { encodeStoredPreEntry } from '../preEntryBackupEncoding';
import { prepareStoredPreEntry } from '../preEntryBackup';
import { prepareAccountBlobEncoding } from '@/lib/accountBlobCodec';

const disk = new Map<string, unknown>();
let fail = false;
beforeEach(() => {
 disk.clear(); fail=false;
 const db={close:vi.fn(),createObjectStore:vi.fn(),transaction(){
  const tx={oncomplete:undefined as (()=>void)|undefined,onabort:undefined as (()=>void)|undefined,abort(){queueMicrotask(()=>tx.onabort?.());},objectStore:()=>({
   get(key:string){const request:{result?:unknown;onsuccess?:()=>void}={};queueMicrotask(()=>{request.result=structuredClone(disk.get(key));request.onsuccess?.();});return request;},
   put(value:unknown,key:string){queueMicrotask(()=>{if(fail)tx.onabort?.();else{disk.set(key,structuredClone(value));tx.oncomplete?.();}});}
  })};return tx;
 }};
 vi.stubGlobal('indexedDB',{open(){const request:{result?:typeof db;onsuccess?:()=>void}={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture():PreEntryLibrary{return {...emptyPreEntryLibrary(),settings:{updatedAt:1,plans:[],hours:48},rounds:[{id:'r',state:'paused',startedAt:1,updatedAt:1,filters:[],hours:48}],records:[{id:'a',roundId:'r',status:'paused',startTime:1,cursor:2,updatedAt:2,readings:[],sample:{id:'a',source:{id:'a',symbol:'TESTUSDT',timeMs:1,timeLabel:'',fallbackZone:''},groups:[],importedAt:1,enteredAt:1,basis:'signal'},exclusionProcess:{version:1,startedAt:1,entries:[{kind:'observation',from:1,through:2,count:1,reason:'锁定',status:'blocked'}]}}]};}
it('keeps the exact existing database payload readable by old pages and merges deltas with stale writes',async()=>{
 const initial=fixture(),snapshot=structuredClone(initial);await writePreEntrySnapshot('alice',initial);
 const updated={...initial.records[0],status:'matched' as const,cursor:4,matchedAt:4,updatedAt:4,exclusionProcess:{...initial.records[0].exclusionProcess!,entries:[...initial.records[0].exclusionProcess!.entries,{kind:'matched' as const,from:4,through:4,count:1,reason:'首次满足'}]}};
 await writePreEntrySnapshot('alice',{version:1,rounds:[],records:[updated]});
 await writePreEntrySnapshot('alice',snapshot);
 expect(await readPreEntrySnapshot('alice')).toEqual({...initial,records:[updated]});
 expect(disk.get('user:alice')).toEqual({...initial,records:[updated]});
 expect(await readPreEntrySnapshot('bob')).toBeUndefined();expect(initial).toEqual(snapshot);
});
it('does not replace durable history on transaction failure or malformed stored data',async()=>{
 const initial=fixture();await writePreEntrySnapshot('alice',initial);fail=true;
 await expect(writePreEntrySnapshot('alice',{...initial,records:[]})).rejects.toThrow();expect(disk.get('user:alice')).toEqual(initial);
 fail=false;disk.set('user:broken',{version:99});await expect(writePreEntrySnapshot('broken',initial)).rejects.toThrow('格式无效');expect(disk.get('user:broken')).toEqual({version:99});
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
