import { useEffect, useRef, useState, type ReactNode } from 'react';
import { newQualityStudy, type FishQualityStudy } from '@/lib/fish/quality';
import { monitorRoundStudy } from '@/lib/fish/qualityMonitorArchive';
import type { QualityMonitorSetting } from '@/lib/fish/qualityMonitorLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { diskRounds, monitorFolder, readDiskPage, readDiskSettings, type DiskRound, type MonitorFolder } from '@/lib/fish/localMonitorFiles';
import type { QualityMonitorRecord } from '@/lib/fish/qualityMonitorLibrary';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

const link = 'text-xs text-primary underline';
const problem = (e: unknown) => e instanceof Error ? e.message : '本机监测文件未能读取。';
type Selection = {round: DiskRound; file: File};

const rowHeight = 36;

function MonitorPage({round,file,page,onDetail}:{round:DiskRound;file:File;page:number;onDetail:(value:QualityMonitorRecord)=>void}){
  const [rows,setRows]=useState<QualityMonitorRecord[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    let current=true;
    void readDiskPage(file,round,page).then(value=>{if(current)setRows(value);},e=>{if(current)setError(problem(e));});
    return ()=>{current=false;};
  },[file,round,page]);
  return <div className="absolute w-full" style={{top:page*round.pageSize*rowHeight}}>
    {error?<p role="alert">{error}</p>:!rows.length&&<p role="status">正在读取本机记录…</p>}
    {rows.map(r=><button type="button" key={r.id} className="grid w-full grid-cols-[1.2fr_2fr_1fr_1fr] items-center border-b px-2 text-left text-xs hover:bg-muted"
      style={{height:rowHeight}} onClick={()=>onDetail(r)}>
      <span>{r.source.symbol}</span><span>{formatUTC8(r.source.timeMs)}</span>
      <span>{r.result?.entryRejected?'未入选':({closed:'已结束',error:'缺数据',open:'持仓中',waiting:'等待'}[r.result?.status]??'—')}</span>
      <span>{Number.isFinite(r.result?.pnl)?r.result!.pnl.toFixed(2):'—'}</span>
    </button>)}
  </div>;
}

function LocalRows({round,file}: Selection) {
  const [range,setRange]=useState([0,0]);
  const [detail,setDetail]=useState<unknown>();
  const [error,setError]=useState('');
  return <>
    <button type="button" className={link+' self-start'} onClick={()=>void readDiskSettings(file,round).then(setDetail,e=>setError(problem(e)))}>查看冻结设置</button>
    {error&&<p role="alert">{error}</p>}
    <div className="grid grid-cols-[1.2fr_2fr_1fr_1fr] px-2 text-xs text-muted-foreground"><span>标的</span><span>信号时间</span><span>状态</span><span>盈亏</span></div>
    <div className="relative h-72 shrink-0 overflow-y-auto border-y" onScroll={e=>{
      const {scrollTop,clientHeight}=e.currentTarget;
      const pageHeight=rowHeight*round.pageSize;
      const first=Math.max(0,Math.floor(scrollTop/pageHeight));
      const last=Math.min(round.pages.length-1,Math.floor((scrollTop+clientHeight+rowHeight*4)/pageHeight));
      setRange(previous=>previous[0]===first&&previous[1]===last?previous:[first,last]);
    }}>
      <div className="relative" style={{height:round.count*rowHeight}}>
        {Array.from({length:round.count?Math.max(0,range[1]-range[0]+1):0},(_,i)=><MonitorPage
          key={range[0]+i} page={range[0]+i} round={round} file={file} onDetail={setDetail}/>)}
      </div>
    </div>
    {detail!=null&&<div className="min-h-0 overflow-auto"><button type="button" className={link} onClick={()=>setDetail(undefined)}>收起详情</button><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(detail,null,2)}</pre></div>}
  </>;
}

type StudyRenderer = (study: FishQualityStudy, close?: () => void) => ReactNode;
const blocksPerTable = 8;

function ArchiveTable({file, round, renderStudy, close}: Selection & {renderStudy: StudyRenderer; close: () => void}) {
  const [page, setPage] = useState(0);
  const [settings, setSettings] = useState<QualityMonitorSetting[]>();
  const [study, setStudy] = useState<FishQualityStudy>();
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const pageCount = Math.max(1, Math.ceil(round.pages.length / blocksPerTable));
  const first = page * blocksPerTable;
  useEffect(() => {
    let active = true;
    void readDiskSettings(file, round).then(value => {
      if (!Array.isArray(value)) throw Error('归档缺少冻结设置。');
      if (active) setSettings(value);
    }).catch(e => { if (active) setError(problem(e)); });
    return () => { active = false; };
  }, [file, round]);
  useEffect(() => {
    if (!settings) return;
    let active = true;
    async function load() {
      const blocks = round.pages.slice(first, first + blocksPerTable);
      const records = (await Promise.all(blocks.map((_, i) => readDiskPage(file, round, first + i)))).flat();
      if (!active) return;
      const known = new Set(settings.map(item => item.id));
      if (records.some(record => !known.has(record.settingId))) throw Error('记录缺少对应的冻结设置。');
      const library = {version: 1 as const, importedLegacy: false, settings, rounds: [], records};
      const snapshot = monitorRoundStudy({...newQualityStudy(round.at), monitorLibrary: library},
        {id: round.id, startedAt: round.at, updatedAt: round.at, state: 'complete'}, records);
      setStudy(snapshot);
    }
    void load().catch(e => { if (active) setError(problem(e)); });
    return () => { active = false; };
  }, [file, round, first, settings]);
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {pageCount > 1 && <label>本页筛选与导入 <select aria-label="监测记录范围" value={page}
        onChange={e => { setStudy(undefined); setError(''); setPage(Number(e.target.value)); }}>
        {Array.from({length: pageCount}, (_, i) => <option key={i} value={i}>
          {i * blocksPerTable * round.pageSize + 1}–{Math.min(round.count, (i + 1) * blocksPerTable * round.pageSize)} / {round.count}
        </option>)}
      </select></label>}
      <button type="button" className={link} onClick={() => setShowSettings(!showSettings)}>查看冻结设置</button>
    </div>
    {showSettings && settings && <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(settings,null,2)}</pre>}
    {error ? <p role="alert">{error}</p> : study ? <div key={page}>{renderStudy(study, close)}</div> : <p role="status">正在读取本机监测记录…</p>}
  </div>;
}

function InlineRound({folder,round,renderStudy,close}:{folder:MonitorFolder;round:DiskRound;renderStudy?:StudyRenderer;close:()=>void}){
  const [file,setFile]=useState<File>();
  const [issue,setIssue]=useState('');
  useEffect(()=>{
    let active=true;
    setFile(undefined);setIssue('');
    void folder.getFileHandle(round.data).then(handle=>handle.getFile()).then(value=>{if(active)setFile(value);},
      error=>{if(active)setIssue(problem(error));});
    return ()=>{active=false;};
  },[folder,round]);
  if(issue)return <p role="alert">{issue}</p>;
  return <section aria-label="本机监测明细" className="space-y-1 text-xs">
    <p className="font-medium">本机归档快照 · {round.count} 条</p>
    {file&&renderStudy?<ArchiveTable file={file} round={round} renderStudy={renderStudy} close={close}/>:file?<LocalRows round={round} file={file}/>:<p role="status">正在打开本机文件…</p>}
  </section>;
}

export function FishLocalMonitorFiles({owner,active,renderStudy,children}:{owner?:string;active:boolean;renderStudy?:StudyRenderer;
  children:(toolbar:(close:()=>void)=>ReactNode,roundLink:(id:string,revision?:unknown)=>ReactNode,roundPreview:(id:string,revision:unknown,close:()=>void)=>ReactNode)=>ReactNode}) {
  const [folder,setFolder]=useState<MonitorFolder>();
  const [rounds,setRounds]=useState<DiskRound[]>([]);
  const [locked,setLocked]=useState(false);
  const [checking,setChecking]=useState(true);
  const [issue,setIssue]=useState('');
  const [selected,setSelected]=useState<Selection>();
  const epoch=useRef(0);
  const picker=(window as Window & {showDirectoryPicker?:(options:{mode:'read'})=>Promise<MonitorFolder>}).showDirectoryPicker;
  useEffect(()=>{
    const generation=++epoch.current;
    if(!active||!owner||!picker)return;
    setChecking(true);setRounds([]);setFolder(undefined);setLocked(false);
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
    void restore().catch(e=>{if(epoch.current===generation)setIssue(problem(e));}).finally(()=>{if(epoch.current===generation)setChecking(false);});
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
    finally{if(generation===epoch.current)setChecking(false);}
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
  const toolbar=(close:()=>void)=>owner&&active&&picker&&<div className="space-y-1 text-xs">
    <button type="button" className={link} onClick={()=>void bind(!!folder)}>{folder?(locked?'授权本机监测库':'重读本机目录'):'绑定本机监测库'}</button>
    {folder&&<button type="button" className={link+' ml-3'} onClick={()=>void bind(false)}>更换文件夹</button>}
    {issue&&<p role="alert">{issue}</p>}
    {rounds.length>0&&!locked&&<details><summary className="cursor-pointer">本机监测轮次（{rounds.length}）</summary>
      {rounds.map(r=><button type="button" key={r.id} className={link+' block py-1'} onClick={()=>void show(r)}>{r.title} · {r.count} 条</button>)}</details>}
    {active&&selected&&<Dialog open onOpenChange={v=>{if(!v)setSelected(undefined);}}><DialogContent className="flex max-h-[85dvh] w-[96vw] max-w-[96vw] flex-col overflow-auto">
      <DialogHeader><DialogTitle>{selected.round.title}</DialogTitle><DialogDescription>{selected.round.count} 条本机监测记录</DialogDescription></DialogHeader>
      {renderStudy ? <ArchiveTable key={selected.round.bodyId} {...selected} renderStudy={renderStudy} close={()=>{setSelected(undefined);close();}}/> : <LocalRows key={selected.round.id} {...selected}/>}</DialogContent></Dialog>}
  </div>;
  return <>{children(toolbar,(id,revision)=>{
    const round=active&&!locked&&rounds.find(r=>r.id===id && (typeof revision!=='string'||!revision.startsWith('recent-v1-')||revision===r.bodyId));
    return round?<button type="button" className={link+' shrink-0 px-2'} onClick={()=>void show(round)}>打开本机明细</button>:null;
  },(id,revision,close)=>{
    if(!active||!picker)return null;
    const immutable=typeof revision==='string'&&revision.startsWith('recent-v1-');
    if(checking)return immutable?<p role="status">正在检查本机目录…</p>:null;
    if(!folder||locked)return immutable?<button type="button" className={link} onClick={()=>void bind(!!folder)}>
      {locked?'授权并读取本机明细':'绑定文件夹并读取本机明细'}</button>:null;
    // Old workspace entries have no immutable body ID. Label their disk view as a saved snapshot.
    const round=rounds.find(r=>r.id===id&&(!immutable||r.bodyId===revision));
    return round?<InlineRound key={round.bodyId} round={round} folder={folder} renderStudy={renderStudy} close={close}/>:null;
  })}

  </>;
}
