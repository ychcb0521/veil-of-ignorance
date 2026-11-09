import {compileFishProgram} from './algorithm';
import {validateFishBars} from './shared';
import {screeningTimeSlice} from './screeningYield';
import {formatUTC8} from '../timeFormat';
import type {ResearchBar} from '../deepRsa/window';
import type {TradeSignal} from '../signalLibrary';
import type {FishReconstructionLoader} from './reconstruction';
import type {EntryProcessReading} from './preEntryExclusionProcess';
import type {EntryStallTurn, StallTurnMetrics} from './preEntryStallTurn';

export const ENTRY_STALL_TURN_5M_VERSION = 'entry-stall-turn-5m-v2' as const;
export const PULLBACK_NEW_HIGH_5M_VERSION = 'addition-pullback-new-high-5m-v1' as const;
export interface EntryStallTurn5m extends Omit<EntryStallTurn,'version'> {version:typeof ENTRY_STALL_TURN_5M_VERSION}
/** Minutes remain explicit in storage; the editor presents whole 5m candles. */
export const defaultEntryStallTurn5m=():EntryStallTurn5m=>({version:ENTRY_STALL_TURN_5M_VERSION,enabled:true,historyHours:6,riseMinutes:60,risePct:1,stallMinutes:15,maxProgressPct:20,turnMinutes:10,pullback:{enabled:true,pct:3}});
export function validateEntryStallTurn5m(c:EntryStallTurn5m){
 const bars=(n:number,min:number,max:number)=>Number.isInteger(n)&&n%5===0&&n>=min*5&&n<=max*5;
 const history=c.historyHours*12;
 if(c.version!==ENTRY_STALL_TURN_5M_VERSION||typeof c.enabled!=='boolean')throw Error('5分钟滞涨转弱版本不可用，请保留原方案');
 if(!Number.isFinite(history)||history<1||history>864||Math.abs(history-Math.round(history))>1e-8
  ||!bars(c.riseMinutes,3,288)||!bars(c.stallMinutes,2,48)||!bars(c.turnMinutes,1,6)||c.turnMinutes>c.stallMinutes
  ||!Number.isFinite(c.risePct)||c.risePct<=0||c.risePct>=100||!Number.isFinite(c.maxProgressPct)||c.maxProgressPct<0||c.maxProgressPct>=100
  ||c.pullback!=null&&(typeof c.pullback.enabled!=='boolean'||!Number.isFinite(c.pullback.pct)||c.pullback.pct<=0||c.pullback.pct>=100))throw Error('滞涨转弱参数无效：5分钟版须使用完整K线；上涨3～288根、滞涨2～48根、转弱1～6根且不长于滞涨；历史5分钟～72小时且为5分钟整数倍；涨幅和回调门槛大于0且小于100%，推进比例0～小于100%');
}
export function entryStallTurn5mMetrics(bars:readonly ResearchBar[],c:EntryStallTurn5m):StallTurnMetrics|undefined{
 const rise=c.riseMinutes/5,stall=c.stallMinutes/5,turn=c.turnMinutes/5,total=rise+stall+turn;
 if(bars.length<total)return;
 const start=bars.length-total,riseEnd=start+rise,turnStart=riseEnd+stall,last=bars.at(-1)!;
 const risePct=(bars[riseEnd-1].close/bars[start].open-1)*100,stallPct=(bars[turnStart-1].close/bars[riseEnd].open-1)*100;
 const progressPct=risePct>0?(stallPct/c.stallMinutes)/(risePct/c.riseMinutes)*100:0;
 let previousMean=0,currentMean=0,support=Infinity,recoveryPrice=-Infinity,recovering=true;
 for(let i=0;i<turn;i++){
  const prior=bars[turnStart-turn+i],current=bars[turnStart+i];previousMean+=prior.close;currentMean+=current.close;
  support=Math.min(support,prior.low);recoveryPrice=Math.max(recoveryPrice,prior.close);
  if(current.close<=bars[turnStart+i-1].close)recovering=false;
 }
 const meanChangePct=(currentMean/previousMean-1)*100;
 return {risePct,progressPct,meanChangePct,support,close:last.close,recoveryPrice,recovering,hit:risePct>=c.risePct&&progressPct<=c.maxProgressPct&&meanChangePct<0&&last.close<support};
}
const M=60000,FIVE=5*M;
const number=(n:number)=>+n.toFixed(5),price=(n:number)=>+n.toPrecision(10);
type ReaderOptions={condition:EntryStallTurn5m;row:TradeSignal;load:FishReconstructionLoader;signal:AbortSignal;availableStart?:number;origin?:number};
export function createEntryStallTurn5mReader(o:ReaderOptions){return createFiveMinuteShapeReader(o,false);}
export function createPullbackNewHigh5mReader(o:Omit<ReaderOptions,'condition'>&{historyHours:number;pct:number}){
 return createFiveMinuteShapeReader({...o,condition:{...defaultEntryStallTurn5m(),historyHours:o.historyHours,pullback:{enabled:true,pct:o.pct}}},true);
}
function createFiveMinuteShapeReader(o:ReaderOptions,pullbackOnly:boolean){
 validateEntryStallTurn5m(o.condition);
 const c=o.condition,size=pullbackOnly?1:(c.riseMinutes+c.stallMinutes+c.turnMinutes)/5,historyBars=Math.round(c.historyHours*12);
 const plan=compileFishProgram({id:ENTRY_STALL_TURN_5M_VERSION,name:'上涨后滞涨转弱·5分钟',short:'转弱',definition:'',formula:'C',interval:'5m',scale:1,unit:'',positive:'1',control:'0'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
 const bars:ResearchBar[]=[],slice=screeningTimeSlice(o.signal),peaks:{at:number;high:number}[]=[];
 let cursor:number|undefined,lastAt=-Infinity,metrics:StallTurnMetrics|undefined,historyFrom=Infinity,peakHead=0,currentPullback=0;
 let lock:{at:number;metrics:StallTurnMetrics}|undefined,pullbackLock:{at:number;peak:number;pct:number}|undefined;
 const consume=(bar:ResearchBar)=>{
  if(![bar.open,bar.high,bar.low,bar.close].every(p=>Number.isFinite(p)&&p>0)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))throw Error('5分钟滞涨转弱行情价格无效');
  if(c.pullback?.enabled&&bar.openTime>=historyFrom){
   const from=bar.openTime+FIVE-historyBars*FIVE;
   while(peakHead<peaks.length&&peaks[peakHead].at<from)peakHead++;
   while(peaks.length>peakHead&&peaks.at(-1)!.high<=bar.high)peaks.pop();
   peaks.push({at:bar.openTime,high:bar.high});if(peakHead>1024){peaks.splice(0,peakHead);peakHead=0;}
   const peak=peaks[peakHead].high;currentPullback=(peak-bar.close)/peak*100;
   if(pullbackLock){if(bar.close>pullbackLock.peak)pullbackLock=undefined;}
   else if(currentPullback>=c.pullback.pct)pullbackLock={at:bar.openTime+FIVE,peak,pct:currentPullback};
  }
  if(pullbackOnly){metrics={risePct:0,progressPct:0,meanChangePct:0,support:bar.low,close:bar.close,hit:false,recoveryPrice:0,recovering:false};return;}
  bars.push(bar);if(bars.length>size)bars.shift();metrics=entryStallTurn5mMetrics(bars,c);if(!metrics)return;
  if(lock){if(metrics.recovering&&bar.close>=lock.metrics.recoveryPrice)lock=undefined;}
  else if(metrics.hit&&bar.openTime>=historyFrom)lock={at:bar.openTime+FIVE,metrics};
 };
 return async(at:number,minute:ResearchBar):Promise<{pending?:string;blocked?:string;readings?:EntryProcessReading[]}>=>{
  if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
  if(at<lastAt||at%M!==0||minute.openTime+M!==at)throw Error('5分钟滞涨转弱须按筛选分钟顺序判断');
  lastAt=at;
  // 10:03 can only see the candle closing at 10:00. Neither trigger nor
  // recovery consumes the current partial 5m candle or the supplied 1m price.
  const closedAt=Math.floor(at/FIVE)*FIVE;
  const available=o.availableStart??o.load.turingInitialization?.startMs;
  const anchor=o.origin==null?closedAt:Math.max(Math.floor(o.origin/FIVE)*FIVE,available==null?-Infinity:Math.ceil(available/FIVE)*FIVE+(historyBars+size)*FIVE);
  const riskFrom=anchor-historyBars*FIVE,seed=riskFrom-size*FIVE;
  if(cursor==null){if(closedAt<anchor||available!=null&&seed<available)return {pending:'5分钟否决：等待完整历史及已收盘K线'};historyFrom=riskFrom;cursor=seed;}
  while(cursor<closedAt){
   if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
   const cut=Math.min(closedAt,cursor+500*FIVE),chunk=await o.load(o.row,cursor,cut,plan,o.signal);
   validateFishBars(chunk,cut,(cut-cursor)/FIVE,FIVE);
   for(const bar of chunk){const pause=slice();if(pause)await pause;consume(bar);}
   cursor=cut;
  }
  if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
  if(!metrics)return {pending:'5分钟滞涨转弱：等待完整的上涨、滞涨和转弱三段K线'};
  const prefix=pullbackOnly?PULLBACK_NEW_HIGH_5M_VERSION:ENTRY_STALL_TURN_5M_VERSION,readings:EntryProcessReading[]=[
   {id:prefix,label:pullbackOnly?'猛烈回调未创新高（5分钟）锁定':c.pullback?.enabled?'5分钟滞涨转弱／回调未创新高锁定':'滞涨转弱（5分钟）锁定',at:closedAt,value:lock||pullbackLock?1:0,threshold:1,direction:'>=',met:!!(lock||pullbackLock),role:'veto'},
   {id:prefix+':rise',label:'5分钟前段涨幅（%）',at:closedAt,value:metrics.risePct,threshold:c.risePct,direction:'>=',met:metrics.risePct>=c.risePct,role:'veto'},
   {id:prefix+':stall',label:'近期推进速度／前段速度（%）',at:closedAt,value:metrics.progressPct,threshold:c.maxProgressPct,direction:'<=',met:metrics.progressPct<=c.maxProgressPct,role:'veto'},
   {id:prefix+':turn',label:'5分钟平均收盘变化（%）',at:closedAt,value:metrics.meanChangePct,threshold:0,direction:'<',met:metrics.meanChangePct<0,role:'veto'},
   {id:prefix+':support',label:'5分钟收盘／转弱前局部低点',at:closedAt,value:metrics.close,threshold:metrics.support,direction:'<',met:metrics.close<metrics.support,role:'veto'},
  ];
  if(pullbackOnly)readings.splice(1);
  if(c.pullback?.enabled){
   readings.push({id:prefix+':pullback',label:'5分钟前高至已收盘价格回调（%）',at:closedAt,value:currentPullback,threshold:c.pullback.pct,direction:'>=',met:currentPullback>=c.pullback.pct,role:'veto'});
   if(pullbackLock)readings.push({id:prefix+':peak-lock',label:'回调锁定前高（5分钟收盘未突破）',at:closedAt,value:metrics.close,threshold:pullbackLock.peak,direction:'<=',met:true,role:'veto'});
  }
  const reasons:string[]=[];
  if(lock)reasons.push(`上涨后滞涨转弱·5分钟：${formatUTC8(lock.at)} 前段涨 ${number(lock.metrics.risePct)}%，推进速度降至 ${number(lock.metrics.progressPct)}%，重心下移并跌破 ${price(lock.metrics.support)}；等待连续 ${c.turnMinutes/5} 根已收盘5分钟K线递升且收复 ${price(lock.metrics.recoveryPrice)}`);
  if(pullbackLock)reasons.push(`猛烈回调未创新高·5分钟：${formatUTC8(pullbackLock.at)} 自前高 ${price(pullbackLock.peak)} 回调 ${number(pullbackLock.pct)}%；须5分钟收盘严格突破该前高，盘中突破、影线及重筛均不解除`);
  return {readings,...(reasons.length?{blocked:reasons.join('；')}:{})};
 };
}
