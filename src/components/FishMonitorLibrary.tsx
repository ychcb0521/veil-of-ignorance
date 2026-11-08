import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {FishLibraryDataActions} from './FishLibraryTransferContext';
import {monitorRoundStudy} from '@/lib/fish/qualityMonitorArchive';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {ChevronDown,Database,Download,MoreHorizontal,Copy,Trash2,Undo2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {FishQualityInfo} from '@/components/FishQualityModule';
import type {FishQualityStudy} from '@/lib/fish/quality';
import {qualityMonitorArchiveResultCount,qualityMonitorRoundRecordIds,type QualityMonitorArchive,type QualityMonitorArchiveStudy} from '@/lib/fish/qualityMonitorLibrary';
import {downloadMonitorRecords} from '@/lib/fish/qualityMonitorTable';
import {formatUTC8} from '@/lib/timeFormat';
import type {TradeSignal} from '@/lib/signalLibrary';
const action='inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const date=(t:number|null|undefined)=>t==null?'—':formatUTC8(t);
export function FishMonitorLibrary({study,renderStudy,onCopyStudy,onSetHidden,loadArchive}:{study:FishQualityStudy;onJump?:(s:TradeSignal)=>void;canJump?:(s:TradeSignal)=>boolean;onOpenCampaign?:()=>void;renderStudy?:(snapshot:FishQualityStudy)=>ReactNode;onCopyStudy?:(snapshot:FishQualityStudy,sourceRoundId?:string)=>Promise<boolean>;onSetHidden?:(id:string,hidden:boolean)=>Promise<boolean>;loadArchive?:(archive:QualityMonitorArchive)=>Promise<QualityMonitorArchiveStudy>}){
  const [open,setOpen]=useState(false),[archiveId,setArchiveId]=useState(''),[exportError,setExportError]=useState('');
  const [showDeleted,setShowDeleted]=useState(false),[deleteId,setDeleteId]=useState(''),[directoryBusy,setDirectoryBusy]=useState(''),[directoryError,setDirectoryError]=useState('');
  const hideEntry=async(id:string,hidden:boolean)=>{if(!onSetHidden||directoryBusy)return;setDirectoryBusy(id);setDirectoryError('');try{if(!await onSetHidden(id,hidden))throw Error('目录修改未保存，请重试');setDeleteId('');if(hidden)setArchiveId('');}catch(e){setDirectoryError((e as Error).message);}finally{setDirectoryBusy('');}};
  const copyEntry=async()=>{if(!onCopyStudy||!archiveStudy||directoryBusy)return;setDirectoryBusy(archiveId);setDirectoryError('');try{if(!await (selectedArchive?.round?onCopyStudy(archiveStudy,selectedArchive.round.id):onCopyStudy(archiveStudy)))throw Error('副本未载入，当前总表仍保留，请重试');setOpen(false);}catch(e){setDirectoryError((e as Error).message);}finally{setDirectoryBusy('');}};
  const library = study.monitorLibrary;
  const settings = useMemo(() => new Map((library?.settings ?? []).map(s => [s.id, s])), [library?.settings]);
  const rounds = useMemo(() => [...(library?.rounds ?? [])].reverse().sort((a, b) => b.startedAt - a.startedAt), [library?.rounds]);
  const directory=useMemo(()=>{
    const archives=library?.archives??[],frozenRounds=new Set(archives.map(a=>a.sourceRoundId));
    return [...archives.map(a=>({id:a.id,at:a.createdAt,archive:a,round:undefined})),...rounds.filter(r=>!frozenRounds.has(r.id)).map(r=>({id:r.id,at:r.startedAt,archive:undefined,round:r}))].sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
  },[library?.archives,rounds]);
  const visibleDirectory=directory.filter(item=>showDeleted||!library?.directoryEdits?.[item.id]?.hidden);
  const deletedCount=directory.filter(item=>library?.directoryEdits?.[item.id]?.hidden).length;
  const selectedArchive=directory.find(a=>a.id===archiveId);
  // 归档正文单独存放（几十 MB 一份），点开哪份才读哪份。
  const [loadedArchive,setLoadedArchive]=useState<{id:string;study?:QualityMonitorArchiveStudy;error?:string}>();
  const pendingArchive=open&&selectedArchive?.archive&&!selectedArchive.archive.study?selectedArchive.archive:undefined;
  useEffect(()=>{
    if(!pendingArchive||loadedArchive?.id===pendingArchive.id&&loadedArchive.study)return;
    if(!loadArchive){setLoadedArchive({id:pendingArchive.id,error:'这份归档的正文不在当前页面'});return;}
    let active=true;setLoadedArchive({id:pendingArchive.id});
    loadArchive(pendingArchive).then(body=>{if(active)setLoadedArchive({id:pendingArchive.id,study:body});},e=>{if(active)setLoadedArchive({id:pendingArchive.id,error:e instanceof Error?e.message:'归档读取失败，请重试'});});
    return()=>{active=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[pendingArchive?.id,loadArchive]);
  const archiveStudy=useMemo(()=>open&&selectedArchive?(selectedArchive.archive?(selectedArchive.archive.study??(loadedArchive?.id===selectedArchive.archive.id?loadedArchive.study:undefined)) as FishQualityStudy|undefined:monitorRoundStudy(study,selectedArchive.round!)):undefined,[open,selectedArchive,study,loadedArchive]);

  const roundNumbers=useMemo(()=>new Map(rounds.filter(r=>!r.legacy).reverse().map((r,i)=>[r.id,i+1])),[rounds]);
  const records=useMemo(()=>open?(library?.records??[]).filter(r=>settings.has(r.settingId)):[],[open,library?.records,settings]);
  const download=()=>{try{downloadMonitorRecords(records,settings);setExportError('');}catch(error){setExportError(error instanceof Error?error.message:'导出失败');}};
  const roundState={running:'运行中',complete:'已完成',paused:'已暂停',failed:'失败'} as const;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className={action} aria-label="打开监测库"><Database aria-hidden className="h-3 w-3"/>监测库</button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[96vw] sm:max-w-[96vw] flex-col gap-3 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <DialogHeader className="shrink-0 space-y-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5 pr-6"><DialogTitle className="text-sm">监测库</DialogTitle><FishLibraryDataActions scope="monitor"/><FishQualityInfo label="监测库说明"><p>时间目录按保存时间从新到旧排列，保留每份运行的条件和结果。目录菜单可删除并恢复目录。</p><p>展开记录后点“复制至组合表”，沿用现有复制功能：先完整归档当前组合表，再载入独立副本。原归档保留，副本可继续操作，不自动运行。</p><p>早期轮次只展示仍保存的记录和条件，不补造缺失读数。完整下载、导入及导出保留。</p></FishQualityInfo><button type="button" className={`${action} ml-auto`} aria-label="导出监测库数据" title="导出监测库中已保存的记录" disabled={!records.length} onClick={download}><Download aria-hidden className="h-3 w-3"/>导出数据 <span className="font-mono tabular-nums">{records.length}</span></button></div>
        <DialogDescription className="text-[11px]">{library?.records.length??0} 条记录 · {roundNumbers.size} 轮监测 · {library?.archives?.length??0} 份完整归档{rounds.some(r=>r.legacy)?' · 含历史快照':''}</DialogDescription>
      </DialogHeader>
      <h3 className="shrink-0 rounded-lg bg-muted/50 px-3 py-2 text-[11px] font-medium">时间目录</h3>
      {exportError&&<p role="alert" className="text-[11px] text-destructive">{exportError}</p>}
      <div className="space-y-3" data-testid="monitor-archive-directory">
        {!!deletedCount&&<label className="inline-flex items-center gap-2 text-[10px] text-muted-foreground"><input type="checkbox" checked={showDeleted} onChange={e=>setShowDeleted(e.target.checked)}/>显示已删除目录（{deletedCount}）</label>}{directoryError&&<p role="alert" className="text-xs text-destructive">{directoryError}</p>}
        {!visibleDirectory.length&&<p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">暂无监测归档。点击“从头重新计算”时，会先归档当前已有的运行结果。</p>}
        {visibleDirectory.map(item=><div key={item.id} className={`group/archive rounded-lg border border-border/60 ${library?.directoryEdits?.[item.id]?.hidden?'opacity-60':''}`} data-testid="monitor-archive-item">
          <div className="flex items-center"><button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-3 p-3 text-left text-[11px] hover:bg-muted/40" aria-label={`打开监测归档 ${item.id}`} aria-expanded={archiveId===item.id} onClick={()=>setArchiveId(archiveId===item.id?'':item.id)}><ChevronDown className={`h-3 w-3 ${archiveId===item.id?'rotate-180':''}`}/><span className="font-mono">{date(item.at)}</span><span className="font-medium">{item.archive?item.archive.reason==='copy'?'载入副本前归档':item.archive.reason==='copy-source'?'监测轮次快照':'重算前完整归档':item.round?.legacy?'历史记录':'监测轮次'}</span><span className="text-muted-foreground">{item.archive?(()=>{const n=qualityMonitorArchiveResultCount(item.archive);return n==null?'完整快照':`${n} 项运行结果`;})():`${qualityMonitorRoundRecordIds(library!,item.round!).length} 条记录 · ${roundState[item.round!.state]}`}</span></button>{onSetHidden&&<DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={`管理监测归档 ${item.id}`} disabled={!!directoryBusy} className="mr-2 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/archive:opacity-100 group-focus-within/archive:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"><MoreHorizontal className="h-3.5 w-3.5"/></button></DropdownMenuTrigger><DropdownMenuContent align="end">{library?.directoryEdits?.[item.id]?.hidden?<DropdownMenuItem onSelect={()=>void hideEntry(item.id,false)}><Undo2 className="mr-2 h-3 w-3"/>恢复目录</DropdownMenuItem>:<DropdownMenuItem className="text-destructive" onSelect={()=>setDeleteId(item.id)}><Trash2 className="mr-2 h-3 w-3"/>删除目录</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}</div>
          {deleteId===item.id&&<div role="alert" className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[11px]"><span>删除这项目录？可在已删除目录中恢复。</span><button type="button" disabled={!!directoryBusy} className={`${action} text-destructive`} onClick={()=>void hideEntry(item.id,true)}>确认删除目录</button><button type="button" className={action} onClick={()=>setDeleteId('')}>取消</button></div>}
          {archiveId===item.id&&!archiveStudy&&loadedArchive?.id===item.id&&<p role={loadedArchive.error?'alert':'status'} className={`border-t px-4 py-3 text-[10.5px] ${loadedArchive.error?'text-destructive':'text-muted-foreground'}`}>{loadedArchive.error??'正在读取归档…'}</p>}{archiveId===item.id&&archiveStudy&&<div className="border-t" data-testid="monitor-archive-content">{onCopyStudy&&<div className="flex items-center gap-1 px-4 pt-3"><button type="button" disabled={!!directoryBusy} onClick={()=>void copyEntry()} className={`${action} text-primary`}><Copy className="h-3 w-3"/>{directoryBusy===item.id?'正在保存副本…':'复制至组合表'}</button><FishQualityInfo label="复制至组合表说明"><p>先将当前组合表完整归档，再载入这份运行结果的独立副本。原归档保留，返回组合表后可继续筛选、勾选、修改条件和运行。</p></FishQualityInfo></div>}{!item.archive&&<p className="px-4 pt-3 text-[10px] text-muted-foreground">早期轮次仅保存记录引用，重复条件可能已更新，展示当前仍保存的版本；未保存的探测值、入场读数和反事实保持缺失。重算前完整归档则保留当时的独立快照。</p>}{renderStudy?.(archiveStudy)??<p className="px-4 py-3 text-xs text-muted-foreground">{archiveStudy.results.length} 项运行结果 · 可复制至组合表继续操作</p>}</div>}
        </div>)}
      </div>
    </DialogContent>
  </Dialog>;
}
