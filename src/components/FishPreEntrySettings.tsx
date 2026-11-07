import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { FishQualitySellPlansEditor } from './FishQualitySellPlansEditor';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { activeStandaloneBuyFilters, type QualityBuyFilter, type QualityGroup } from '@/lib/fish/quality';
import { makeQualityBuyFilter, qualityFilterChoiceKey, qualityFilterChoices } from '@/lib/fish/qualityFilters';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { FishQualityEntryVetoEditor } from './FishQualityEntryVetoEditor';
import { vetoDraftOf, parseAdditionVetoDraft, type AdditionVetoDraft } from '@/lib/fish/qualityEntryVetoDraft';
import { FishQualityHoldingVetoEditor } from './FishQualityHoldingVetoEditor';
import { holdingVetoDraft, parseHoldingVetoDraft, type HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { emptyPreEntryConditions, validatePreEntryConditions } from '@/lib/fish/preEntryConditions';
import { PlanVersionList } from './FishQualityPlanVersions';

const field = 'h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
type Confirmation = { choice: string; direction: '<' | '>'; threshold: string; enabled: boolean };
const draftsOf = (filters: QualityBuyFilter[] = []): Confirmation[] => filters.map(f => ({choice:qualityFilterChoiceKey(f),direction:f.direction,threshold:String(f.threshold),enabled:f.enabled}));
type ExclusionDraft = { entry: AdditionVetoDraft; sell: HoldingVetoDraft[]; hard: HoldingVetoDraft[] };
const exclusionsOf = (p:QualityGroup):ExclusionDraft => ({entry:vetoDraftOf(p.preEntryConditions?.entryVetoes),sell:holdingVetoDraft(p.preEntryConditions?.sellVetoes),hard:holdingVetoDraft(p.preEntryConditions?.hardVetoes)});

export function FishPreEntrySettings({state, selectedCount, done}: {state: FishQualityState; selectedCount: number; done:()=>void}) {
  const monitor = state.preEntry!, definitions = useFeatureDefinitions(), choices = useMemo(()=>qualityFilterChoices(definitions),[definitions]);
  const legacy = activeStandaloneBuyFilters(state.study);
  const plans: QualityGroup[] = monitor.library.settings?.plans ?? (legacy.length ? [{id:'entry-original',label:'买入方案 1',metric:legacy[0].metric,snapshot:legacy[0].snapshot,rule:{metric:legacy[0].metric,direction:legacy[0].direction,threshold:legacy[0].threshold},execution:'intrabar-1m',buyFilters:legacy.slice(1)}] : []);
  const [activeId,setActiveId] = useState<string>(), [extra,setExtra] = useState<Record<string,Confirmation[]>>({});
  const [exclusions,setExclusions] = useState<Record<string,ExclusionDraft>>({});
  const [hours,setHours] = useState(String(monitor.library.settings?.hours ?? 0));
  const forPlan = (p:QualityGroup) => extra[p.id] ?? draftsOf(p.buyFilters);
  const forExclusions = (p:QualityGroup) => exclusions[p.id] ?? exclusionsOf(p);
  const parse = (p:QualityGroup):QualityGroup => {
    const draft=forExclusions(p), original=exclusionsOf(p), saved=p.preEntryConditions??emptyPreEntryConditions();
    const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
    const conditions={...saved,entryVetoes:same(draft.entry,original.entry)?saved.entryVetoes:parseAdditionVetoDraft(draft.entry),
      sellVetoes:same(draft.sell,original.sell)?saved.sellVetoes:parseHoldingVetoDraft(draft.sell),hardVetoes:same(draft.hard,original.hard)?saved.hardVetoes:parseHoldingVetoDraft(draft.hard)};
    validatePreEntryConditions(conditions);
    return {...p,preEntryConditions:conditions,buyFilters:extra[p.id]&&!same(extra[p.id],draftsOf(p.buyFilters))?forPlan(p).map(d=>{
    if(!d.threshold.trim())throw Error('请填写买入确认门槛');
    return makeQualityBuyFilter(d.choice,d.direction,Number(d.threshold),d.enabled,definitions);
  }):p.buyFilters};};
  return <FishQualitySellPlansEditor purpose="entry" plans={plans} ready={state.ready&&monitor.ready} onSelectPlan={setActiveId}
    onCopyPlan={(source,copy)=>{setExtra(old=>({...old,[copy.id]:structuredClone(forPlan(source))}));setExclusions(old=>({...old,[copy.id]:structuredClone(forExclusions(source))}));}}
    prepare={next=>next.map(parse)} extraDirty={Object.keys(extra).length>0||Object.keys(exclusions).length>0||hours!==String(monitor.library.settings?.hours??0)}
    onSave={next=>{if(!hours.trim())throw Error('请填写筛选时长');monitor.configure(next,Number(hours));}} renderHolding={view=>{
      const active=view.plans.find(p=>p.id===activeId)??view.plans[0];
      return <div className="space-y-3" data-testid="pre-entry-plan-settings">
        <p className="text-[10.5px] text-muted-foreground">入选算法与确认条件同分钟全部满足，并且下面三组没有任何否决，才进入入选库。图灵杯零成交等待读数恢复；缺 K 线或必需读数仍停止。旧轮次沿用原规则。</p>
        <p className="text-[10.5px] text-muted-foreground">筛选方案 {view.plans.length} 套 · 与上方按编号一一对应{view.dirty?' · 有待保存设置':''}</p>
        {!!view.plans.length&&<div role="tablist" aria-label="选择要设置动态筛选的买入方案" className="flex flex-wrap gap-1 rounded-md bg-muted/60 p-1 text-[10.5px]">{view.plans.map((p,i)=><button type="button" role="tab" key={p.id} aria-selected={active?.id===p.id} onClick={()=>setActiveId(p.id)} className={`inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 ${active?.id===p.id?'bg-background font-medium shadow-sm':'text-muted-foreground hover:text-foreground'}`}><span>{i+1}.</span>{p.label}<span className="rounded bg-primary/15 px-1 text-[9px] text-primary">{forPlan(p).filter(f=>f.enabled).length} 项确认 · {Object.values(forExclusions(p).entry).filter(f=>f.enabled).length + forExclusions(p).sell.filter(f=>f.enabled).length + forExclusions(p).hard.filter(f=>f.enabled).length} 项否决</span></button>)}</div>}
        {active&&<section className="space-y-2 rounded-md border border-border/60 p-3">
          <h4 className="text-xs font-medium">① 入选确认 · {active.label}</h4>
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
        {active&&<div className="space-y-3" data-testid="pre-entry-exclusions">
          <section className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="pre-entry-before-veto">
            <h4 className="text-xs font-medium">② 入选前一票否决</h4>
            <p className="text-[10.5px] text-muted-foreground">沿用加仓前否决的条件、参数和已收盘 5 分钟判断方式。任一成立，本分钟不入选，继续观察。急跌和峰值从筛选起点累计；曾出现急跌的记录本轮持续否决；勾选“未收复”时等 5 分钟收盘收复当时峰值。</p>
            <FishQualityEntryVetoEditor entry draft={forExclusions(active).entry} setDraft={entry=>setExclusions(old=>({...old,[active.id]:{...forExclusions(active),entry}}))}/>
          </section>
          {(['sell','hard'] as const).map(section=><section key={section} className={`space-y-2 rounded-lg border p-3 ${section==='hard'?'border-destructive/20 bg-destructive/[0.02]':'border-border/60'}`} data-testid={`pre-entry-${section}-veto`}>
            <h4 className="text-xs font-medium">{section==='sell'?'③ 卖出条件排除':'④ 硬性终止排除'}</h4>
            <p className="text-[10.5px] text-muted-foreground">{section==='sell'?'沿用卖出里的指标、跌幅与箱体条件；任一触发就不入选。':'与上面两组并列，任一触发就不入选；不等待普通入选算法。'}这里不执行卖出，也不模拟加仓。</p>
            <FishQualityHoldingVetoEditor entry compact labelPrefix={section==='sell'?'筛选卖出排除 ':'筛选硬性终止 '} draft={forExclusions(active)[section]} setDraft={draft=>setExclusions(old=>({...old,[active.id]:{...forExclusions(active),[section]:draft}}))}/>
          </section>)}
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">静态回撤以筛选起点分钟开盘价为基准；动态回撤累计筛选期间峰值到后续低点的最大跌幅，两者一旦达到阈值，本轮持续否决。1 / 5 分钟跌幅按已收盘分钟滚动，回落恢复后可重新入选。箱体参数、K 线及红叉判断沿用原版，只使用截至当前时点可见的行情。</p>
          <p className="text-[10.5px] text-muted-foreground">半仓镜像、实际加仓次数、几何仓位、盈亏比止盈和保本底线 F 依赖成交持仓，不适用于买前筛选；对应持仓选项不启用，不虚构持仓数据。</p>
          {active.preEntryConditions&&<details className="text-[11px]"><summary className="cursor-pointer">已保存方案的算法版本</summary><PlanVersionList plan={active}/></details>}
        </div>}
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
