import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArchiveRestore,ArrowLeft,Trash2} from 'lucide-react';
import {createPortal} from 'react-dom';
import {applyDirectoryChange,cachedDirectoryMarks,cacheDirectoryMarks,changeDirectory,directoryTrashEvent,readDirectoryMarks,type DirectoryChange,type DirectoryScope,type DirectoryRef,type DirectoryMark,type DirectoryMarks} from '@/lib/fish/directoryTrash';
import {formatUTC8} from '@/lib/timeFormat';

export type DirectoryCleanup={ready:boolean;load?:()=>void;issue?:string;remove:(owner:string,id:string)=>Promise<boolean>};
const empty:DirectoryMarks=new Map();
const refreshAfterMs=60_000;
export function useFishDirectoryTrash(owner:string|undefined,scope:DirectoryScope,open:boolean){
  const cached=useMemo(()=>open&&owner?cachedDirectoryMarks(owner,scope):undefined,[owner,scope,open]);
  const [snapshot,setSnapshot]=useState<{owner:string;scope:DirectoryScope;marks:DirectoryMarks;issue?:string;checkedAt:number}>();
  const [attempt,setAttempt]=useState(0);
  const lastAttempt=useRef(0);
  const reload=useCallback(()=>setAttempt(n=>n+1),[]);
  useEffect(()=>{
    if(!open||!owner){setSnapshot(undefined);return;}
    let current=true;
    let request:AbortController|undefined;
    const sync=async(force=false)=>{
      const previous=cachedDirectoryMarks(owner,scope);
      if(request||!force&&previous&&Date.now()-previous.checkedAt<refreshAfterMs)return;
      const controller=new AbortController();
      request=controller;
      const timer=window.setTimeout(()=>controller.abort(),15000);
      controller.signal.addEventListener('abort',()=>window.clearTimeout(timer),{once:true});
      try{
        const marks=await readDirectoryMarks(owner,scope,controller.signal);
        if(!current||controller.signal.aborted)return;
        const latest=cachedDirectoryMarks(owner,scope);
        if(latest?.changeId!==previous?.changeId){
          if(latest)setSnapshot({owner,scope,...latest});
          return;
        }
        const next=cacheDirectoryMarks(owner,scope,marks,Date.now(),latest?.changeId);
        setSnapshot({owner,scope,...next});
        if(scope==='screen'){
          const retired=[...marks.values()].filter(mark=>mark.state==='purged'&&previous?.marks.get(mark.id)?.state!=='purged').map(mark=>mark.id);
          if(retired.length)void import('@/lib/fish/preEntryPersistence').then(m=>m.retireScreenDirectory(owner,retired)).catch(()=>{});
        }
      }catch{
        if(current&&request===controller){
          const last=cachedDirectoryMarks(owner,scope);
          setSnapshot({owner,scope,marks:last?.marks??empty,checkedAt:last?.checkedAt??0,issue:'删除状态暂时无法同步'});
        }
      }finally{window.clearTimeout(timer);if(request===controller)request=undefined;}
    };
    const update=(change:DirectoryChange|undefined)=>{
      if(change?.owner!==owner||change.scope!==scope)return;
      // An earlier read must never paint over a later committed change.
      request?.abort();request=undefined;
      const last=cachedDirectoryMarks(owner,scope);
      if(!change.item||!change.result){void sync(true);return;} // Older browser tabs send only the scope.
      const next=applyDirectoryChange(last?.marks??empty,change);
      setSnapshot({owner,scope,marks:next,checkedAt:last?.checkedAt??0});
      if(!last?.checkedAt)void sync(true);
    };
    const local=(event:Event)=>update((event as CustomEvent<DirectoryChange>).detail);
    const onFocus=()=>void sync();
    window.addEventListener(directoryTrashEvent,local);window.addEventListener('focus',onFocus);
    const channel=typeof BroadcastChannel==='undefined'?undefined:new BroadcastChannel(directoryTrashEvent);
    if(channel)channel.onmessage=event=>update(event.data);
    const force=attempt!==lastAttempt.current;
    lastAttempt.current=attempt;
    void sync(force);
    return ()=>{current=false;request?.abort();channel?.close();window.removeEventListener(directoryTrashEvent,local);window.removeEventListener('focus',onFocus);};
  },[owner,scope,open,attempt]);
  const current=snapshot?.owner===owner&&snapshot?.scope===scope?snapshot:undefined;
  return {marks:current?.marks??cached?.marks??empty,known:!!(current?.checkedAt||cached?.checkedAt),issue:current?.issue,reload};
}
export function DirectoryDeleteButton({item,onChoose}:{item:DirectoryRef;onChoose:(item:DirectoryRef)=>void}){
  return <button type="button" onClick={()=>onChoose(item)} aria-label={'删除目录 '+item.title} title="删除目录" className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground/55 transition-colors hover:bg-muted hover:text-destructive focus-visible:text-destructive"><Trash2 aria-hidden className="size-3.5"/></button>;
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

export function DirectoryTrashPanel({owner,scope,marks,cleanup,selection,clear,onTrashView,trashView,reload,known,toolbar}:{
  owner:string;scope:DirectoryScope;marks:DirectoryMarks;cleanup?:DirectoryCleanup;selection?:DirectoryRef;clear:()=>void;
  onTrashView:(value:boolean)=>void;trashView:boolean;reload:()=>void;known:boolean;toolbar:HTMLElement|null;
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
    }catch(cause){if(alive.current){setError(cause instanceof Error?cause.message:'操作未完成，请重试');reload();}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  };
  const button='rounded border px-2 py-1 hover:bg-muted disabled:opacity-50';
  const label=trashView?'返回目录':known||deleted.length?`已删除目录（${deleted.length}）`:'已删除目录';
  return <>
    {toolbar&&createPortal(<button type="button" title={label} aria-label={label} disabled={busy}
      className={'inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground disabled:opacity-50 '+(trashView?'bg-muted text-foreground':'text-muted-foreground/60')}
      onClick={()=>{clear();setError('');setTarget(undefined);onTrashView(!trashView);}}>
      {trashView?<ArrowLeft aria-hidden className="size-4"/>:<ArchiveRestore aria-hidden className="size-4"/>}
    </button>,toolbar)}
    {(trashView||selection||error)&&<div className="space-y-2 text-xs">
    {trashView&&<h3 className="text-sm font-medium">已删除目录</h3>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {!trashView&&selection&&<div role="alert" className="flex flex-wrap items-center gap-2 rounded border p-2">
      <span>将「{selection.title}」移入已删除目录？之后可以恢复。</span>
      <button type="button" className={button} disabled={busy} onClick={()=>void run(selection,'trash')}>确认删除目录</button>
      <button type="button" className={button} disabled={busy} onClick={clear}>取消</button>
    </div>}
    {trashView&&!deleted.length&&<p>{known?'没有已删除的目录。':'尚未取得已删除目录。'}</p>}
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
  </div>}
  </>;
}
