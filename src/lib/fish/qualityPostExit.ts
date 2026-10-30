/** Research observations after a frozen final sale. Never used by an exit/addition rule. */
import type { TradeSignal } from '@/lib/signalLibrary';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishQualityStudy, QualityGroup, QualityResult, QualitySample, QualityProgress } from './quality';
import type { FishReconstructionLoader } from './reconstruction';
import { compileFishProgram } from './algorithm';
import { FishError, validateFishBars } from './shared';

export const POST_EXIT_HOURS = [.5,1,2,4,6] as const;
export type PostExitHours = typeof POST_EXIT_HOURS[number];
export type PostExitMetric = 'peak' | 'drawdown2';
const MINUTE = 60_000;
export interface QualityPostExitWindow { hours:PostExitHours; status:'ready'|'waiting'|'error'; peakPct?:number; drawdown2Pct?:number; error?:string }
export interface QualityPostExitReading {
 key:string; evaluatedAt:number; exitTime:number; exitPrice:number; startMs:number; excludedExitMinute:boolean;
 windows:QualityPostExitWindow[];
}
export interface QualityPostExitTarget { source:TradeSignal; result:QualityResult; plan:QualityGroup }
export const postExitIntraminute = (result:QualityResult,plan:QualityGroup) => result.exitSnapshot?.atOpen!==true &&
 (result.exitSnapshot?.cause?.kind==='mirror-take-profit' || plan.vetoFill==='stop' && ['static-drawdown','dynamic-drawdown'].includes(result.exitSnapshot?.cause?.kind??''));
export function qualityPostExitKey(source:TradeSignal,result:QualityResult|undefined,plan:QualityGroup):string|null {
 if(result?.status!=='closed'||!(result.endPrice!>0)||!Number.isFinite(result.endPrice)||!(result.endTime!>0)||!Number.isFinite(result.endTime))return null;
 return JSON.stringify(['post-exit-v1',source.exchange??'binance',source.market??'crypto',source.symbol,source.underlying??null,result.endTime,result.endPrice,postExitIntraminute(result,plan)]);
}
export function postExitWindow(reading:QualityPostExitReading|undefined,hours:number){return reading?.windows.find(w=>w.hours===hours);}
export function postExitValue(reading:QualityPostExitReading|undefined,hours:number,metric:PostExitMetric):number|null {
 const w=postExitWindow(reading,hours),value=metric==='peak'?w?.peakPct:w?.drawdown2Pct;
 return w?.status==='ready'&&value!=null&&Number.isFinite(value)?value:null;
}
/** Successful windows survive stale tabs, partial refreshes and later market-data failures. */
export function mergePostExitReading(a:QualityPostExitReading|undefined,b:QualityPostExitReading):QualityPostExitReading {
 if(!a||a.key!==b.key)return b;
 const latest=a.evaluatedAt>b.evaluatedAt?a:b;
 return {...latest,windows:POST_EXIT_HOURS.map(hours=>{
  const x=postExitWindow(a,hours),y=postExitWindow(b,hours);
  if(x?.status==='ready'&&y?.status!=='ready')return x;
  if(y?.status==='ready'&&x?.status!=='ready')return y;
  return (a.evaluatedAt>b.evaluatedAt?x:y)??x??y??{hours,status:'waiting'};
 })};
}
export function preserveQualityPostExit(saved:FishQualityStudy|undefined,incoming:FishQualityStudy):FishQualityStudy {
 if(!saved?.postExitReadings?.length)return incoming;
 const values=new Map(saved.postExitReadings.map(x=>[x.key,x]));
 for(const x of incoming.postExitReadings??[])values.set(x.key,mergePostExitReading(values.get(x.key),x));
 return {...incoming,postExitReadings:[...values.values()]};
}
export function postExitNeedsData(reading:QualityPostExitReading|undefined,exitTime:number,now:number,retry=false):boolean {
 return POST_EXIT_HOURS.some(h=>{
  if(exitTime+h*3600000>Math.floor(now/MINUTE)*MINUTE)return false;
  const w=postExitWindow(reading,h);
  return w?.status!=='ready' && (w?.status!=='error'||retry||now-(reading?.evaluatedAt??0)>=300_000);
 });
}
const pricePlan=()=>compileFishProgram({id:'quality-post-exit-price',short:'卖后价格',name:'卖后反事实价格',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'}, {statistic:'结果',direction:'>',threshold:0,constraints:[]});
export async function evaluateQualityPostExit(target:QualityPostExitTarget,load:FishReconstructionLoader,now:number,signal:AbortSignal,previous?:QualityPostExitReading):Promise<QualityPostExitReading> {
 const {source,result,plan}=target,key=qualityPostExitKey(source,result,plan);
 if(!key)throw new Error('卖后反事实需要有效的最终卖出时间和价格');
 if(previous?.key!==key)previous=undefined;
 if(signal.aborted)throw new DOMException('已取消','AbortError');
 const exitTime=result.endTime!,exitPrice=result.endPrice!,excludedExitMinute=postExitIntraminute(result,plan)||exitTime%MINUTE!==0;
 // Stop/limit fills have minute precision, but their unknown pre-fill H/L cannot enter a post-sale statistic.
 const startMs=Math.ceil(exitTime/MINUTE)*MINUTE+(excludedExitMinute&&exitTime%MINUTE===0?MINUTE:0);
 const available=Math.floor(now/MINUTE)*MINUTE;
 const windows:QualityPostExitWindow[]=POST_EXIT_HOURS.map(hours=>({...postExitWindow(previous,hours),hours,status:postExitWindow(previous,hours)?.status??'waiting'}));
 const needed=windows.filter(w=>w.status!=='ready'&&exitTime+w.hours*3600000<=available);
 if(!needed.length)return {key,evaluatedAt:now,exitTime,exitPrice,startMs,excludedExitMinute,windows};
 const pp=pricePlan(),row={...source,timeMs:now};
 const last=Math.max(...needed.map(w=>Math.floor((exitTime+w.hours*3600000)/MINUTE)*MINUTE));
 let bulk:readonly ResearchBar[]|undefined,bulkError:unknown;
 try{bulk=await load(row,startMs,last,pp,signal);}catch(error){if(signal.aborted)throw error;bulkError=error;}
 for(const w of needed){
  const end=Math.floor((exitTime+w.hours*3600000)/MINUTE)*MINUTE;
  try{
   if(signal.aborted)throw new DOMException('已取消','AbortError');
   if(bulkError instanceof FishError&&bulkError.kind==='banned')throw bulkError;
   const bars=bulk?bulk.filter(b=>b.openTime>=startMs&&b.openTime+MINUTE<=end):await load(row,startMs,end,pp,signal);
   validateFishBars(bars,end,(end-startMs)/MINUTE,MINUTE);
   let high=exitPrice,low=exitPrice;
   for(const b of bars){
    if(![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close))throw new Error('卖后行情价格无效');
    high=Math.max(high,b.high);low=Math.min(low,b.low);
   }
   const peakPct=Math.max(0,(high/exitPrice-1)*100),drawdown2Pct=Math.max(0,(exitPrice-low)/exitPrice*100);
   if(!Number.isFinite(peakPct)||!Number.isFinite(drawdown2Pct))throw new Error('卖后涨跌幅超出有效数值范围');
   w.status='ready';w.peakPct=peakPct;w.drawdown2Pct=drawdown2Pct;delete w.error;
  }catch(error){if(signal.aborted)throw error;w.status='error';delete w.peakPct;delete w.drawdown2Pct;w.error=error instanceof Error?error.message:'卖后行情读取失败';}
 }
 return mergePostExitReading(previous,{key,evaluatedAt:now,exitTime,exitPrice,startMs,excludedExitMinute,windows});
}
export async function collectQualityPostExit(targets:readonly QualityPostExitTarget[],load:FishReconstructionLoader,now:number,signal:AbortSignal,onReading:(r:QualityPostExitReading)=>void,onProgress:(p:QualityProgress)=>void,previous:readonly QualityPostExitReading[]=[]){
 const unique=new Map(targets.flatMap(t=>{const key=qualityPostExitKey(t.source,t.result,t.plan);return key?[[key,t] as const]:[];})),old=new Map(previous.map(r=>[r.key,r]));let done=0;
 for(const [key,target] of unique){if(signal.aborted)throw new DOMException('已取消','AbortError');onProgress({done,total:unique.size,current:target.source.symbol});const reading=await evaluateQualityPostExit(target,load,now,signal,old.get(key));if(signal.aborted)throw new DOMException('已取消','AbortError');onReading(reading);done++;}
 onProgress({done,total:unique.size,current:''});
}
export function postExitExportValues(source:TradeSignal,result:QualityResult|undefined,plan:QualityGroup,readings:readonly QualityPostExitReading[]=[]):(number|string|null)[]{
 const key=qualityPostExitKey(source,result,plan),reading=key?readings.find(r=>r.key===key):undefined;
 return POST_EXIT_HOURS.flatMap(h=>(['peak','drawdown2'] as const).map(metric=>postExitValue(reading,h,metric)??(!key?null:postExitWindow(reading,h)?.status==='error'?'缺数据':Date.now()<result!.endTime!+h*3600000?'待满'+h+'h':'待补算')));
}
