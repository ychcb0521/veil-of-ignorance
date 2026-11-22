import {supabase} from '@/integrations/supabase/client';

export type DirectoryScope='mining'|'filter'|'screen'|'monitor';
export type DirectoryRef={id:string;title:string;at:number};
export type DirectoryMark=DirectoryRef&{state:'trash'|'purging'|'purged';token:string};
export type DirectoryMarks=ReadonlyMap<string,DirectoryMark>;
type Operation='trash'|'restore'|'begin'|'retain'|'finish';
type DirectoryChangeResult={state:DirectoryMark['state']|'active';token?:string;bodies?:string[]};
export type DirectoryChange={owner:string;scope:DirectoryScope;item:DirectoryRef;result:DirectoryChangeResult};
type CachedDirectoryMarks={marks:DirectoryMarks;checkedAt:number;changeId?:string};
const caches=new Map<string,CachedDirectoryMarks>();

function cacheKey(owner:string,scope:DirectoryScope){return 'veil:directory-visibility.v1:'+owner+':'+scope;}

export function cachedDirectoryMarks(owner:string,scope:DirectoryScope):CachedDirectoryMarks|undefined{
  const key=cacheKey(owner,scope);
  const memory=caches.get(key);
  if(memory)return memory;
  try {
    const raw=localStorage.getItem(key);
    if(raw){
      const {rows,checkedAt,changeId}=JSON.parse(raw) as {rows:DirectoryMark[];checkedAt:number;changeId?:string};
      return {marks:new Map(rows.filter(row=>typeof row.id==='string'&&typeof row.token==='string'
        && ['trash','purging','purged'].includes(row.state)).map(row=>[row.id,row])),checkedAt,changeId};
    }
  } catch { /* Fall back to the in-memory snapshot if browser storage is unavailable. */ }
  return undefined;
}

export function cacheDirectoryMarks(owner:string,scope:DirectoryScope,marks:DirectoryMarks,checkedAt:number,changeId?:string){
  const key=cacheKey(owner,scope);
  const snapshot={marks,checkedAt,changeId};
  try {
    localStorage.setItem(key,JSON.stringify({rows:[...marks.values()],checkedAt,changeId}));
    caches.delete(key);
  } catch { caches.set(key,snapshot); }
  return snapshot;
}

export function applyDirectoryChange(marks:DirectoryMarks,{item,result}:DirectoryChange):DirectoryMarks{
  const next=new Map(marks);
  if(result.state==='active')next.delete(item.id);
  else if(result.token)next.set(item.id,{...item,state:result.state,token:result.token});
  return next;
}

export function publishDirectoryChange(change:DirectoryChange){
  const {owner,scope}=change;
  const cached=cachedDirectoryMarks(owner,scope);
  cacheDirectoryMarks(owner,scope,applyDirectoryChange(cached?.marks??new Map(),change),cached?.checkedAt??0,crypto.randomUUID());
  window.dispatchEvent(new CustomEvent(directoryTrashEvent,{detail:change}));
  if(typeof BroadcastChannel!=='undefined'){
    const channel=new BroadcastChannel(directoryTrashEvent);channel.postMessage(change);channel.close();
  }
}
export const directoryTrashEvent='veil:fish-directory-trash';
export const directoryAccount=(owner?:string)=>!!owner&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(owner);

export async function readDirectoryMarks(owner:string,scope:DirectoryScope,signal:AbortSignal):Promise<DirectoryMarks>{
  const session=(await supabase.auth.getSession()).data.session;
  if(session?.user.id!==owner)throw Error('账号已切换，请重新打开目录');
  const marks=new Map<string,DirectoryMark>();
  let after='';
  for(;;){
    const {data,error}=await supabase.from('fish_directory_trash' as never).select('directory_id,title,directory_at,state,token')
      .eq('user_id',owner).eq('scope',scope).gt('directory_id',after).order('directory_id').limit(500).abortSignal(signal);
    if(error)throw Error('目录删除状态读取失败');
    const rows=(data??[]) as {directory_id:string;title:string;directory_at:number;state:DirectoryMark['state'];token:string}[];
    for(const row of rows)marks.set(row.directory_id,{id:row.directory_id,title:row.title,at:row.directory_at,state:row.state,token:row.token});
    if(rows.length<500)break;
    after=rows[rows.length-1].directory_id;
  }
  return marks;
}

export async function retiredDirectoryIds(owner:string,scope:DirectoryScope,signal:AbortSignal){
  if(!directoryAccount(owner))return new Set<string>();
  const marks=await readDirectoryMarks(owner,scope,signal);
  return new Set([...marks.values()].filter(m=>m.state==='purged').map(m=>m.id));
}

export async function changeDirectory(owner:string,scope:DirectoryScope,item:DirectoryRef,action:Operation,token?:string){
  const {data,error}=await supabase.rpc('change_fish_directory' as never,{p_owner:owner,p_scope:scope,p_id:item.id,
    p_title:item.title,p_at:item.at,p_action:action,p_token:token??null} as never);
  if(error)throw Error(error.message||'目录修改未保存');
  const result=data as DirectoryChangeResult;
  publishDirectoryChange({owner,scope,item,result});
  if(action==='finish'&&result.bodies?.length){
    const bodies=result.bodies;
    void import('./qualityArchiveStore').then(({purgeLocalQualityArchives})=>purgeLocalQualityArchives(owner,bodies))
      .catch(error=>console.warn('目录已删除，本机归档缓存清理失败',error));
  }
  return result;
}
