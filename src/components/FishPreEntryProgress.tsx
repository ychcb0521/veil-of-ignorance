import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {libraryCell} from './FishLibraryDialog';
import {formatUTC8} from '@/lib/timeFormat';
import {preEntryRecordPending} from '@/lib/fish/preEntryMonitor';
import {screeningCell,screeningStatus} from '@/lib/fish/qualityScreeningResults';
import type {FishQualityState} from '@/hooks/useFishQuality';

/** Live observations and all outcomes remain visible independently of the selected source directory. */
export function FishPreEntryProgress({monitor}:{monitor:NonNullable<FishQualityState['preEntry']>}){
  const [open,setOpen]=useState(false);
  const ordered=[...monitor.library.rounds].sort((a,b)=>b.startedAt-a.startedAt);
  const round=(monitor.running?ordered.find(r=>r.state==='running'):undefined)??ordered[0];
  const records=monitor.library.records.filter(r=>r.roundId===round?.id);
  const total=records.length,done=records.filter(r=>!preEntryRecordPending(r)).length;
  const count=(status:string)=>records.filter(r=>r.status===status).length;
  const scanning=records.find(r=>r.status==='scanning');
  const current=monitor.running?(monitor.progress?.current||scanning?.sample.source.symbol||'准备筛选…'):'';
  const label=!monitor.ready?'正在读取筛选库…':monitor.running?'筛选中':round?.state==='paused'?'已暂停':round?.state==='complete'?'已完成':round?'待继续':'尚未开始';
  return <>
    <div className="ml-1 inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[10px] text-muted-foreground" data-testid="pre-entry-progress">
      <span role="status"><button type="button" className="inline-flex items-center gap-2 hover:text-foreground" aria-label={monitor.error?'查看筛选错误':'查看本轮筛选结果'} title="点击查看本轮筛选结果" onClick={()=>setOpen(true)}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${monitor.error?'bg-destructive':monitor.running?'animate-pulse bg-primary':'bg-muted-foreground/40'}`} aria-hidden/>
        <span>{monitor.error?'筛选异常':label}</span>{round&&<span className="font-mono tabular-nums">{done} / {total}</span>}
      </button></span>
      {monitor.running&&total>0&&<span role="progressbar" aria-label="动态筛选处理进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`已处理 ${done} / ${total} 项信号与方案`} className="h-1 w-20 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary/60" style={{width:`${done/total*100}%`}}/></span>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0" data-testid="pre-entry-current-results"><DialogHeader className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5 text-left"><DialogTitle className="pr-8 text-base">动态筛选 · 本轮结果</DialogTitle><DialogDescription className="text-[11px]">{round?formatUTC8(round.startedAt):'暂无轮次'} · {label} · 已处理 {done} / {total} 项信号与方案</DialogDescription></DialogHeader>
      <div className="overflow-auto p-4"><div className="mb-3 space-y-1 text-[11px] text-muted-foreground"><p>入选 {count('matched')} · 未入选 {count('unmatched')} · 历史不足 {count('warming')} · 缺数据 {count('error')}</p>{current&&<p>{current}</p>}{monitor.running&&scanning&&<p>扫描到 {formatUTC8(Math.min(scanning.cursor,scanning.endTime??scanning.cursor))} · {scanning.detail}</p>}{monitor.error&&<p role="alert" className="text-destructive">{monitor.error}{!monitor.ready&&<button type="button" className="ml-1 underline" onClick={monitor.retry}>重试读取</button>}</p>}</div><table className="w-full text-[11px]"><thead><tr>{['标的','原信号时间','筛选方案','筛选状态','状态与原因','扫描到','首次满足时间'].map(h=><th key={h} className={libraryCell}>{h}</th>)}</tr></thead><tbody>{round&&records.map(record=>{const cell=screeningCell([{record,round}]);return <tr key={record.id} className="border-t border-border/40" data-testid="pre-entry-current-result-row"><td className={`${libraryCell} font-mono`}>{record.sample.source.symbol}</td><td className={libraryCell}>{formatUTC8(record.sample.source.timeMs)}</td><td className={libraryCell} title={cell.detail}>{cell.plan}</td><td className={`${libraryCell} ${record.status==='matched'?'text-emerald-600':record.status==='error'?'text-destructive':''}`}>{screeningStatus[record.status]}</td><td className={`${libraryCell} max-w-96 whitespace-normal`} title={cell.detail}>{record.detail||'—'}</td><td className={libraryCell}>{formatUTC8(Math.min(record.cursor,record.endTime??record.cursor))}</td><td className={libraryCell}>{cell.at}</td></tr>;})}</tbody></table></div>
    </DialogContent></Dialog>
  </>;
}
