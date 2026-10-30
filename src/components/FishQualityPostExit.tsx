import { Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import type { QualityGroup, QualityResult, QualitySample } from '@/lib/fish/quality';
import { POST_EXIT_HOURS, qualityPostExitKey, postExitValue, postExitWindow, type PostExitMetric, type QualityPostExitReading } from '@/lib/fish/qualityPostExit';
import { qualityTableRange } from '@/lib/fish/qualityTableRows';
import { formatUTC8 } from '@/lib/timeFormat';
const cell='border-t border-border/40 px-2 py-1.5';
const pct=(v:number)=>`${v>0?'+':''}${v.toFixed(2)}%`;
export type PostExitSortKey=`post-exit:${number}:${PostExitMetric}:${string}`;
export const postExitSortKey=(id:string,hours:number,metric:PostExitMetric):PostExitSortKey=>`post-exit:${hours}:${metric}:${id}`;
const formula=(metric:PostExitMetric)=>metric==='peak'?'max(0，卖后最高价 ÷ 卖出价 − 1) × 100%':'max(0，1 − 卖后最低价 ÷ 卖出价) × 100%';
export function PostExitHeaders({plan,expanded,toggle,sort,ascending,onSort}:{plan:QualityGroup;expanded:boolean;toggle:()=>void;sort:string;ascending:boolean;onSort:(key:PostExitSortKey)=>void}){
 const control=<button type="button" aria-label={`${expanded?'收起':'展开'}${plan.label}卖后反事实`} aria-expanded={expanded} onClick={toggle} className="inline-flex items-center gap-1 text-primary hover:underline">{expanded?'收起':'展开'}<ChevronDown className={`h-3 w-3 ${expanded?'rotate-180':''}`}/></button>;
 if(!expanded)return <th className="min-w-[140px] border-l border-border/50 px-2 py-1.5 font-medium" data-testid="quality-post-exit-folded" data-sell-plan={plan.id}><span className="inline-flex items-center gap-2">卖后反事实 {control}</span><span className="mt-0.5 block text-[9px] font-normal text-muted-foreground/60">5个窗口 · 10项读数</span></th>;
 return <>{POST_EXIT_HOURS.map((hours,index)=><Fragment key={hours}>{(['peak','drawdown2'] as const).map(metric=>{
  const key=postExitSortKey(plan.id,hours,metric),label=`${hours}h ${metric==='peak'?'峰值涨幅':'静态最大回撤2'}`;
  return <th key={metric} className={`min-w-[148px] px-2 py-1.5 font-medium ${metric==='peak'?'border-l border-border/40':''}`} data-testid="quality-post-exit-header" data-sell-plan={plan.id} data-hours={hours} data-metric={metric} aria-sort={sort===key?ascending?'ascending':'descending':'none'} title={`卖出后${hours}小时，以本方案实际最终卖出价为基准。${formula(metric)}。仅使用已完成窗口；盘中成交所在分钟先后不明时排除该分钟。`}>
   <span className="inline-flex items-center gap-2"><button type="button" aria-label={`按${plan.label}卖后${label}排序`} className="hover:text-foreground" onClick={()=>onSort(key)}>{label}{sort===key?ascending?' ↑':' ↓':''}</button>{index===0&&metric==='peak'&&control}</span>
  </th>;
 })}</Fragment>)}</>;
}
export interface PostExitEntry { row:QualitySample; result?:QualityResult; skipped?:boolean }
export function PostExitCells({plan,entries,expanded,readings,onExpand,now=Date.now()}:{plan:QualityGroup;entries:PostExitEntry[];expanded:boolean;readings:ReadonlyMap<string,QualityPostExitReading>;onExpand:()=>void;now?:number}){
 const values=entries.map(e=>{const key=e.skipped?null:qualityPostExitKey(e.row.source,e.result,plan);return {...e,key,reading:key?readings.get(key):undefined};});
 const closed=values.filter(v=>v.key),note=closed.some(v=>v.reading?.excludedExitMinute)?'盘中卖出所在分钟的高低点先后不明，已排除该分钟；从下一完整分钟观察。':'从卖出时刻起观察，价格基准为该方案实际最终卖出价。';
 if(!expanded){const ready=POST_EXIT_HOURS.filter(h=>closed.length&&closed.every(v=>postExitWindow(v.reading,h)?.status==='ready')).length;
  return <td className={`${cell} border-l border-border/40 text-muted-foreground`} data-testid="quality-post-exit-summary" data-sell-plan={plan.id}><button type="button" onClick={onExpand} className="text-left hover:text-primary" title={note}>{!closed.length?'—':`${ready}/5 窗口已就绪`}</button></td>;
 }
 return <>{POST_EXIT_HOURS.map(hours=><Fragment key={hours}>{(['peak','drawdown2'] as const).map(metric=>{
  const valid=closed.map(v=>postExitValue(v.reading,hours,metric)),ready=valid.filter((v):v is number=>v!=null),errors=closed.filter(v=>postExitWindow(v.reading,hours)?.status==='error');
  const waiting=closed.filter(v=>now<v.result!.endTime!+hours*3600000),text=ready.length?qualityTableRange(ready,v=>metric==='drawdown2'?pct(v).replace(/^\+/, ''):pct(v)):!closed.length?'—':waiting.length===closed.length?`待满${hours}h`:errors.length?'缺数据':'待补算';
  const detail=[`卖后${hours}小时；${formula(metric)}。`,note,closed.length?`${ready.length}/${closed.length}次卖出有完整读数。`:'尚无实际最终卖出，半仓镜像不作为本列起点。',...errors.map(v=>postExitWindow(v.reading,hours)?.error),...waiting.map(v=>`窗口完成时间 ${formatUTC8(v.result!.endTime!+hours*3600000)}`)].filter(Boolean).join(' ');
  return <td key={metric} className={`${cell} font-mono tabular-nums ${metric==='peak'?'border-l border-border/40':''} ${ready.length?metric==='peak'&&ready.some(v=>v>0)?'text-emerald-600 dark:text-emerald-400':metric==='drawdown2'&&ready.some(v=>v>0)?'text-destructive':'text-muted-foreground':'text-muted-foreground/60'}`} data-testid="quality-post-exit-value" data-sell-plan={plan.id} data-hours={hours} data-metric={metric} title={detail}>{text}{ready.length>0&&ready.length<closed.length&&<span className="ml-1 text-[9px] text-muted-foreground">({ready.length}/{closed.length})</span>}</td>;
 })}</Fragment>)}</>;
}
