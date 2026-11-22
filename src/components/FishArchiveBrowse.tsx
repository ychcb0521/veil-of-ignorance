import {useEffect,useMemo,useRef,useState} from 'react';
import {formatUTC8} from '@/lib/timeFormat';
import {readBrowseCatalog,readBrowsePage,type BrowseCatalog,type BrowseRow,type BrowseScope} from '@/lib/fish/libraryBrowse';
import {mergeLibraryDirectoryEdits,type LibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
import {readScreenCatalog,readScreenPage,type LocalScreenCatalog} from '@/lib/fish/preEntryPersistence';

import {FishContinuousTable} from './FishContinuousTable';
import {FishScrollBoundary} from './FishScrollBoundary';
import {DirectoryDeleteButton} from './FishDirectoryTrash';
import type {DirectoryMarks,DirectoryRef} from '@/lib/fish/directoryTrash';
type Directory = {local:LocalScreenCatalog} | {cloud:BrowseCatalog};
type Props = {owner:string;scope:BrowseScope;query:string;edits?:LibraryDirectoryEdits;marks?:DirectoryMarks;onDelete?:(item:DirectoryRef)=>void;pickRecords?:boolean;onSelectRecords?:(id:string,records?:ReadonlySet<string>)=>void;selectBeforeLoad?:boolean;legacySelection?:boolean};

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

type ArchiveStream = {rows: BrowseRow[]; next: number; loading: boolean; error: string};
const archiveRowKey = (row: BrowseRow, index:number) => row[3]+'/'+index;
const collator=new Intl.Collator('zh-CN',{numeric:true});

function ArchiveRecords({owner, directory, pages, reload, pick, legacy}: {
  owner: string; directory: Directory; pages: string[]; reload: () => void; pick?:(ids:ReadonlySet<string>)=>void; legacy?:boolean;
}) {
  const [stream, setStream] = useState<ArchiveStream>({rows: [], next: 0, loading: true, error: ''});
  const {rows, next, loading, error} = stream;
  const [sort,setSort]=useState<{column:0|1|2;ascending:boolean}>();
  const [all,setAll]=useState(false);
  const [exceptions,setExceptions]=useState<ReadonlySet<string>>(()=>new Set());
  const [readRemaining,setReadRemaining]=useState(false);
  const complete=next===pages.length;
  const sorted=useMemo(()=>sort ? [...rows].sort((a,b)=>{
    const cmp=sort.column===1 ? a[1]-b[1] : collator.compare(a[sort.column],b[sort.column]);
    return sort.ascending ? cmp : -cmp;
  }) : rows,[rows,sort]);
  const checked=(id:string)=>all!==exceptions.has(id);
  const count=all ? rows.length-exceptions.size : exceptions.size;
  const sortHeader=(column:0|1|2,label:string)=>{
    const active=sort?.column===column;
    return <th scope="col" aria-sort={active?(sort.ascending?'ascending':'descending'):undefined}>
      <button type="button" aria-label={'按'+label+'排序'} onClick={()=>{
        setSort({column,ascending:active?!sort.ascending:column!==1});
        setReadRemaining(true);
      }}>{label} {active?(sort.ascending?'↑':'↓'):'↕'}</button>
    </th>;
  };
  useEffect(()=>{
    if(readRemaining&&!loading&&!error&&!complete)setStream(s=>({...s,loading:true}));
  },[readRemaining,loading,error,complete,next]);
  const loadNext = () => setStream(s => s.loading ? s : {...s, loading: true, error: ''});

  useEffect(() => {
    if (!loading || next >= pages.length) return;
    const controller = new AbortController();
    const fail = (message: string) => setStream(s => ({...s, loading: false, error: message}));
    const timer = setTimeout(() => {
      controller.abort();
      fail('归档记录读取超时');
    }, 15000);
    const key = pages[next];
    const request = 'cloud' in directory
      ? readBrowsePage(directory.cloud, key, controller.signal)
      : readScreenPage(owner, directory.local.id, key);
    void request.then(batch => {
      if (!controller.signal.aborted) {
        setStream(s => ({rows: s.rows.concat(batch), next: next + 1, loading: false, error: ''}));
      }
    }, cause => {
      if (!controller.signal.aborted) fail(cause instanceof Error ? cause.message : '归档记录读取失败');
    }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [owner, directory, pages, next, loading]);

  return <>
    {pick&&<div className="flex flex-wrap items-center gap-3">
      <label><input type="checkbox" checked={all&&!exceptions.size} disabled={!rows.length}
        onChange={e=>{setAll(e.target.checked);setExceptions(new Set());if(e.target.checked)setReadRemaining(true);}}/> 全选目录预览记录</label>
      <span>已选 {count} 条</span>
      <button type="button" disabled={!count||all&&!complete} className="rounded border px-2 py-1 text-primary"
        onClick={()=>pick(new Set(rows.filter(r=>checked(r[3])).map(r=>r[3])))}>
        {legacy?'载入旧版完整档案并导入所选':'导入所选到组合表'}
      </button>
    </div>}
    <FishContinuousTable items={sorted} getKey={archiveRowKey} columns={pick?4:3} resetKey={JSON.stringify([owner,sort])}
      label="归档记录连续滚动列表" testId="archive-record-scroll" estimate={24} className="max-h-72"
      tableClassName="text-left" header={<tr>{pick&&<th scope="col">选取</th>}{sortHeader(0,'标的')}{sortHeader(1,'信号时间（北京时间）')}{sortHeader(2,'归档记录')}</tr>}
      row={row => <tr className="[&>td]:border-t">{pick&&<td><input type="checkbox" aria-label={'勾选 '+row[0]+' '+formatUTC8(row[1])} checked={checked(row[3])}
        onChange={()=>setExceptions(prior=>{const ids=new Set(prior);if(ids.has(row[3]))ids.delete(row[3]);else ids.add(row[3]);return ids;})}/></td>}
        <td className="pr-2 font-mono">{row[0]}</td><td className="whitespace-nowrap pr-2">{formatUTC8(row[1])}</td><td>{row[2]}</td></tr>}
      footer={!loading && !error && next < pages.length ? <FishScrollBoundary key={next} onReach={loadNext}/> : null}/>
    {loading && <p role="status">{rows.length ? '正在读取后续记录…' : '正在读取归档记录…'}</p>}
    {error && <p role="alert">{error} <button type="button" className="underline" onClick={loadNext}>重试读取</button>
      {' · '}<button type="button" className="underline" onClick={reload}>重新读取目录</button></p>}
    {!loading && !error && !rows.length && next === pages.length && <p>本轮没有记录</p>}
  </>;
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

export function FishArchiveBrowse({owner,scope,query,edits,marks,onDelete,onSelectRecords,pickRecords,selectBeforeLoad,legacySelection}:Props){
  const [historicalOnly,setHistoricalOnly]=useState(false);
  const [directory,setDirectory]=useState<Directory>(),[issue,setIssue]=useState(''),[attempt,setAttempt]=useState(0);
  const [selected,setSelected]=useState('');
  const [opened,setOpened]=useState('');
  const reload=()=>{setOpened('');setDirectory(undefined);setIssue('');setSelected('');setAttempt(n=>n+1);};
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
  useEffect(()=>{if(selected&&marks?.has(selected))setSelected('');},[selected,marks]);
  const legacyIndex=scope==='screen'?<LegacyScreenIndex owner={owner} onReady={reload}/>:null;
  const switchSource=(historical:boolean)=>{setHistoricalOnly(historical);reload();};
  const backToLocal=historicalOnly&&<button type="button" className="underline" onClick={()=>switchSource(false)}>返回本机目录</button>;
  if(issue)return <><p role="alert" className="text-xs">{issue} <button type="button" className="underline" onClick={reload}>重新读取目录</button></p>{backToLocal||legacyIndex}{scope==='screen'&&<RebuildHistoricalIndex owner={owner} onReady={reload}/>}</>;
  if(!directory)return <p role="status" className="text-xs">正在读取目录…</p>;
  const historical='cloud' in directory&&scope==='screen';
  const matching=groups.filter(item=>(item.title+' '+item.id+' '+formatUTC8(item.at)).toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-label="归档记录浏览" className="space-y-2 text-xs">
    <p className="text-muted-foreground">{'local' in directory?'本机 v6 筛选快照':historical?'账号 v5 历史筛选归档':'账号归档'} · {groups.length} 个目录{'cloud' in directory&&directory.cloud.recent?' · 近期索引，每项目录最多显示 100 条':''}</p>
    {'local' in directory&&<button type="button" className="underline" onClick={()=>switchSource(true)}>查看 v5 历史目录</button>}
    {historical&&(backToLocal||legacyIndex)}
    {matching.map(item=><div key={item.id} className="rounded border">
      <div className="flex items-center"><button type="button" aria-expanded={selected===item.id} className="flex w-full items-center justify-between gap-4 p-2 text-left" onClick={()=>{setOpened('');setSelected(selected===item.id?'':item.id);}}>
        <span>{item.title} · {formatUTC8(item.at)}</span><span>{item.count} 条</span>
      </button>{onDelete&&<DirectoryDeleteButton item={item} onChoose={onDelete}/>}</div>
      {selected===item.id&&<div className="space-y-2 border-t p-2">
        {selectBeforeLoad&&opened!==item.id&&item.pages.length>0&&<button type="button" className="rounded-md border px-2 py-1 hover:bg-muted"
          onClick={()=>setOpened(item.id)}>载入所选目录</button>}
        {onSelectRecords&&item.count>0&&(legacySelection
          ? <details><summary className="cursor-pointer text-muted-foreground">旧归档导入</summary>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span>此索引只保存预览字段。导入原始记录需要恢复旧版完整档案。</span>
              <button type="button" className="rounded-md border px-2 py-1 text-primary hover:bg-muted" onClick={()=>onSelectRecords(item.id)}>载入旧版完整档案并选取记录</button>
            </div>
          </details>
          : <button type="button" className="rounded-md border px-2 py-1 text-primary hover:bg-muted" onClick={()=>onSelectRecords(item.id)}>选取本目录记录</button>)}
        {item.pages.length ? (!selectBeforeLoad||opened===item.id)&&<ArchiveRecords key={JSON.stringify([owner,item.id,'local' in directory?directory.local.id:directory.cloud.revisions,item.pages])}
          owner={owner} directory={directory} pages={item.pages} reload={reload} legacy={legacySelection} pick={pickRecords&&onSelectRecords?ids=>onSelectRecords(item.id,ids):undefined}/> : <p>{item.count?'该目录尚未建立记录索引':'本轮没有记录'}</p>}
      </div>}
    </div>)}
    {!matching.length&&<p>{groups.length?'没有匹配的归档目录。':'这个版本尚无可显示的归档目录。'}</p>}
  </section>;
}
