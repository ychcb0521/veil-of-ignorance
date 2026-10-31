/** Causal, one-minute replay of a forming indicator candle. */
import { evaluateOnBars } from '@/lib/deepDig/features';
import { createFormulaEvaluationCache } from '@/lib/deepDig/formula';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { compileFishProgram, type FishProgram } from './algorithm';
import type { FishReconstructionLoader } from './reconstruction';
import { fishDelay, validateFishBars } from './shared';
import { formatUTC8 } from '@/lib/timeFormat';
import { activeHoldingVetoes, advanceQualityHolding, holdingVetoReading, minuteDropReading, minuteDropWindow, qualityConditionMet, qualityIntrabarStop, type QualityExitCause, type QualityHoldingPath, type QualityHoldingVeto, type QualityOperator } from './qualityVeto';

import type { QualityMirrorTakeProfit, QualityMirrorFill } from './qualityMirror';

const MINUTE = 60_000;
export interface QualityTrigger {
  at: number; reading: number; cause?: QualityExitCause; atOpen?:boolean;
  /** 回撤止损在这一分钟盘中触及：按止损价成交（不是下一分钟开盘价）；fillPeak 是算止损价用的峰值。 */
  fillPrice?: number; fillPeak?: number;
  /** Indicator candle being observed; its eventual close is never read. */
  barOpenTime?: number;
  /** 组合卖出：触发的是前段（分水岭前）还是后段（分水岭后）的卖出条件。 */
  stage?: 'before' | 'after';
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
export function minuteTransport(plan: FishProgram): FishProgram {
  priceBase ??= compileFishProgram({id:'quality-intrabar-price',name:'分钟行情',short:'分钟',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'},
    {statistic:'结果',direction:'>',threshold:0,constraints:[]});
  // The transport must supply the selected formula's inputs, including per-minute
  // BTC closes and taker amounts. The indicator itself keeps its ORIGINAL period.
  return {...priceBase,usesTaker:plan.usesTaker,compiled:{...priceBase.compiled,usesBtc:plan.compiled.usesBtc,usesAmounts:plan.compiled.usesAmounts}};
}

export interface QualityIntrabarCondition {
  plan: FishProgram; scale: number; rule: {direction:QualityOperator;threshold:number}; cause?:QualityExitCause;
  /** 组合卖出的分段：before 只在涨幅未过分水岭时生效，after 只在之后生效；缺省 = 全程（持仓否决）。 */
  stage?: 'before' | 'after';
  closeOnly?: boolean;
}
export async function findQualityIntrabarExit(o: {
  row: TradeSignal; plan: FishProgram; scale: number; rule?: { direction:'<'|'>';threshold:number };
  entry: number; since: number; end: number; resumed: boolean; load: FishReconstructionLoader; signal: AbortSignal;
  mirror?: QualityMirrorTakeProfit; mirrorFill?: QualityMirrorFill;
  conditions?: QualityIntrabarCondition[]; vetoes?: readonly QualityHoldingVeto[]; holding?:QualityHoldingPath;
  /** 组合卖出：主规则属于哪一段；switchPct = 分水岭（最高价比买入价高出的百分比）。 */
  ruleStage?: 'before' | 'after'; switchPct?: number;
  /** Mirror reductions cannot change a legacy rule's original confirmation clock. */
  ruleCloseOnly?: boolean;
  ordinaryUntil?:number;
  conditionsUntil?:number;
  /** Ordinary gain-based seller keeps the full holding peak when veto peaks reset. */
  sellerPeak?:number;
}): Promise<{ trigger?: QualityTrigger; prices: ResearchBar[]; mirrorFill?: QualityMirrorFill }> {
  const {signal}=o;
  // Check all conditions on the SAME chronological observations. Never search one
  // condition to the end and accidentally overlook an earlier veto from another.
  const inputs:QualityIntrabarCondition[]=[...[...(o.conditions??[])].sort((a,b)=>(a.cause?.id??'').localeCompare(b.cause?.id??'')),...(o.rule?[{plan:o.plan,scale:o.scale,rule:o.rule,stage:o.ruleStage,closeOnly:o.ruleCloseOnly}]:[])];
  const streams=[];
  for(const c of inputs) {
    if (!(c.plan.step>=MINUTE) || c.plan.step%MINUTE!==0) throw new Error('盘中复原要求指标周期为整数分钟');
    const start=Math.floor(o.since/c.plan.step)*c.plan.step,from=start-c.plan.warm*c.plan.step;
    if(from<0) throw new Error('盘中复原的公式预热历史不足');
    const history=[...await o.load(o.row,from,start,c.plan,signal)];
    validateFishBars(history,start,c.plan.warm,c.plan.step);
    streams.push({...c,start,history,cache:createFormulaEvaluationCache(),partial:undefined as ResearchBar|undefined,previous:undefined as QualityTrigger['previous']});
  }
  let holding=o.holding, mirrorFill=o.mirrorFill,sellerPeak=o.sellerPeak??holding?.peak??0;
  if(o.switchPct!=null&&!holding) throw new Error('组合卖出缺少买入价和持仓路径');
  /**
   * 是否已过分水岭：持仓中（含当前这一分钟）最高价比买入价高出 switchPct%。
   * 在每分钟收盘时判断，所以分水岭那一分钟的收盘起就按后段条件；续算时由已记下的最大涨幅还原。
   */
  const switched=()=>o.switchPct!=null&&!!holding&&Math.max(sellerPeak,holding.peak)>=holding.entry*(1+o.switchPct/100)*(1-1e-12);
  const enabled = activeHoldingVetoes(o.vetoes);
  const risk=enabled.filter(v=>v.kind==='static-drawdown'||v.kind==='dynamic-drawdown').sort((a,b)=>a.id.localeCompare(b.id));
  const drops=enabled.filter(v=>minuteDropWindow(v.kind)>0).sort((a,b)=>a.id.localeCompare(b.id));
  const dropMinutes: ResearchBar[] = [], dropPrevious = new Map<string, { at: number; reading: number }>();
  const maxDropWindow = Math.max(0, ...drops.map(v=>minuteDropWindow(v.kind)));
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
  const checkDrop=(at:number):QualityTrigger|undefined=>{
    for(const v of drops) {
      const value=minuteDropReading(dropMinutes,minuteDropWindow(v.kind),o.entry,at);
      if(!value)continue;
      const {reading,start}=value;
      if(at>=checkFrom&&(reading>=v.threshold||Math.abs(reading-v.threshold)<=Number.EPSILON*32*Math.max(1,reading,v.threshold)))return {at,reading,barOpenTime:start,previous:dropPrevious.get(v.id),cause:{id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold}};
      dropPrevious.set(v.id,{at,reading});
    }
  };
  const check=(at:number):QualityTrigger|undefined=>{
    const drop=checkDrop(at);
    if(at<(o.resumed?o.since:o.entry))return;
    if(at>=checkFrom) {const trigger=checkRisk(at,holding);if(trigger)return trigger;}
    if(drop)return drop;
    let error:string|undefined;
    const after=switched();
    for(const s of streams) {
      if(o.conditionsUntil!=null&&at>o.conditionsUntil)continue;
      if(!s.cause&&o.ordinaryUntil!=null&&at>o.ordinaryUntil)continue;
      if(s.stage==='before'&&after||s.stage==='after'&&!after)continue;
      if(s.closeOnly && (at<=o.entry || at%s.plan.step!==0))continue;
      const bars=s.partial?[...s.history,s.partial]:s.history;
      const out=evaluateOnBars(bars,s.plan.compiled,s.plan.def,s.cache).vars.get(s.plan.averageName);
      const reading=(typeof out==='number'?out:out?.[bars.length-1]??NaN)*s.scale;
      if(!Number.isFinite(reading)) {error??=`盘中指标存在缺失读数：${o.row.symbol}，入场 ${formatUTC8(o.entry)}，观测 ${formatUTC8(at)}；不能越过缺口判断成交`;continue;}
      // A confirmed veto closes immediately; later conditions need not also qualify or finish evaluating.
      if(at>=checkFrom&&qualityConditionMet(reading,s.rule.direction,s.rule.threshold))return {at,reading,barOpenTime:s.partial?.openTime??s.history.at(-1)!.openTime,previous:s.previous,cause:s.cause,...(s.stage?{stage:s.stage}:{})};
      s.previous={at,reading};
    }
    if(error)throw new Error(error);
  };
  const replayStart=streams.length?Math.min(...streams.map(s=>s.start)):o.since;
  // Re-read at most five past minutes on resume, solely to restore the rolling window and previous reading.
  const start=maxDropWindow?Math.min(replayStart,Math.max(o.entry,o.since-maxDropWindow*MINUTE)):replayStart,prices:ResearchBar[]=[];
  if(start===(o.resumed?o.since:o.entry)) {
    const trigger=check(start);if(trigger)return {trigger,prices,mirrorFill};
  }
  const mirrorAt=(minute:ResearchBar,openingOnly:boolean):QualityTrigger|undefined=>{
    if(!o.mirror?.enabled || mirrorFill || !holding || minute.openTime<o.since)return;
    const target=holding.entry*(1+o.mirror.gainPct/100),observed=openingOnly?minute.open:minute.high;
    if (!Number.isFinite(target)) throw new Error('镜像止盈价格超出可计算范围，请降低涨幅阈值');
    if(observed<target && Math.abs(observed-target)>target*1e-12)return;
    const atOpen=minute.open>=target,price=atOpen?minute.open:target;
    mirrorFill={at:minute.openTime,price,fraction:o.mirror.sellPct/100,gainPct:o.mirror.gainPct,atOpen};
    if(mirrorFill.fraction===1)return {at:minute.openTime,reading:(price/holding.entry-1)*100,barOpenTime:minute.openTime,fillPrice:price,fillPeak:price,atOpen,
      cause:{id:'mirror-take-profit',label:'镜像止盈',kind:'mirror-take-profit',direction:'>=',threshold:o.mirror.gainPct}};
  };
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
      if(o.mirror?.enabled && minute.openTime>=o.since && ![holding?.entry,minute.open,minute.high,minute.low,minute.close].every(n=>Number.isFinite(n)&&n!>0)) throw new Error('镜像止盈缺少有效的分钟价格，不能越过缺失行情模拟成交');
      if(holding&&minute.openTime>=o.since) {
        // The open is already observable. A gap through a price veto must not
        // wait another minute, and none of this candle's future H/L/C is read.
        const opening=advanceQualityHolding(holding,{...minute,high:minute.open,low:minute.open,close:minute.open});
        const trigger=checkRisk(minute.openTime,opening);
        if(trigger) {prices.push(minute);return {trigger:{...trigger,barOpenTime:minute.openTime,atOpen:true},prices,mirrorFill};}
        const openProfit=mirrorAt(minute,true);
        if(openProfit) {prices.push(minute);return {trigger:openProfit,prices,mirrorFill};}
        // 开盘没越线：盘中碰到回撤止损价就按止损价卖出，不等这一分钟收完
        const stop=qualityIntrabarStop(holding,minute,risk);
        if(stop) {
          prices.push(minute);
          const v=stop.veto;
          return {trigger:{at:minute.openTime,reading:stop.reading,barOpenTime:minute.openTime,previous:riskPrevious.get(v.id),fillPrice:stop.price,fillPeak:stop.peak,
            cause:{id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold}},prices,mirrorFill};
        }
      }
      // A stop wins when high/low ordering is unknown; an observable opening fill is already settled.
      const mirrorTrigger=mirrorAt(minute,false);
      if(mirrorTrigger) {prices.push(minute);return {trigger:mirrorTrigger,prices,mirrorFill};}
      for(const s of streams)if(minute.openTime>=s.start)s.partial=aggregateQualityMinute(s.partial,minute,s.plan.step);
      if(minute.openTime>=o.since) {prices.push(minute);if(holding){holding=advanceQualityHolding(holding,minute);sellerPeak=Math.max(sellerPeak,minute.high);}}
      if(drops.length&&minute.openTime>=o.entry) {dropMinutes.push(minute);while(dropMinutes.length>maxDropWindow)dropMinutes.shift();}
      const at=minute.openTime+MINUTE,trigger=check(at);
      if(trigger) {if(minutes[i+1])prices.push(minutes[i+1]);return {trigger,prices,mirrorFill};}
      for(const s of streams)if(s.partial&&at%s.plan.step===0) {s.history.push(s.partial);s.partial=undefined;}
      if(i%20===19)await fishDelay(0,signal);
    }
    cursor=cut;
    for(const s of streams)if(s.history.length>s.plan.warm+500) {s.history=s.history.slice(-s.plan.warm);s.cache=createFormulaEvaluationCache();}
    await fishDelay(0,signal);
  }
  return {prices,mirrorFill};
}
