import {useState} from 'react';
import {Plus,X} from 'lucide-react';
import {FishQualityHoldingVetoEditor} from './FishQualityHoldingVetoEditor';
import type {HoldingVetoDraft} from '@/lib/fish/qualityFilters';
export interface VetoStageDraft {afterAdditions:string;conditions:HoldingVetoDraft[]}
export interface VetoStagesDraft {enabled:boolean;mode:'overlay'|'replace';peakBasis:'holding'|'stage';stages:VetoStageDraft[]}
export const defaultVetoStageDrafts=():VetoStageDraft[]=>[20,15].map((threshold,i)=>({afterAdditions:String(i+6),conditions:[{choice:'dynamic-drawdown',direction:'>=',threshold:String(threshold),enabled:true}]}));
const field='h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
export function FishQualityVetoStagesEditor({draft,setDraft}:{draft:VetoStagesDraft;setDraft:(d:VetoStagesDraft)=>void}){
 const [selected,setSelected]=useState(0),index=Math.min(selected,Math.max(0,draft.stages.length-1)),current=draft.stages[index];
 const patch=(p:Partial<VetoStageDraft>)=>setDraft({...draft,stages:draft.stages.map((s,i)=>i===index?{...s,...p}:s)});
 return <fieldset className="flex flex-col gap-2 rounded-md border border-border/60 p-3" data-testid="quality-veto-stages-editor"><legend className="sr-only">按加仓次数切换一票卖出条件</legend>
  <label className="inline-flex items-center gap-1.5 text-xs font-medium"><input type="checkbox" aria-label="启用一票条件次数切换" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked,stages:draft.stages.length?draft.stages:defaultVetoStageDrafts()})}/>按加仓次数切换一票卖出条件</label>
  {draft.enabled&&<><label className="flex items-center gap-2 text-[11px] text-muted-foreground">条件范围<select aria-label="一票次数切换条件范围" className={field+' flex-1'} value={draft.mode} onChange={e=>setDraft({...draft,mode:e.target.value as VetoStagesDraft['mode']})}><option value="overlay">只替换同类条件，其他条件保留</option><option value="replace">每阶段完整设置全部一票条件</option></select></label>
   <label className="flex items-center gap-2 text-[11px] text-muted-foreground">回撤峰值<select aria-label="一票次数切换峰值口径" className={field+' flex-1'} value={draft.peakBasis} onChange={e=>setDraft({...draft,peakBasis:e.target.value as VetoStagesDraft['peakBasis']})}><option value="holding">沿用持仓最高价，只检查切换后的回撤</option><option value="stage">从本次加仓成交价重新记录阶段峰值</option></select></label>
   <div role="tablist" aria-label="选择一票条件切换阶段" className="flex flex-wrap gap-1">{draft.stages.map((s,i)=><button key={i} type="button" role="tab" aria-selected={index===i} className={`rounded px-2 py-1 text-[11px] ${index===i?'bg-primary/15 text-primary':'bg-muted/40 text-muted-foreground'}`} onClick={()=>setSelected(i)}>第 {s.afterAdditions||'…'} 次后</button>)}</div>
   {current&&<fieldset className="flex min-w-0 flex-col gap-2 rounded border border-border/60 p-2"><legend className="sr-only">一票条件阶段 {index+1}</legend><div className="flex items-center gap-2 text-[11px]"><span>第</span><input aria-label="一票条件切换加仓次数" type="number" min="1" max="100" step="1" className={field+' w-16'} value={current.afterAdditions} onChange={e=>patch({afterAdditions:e.target.value})}/><span>次实际加仓成交后</span><button type="button" aria-label="删除当前一票切换阶段" className="ml-auto p-1 text-muted-foreground hover:text-destructive" onClick={()=>{setSelected(Math.max(0,index-1));setDraft({...draft,stages:draft.stages.filter((_,i)=>i!==index)});}}><X className="size-3.5"/></button></div>
    <FishQualityHoldingVetoEditor compact labelPrefix={`一票切换 ${index+1} `} draft={current.conditions} setDraft={conditions=>patch({conditions})}/>
   </fieldset>}
   <button type="button" className="inline-flex items-center gap-1 self-start text-[11px] text-primary" onClick={()=>{setSelected(draft.stages.length);setDraft({...draft,stages:[...draft.stages,{afterAdditions:String(Math.min(100,Math.max(0,...draft.stages.map(s=>Number(s.afterAdditions)||0))+1)),conditions:structuredClone(current?.conditions??defaultVetoStageDrafts()[0].conditions)}]});}}><Plus className="size-3"/>添加一票切换阶段</button>
   <p className="text-[10px] leading-relaxed text-muted-foreground">未到首次切换次数时使用上方原条件。切换只认实际加仓成交，不追溯切换前的回撤；加仓支撑线 K 始终有效。保存后点击「开始监测」生效。</p>
  </>}
 </fieldset>;
}
