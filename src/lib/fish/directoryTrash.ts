import {supabase} from '@/integrations/supabase/client';

export type DirectoryScope='mining'|'filter'|'screen'|'monitor';
export type DirectoryRef={id:string;title:string;at:number};
export type DirectoryMark=DirectoryRef&{state:'trash'|'purging'|'purged';token:string};
export type DirectoryMarks=ReadonlyMap<string,DirectoryMark>;
type Operation='trash'|'restore'|'begin'|'retain'|'finish';
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
  const result=data as {state:DirectoryMark['state']|'active';token?:string;bodies?:string[]};
  window.dispatchEvent(new CustomEvent(directoryTrashEvent,{detail:{owner,scope}}));
  if(typeof BroadcastChannel!=='undefined'){
    const channel=new BroadcastChannel(directoryTrashEvent);channel.postMessage({owner,scope});channel.close();
  }
  if(action==='finish'&&result.bodies?.length){
    const {purgeLocalQualityArchives}=await import('./qualityArchiveStore');
    await purgeLocalQualityArchives(owner,result.bodies);
  }
  return result;
}
