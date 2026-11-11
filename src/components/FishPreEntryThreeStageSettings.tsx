import './FishPreEntryThreeStageSettings.css';
import {SettingsImageButton} from './SettingsImageExport';
import {selectedPreEntryPlan,newPreEntryHours} from '@/lib/fish/preEntryActivePlan';
import {SaveTemplateButton,TemplatePicker} from './FishQualitySellPlansEditor';
import {activeQualityPlanTemplates,qualityPlanFromTemplate} from '@/lib/fish/qualityPlanTemplates';
import { useMemo, useState } from 'react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import type { QualityGroup } from '@/lib/fish/quality';
import { makeQualityBuyFilter, qualityFilterChoiceKey, qualityFilterMenuChoices, holdingVetoDraft, parseHoldingVetoDraft, type HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { emptyPreEntryThreeStage, retryPreEntryThreeStage, PRE_ENTRY_RETRY_VERSION, entryCondition, preEntryPlanFilters, validatePreEntryThreeStage, copyAdditionMarketConditions, copyOrdinaryMarketSeller, type EntryMarketCondition, type EntryMarketExpression, type EntrySellRule } from '@/lib/fish/preEntryThreeStage';
import { vetoDraftOf, parseAdditionVetoDraft, type AdditionVetoDraft } from '@/lib/fish/qualityEntryVetoDraft';
import { FishQualityEntryVetoEditor } from './FishQualityEntryVetoEditor';
import { FishQualityHoldingVetoEditor } from './FishQualityHoldingVetoEditor';
import { FishQualityBoxStopEditor } from './FishQualityBoxStopEditor';
import { FishQualityInfo } from './FishQualityModule';
import { PlanVersionList } from './FishQualityPlanVersions';
import { planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { defaultEntryStallTurn5m } from '@/lib/fish/preEntryStallTurn5m';

const field='min-w-0 rounded border border-border/60 bg-background px-2';
const button='screening-button disabled:opacity-40';
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
export function FishPreEntryThreeStageSettings({state,selectedCount,done,onUseTemplate}:{state:FishQualityState;selectedCount:number;done:()=>void;onUseTemplate?:()=>void}){
  const monitor=state.preEntry!,definitions=useFeatureDefinitions(),choices=useMemo(()=>qualityFilterMenuChoices(definitions),[definitions]);
  const defaultAdmission=():EntryMarketCondition=>entryCondition({...makeQualityBuyFilter('state:state','>',.8,true,definitions),id:'admission-'+id()});
  const [plans,setPlans]=useState<QualityGroup[]>(()=>{const chosen=selectedPreEntryPlan(monitor.library.settings?.plans);if(chosen)return [copyAsThreeStage(chosen)];if(monitor.library.settings?.plans.length)return [];if(!choices.length)return [];const plan=makeQualitySellPlan(choices[0].key,'>',0,definitions);plan.label='三阶筛选';plan.preEntryThreeStage=retryPreEntryThreeStage(emptyPreEntryThreeStage(),[defaultAdmission()]);return [plan];});
  const [activeId,setActiveId]=useState(plans[0]?.id),[hours,setHours]=useState(String(newPreEntryHours(monitor.library.settings?.hours))),[error,setError]=useState('');
  const [vetoDrafts,setVetoDrafts]=useState<Record<string,AdditionVetoDraft>>({}),[hardDrafts,setHardDrafts]=useState<Record<string,HoldingVetoDraft[]>>({});
  const [sourceId,setSourceId]=useState(''),[roundIndex,setRoundIndex]=useState('0');
  const active=plans.find(p=>p.id===activeId)??plans[0],c=active?.preEntryThreeStage;
  const retry=c?.version===PRE_ENTRY_RETRY_VERSION;
  const sources=state.study.sellPlans??[],source=sources.find(p=>p.id===sourceId),rounds=source?.addition?.rounds?.length?source.addition.rounds:source?.addition?[source.addition]:[];
  const patch=(p:Partial<NonNullable<typeof c>>)=>setPlans(old=>old.map(plan=>plan.id===active?.id?{...plan,preEntryThreeStage:{...plan.preEntryThreeStage!,...p}}:plan));
  const eventName=(condition:EntryMarketCondition)=>choices.find(item=>item.key===qualityFilterChoiceKey({...condition,direction:'>'}))?.group||condition.snapshot.featureShort||condition.label;
  const newCondition=():EntryMarketCondition=>entryCondition({...makeQualityBuyFilter(choices[0].key,'>',0,true,definitions),id:id()});
  const guardAction=(action:()=>void)=>{try{action();setError('');}catch(e){setError(e instanceof Error?e.message:'设置无效');}};
  const createFiveMinuteStallCopy=()=>guardAction(()=>{
    if(!active||!c?.stallTurn)return;
    const {frozenVersions:_old,...base}=active,previous=c.stallTurn;
    const next:QualityGroup={...structuredClone(base),id:id(),label:active.label+' · 5分钟转弱副本',preEntryThreeStage:{...structuredClone(c),additionVetoes:vetoDrafts[active.id]?parseAdditionVetoDraft(vetoDrafts[active.id]):structuredClone(c.additionVetoes),hardVetoes:hardDrafts[active.id]?parseHoldingVetoDraft(hardDrafts[active.id]):structuredClone(c.hardVetoes),stallTurn:{...defaultEntryStallTurn5m(),risePct:previous.risePct,maxProgressPct:previous.maxProgressPct,pullback:structuredClone(previous.pullback)}}};
    const config=next.preEntryThreeStage!,rule=config.stallTurn!;
    config.additionVetoes=[...config.additionVetoes.filter(v=>v.kind!=='stall-turn'&&v.kind!=='pullback-new-high'),{kind:'stall-turn',enabled:true,historyHours:rule.historyHours,riseMinutes:rule.riseMinutes,risePct:rule.risePct,stallMinutes:rule.stallMinutes,maxProgressPct:rule.maxProgressPct,turnMinutes:rule.turnMinutes},...(rule.pullback?.enabled?[{kind:'pullback-new-high' as const,enabled:true,historyHours:rule.historyHours,pct:rule.pullback.pct}]:[])];
    delete config.stallTurn;
    setPlans([next]);setActiveId(next.id);setVetoDrafts({});setHardDrafts({});
  });
  const createEventAdmissionCopy=(guardEnabled=true,extra?:EntryMarketCondition)=>guardAction(()=>{
    if(!active||!c)return;
    const {frozenVersions:_old,...base}=active;
    const config={...c,additionVetoes:vetoDrafts[active.id]?parseAdditionVetoDraft(vetoDrafts[active.id]):c.additionVetoes,hardVetoes:hardDrafts[active.id]?parseHoldingVetoDraft(hardDrafts[active.id]):c.hardVetoes};
    const next=retryPreEntryThreeStage(config,[defaultAdmission(),...(extra?[extra]:[])]);
    next.admission={...next.admission!,guardEnabled};
    const copy={...structuredClone(base),id:id(),label:active.label+' · 新事件准入副本',preEntryThreeStage:next};
    setPlans([copy]);setActiveId(copy.id);setVetoDrafts({});setHardDrafts({});
  });
  const save=(start:boolean)=>guardAction(()=>{
    if(!hours.trim()||!Number.isFinite(Number(hours))||Number(hours)<=0||Number(hours)>8784)throw Error('单标的筛选时限须大于 0 且不超过 8784 小时');
    if(!plans.length)throw Error('请先新增三阶方案');
    const next=plans.map(p=>{
      const current=p.preEntryThreeStage!;
      const config={...current,additionVetoes:vetoDrafts[p.id]?parseAdditionVetoDraft(vetoDrafts[p.id]):current.additionVetoes,hardVetoes:hardDrafts[p.id]?parseHoldingVetoDraft(hardDrafts[p.id]):current.hardVetoes};
      if(!p.label.trim())throw Error('请填写方案名称');
      validatePreEntryThreeStage(config);return {...p,preEntryThreeStage:config};
    });
    monitor.configure(next,Number(hours));done();if(start)void monitor.restart(Number(hours));
  });
  const conditionEditor=(condition:EntryMarketCondition,put:(c:EntryMarketCondition)=>void,remove:()=>void,prefix:string)=><div className="screening-condition-row">
    <input type="checkbox" aria-label={prefix+'启用'} checked={condition.enabled} onChange={e=>put({...condition,enabled:e.target.checked})}/>
    <select className={field+' max-w-full flex-1'} aria-label={prefix+'指标'} value={qualityFilterChoiceKey({...condition,direction:'>'})} onChange={e=>put({...entryCondition({...makeQualityBuyFilter(e.target.value,'>',condition.threshold,condition.enabled,definitions),id:condition.id},condition.timing),direction:condition.direction})}>
      {!choices.some(choice=>choice.key===qualityFilterChoiceKey({...condition,direction:'>'}))&&<option hidden disabled value={qualityFilterChoiceKey({...condition,direction:'>'})}>{condition.label}（保存的公式）</option>}
      {choices.map(choice=><option key={choice.key} value={choice.key}>{choice.group} · {choice.label}</option>)}
    </select>
    <select className={field} aria-label={prefix+'方向'} value={condition.direction} onChange={e=>put({...condition,direction:e.target.value as EntryMarketCondition['direction']})}>{['>','>=','<','<='].map(v=><option key={v}>{v}</option>)}</select>
    <input className={field+' w-20'} aria-label={prefix+'门槛'} type="number" step="any" value={Number.isFinite(condition.threshold)?condition.threshold:''} onChange={e=>put({...condition,threshold:e.target.value.trim()?Number(e.target.value):NaN})}/>
    <select className={field} aria-label={prefix+'时点'} value={condition.timing} onChange={e=>put({...condition,timing:e.target.value as EntryMarketCondition['timing']})}><option value="intrabar">逐分钟复原</option><option value="closed">只读已收盘原周期</option></select>
    <button type="button" className={button} aria-label={prefix+'删除'} onClick={remove}>删除</button>
  </div>;
  const eventConditionEditor=(condition:EntryMarketCondition,put:(c:EntryMarketCondition)=>void,prefix:string)=>{
    const choice=qualityFilterChoiceKey({...condition,direction:'>'});
    return <div className="screening-event-fields min-w-0">
      <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground"><span>指标</span><select className={field+' w-full text-foreground'} aria-label={prefix+'指标'} value={choice} onChange={e=>put({...entryCondition({...makeQualityBuyFilter(e.target.value,'>',condition.threshold,condition.enabled,definitions),id:condition.id},condition.timing),direction:condition.direction})}>
        {!choices.some(item=>item.key===choice)&&<option hidden disabled value={choice}>{condition.label}（保存的公式）</option>}{choices.map(item=><option key={item.key} value={item.key}>{item.group} · {item.label}</option>)}
      </select></label>
      <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground"><span>方向</span><select className={field+' w-full text-foreground'} aria-label={prefix+'方向'} value={condition.direction} onChange={e=>put({...condition,direction:e.target.value as EntryMarketCondition['direction']})}>{['>','>=','<','<='].map(v=><option key={v}>{v}</option>)}</select></label>
      <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground"><span>门槛</span><input className={field+' w-full text-foreground'} aria-label={prefix+'门槛'} type="number" step="any" value={Number.isFinite(condition.threshold)?condition.threshold:''} onChange={e=>put({...condition,threshold:e.target.value.trim()?Number(e.target.value):NaN})}/></label>
      <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted-foreground"><span>确认时点</span><select className={field+' w-full text-foreground'} aria-label={prefix+'时点'} value={condition.timing} onChange={e=>put({...condition,timing:e.target.value as EntryMarketCondition['timing']})}><option value="intrabar">逐分钟复原</option><option value="closed">只读已收盘原周期</option></select></label>
    </div>;
  };
  const expressionEditor=(expression:EntryMarketExpression,put:(e:EntryMarketExpression)=>void,prefix:string,depth=0):React.ReactNode=>{
    if('condition' in expression)return conditionEditor(expression.condition,condition=>put({condition}),()=>put({join:'all',children:[]}),prefix);
    return <div className="space-y-2 rounded border border-border/50 p-2">
      <label className="text-[11px]">组内关系 <select aria-label={prefix+'组合关系'} className={field} value={expression.join} onChange={e=>put({...expression,join:e.target.value as 'all'|'any'})}><option value="all">全部满足（且）</option><option value="any">任一满足（或）</option></select></label>
      {expression.children.map((child,index)=><div key={index} className="space-y-1">{expressionEditor(child,value=>put({...expression,children:expression.children.map((old,i)=>i===index?value:old)}),prefix+(index+1)+' ',depth+1)}{expression.children.length>1&&<button type="button" className={button} onClick={()=>put({...expression,children:expression.children.filter((_,i)=>i!==index)})}>移除此子条件／组</button>}</div>)}
      <div className="flex gap-2"><button type="button" className={button} disabled={!choices.length} onClick={()=>put({...expression,children:[...expression.children,{condition:newCondition()}]})}>添加子条件</button>{depth<8&&<button type="button" className={button} disabled={!choices.length} onClick={()=>put({...expression,children:[...expression.children,{join:'any',children:[{condition:newCondition()}]}]})}>添加且／或子组</button>}</div>
    </div>;
  };
  return <div className="screening-settings" data-testid="pre-entry-three-stage-settings">
    <div className="screening-header"><div><h3 className="screening-title">动态筛选条件</h3><p className="screening-subtitle">三阶准入 · 按首次满足时间入选</p></div><div className="screening-template-actions">
      {active&&<SaveTemplateButton index={0} ariaLabel="把当前筛选方案存为模板" defaultName={active.label} disabledReason={!state.savePlanTemplate||!state.ready?'模板尚未恢复':!monitor.ready?'筛选库尚未读取完成':!monitor.library.settings?.plans.some(p=>p.id===active.id&&JSON.stringify(p)===JSON.stringify(active))||Object.keys(vetoDrafts).length>0||Object.keys(hardDrafts).length>0||Number(hours)!==monitor.library.settings?.hours?'请先保存当前三阶方案':undefined} onSave={name=>state.savePlanTemplate!(active.id,name)}/>}
      <TemplatePicker purpose="entry" plans={plans} disabled={!state.ready} actions={{owner:state.account,templates:activeQualityPlanTemplates(state.study).filter(t=>!!t.plan.preEntryThreeStage),save:(id,name)=>state.savePlanTemplate?.(id,name),remove:id=>state.deletePlanTemplate?.(id),restore:state.restorePlanTemplate?template=>{if(!template.plan?.preEntryThreeStage)throw Error('请选择三阶筛选模板');state.restorePlanTemplate!(template);}:undefined}} onUse={template=>{const next=qualityPlanFromTemplate(template,id());onUseTemplate?.();setPlans([next]);setActiveId(next.id);if(template.entryHours!=null)setHours(String(template.entryHours));setVetoDrafts({});setHardDrafts({});}}/>
    </div></div>
    {!active&&!!monitor.library.settings?.plans.length&&<label className="block text-[11px]">选择唯一保留的筛选方案<select aria-label="选择唯一保留的筛选方案" className={field+' mt-1 w-full'} value="" onChange={e=>{const saved=monitor.library.settings!.plans.find(p=>p.id===e.target.value);if(saved){const plan=copyAsThreeStage(saved);setPlans([plan]);setActiveId(plan.id);}}}><option value="">请选择要保留的已保存方案</option>{monitor.library.settings.plans.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
    {active&&c&&<>
      <div className="screening-basics">
        <label className="screening-form-label">方案名称<input className={field+' w-full'} aria-label="三阶方案名称" value={active.label} onChange={e=>setPlans(plans.map(p=>p.id===active.id?{...p,label:e.target.value}:p))}/></label>
        <label className="screening-form-label">单标的筛选时限<span className="screening-time-field"><input aria-label="单标的筛选时限（小时）" className={field} type="number" min="0.016666666666666666" max="8784" step="any" value={hours} onChange={e=>setHours(e.target.value)}/>小时</span></label>
      </div>
      <details className="screening-detail mt-4"><summary className="cursor-pointer">从持仓方案复制市场条件</summary>
        <div className="mt-2 flex flex-wrap gap-2"><select aria-label="复制条件来源方案" className={field} value={sourceId} onChange={e=>{setSourceId(e.target.value);setRoundIndex('0');}}><option value="">选择明确的来源方案</option>{sources.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
          <select aria-label="复制加仓轮次" className={field} value={roundIndex} onChange={e=>setRoundIndex(e.target.value)}>{rounds.map((_,i)=><option key={i} value={i}>第 {i+1} 次加仓 · 主分支</option>)}</select>
          <button type="button" className={button} disabled={!rounds.length} onClick={()=>guardAction(()=>{if(planVersionChanges(source!).length)throw Error('来源方案版本不符，不能复制');const copied=copyAdditionMarketConditions(rounds[Number(roundIndex)]);const existing=vetoDrafts[active.id]?parseAdditionVetoDraft(vetoDrafts[active.id]):c.additionVetoes;if(existing.some(v=>v.enabled))throw Error('当前已配置加仓共用否决，请使用新副本复制以免覆盖');patch({required:[...c.required,...copied.required],additionVetoes:copied.additionVetoes,detectors:[...(c.detectors??[]),...copied.detectors],additionSource:{planId:source!.id,label:source!.label,round:Number(roundIndex)+1,versions:structuredClone(source!.frozenVersions)}});setVetoDrafts(old=>{const next={...old};delete next[active.id];return next;});})}>复制该轮必要条件与否决</button>
          <button type="button" className={button} disabled={!source} onClick={()=>guardAction(()=>{if(planVersionChanges(source!).length)throw Error('来源方案版本不符，不能复制');const rule=copyOrdinaryMarketSeller(source!);patch({sellRules:[...c.sellRules,rule]});})}>复制完整普通卖出规则</button>
        </div><p className="mt-2 text-muted-foreground">仅复制所选轮次的市场条件；原探测算法按每条原信号的冻结公式和门槛判断。实际成本、分段持仓及动态退出确认不能直接转换。来源配置和旧模板保持原样。</p>
      </details>
      <section className="screening-stage space-y-3" data-testid="three-stage-zero">
        <div className="flex items-center gap-0.5"><h4 className="text-xs font-medium">⓪ 必要条件</h4><FishQualityInfo label="必要条件使用说明"><p>所有已启用的必要条件都满足，才继续检查①和②；关闭的条件不参与判断。这里不包含否决条件。</p><p>例如设置状态 S &gt; 0.6，则任何一路新事件准入，都须同时满足该门槛。未设置必要条件时，直接检查后两阶段。</p><p>指标按所选的逐分钟复原或已收盘原周期判断，原信号探测条件沿用该信号保存的公式和门槛。</p></FishQualityInfo><span className="screening-stage-note">全部满足</span></div>
        <p className="text-muted-foreground">所有已启用的条件须同时满足。</p>
        {c.required.map((f,i)=><div key={f.id}>{conditionEditor(f,value=>patch({required:c.required.map((old,j)=>j===i?value:old)}),()=>patch({required:c.required.filter((_,j)=>j!==i)}),'必要条件 '+(i+1)+' ')}</div>)}
        {!c.required.length&&<p className="text-[11px] text-muted-foreground">{retry?'未设置额外必要条件；满足任一启用的准入标准后，继续检查排除门槛。':'未设置额外指标门槛；仍须通过防守线事件与排除门槛。'}</p>}
        <button type="button" className={button} disabled={!choices.length} onClick={()=>patch({required:[...c.required,newCondition()]})}>添加必要条件</button>
        {(c.detectors??[]).map((d,index)=><div key={d.id} className="flex flex-wrap items-center gap-2 text-[11px]"><span>原信号探测门槛提高</span><input aria-label={'原探测 '+(index+1)+' 提高幅度'} className={field+' w-16'} type="number" min="0" step="any" value={Number.isFinite(d.stricterPct)?d.stricterPct:''} onChange={e=>patch({detectors:c.detectors!.map((item,i)=>i===index?{...item,stricterPct:e.target.value.trim()?Number(e.target.value):NaN}:item)})}/><span>%</span><select aria-label={'原探测 '+(index+1)+' 关系'} className={field} value={d.match} onChange={e=>patch({detectors:c.detectors!.map((item,i)=>i===index?{...item,match:e.target.value as 'all'|'any'}:item)})}><option value="all">全部原探测同时满足</option><option value="any">任一原探测满足</option></select><select aria-label={'原探测 '+(index+1)+' 算法'} className={field} value={d.featureId??''} onChange={e=>patch({detectors:c.detectors!.map((item,i)=>i===index?{...item,featureId:e.target.value||undefined}:item)})}><option value="">本条信号的全部原探测</option>{definitions.map(def=><option value={def.id} key={def.id}>{def.name}</option>)}</select><button type="button" className={button} onClick={()=>patch({detectors:c.detectors!.filter((_,i)=>i!==index)})}>删除探测条件</button></div>)}
        <button type="button" className={button} onClick={()=>patch({detectors:[...(c.detectors??[]),{id:id(),stricterPct:0,match:'all'}]})}>添加原探测门槛条件</button>
        {c.additionSource&&<p className="text-[10px] text-muted-foreground">复制来源：{c.additionSource.label} · 第 {c.additionSource.round} 次加仓主分支；必要条件只读已收盘原周期。</p>}
      </section>
      <section className="screening-stage space-y-3" data-testid="three-stage-first">
        <div className="flex items-center gap-0.5"><h4 className="text-xs font-medium">① 新事件准入</h4><FishQualityInfo label="新事件准入使用说明"><p>防守线新事件、状态 S 和其他指标准入属于同一层级，彼此是“或”的关系；任意一个已勾选项满足，就通过①。</p><p>例如同时勾选防守线和状态 S &gt; 0.8：出现防守线新事件，或状态 S 超过 0.8，满足其一即可。只勾选状态 S 时，就只按状态 S 判断。</p><p>新副本默认勾选全部准入项；每一项都可单独关闭、修改指标、方向、阈值和确认时点。至少保留一个启用项。</p><p>防守线首次产生、断裂后重建、上移或下移、实虚切换均算新事件；同价同型延续和仅换箱体编号不算。防守线只读已收盘 5 分钟结构，其他指标按所选时点读取。</p><p>完整入选要求：⓪全部满足、①任一勾选项满足、②未触发排除，三者在同一时点成立。</p>{!retry&&<p>当前保存的旧方案仅使用防守线新事件。选择状态 S、添加其他标准或点击配置按钮，会创建独立的新副本；原方案、条件参数及模板保留。</p>}</FishQualityInfo><span className="screening-stage-note">任一满足</span></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">各模块互为“或”：满足任一已勾选事件即可。</p>{retry?<div className="flex gap-2"><button type="button" className={button} aria-label="全选准入标准" onClick={()=>patch({admission:{...c.admission!,guardEnabled:true,algorithms:c.admission!.algorithms.map(a=>({...a,enabled:true}))}})}>全选</button><button type="button" className={button} onClick={()=>patch({admission:{...c.admission!,guardEnabled:false,algorithms:c.admission!.algorithms.map(a=>({...a,enabled:false}))}})}>取消全选</button></div>:<button type="button" className={button+' text-primary'} onClick={()=>createEventAdmissionCopy()}>配置新事件准入（另存副本）</button>}</div>
        {!retry&&<p className="text-[10px] text-muted-foreground">原方案保留。启用新事件时创建独立副本，新副本默认全选。</p>}
        <div className="space-y-3" data-testid="admission-event-modules">
          <section aria-label="防守线新事件准入模块" data-testid="admission-guard-module" className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3">
            <div className="flex items-center gap-0.5"><input id={'guard-event-'+active.id} className="mr-1.5 shrink-0" type="checkbox" aria-label="启用原生防守线准入" checked={retry?c.admission!.guardEnabled:true} onChange={e=>retry?patch({admission:{...c.admission!,guardEnabled:e.target.checked}}):createEventAdmissionCopy(e.target.checked)}/><h5 className="text-[11px] font-medium"><label htmlFor={'guard-event-'+active.id} className="cursor-pointer">防守线新事件</label></h5><FishQualityInfo label="防守线新事件模块使用说明"><p>本模块只负责防守线新事件：首次产生、断裂后重建、上移或下移、实虚切换。同价同型延续和仅换箱体编号不算新事件。</p><p>勾选后与其他事件按“或”判断；原生结构只读已收盘 5 分钟数据。箱体和防守线的全部参数仅在本模块内设置。</p></FishQualityInfo></div>
            <details className="text-[11px]"><summary className="cursor-pointer text-muted-foreground">参数设置</summary><div className="mt-2"><FishQualityBoxStopEditor entry admission disabled={retry&&!c.admission!.guardEnabled} prefix="三阶准入 " definitions={definitions} rule={c.guard.rule} onChange={rule=>patch({guard:{...c.guard,rule}})}/></div></details>
          </section>
          {retry?c.admission!.algorithms.map((algorithm,i)=>{
            const put=(value:EntryMarketCondition)=>patch({admission:{...c.admission!,algorithms:c.admission!.algorithms.map((old,j)=>j===i?value:old)}});
            const remove=()=>patch({admission:{...c.admission!,algorithms:c.admission!.algorithms.filter((_,j)=>j!==i)}});
            return <section key={algorithm.id} aria-label={'新事件 '+(i+2)+' '+(eventName(algorithm))+'准入模块'} data-testid="admission-indicator-module" className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3">
              <div className="flex items-center gap-0.5"><input id={'indicator-event-'+algorithm.id} className="mr-1.5 shrink-0" type="checkbox" aria-label={'准入算法 '+(i+1)+' 启用'} checked={algorithm.enabled} onChange={e=>put({...algorithm,enabled:e.target.checked})}/><h5 className="min-w-0 text-[11px] font-medium"><label htmlFor={'indicator-event-'+algorithm.id} className="cursor-pointer">{eventName(algorithm)}</label></h5><FishQualityInfo label={'新事件 '+(i+2)+' 模块使用说明'}><p>本模块按自己的指标、方向、门槛和确认时点判断。勾选后与防守线及其他事件按“或”判断；取消勾选会保留参数。</p><p>例如状态 S &gt; 0.8，只有读数严格超过 0.8 才满足；若包含等于，请选择 ≥。逐分钟复原与只读已收盘原周期由本模块单独选择。</p></FishQualityInfo><button type="button" className={button+' ml-auto text-muted-foreground'} aria-label={'准入算法 '+(i+1)+' 删除'} onClick={remove}>删除事件</button></div>
              {eventConditionEditor(algorithm,put,'准入算法 '+(i+1)+' ')}
            </section>;
          }):<section aria-label="状态 S 准入模块" data-testid="admission-indicator-module" className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3"><div className="flex items-center gap-0.5"><input id={'state-event-'+active.id} className="mr-1.5 shrink-0" type="checkbox" aria-label="启用状态 S 新事件准入" checked={false} onChange={()=>createEventAdmissionCopy()}/><h5 className="text-[11px] font-medium"><label htmlFor={'state-event-'+active.id} className="cursor-pointer">状态 S</label></h5><FishQualityInfo label="新事件 2 模块使用说明"><p>勾选后创建独立副本，默认条件为状态 S &gt; 0.8。副本中可单独修改指标、方向、门槛和确认时点；与防守线按“或”判断，原方案保留。</p></FishQualityInfo></div><p className="text-[11px] text-muted-foreground">状态 S &gt; 0.8 · 勾选后可配置</p></section>}
        </div>
        <button type="button" className={button} disabled={!choices.length} onClick={()=>retry?patch({admission:{...c.admission!,algorithms:[...c.admission!.algorithms,defaultAdmission()]}}):createEventAdmissionCopy(true,newCondition())}>添加新事件</button>
      </section>
      <section className="screening-stage space-y-3" data-testid="three-stage-second">
        <div className="flex items-center gap-0.5"><h4 className="text-xs font-medium">② 排除门槛</h4><FishQualityInfo label="排除门槛使用说明"><p>加仓共用否决、任一完整普通卖出规则、任一硬性终止，三类中任一启用条件成立，即排除当前时点；①中的任何准入项都不能绕过②。</p><p>普通卖出规则按所填的组合关系、连续次数和确认周期判断；硬性终止一旦成立立即排除，不等待普通卖出确认。</p><p>{retry?'被否决后从下一分钟重建观察起点，按原条件继续筛选；总截止时间仍从原筛选起点计算，不延长。':'旧方案按原筛选起点和原有锁定规则执行，不因打开或保存面板而改变。'}</p><p>观察阶段没有实际仓位；依赖实际成本、落袋利润、持仓数量或第 N 次实际加仓的条件不能直接用于入选前筛选。</p></FishQualityInfo><span className="screening-stage-note">任一排除</span></div>
        {retry&&<div className="space-y-2 rounded border border-border/60 p-2 text-[11px]"><label className="flex items-center gap-2"><input type="checkbox" aria-label="启用长周期回撤否决" checked={!!c.longDrawdown?.enabled} onChange={e=>patch({longDrawdown:e.target.checked?{enabled:true,hours:24,pct:NaN,mode:'current'}:undefined})}/>可选：长周期回撤否决</label>
          {c.longDrawdown?.enabled&&<div className="flex flex-wrap items-center gap-2"><label>回看时长<input aria-label="长周期回撤回看时长（小时）" className={field+' ml-1 w-20'} type="number" min="0.016666666666666666" max="8784" step="any" value={Number.isFinite(c.longDrawdown.hours)?c.longDrawdown.hours:''} onChange={e=>patch({longDrawdown:{...c.longDrawdown!,hours:e.target.value.trim()?Number(e.target.value):NaN}})}/>小时</label><select aria-label="长周期回撤口径" className={field} value={c.longDrawdown.mode} onChange={e=>patch({longDrawdown:{...c.longDrawdown!,mode:e.target.value as 'current'|'maximum'}})}><option value="current">当前距窗口高点的回撤</option><option value="maximum">窗口内最大回撤</option></select><label>达到<input aria-label="长周期回撤阈值（%）" className={field+' mx-1 w-20'} type="number" min="0" max="100" step="any" placeholder="填写阈值" value={Number.isFinite(c.longDrawdown.pct)?c.longDrawdown.pct:''} onChange={e=>patch({longDrawdown:{...c.longDrawdown!,pct:e.target.value.trim()?Number(e.target.value):NaN}})}/>% 即否决</label></div>}
          <p className="text-muted-foreground">默认关闭。检查截至筛选时点的历史窗口，包含本次观察起点之前的行情，不随重筛清空。当前回撤＝（窗口最高价－当前收盘价）÷窗口最高价；最大回撤按窗口内先高后低计算。历史不足时等待，不补造数据。</p>
        </div>}
        <p className="screening-subheading">加仓共用一票否决（任一成立即排除）</p>
        {c.stallTurn&&<p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" data-testid="legacy-stall-turn-note">
          <span>此历史方案的{c.stallTurn.version==='entry-stall-turn-v1'?'原1分钟':'原5分钟'}规则{c.stallTurn.enabled?'仍已启用':'已关闭'}，保存时保留原参数。</span>
          <button type="button" className={button} onClick={createFiveMinuteStallCopy}>使用共用5分钟规则（另存副本）</button>
        </p>}
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
        <p className="screening-subheading">硬性终止</p><FishQualityHoldingVetoEditor entry compact labelPrefix="三阶硬性终止 " draft={hardDrafts[active.id]??holdingVetoDraft(c.hardVetoes)} setDraft={draft=>setHardDrafts({...hardDrafts,[active.id]:draft})}/>
      </section>
      <details className="screening-detail mt-4"><summary>观察基准与适用范围</summary><p className="mt-2 text-muted-foreground">{retry?'否决后从下一分钟重建观察起点：峰值、回撤、急跌锁定与卖出连续确认重新累计，指标历史和原生结构保持因果连续；每次仍按原公式、阈值完整判断。总截止时间始终从原筛选起点计算，不延长；命中最早符合条件的时点即停止。':'峰值、回撤、急跌、二次急跌均以本轮冻结的筛选起点累计；规则所需历史按原算法预热。曾发生急跌及最大回撤达到阈值的锁定保留；未收复锁定须依原规则解除。'}实际成本线、已落袋利润、仓位数量及第 N 次实际加仓后的阶段不在观察阶段模拟。</p></details>
      {active.frozenVersions&&<details className="screening-detail mt-3"><summary>已保存版本</summary><PlanVersionList plan={active} draft/></details>}
    </>}
    {!active&&<label className="screening-form-label mt-4">单标的筛选时限<span className="screening-time-field"><input aria-label="单标的筛选时限（小时）" className={field} type="number" min="0.016666666666666666" max="8784" step="any" value={hours} onChange={e=>setHours(e.target.value)}/>小时</span></label>}
    <p className="mt-4 text-muted-foreground">首次满足即停止；到达时限仍未满足则结束。修改时限后，从头重新筛选生效。</p>
    {error&&<p role="alert" className="text-[11px] text-destructive">{error}</p>}
    {!monitor.ready && <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <p role={monitor.error ? 'alert' : 'status'} className={monitor.error ? 'text-destructive' : 'text-muted-foreground'}>
        {monitor.error || '正在读取筛选库，完成后可保存方案或开始筛选。'}
      </p>
      {monitor.error && <button type="button" className={button} onClick={monitor.retry}>重试读取筛选库</button>}
    </div>}
    <div className="screening-footer"><span className="screening-footer-meta">已选择 {selectedCount} 个标的</span><div className="screening-footer-actions"><SettingsImageButton/><button type="button" disabled={!state.ready||!monitor.ready} className={button} onClick={()=>save(false)}>保存三阶方案</button><button type="button" disabled={!state.ready||!monitor.ready||!selectedCount} className={button+' screening-save-primary'} onClick={()=>save(true)}>保存并开始三阶筛选</button></div></div>
  </div>;
}
