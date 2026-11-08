import { evaluateOnBars } from '../deepDig/features';
import { createFormulaEvaluationCache } from '../deepDig/formula';
import type { ResearchBar } from '../deepRsa/window';
import type { TradeSignal } from '../signalLibrary';
import { aggregateQualityMinute } from './qualityIntrabar';
import { qualityMetricPlan } from './quality';
import { qualityHistoryFrom, qualityInitializationPending } from './qualityInitialization';
import { completeZeroTradeBar, zeroTradeReadingPending } from './qualityZeroTrade';
import { isTuringCupSymbol } from '../turingCupSymbol';
import { qualityConditionMet } from './qualityVeto';
import { validateFishBars } from './shared';
import type { FishReconstructionLoader } from './reconstruction';
import { expressionConditions, type EntryMarketCondition, type EntryMarketExpression } from './preEntryThreeStage';
import { compileFishProgram, evaluateFishProgram, FISH_STATE_HOLD_TEXT } from './algorithm';

export interface EntryConditionReading { id:string; label?:string; at:number; value?:number; met?:boolean; pending?:string; zeroTrade?:boolean }
export function expressionResult(e:EntryMarketExpression,readings:ReadonlyMap<string,EntryConditionReading>):boolean|undefined {
  if('condition' in e)return e.condition.enabled?readings.get(e.condition.id)?.met:undefined;
  const values=e.children.filter(child=>expressionConditions(child).some(c=>c.enabled)).map(child=>expressionResult(child,readings));
  if(!values.length)return undefined;
  // Unknown cannot silently pass an exclusion. Evaluate the whole expression.
  if(e.join==='all')return values.includes(false)?false:values.includes(undefined)?undefined:true;
  return values.includes(true)?true:values.includes(undefined)?undefined:false;
}
export async function createPreEntryMarketReader(o:{condition:EntryMarketCondition;row:TradeSignal;since:number;origin?:number;load:FishReconstructionLoader;signal:AbortSignal}) {
  const c=o.condition,base=qualityMetricPlan(c.snapshot,c.metric),scale=base.scale;
  const plan=c.originalDetector?compileFishProgram(base.plan.def,{...base.plan.settings,direction:c.direction as '<'|'>',constraints:c.originalDetector.constraints.filter(text=>text!==FISH_STATE_HOLD_TEXT).map((text,i)=>({id:'entry-detector-'+i,text,enabled:true}))}):base.plan;
  if(plan.unavailable)throw Error(plan.unavailable);
  const start=Math.floor(o.since/plan.step)*plan.step,from=qualityHistoryFrom(o.load,start-plan.warm*plan.step,plan.step);
  if(from<0)throw Error(c.label+'：指标预热历史不足');
  let history=from<start?[...await o.load(o.row,from,start,plan,o.signal)]:[];
  if(from<start)validateFishBars(history,start,(start-from)/plan.step,plan.step);
  let partial:ResearchBar|undefined,cache=createFormulaEvaluationCache(),hadValue=false;
  const read=(at:number,minute:ResearchBar):EntryConditionReading=>{
    const bars=c.timing==='closed'?history:partial?[...history,partial]:history;
    if(!bars.length)return {id:c.id,at,pending:'等待指标首根已收盘数据'};
    const out=evaluateOnBars(bars,plan.compiled,plan.def,cache).vars.get(plan.averageName),index=bars.length-1;
    const values=typeof out==='number'?[out]:out??[],value=(typeof out==='number'?out:out?.[index]??NaN)*scale;
    if(!Number.isFinite(value)){
      if(isTuringCupSymbol(o.row.symbol)&&plan.compiled.usesAmounts&&zeroTradeReadingPending(bars,values,typeof out==='number'?0:index))return {id:c.id,at,pending:'等待零成交后的有效读数',zeroTrade:true};
      if(!hadValue&&qualityInitializationPending(o.load,values,typeof out==='number'?0:index))return {id:c.id,at,pending:'等待指标初始化'};
      throw Error(c.label+'：指标存在缺失读数，不能越过缺口筛选');
    }
    hadValue=true;
    if(isTuringCupSymbol(o.row.symbol)&&completeZeroTradeBar(minute))return {id:c.id,at,value,pending:'零成交分钟暂不准入',zeroTrade:true};
    let met=qualityConditionMet(value,c.direction,c.threshold);
    if(c.originalDetector){
      const output=evaluateFishProgram(bars,plan),i=bars.length-1,closedAt=bars[i].openTime+plan.step;
      const missing=output.constraints.filter(x=>!Number.isFinite(x[i]));
      if(missing.length){if(missing.every(x=>qualityInitializationPending(o.load,x,i)))return {id:c.id,at,value,pending:'等待原探测约束初始化'};throw Error(c.label+'：原探测约束读数缺失');}
      met=met&&!output.constraints.some(x=>!x[i]);
      if(plan.compiled.usesPrs6h&&!output.PRS6H_details?.find(r=>r.PRS6H_at===closedAt)?.PRS6H_event)met=false;
      const first=Math.floor((o.origin??o.since)/plan.step)*plan.step+plan.step;
      if(plan.stateHold&&!((plan.stateHoldAlternatives??[plan.stateHold]).some(route=>closedAt>=first+(route.samples-1)*plan.step&&i>=route.samples-1&&output.average.subarray(i-route.samples+1,i+1).every(v=>Number.isFinite(v)&&v>route.threshold))))met=false;
    }
    return {id:c.id,at,value,met};
  };
  return {condition:c,plan,start,push(minute:ResearchBar){
    if(minute.openTime<start)return;
    partial=aggregateQualityMinute(partial,minute,plan.step);
    const at=minute.openTime+60000;
    // Closed-only conditions observe the just-closed candle at its boundary.
    if(at%plan.step===0){history.push(partial);partial=undefined;}
  },read,trim(){
    if(!o.load.turingInitialization&&history.length>plan.warm+500){history=history.slice(-Math.max(1,plan.warm));cache=createFormulaEvaluationCache();}
  }};
}
