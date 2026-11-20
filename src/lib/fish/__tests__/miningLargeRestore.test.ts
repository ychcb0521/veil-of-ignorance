import {expect,it} from 'vitest';
import {decodeMiningArchive,containsMiningMerge} from '../miningRestore';
import {emptyMiningLibrary,mergeMiningLibraries} from '../miningLibrary';
import {serializeAccountBlob} from '../../accountBlobCodec';
import {payload} from './libraryTransfer.fixture';
import {readMiningPages,writeMiningPages} from '../miningDiskPages';

it('preserves typed fields and split Unicode as well as unaligned compressed pieces',async()=>{
  const value={...emptyMiningLibrary(),label:'捕捞🐟',typed:new Set([NaN,Infinity])};
  const text=serializeAccountBlob(value);
  const split=text.indexOf('🐟')+1;
  expect(await decodeMiningArchive('json',[text.slice(0,split),text.slice(split)])).toEqual(value);
  const {gzipSync}=await import('node:zlib');
  const encoded=gzipSync(text).toString('base64');
  expect(await decodeMiningArchive('gzip',[encoded.slice(0,11),encoded.slice(11,77),encoded.slice(77)])).toEqual(value);
});

it('skips uploading only when every historical record and deletion is already in the cloud',()=>{
  const lib=payload().mining!;
  expect(containsMiningMerge(lib,mergeMiningLibraries(emptyMiningLibrary(),lib))).toBe(true);
  const edited={...lib,records:lib.records.map(r=>({...r,firstSavedAt:r.firstSavedAt-1}))};
  expect(containsMiningMerge(lib,mergeMiningLibraries(edited,lib))).toBe(false);
  expect(containsMiningMerge(lib,{...lib,deletedRecords:{extra:123}})).toBe(false);
});

it('restores every page, retains a legacy writer and rejects missing pages',async()=>{
  const values=new Map<string,unknown>(),requests:Promise<unknown>[]=[];
  function request(fn:()=>unknown){
    const r:any={};requests.push(Promise.resolve().then(()=>{r.result=fn();r.onsuccess?.();}));return r;
  }
  const store={get:(key:string)=>request(()=>structuredClone(values.get(key))),put:(v:unknown,k:string)=>request(()=>values.set(k,structuredClone(v))),delete:(k:string)=>request(()=>values.delete(k))} as unknown as IDBObjectStore;
  const {records:[row],...base}=payload().mining!,rows=Array.from({length:4097},(_,i)=>({...row,id:String(i)}));
  const library={...base,records:rows};
  const snap=()=>new Promise<any>((resolve,reject)=>readMiningPages(store,'me',resolve,reject));
  writeMiningPages(store,'me',library,undefined,error=>{throw error;});
  for(let i=0;i<requests.length;i++)await requests[i];
  expect(Math.max(...[...values.values()].filter(Array.isArray).map(p=>p.length))).toBeLessThanOrEqual(128);
  values.set('me',{...base,records:[{...row,id:'new-from-old-tab'}]});
  const restored=await snap();expect(new Set(restored.records.map((r:any)=>r.id)).size).toBe(4098);
  values.delete('pages-v1:me:records:1');
  await expect(snap()).rejects.toThrow('分片不完整');
});
