/** Independent, causal entry observations. Never replay or replace an exit to fill this column. */
import type {ResearchBar} from '@/lib/deepRsa/window';
import type {TradeSignal} from '@/lib/signalLibrary';
import type {FishQualityStudy,QualityGroup,QualityResult,QualityProgress} from './quality';
import {qualityMetricPlan} from './quality';
import type {FishSnapshot} from './algorithm';
import {evaluateFishProgram} from './algorithm';
import {aggregateQualityMinute,minuteTransport} from './qualityIntrabar';
import {activeHoldingVetoes} from './qualityVeto';
import {validateFishBars} from './shared';
import type {FishReconstructionLoader} from './reconstruction';
export interface QualityEntryPart {id:'main'|'before'|'after';label:string;metric:string;snapshot:FishSnapshot}
export interface QualityEntryTarget {source:TradeSignal;result:QualityResult;plan:QualityGroup;part:QualityEntryPart}
export interface QualityEntryReading {key:string;evaluatedAt:number;entryTime:number;mode:'intrabar'|'closed';metric:string;value?:number;at?:number;barOpenTime?:number;error?:string}
export const qualityEntryParts=(p:QualityGroup):QualityEntryPart[]=>[{id:p.combo?'before':'main',label:p.combo?`${p.combo.beforeLabel}（前段·入场生效）`:p.label,metric:p.rule?.metric??p.metric,snapshot:p.snapshot},...(p.combo?[{id:'after' as const,label:`${p.combo.after.label}（后段·入场参考）`,metric:p.combo.after.rule.metric,snapshot:p.combo.after.snapshot}]:[])];
export const qualityEntryMode=(p:QualityGroup):QualityEntryReading['mode']=>p.execution==='intrabar-1m'||activeHoldingVetoes(p.holdingVetoes).length>0||!!p.combo?'intrabar':'closed';
export function qualityEntryKey(source:TradeSignal,result:QualityResult|undefined,p:QualityGroup,part:QualityEntryPart):string|null {
 if(!result||!['waiting','open','closed'].includes(result.status)||!Number.isFinite(result.entryTime)||!(result.entryTime!>0)||!Number.isFinite(result.entryPrice)||!(result.entryPrice!>0))return null;
 const f=part.snapshot;return JSON.stringify(['sell-entry-v1',source.exchange??'binance',source.market??'crypto',source.symbol,source.underlying??null,result.entryTime,f.definitionKey,f.interval??'5m',part.metric,f.statistic??null,f.H??null,f.scale??1,qualityEntryMode(p)]);
}
export const validEntryReading=(r:QualityEntryReading|undefined)=>!!r&&!r.error&&Number.isFinite(r.value)&&Number.isFinite(r.at)&&r.at!<=r.entryTime&&(r.barOpenTime==null||Number.isFinite(r.barOpenTime)&&r.barOpenTime<=r.at!);
export function mergeQualityEntryReading(a:QualityEntryReading|undefined,b:QualityEntryReading):QualityEntryReading {if(!a||a.key!==b.key)return b;if(validEntryReading(a)&&!validEntryReading(b))return a;if(validEntryReading(b)&&!validEntryReading(a))return b;return a.evaluatedAt>b.evaluatedAt?a:b;}
export function preserveQualityEntry(saved:FishQualityStudy|undefined,incoming:FishQualityStudy):FishQualityStudy {if(!saved?.entryReadings?.length)return incoming;const map=new Map(saved.entryReadings.map(r=>[r.key,r]));for(const r of incoming.entryReadings??[])map.set(r.key,mergeQualityEntryReading(map.get(r.key),r));return {...incoming,entryReadings:[...map.values()]};}
export async function evaluateQualityEntry(t:QualityEntryTarget,load:FishReconstructionLoader,now:number,signal:AbortSignal):Promise<QualityEntryReading>{
 const key=qualityEntryKey(t.source,t.result,t.plan,t.part);if(!key)throw Error('入场读数需要有效买入记录');
 const base={key,evaluatedAt:now,entryTime:t.result.entryTime!,mode:qualityEntryMode(t.plan),metric:t.part.metric};
 const abort=()=>{if(signal.aborted)throw new DOMException('已取消','AbortError');};
 try{abort();const {plan,scale}=qualityMetricPlan(t.part.snapshot,t.part.metric),entry=Math.floor(base.entryTime/60000)*60000;
  if(entry>Math.floor(now/60000)*60000)throw Error('买入时刻尚未到达，不能提前读取');
  const cut=Math.floor(entry/plan.step)*plan.step,from=cut-(plan.warm+(base.mode==='closed'?1:0))*plan.step;
  if(from<0)throw Error('入场公式预热所需历史不足');
  const source={...t.source,timeMs:now},history=[...await load(source,from,cut,plan,signal)];abort();validateFishBars(history,cut,(cut-from)/plan.step,plan.step);
  let bars=history,at=cut;
  if(base.mode==='intrabar'&&cut<entry){const minutes=await load(source,cut,entry,minuteTransport(plan),signal);abort();validateFishBars(minutes,entry,(entry-cut)/60000,60000);let partial:ResearchBar|undefined;for(const m of minutes)partial=aggregateQualityMinute(partial,m,plan.step);if(partial)bars=[...history,partial];at=entry;}
  const value=evaluateFishProgram(bars,plan).average.at(-1)!*scale;
  if(!Number.isFinite(value))throw Error('买入时刻的算法读数缺失');
  return {...base,value,at,barOpenTime:bars.at(-1)?.openTime};
 }catch(error){abort();return {...base,error:error instanceof Error?error.message:'入场行情读取失败'};}
}
export async function collectQualityEntry(targets:readonly QualityEntryTarget[],load:FishReconstructionLoader,now:number,signal:AbortSignal,onReading:(r:QualityEntryReading)=>void,onProgress:(p:QualityProgress)=>void){
 const unique=new Map(targets.flatMap(t=>{const k=qualityEntryKey(t.source,t.result,t.plan,t.part);return k?[[k,t] as const]:[];}));let done=0;
 for(const t of unique.values()){if(signal.aborted)throw new DOMException('已取消','AbortError');onProgress({done,total:unique.size,current:t.source.symbol});const reading=await evaluateQualityEntry(t,load,now,signal);if(signal.aborted)throw new DOMException('已取消','AbortError');onReading(reading);done++;}onProgress({done,total:unique.size,current:''});
}
export function qualityEntryValues(source:TradeSignal,result:QualityResult|undefined,p:QualityGroup,readings:readonly QualityEntryReading[]=[]):string|number|null{
 const values=qualityEntryParts(p).map(part=>{const key=qualityEntryKey(source,result,p,part),r=key?readings.find(v=>v.key===key):undefined;return {part,value:validEntryReading(r)?r!.value!:null,text:!key?'未买入':r?.error?'缺数据':'待补算'};});
 if(values.length===1)return values[0].value??values[0].text;
 return values.map(v=>`${v.part.label}：${v.value??v.text}`).join('；');
}
