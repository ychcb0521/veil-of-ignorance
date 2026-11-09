import { advanceChartAtr, type ChartAtrState } from '../atr';
import type { ResearchBar } from '../deepRsa/window';
import type { TradeSignal } from '../signalLibrary';
import { compileFishProgram } from './algorithm';
import { evaluateAdditionVetoes, validateAdditionVetoes, type AdditionVetoHit, type QualityAdditionEntryVeto } from './qualityAdditionVeto';
import { qualityHistoryFrom } from './qualityInitialization';
import { doubleDropState } from './qualityDoubleDrop';
import type { FishReconstructionLoader } from './reconstruction';
import { fishDelay, validateFishBars } from './shared';

const M=60000,FIVE=5*M,WARM=87;
const plan=(interval:'1m'|'5m')=>compileFishProgram({id:'veto-history-'+interval,name:'否决历史扫描',short:'历史',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
export interface HistoryVetoResult {hit?:AdditionVetoHit;pending?:string}
/** Separately versioned opt-in history. Original veto formulas remain executable.
 * Each decision scans its rolling history; sticky damage survives retries and
 * window expiry until a CLOSED 5m candle recovers the recorded peak. Resume
 * replays the same fixed seed and the original entry's historical prefix. */
export function createVetoHistoryReader(o:{rules:readonly QualityAdditionEntryVeto[];entry:number;row:TradeSignal;load:FishReconstructionLoader;signal:AbortSignal}){
 const rules=o.rules.filter(v=>v.enabled&&v.historyHours!=null);validateAdditionVetoes(rules);
 if(!rules.length)return async(_at:number):Promise<HistoryVetoResult>=>({});
 const maxHours=Math.max(0,...rules.map(v=>v.historyHours!)),first=Math.floor((o.entry-maxHours*3600000)/FIVE)*FIVE;
 let cursor=qualityHistoryFrom(o.load,first-WARM*FIVE,FIVE),atrState:ChartAtrState|undefined,lastAt=-Infinity;
 const bars:ResearchBar[]=[],atr:number[]=[],minuteBars:ResearchBar[]=[];
 const fast=rules.filter(v=>v.kind==='fast-drop'),slow=rules.filter(v=>v.kind!=='fast-drop');
 let minuteCursor=qualityHistoryFrom(o.load,Math.floor((o.entry-Math.max(0,...fast.map(v=>v.historyHours!))*3600000)/M)*M,M);
 const fivePlan=plan('5m'),minutePlan=plan('1m'),locks=new Map<QualityAdditionEntryVeto,{peak:number;hit:AdditionVetoHit}>();
 const volatilityHits=new Map<QualityAdditionEntryVeto,{at:number;hit:AdditionVetoHit}[]>();
 const evaluate=(rule:QualityAdditionEntryVeto,end:number)=>{
  const at=bars[end-1].openTime+FIVE,from=Math.ceil((at-rule.historyHours!*3600000)/FIVE)*FIVE;
  let start=end;while(start>0&&bars[start-1].openTime>=from)start--;
  const {historyHours:_,...original}=rule;
  const window=bars.slice(start,end),values=atr.slice(start,end);
  if(!window.length)return;
  if(rule.kind==='double-drop'&&rule.atr!=null&&values.some(x=>!(x>0)))return;
  const wick=['upper-wick','lower-wick','lower-spike'].includes(rule.kind);
  // A preceding close is needed for the first lower-spike candle, but that
  // preceding candle cannot itself become an eligible event.
  if(rule.kind==='lower-spike'&&start>0){window.unshift(bars[start-1]);values.unshift(atr[start-1]);}
  return evaluateAdditionVetoes([{...original,...(wick?{lookbackBars:end-start}:{})}],window,values,from);
 };
 return async(at:number):Promise<HistoryVetoResult>=>{
  if(!rules.length)return {};
  if(at<lastAt)throw Error('否决历史扫描时间不能倒退');lastAt=at;
  if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
  const cut=Math.floor(at/FIVE)*FIVE;
  let lastYield=performance.now();
  while(slow.length&&cursor<cut){
   const to=Math.min(cut,cursor+500*FIVE),chunk=await o.load(o.row,cursor,to,fivePlan,o.signal);validateFishBars(chunk,to,(to-cursor)/FIVE,FIVE);
   for(const bar of chunk){
    if(performance.now()-lastYield>=16){await fishDelay(0,o.signal);lastYield=performance.now();}
    bars.push(bar);atrState=advanceChartAtr(atrState,bar);atr.push(atrState.value);const closed=bar.openTime+FIVE;
    for(const rule of slow){
     if(bar.openTime<o.entry-rule.historyHours!*3600000||!(atrState.value>0))continue;
     const lock=locks.get(rule);if(lock&&bar.close>=lock.peak){locks.delete(rule);continue;}
     if(rule.kind==='volatility'){
      const {historyHours:_,...original}=rule;
      const hit=evaluateAdditionVetoes([original],bars.slice(-WARM),atr.slice(-WARM),bar.openTime);
      const hits=volatilityHits.get(rule)??[];if(hit)hits.push({at:closed,hit});
      while(hits[0]&&hits[0].at<=closed-rule.historyHours!*3600000)hits.shift();volatilityHits.set(rule,hits);
     }else if(rule.sticky||rule.kind==='double-drop'){
      const hit=evaluate(rule,bars.length),peak=hit?.lockPeak??(hit&&rule.kind==='double-drop'?doubleDropState(bars,atr,closed-rule.historyHours!*3600000,rule).lockedPeak:undefined);
      if(hit&&peak!=null&&!locks.has(rule))locks.set(rule,{peak,hit});
     }
    }
   }
   cursor=to;
   const retainFrom=cursor-maxHours*3600000-WARM*FIVE;
   let remove=0;while(remove<bars.length&&bars[remove].openTime<retainFrom)remove++;
   if(remove){bars.splice(0,remove);atr.splice(0,remove);}
   await fishDelay(0,o.signal);
  }
  while(fast.length&&minuteCursor<at){
   const to=Math.min(at,minuteCursor+500*M),chunk=await o.load(o.row,minuteCursor,to,minutePlan,o.signal);validateFishBars(chunk,to,(to-minuteCursor)/M,M);
   minuteBars.push(...chunk);minuteCursor=to;
   const retainFrom=minuteCursor-Math.max(...fast.map(v=>v.historyHours!))*3600000;
   let remove=0;while(remove<minuteBars.length&&minuteBars[remove].openTime<retainFrom)remove++;if(remove)minuteBars.splice(0,remove);
   await fishDelay(0,o.signal);
  }
  let pending:string|undefined;
  for(const rule of rules){
   const step=rule.kind==='fast-drop'?M:FIVE,from=Math.ceil(((rule.kind==='fast-drop'?at:cut)-rule.historyHours!*3600000)/step)*step,series=rule.kind==='fast-drop'?minuteBars:bars;
   const lock=locks.get(rule);
   if(lock)return {hit:{kind:rule.kind,label:`历史回看 ${rule.historyHours} 小时 · 未收复高点锁定`,reading:`${lock.hit.reading}；尚未以 5 分钟收盘收复 ${lock.peak}（重筛不清除）`}};
   if(!series.length||series[0].openTime>from){pending??=`历史回看 ${rule.historyHours} 小时：完整行情不足，等待后再判断`;continue;}
   if((rule.kind==='volatility'||rule.atr!=null)&&rule.kind!=='fast-drop'&&bars.some((b,i)=>b.openTime>=from&&!(atr[i]>0))){pending??='历史窗口的 ATR 预热尚未完整，等待后再判断';continue;}
   let hit:AdditionVetoHit|undefined;
   if(rule.kind==='fast-drop'){
    const {historyHours:_,...original}=rule;
    // Fast-drop evaluation needs an ATR placeholder only to enter the legacy
    // dispatcher; its percentage formula itself uses minute OHLC exclusively.
    const last=minuteBars.at(-1)!;hit=evaluateAdditionVetoes([original],[last],[1],from,minuteBars.filter(b=>b.openTime>=from));
   }else if(!(atr.at(-1)!>0)){pending??='历史否决等待已收盘 ATR';continue;}
   else if(rule.kind==='volatility')hit=volatilityHits.get(rule)?.filter(x=>x.at>from).at(-1)?.hit;
   else hit=evaluate(rule,bars.length);
   if(hit){const {lockPeak:_,...text}=hit;return {hit:{...text,label:`历史回看 ${rule.historyHours} 小时 · ${text.label.replace(/持仓/g,'历史窗口')}`,reading:`${text.reading.replace(/持仓/g,'历史窗口')}；窗口 ${new Date(from).toISOString()} 至 ${new Date(rule.kind==='fast-drop'?at:cut).toISOString()}`}};}
  }
  return {pending};
 };
}
