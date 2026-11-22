// @vitest-environment node
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {expect,it,vi,beforeEach} from 'vitest';
import {browseCatalogKey,filterDetectorCatalogKey,fullBrowseKey,recentBrowseKey,browsePageKey,readBrowseCatalog,readBrowsePage,type BrowseCatalog} from '../libraryBrowse';

const mock=vi.hoisted(()=>({rows:new Map<string,unknown>(),requests:[] as string[][],owner:'a',compatible:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:()=>({abortSignal:mock.compatible}),from:()=>({select:()=>({
  eq:(_:string,owner:string)=>({in:(_:string,keys:string[])=>({abortSignal:async()=>{
    mock.requests.push(keys);return {data:owner===mock.owner?keys.flatMap(key=>mock.rows.has(key)?[mock.rows.get(key)]:[]):[],error:null};
  }})})
})})}}));
const source='idb:fish-quality',signal=new AbortController().signal;
const rows=[['BTCUSDT',1610000000000,'满足','saved-id']];
const text=JSON.stringify(rows),hash=createHash('sha256').update(text).digest('hex');
const catalog:BrowseCatalog={version:1,owner:'a',scope:'filter',revisions:{[source]:'r1'},
  groups:[{id:'r',title:'保存轮次',at:1,count:1,pages:[hash]}]};
function put(key:string,document:unknown){mock.rows.set(key,{key,document});}
beforeEach(()=>{mock.compatible.mockReset();mock.requests=[];mock.rows.clear();mock.rows.set(source,{key:source,revision:'r1'});
  put(browseCatalogKey('filter'),catalog);put(browsePageKey(hash),{gzip:gzipSync(text).toString('base64')});});
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
