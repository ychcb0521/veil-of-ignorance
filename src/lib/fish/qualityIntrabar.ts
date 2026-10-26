/** Causal, one-minute replay of a forming indicator candle. */
import { evaluateOnBars } from '@/lib/deepDig/features';
import { createFormulaEvaluationCache } from '@/lib/deepDig/formula';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import { compileFishProgram, type FishProgram } from './algorithm';
import type { FishReconstructionLoader } from './reconstruction';
import { fishDelay, validateFishBars } from './shared';

const MINUTE = 60_000;
export interface QualityTrigger {
  at: number; reading: number;
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

export async function findQualityIntrabarExit(o: {
  row: TradeSignal; plan: FishProgram; scale: number; rule: { direction:'<'|'>';threshold:number };
  entry: number; since: number; end: number; resumed: boolean; load: FishReconstructionLoader; signal: AbortSignal;
}): Promise<{ trigger?: QualityTrigger; prices: ResearchBar[] }> {
  const {plan,signal}=o;
  if (!(plan.step>=MINUTE) || plan.step%MINUTE!==0) throw new Error('盘中复原要求指标周期为整数分钟');
  const start=Math.floor(o.since/plan.step)*plan.step,from=start-plan.warm*plan.step;
  if (from<0) throw new Error('盘中复原的公式预热历史不足');
  let history=[...await o.load(o.row,from,start,plan,signal)];
  validateFishBars(history,start,plan.warm,plan.step);
  if (signal.aborted) throw new DOMException('已暂停','AbortError');
  let cache=createFormulaEvaluationCache(),partial:ResearchBar|undefined,previous:QualityTrigger['previous'];
  const prices:ResearchBar[]=[];
  const checkFrom=o.resumed?o.since+MINUTE:o.entry;
  const check=(at:number,barOpenTime:number):QualityTrigger|undefined=>{
    if (at<checkFrom) return;
    const bars=partial?[...history,partial]:history;
    const out=evaluateOnBars(bars,plan.compiled,plan.def,cache).vars.get(plan.averageName);
    const reading=(typeof out==='number'?out:out?.[bars.length-1] ?? NaN)*o.scale;
    if (!Number.isFinite(reading)) throw new Error('盘中指标存在缺失读数，不能越过缺口判断成交');
    if (o.rule.direction==='<'?reading<o.rule.threshold:reading>o.rule.threshold) return {at,reading,barOpenTime,previous};
    previous={at,reading};
  };
  // If the condition already holds when buying, its first observable trigger is
  // the entry minute itself; an arbitrary extra holding period is not imposed.
  if (start===o.entry && !o.resumed) {
    const trigger=check(start,history.at(-1)!.openTime);
    if (trigger) return {trigger,prices};
  }
  const transport=minuteTransport(plan);
  for (let cursor=start;cursor<o.end;) {
    if (signal.aborted) throw new DOMException('已暂停','AbortError');
    const cut=Math.min(o.end,cursor+500*MINUTE);
    const minutes=await o.load(o.row,cursor,cut,transport,signal);
    validateFishBars(minutes,cut,(cut-cursor)/MINUTE,MINUTE);
    for(let i=0;i<minutes.length;i++) {
      if (signal.aborted) throw new DOMException('已暂停','AbortError');
      const minute=minutes[i]; partial=aggregateQualityMinute(partial,minute,plan.step);
      if (minute.openTime>=o.since) prices.push(minute);
      const at=minute.openTime+MINUTE,trigger=check(at,partial.openTime);
      if (trigger) {
        // Only this next minute's OPEN is used for execution by the caller.
        if (minutes[i+1]) prices.push(minutes[i+1]);
        return {trigger,prices};
      }
      if (at%plan.step===0) {history.push(partial);partial=undefined;}
      if (i%20===19) await fishDelay(0,signal);
    }
    cursor=cut;
    // Bound memory and input scans for trades that remain open for months. The
    // same conservative convergence history as ordinary fishing is retained.
    if (history.length>plan.warm+500) {history=history.slice(-plan.warm);cache=createFormulaEvaluationCache();}
    await fishDelay(0,signal);
  }
  return {prices};
}
