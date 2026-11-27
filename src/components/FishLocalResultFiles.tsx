import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {monitorFolder,readBlock,type MonitorFolder} from '@/lib/fish/localMonitorFiles';
import {localScopeName,resultIndex,resultPage,type DiskResultRow,type LocalResultIndex,type ResultDirectory} from '@/lib/fish/localResultFiles';
import type {BrowseScope} from '@/lib/fish/libraryBrowse';
import {formatUTC8} from '@/lib/timeFormat';
import {supabase} from '@/integrations/supabase/client';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from './ui/dialog';

const link='text-xs text-primary underline';
const message=(e:unknown)=>e instanceof Error?e.message:'读取本机归档失败';
type Selection={group:ResultDirectory;file:File};
type Header=Pick<LocalResultIndex,'owner'|'scope'|'savedAt'|'revision'|'source'> & {groups:Pick<ResultDirectory,'id'|'title'|'count'|'parent'|'data'>[]};

function ResultPages({group,file}:Selection){
  const rowHeight = 36;
  const pageSize = 32;
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState<{page:number; rows:DiskResultRow[]}>();
  const [detail,setDetail]=useState<unknown>(),[issue,setIssue]=useState('');
  useEffect(()=>{
    let live=true;
    setIssue('');
    const pages = [page, page+1].filter(index=>index<group.pages.length);
    void Promise.all(pages.map(index=>resultPage(file,group,index))).then(values=>{
      if(live)setLoaded({page,rows:values.flat()});
    },e=>{if(live)setIssue(message(e));});
    return ()=>{live=false;};
  },[group,file,page]);
  return <>
    <button type="button" className={link+' self-start'} onClick={()=>void readBlock(file,group.settings).then(setDetail,e=>setIssue(message(e)))}>查看归档设置</button>
    {issue&&<p role="alert">{issue}</p>}
    <div className="grid grid-cols-[1fr_2fr_2fr] px-2 text-xs"><span>标的</span><span>信号时间（北京时间）</span><span>记录</span></div>
    <div className="relative h-72 shrink-0 overflow-y-auto border-y" onScroll={e=>setPage(Math.floor(e.currentTarget.scrollTop/(rowHeight*pageSize)))}>
      <div className="relative" style={{height:rowHeight*group.count}}>
        {loaded?.page===page&&loaded.rows.map((r,i)=><button key={page*pageSize+i} type="button"
          className="absolute grid w-full grid-cols-[1fr_2fr_2fr] items-center border-b px-2 text-left text-xs hover:bg-muted"
          style={{height:rowHeight,top:(page*pageSize+i)*rowHeight}} onClick={()=>setDetail(r.record)}>
          <span>{r.symbol}</span><span>{formatUTC8(r.time)}</span><span className="truncate" title={r.summary}>{r.summary}</span>
        </button>)}
      </div>
    </div>
    {detail!=null&&<div className="min-h-0 overflow-auto"><button className={link} onClick={()=>setDetail(undefined)}>收起详情</button><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(detail,null,2)}</pre></div>}
  </>;
}

// All four libraries share the account-scoped directory handle originally used by the monitor.
const DiskAction=createContext<{action:(id:string)=>ReactNode;open:(id:string,revisions?:Record<string,string>,count?:number)=>boolean}>({action:()=>null,open:()=>false});
export function LocalResultAction({id}:{id:string}){return <>{useContext(DiskAction).action(id)}</>;}
export function useOpenLocalResult(){return useContext(DiskAction).open;}
export function FishLocalResultFiles({owner,scope,active,hidden,children}:{owner:string;scope:BrowseScope;active:boolean;
  hidden?:(id:string)=>boolean;children:(toolbar:ReactNode)=>ReactNode}){
  const [disk,setDisk]=useState<LocalResultIndex>(),[cloud,setCloud]=useState<Header>();
  const [folder,setFolder]=useState<MonitorFolder>(),[locked,setLocked]=useState(false);
  const [selected,setSelected]=useState<Selection>(),[issue,setIssue]=useState('');
  const epoch=useRef(0);
  const picker=(window as Window & {showDirectoryPicker?:(o:{mode:'read'})=>Promise<MonitorFolder>}).showDirectoryPicker;
  useEffect(()=>{
    const id=++epoch.current;
    setSelected(undefined);setDisk(undefined);setFolder(undefined);setLocked(false);setIssue('');
    if(!active||!picker)return;
    void (async()=>{
      const handle=await monitorFolder(owner);
      if(!handle||id!==epoch.current)return;
      setFolder(handle);
      const allowed=await handle.queryPermission({mode:'read'})==='granted';
      if(id!==epoch.current)return;
      setLocked(!allowed);
      if(allowed){const index=await resultIndex(handle,owner,scope);if(id===epoch.current)setDisk(index);}
    })().catch(e=>{if(id===epoch.current)setIssue(message(e));});
    return ()=>{epoch.current++;};
  },[owner,scope,picker,active]);
  useEffect(()=>{
    if(!active)return;
    const ctrl=new AbortController();
    void (async()=>{
      const {data,error}=await supabase.from('user_sim_state').select('value').eq('user_id',owner)
        .eq('key','idb:fish-local-result-directory-v1/'+scope).abortSignal(ctrl.signal).maybeSingle();
      if(ctrl.signal.aborted||error)return;
      const h=data?.value as unknown as Header;
      if(h?.owner===owner && h.scope===scope && Number.isSafeInteger(h.savedAt) && Array.isArray(h.groups) &&
          h.groups.every(g=>g && typeof g.id==="string" && typeof g.title==="string" && Number.isSafeInteger(g.count) && typeof g.data==="string"))setCloud(h);
    })().catch(()=>{});
    return ()=>ctrl.abort();
  },[owner,scope,picker,active]);
  async function bind(reuse:boolean){
    const generation=++epoch.current;
    setIssue('');
    try{
      const handle=reuse&&folder?folder:await picker!.call(window,{mode:'read'});
      if(reuse&&await handle.requestPermission({mode:'read'})!=='granted')throw Error('请允许查看本机归档文件夹。');
      const index=await resultIndex(handle,owner,scope);
      if(!index)throw Error('所选目录没有当前账号的'+localScopeName[scope]+'索引。');
      if(generation!==epoch.current)return;
      await monitorFolder(owner,handle);
      if(generation===epoch.current){setFolder(handle);setDisk(index);setLocked(false);}
    }catch(e){if(generation===epoch.current&&(e as Error).name!=='AbortError')setIssue(message(e));}
  }
  async function show(group:ResultDirectory){
    const generation=++epoch.current;
    try{
      if(!folder||await folder.requestPermission({mode:'read'})!=='granted')throw Error('请先授权查看本机归档文件夹。');
      const file=await (await folder.getFileHandle(group.data)).getFile();
      if(generation===epoch.current){setSelected({group,file});setIssue('');}
    }catch(e){if(generation===epoch.current)setIssue(message(e));}
  }
  const find=(id:string,fromSnapshot:boolean)=>{
    const group=disk?.groups.find(g=>g.id===id);
    const matching=!cloud||cloud.groups.some(g=>g.id===id&&g.data===group?.data);
    return active&&!locked&&(fromSnapshot||matching)?group:undefined;
  };
  const action=(id:string,fromSnapshot=false)=>{
    const group=find(id,fromSnapshot);
    return group?<button className={link+' shrink-0 px-2'} onClick={()=>void show(group)}>{fromSnapshot?'打开本机明细':'打开本机快照'}</button>:null;
  };
  const catalog=cloud??disk;
  const toolbar=active&&(picker||catalog)&&<div className="max-h-44 shrink-0 space-y-1 overflow-auto text-xs">{picker&&<button className={link} onClick={()=>void bind(!!folder)}>
      {folder?(locked?'授权本机目录':'重读本机目录'):'绑定本机'+localScopeName[scope]}</button>}
      {folder&&<button className={link+' ml-3'} onClick={()=>void bind(false)}>更换文件夹</button>}
      {issue&&<p role="alert">{issue}</p>}
      {catalog&&<details><summary className="cursor-pointer">本机归档{scope==='screen'&&catalog.source==='v5'?' · v5 历史筛选':''} · {formatUTC8(catalog.savedAt)}</summary>
        {catalog.groups.filter(g=>!hidden?.(g.id)&&(!g.parent||!hidden?.(g.parent))).map(g=><div className={g.parent?'pl-4':''} key={g.id}>{g.title} · {g.count} 条 {action(g.id,!cloud)}</div>)}
        {(!disk||locked)&&<p>{picker?'请绑定或授权保存明细的文件夹。':'请在支持本机目录授权的浏览器中打开明细。'}</p>}
        {disk&&cloud&&disk.revision!==cloud.revision&&<details><summary>查看本机其他版本 · {formatUTC8(disk.savedAt)}</summary>
          {disk.groups.filter(g=>!hidden?.(g.id)&&(!g.parent||!hidden?.(g.parent))).map(g=><div key={g.id}>{g.title} · {g.count} 条 {action(g.id,true)}</div>)}</details>}</details>}
    </div>;
  return <DiskAction.Provider value={{action,open:(id,revisions,count)=>{const group=find(id,false);const archived=group?.revisions??disk?.revisions;if(!group||!archived||!revisions||group.count!==count||
      !Object.keys(revisions).length||!Object.entries(revisions).every(([k,v])=>archived[k]===v))return false;void show(group);return true;}}}>
    {children(toolbar)}
    {selected&&<Dialog open onOpenChange={open=>{if(!open)setSelected(undefined);}}><DialogContent className="flex max-h-[85dvh] max-w-3xl flex-col">
      <DialogHeader><DialogTitle>{selected.group.title}</DialogTitle><DialogDescription>{selected.group.count} 条本机记录 · {disk&&formatUTC8(disk.savedAt)} 归档</DialogDescription></DialogHeader>
      <ResultPages key={selected.group.data} {...selected}/></DialogContent></Dialog>}
  </DiskAction.Provider>;
}
