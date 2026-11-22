import {useCallback,useEffect,useRef,useState} from 'react';
import {Trash2} from 'lucide-react';
import {changeDirectory,directoryTrashEvent,readDirectoryMarks,type DirectoryScope,type DirectoryRef,type DirectoryMark,type DirectoryMarks} from '@/lib/fish/directoryTrash';
import {formatUTC8} from '@/lib/timeFormat';

export type DirectoryCleanup={ready:boolean;load?:()=>void;issue?:string;remove:(owner:string,id:string)=>Promise<boolean>};
const empty:DirectoryMarks=new Map();
export function useFishDirectoryTrash(owner:string|undefined,scope:DirectoryScope,open:boolean){
  const [snapshot,setSnapshot]=useState<{owner:string;scope:DirectoryScope;marks:DirectoryMarks;issue?:string}>();
  const [attempt,setAttempt]=useState(0);
  const reload=useCallback(()=>setAttempt(n=>n+1),[]);
  useEffect(()=>{
    if(!open||!owner){setSnapshot(undefined);return;}
    let current=true;
    const controller=new AbortController();
    const timer=window.setTimeout(()=>controller.abort(),15000);
    void readDirectoryMarks(owner,scope,controller.signal).then(marks=>{
      if(current){
        setSnapshot({owner,scope,marks});
        const retired=scope==='screen'?[...marks.values()].filter(m=>m.state==='purged').map(m=>m.id):[];
        if(retired.length)void import('@/lib/fish/preEntryPersistence').then(m=>m.retireScreenDirectory(owner,retired)).catch(()=>{});
      }
    },()=>{if(current)setSnapshot({owner,scope,marks:empty,issue:'目录删除状态暂时无法核对'});}).finally(()=>window.clearTimeout(timer));
    const refresh=(value:{owner?:string;scope?:string}|undefined)=>{if(value?.owner===owner&&value.scope===scope)reload();};
    const local=(event:Event)=>refresh((event as CustomEvent).detail);
    window.addEventListener(directoryTrashEvent,local);window.addEventListener('focus',reload);
    const channel=typeof BroadcastChannel==='undefined'?undefined:new BroadcastChannel(directoryTrashEvent);
    if(channel)channel.onmessage=event=>refresh(event.data);
    return ()=>{current=false;window.clearTimeout(timer);controller.abort();channel?.close();window.removeEventListener(directoryTrashEvent,local);window.removeEventListener('focus',reload);};
  },[owner,scope,open,attempt,reload]);
  const current=snapshot?.owner===owner&&snapshot?.scope===scope?snapshot:undefined;
  return {marks:current?.marks??empty,waiting:!!owner&&(!current||!!current.issue),issue:current?.issue,reload};
}
export function DirectoryDeleteButton({item,onChoose}:{item:DirectoryRef;onChoose:(item:DirectoryRef)=>void}){
  return <button type="button" onClick={()=>onChoose(item)} aria-label={'删除目录 '+item.title} className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 aria-hidden className="h-3.5 w-3.5"/>删除</button>;
}

export async function purgeMarkedDirectory(owner:string,scope:DirectoryScope,item:DirectoryRef,old:Pick<DirectoryMark,'state'|'token'>|undefined,cleanup?:DirectoryCleanup){
  if(!old||old.state==='purged'||(cleanup&&!cleanup.ready))throw Error('请等待目录核验后重试');
  const token=old.state==='purging'?old.token:(await changeDirectory(owner,scope,item,'begin',old.token)).token;
  if(cleanup&&!await cleanup.remove(owner,item.id)){
    await changeDirectory(owner,scope,item,'retain',token);
    return false;
  }
  if(scope==='screen')await (await import('@/lib/fish/preEntryPersistence')).retireScreenDirectory(owner,[item.id]);
  await changeDirectory(owner,scope,item,'finish',token);
  return true;
}

export function DirectoryTrashPanel({owner,scope,marks,cleanup,selection,clear,onTrashView,trashView,reload}:{
  owner:string;scope:DirectoryScope;marks:DirectoryMarks;cleanup?:DirectoryCleanup;selection?:DirectoryRef;clear:()=>void;
  onTrashView:(value:boolean)=>void;trashView:boolean;reload:()=>void;
}){
  const [target,setTarget]=useState<DirectoryRef>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const mark=target?marks.get(target.id):undefined;
  const deleted=[...marks.values()].filter(row=>row.state!=='purged').sort((a,b)=>b.at-a.at);
  const run=async(item:DirectoryRef,action:'trash'|'restore'|'purge')=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{
      const old=marks.get(item.id);
      if(action==='purge'){
        if(!await purgeMarkedDirectory(owner,scope,item,old,cleanup))
          throw Error('该目录受保护或仍在运行，已保留在已删除目录中');
      }else await changeDirectory(owner,scope,item,action,old?.token);
      if(alive.current){setTarget(undefined);clear();}
    }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'操作未完成，请重试');}
    finally{lock.current=false;if(alive.current){setBusy(false);reload();}}
  };
  const button='rounded border px-2 py-1 hover:bg-muted disabled:opacity-50';
  return <div className="space-y-2 text-xs">
    <button type="button" className={button} disabled={busy} onClick={()=>{clear();setError('');setTarget(undefined);onTrashView(!trashView);}}>{trashView?'返回目录':'已删除目录（'+deleted.length+'）'}</button>
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {!trashView&&selection&&<div role="alert" className="flex flex-wrap items-center gap-2 rounded border p-2">
      <span>将「{selection.title}」移入已删除目录？之后可以恢复。</span>
      <button type="button" className={button} disabled={busy} onClick={()=>void run(selection,'trash')}>确认删除目录</button>
      <button type="button" className={button} disabled={busy} onClick={clear}>取消</button>
    </div>}
    {trashView&&!deleted.length&&<p>没有已删除的目录。</p>}
    {trashView&&deleted.map(row=><div key={row.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
      <span className="mr-auto">{row.title}{row.at>0&&' · '+formatUTC8(row.at)}</span>
      {row.state==='trash'&&<button type="button" disabled={busy} className={button} onClick={()=>void run(row,'restore')}>恢复目录</button>}
      <button type="button" disabled={busy} className={button+' text-destructive'} onClick={()=>{setTarget(row);setError('');if(cleanup&&!cleanup.ready)cleanup.load?.();}}>{row.state==='purging'?'继续彻底删除':'彻底删除'}</button>
    </div>)}
    {trashView&&target&&mark&&mark.state!=='purged'&&<div role="alert" className="space-y-2 rounded border p-2">
      <p>彻底删除「{target.title}」及其专属归档内容？此操作无法恢复。其他目录共用的数据、原始信号和交易记录将保留。</p>
      {cleanup&&!cleanup.ready&&<div role="status">{cleanup.issue||'正在核验原始目录…'} {cleanup.load&&<button className="underline" onClick={cleanup.load}>重新核验</button>}</div>}
      <div className="flex gap-2"><button type="button" className={button+' text-destructive'} disabled={busy||!!cleanup&&!cleanup.ready} onClick={()=>void run(target,'purge')}>{busy?'正在处理…':'确认彻底删除'}</button>
      <button type="button" className={button} disabled={busy} onClick={()=>setTarget(undefined)}>取消</button></div>
    </div>}
  </div>;
}
