import { useMemo } from 'react';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { defaultQualityAddition, qualityAdditionConditions, validateQualityAddition, type QualityAdditionRule } from '@/lib/fish/qualityAddition';
import { qualityFilterChoices, makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
interface ConditionDraft {choice:string;direction:'<'|'>';threshold:string}
export interface AdditionDraft extends ConditionDraft { enabled:boolean;source:'detector'|'custom';stricterPct:string;quantityMode:'calculator'|'entry'|'fixed';quantity:string;repeat:boolean;extraConditions:ConditionDraft[];gainEnabled:boolean;minGainPct:string }
const conditionDraft=(f?:ReturnType<typeof qualityAdditionConditions>[number]):ConditionDraft=>({choice:f?f.snapshot.featureId+':'+f.metric:'',direction:f?.direction??'>',threshold:f?String(f.threshold):''});
export function additionDraft(rule=defaultQualityAddition()):AdditionDraft {
 const conditions=qualityAdditionConditions(rule);
 return {enabled:rule.enabled,source:rule.source,stricterPct:String(rule.stricterPct),quantityMode:'calculator',quantity:'1',repeat:rule.repeat!==false,...conditionDraft(conditions[0]),extraConditions:conditions.slice(1).map(conditionDraft),gainEnabled:rule.minGainPct!=null,minGainPct:String(rule.minGainPct??5)};
}
export function parseAdditionDraft(d: AdditionDraft, defs: readonly DeepDigFeatureDef[]): QualityAdditionRule {
 const rule:QualityAdditionRule={enabled:d.enabled,source:d.source,stricterPct:d.stricterPct.trim()?Number(d.stricterPct):NaN,quantityMode:'calculator',quantity:1,repeat:d.repeat};
 if(d.source==='custom'){
  const conditions=[d,...d.extraConditions].flatMap(row=>{try{return [makeQualityBuyFilter(row.choice,row.direction,row.threshold.trim()?Number(row.threshold):NaN,true,defs)];}catch(error){if(d.enabled)throw error;return [];}});
  rule.condition=conditions[0];if(conditions.length>1)rule.conditions=conditions;
 }
 if(d.gainEnabled){rule.minGainPct=d.minGainPct.trim()?Number(d.minGainPct):NaN;}
 validateQualityAddition(rule);return rule;
}
const field='h-8 min-w-0 rounded-md border border-border/60 bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40';
export function FishQualityAdditionEditor({draft:d,setDraft}:{draft:AdditionDraft;setDraft:(draft:AdditionDraft)=>void}) {
 const defs=useFeatureDefinitions(),choices=useMemo(()=>qualityFilterChoices(defs),[defs]);
 const features=[...new Map(choices.map(c=>[c.featureId,c.group])).entries()];
 const patch=(p:Partial<AdditionDraft>)=>setDraft({...d,...p});
 const indicatorRow=(row:ConditionDraft,index:number)=>{
  const suffix=index?` ${index+1}`:'',feature=choices.find(c=>c.key===row.choice)?.featureId??'';
  const update=(change:Partial<ConditionDraft>)=>index?patch({extraConditions:d.extraConditions.map((item,i)=>i===index-1?{...item,...change}:item)}):patch(change);
  return <div key={index} className="space-y-2 rounded border border-border/60 p-2" data-testid="addition-indicator-condition">
   <div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>指标条件 {index+1}</span>{index>0&&<button type="button" disabled={!d.enabled} aria-label={`删除加仓指标 ${index+1}`} onClick={()=>patch({extraConditions:d.extraConditions.filter((_,i)=>i!==index-1)})}>删除</button>}</div>
   <div className="grid grid-cols-2 gap-2"><select aria-label={'加仓特征值'+suffix} disabled={!d.enabled} value={feature} className={field} onChange={e=>update({choice:choices.find(c=>c.featureId===e.target.value)!.key})}><option value="" disabled>选择特征值</option>{features.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><select aria-label={'加仓指标变量'+suffix} disabled={!d.enabled} value={row.choice} className={field} onChange={e=>update({choice:e.target.value})}><option value="" disabled>选择变量</option>{choices.filter(c=>c.featureId===feature).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
   <div className="flex items-center gap-2"><select aria-label={'加仓方向'+suffix} className={field+' w-16'} disabled={!d.enabled} value={row.direction} onChange={e=>update({direction:e.target.value as '<'|'>'})}><option value=">">&gt;</option><option value="<">&lt;</option></select><input aria-label={'加仓指标门槛'+suffix} className={field+' w-28'} disabled={!d.enabled} type="number" step="any" value={row.threshold} onChange={e=>update({threshold:e.target.value})}/></div>
  </div>;
 };
 return <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3" data-testid="quality-addition-editor">
  <div className="flex items-start justify-between gap-3"><div><h4 className="text-xs font-medium">条件加仓</h4><p className="mt-1 text-[10.5px] text-muted-foreground">{d.quantityMode==='calculator'&&d.repeat?'先完成半仓镜像，再按剩余仓位计算多轮加仓':'半仓镜像成交后，持仓期间最多加仓一次'}</p></div><label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"><input aria-label="启用条件加仓" type="checkbox" checked={d.enabled} onChange={e=>patch({enabled:e.target.checked})} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"/>启用</label></div>
  <label className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">条件算法<select aria-label="加仓条件来源" disabled={!d.enabled} value={d.source} className={field+' flex-1'} onChange={e=>patch({source:e.target.value as AdditionDraft['source'],choice:d.choice||choices[0]?.key||''})}><option value="detector">原探测算法再次命中</option><option value="custom">自选指标与门槛</option></select></label>
  {d.source==='detector'?<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span>沿原探测方向提高门槛</span><input aria-label="加仓门槛提高幅度" type="number" step="any" min="0" disabled={!d.enabled} value={d.stricterPct} onChange={e=>patch({stricterPct:e.target.value})} className={field+' w-20'}/>%<p className="w-full text-[10px] leading-relaxed">任一原探测算法再次达标可触发，保留其附加约束。大于方向提高数值、小于方向降低数值，调整量为原门槛绝对值 × 此百分比；原门槛为 0 时按 1 个原值单位计算。</p></div>:
   <div className="space-y-2"><p className="text-[10px] text-muted-foreground">以下指标与涨幅门槛须在同一时刻全部满足。</p>{[d,...d.extraConditions].map(indicatorRow)}<button type="button" disabled={!d.enabled} className="text-[11px] text-primary disabled:opacity-40" onClick={()=>patch({extraConditions:[...d.extraConditions,{choice:choices[0]?.key??'',direction:'>',threshold:'0'}]})}>＋ 添加指标条件</button></div>}
  <div className="space-y-2 rounded border border-border/60 p-2">
   <label className="inline-flex items-center gap-1.5 text-[11px]"><input type="checkbox" aria-label="启用加仓涨幅门槛" disabled={!d.enabled} checked={d.gainEnabled} onChange={e=>patch({gainEnabled:e.target.checked})}/>涨幅门槛</label>
   {d.gainEnabled&&<><div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span>相对当前持仓均价</span><span>上涨 ≥</span><input aria-label="加仓涨幅门槛" type="number" min="0" step="any" disabled={!d.enabled} className={field+' w-16'} value={d.minGainPct} onChange={e=>patch({minGainPct:e.target.value})}/>%</div><p className="text-[10px] text-muted-foreground">按指标确认时已收盘的价格判断；每次加仓后更新实际持仓均价；涨幅与指标同时达标才加仓。</p></>}
  </div>
  <div className="space-y-1 text-[11px]"><p><span className="text-muted-foreground">加仓数量</span> · 按平衡公式自动计算</p><p className="font-mono text-[10px] text-muted-foreground">T ≥ S＋2×ATR · K＝T−1.5×ATR</p><p className="text-[10px] text-muted-foreground">ATR 为加仓时已收盘的 5 分钟 ATR(14)。动态成本线 S 首轮取买入价，之后取上轮 K。</p></div>
  {d.quantityMode==='calculator'&&<div className="space-y-2 text-[10px] text-muted-foreground"><label className="inline-flex items-center gap-1.5"><input type="checkbox" aria-label="允许多轮加仓" disabled={!d.enabled} checked={d.repeat} onChange={e=>patch({repeat:e.target.checked})}/>允许多轮加仓</label><p className="font-medium text-foreground/80">首轮把半仓镜像已落袋利润一并计入加仓数量；用过的利润后续不再重复使用。</p></div>}
  <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">计算与执行说明</summary><div className="mt-2 space-y-2">{d.quantityMode==='calculator'&&<p className="mt-2 leading-relaxed">首次加仓须在半仓镜像（卖出初始币数 50%）实际成交之后，最早从下一分钟起检查条件；未启用半仓镜像或尚未成交时不加仓。首轮计算基准 Q 为镜像后的剩余币数，后续按当时剩余总币数计算。首轮成本线 S 为首次买入价；加仓后 S 更新为本轮 K。实际加仓价 T 必须至少高于动态成本线 S 两个 ATR，未满足时不加仓，S 和止损线均不改变。K 是本次平衡线：Q×(K−S)＋本轮可用落袋利润 P＝新增币数×(T−K)，由此唯一确定币数；已用利润不重复使用。K 同时作为实际止损线：触线卖出剩余持仓，跳空按开盘价；同分钟先后不明时优先止损。落袋利润先补足退回 K 时的旧仓亏损，剩余部分再除以 T−K，折算为新增币数。</p>}
  <p className="text-[10px] leading-relaxed text-muted-foreground">首次加仓必须在半仓镜像成交之后。只用新确认的原周期收盘读数，达标后按下一分钟开盘价模拟加仓；不继承开仓前的命中状态，公式预热历史保留。续算不会重复加仓，同一开盘时点卖出与加仓同时触发时优先卖出。信号库没有原探测算法时，请选择自选指标；自定义公式可先在 Deep Dig 中新增。</p>
  <p className="text-[10px] leading-relaxed text-muted-foreground">加仓币数按所选方式确定，成交金额 = 加仓币数 × 加仓成交价。加仓后按各次成交数量和价格计算成本，收益率 = 总盈亏 ÷ 累计投入。止盈、否决和分段切换仍以首次买入价为基准；部分镜像止盈只卖初始币数，100% 则卖出当时全部持仓。保存后点击「开始监测」生效，旧轮次保留。</p>
  </div></details>
 </section>;
}
