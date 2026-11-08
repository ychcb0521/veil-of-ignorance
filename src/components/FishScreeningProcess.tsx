import {useState} from 'react';
import {ScrollText,OctagonX} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {entryProcessStageLabels,entryGuardKindLabels} from '@/lib/fish/preEntryExclusionProcess';
import type {QualityScreeningResult} from '@/lib/fish/qualityScreeningResults';
import {formatUTC8} from '@/lib/timeFormat';
const time=(at?:number)=>at&&Number.isFinite(at)?formatUTC8(at):'—';
const kinds={observation:'门槛观察','guard-rejected':'新防守线事件被否决',matched:'首次满足 · 入选',unmatched:'未入选 · 本轮结束',warming:'历史不足',error:'数据或运行异常',paused:'暂停'} as const;
export function FishScreeningProcessButton({results}:{results:readonly QualityScreeningResult[]}){
  const [open,setOpen]=useState(false);
  if(!results.length)return <span className="text-muted-foreground">—</span>;
  return <><button type="button" aria-label="排除过程" title="查看动态筛选的排除过程" className="-my-1 -ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" data-testid="screening-process-open" onClick={()=>setOpen(true)}><ScrollText aria-hidden className="h-3.5 w-3.5"/></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-3 overflow-hidden p-0" data-testid="screening-process-dialog"><DialogHeader className="border-b border-border/60 px-5 pb-3 pt-5 text-left"><DialogTitle className="font-mono text-sm">{results[0].record.sample.source.symbol}<span className="ml-2 font-sans text-xs font-normal text-muted-foreground">排除过程</span></DialogTitle><DialogDescription className="text-[11px]">连续相同门槛合并，保留起止时间、首次与末次原因和读数；历史记录按实际保存内容展示。</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-5 overflow-y-auto px-5 pb-5 text-[11px] leading-relaxed">{open&&results.map(({record:r,round})=><section key={r.id} className="space-y-3"><p className="font-medium">{round.plans?.find(p=>p.id===r.planId)?.label??'历史筛选方案'}</p><p className="text-muted-foreground">筛选起点 {time(r.startTime)} · 首次满足 {time(r.matchedAt)}</p><p className="text-muted-foreground">本轮时限 {round.hours>0?`${round.hours} 小时`:"当时未设固定时限"} · 扫描到 {time(r.cursor)}</p>
        {!r.exclusionProcess?<div className="space-y-1 text-muted-foreground"><p>这条历史记录未保存完整排除过程，以下仅列已保存摘要。</p>{r.lastVeto&&<p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 font-semibold text-destructive">{time(r.lastVeto.at)} · 最后否决：{r.lastVeto.reason}</p>}{r.missedGuard&&<p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 font-semibold text-destructive">{time(r.missedGuard.event.at)} · 被否决的新防守线事件共 {r.missedGuard.count} 次；最后原因：{r.missedGuard.reason}</p>}<p>{r.detail??'暂无过程摘要'}</p></div>:<>
          {r.exclusionProcess.partialBefore&&<p className="text-muted-foreground">{time(r.exclusionProcess.partialBefore)} 之前未保存完整过程，以下从恢复扫描处记录。</p>}
          {!r.exclusionProcess.entries.length&&<p className="text-muted-foreground">等待本条开始观察。</p>}
          {r.exclusionProcess.entries.map((e,i)=>{
            const negative=e.status==='blocked'||e.kind==='guard-rejected'||e.kind==='unmatched';
            const readingSets=[{label:'首次',rows:e.readings??[]},...(e.lastReadings?[{label:'末次',rows:e.lastReadings}]:[])];
            const unmet=readingSets.reduce((sum,set)=>sum+set.rows.filter(r=>r.met===false&&!r.pending).length,0);
            return <article key={i} className={'space-y-2 rounded-md border-l-4 p-3 '+(negative?'border-destructive bg-destructive/5 ring-1 ring-destructive/20':'border-border/60 bg-muted/20')} data-testid="screening-process-item" data-negative={negative}>
              <p className={'flex flex-wrap items-center gap-2 font-semibold '+(negative?'text-destructive':'')}>
                {negative&&<span className="inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground"><OctagonX aria-hidden className="h-3 w-3"/>{e.status==='blocked'?'否决':e.kind==='guard-rejected'?'事件未准入':'未入选'}</span>}
                {e.stage?entryProcessStageLabels[e.stage]+' · ':''}{e.status==='blocked'?'排除':e.status==='pending'?'等待':kinds[e.kind]}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">{time(e.from)}{e.through!==e.from?' ～ '+time(e.through):''} · {e.count} 次观测</p>
              <p className={negative?'font-semibold text-destructive':''}>{e.reason}</p>{e.lastReason&&e.lastReason!==e.reason&&<p className={negative?'font-semibold text-destructive':''}>末次原因：{e.lastReason}</p>}
              {e.endedAt&&<p className="text-muted-foreground">{time(e.endedAt)} · {e.nextStatus==='pass'?'该门槛解除':'转为下一项原因'}</p>}{e.event&&<p className="text-muted-foreground">防守线 {e.event.price} · 事件 {entryGuardKindLabels[e.event.kind]} · 确认 {time(e.event.at)}</p>}
              {!!(e.readings?.length||e.lastReadings?.length)&&<details open={unmet>0}><summary className={'cursor-pointer '+(unmet?'font-semibold text-destructive':'text-muted-foreground')}>观测读数{unmet>0?` · ${unmet} 项未满足`:''}</summary>{readingSets.map(({label,rows})=><div key={label} className="mt-2 space-y-1"><p className="text-muted-foreground">{label}</p>{rows.map((reading,j)=>{
                const failed=reading.met===false&&!reading.pending;
                return <p key={j} data-testid={failed?'screening-process-unmet':undefined} className={failed?'rounded border border-destructive/25 bg-destructive/10 px-2 py-1 font-semibold text-destructive':'px-2 py-1 text-muted-foreground'}>{failed&&<span className="mr-2 inline-block rounded bg-destructive px-1 text-[10px] text-destructive-foreground">未满足</span>}{reading.label??reading.id} = {reading.value??'—'}{reading.threshold!=null?`（${reading.direction??''} ${reading.threshold}）`:''} · {reading.pending??(reading.met==null?'未判定':reading.met?'满足':'未满足')}</p>;
              })}</div>)}</details>}
            </article>;
          })}
        </>}
      </section>)}</div></DialogContent></Dialog>
  </>;
}
