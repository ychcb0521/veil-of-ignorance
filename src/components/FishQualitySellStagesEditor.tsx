import {Plus,X} from 'lucide-react';
import type {ReactNode} from 'react';
import type {QualityFilterChoice} from '@/lib/fish/qualityFilters';
export interface SellStageDraft {afterAdditions:string;choice:string;direction:'<'|'>';threshold:string}
const field='h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
export function FishQualitySellStagesEditor({prefix,enabled,stages,choices,onChange,select}:{prefix:string;enabled:boolean;stages:SellStageDraft[];choices:QualityFilterChoice[];onChange:(enabled:boolean,stages:SellStageDraft[])=>void;select:(value:string,label:string,onChange:(value:string)=>void)=>ReactNode}){
 const patch=(index:number,p:Partial<SellStageDraft>)=>onChange(enabled,stages.map((s,i)=>i===index?{...s,...p}:s));
 const defaults=():SellStageDraft[]=>[6,7].map((n,i)=>({afterAdditions:String(n),choice:choices.find(c=>c.featureId===(i?'mbi':'cda'))?.key??choices[0]?.key??'',direction:'<',threshold:''}));
 return <fieldset className="flex min-w-0 flex-col gap-2 border-t border-border/40 pt-2" data-testid="quality-sell-stages-editor">
  <legend className="sr-only">{prefix} 按加仓次数切换卖出算法</legend>
  <label className="inline-flex items-center gap-1.5 text-[11px]"><input type="checkbox" aria-label={`${prefix} 启用次数切换`} checked={enabled} onChange={e=>onChange(e.target.checked,stages.length?stages:defaults())}/>按加仓次数切换卖出算法</label>
  {enabled&&<><p className="text-[10px] leading-relaxed text-muted-foreground">达到实际成交次数后替换普通卖出算法，直至下一次切换；每阶段的指标、方向和门槛独立设置。止损、一票达标卖出和镜像止盈继续生效。</p>
   {stages.map((s,i)=><fieldset key={i} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border/60 p-2"><legend className="sr-only">切换阶段 {i+1}</legend><div className="flex items-center gap-1.5 text-[11px]"><span>第</span><input className={field+' w-16'} aria-label={`${prefix} 切换 ${i+1} 加仓次数`} type="number" min="1" max="100" step="1" value={s.afterAdditions} onChange={e=>patch(i,{afterAdditions:e.target.value})}/><span>次实际加仓成交后</span><button type="button" aria-label={`${prefix} 删除切换 ${i+1}`} className="ml-auto rounded p-1 text-muted-foreground hover:text-destructive" onClick={()=>onChange(enabled,stages.filter((_,j)=>i!==j))}><X className="size-3.5"/></button></div>
    <div className="grid grid-cols-[minmax(0,1fr)_3rem_5rem] gap-1.5">{select(s.choice,`${prefix} 切换 ${i+1} 指标`,choice=>patch(i,{choice}))}<select aria-label={`${prefix} 切换 ${i+1} 方向`} className={field} value={s.direction} onChange={e=>patch(i,{direction:e.target.value as '<'|'>'})}><option value="<">&lt;</option><option value=">">&gt;</option></select><input aria-label={`${prefix} 切换 ${i+1} 门槛`} className={field+' w-full'} type="number" step="any" placeholder="填写门槛" value={s.threshold} onChange={e=>patch(i,{threshold:e.target.value})}/></div>
   </fieldset>)}
   <button type="button" className="inline-flex items-center gap-1 self-start text-[11px] text-primary" onClick={()=>onChange(enabled,[...stages,{afterAdditions:String(Math.min(100,Math.max(0,...stages.map(s=>Number(s.afterAdditions)||0))+1)),choice:choices[0]?.key??'',direction:'<',threshold:''}])}><Plus className="size-3"/>添加切换阶段</button>
   <p className="text-[10px] text-muted-foreground">未达到首次切换次数时沿用上方算法；仅实际成交计数，未触发的加仓不计入。保存后点击「开始监测」生效。</p>
  </>}
 </fieldset>;
}
