import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatUTC8 } from '@/lib/timeFormat';
import { diskRounds, monitorFolder, readDiskPage, readDiskSettings, type DiskRound, type MonitorFolder } from '@/lib/fish/localMonitorFiles';
import type { QualityMonitorRecord } from '@/lib/fish/qualityMonitorLibrary';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

const link = 'text-xs text-primary underline';
const problem = (e: unknown) => e instanceof Error ? e.message : '本机监测文件未能读取。';
type Selection = {round: DiskRound; file: File};

function LocalRows({round,file}: Selection) {
  const [page,setPage] = useState(0);
  const [loaded,setLoaded] = useState<{page:number;rows:QualityMonitorRecord[]}>();
  const [detail,setDetail] = useState<unknown>();
  const [error,setError] = useState('');
  useEffect(()=>{
    let current = true;
    const pages = [page,page+1].filter(p=>p<round.pages.length);
    setError('');
    void Promise.all(pages.map(p=>readDiskPage(file,round,p))).then(values=>{
      if(current)setLoaded({page,rows:values.flat()});
    },e=>{if(current)setError(problem(e));});
    return ()=>{current=false;};
  },[file,round,page]);
  const height=36;
  return <>
    <button type="button" className={link+' self-start'} onClick={()=>void readDiskSettings(file,round).then(setDetail,e=>setError(problem(e)))}>查看冻结设置</button>
    {error&&<p role="alert">{error}</p>}
    <div className="grid grid-cols-[1.2fr_2fr_1fr_1fr] px-2 text-xs text-muted-foreground"><span>标的</span><span>信号时间</span><span>状态</span><span>盈亏</span></div>
    <div className="relative h-72 shrink-0 overflow-y-auto border-y" onScroll={e=>setPage(Math.floor(e.currentTarget.scrollTop/(height*round.pageSize)))}>
      <div className="relative" style={{height:round.count*height}}>
        {loaded?.page===page&&loaded.rows.map((r,i)=><button type="button" key={r.id}
          className="absolute grid w-full grid-cols-[1.2fr_2fr_1fr_1fr] items-center border-b px-2 text-left text-xs hover:bg-muted"
          style={{height,top:(page*round.pageSize+i)*height}} onClick={()=>setDetail(r)}>
          <span>{r.source.symbol}</span><span>{formatUTC8(r.source.timeMs)}</span>
          <span>{r.result?.entryRejected?'未入选':({closed:'已结束',error:'缺数据',open:'持仓中',waiting:'等待'}[r.result?.status]??'—')}</span>
          <span>{Number.isFinite(r.result?.pnl)?r.result!.pnl.toFixed(2):'—'}</span>
        </button>)}
      </div>
    </div>
    {detail!=null&&<div className="min-h-0 overflow-auto"><button type="button" className={link} onClick={()=>setDetail(undefined)}>收起详情</button><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(detail,null,2)}</pre></div>}
  </>;
}

export function FishLocalMonitorFiles({owner,active,children}:{owner?:string;active:boolean;
  children:(toolbar:ReactNode,roundLink:(id:string,revision?:unknown)=>ReactNode)=>ReactNode}) {
  const [folder,setFolder]=useState<MonitorFolder>();
  const [rounds,setRounds]=useState<DiskRound[]>([]);
  const [locked,setLocked]=useState(false);
  const [issue,setIssue]=useState('');
  const [selected,setSelected]=useState<Selection>();
  const epoch=useRef(0);
  const picker=(window as Window & {showDirectoryPicker?:(options:{mode:'read'})=>Promise<MonitorFolder>}).showDirectoryPicker;
  useEffect(()=>{
    const generation=++epoch.current;
    if(!active||!owner||!picker)return;
    async function restore(){
      const saved=await monitorFolder(owner);
      if(!saved||generation!==epoch.current)return;
      setFolder(saved);
      const allowed=await saved.queryPermission({mode:'read'})==='granted';
      if(generation!==epoch.current)return;
      setLocked(!allowed);
      const entries=allowed?await diskRounds(saved,owner):[];
      if(generation===epoch.current)setRounds(entries);
    }
    void restore().catch(e=>{if(epoch.current===generation)setIssue(problem(e));});
    return ()=>{epoch.current++;};
  },[active,owner,picker]);
  async function bind(reuse:boolean){
    const generation=++epoch.current;
    setIssue('');
    try {
      const handle=reuse&&folder?folder:await picker.call(window,{mode:'read'});
      if(reuse&&await handle.requestPermission({mode:'read'})!=='granted')throw Error('请允许读取已绑定的监测目录。');
      const entries=await diskRounds(handle,owner);
      if(!entries.length)throw Error('所选文件夹没有当前账号的本机监测索引。');
      if(generation!==epoch.current)return;
      await monitorFolder(owner,handle);
      if(generation!==epoch.current)return;
      setFolder(handle);setRounds(entries);setLocked(false);
    }catch(e){if(generation===epoch.current&&(e as Error)?.name!=='AbortError')setIssue(problem(e));}
  }
  async function show(round:DiskRound){
    const generation=++epoch.current;
    setIssue('');
    try{
      if(await folder.requestPermission({mode:'read'})!=='granted')throw Error('请允许读取本机监测目录。');
      const file=await (await folder.getFileHandle(round.data)).getFile();
      if(generation===epoch.current)setSelected({round,file});
    }catch(e){if(generation===epoch.current)setIssue(problem(e));}
  }
  const toolbar=owner&&active&&picker&&<div className="space-y-1 text-xs">
    <button type="button" className={link} onClick={()=>void bind(!!folder)}>{folder?(locked?'授权本机监测库':'重读本机目录'):'绑定本机监测库'}</button>
    {folder&&<button type="button" className={link+' ml-3'} onClick={()=>void bind(false)}>更换文件夹</button>}
    {issue&&<p role="alert">{issue}</p>}
    {rounds.length>0&&!locked&&<details><summary className="cursor-pointer">本机监测轮次（{rounds.length}）</summary>
      {rounds.map(r=><button type="button" key={r.id} className={link+' block py-1'} onClick={()=>void show(r)}>{r.title} · {r.count} 条</button>)}</details>}
  </div>;
  return <>{children(toolbar,(id,revision)=>{
    const round=active&&!locked&&rounds.find(r=>r.id===id && (typeof revision!=='string'||!revision.startsWith('recent-v1-')||revision===r.bodyId));
    return round?<button type="button" className={link+' shrink-0 px-2'} onClick={()=>void show(round)}>打开本机明细</button>:null;
  })}
    {active&&selected&&<Dialog open onOpenChange={v=>{if(!v)setSelected(undefined);}}><DialogContent className="flex max-h-[85dvh] max-w-3xl flex-col">
      <DialogHeader><DialogTitle>{selected.round.title}</DialogTitle><DialogDescription>{selected.round.count} 条本机监测记录 · 点击记录可查看原始明细</DialogDescription></DialogHeader>
      <LocalRows key={selected.round.id} {...selected}/></DialogContent></Dialog>}
  </>;
}
