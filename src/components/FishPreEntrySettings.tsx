import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { FishQualitySellPlansEditor } from './FishQualitySellPlansEditor';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { activeStandaloneBuyFilters, type QualityBuyFilter, type QualityGroup } from '@/lib/fish/quality';
import { makeQualityBuyFilter, qualityFilterChoiceKey, qualityFilterChoices } from '@/lib/fish/qualityFilters';
import type { FishQualityState } from '@/hooks/useFishQuality';

const field = 'h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
type Confirmation = { choice: string; direction: '<' | '>'; threshold: string; enabled: boolean };
const draftsOf = (filters: QualityBuyFilter[] = []): Confirmation[] => filters.map(f => ({choice:qualityFilterChoiceKey(f),direction:f.direction,threshold:String(f.threshold),enabled:f.enabled}));

export function FishPreEntrySettings({state, selectedCount, done}: {state: FishQualityState; selectedCount: number; done:()=>void}) {
  const monitor = state.preEntry!, definitions = useFeatureDefinitions(), choices = useMemo(()=>qualityFilterChoices(definitions),[definitions]);
  const legacy = activeStandaloneBuyFilters(state.study);
  const plans: QualityGroup[] = monitor.library.settings?.plans ?? (legacy.length ? [{id:'entry-original',label:'买入方案 1',metric:legacy[0].metric,snapshot:legacy[0].snapshot,rule:{metric:legacy[0].metric,direction:legacy[0].direction,threshold:legacy[0].threshold},execution:'intrabar-1m',buyFilters:legacy.slice(1)}] : []);
  const [activeId,setActiveId] = useState<string>(), [extra,setExtra] = useState<Record<string,Confirmation[]>>({});
  const [hours,setHours] = useState(String(monitor.library.settings?.hours ?? 0));
  const forPlan = (p:QualityGroup) => extra[p.id] ?? draftsOf(p.buyFilters);
  const parse = (p:QualityGroup):QualityGroup => ({...p,buyFilters:forPlan(p).map(d=>{
    if(!d.threshold.trim())throw Error('请填写买入确认门槛');
    return makeQualityBuyFilter(d.choice,d.direction,Number(d.threshold),d.enabled,definitions);
  })});
  return <FishQualitySellPlansEditor purpose="entry" plans={plans} ready={state.ready&&monitor.ready} onSelectPlan={setActiveId}
    onCopyPlan={(source,copy)=>setExtra(old=>({...old,[copy.id]:structuredClone(forPlan(source))}))}
    prepare={next=>next.map(parse)} extraDirty={Object.keys(extra).length>0||hours!==String(monitor.library.settings?.hours??0)}
    onSave={next=>{if(!hours.trim())throw Error('请填写筛选时长');monitor.configure(next,Number(hours));}} renderHolding={view=>{
      const active=view.plans.find(p=>p.id===activeId)??view.plans[0];
      return <div className="space-y-3" data-testid="pre-entry-plan-settings">
        <p className="text-[10.5px] text-muted-foreground">筛选方案 {view.plans.length} 套 · 与上方按编号一一对应{view.dirty?' · 有待保存设置':''}</p>
        {!!view.plans.length&&<div role="tablist" aria-label="选择要设置动态筛选的买入方案" className="flex flex-wrap gap-1 rounded-md bg-muted/60 p-1 text-[10.5px]">{view.plans.map((p,i)=><button type="button" role="tab" key={p.id} aria-selected={active?.id===p.id} onClick={()=>setActiveId(p.id)} className={`inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 ${active?.id===p.id?'bg-background font-medium shadow-sm':'text-muted-foreground hover:text-foreground'}`}><span>{i+1}.</span>{p.label}<span className="rounded bg-primary/15 px-1 text-[9px] text-primary">{forPlan(p).filter(f=>f.enabled).length} 项确认</span></button>)}</div>}
        {active&&<section className="space-y-2 rounded-md border border-border/60 p-3">
          <h4 className="text-xs font-medium">② 买入确认 · {active.label}</h4>
          <p className="text-[10.5px] text-muted-foreground">启用的确认条件须与买入算法在同一分钟同时满足。只改变买入判断方向，不自动反转公式或门槛。</p>
          {forPlan(active).map((d,i)=>{
            const update=(patch:Partial<Confirmation>)=>setExtra(old=>({...old,[active.id]:forPlan(active).map((f,j)=>j===i?{...f,...patch}:f)}));
            const feature=choices.find(c=>c.key===d.choice)?.featureId;
            return <div key={i} className="flex items-center gap-1.5 rounded-md border border-border/50 p-2">
              <input type="checkbox" aria-label={`启用买入确认 ${i+1}`} checked={d.enabled} onChange={e=>update({enabled:e.target.checked})}/>
              <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2"><select aria-label={`买入确认 ${i+1} 特征值`} className={field} value={feature} onChange={e=>update({choice:choices.find(c=>c.featureId===e.target.value)!.key})}>{[...new Map(choices.map(c=>[c.featureId,c.group])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
                <select aria-label={`买入确认 ${i+1} 指标`} className={field} value={d.choice} onChange={e=>update({choice:e.target.value})}>{choices.filter(c=>c.featureId===feature).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
              <select aria-label={`买入确认 ${i+1} 方向`} className={field} value={d.direction} onChange={e=>update({direction:e.target.value as '<'|'>'})}><option value=">">&gt;</option><option value="<">&lt;</option></select>
              <input aria-label={`买入确认 ${i+1} 门槛`} type="number" step="any" className={`${field} w-20`} value={d.threshold} onChange={e=>update({threshold:e.target.value})}/>
              <button type="button" aria-label={`删除买入确认 ${i+1}`} onClick={()=>setExtra(old=>({...old,[active.id]:forPlan(active).filter((_,j)=>j!==i)}))}><X className="h-3.5 w-3.5"/></button>
            </div>;
          })}
          <button type="button" disabled={!choices.length} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted" onClick={()=>setExtra(old=>({...old,[active.id]:[...forPlan(active),{choice:choices[0].key,direction:'>',threshold:'0',enabled:true}]}))}><Plus className="h-3 w-3"/>新增买入确认</button>
        </section>}
        <label className="flex items-center gap-2 text-[11px]">筛选时长<input aria-label="筛选时长（小时）" type="number" min="0" max="8784" className={`${field} w-20`} value={hours} onChange={e=>setHours(e.target.value)}/><span className="text-muted-foreground">小时 · 0 表示至可用行情末尾</span></label>
        {view.error&&<p role="alert" className="text-[11px] text-destructive">{view.error}</p>}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5">
          <span className="mr-auto text-[10.5px] text-muted-foreground">{view.dirty?'方案尚未保存':'当前方案已保存'} · 本轮已勾选 {selectedCount} 条</span>
          <button type="button" disabled={!state.ready} className="h-7 rounded-md border border-primary/30 px-2.5 text-[11px] text-primary" onClick={()=>{if(view.save())done();}}>保存方案</button>
          <button type="button" disabled={!state.ready||!selectedCount||!view.plans.length} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40" onClick={()=>{if(view.save()){done();void monitor.restart(Number(hours));}}}>保存并开始筛选</button>
        </div>
      </div>;
    }}/>;
}
