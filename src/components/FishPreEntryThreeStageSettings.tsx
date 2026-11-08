import { useMemo, useState } from 'react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import type { QualityGroup } from '@/lib/fish/quality';
import { makeQualityBuyFilter, qualityFilterChoiceKey, qualityFilterChoices, holdingVetoDraft, parseHoldingVetoDraft, type HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { emptyPreEntryThreeStage, entryCondition, preEntryPlanFilters, validatePreEntryThreeStage, copyAdditionMarketConditions, copyOrdinaryMarketSeller, type EntryMarketCondition, type EntryMarketExpression, type EntrySellRule } from '@/lib/fish/preEntryThreeStage';
import { vetoDraftOf, parseAdditionVetoDraft, type AdditionVetoDraft } from '@/lib/fish/qualityEntryVetoDraft';
import { FishQualityEntryVetoEditor } from './FishQualityEntryVetoEditor';
import { FishQualityHoldingVetoEditor } from './FishQualityHoldingVetoEditor';
import { FishQualityBoxStopEditor } from './FishQualityBoxStopEditor';
import { PlanVersionList } from './FishQualityPlanVersions';
import { planVersionChanges } from '@/lib/fish/qualityPlanVersions';

const field='h-7 min-w-0 rounded border border-border/60 bg-muted/40 px-2 text-[11px]';
const button='rounded border border-border/60 px-2 py-1 text-[11px] disabled:opacity-40';
const id=()=>crypto.randomUUID();
function copyAsThreeStage(p:QualityGroup):QualityGroup {
  if(p.preEntryThreeStage)return structuredClone(p);
  const c=emptyPreEntryThreeStage();
  c.required=preEntryPlanFilters(p).map(f=>entryCondition({...f,id:id()}));
  c.additionVetoes=structuredClone(p.preEntryConditions?.entryVetoes??[]);
  for(const v of p.preEntryConditions?.sellVetoes??[]){
    if(v.kind==='indicator')c.sellRules.push({id:id(),label:v.label,enabled:v.enabled,expression:{condition:{id:id(),label:v.label,metric:v.metric!,snapshot:structuredClone(v.snapshot!),direction:v.direction,threshold:v.threshold,enabled:true,timing:'intrabar'}},confirmation:{samples:1,minutes:1}});
    else c.hardVetoes.push({...structuredClone(v),id:id()});
  }
  c.hardVetoes.push(...(p.preEntryConditions?.hardVetoes??[]).map(v=>({...structuredClone(v),id:id()})));
  return {id:id(),label:p.label+' · 三阶副本',metric:p.metric,snapshot:structuredClone(p.snapshot),execution:'intrabar-1m',initialization:p.initialization,preEntryThreeStage:c};
}
export function FishPreEntryThreeStageSettings({state,selectedCount,done}:{state:FishQualityState;selectedCount:number;done:()=>void}){
  const monitor=state.preEntry!,definitions=useFeatureDefinitions(),choices=useMemo(()=>qualityFilterChoices(definitions),[definitions]);
  const [plans,setPlans]=useState<QualityGroup[]>(()=> (monitor.library.settings?.plans??[]).map(copyAsThreeStage));
  const [activeId,setActiveId]=useState(plans[0]?.id),[hours,setHours]=useState(String(monitor.library.settings?.hours??0)),[error,setError]=useState('');
  const [vetoDrafts,setVetoDrafts]=useState<Record<string,AdditionVetoDraft>>({}),[hardDrafts,setHardDrafts]=useState<Record<string,HoldingVetoDraft[]>>({});
  const [sourceId,setSourceId]=useState(''),[roundIndex,setRoundIndex]=useState('0');
  const active=plans.find(p=>p.id===activeId)??plans[0],c=active?.preEntryThreeStage;
  const sources=state.study.sellPlans??[],source=sources.find(p=>p.id===sourceId),rounds=source?.addition?.rounds?.length?source.addition.rounds:source?.addition?[source.addition]:[];
  const patch=(p:Partial<NonNullable<typeof c>>)=>setPlans(old=>old.map(plan=>plan.id===active?.id?{...plan,preEntryThreeStage:{...plan.preEntryThreeStage!,...p}}:plan));
  const newCondition=():EntryMarketCondition=>entryCondition({...makeQualityBuyFilter(choices[0].key,'>',0,true,definitions),id:id()});
  const guardAction=(action:()=>void)=>{try{action();setError('');}catch(e){setError(e instanceof Error?e.message:'设置无效');}};
  const save=(start:boolean)=>guardAction(()=>{
    if(!hours.trim()||!Number.isFinite(Number(hours))||Number(hours)<0||Number(hours)>8784)throw Error('筛选时长须为 0～8784 小时');
    if(!plans.length)throw Error('请先新增三阶方案');
    const next=plans.map(p=>{
      const current=p.preEntryThreeStage!;
      const config={...current,additionVetoes:vetoDrafts[p.id]?parseAdditionVetoDraft(vetoDrafts[p.id]):current.additionVetoes,hardVetoes:hardDrafts[p.id]?parseHoldingVetoDraft(hardDrafts[p.id]):current.hardVetoes};
      if(!p.label.trim())throw Error('请填写方案名称');
      validatePreEntryThreeStage(config);return {...p,preEntryThreeStage:config};
    });
    monitor.configure(next,Number(hours));done();if(start)void monitor.restart(Number(hours));
  });
  const conditionEditor=(condition:EntryMarketCondition,put:(c:EntryMarketCondition)=>void,remove:()=>void,prefix:string)=><div className="flex flex-wrap items-center gap-1.5 rounded border border-border/50 p-2">
    <input type="checkbox" aria-label={prefix+'启用'} checked={condition.enabled} onChange={e=>put({...condition,enabled:e.target.checked})}/>
    <select className={field+' max-w-full flex-1'} aria-label={prefix+'指标'} value={qualityFilterChoiceKey({...condition,direction:'>'})} onChange={e=>put({...entryCondition({...makeQualityBuyFilter(e.target.value,'>',condition.threshold,condition.enabled,definitions),id:condition.id},condition.timing),direction:condition.direction})}>
      {!choices.some(choice=>choice.key===qualityFilterChoiceKey({...condition,direction:'>'}))&&<option value={qualityFilterChoiceKey({...condition,direction:'>'})}>{condition.label}（保存的公式）</option>}
      {choices.map(choice=><option key={choice.key} value={choice.key}>{choice.group} · {choice.label}</option>)}
    </select>
    <select className={field} aria-label={prefix+'方向'} value={condition.direction} onChange={e=>put({...condition,direction:e.target.value as EntryMarketCondition['direction']})}>{['>','>=','<','<='].map(v=><option key={v}>{v}</option>)}</select>
    <input className={field+' w-20'} aria-label={prefix+'门槛'} type="number" step="any" value={Number.isFinite(condition.threshold)?condition.threshold:''} onChange={e=>put({...condition,threshold:e.target.value.trim()?Number(e.target.value):NaN})}/>
    <select className={field} aria-label={prefix+'时点'} value={condition.timing} onChange={e=>put({...condition,timing:e.target.value as EntryMarketCondition['timing']})}><option value="intrabar">逐分钟复原</option><option value="closed">只读已收盘原周期</option></select>
    <button type="button" className={button} aria-label={prefix+'删除'} onClick={remove}>删除</button>
  </div>;
  const expressionEditor=(expression:EntryMarketExpression,put:(e:EntryMarketExpression)=>void,prefix:string,depth=0):React.ReactNode=>{
    if('condition' in expression)return conditionEditor(expression.condition,condition=>put({condition}),()=>put({join:'all',children:[]}),prefix);
    return <div className="space-y-2 rounded border border-border/50 p-2">
      <label className="text-[11px]">组内关系 <select aria-label={prefix+'组合关系'} className={field} value={expression.join} onChange={e=>put({...expression,join:e.target.value as 'all'|'any'})}><option value="all">全部满足（且）</option><option value="any">任一满足（或）</option></select></label>
      {expression.children.map((child,index)=><div key={index} className="space-y-1">{expressionEditor(child,value=>put({...expression,children:expression.children.map((old,i)=>i===index?value:old)}),prefix+(index+1)+' ',depth+1)}{expression.children.length>1&&<button type="button" className={button} onClick={()=>put({...expression,children:expression.children.filter((_,i)=>i!==index)})}>移除此子条件／组</button>}</div>)}
      <div className="flex gap-2"><button type="button" className={button} disabled={!choices.length} onClick={()=>put({...expression,children:[...expression.children,{condition:newCondition()}]})}>添加子条件</button>{depth<8&&<button type="button" className={button} disabled={!choices.length} onClick={()=>put({...expression,children:[...expression.children,{join:'any',children:[{condition:newCondition()}]}]})}>添加且／或子组</button>}</div>
    </div>;
  };
  return <div className="space-y-3" data-testid="pre-entry-three-stage-settings">
    <div className="flex items-center justify-between"><p className="text-xs font-medium">动态筛选 · 三阶准入</p></div>
    <div className="flex flex-wrap gap-2">{plans.map((p,i)=><button type="button" className={button+(active?.id===p.id?' bg-primary/10 text-primary':'')} key={p.id} onClick={()=>setActiveId(p.id)}>{i+1}. {p.label}</button>)}
      <button type="button" className={button} disabled={!choices.length} onClick={()=>{const p=makeQualitySellPlan(choices[0].key,'>',0,definitions);p.label='三阶筛选 '+(plans.length+1);p.preEntryThreeStage=emptyPreEntryThreeStage();setPlans([...plans,p]);setActiveId(p.id);}}>新增三阶方案</button>
      {active&&<><button type="button" className={button} onClick={()=>{const p={...structuredClone(active),id:id(),label:active.label+' 副本'};setPlans([...plans,p]);if(vetoDrafts[active.id])setVetoDrafts({...vetoDrafts,[p.id]:structuredClone(vetoDrafts[active.id])});if(hardDrafts[active.id])setHardDrafts({...hardDrafts,[p.id]:structuredClone(hardDrafts[active.id])});setActiveId(p.id);}}>复制整套三阶方案</button><button type="button" className={button} onClick={()=>{setPlans(plans.filter(p=>p.id!==active.id));setActiveId(undefined);}}>删除当前副本</button></>}
    </div>
    {active&&c&&<>
      <input className={field+' w-full'} aria-label="三阶方案名称" value={active.label} onChange={e=>setPlans(plans.map(p=>p.id===active.id?{...p,label:e.target.value}:p))}/>
      <details className="rounded border border-border/50 p-2 text-[11px]"><summary className="cursor-pointer">从持仓方案复制市场条件</summary>
        <div className="mt-2 flex flex-wrap gap-2"><select aria-label="复制条件来源方案" className={field} value={sourceId} onChange={e=>{setSourceId(e.target.value);setRoundIndex('0');}}><option value="">选择明确的来源方案</option>{sources.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
          <select aria-label="复制加仓轮次" className={field} value={roundIndex} onChange={e=>setRoundIndex(e.target.value)}>{rounds.map((_,i)=><option key={i} value={i}>第 {i+1} 次加仓 · 主分支</option>)}</select>
          <button type="button" className={button} disabled={!rounds.length} onClick={()=>guardAction(()=>{if(planVersionChanges(source!).length)throw Error('来源方案版本不符，不能复制');const copied=copyAdditionMarketConditions(rounds[Number(roundIndex)]);const existing=vetoDrafts[active.id]?parseAdditionVetoDraft(vetoDrafts[active.id]):c.additionVetoes;if(existing.some(v=>v.enabled))throw Error('当前已配置加仓共用否决，请使用新副本复制以免覆盖');patch({required:[...c.required,...copied.required],additionVetoes:copied.additionVetoes,detectors:[...(c.detectors??[]),...copied.detectors],additionSource:{planId:source!.id,label:source!.label,round:Number(roundIndex)+1,versions:structuredClone(source!.frozenVersions)}});setVetoDrafts(old=>{const next={...old};delete next[active.id];return next;});})}>复制该轮必要条件与否决</button>
          <button type="button" className={button} disabled={!source} onClick={()=>guardAction(()=>{if(planVersionChanges(source!).length)throw Error('来源方案版本不符，不能复制');const rule=copyOrdinaryMarketSeller(source!);patch({sellRules:[...c.sellRules,rule]});})}>复制完整普通卖出规则</button>
        </div><p className="mt-2 text-muted-foreground">仅复制所选轮次的市场条件；原探测算法按每条原信号的冻结公式和门槛判断。实际成本、分段持仓及动态退出确认不能直接转换。来源配置和旧模板保持原样。</p>
      </details>
      <section className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="three-stage-zero">
        <h4 className="text-xs font-medium">⓪ 必要条件</h4><p className="text-[11px] text-muted-foreground">全部满足才继续看后面的阶；这里只判断指标与探测门槛，不含任何否决。</p>
        <p className="text-[11px] font-medium">必要条件（全部满足）</p>
        {c.required.map((f,i)=><div key={f.id}>{conditionEditor(f,value=>patch({required:c.required.map((old,j)=>j===i?value:old)}),()=>patch({required:c.required.filter((_,j)=>j!==i)}),'必要条件 '+(i+1)+' ')}</div>)}
        {!c.required.length&&<p className="text-[11px] text-muted-foreground">未设置额外指标门槛；仍须通过防守线事件与排除门槛。</p>}
        <button type="button" className={button} disabled={!choices.length} onClick={()=>patch({required:[...c.required,newCondition()]})}>添加必要条件</button>
        {(c.detectors??[]).map((d,index)=><div key={d.id} className="flex flex-wrap items-center gap-2 text-[11px]"><span>原信号探测门槛提高</span><input aria-label={'原探测 '+(index+1)+' 提高幅度'} className={field+' w-16'} type="number" min="0" step="any" value={Number.isFinite(d.stricterPct)?d.stricterPct:''} onChange={e=>patch({detectors:c.detectors!.map((item,i)=>i===index?{...item,stricterPct:e.target.value.trim()?Number(e.target.value):NaN}:item)})}/><span>%</span><select aria-label={'原探测 '+(index+1)+' 关系'} className={field} value={d.match} onChange={e=>patch({detectors:c.detectors!.map((item,i)=>i===index?{...item,match:e.target.value as 'all'|'any'}:item)})}><option value="all">全部原探测同时满足</option><option value="any">任一原探测满足</option></select><select aria-label={'原探测 '+(index+1)+' 算法'} className={field} value={d.featureId??''} onChange={e=>patch({detectors:c.detectors!.map((item,i)=>i===index?{...item,featureId:e.target.value||undefined}:item)})}><option value="">本条信号的全部原探测</option>{definitions.map(def=><option value={def.id} key={def.id}>{def.name}</option>)}</select><button type="button" className={button} onClick={()=>patch({detectors:c.detectors!.filter((_,i)=>i!==index)})}>删除探测条件</button></div>)}
        <button type="button" className={button} onClick={()=>patch({detectors:[...(c.detectors??[]),{id:id(),stricterPct:0,match:'all'}]})}>添加原探测门槛条件</button>
        {c.additionSource&&<p className="text-[10px] text-muted-foreground">复制来源：{c.additionSource.label} · 第 {c.additionSource.round} 次加仓主分支；必要条件只读已收盘原周期。</p>}
      </section>
      <section className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="three-stage-first">
        <h4 className="text-xs font-medium">① 防守线新事件准入</h4><p className="text-[11px]">原生防守线首次产生、断裂后重建、价格上移或下移、实虚切换均算新事件。同价同型延续及仅换箱体编号不算。</p>
        <FishQualityBoxStopEditor entry admission disabled={false} prefix="三阶准入 " definitions={definitions} rule={c.guard.rule} onChange={rule=>patch({guard:{...c.guard,rule}})}/>
        <p className="text-[11px] text-muted-foreground">只读已收盘 5 分钟结构；新事件发生的同一时点，⓪ 与 ② 必须同时通过。被否决的事件不延期兑现，新线不清除历史锁定。</p>
      </section>
      <section className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="three-stage-second">
        <h4 className="text-xs font-medium">② 排除门槛</h4><p className="text-[11px] text-muted-foreground">加仓共用否决、任一完整普通卖出规则、任一硬性终止，三者任一成立即排除。硬性终止不等待普通卖出确认。</p>
        <p className="text-[11px] font-medium">加仓共用一票否决（任一成立即排除）</p>
        <FishQualityEntryVetoEditor entry allowDoubleDrop draft={vetoDrafts[active.id]??vetoDraftOf(c.additionVetoes)} setDraft={draft=>setVetoDrafts({...vetoDrafts,[active.id]:draft})}/>
        {c.sellRules.map((rule,i)=>{
          const put=(p:Partial<EntrySellRule>)=>patch({sellRules:c.sellRules.map((r,j)=>j===i?{...r,...p}:r)});
          return <div className="space-y-2 rounded border border-border/60 p-2" key={rule.id}>
            <div className="flex flex-wrap items-center gap-2"><input aria-label={'启用完整卖出 '+(i+1)} type="checkbox" checked={rule.enabled} onChange={e=>put({enabled:e.target.checked})}/><input aria-label={'完整卖出 '+(i+1)+' 名称'} className={field} value={rule.label} onChange={e=>put({label:e.target.value})}/><span className="text-[11px]">连续</span><input aria-label={'完整卖出 '+(i+1)+' 确认次数'} className={field+' w-14'} type="number" min="1" max="100" value={Number.isFinite(rule.confirmation.samples)?rule.confirmation.samples:''} onChange={e=>put({confirmation:{...rule.confirmation,samples:e.target.value.trim()?Number(e.target.value):NaN}})}/><span className="text-[11px]">次，每</span><input aria-label={'完整卖出 '+(i+1)+' 确认周期'} className={field+' w-14'} type="number" min="1" max="10080" value={Number.isFinite(rule.confirmation.minutes)?rule.confirmation.minutes:''} onChange={e=>put({confirmation:{...rule.confirmation,minutes:e.target.value.trim()?Number(e.target.value):NaN}})}/><span className="text-[11px]">分钟确认</span><button type="button" className={button} onClick={()=>patch({sellRules:c.sellRules.filter((_,j)=>j!==i)})}>删除卖出规则</button></div>
            {expressionEditor(rule.expression,expression=>put({expression}),'卖出 '+(i+1)+' ')}
            {rule.source&&<p className="text-[10px] text-muted-foreground">复制来源：{rule.source.label}；保留公式快照与原确认时点。</p>}
          </div>;
        })}
        <button type="button" className={button} disabled={!choices.length} onClick={()=>patch({sellRules:[...c.sellRules,{id:id(),label:'普通卖出 '+(c.sellRules.length+1),enabled:true,expression:{join:'all',children:[{condition:newCondition()}]},confirmation:{samples:1,minutes:1}}]})}>添加完整卖出规则</button>
        <p className="text-[11px] font-medium">硬性终止</p><FishQualityHoldingVetoEditor entry compact labelPrefix="三阶硬性终止 " draft={hardDrafts[active.id]??holdingVetoDraft(c.hardVetoes)} setDraft={draft=>setHardDrafts({...hardDrafts,[active.id]:draft})}/>
      </section>
      <details className="text-[11px]"><summary className="cursor-pointer">观察基准与适用范围</summary><p className="mt-2 text-muted-foreground">峰值、回撤、急跌、二次急跌均以本轮冻结的筛选起点累计；规则所需历史按原算法预热。曾发生急跌及最大回撤达到阈值的锁定保留；未收复锁定须依原规则解除。实际成本线、已落袋利润、仓位数量及第 N 次实际加仓后的阶段不在观察阶段模拟。</p></details>
      {active.frozenVersions&&<details className="text-[11px]"><summary className="cursor-pointer">已保存版本</summary><PlanVersionList plan={active}/></details>}
    </>}
    <label className="flex items-center gap-2 text-[11px]">筛选时长<input aria-label="三阶筛选时长（小时）" className={field+' w-20'} type="number" min="0" max="8784" value={hours} onChange={e=>setHours(e.target.value)}/>小时，0 为至可用行情末尾</label>
    {error&&<p role="alert" className="text-[11px] text-destructive">{error}</p>}
    <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border/50 bg-popover py-2"><button type="button" disabled={!state.ready||!monitor.ready} className={button} onClick={()=>save(false)}>保存三阶方案</button><button type="button" disabled={!state.ready||!monitor.ready||!selectedCount} className={button+' bg-primary text-primary-foreground'} onClick={()=>save(true)}>保存并开始三阶筛选</button></div>
  </div>;
}
