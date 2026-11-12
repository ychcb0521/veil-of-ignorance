import {useState} from 'react';
import {ScrollText,OctagonX} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {entryProcessStageLabels,entryGuardKindLabels,type EntryProcessItem} from '@/lib/fish/preEntryExclusionProcess';
import {latestScreeningExclusion,latestScreeningProcessResults} from '@/lib/fish/latestScreeningExclusion';
import type {QualityScreeningResult} from '@/lib/fish/qualityScreeningResults';
import {formatUTC8} from '@/lib/timeFormat';
const time=(at?:number)=>at&&Number.isFinite(at)?formatUTC8(at):'—';
const kinds={observation:'门槛观察','guard-rejected':'新防守线事件被否决',matched:'首次满足 · 入选',unmatched:'未入选 · 本轮结束',warming:'历史不足',error:'数据或运行异常',paused:'暂停',restart:'重建起点 · 继续筛选'} as const;
function ScreeningAdmission({ item }: { item: EntryProcessItem }) {
  const {admission, event} = item;
  const at = admission?.at ?? event?.at ?? item.through;
  const readings = (item.readings ?? []).filter(reading => reading.role === 'admission' && reading.met === true &&
    reading.at === at && (admission ? admission.indicatorIds.includes(reading.id) : item.stage === 'exclusion'));
  if (!admission && !event && !readings.length) {
    return item.stage === 'exclusion' && item.status === 'blocked'
      ? <p className="text-muted-foreground">本次记录未保存准入事件明细。</p> : null;
  }
  return <article className="space-y-1 rounded-md border border-border/60 p-3" data-testid="screening-admission">
    <p className="font-medium">{admission ? '① 新事件准入' : event ? '① 防守线事件' : '① 准入时点读数'}</p>
    <p className="font-mono text-muted-foreground">{admission || event ? '确认时间' : '观测时间'} {time(at)}</p>
    {admission && <p>{admission.labels.join('、')}</p>}
    {event && <p className="text-muted-foreground">防守线 {event.price} · {entryGuardKindLabels[event.kind]}</p>}
    {readings.map(reading => <p key={reading.id} className="text-muted-foreground">
      {reading.label ?? reading.id} = {reading.value ?? '—'}{reading.threshold != null ? '（' + (reading.direction ?? '') + ' ' + reading.threshold + '）' : ''}
    </p>)}
    {!admission && readings.length > 0 && <p className="text-muted-foreground">这条历史记录保存了达标读数，未单独记录触发项。</p>}
  </article>;
}
export function FishScreeningProcessButton({results}:{results:readonly QualityScreeningResult[]}){
  const [open,setOpen]=useState(false);
  if(!results.length||results.some(({record})=>record.status!=='unmatched'))return <span className="text-muted-foreground">—</span>;
  return <><button type="button" aria-label="排除过程" title="查看动态筛选的排除过程" className="-my-1 -ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" data-testid="screening-process-open" onClick={()=>setOpen(true)}><ScrollText aria-hidden className="h-3.5 w-3.5"/></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-3 overflow-hidden p-0" data-testid="screening-process-dialog"><DialogHeader className="border-b border-border/60 px-5 pb-3 pt-5 text-left"><DialogTitle className="font-mono text-sm">{results[0].record.sample.source.symbol}<span className="ml-2 font-sans text-xs font-normal text-muted-foreground">排除过程</span></DialogTitle><DialogDescription className="text-[11px]">显示最新一轮的最后一次排除，包括当时的准入信息和否决原因。</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-5 overflow-y-auto px-5 pb-5 text-[11px] leading-relaxed">{open&&latestScreeningProcessResults(results).map(({record:r,round})=><section key={r.id} className="space-y-3"><p className="font-medium">{round.plans?.find(p=>p.id===r.planId)?.label??'历史筛选方案'}</p><p className="text-muted-foreground">筛选起点 {time(r.startTime)} · 首次满足 {time(r.matchedAt)}</p><p className="text-muted-foreground">本轮时限 {round.hours>0?`${round.hours} 小时`:"当时未设固定时限"} · 扫描到 {time(r.cursor)}</p>
        {r.signalGate&&<article className="space-y-1 rounded-md border border-border/60 p-3" data-testid="screening-signal-gate">
          <p className={r.signalGate.status==='blocked'?'font-semibold text-destructive':'font-medium'}>⓪ 信号时点必要条件 · {r.signalGate.status==='pass'?'已满足':r.signalGate.status==='blocked'?'未满足':'未判定'}</p>
          <p className="font-mono text-muted-foreground">原信号 {time(r.signalGate.signalAt)}{r.signalGate.at!==r.signalGate.signalAt&&<> · 读数截至 {time(r.signalGate.at)}</>}</p>
          {r.signalGate.reason&&<p>{r.signalGate.reason}</p>}
          {r.signalGate.readings.map(reading=><p key={reading.id} className={reading.met===false?'text-destructive':'text-muted-foreground'}>
            {reading.label??reading.id} = {reading.value??'—'}（{reading.direction} {reading.threshold}） · {reading.pending??(reading.met?'满足':'未满足')}
          </p>)}
        </article>}
        {r.trackedGate&&<p className="rounded-md border border-border/60 p-3">⓪ 动态门槛通过 · {time(r.trackedGate.at)}</p>}
        {(r.signalGate?.status!=='blocked'||round.plans?.some(plan=>plan.id===r.planId&&plan.preEntryThreeStage?.requiredPaths?.tracking))&&(!r.exclusionProcess?<div className="space-y-1 text-muted-foreground"><p>这条历史记录未保存完整排除过程，以下仅列最后一次已保存摘要。</p>{(()=>{const last=[...(r.lastVeto?[{at:r.lastVeto.at,reason:r.lastVeto.reason}]:[]),...(r.missedGuard?[{at:r.missedGuard.event.at,reason:r.missedGuard.reason}]:[])].reduce<{at:number;reason:string}|undefined>((a,e)=>!a||e.at>=a.at?e:a,undefined);return last?<p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 font-semibold text-destructive">{time(last.at)} · 最后排除：{last.reason}</p>:<p>{r.detail??'暂无排除摘要'}</p>;})()}</div>:<>
          {!latestScreeningExclusion(r.exclusionProcess).length&&<p className="text-muted-foreground">尚未记录排除原因。</p>}
          {latestScreeningExclusion(r.exclusionProcess).map((e,i)=>{
            const negative=e.status==='blocked'||e.kind==='guard-rejected'||e.kind==='unmatched';
            const readingSets=[{label:'本次',rows:e.readings??[]}];
            const unmet=readingSets.reduce((sum,set)=>sum+set.rows.filter(r=>!r.pending&&(r.role==='veto'?r.met===true:r.met===false&&r.role!=='admission')).length,0);
            const vetoHits=readingSets.reduce((sum,set)=>sum+set.rows.filter(r=>!r.pending&&r.role==='veto'&&r.met===true).length,0);
            return <div key={i} className="space-y-3"><ScreeningAdmission item={e}/><article className={'space-y-2 rounded-md border-l-4 p-3 '+(negative?'border-destructive bg-destructive/5 ring-1 ring-destructive/20':'border-border/60 bg-muted/20')} data-testid="screening-process-item" data-negative={negative}>
              <p className={'flex flex-wrap items-center gap-2 font-semibold '+(negative?'text-destructive':'')}>
                {negative&&<span className="inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground"><OctagonX aria-hidden className="h-3 w-3"/>{e.status==='blocked'?'否决':e.kind==='guard-rejected'?'事件未准入':'未入选'}</span>}
                {e.stage?(e.stage==='admission'?'① 新事件准入':entryProcessStageLabels[e.stage])+' · ':''}{e.status==='blocked'?'排除':e.status==='pending'?'等待':kinds[e.kind]}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">判定时间 {time(e.through)}</p>
              <p className={negative?'font-semibold text-destructive':''}>{e.reason}</p>{e.lastReason&&e.lastReason!==e.reason&&<p className={negative?'font-semibold text-destructive':''}>末次原因：{e.lastReason}</p>}
              {e.endedAt&&<p className="text-muted-foreground">{time(e.endedAt)} · {e.nextStatus==='pass'?'该门槛解除':'转为下一项原因'}</p>}
              {!!(e.readings?.length||e.lastReadings?.length)&&<details open={unmet>0}><summary className={'cursor-pointer '+(unmet?'font-semibold text-destructive':'text-muted-foreground')}>观测读数{vetoHits>0?` · ${vetoHits} 项触发否决`:''}{unmet>vetoHits?` · ${unmet-vetoHits} 项未满足`:''}</summary>{readingSets.map(({label,rows})=><div key={label} className="mt-2 space-y-1"><p className="text-muted-foreground">{label}</p>{rows.map((reading,j)=>{
                const failed=!reading.pending&&(reading.role==='veto'?reading.met===true:reading.met===false&&reading.role!=='admission');
                return <p key={j} data-testid={failed?'screening-process-unmet':undefined} className={failed?'rounded border border-destructive/25 bg-destructive/10 px-2 py-1 font-semibold text-destructive':'px-2 py-1 text-muted-foreground'}>{failed&&<span className="mr-2 inline-block rounded bg-destructive px-1 text-[10px] text-destructive-foreground">{reading.role==='veto'?'触发否决':'未满足'}</span>}{reading.label??reading.id} = {reading.value??'—'}{reading.threshold!=null?`（${reading.direction??''} ${reading.threshold}）`:''} · {reading.pending??(reading.met==null?'未判定':reading.role==='veto'?(reading.met?'触发否决':'未触发否决'):reading.met?'满足':reading.role==='admission'?'本路未满足（准入取或）':'未满足')}</p>;
              })}</div>)}</details>}
            </article></div>;
          })}
        </>)}
      </section>)}</div></DialogContent></Dialog>
  </>;
}
