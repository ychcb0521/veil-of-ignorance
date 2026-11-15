import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {libraryCell} from './FishLibraryDialog';
import {FishQualityProgress} from './FishQualityProgress';
import {formatUTC8} from '@/lib/timeFormat';
import {isAutomaticPreEntryRound,preEntryRecordPending,type PreEntryRound} from '@/lib/fish/preEntryMonitor';
import {screeningCell,screeningStatus} from '@/lib/fish/qualityScreeningResults';
import type {FishQualityState} from '@/hooks/useFishQuality';

export function latestScreeningRound(rounds: readonly PreEntryRound[], running: boolean, automatic = false) {
  let latest: PreEntryRound | undefined, active: PreEntryRound | undefined;
  for (const round of rounds) {
    if (isAutomaticPreEntryRound(round) !== automatic) continue;
    if (!latest || round.startedAt > latest.startedAt) latest = round;
    if (running && round.state === 'running' && (!active || round.startedAt > active.startedAt)) active = round;
  }
  return active ?? latest;
}

/** Live observations and all outcomes remain visible independently of the selected source directory. */
export function FishPreEntryProgress({monitor,open:controlledOpen,onOpenChange,automatic=false}:{monitor:NonNullable<FishQualityState['preEntry']>;open?:boolean;onOpenChange?:(open:boolean)=>void;automatic?:boolean}){
  const [localOpen,setLocalOpen]=useState(false),[resultPage,setResultPage]=useState(0);
  const open=controlledOpen??localOpen,setOpen=(value:boolean)=>{setResultPage(0);setLocalOpen(value);onOpenChange?.(value);};
  const running=automatic ? !!monitor.automaticRunning : monitor.running;
  const progress=automatic ? undefined : monitor.progress, error=automatic ? monitor.automaticError : monitor.error;
  const round=open||!automatic&&running ? latestScreeningRound(monitor.library.rounds,running,automatic) : undefined;
  const records=round ? monitor.library.records.filter(r=>r.roundId===round.id) : [];
  const pageSize=100,pages=Math.max(1,Math.ceil(records.length/pageSize)),page=Math.min(resultPage,pages-1);
  const total=records.length,done=records.filter(r=>!preEntryRecordPending(r)).length;
  const completed=records.reduce((sum,r)=>sum+(!preEntryRecordPending(r)?1:r.endTime!=null&&r.endTime>r.startTime?Math.max(0,Math.min(1,(r.cursor-r.startTime)/(r.endTime-r.startTime))):0),0);
  const count=(status:string)=>records.filter(r=>r.status===status).length;
  const hitCount=count('matched');
  const scanning=records.find(r=>r.status==='scanning');
  const current=running?(progress?.current||scanning?.sample.source.symbol||'准备筛选…'):'';
  const label=!monitor.ready?'正在读取筛选库…':running?(progress?.waitingUntil?'等待续跑':'筛选进行中'):round?.state==='paused'?'已暂停':round?.state==='complete'?'已完成':round?'待继续':'尚未开始';
  return <>
    {!automatic && running && <FishQualityProgress
      testId="pre-entry-progress" label={error ? '筛选异常' : label} progressLabel="动态筛选处理进度"
      done={done} total={total} completed={completed} waitingUntil={progress?.waitingUntil} error={!!error}
      hitCount={{value:hitCount,title:'本轮已入选数量，按信号与筛选方案计数',testId:'pre-entry-hit-count'}}
      action={{label:error?'查看筛选错误':'查看本轮筛选结果',title:'点击查看本轮筛选结果',onClick:()=>setOpen(true)}}
    />}
    <Dialog open={open} onOpenChange={setOpen}>{open&&<DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0" data-testid="pre-entry-current-results"><DialogHeader className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5 text-left"><DialogTitle className="pr-8 text-base">{automatic?'自动筛选 · 最近结果':'动态筛选 · 本轮结果'}</DialogTitle><DialogDescription className="text-[11px]">{round?formatUTC8(round.startedAt):'暂无轮次'} · {label} · 已处理 {done} / {total} 项信号与方案</DialogDescription></DialogHeader>
      <div className="overflow-auto p-4"><div className="mb-3 space-y-1 text-[11px] text-muted-foreground"><p>入选 {count('matched')} · 未入选 {count('unmatched')} · 历史不足 {count('warming')} · 缺数据 {count('error')}</p>{current&&<p>{current}</p>}{running&&scanning&&<p>扫描到 {formatUTC8(Math.min(scanning.cursor,scanning.endTime??scanning.cursor))} · {scanning.detail}</p>}{error&&<p role="alert" className="text-destructive">{error}{!monitor.ready&&<button type="button" className="ml-1 underline" onClick={monitor.retry}>重试读取</button>}</p>}</div><table className="w-full text-[11px]"><thead><tr>{['标的','原信号时间','筛选方案','筛选状态','状态与原因','扫描到','首次满足时间'].map(h=><th key={h} className={libraryCell}>{h}</th>)}</tr></thead><tbody>{round&&records.slice(page*pageSize,(page+1)*pageSize).map(record=>{const cell=screeningCell([{record,round}]);return <tr key={record.id} className="border-t border-border/40" data-testid="pre-entry-current-result-row"><td className={`${libraryCell} font-mono`}>{record.sample.source.symbol}</td><td className={libraryCell}>{formatUTC8(record.sample.source.timeMs)}</td><td className={libraryCell} title={cell.detail}>{cell.plan}</td><td className={`${libraryCell} ${record.status==='matched'?'text-emerald-600':record.status==='error'?'text-destructive':''}`}>{screeningStatus[record.status]}</td><td className={`${libraryCell} max-w-96 whitespace-normal`} title={cell.detail}>{record.detail||'—'}</td><td className={libraryCell}>{formatUTC8(Math.min(record.cursor,record.endTime??record.cursor))}</td><td className={libraryCell}>{cell.at}</td></tr>;})}</tbody></table></div>
    {pages>1&&<nav aria-label="筛选结果分页" className="flex shrink-0 items-center justify-end gap-3 border-t px-4 py-2 text-xs"><span>共 {total} 项 · 第 {page+1} / {pages} 页</span><button type="button" disabled={page===0} onClick={()=>setResultPage(page-1)} className="disabled:opacity-40">上一页</button><button type="button" disabled={page+1>=pages} onClick={()=>setResultPage(page+1)} className="disabled:opacity-40">下一页</button></nav>}</DialogContent>}</Dialog>
  </>;
}
