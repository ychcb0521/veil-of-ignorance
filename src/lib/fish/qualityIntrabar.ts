/** Causal, one-minute replay of a forming indicator candle. */
import { evaluateOnBars } from '@/lib/deepDig/features';
import { createFormulaEvaluationCache } from '@/lib/deepDig/formula';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { compileFishProgram, type FishProgram } from './algorithm';
import type { FishReconstructionLoader } from './reconstruction';
import { fishDelay, validateFishBars } from './shared';
import { formatUTC8 } from '@/lib/timeFormat';
import { activeHoldingVetoes, advanceQualityHolding, holdingVetoReading, qualityConditionMet, type QualityExitCause, type QualityHoldingPath, type QualityHoldingVeto, type QualityOperator } from './qualityVeto';

const MINUTE = 60_000;
export interface QualityTrigger {
  at: number; reading: number; cause?: QualityExitCause; atOpen?:boolean;
  /** Indicator candle being observed; its eventual close is never read. */
  barOpenTime?: number;
  previous?: { at: number; reading: number };
}
const sum = (a: number | null | undefined,b: number | null | undefined) => a != null && b != null && Number.isFinite(a) && Number.isFinite(b) ? a + b : null;
export function aggregateQualityMinute(previous: ResearchBar | undefined, minute: ResearchBar, step: number): ResearchBar {
  const openTime = Math.floor(minute.openTime / step) * step;
  if (!previous || previous.openTime !== openTime) {
    if (minute.openTime !== openTime) throw new Error('形成中指标 K 线缺少起始分钟，不能补造读数');
    return { ...minute,openTime };
  }
  return { ...previous, high:Math.max(previous.high,minute.high),low:Math.min(previous.low,minute.low),close:minute.close,
    volume:previous.volume+minute.volume,quoteVolume:sum(previous.quoteVolume,minute.quoteVolume),
    takerBuyVolume:sum(previous.takerBuyVolume,minute.takerBuyVolume),takerBuyQuoteVolume:sum(previous.takerBuyQuoteVolume,minute.takerBuyQuoteVolume),
    refClose:minute.refClose };
}
let priceBase: FishProgram | undefined;
function minuteTransport(plan: FishProgram): FishProgram {
  priceBase ??= compileFishProgram({id:'quality-intrabar-price',name:'分钟行情',short:'分钟',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'},
    {statistic:'结果',direction:'>',threshold:0,constraints:[]});
  // The transport must supply the selected formula's inputs, including per-minute
  // BTC closes and taker amounts. The indicator itself keeps its ORIGINAL period.
  return {...priceBase,usesTaker:plan.usesTaker,compiled:{...priceBase.compiled,usesBtc:plan.compiled.usesBtc,usesAmounts:plan.compiled.usesAmounts}};
}

export interface QualityIntrabarCondition {
  plan: FishProgram; scale: number; rule: {direction:QualityOperator;threshold:number}; cause?:QualityExitCause;
}
export async function findQualityIntrabarExit(o: {
  row: TradeSignal; plan: FishProgram; scale: number; rule: { direction:'<'|'>';threshold:number };
  entry: number; since: number; end: number; resumed: boolean; load: FishReconstructionLoader; signal: AbortSignal;
  conditions?: QualityIntrabarCondition[]; vetoes?: readonly QualityHoldingVeto[]; holding?:QualityHoldingPath;
}): Promise<{ trigger?: QualityTrigger; prices: ResearchBar[] }> {
  const {signal}=o;
  // Check all conditions on the SAME chronological observations. Never search one
  // condition to the end and accidentally overlook an earlier veto from another.
  const inputs:QualityIntrabarCondition[]=[...[...(o.conditions??[])].sort((a,b)=>(a.cause?.id??'').localeCompare(b.cause?.id??'')),{plan:o.plan,scale:o.scale,rule:o.rule}];
  const streams=[];
  for(const c of inputs) {
    if (!(c.plan.step>=MINUTE) || c.plan.step%MINUTE!==0) throw new Error('盘中复原要求指标周期为整数分钟');
    const start=Math.floor(o.since/c.plan.step)*c.plan.step,from=start-c.plan.warm*c.plan.step;
    if(from<0) throw new Error('盘中复原的公式预热历史不足');
    const history=[...await o.load(o.row,from,start,c.plan,signal)];
    validateFishBars(history,start,c.plan.warm,c.plan.step);
    streams.push({...c,start,history,cache:createFormulaEvaluationCache(),partial:undefined as ResearchBar|undefined,previous:undefined as QualityTrigger['previous']});
  }
  let holding=o.holding;
  const risk=activeHoldingVetoes(o.vetoes).filter(v=>v.kind!=='indicator').sort((a,b)=>a.id.localeCompare(b.id));
  if(risk.length&&!holding) throw new Error('持仓一票否决缺少买入价和回撤路径');
  const riskPrevious=new Map(risk.map(v=>[v.id,{at:o.since,reading:holdingVetoReading(holding!,v.kind as 'static-drawdown'|'dynamic-drawdown')}]));
  const checkFrom=o.resumed?o.since+MINUTE:o.entry;
  const checkRisk=(at:number,path:QualityHoldingPath|undefined):QualityTrigger|undefined=>{
    for(const v of risk) {
      const reading=holdingVetoReading(path!,v.kind as 'static-drawdown'|'dynamic-drawdown');
      // Inclusive percentage thresholds tolerate only floating-point roundoff.
      if(reading>=v.threshold||Math.abs(reading-v.threshold)<=Number.EPSILON*32*Math.max(1,Math.abs(reading),Math.abs(v.threshold)))return {at,reading,barOpenTime:at-MINUTE,previous:riskPrevious.get(v.id),cause:{id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold}};
      riskPrevious.set(v.id,{at,reading});
    }
  };
  const check=(at:number):QualityTrigger|undefined=>{
    if(at<(o.resumed?o.since:o.entry))return;
    if(at>=checkFrom) {const trigger=checkRisk(at,holding);if(trigger)return trigger;}
    let matched:QualityTrigger|undefined,error:string|undefined;
    for(const s of streams) {
      const bars=s.partial?[...s.history,s.partial]:s.history;
      const out=evaluateOnBars(bars,s.plan.compiled,s.plan.def,s.cache).vars.get(s.plan.averageName);
      const reading=(typeof out==='number'?out:out?.[bars.length-1]??NaN)*s.scale;
      if(!Number.isFinite(reading)) {error??=`盘中指标存在缺失读数：${o.row.symbol}，入场 ${formatUTC8(o.entry)}，观测 ${formatUTC8(at)}；不能越过缺口判断成交`;continue;}
      if(at>=checkFrom&&qualityConditionMet(reading,s.rule.direction,s.rule.threshold))matched??={at,reading,barOpenTime:s.partial?.openTime??s.history.at(-1)!.openTime,previous:s.previous,cause:s.cause};
      s.previous={at,reading};
    }
    if(matched)return matched;
    if(error)throw new Error(error);
  };
  const start=Math.min(...streams.map(s=>s.start)),prices:ResearchBar[]=[];
  if(start===(o.resumed?o.since:o.entry)) {
    const trigger=check(start);if(trigger)return {trigger,prices};
  }
  const transport=minuteTransport(o.plan);
  transport.usesTaker=streams.some(s=>s.plan.usesTaker);
  transport.compiled={...transport.compiled,usesBtc:streams.some(s=>s.plan.compiled.usesBtc),usesAmounts:streams.some(s=>s.plan.compiled.usesAmounts)};
  for(let cursor=start;cursor<o.end;) {
    if(signal.aborted)throw new DOMException('已暂停','AbortError');
    const cut=Math.min(o.end,cursor+500*MINUTE),minutes=await o.load(o.row,cursor,cut,transport,signal);
    validateFishBars(minutes,cut,(cut-cursor)/MINUTE,MINUTE);
    for(let i=0;i<minutes.length;i++) {
      if(signal.aborted)throw new DOMException('已暂停','AbortError');
      const minute=minutes[i];
      if(holding&&minute.openTime>=o.since) {
        // The open is already observable. A gap through a price veto must not
        // wait another minute, and none of this candle's future H/L/C is read.
        const opening=advanceQualityHolding(holding,{...minute,high:minute.open,low:minute.open,close:minute.open});
        const trigger=checkRisk(minute.openTime,opening);
        if(trigger) {prices.push(minute);return {trigger:{...trigger,barOpenTime:minute.openTime,atOpen:true},prices};}
      }
      for(const s of streams)if(minute.openTime>=s.start)s.partial=aggregateQualityMinute(s.partial,minute,s.plan.step);
      if(minute.openTime>=o.since) {prices.push(minute);if(holding)holding=advanceQualityHolding(holding,minute);}
      const at=minute.openTime+MINUTE,trigger=check(at);
      if(trigger) {if(minutes[i+1])prices.push(minutes[i+1]);return {trigger,prices};}
      for(const s of streams)if(s.partial&&at%s.plan.step===0) {s.history.push(s.partial);s.partial=undefined;}
      if(i%20===19)await fishDelay(0,signal);
    }
    cursor=cut;
    for(const s of streams)if(s.history.length>s.plan.warm+500) {s.history=s.history.slice(-s.plan.warm);s.cache=createFormulaEvaluationCache();}
    await fishDelay(0,signal);
  }
  return {prices};
}
