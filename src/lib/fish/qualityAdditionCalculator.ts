import {advanceChartAtr,type ChartAtrState} from '@/lib/atr';
import {calculateAddPosition,initialAddPositionState} from '@/lib/addPositionCoverage';
import {compileFishProgram} from './algorithm';
import {validateFishBars,fishDelay} from './shared';
import {findQualityAdditionTrigger,type AdditionCandidate} from './qualityAdditionScan';
import {qualityAdditionAtrSettings,type QualityAdditionFill,type QualityAdditionRoundRule} from './qualityAddition';
import {createStructureAdditionReader,structureAdditionK,type StructureAdditionRule} from './qualityAdditionStructure';
import {ADDITION_PROFIT_KIND,activeHoldingVetoes,type QualityHoldingVeto,type QualityExitCause} from './qualityVeto';
import type {QualityMirrorFill} from './qualityMirror';
import type {FishReconstructionLoader} from './reconstruction';
import type {TradeSignal} from '@/lib/signalLibrary';
import type {ResearchBar} from '@/lib/deepRsa/window';
const MINUTE=60000,STEP=5*MINUTE,PERIOD=14,WARM=PERIOD*20+1;
interface SupportStop {at:number;price:number;support:number;atOpen:boolean;cause?:QualityExitCause}
type AtrSettings=Pick<QualityAdditionRoundRule,'entryBufferAtr'|'supportOffsetAtr'>;
interface Options extends AtrSettings {
 structure?:StructureAdditionRule;
 vetoes?:readonly QualityHoldingVeto[];pauseAfterAdditionCount?:number;
 candidates:AdditionCandidate[];required?:AdditionCandidate[];roundRules?:({candidates:AdditionCandidate[];required?:AdditionCandidate[];minGainPct?:number;structure?:StructureAdditionRule}&AtrSettings)[];maxRounds?:number;minGainPct?:number;row:TradeSignal;entry:number;entryPrice:number;notional:number;end:number;since:number;
 prices:readonly ResearchBar[];previous:readonly QualityAdditionFill[];mirror?:QualityMirrorFill;repeat:boolean;
 ordinaryExit?:{at:number;price:number;atOpen:boolean;mirror:boolean};load:FishReconstructionLoader;signal:AbortSignal;
}
/** Causal five-minute ATR values; a resumed run uses the same seed anchor as the original run. */
function atrReader(o:Options){
 let cursor=Math.floor(o.entry/STEP)*STEP-WARM*STEP,state:ChartAtrState|undefined;
 if(cursor<0)throw Error('加仓支撑线的5分钟ATR历史不足');
 const values=new Map<number,number>();
 const plan=compileFishProgram({id:'add-atr-prices',name:'加仓ATR',short:'ATR',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'5m'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
 return async(at:number)=>{
  const cut=Math.floor(at/STEP)*STEP;
  while(cursor<cut){
   if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
   const to=Math.min(cut,cursor+500*STEP),bars=await o.load(o.row,cursor,to,plan,o.signal);validateFishBars(bars,to,(to-cursor)/STEP,STEP);
   for(const bar of bars){if(![bar.high,bar.low,bar.close].every(Number.isFinite)||!(bar.low>0)||bar.high<bar.low)throw Error('加仓ATR行情读数无效');state=advanceChartAtr(state,bar,PERIOD);values.set(bar.openTime+STEP,state.value);}cursor=to;await fishDelay(0,o.signal);
  }
  return values.get(cut);
 };
}
export async function findCalculatorAdditions(o:Options):Promise<{fills:QualityAdditionFill[];stop?:SupportStop;stageBoundary?:{at:number;price:number}}>{
 // A realized half mirror is mandatory. Its own minute cannot establish an ordered addition.
 const halfMirror=o.mirror;if(halfMirror?.fraction!==.5)return {fills:[]};
 const fills=[...o.previous],priceAt=new Map(o.prices.map(b=>[b.openTime,b.open]));
 let after=Math.max(o.entry,o.since-MINUTE,halfMirror.at,fills.at(-1)?.at??o.entry);const readAtr=atrReader(o),readStructure=createStructureAdditionReader(o);
 const bars=o.prices.filter(b=>b.openTime<o.end);let size=1;while(size<bars.length)size*=2;
 const highTree=new Float64Array(size*2).fill(-Infinity);
 const lowTree=new Float64Array(size*2).fill(Infinity);bars.forEach((b,i)=>{if(!(b.open>0)||!(b.low>0)||!Number.isFinite(b.open)||!Number.isFinite(b.low)||!Number.isFinite(b.high)||b.high<Math.max(b.open,b.low))throw Error('加仓行情读数无效');lowTree[size+i]=b.low;highTree[size+i]=b.high;});for(let i=size-1;i>0;i--){lowTree[i]=Math.min(lowTree[i*2],lowTree[i*2+1]);highTree[i]=Math.max(highTree[i*2],highTree[i*2+1]);}
 const findStop=(support:number|undefined,from:number):SupportStop|undefined=>{
  if(support==null)return;
  const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));
  const search=(node:number,left:number,right:number):number=>{if(right<=first||lowTree[node]>support)return -1;if(right-left===1)return left;const middle=(left+right)>>>1,found=search(node*2,left,middle);return found<0?search(node*2+1,middle,right):found;};
  const index=search(1,0,size),bar=bars[index];if(!bar)return;
  const exit=o.ordinaryExit;if(exit&&bar.openTime===exit.at&&(exit.atOpen||!exit.mirror&&exit.price>=support))return;
  const atOpen=bar.open<=support;return {at:bar.openTime,price:atOpen?bar.open:support,support,atOpen};
 };
 const profitRules=activeHoldingVetoes(o.vetoes).filter(v=>v.kind===ADDITION_PROFIT_KIND).sort((a,b)=>a.id.localeCompare(b.id));
 const findPositionExit=(support:number|undefined,from:number):SupportStop|undefined=>{
  const stop=findStop(support,from);if(!fills.length||support==null||!profitRules.length)return stop;
  const initialCoins=o.notional/o.entryPrice,heldCoins=initialCoins*(1-halfMirror.fraction)+fills.reduce((n,a)=>n+a.quantity,0),multiple=heldCoins/initialCoins;
  const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));
  let profit:SupportStop|undefined;
  for(const v of profitRules){
   const required=v.geometricMultiple??100;if(multiple+32*Number.EPSILON*Math.max(1,multiple,required)<required)continue;
   const target=support*(1+v.threshold/100);if(!(target>0)||!Number.isFinite(target))throw Error('加仓止盈目标价超出有效范围');
   const search=(node:number,left:number,right:number):number=>{if(right<=first||highTree[node]<target*(1-1e-12))return -1;if(right-left===1)return left;const middle=(left+right)>>>1,found=search(node*2,left,middle);return found<0?search(node*2+1,middle,right):found;};
   const bar=bars[search(1,0,size)];if(!bar)continue;
   const ordinary=o.ordinaryExit;if(ordinary&&bar.openTime===ordinary.at&&(ordinary.atOpen||!ordinary.mirror||ordinary.price<=target))continue;
   const atOpen=bar.open>=target*(1-1e-12),hit={at:bar.openTime,price:atOpen?bar.open:target,support,atOpen,cause:{id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold,geometricMultiple:required,additionBasis:{geometricMultiple:multiple,equilibriumPrice:support,targetPrice:target}}};
   if(!profit||hit.at<profit.at||hit.at===profit.at&&(hit.atOpen&&!profit.atOpen||hit.atOpen===profit.atOpen&&hit.price<profit.price))profit=hit;
  }
  // The minute open is ordered. When both intraminute boundaries touch, retain the protective stop.
  if(!stop)return profit;if(!profit)return stop;
  return profit.at<stop.at||profit.at===stop.at&&profit.atOpen&&!stop.atOpen?profit:stop;
 };
 while(after<o.end){
  if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
  const support=fills.at(-1)?.sizing?.support,stop=findPositionExit(support,Math.max(o.since,fills.at(-1)?.at??o.since));
  if(fills.length>=(o.maxRounds??(o.repeat?Infinity:1)))return {fills,stop};
  const round=o.roundRules?.[fills.length]??o;
  const scanEnd=stop?Math.min(o.end,stop.at+(stop.atOpen?0:MINUTE)):o.end;
  if(scanEnd<=after)return {fills,stop};
  const soldBefore=o.notional/o.entryPrice*halfMirror.fraction;
  const coinsBefore=o.notional/o.entryPrice+fills.reduce((n,f)=>n+f.quantity,0)-soldBefore;
  const realAverageBefore=(o.notional+fills.reduce((n,f)=>n+f.notional,0)-o.notional*halfMirror.fraction)/coinsBefore;
  const basis='real-average' as const,referencePrice=realAverageBefore;
  const hit=round.structure?await readStructure(round.structure,after,scanEnd,fills,round.minGainPct!=null?{referencePrice,thresholdPct:round.minGainPct}:undefined):await findQualityAdditionTrigger({...o,candidates:round.candidates,required:round.required,after,end:scanEnd,priceAt,...(round.minGainPct!=null?{priceGate:{referencePrice,thresholdPct:round.minGainPct,basis}}:{})});
  if(hit?.structureEvidence){const price=priceAt.get(hit.at);if(!(price!>0)||!Number.isFinite(price))throw Error('缺少箱体加仓下一分钟开盘价');hit.price=price!;}
  if(!hit)return {fills,stop};
  const atrAt=Math.floor(hit.at/STEP)*STEP,atr=await readAtr(hit.at);
  if(!(atr!>0)||!Number.isFinite(atr))throw Error('缺少加仓时已收盘的5分钟ATR读数');
  const {entryBufferAtr,supportOffsetAtr}=qualityAdditionAtrSettings(round);
  const selected=hit.structureEvidence?structureAdditionK(hit.structureEvidence,atr!):undefined;
  const K=hit.structureEvidence?selected?.k??NaN:hit.price-supportOffsetAtr*atr!,S=support??o.entryPrice;after=hit.at;
  if(hit.structureEvidence&&(!selected||hit.price<=hit.structureEvidence.supportPrice||support!=null&&K<support))continue;
  if(hit.structureEvidence&&selected)hit.structureEvidence={...hit.structureEvidence,...selected};
  // This entry rule is independent of the indicator and average-price gain gates.
  const buffer=hit.price-S,minimum=entryBufferAtr*atr!;
  if(buffer+8*Number.EPSILON*Math.max(hit.price,S,minimum)<minimum||!(K>0))continue;
  const mirror=o.mirror&&(o.mirror.at<hit.at||o.mirror.at===hit.at&&o.mirror.atOpen)?o.mirror:undefined;
  const sold=mirror?o.notional/o.entryPrice*mirror.fraction:0;
  const Q=o.notional/o.entryPrice+fills.reduce((n,f)=>n+f.quantity,0)-sold;
  const cost=o.notional+fills.reduce((n,f)=>n+f.notional,0)-(mirror?o.notional*mirror.fraction:0);
  const profit=mirror?Math.max(0,sold*(mirror.price-o.entryPrice)):0,used=fills.reduce((n,f)=>n+(f.sizing?.mirrorUsed??0),0);
  const state={...initialAddPositionState(S,Q,profit,cost/Q),mirrorProfitAllocated:used,mirrorProfitAvailable:Math.max(0,profit-used)};
  const sized=calculateAddPosition({currentPrice:hit.price,support:K,state});after=hit.at;
  if(sized.error==='invalid_input')throw Error('加仓支撑线或持仓状态无效');
  if(sized.error||!(sized.addCoins>0))continue;
  const notional=sized.addCoins*hit.price;if(!Number.isFinite(notional)||!Number.isFinite(sized.addCoins))throw Error('加仓币数超出可计算范围');
  fills.push({...hit,quantity:sized.addCoins,notional,sizing:{support:K,previousSupport:S,atr:atr!,atrAt,coinsBefore:Q,realAverageBefore:cost/Q,baseCoins:sized.baseCoins,mirrorCoins:sized.mirrorCoins,mirrorUsed:sized.mirrorUsed,mirrorAvailableBefore:state.mirrorProfitAvailable,costBufferAtr:buffer/atr!,requiredBufferAtr:entryBufferAtr,...(hit.structureEvidence?{}:{supportOffsetAtr}),coverageGap:sized.coverageGap}});
  if(fills.length===o.pauseAfterAdditionCount)return {fills,stageBoundary:{at:hit.at,price:hit.price}};
 }
 return {fills,stop:findPositionExit(fills.at(-1)?.sizing?.support,Math.max(o.since,fills.at(-1)?.at??o.since))};
}
