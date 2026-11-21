// @vitest-environment node
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {expect,it,vi,beforeEach} from 'vitest';
import {browseCatalogKey,browsePageKey,readBrowseCatalog,readBrowsePage,type BrowseCatalog} from '../libraryBrowse';

const mock=vi.hoisted(()=>({rows:new Map<string,unknown>(),requests:[] as string[][],owner:'a'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({select:()=>({
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
beforeEach(()=>{mock.requests=[];mock.rows.clear();mock.rows.set(source,{key:source,revision:'r1'});
  put(browseCatalogKey('filter'),catalog);put(browsePageKey(hash),{gzip:gzipSync(text).toString('base64')});});
it('opens the catalog with one owner-scoped request and reads just the selected page',async()=>{
  const actual=await readBrowseCatalog('a','filter',signal);expect(actual).toEqual(catalog);
  expect(mock.requests).toEqual([[browseCatalogKey('filter'),source]]);
  expect(await readBrowsePage(actual!,hash,signal)).toEqual(rows);
  expect(mock.requests[1]).toEqual([browsePageKey(hash),source]);
});
it('never serves another account or a page from a superseded source',async()=>{
  expect(await readBrowseCatalog('b','filter',signal)).toBeUndefined();
  mock.rows.set(source,{key:source,revision:'r2'});
  expect(await readBrowseCatalog('a','filter',signal)).toBeUndefined();
  await expect(readBrowsePage(catalog,hash,signal)).rejects.toThrow('目录已更新');
});
it('rejects an absent page, an unlisted hash and a substituted page',async()=>{
  await expect(readBrowsePage(catalog,'unlisted',signal)).rejects.toThrow('不在');
  mock.rows.delete(browsePageKey(hash));await expect(readBrowsePage(catalog,hash,signal)).rejects.toThrow('不完整');
  put(browsePageKey(hash),{gzip:gzipSync('[]').toString('base64')});
  await expect(readBrowsePage(catalog,hash,signal)).rejects.toThrow('校验失败');
});
