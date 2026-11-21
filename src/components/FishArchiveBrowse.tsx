import {useEffect,useState} from 'react';
import {formatUTC8} from '@/lib/timeFormat';
import {readBrowseCatalog,readBrowsePage,type BrowseCatalog,type BrowseRow,type BrowseScope} from '@/lib/fish/libraryBrowse';

import type {LibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
interface Props {owner:string;scope:BrowseScope;query:string;edits?:LibraryDirectoryEdits}
import type {ScreenBrowse} from '@/lib/fish/screenBrowse';
export function FishArchiveBrowse({owner,scope,query,edits}:Props) {
  const [catalog,setCatalog]=useState<BrowseCatalog>();
  const [selected,setSelected]=useState(''),[page,setPage]=useState(0),[rows,setRows]=useState<BrowseRow[]>();
  const [error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [local,setLocal]=useState<ScreenBrowse>();
  const [historical,setHistorical]=useState<ScreenBrowse>();
  useEffect(()=>{
    if(scope!=='screen'||typeof Worker==='undefined')return;
    const worker=new Worker(new URL('../lib/workers/screenBrowse.worker.ts',import.meta.url),{type:'module'});
    let active=true;
    worker.onmessage=event=>{if(active&&event.data){setLocal(event.data);setSelected('');setError('');}worker.terminate();};
    worker.onerror=()=>worker.terminate();
    worker.postMessage({owner,edits});
    return ()=>{active=false;worker.terminate();};
  },[scope,owner,edits]);
  const snapshot=local??historical;
  const groups=snapshot?.groups??catalog?.groups;
  const group=groups?.find(item=>item.id===selected);
  const hash=group?.pages[page];
  useEffect(()=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    let active=true;
    setCatalog(undefined);setHistorical(undefined);setSelected('');setError('');
    void (async()=>{
      const result=await readBrowseCatalog(owner,scope,controller.signal);
      if(!active)return;
      setCatalog(result);
      if(!result&&scope==='screen'){
        const {historicalScreenBrowse}=await import('@/lib/fish/historicalScreenBrowse');
        const archive=await historicalScreenBrowse(owner,controller.signal);
        if(active)setHistorical(archive);
      }
    })().catch(()=>{if(active)setError('近期目录读取失败');}).finally(()=>clearTimeout(timeout));
    return ()=>{active=false;clearTimeout(timeout);controller.abort();};
  },[owner,scope,attempt]);
  useEffect(()=>{
    setRows(undefined);
    if(!hash)return;
    if(snapshot){setRows(snapshot.pages[hash]);return;}
    if(!catalog)return;
    let active=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    void readBrowsePage(catalog,hash,controller.signal).then(result=>{if(active)setRows(result);},
      reason=>{if(active)setError(reason instanceof Error?reason.message:'记录读取失败');}).finally(()=>clearTimeout(timer));
    return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[catalog,snapshot,hash]);
  if(error&&!snapshot)return <p role="alert" className="text-xs text-destructive">{error} <button className="underline" onClick={()=>setAttempt(n=>n+1)}>重新读取近期目录</button></p>;
  if(!groups)return null;
  const matching=groups.filter(item=>(item.title+' '+formatUTC8(item.at)).toLowerCase().includes(query.trim().toLowerCase()));
  return <section aria-label="归档记录浏览" className="space-y-2 text-xs">
    <p className="text-muted-foreground">{local?'本机 v6 筛选快照 · 只读':scope==='screen'?'账号 v5 历史筛选归档 · 只读':'账号归档 · 最近轮次优先'} · {groups.length} 个目录{catalog?.recent&&!local?' · 每个目录先列最近 100 条':''}</p>
    {matching.map(item=><div key={item.id} className="rounded border">
      <button type="button" aria-expanded={selected===item.id} className="flex w-full items-center justify-between gap-4 p-2 text-left" onClick={()=>{setSelected(selected===item.id?'':item.id);setPage(0);setRows(undefined);}}>
        <span>{item.title} · {formatUTC8(item.at)}</span><span>{item.count} 条</span>
      </button>
      {selected===item.id&&<div className="border-t p-2">
        {item.count===0?<p>本轮没有记录</p>:!rows?<p role="status">正在读取本页…</p>:<div className="max-h-72 overflow-auto">
          <table className="w-full text-left"><thead><tr><th>标的</th><th>信号时间（北京时间）</th><th>归档记录</th></tr></thead>
          <tbody>{rows.map((row,i)=><tr key={row[3]+'-'+i} className="border-t"><td className="pr-2 font-mono">{row[0]}</td><td className="pr-2 whitespace-nowrap">{formatUTC8(row[1])}</td><td>{row[2]}</td></tr>)}</tbody></table>
        </div>}
        {item.pages.length>1&&<div className="mt-2 flex items-center gap-3"><button type="button" disabled={!page} onClick={()=>{setRows(undefined);setPage(n=>n-1);}}>上一页</button><span>{page+1} / {item.pages.length}</span><button type="button" disabled={page+1>=item.pages.length} onClick={()=>{setRows(undefined);setPage(n=>n+1);}}>下一页</button></div>}
      </div>}
    </div>)}
    {!matching.length&&<p>没有匹配的归档目录。</p>}
  </section>;
}
