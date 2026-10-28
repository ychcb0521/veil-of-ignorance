/** Historical library labels are derived only from stored evidence, never current account defaults. */
import { shortFishHash, type FishSnapshot } from './algorithm';
import { fishMetricLabel, fishSourceLabel, savedFishMetric } from './records';
import { qualityDefinition, type QualityBuyFilter } from './quality';
import type { FishMiningRecord, FishMiningRun } from './miningLibrary';
import type { FishMiningRule } from './miningState';

export interface LibraryCondition {
 key:string; label:string; metric:string; rule:string; text:string; context:string; snapshot:Partial<FishSnapshot>;
 formula?:string; halfLifeHours?:number; avgHours?:number; reading?:number; rawReading?:number; evidence:string;
}
const NAMES:Record<string,string>={cbi2:'CBI-2',mbi:'MBI',ctba:'CTBA',cbi:'CBI',cba:'CBA',state:'S',cda:'CDA',bss:'BSS','drift-speed-z':'az','drift-speed':'a','seller-control':'DSP·bc'};
const definitions=new Map<string,{formula:string;interval:string;halfLifeHours:number;avgHours:number}>();
function capturedDefinition(s:Partial<FishSnapshot>){
 if(!s.definitionKey)return;
 try{
  const key=JSON.stringify([s.definitionKey,s.interval]);let saved=definitions.get(key);
  if(!saved){const def=qualityDefinition(s as FishSnapshot);saved={formula:def.formula,interval:def.interval!,halfLifeHours:def.halfLifeHours!,avgHours:def.avgHours!};if(definitions.size>256)definitions.clear();definitions.set(key,saved);}
  return saved;
 }catch{return;}
}
function fromKey(s:Partial<FishSnapshot>):Partial<FishSnapshot>{
 const p=s.algorithmKey?.split('|');if(p?.length!==6)return {};
 const threshold=p[4].trim()?Number(p[4]):NaN,H=p[2]!=='='?Number(p[2]):NaN;
 return {featureId:p[0]||undefined,statistic:p[1]||undefined,direction:p[3]==='>'||p[3]==='<'?p[3]:undefined,
  threshold:Number.isFinite(threshold)?threshold:undefined,...(Number.isFinite(H)&&H>0?{H}:{})};
}
function knownSnapshot(input:Partial<FishSnapshot>):Partial<FishSnapshot>{
 const key=fromKey(input);
 const statistic=input.statistic??key.statistic,H=input.H??key.H;
 return {...key,...Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined)),featureShort:input.featureShort??NAMES[input.featureId??key.featureId??''],scale:input.scale??(statistic&&statistic!=='结果'&&!H?1:undefined)};
}
export function libraryCondition(input:Partial<FishSnapshot>,evidence='记录快照'):LibraryCondition {
 const snapshot=knownSnapshot(input),def=capturedDefinition(snapshot),label=fishSourceLabel(snapshot),metric=fishMetricLabel(snapshot);
 const direction=snapshot.direction,threshold=snapshot.threshold;
 const rule=direction&&typeof threshold==='number'&&Number.isFinite(threshold)?`${direction} ${threshold}`:'门槛未记录';
 const scale=snapshot.scale,unit=scale===undefined?'倍率未记录':scale===1?'原值':`显示值（原值 × ${scale}）`;
 const context=`${def?.interval??snapshot.interval??'周期未记录'} · ${unit} · ${def?`公式 ${shortFishHash(snapshot.definitionKey!)}`:'公式未记录'}`;
 const rawReading=typeof snapshot.average==='number'&&Number.isFinite(snapshot.average)?snapshot.average:undefined;
 const reading=rawReading!==undefined&&typeof scale==='number'&&Number.isFinite(scale)?rawReading*scale:undefined;
 const text=`${label} · ${metric} ${rule}`;
 return {key:JSON.stringify([snapshot.featureId,metric,direction,threshold,snapshot.definitionKey,snapshot.interval,scale,snapshot.H,snapshot.constraints,snapshot.constraintKey]),
  label,metric,rule,text,context,snapshot,...(def??{}),rawReading,reading,evidence};
}
/** Filter execution uses f.metric/f.direction/f.threshold, which take precedence over decorative labels and old snapshot fields. */
export const filterLibraryCondition=(f:QualityBuyFilter)=>libraryCondition({...f.snapshot,statistic:f.metric,direction:f.direction,threshold:f.threshold,scale:1},'该轮过滤条件快照');
export function miningLibraryConditions(record:FishMiningRecord,run?:FishMiningRun):{conditions:LibraryCondition[];combination:string;note?:string;identity:string} {
 const root=record.signal.fish,mode=root?.combination??run?.combination;
 const members=root?.algorithms?.length
  ? mode==='or'?(root.hitAlgorithms??[]).map(i=>root.algorithms![i-1]).filter(Boolean):root.algorithms
  : root?[root]:[];
 const conditions=members.map(raw=>{
  const s=knownSnapshot(raw),metric=savedFishMetric(s);
  let candidates=(run?.rules??[]).filter(r=>r.featureId===s.featureId);
  if(s.statistic)candidates=candidates.filter(r=>r.statistic===s.statistic||r.statistic===metric);
  const fallback:FishMiningRule|undefined=candidates.length===1?candidates[0]:undefined;
  const missing=!s.statistic||!s.direction||!Number.isFinite(s.threshold);
  return libraryCondition({...s,statistic:s.statistic??fallback?.statistic,direction:s.direction??(fallback?'>':undefined),threshold:Number.isFinite(s.threshold)?s.threshold:(fallback?Number(fallback.threshold):undefined)},missing&&fallback?'记录快照；缺失参数由所属历史挖掘方案补全':'捕获时的算法快照');
 });
 const note=!members.length?'历史命中成员未记录':!root?.algorithms?.length&&(run?.rules.length??0)>1?'历史记录仅保存主算法，其余命中成员未记录':undefined;
 const combination=mode==='or'?'并集 · 仅列实际命中':root?.algorithms?.length?'交集 · 全部满足':'单算法';
 const identity=JSON.stringify([mode??(root?.algorithms?.length?'and':'single'),conditions.map(c=>c.key).sort(),note||conditions.some(c=>c.rule==='门槛未记录'||!c.snapshot.definitionKey||c.metric.includes('指标未记录'))?record.runId:undefined]);
 return {conditions,combination,note,identity};
}
export const libraryConditionSearch=(c:LibraryCondition)=>`${c.text} ${c.context} ${c.formula??''} 半衰期 ${c.halfLifeHours??''} 均值 ${c.avgHours??''}`;
