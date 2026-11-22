// @vitest-environment node
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {expect,it,vi,beforeEach,afterEach} from 'vitest';
import {browseCatalogKey,miningSeriesCatalogKey,filterDetectorCatalogKey,fullBrowseKey,recentBrowseKey,browsePageKey,readBrowseCatalog,readBrowsePage,type BrowseCatalog} from '../libraryBrowse';

const mock=vi.hoisted(()=>({rows:new Map<string,unknown>(),requests:[] as string[][],owner:'a',compatible:vi.fn(),failure:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:()=>({abortSignal:mock.compatible}),from:()=>({select:()=>({
  eq:(_:string,owner:string)=>({in:(_:string,keys:string[])=>({abortSignal:async(signal:AbortSignal)=>{
    mock.requests.push(keys);const failure=mock.failure(keys,signal);if(failure)return failure;
    return {data:owner===mock.owner?keys.flatMap(key=>mock.rows.has(key)?[mock.rows.get(key)]:[]):[],error:null};
  }})})
})})}}));
const source='idb:fish-quality',signal=new AbortController().signal;
const rows=[['BTCUSDT',1610000000000,'满足','saved-id']];
const text=JSON.stringify(rows),hash=createHash('sha256').update(text).digest('hex');
const catalog:BrowseCatalog={version:1,owner:'a',scope:'filter',revisions:{[source]:'r1'},
  groups:[{id:'r',title:'保存轮次',at:1,count:1,pages:[hash]}]};
function put(key:string,document:unknown){mock.rows.set(key,{key,document});}
beforeEach(()=>{mock.compatible.mockReset();mock.failure.mockReset();mock.requests=[];mock.rows.clear();mock.rows.set(source,{key:source,revision:'r1'});
  put(browseCatalogKey('filter'),catalog);put(browsePageKey(hash),{gzip:gzipSync(text).toString('base64')});});
afterEach(()=>vi.useRealTimers());
it('opens only owner-scoped catalog metadata and reads just the selected page',async()=>{
  const actual=await readBrowseCatalog('a','filter',signal);expect(actual).toEqual(catalog);
  expect(mock.requests).toEqual([ [browseCatalogKey('filter'),source], [fullBrowseKey('filter',catalog.revisions),recentBrowseKey('filter',catalog.revisions),filterDetectorCatalogKey(catalog.revisions),source] ]);
  expect(await readBrowsePage(actual!,hash,signal)).toEqual(rows);
  expect(mock.requests[2]).toEqual([browsePageKey(hash),source]);
});
it('never serves another account or a page from a superseded source',async()=>{
  expect(await readBrowseCatalog('b','filter',signal)).toBeUndefined();
  mock.rows.set(source,{key:source,revision:'r2'});
  expect(await readBrowseCatalog('a','filter',signal)).toBeUndefined();
  await expect(readBrowsePage(catalog,hash,signal)).rejects.toThrow('目录已更新');
});
it('accepts a compatible directory only for the verified account, ledger and current research revision',async()=>{
  const pre='idb:pre-entry-monitor-v5',clear='idb:pre-entry-table-clears-v1';
  mock.rows.set(pre,{key:pre,revision:'v5'});mock.rows.set(source,{key:source,revision:'q2'});
  const projected:BrowseCatalog={...catalog,scope:'screen',revisions:{[pre]:'v5',[clear]:'',[source]:'q2'}};
  mock.compatible.mockResolvedValue({data:projected,error:null});
  expect(await readBrowseCatalog('a','screen',signal)).toEqual(projected);
  for(const stale of [{...projected,owner:'other'},{...projected,revisions:{...projected.revisions,[source]:'q1'}}]){
    mock.compatible.mockResolvedValue({data:stale,error:null});expect(await readBrowseCatalog('a','screen',signal)).toBeUndefined();
  }
});
it('rejects an absent page, an unlisted hash and a substituted page',async()=>{
  await expect(readBrowsePage(catalog,'unlisted',signal)).rejects.toThrow('不在');
  mock.rows.delete(browsePageKey(hash));await expect(readBrowsePage(catalog,hash,signal)).rejects.toThrow('不完整');
  put(browsePageKey(hash),{gzip:gzipSync('[]').toString('base64')});
  await expect(readBrowsePage(catalog,hash,signal)).rejects.toThrow('校验失败');
});

it('reads verified rich pages while the original filter catalog still points to its compatible pages',async()=>{
  const richRows=[['BTCUSDT',1610000000000,'满足','saved-id',[{metric:'avg_BSS_2',reading:0,percentile:91.125}]]];
  const raw=JSON.stringify(richRows),richHash=createHash('sha256').update(raw).digest('hex');
  put(browsePageKey(richHash),{gzip:gzipSync(raw).toString('base64')});
  put(filterDetectorCatalogKey(catalog.revisions),{...catalog,detectorPreview:true,groups:[{...catalog.groups[0],pages:[richHash]}]});
  const enhanced=await readBrowseCatalog('a','filter',signal);
  expect(await readBrowsePage(enhanced!,richHash,signal)).toEqual(richRows);
  expect(await readBrowsePage(catalog,hash,signal)).toEqual(rows);
});

it('keeps the verified complete directory when the optional detector index has a transport failure',async()=>{
  mock.failure.mockImplementation(keys=>keys.includes(filterDetectorCatalogKey(catalog.revisions))?{data:null,error:{message:'Failed to fetch'},status:0}:undefined);
  expect(await readBrowseCatalog('a','filter',signal)).toEqual(catalog);
  expect(await readBrowsePage(catalog,hash,signal)).toEqual(rows);
});

it('stops waiting for an optional preview before the overall directory deadline',async()=>{
  vi.useFakeTimers();
  mock.failure.mockImplementation((keys,signal:AbortSignal)=>keys.includes(filterDetectorCatalogKey(catalog.revisions))
    ?new Promise(resolve=>signal.addEventListener('abort',()=>resolve({data:null,error:{message:'aborted'},status:0}),{once:true})):undefined);
  const result=readBrowseCatalog('a','filter',signal);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await result).toEqual(catalog);expect(vi.getTimerCount()).toBe(0);
});

it.each([401,403])('does not hide an authorization failure from the optional index (%s)',async status=>{
  mock.failure.mockImplementation(keys=>keys.includes(filterDetectorCatalogKey(catalog.revisions))?{data:null,error:{message:'denied'},status}:undefined);
  await expect(readBrowseCatalog('a','filter',signal)).rejects.toThrow(String(status));
});

it('never falls back to a directory whose guards failed verification, or after cancellation',async()=>{
  mock.rows.set(source,{key:source,revision:'r2'});
  mock.failure.mockImplementation(keys=>keys[0]!==browseCatalogKey('filter')?{data:null,error:{message:'Failed to fetch'},status:0}:undefined);
  await expect(readBrowseCatalog('a','filter',signal)).rejects.toThrow();
  mock.rows.set(source,{key:source,revision:'r1'});
  const controller=new AbortController();
  mock.failure.mockImplementation(keys=>{if(keys[0]!==browseCatalogKey('filter')){controller.abort();return {data:null,error:{message:'aborted'},status:0};}});
  await expect(readBrowseCatalog('a','filter',controller.signal)).rejects.toThrow();
});

it('rejects a directory when a successful optional read observes a newer source revision',async()=>{
  mock.failure.mockImplementation(keys=>keys.includes(filterDetectorCatalogKey(catalog.revisions))
    ?{data:[{key:source,revision:'r2'}],error:null,status:200}:undefined);
  expect(await readBrowseCatalog('a','filter',signal)).toBeUndefined();
});

it('reads mining subtype metadata in one guarded query and authorizes only its selected immutable pages',async()=>{
 const revisions={'idb:fish-mining-library':'m1','idb:fish-mining-deletions-v1':'d1',[source]:'r1'};
 for(const [key,revision] of Object.entries(revisions))mock.rows.set(key,{key,revision});
 const child={id:'family/series/avg-2',title:'avg-2',at:1,count:1,pages:[hash]};
 const mining:BrowseCatalog={...catalog,scope:'mining',miningSeries:true,revisions,groups:[{id:'family',title:'BSS 系列',at:1,count:1,pages:[],children:[child]}]};
 put(browseCatalogKey('mining'),{...mining,miningSeries:undefined,groups:[]});put(miningSeriesCatalogKey(),mining);
 const actual=await readBrowseCatalog('a','mining',signal);
 expect(actual).toEqual(mining);expect(mock.requests).toHaveLength(1);
 expect(mock.requests[0]).toContain(miningSeriesCatalogKey());
 expect(await readBrowsePage(actual!,hash,signal)).toEqual(rows);
 mock.rows.set('idb:fish-mining-deletions-v1',{key:'idb:fish-mining-deletions-v1',revision:'d2'});
 await expect(readBrowsePage(actual!,hash,signal)).rejects.toThrow('目录已更新');
});
