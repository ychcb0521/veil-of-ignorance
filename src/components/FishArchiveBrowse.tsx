import {useEffect,useMemo,useRef,useState} from 'react';
import {formatUTC8} from '@/lib/timeFormat';
import {readBrowseCatalog,readBrowsePage,type BrowseCatalog,type BrowseRow,type BrowseScope} from '@/lib/fish/libraryBrowse';
import {mergeLibraryDirectoryEdits,type LibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
import {readScreenCatalog,readScreenPage,type LocalScreenCatalog} from '@/lib/fish/preEntryPersistence';

import {DirectoryDeleteButton} from './FishDirectoryTrash';
import type {DirectoryMarks,DirectoryRef} from '@/lib/fish/directoryTrash';
type Directory = {local:LocalScreenCatalog} | {cloud:BrowseCatalog};
type Props = {owner:string;scope:BrowseScope;query:string;pendingVisibility?:boolean;edits?:LibraryDirectoryEdits;marks?:DirectoryMarks;onDelete?:(item:DirectoryRef)=>void};

async function readDirectory(owner:string, scope:BrowseScope, signal:AbortSignal, historicalOnly:boolean, edits?:LibraryDirectoryEdits):Promise<Directory|undefined>{
  let emptyLocal:LocalScreenCatalog|undefined;
  if(!historicalOnly&&scope==='screen'&&typeof indexedDB!=='undefined'){
    const local=await readScreenCatalog(owner).catch(()=>undefined);
    if(signal.aborted)return;
    if(local){
      const visibility=mergeLibraryDirectoryEdits(local.edits,edits);
      if(local.groups.some(group=>!visibility[group.id]?.hidden))return {local};
    }
    emptyLocal=local;
  }
  const cloud=await readBrowseCatalog(owner,scope,signal);
  return cloud?{cloud}:emptyLocal?{local:emptyLocal}:undefined;
}

function ArchivePage({owner,directory,pageKey,reload}:{owner:string;directory:Directory;pageKey:string;reload:()=>void}){
  const [rows,setRows]=useState<BrowseRow[]>(),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    const request='cloud' in directory?readBrowsePage(directory.cloud,pageKey,controller.signal):readScreenPage(owner,directory.local.id,pageKey);
    void request.then(value=>{if(active)setRows(value);},cause=>{
      if(active)setError(cause instanceof Error?cause.message:'记录页读取失败');
    }).finally(()=>clearTimeout(timer));
    return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[owner,directory,pageKey]);
  if(error)return <p role="alert">{error} <button type="button" className="underline" onClick={reload}>重新读取目录</button></p>;
  if(!rows)return <p role="status">正在读取本页…</p>;
  return <div className="max-h-72 overflow-auto">
    <table className="w-full text-left"><thead><tr><th>标的</th><th>信号时间（北京时间）</th><th>归档记录</th></tr></thead>
      <tbody>{rows.map((row,i)=><tr key={row[3]+'-'+i} className="border-t"><td className="pr-2 font-mono">{row[0]}</td><td className="pr-2 whitespace-nowrap">{formatUTC8(row[1])}</td><td>{row[2]}</td></tr>)}</tbody></table>
  </div>;
}

function LegacyScreenIndex({owner,onReady}:{owner:string;onReady:()=>void}){
  const worker=useRef<Worker>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>()=>worker.current?.terminate(),[]);
  if(typeof Worker==='undefined'||typeof indexedDB==='undefined')return null;
  const build=()=>{
    if(worker.current)return;
    try{
      const task=new Worker(new URL('../lib/workers/screenBrowse.worker.ts',import.meta.url),{type:'module'});
      worker.current=task;setBusy(true);setMessage('');
      const finish=(issue?:string)=>{
        task.terminate();worker.current=undefined;setBusy(false);
        if(issue)setMessage(issue);else onReady();
      };
      task.onmessage=event=>finish(event.data?.ok?undefined:event.data?.message??'本机目录建立失败');
      task.onerror=()=>finish('本机目录建立失败');
      task.postMessage({owner});
    }catch{
      worker.current?.terminate();worker.current=undefined;setBusy(false);setMessage('本机目录建立失败');
    }
  };
  return <div className="text-xs"><button type="button" className="underline" disabled={busy} onClick={build}>{busy?'正在建立本机目录…':'从已有 v6 快照建立本机目录'}</button>{message&&<p role="status">{message}</p>}</div>;
}

function RebuildHistoricalIndex({owner,onReady}:{owner:string;onReady:()=>void}){
  const request=useRef<AbortController>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>()=>request.current?.abort(),[]);
  const rebuild=async()=>{
    if(request.current)return;
    const controller=new AbortController();
    request.current=controller;setBusy(true);setError('');
    try{
      const {rebuildHistoricalScreenCatalog}=await import('@/lib/fish/historicalScreenBrowse');
      await rebuildHistoricalScreenCatalog(owner,controller.signal);
      if(!controller.signal.aborted)onReady();
    }catch(cause){
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'历史目录建立失败');
    }finally{
      request.current=undefined;
      if(!controller.signal.aborted)setBusy(false);
    }
  };
  return <div className="text-xs"><button type="button" className="underline" disabled={busy} onClick={()=>void rebuild()}>{busy?'正在核验 v5 归档并建立目录…':'从账号 v5 归档重建目录'}</button>{error&&<p role="alert">{error}</p>}</div>;
}

export function FishArchiveBrowse({owner,scope,query,edits,marks,onDelete,pendingVisibility}:Props){
  const [historicalOnly,setHistoricalOnly]=useState(false);
  const [directory,setDirectory]=useState<Directory>(),[issue,setIssue]=useState(''),[attempt,setAttempt]=useState(0);
  const [selected,setSelected]=useState(''),[page,setPage]=useState(0);
  const reload=()=>{setDirectory(undefined);setIssue('');setSelected('');setPage(0);setAttempt(n=>n+1);};
  useEffect(()=>{
    let active=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    void readDirectory(owner,scope,controller.signal,historicalOnly,edits).then(result=>{
      if(!active)return;
      if(result)setDirectory(result);
      else setIssue('当前版本尚无独立目录，可载入完整库。');
    },()=>{if(active)setIssue('目录读取失败');}).finally(()=>clearTimeout(timer));
    return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[owner,scope,attempt,historicalOnly,edits]);
  const groups=useMemo(()=>{
    if(!directory)return [];
    const local='local' in directory?directory.local:undefined;
    const changes=mergeLibraryDirectoryEdits(local?.edits,edits);
    return ('cloud' in directory?directory.cloud.groups:directory.local.groups)
      .filter(group=>!marks?.has(group.id)&&(!changes[group.id]?.hidden||scope==='mining'))
      .map(group=>({...group,title:changes[group.id]?.name??group.title}))
      .sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
  },[edits,directory,scope,marks]);
  const legacyIndex=scope==='screen'?<LegacyScreenIndex owner={owner} onReady={reload}/>:null;
  const switchSource=(historical:boolean)=>{setHistoricalOnly(historical);reload();};
  const backToLocal=historicalOnly&&<button type="button" className="underline" onClick={()=>switchSource(false)}>返回本机目录</button>;
  if(pendingVisibility)return null;
  if(issue)return <><p role="alert" className="text-xs">{issue} <button type="button" className="underline" onClick={reload}>重新读取目录</button></p>{backToLocal||legacyIndex}{scope==='screen'&&<RebuildHistoricalIndex owner={owner} onReady={reload}/>}</>;
  if(!directory)return <p role="status" className="text-xs">正在读取目录…</p>;
  const historical='cloud' in directory&&scope==='screen';
  const matching=groups.filter(item=>(item.title+' '+item.id+' '+formatUTC8(item.at)).toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-label="归档记录浏览" className="space-y-2 text-xs">
    <p className="text-muted-foreground">{'local' in directory?'本机 v6 筛选快照':historical?'账号 v5 历史筛选归档':'账号归档'} · {groups.length} 个目录{'cloud' in directory&&directory.cloud.recent?' · 近期索引，每项目录最多显示 100 条':''}</p>
    {'local' in directory&&<button type="button" className="underline" onClick={()=>switchSource(true)}>查看 v5 历史目录</button>}
    {historical&&(backToLocal||legacyIndex)}
    {matching.map(item=><div key={item.id} className="rounded border">
      <div className="flex items-center"><button type="button" aria-expanded={selected===item.id} className="flex w-full items-center justify-between gap-4 p-2 text-left" onClick={()=>{setSelected(selected===item.id?'':item.id);setPage(0);}}>
        <span>{item.title} · {formatUTC8(item.at)}</span><span>{item.count} 条</span>
      </button>{onDelete&&<DirectoryDeleteButton item={item} onChoose={onDelete}/>}</div>
      {selected===item.id&&<div className="border-t p-2">
        {item.pages[page]?<ArchivePage key={item.id+'-'+page} owner={owner} directory={directory} pageKey={item.pages[page]} reload={reload}/>:<p>{item.count?'该页尚未建立索引':'本轮没有记录'}</p>}
        {item.pages.length>1&&<div className="mt-2 flex items-center gap-3"><button type="button" disabled={!page} onClick={()=>setPage(n=>n-1)}>上一页</button><span>{page+1} / {item.pages.length}</span><button type="button" disabled={page+1>=item.pages.length} onClick={()=>setPage(n=>n+1)}>下一页</button></div>}
      </div>}
    </div>)}
    {!matching.length&&<p>{groups.length?'没有匹配的归档目录。':'这个版本尚无可显示的归档目录。'}</p>}
  </section>;
}
