import {supabase} from '@/integrations/supabase/client';

export type BrowseScope = 'mining' | 'filter' | 'screen';
const guards: Record<BrowseScope, string[]> = {
  filter: ['idb:fish-quality'],
  mining: ['idb:fish-mining-library', 'idb:fish-mining-deletions-v1', 'idb:fish-quality'],
  screen: ['idb:pre-entry-monitor-v5', 'idb:pre-entry-table-clears-v1', 'idb:fish-quality'],
};
export type BrowseRow = [symbol: string, signalTime: number, detail: string, recordId: string, detectors?:import('./filterDetectorReadings').FilterDetectorReading[]];
export interface BrowseGroup { id: string; title: string; at: number; count: number; pages: string[]; }
export interface BrowseCatalog {
  detectorPreview?:boolean; recent?: boolean; version: 1; owner: string; scope: BrowseScope; revisions: Record<string,string>; groups: BrowseGroup[];
}
const prefix = 'idb:fish-library-browse-v1/';
export const browseCatalogKey = (scope: BrowseScope) => prefix + scope;
export const recentBrowseKey=(scope:BrowseScope,revisions:Record<string,string>)=>prefix+'recent/'+scope+'/'+guards[scope].map(key=>encodeURIComponent(revisions[key])).join('/');
export const fullBrowseKey=(scope:BrowseScope,revisions:Record<string,string>)=>recentBrowseKey(scope,revisions).replace('/recent/','/full/');
export const filterDetectorCatalogKey=(revisions:Record<string,string>)=>fullBrowseKey('filter',revisions)+'/detectors-v1';
export const browsePageKey = (hash: string) => prefix + 'page/' + hash;
type Entry = {key: string; revision: string | null; removed: string | null; document: unknown};
class BrowseReadError extends Error {
  readonly transient:boolean;
  constructor(status:number,code?:string) {
    const detail=status?`HTTP ${status}`:code&&/^[A-Z0-9_]{1,20}$/.test(code)?code:'网络连接失败';
    super(`目录读取失败（${detail}），请重试`);
    this.transient=status===0||status===429||status>=500;
  }
}
function validGroup(group: BrowseGroup) {
  return group && typeof group.id === 'string' && typeof group.title === 'string' && Number.isFinite(group.at) &&
    Number.isSafeInteger(group.count) && group.count >= 0 && Array.isArray(group.pages) &&
    group.pages.every(hash => /^[a-f0-9]{64}$/.test(hash));
}
async function read(owner: string, scope: BrowseScope, key: string, signal: AbortSignal, extra:string[] = []) {
  // Project only the revision from archive heads. Each directory/page and all its
  // revision guards are read by one account-scoped PostgREST statement.
  const columns:string='key,revision:value->>rev,removed:value->>deleted,document:value->browse';
  const query = supabase.from('user_sim_state').select(columns)
    .eq('user_id',owner).in('key',[key,...extra,...guards[scope]]);
  const {data,error,status} = await query.abortSignal(signal);
  if(error) throw new BrowseReadError(status??0,error.code);
  const rows = new Map(((data ?? []) as unknown as Entry[]).map(row => [row.key,row]));
  return {rows, doc:rows.get(key)?.document};
}
function current(scope: BrowseScope, revisions: Record<string,string>, rows: Map<string,Entry>) {
  return guards[scope].every(key => typeof revisions?.[key] === 'string' &&
    revisions[key] === (rows.get(key)?.revision??'') && rows.get(key)?.removed !== 'true');
}
function revisionsOf(scope:BrowseScope,rows:Map<string,Entry>){
  if(!rows.get(guards[scope][0])?.revision||guards[scope].some(key=>rows.get(key)?.removed==='true'))return undefined;
  return Object.fromEntries(guards[scope].map(key=>[key,rows.get(key)?.revision??'']));
}
export async function readBrowseRevisions(owner:string,scope:BrowseScope,signal:AbortSignal){
  return revisionsOf(scope,(await read(owner,scope,browseCatalogKey(scope),signal)).rows);
}
export async function readBrowseCatalog(owner:string,scope:BrowseScope,signal:AbortSignal) {
  const result=await read(owner,scope,browseCatalogKey(scope),signal);
  const validate=(doc:unknown,rows:Map<string,Entry>)=>{
    const catalog=doc as BrowseCatalog|undefined;
    if(catalog?.owner===owner&&catalog.scope===scope&&catalog.version===1&&current(scope,catalog.revisions,rows)&&
      Array.isArray(catalog.groups)&&catalog.groups.every(validGroup))return catalog;
  };
  const catalog=validate(result.doc,result.rows);
  const revisions=revisionsOf(scope,result.rows);
  if(!revisions||catalog&&!catalog.recent&&(scope!=='filter'||catalog.detectorPreview))return catalog;
  const fullKey=fullBrowseKey(scope,revisions),recentKey=recentBrowseKey(scope,revisions);
  const detectorKey=scope==='filter'?filterDetectorCatalogKey(revisions):undefined;
  let next:Awaited<ReturnType<typeof read>>;
  const optional=catalog&&!catalog.recent?new AbortController():undefined;
  const timer=optional?setTimeout(()=>optional.abort(),3000):undefined;
  try {
    next=await read(owner,scope,fullKey,optional?AbortSignal.any([signal,optional.signal]):signal,detectorKey?[recentKey,detectorKey]:[recentKey]);
  } catch(cause) {
    // The optional rich preview must not make an already verified complete
    // directory unavailable. Page reads still recheck every revision guard.
    if(catalog&&!catalog.recent&&!signal.aborted&&cause instanceof BrowseReadError&&cause.transient)return catalog;
    throw cause;
  } finally {
    clearTimeout(timer);
  }
  const enhanced=detectorKey&&validate(next.rows.get(detectorKey)?.document,next.rows);
  if(enhanced?.detectorPreview)return enhanced;
  if(catalog&&!catalog.recent)return validate(catalog,next.rows);
  const saved=validate(next.doc,next.rows)??validate(next.rows.get(recentKey)?.document,next.rows)??validate(catalog,next.rows);
  if(saved||scope==='filter')return saved;
  const {data,error}=await supabase.rpc('read_fish_catalog_after_purge' as never,{p_owner:owner,p_scope:scope} as never).abortSignal(signal);
  if(error)throw Error('归档目录版本核验失败，请重试');
  return validate(data,next.rows);
}
export async function readBrowsePage(catalog: BrowseCatalog, hash: string, signal: AbortSignal): Promise<BrowseRow[]> {
  if(!catalog.groups.some(group=>group.pages.includes(hash)))throw Error('该页不在当前目录内');
  const {rows,doc} = await read(catalog.owner,catalog.scope,browsePageKey(hash),signal);
  if(!current(catalog.scope,catalog.revisions,rows))throw Error('目录已更新，请重新读取');
  const packed=(doc as {gzip?:unknown}|null)?.gzip;
  if(typeof packed!=='string'||packed.length>1_000_000)throw Error('记录页不完整，请重试');
  const compressed=Uint8Array.from(atob(packed),c=>c.charCodeAt(0));
  const raw=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(digest!==hash)throw Error('记录页校验失败，请重试');
  const records:unknown=JSON.parse(new TextDecoder().decode(raw));
  if(!Array.isArray(records) || records.length>500 || !records.every(row=>Array.isArray(row)&&(row.length===4||row.length===5&&Array.isArray(row[4])&&row[4].every((r:Record<string,unknown>)=>
      r&&typeof r.metric==='string'&&['reading','rawReading','percentile','sampleCount'].every(k=>r[k]===undefined||Number.isFinite(r[k]))))&&
    typeof row[0]==='string'&&Number.isFinite(row[1])&&typeof row[2]==='string'&&typeof row[3]==='string'))throw Error('记录页不完整，请重试');
  return records as BrowseRow[];
}
