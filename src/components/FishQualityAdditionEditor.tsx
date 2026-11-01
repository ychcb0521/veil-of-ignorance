import { useMemo, useState, type ReactNode } from 'react';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { defaultQualityAddition, qualityAdditionAtrSettings, qualityAdditionConditions, qualityAdditionPrerequisites, validateQualityAddition, type QualityAdditionRule, type QualityAdditionRoundRule } from '@/lib/fish/qualityAddition';
import { qualityFilterChoices, makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { orderedSellStages, type QualitySellStage } from '@/lib/fish/qualitySellStages';
import {defaultStructureAddition,type StructureAdditionRule} from '@/lib/fish/qualityAdditionStructure';
import { FishQualityInfo } from '@/components/FishQualityModule';
import { FishQualityHoldingVetoEditor } from '@/components/FishQualityHoldingVetoEditor';
import type { VetoStagesDraft } from '@/components/FishQualityVetoStagesEditor';
import type { HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';

/**
 * 【用户要求】2026-11-01 加仓细节：每次加仓独立设置，且每次分三段——
 *   方向（必要不充分：时机那一刻须全部满足，可选指标与涨幅门槛；用户 2026-11-01 定名「方向」，代码里仍叫 prerequisites）、
 *   位置（必要充分：达到即加仓，主要用箱体 DBL / SBS；用户定名「位置」，代码里仍按 source/structure 存）、
 *   卖出（必要充分：碰到均衡线 K、可不断添加的否决条件——存为方案的 vetoStages，以及可选的「本次加仓后改用的卖出算法」）。
 * 2026-11-01 用户：位置 =「算法找支撑，再减 n×ATR 得到加仓的均衡线」，所以 K 的设置放在「位置」；
 * 卖出 =「一条条终止条件，像硬性终止那样可不断增加，如碰到 K 卖出、5 分钟回撤超 10% 卖出」。
 * 数据沿用原格式：自选指标时机的方向条件仍是 conditions[1..]；箱体 / 原探测时机的存 prerequisites；
 * 「本次加仓后改用的卖出算法」就是方案的 sellStages（afterAdditions = 第几次）。
 */
interface ConditionDraft {choice:string;direction:'<'|'>';threshold:string}
export interface SellSwitchDraft extends ConditionDraft {enabled:boolean}
interface RoundDraft extends ConditionDraft {source:'detector'|'custom'|'structure';structure:StructureAdditionRule;structureBuffer:string;stricterPct:string;extraConditions:ConditionDraft[];gainEnabled:boolean;minGainPct:string;entryBufferAtr:string;supportOffsetAtr:string;sellSwitch:SellSwitchDraft}
export interface AdditionDraft extends RoundDraft {enabled:boolean;quantityMode:'calculator'|'entry'|'fixed';quantity:string;repeat:boolean;maxRounds:string;otherRounds:RoundDraft[];
  /** 设在「最多加仓次数」之后的旧切换阶段：原样保留，不在轮次里显示。 */
  laterSellStages?:QualitySellStage[]}
const conditionDraft=(f?:ReturnType<typeof qualityAdditionConditions>[number]):ConditionDraft=>({choice:f?f.snapshot.featureId+':'+f.metric:'',direction:f?.direction??'>',threshold:f?String(f.threshold):''});
const sellSwitchDraft=(stage?:QualitySellStage):SellSwitchDraft=>stage?{enabled:true,choice:stage.snapshot.featureId+':'+stage.metric,direction:stage.rule.direction,threshold:String(stage.rule.threshold)}:{enabled:false,choice:'',direction:'<',threshold:''};
const roundDraft=(rule:QualityAdditionRoundRule,stage?:QualitySellStage):RoundDraft=>{
 const custom=rule.source==='custom',conditions=qualityAdditionConditions(rule),atr=qualityAdditionAtrSettings(rule);
 return {source:rule.source,structure:structuredClone(rule.structure??defaultStructureAddition()),structureBuffer:String(rule.structure?.buffer??.5),stricterPct:String(rule.stricterPct),
  ...conditionDraft(custom?conditions[0]:undefined),extraConditions:qualityAdditionPrerequisites(rule).map(conditionDraft),
  gainEnabled:rule.minGainPct!=null,minGainPct:String(rule.minGainPct??5),entryBufferAtr:String(atr.entryBufferAtr),supportOffsetAtr:String(atr.supportOffsetAtr),sellSwitch:sellSwitchDraft(stage)};
};
const copyRound=(d:RoundDraft):RoundDraft=>({source:d.source,structure:structuredClone(d.structure),structureBuffer:d.structureBuffer,stricterPct:d.stricterPct,choice:d.choice,direction:d.direction,threshold:d.threshold,extraConditions:structuredClone(d.extraConditions),gainEnabled:d.gainEnabled,minGainPct:d.minGainPct,entryBufferAtr:d.entryBufferAtr,supportOffsetAtr:d.supportOffsetAtr,sellSwitch:{...d.sellSwitch,enabled:false}});
export function additionDraft(rule=defaultQualityAddition(),sellStages?:readonly QualitySellStage[]):AdditionDraft {
 const count=rule.maxRounds??(rule.repeat===false?1:3),stages=orderedSellStages({sellStages:[...(sellStages??[])]}),stageAt=(n:number)=>stages.find(s=>s.afterAdditions===n);
 const first=roundDraft(rule.rounds?.[0]??rule,stageAt(1)),later=stages.filter(s=>s.afterAdditions>count);
 return {...first,enabled:rule.enabled,quantityMode:'calculator',quantity:'1',repeat:count>1,maxRounds:String(count),otherRounds:Array.from({length:count-1},(_,i)=>roundDraft(rule.rounds?.[i+1]??rule,stageAt(i+2))),...(later.length?{laterSellStages:later}:{})};
}
function parseRound(d:RoundDraft,enabled:boolean,defs:readonly DeepDigFeatureDef[]):QualityAdditionRoundRule{
 const rule:QualityAdditionRoundRule={source:d.source,stricterPct:d.stricterPct.trim()?Number(d.stricterPct):NaN,entryBufferAtr:d.entryBufferAtr.trim()?Number(d.entryBufferAtr):NaN,supportOffsetAtr:d.source==='structure'?undefined:d.supportOffsetAtr.trim()?Number(d.supportOffsetAtr):NaN};
 if(d.source==='structure')rule.structure={...structuredClone(d.structure),buffer:d.structureBuffer.trim()?Number(d.structureBuffer):NaN};
 const build=(rows:ConditionDraft[])=>rows.flatMap(row=>{try{return [makeQualityBuyFilter(row.choice,row.direction,row.threshold.trim()?Number(row.threshold):NaN,true,defs)];}catch(error){if(enabled)throw error;return [];}});
 if(d.source==='custom'){
  const conditions=build([d,...d.extraConditions]);
  rule.condition=conditions[0];if(conditions.length>1)rule.conditions=conditions;
 }else{const prerequisites=build(d.extraConditions);if(prerequisites.length)rule.prerequisites=prerequisites;}
 if(d.gainEnabled)rule.minGainPct=d.minGainPct.trim()?Number(d.minGainPct):NaN;
 return rule;
}
const roundCount=(d:Pick<AdditionDraft,'maxRounds'>)=>{const n=d.maxRounds.trim()?Number(d.maxRounds):NaN;return Number.isInteger(n)&&n>=1&&n<=100?n:1;};
export function parseAdditionDraft(d:AdditionDraft,defs:readonly DeepDigFeatureDef[]):QualityAdditionRule{
 const count=d.maxRounds.trim()?Number(d.maxRounds):NaN;
 if(d.enabled&&(!Number.isInteger(count)||count<1||count>100))throw new Error('最多加仓次数须为 1 至 100 的整数');
 const n=roundCount(d);
 const rounds=Array.from({length:n},(_,i)=>{try{return parseRound(i?d.otherRounds[i-1]??d:d,d.enabled,defs);}catch(e){throw new Error(`第 ${i+1} 次加仓：${e instanceof Error?e.message:'条件无效'}`);}});
 const rule:QualityAdditionRule={enabled:d.enabled,quantityMode:'calculator',quantity:1,repeat:n>1,maxRounds:n,rounds,...rounds[0]};validateQualityAddition(rule);return rule;
}
/** 各次加仓「卖出」里设置的改用卖出算法 → 方案的 sellStages；没有任何切换时返回 undefined。 */
export function parseAdditionSellStages(d:AdditionDraft,defs:readonly DeepDigFeatureDef[]):QualitySellStage[]|undefined{
 const n=roundCount(d),stages:QualitySellStage[]=[];
 for(let i=0;i<n;i++){
  const s=(i?d.otherRounds[i-1]??d:d).sellSwitch;if(!s?.enabled)continue;
  const threshold=s.threshold.trim()?Number(s.threshold):NaN;
  if(!s.choice||!Number.isFinite(threshold))throw new Error(`第 ${i+1} 次加仓：改用的卖出算法须选择指标并填写有限数字门槛`);
  const plan=makeQualitySellPlan(s.choice,s.direction,threshold,defs);
  stages.push({afterAdditions:i+1,label:plan.label,metric:plan.metric,snapshot:plan.snapshot,rule:plan.rule!});
 }
 const all=[...stages,...(d.laterSellStages??[])];
 return all.length?all.sort((a,b)=>a.afterAdditions-b.afterAdditions):undefined;
}
const field='h-8 min-w-0 rounded-md border border-border/60 bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40';
function Part({title,role,info,children,testId}:{title:string;role:string;info:ReactNode;children:ReactNode;testId:string}){
 return <section className="space-y-2 rounded-md border border-border/60 bg-background/60 p-2.5" data-testid={testId}>
  <div className="flex items-center gap-1.5"><h5 className="text-[11px] font-medium">{title}</h5><span className="text-[10px] text-muted-foreground">{role}</span><FishQualityInfo label={`${title}说明`}>{info}</FishQualityInfo></div>
  {children}
 </section>;
}
/** vetoStages：每次加仓「卖出」里的否决条件，存为方案的 vetoStages（afterAdditions = 第几次），与硬性终止同一套条件和引擎。 */
export function FishQualityAdditionEditor({draft:all,setDraft,vetoStages,setVetoStages}:{draft:AdditionDraft;setDraft:(draft:AdditionDraft)=>void;vetoStages?:VetoStagesDraft;setVetoStages?:(draft:VetoStagesDraft)=>void}) {
 const defs=useFeatureDefinitions(),choices=useMemo(()=>qualityFilterChoices(defs),[defs]);
 const features=[...new Map(choices.map(c=>[c.featureId,c.group])).entries()];
 const [selectedRound,setSelectedRound]=useState(0),count=Math.min(100,Math.max(1,Math.floor(Number(all.maxRounds)||1))),index=Math.min(selectedRound,count-1);
 const current=index?all.otherRounds[index-1]??all:all,d={...all,...current};
 const patch=(p:Partial<AdditionDraft>)=>{if('enabled' in p){setDraft({...all,...p});return;}if(!index){setDraft({...all,...p});return;}const others=Array.from({length:Math.max(count-1,all.otherRounds.length)},(_,i)=>all.otherRounds[i]??copyRound(all));others[index-1]={...current,...p};setDraft({...all,otherRounds:others});};
 const setLimit=(value:string)=>{const limit=Math.min(100,Math.max(1,Math.floor(Number(value)||1)));const others=Array.from({length:Math.max(limit-1,all.otherRounds.length)},(_,i)=>all.otherRounds[i]??copyRound(all));setSelectedRound(Math.min(index,limit-1));setDraft({...all,maxRounds:value,repeat:limit>1,otherRounds:others});};
 /** 特征值 + 变量 + 方向 + 门槛，一行。 */
 const indicator=(row:ConditionDraft,label:string,update:(change:Partial<ConditionDraft>)=>void,disabled=!d.enabled)=>{
  const feature=choices.find(c=>c.key===row.choice)?.featureId??'';
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_5rem] gap-1.5">
   <select aria-label={label.replace('{x}','特征值')} disabled={disabled} value={feature} className={field} onChange={e=>update({choice:choices.find(c=>c.featureId===e.target.value)!.key})}><option value="" disabled>选择特征值</option>{features.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
   <select aria-label={label.replace('{x}','指标变量')} disabled={disabled} value={row.choice} className={field} onChange={e=>update({choice:e.target.value})}><option value="" disabled>选择变量</option>{choices.filter(c=>c.featureId===feature).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
   <select aria-label={label.replace('{x}','方向')} className={field} disabled={disabled} value={row.direction} onChange={e=>update({direction:e.target.value as '<'|'>'})}><option value=">">&gt;</option><option value="<">&lt;</option></select>
   <input aria-label={label.replace('{x}','指标门槛')} className={field} disabled={disabled} type="number" step="any" placeholder="门槛" value={row.threshold} onChange={e=>update({threshold:e.target.value})}/>
  </div>;
 };
 const prerequisiteRow=(row:ConditionDraft,i:number)=><div key={i} className="flex items-center gap-1.5" data-testid="addition-prerequisite">
  <div className="min-w-0 flex-1">{indicator(row,`加仓方向条件 ${i+1} {x}`,change=>patch({extraConditions:d.extraConditions.map((item,j)=>j===i?{...item,...change}:item)}))}</div>
  <button type="button" disabled={!d.enabled} aria-label={`删除加仓方向条件 ${i+1}`} className="shrink-0 px-1 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40" onClick={()=>patch({extraConditions:d.extraConditions.filter((_,j)=>j!==i)})}>删除</button>
 </div>;
 const box=d.source==='structure';
 return <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3" data-testid="quality-addition-editor">
  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">③ 加仓细节</h4><FishQualityInfo label="加仓细节说明"><div className="space-y-2">
   <p>每次加仓的方向、位置、卖出各自独立保存，修改某一次不会改动其他次；加仓数量按平衡公式自动计算。</p>
   <p>首次加仓须在半仓镜像（卖出初始币数 50%）实际成交之后，最早从下一分钟起检查条件；未启用半仓镜像或尚未成交时不加仓。首轮计算基准 Q 为镜像后的剩余币数，后续按当时剩余总币数计算。首轮成本线 S 为首次买入价；加仓后 S 更新为本轮 K。实际加仓价 T 高于动态成本线 S 的距离必须达到本轮设置的 ATR 倍数，{box?'K 按所选箱体基准减冗余计算；新 K 不得低于上轮 K。':'K 按本轮回撤倍数计算；'}未满足时不加仓，S 和止损线均不改变。K 是本次均衡线：Q×(K−S)＋本轮可用落袋利润 P＝新增币数×(T−K)，由此唯一确定币数；已用利润不重复使用。K 同时作为实际止损线：触线卖出剩余持仓，跳空按开盘价；同分钟先后不明时优先止损。落袋利润先补足退回 K 时的旧仓亏损，剩余部分再除以 T−K，折算为新增币数。</p>
   <p>首轮把半仓镜像已落袋利润一并计入加仓数量；用过的利润后续不再重复使用。ATR 为加仓时已收盘的 5 分钟 ATR(14)。</p>
   <p>只用新确认的原周期收盘读数，达标后按下一分钟开盘价模拟加仓；不继承开仓前的命中状态，公式预热历史保留。续算不会重复加仓，同一开盘时点卖出与加仓同时触发时优先卖出。信号库没有原探测算法时，请选择自选指标；自定义公式可先在 Deep Dig 中新增。</p>
   <p>成交金额 = 加仓币数 × 加仓成交价。加仓后按各次成交数量和价格计算成本，收益率 = 总盈亏 ÷ 累计投入。止盈、否决和分段切换仍以首次买入价为基准；部分镜像止盈只卖初始币数，100% 则卖出当时全部持仓。保存后点击「开始监测」生效，旧轮次保留。</p>
  </div></FishQualityInfo></div><label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"><input aria-label="启用条件加仓" type="checkbox" checked={d.enabled} onChange={e=>patch({enabled:e.target.checked})} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"/>启用</label></div>
  <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-[11px] text-muted-foreground">最多加仓<input aria-label="最多加仓次数" type="number" min="1" max="100" step="1" disabled={!d.enabled} value={all.maxRounds} onChange={e=>setLimit(e.target.value)} className={field+' w-16'}/>次</label>
   <div role="tablist" aria-label="选择加仓轮次" className="flex flex-wrap gap-1">{Array.from({length:count},(_,i)=><button key={i} type="button" role="tab" aria-selected={index===i} className={`rounded px-2 py-1 text-[11px] ${index===i?'bg-primary/15 text-primary':'bg-muted/40 text-muted-foreground hover:bg-muted'}`} onClick={()=>setSelectedRound(i)}>第 {i+1} 次</button>)}</div></div>

  <Part title="方向" role="必要不充分 · 位置那一刻须全部满足" testId="addition-prerequisites" info={<p>方向条件本身不会触发加仓：只有在「位置」达到的那一刻，下列指标和涨幅门槛全部满足，这次加仓才成立；不满足就等下一个位置。指标只读当时最后一根已收盘 K 线。</p>}>
   {d.extraConditions.length?<div className="space-y-1.5">{d.extraConditions.map(prerequisiteRow)}</div>:<p className="text-[10px] text-muted-foreground">未设指标方向条件</p>}
   <button type="button" disabled={!d.enabled} className="text-[11px] text-primary disabled:opacity-40" onClick={()=>patch({extraConditions:[...d.extraConditions,{choice:choices[0]?.key??'',direction:'>',threshold:'0'}]})}>＋ 添加方向条件</button>
   <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><label className="inline-flex items-center gap-1.5"><input type="checkbox" aria-label="启用加仓涨幅门槛" disabled={!d.enabled} checked={d.gainEnabled} onChange={e=>patch({gainEnabled:e.target.checked})}/>相对当前持仓均价上涨 ≥</label>
    <input aria-label="加仓涨幅门槛" type="number" min="0" step="any" disabled={!d.enabled||!d.gainEnabled} className={field+' w-16'} value={d.minGainPct} onChange={e=>patch({minGainPct:e.target.value})}/>%</div>
  </Part>

  <Part title="位置" role="必要充分 · 达到即加仓" testId="addition-timing" info={<div className="space-y-2">
   <p>箱体位置：只在 5 分钟收盘确认事件后、下一分钟开盘模拟加仓；每个箱体最多加仓一次，候选箱体不参与。{d.structure.algorithm==='dbl5'?'DBL-5 的「支撑抬高」包含完整台阶与内部箱底抬高。':'SBS-5M 的确认已包含冻结后的独立测试；回踩只用正式支撑的再次测试成功事件。'}</p>
   <p>自选指标：读数越过门槛即触发。原探测算法：任一原探测算法以更严格的门槛再次命中即触发（调整量为原门槛绝对值 × 百分比，原门槛为 0 时按 1 个单位）。</p>
   <p>均衡线 K：{box?'先由箱体算法找到支撑（已确认的箱体下轨，或 SBS 固定失效线），再减去设定的 5 分钟 ATR(14) 倍数（或基准价格的百分比），向下对齐报价步长；新 K 不得低于上一次的 K。':'K＝加仓价 T 减去设定的 5 分钟 ATR(14) 倍数。'}加仓币数按均衡公式唯一确定：Q×(K−S)＋本轮可用落袋利润 P＝新增币数×(T−K)。K 越低，同一位置可加的币数通常越少。K 同时是本次加仓后的止损线。</p>
   <p>入场距离：加仓价 T 高于成本线 S 的距离须达到设定的 5 分钟 ATR(14) 倍数，否则这次不加仓。</p>
  </div>}>
   <div className="grid grid-cols-2 gap-2">
    <label className="space-y-1 text-[10px] text-muted-foreground">位置算法<select aria-label="加仓条件来源" disabled={!d.enabled} value={d.source} className={field+' w-full'} onChange={e=>patch({source:e.target.value as AdditionDraft['source'],choice:d.choice||choices[0]?.key||'',...(e.target.value==='structure'?{structure:defaultStructureAddition(d.structure.algorithm,defs)}:{})})}><option value="structure">箱体 · DBL / SBS</option><option value="custom">自选指标</option><option value="detector">原探测算法再次命中</option></select></label>
    {box&&<label className="space-y-1 text-[10px] text-muted-foreground">箱体算法<select aria-label="箱体加仓算法" className={field+' w-full'} disabled={!d.enabled} value={d.structure.algorithm} onChange={e=>patch({structure:defaultStructureAddition(e.target.value as StructureAdditionRule['algorithm'],defs),structureBuffer:'.5'})}><option value="dbl5">DBL-5 · 达瓦斯下轨</option><option value="sbs5m">SBS-5M · 台阶支撑</option></select></label>}
   </div>
   {box&&<label className="flex items-center gap-2 text-[11px] text-muted-foreground">触发事件<select aria-label="箱体加仓时机" className={field+' flex-1'} disabled={!d.enabled} value={d.structure.trigger} onChange={e=>patch({structure:{...d.structure,trigger:e.target.value as StructureAdditionRule['trigger']}})}><option value="raise">支撑抬高确认</option><option value="confirm">新箱体确认（含基准）</option>{d.structure.algorithm==='sbs5m'&&<option value="retest">独立回踩成功</option>}</select></label>}
   {d.source==='custom'&&indicator(d,'加仓{x}',change=>patch(change))}
   {d.source==='detector'&&<label className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">沿原探测方向提高门槛<input aria-label="加仓门槛提高幅度" type="number" step="any" min="0" disabled={!d.enabled} value={d.stricterPct} onChange={e=>patch({stricterPct:e.target.value})} className={field+' w-20'}/>%</label>}
   {box?<><div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="shrink-0">均衡线 K＝</span><select aria-label="箱体K基准" className={field} disabled={!d.enabled} value={d.structure.kBasis} onChange={e=>patch({structure:{...d.structure,kBasis:e.target.value as StructureAdditionRule['kBasis']}})}><option value="support">已确认的箱体下轨</option>{d.structure.algorithm==='sbs5m'&&<option value="invalidation">SBS 固定失效线</option>}</select><span>−</span><input aria-label="箱体支撑冗余" type="number" min="0" step="any" disabled={!d.enabled} value={d.structureBuffer} onChange={e=>patch({structureBuffer:e.target.value})} className={field+' w-16'}/><select aria-label="箱体冗余单位" className={field} disabled={!d.enabled} value={d.structure.bufferUnit} onChange={e=>patch({structure:{...d.structure,bufferUnit:e.target.value as StructureAdditionRule['bufferUnit']}})}><option value="atr">× 5m ATR(14)</option><option value="percent">% 基准价格</option></select></div></>
   :<label className="flex items-center gap-1.5 font-mono text-[11px]"><span className="shrink-0 text-muted-foreground">均衡线 K＝T−</span><input aria-label="K回撤ATR倍数" type="number" min="0" step="any" disabled={!d.enabled} value={d.supportOffsetAtr} onChange={e=>patch({supportOffsetAtr:e.target.value})} className={field+' w-16'}/><span className="shrink-0 text-muted-foreground">× ATR</span></label>}
   <label className="flex items-center gap-1.5 font-mono text-[11px]"><span className="shrink-0 text-muted-foreground">入场距离 T ≥ S＋</span><input aria-label="T高于S的ATR倍数" type="number" min="0" step="any" disabled={!d.enabled} value={d.entryBufferAtr} onChange={e=>patch({entryBufferAtr:e.target.value})} className={field+' w-16'}/><span className="shrink-0 text-muted-foreground">× ATR</span></label>
  </Part>

  <Part title="卖出" role="必要充分 · 任一达标即卖出全部持仓" testId="addition-sell" info={<div className="space-y-2">
   <p>这里的卖出条件与 ④ 硬性终止并列：任何一个先达标，都立即卖出全部仓位（含各次加仓买入的部分）。</p>
   <p>碰到均衡线 K：本次加仓后价格跌到「位置」里的均衡线 K 即卖出全部持仓，跳空按开盘价；同一分钟先后不明时优先止损。这一条始终生效。</p>
   <p>否决条件：本次加仓实际成交后开始检查，可添加多条，任一条达标即卖出全部持仓；条件类型与 ④ 硬性终止相同（静态 / 动态回撤、1 / 5 分钟内跌幅、指标、加仓止盈约束）。后面某次加仓没有另设时，继续沿用这里的条件。</p>
   <p>与硬性终止：「同类替换」时，这里的某类条件替换硬性终止里的同类条件（如动态回撤 20% 改为 15%），其他硬性终止条件照常生效；「整组替换」时只用这里的条件。回撤峰值可沿用持仓最高价，或从本次加仓成交价重新记录。这两项对各次加仓通用。</p>
   <p>改用的卖出算法：本次加仓实际成交后，普通卖出算法换成这里设置的指标，直到下一次加仓另有设置；未设置则沿用之前的卖出算法。半仓镜像与硬性终止继续生效。</p>
  </div>}>
   <label className="flex items-center gap-1.5 text-[11px]" data-testid="addition-sell-k"><input type="checkbox" className="h-3 w-3" checked disabled aria-label="碰到均衡线K卖出"/>碰到均衡线 K 即卖出<span className="text-[10px] text-muted-foreground">（始终生效）</span></label>
   {vetoStages&&setVetoStages&&(()=>{
    const n=index+1,at=vetoStages.stages.findIndex(s=>Number(s.afterAdditions)===n),stage=at<0?undefined:vetoStages.stages[at];
    const put=(conditions:HoldingVetoDraft[])=>{const rest=vetoStages.stages.filter((_,i)=>i!==at);
     const stages=conditions.length?[...rest,{afterAdditions:String(n),conditions}].sort((a,b)=>Number(a.afterAdditions)-Number(b.afterAdditions)):rest;
     setVetoStages({...vetoStages,enabled:stages.length>0,stages});};
    return <div className="space-y-2" data-testid="addition-sell-vetoes">
     <FishQualityHoldingVetoEditor compact labelPrefix={`第 ${n} 次加仓后 `} draft={stage?.conditions??[]} setDraft={put}/>
     {stage&&<div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-[10px] text-muted-foreground">与硬性终止（各次通用）<select aria-label="一票次数切换条件范围" className={field+' w-full'} value={vetoStages.mode} onChange={e=>setVetoStages({...vetoStages,mode:e.target.value as VetoStagesDraft['mode']})}><option value="overlay">同类替换，其余并存</option><option value="replace">整组替换</option></select></label>
      <label className="space-y-1 text-[10px] text-muted-foreground">回撤峰值（各次通用）<select aria-label="一票次数切换峰值口径" className={field+' w-full'} value={vetoStages.peakBasis} onChange={e=>setVetoStages({...vetoStages,peakBasis:e.target.value as VetoStagesDraft['peakBasis']})}><option value="stage">从本次加仓价重新记录</option><option value="holding">沿用持仓最高价</option></select></label>
     </div>}
    </div>;
   })()}
   <label className="inline-flex items-center gap-1.5 text-[11px]"><input type="checkbox" aria-label={`第 ${index+1} 次加仓后改用卖出算法`} checked={d.sellSwitch.enabled} onChange={e=>patch({sellSwitch:{...d.sellSwitch,enabled:e.target.checked,choice:d.sellSwitch.choice||choices[0]?.key||''}})}/>本次加仓后改用卖出算法</label>
   {d.sellSwitch.enabled&&indicator(d.sellSwitch,`第 ${index+1} 次加仓后卖出 {x}`,change=>patch({sellSwitch:{...d.sellSwitch,...change}}),false)}
  </Part>
  {!!all.laterSellStages?.length&&<p className="text-[10px] text-muted-foreground">另有 {all.laterSellStages.length} 个卖出切换设在第 {all.laterSellStages.map(s=>s.afterAdditions).join('、')} 次加仓后，超过最多加仓次数，暂不生效（已保留）。</p>}
  {!!vetoStages?.stages.some(s=>Number(s.afterAdditions)>count)&&<p className="text-[10px] text-muted-foreground">另有否决条件设在第 {vetoStages.stages.filter(s=>Number(s.afterAdditions)>count).map(s=>s.afterAdditions).join('、')} 次加仓后，超过最多加仓次数，暂不生效（已保留）。</p>}
 </section>;
}
