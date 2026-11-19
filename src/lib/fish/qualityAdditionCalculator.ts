import {mirrorHardStopActive,mirrorHardStopRange} from './qualityMirrorHardStopStages';
import { DBL5_PROFILES } from '@/lib/dbl5m';
import {HOLDING_LEDGER_ADDITION_VERSION,replayQualityHoldingLedger,calculateHoldingLedgerAddition} from './qualityHoldingLedger';
import { createAdditionIncreaseReader } from './qualityAdditionIncrease';
import { createImpulseAdditionReader } from './qualityImpulseAddition';
import { createVetoHistoryReader } from './qualityVetoHistory';
import { qualityHistoryFrom } from './qualityInitialization';
import {advanceChartAtr,type ChartAtrState} from '@/lib/atr';
import {calculateAddPosition,initialAddPositionState} from '@/lib/addPositionCoverage';
import {compileFishProgram} from './algorithm';
import {validateFishBars,fishDelay} from './shared';
import {findQualityAdditionTrigger,requiredConditionsReader,type AdditionCandidate} from './qualityAdditionScan';
import {ADDITION_K_TOUCH_VERSION,ADDITION_POSITION_FLOOR_VERSION,additionUsesNativePosition,isPartialMirror,qualityAdditionAtrSettings,supportDropReduction,type QualityAdditionFill,type QualityAdditionRoundRule,type QualityReductionFill,type QualitySupportReductionRule} from './qualityAddition';
import {createStructureAdditionReader,structureAdditionK,withMinKDistance,type StructureAdditionRule} from './qualityAdditionStructure';
import {additionVetoesNeedMinutes,evaluateAdditionVetoes,additionVetoIdentity,type QualityAdditionEntryVeto,type VetoBar} from './qualityAdditionVeto';
import {ADDITION_PROFIT_KIND,PAYOFF_STOP_KIND,holdingVetoName,activeHoldingVetoes,payoffStopL0Pct,type QualityHoldingVeto,type QualityExitCause} from './qualityVeto';
import type {QualityMirrorFill} from './qualityMirror';
import type {FishReconstructionLoader} from './reconstruction';
import type {TradeSignal} from '@/lib/signalLibrary';
import type {ResearchBar} from '@/lib/deepRsa/window';
import {IMPULSE_1115_CONFIGURABLE_K_VERSION, IMPULSE_1115_DISPLAY_NAME, isImpulse1115PositionVersion, type Dbl5GuardPlusRow} from '@/lib/dbl5GuardPlus';
const MINUTE=60000,STEP=5*MINUTE,PERIOD=14,WARM=PERIOD*20+1;
interface SupportStop {at:number;price:number;support:number;atOpen:boolean;cause?:QualityExitCause;confirmCloses?:number;guardTimeframe?:'1h'}
type Position='native'|'impulse'|'impulse1115';
type AtrSettings=Pick<QualityAdditionRoundRule,'entryBufferAtr'|'supportOffsetAtr'|'entryDistanceAtr'|'gainBasis'|'indicatorIncrease'|'impulsePosition'|'impulse1115Position'>&{entryVetoes?:QualityAdditionEntryVeto[]};
type RoundScan={candidates:AdditionCandidate[];required?:AdditionCandidate[];unavailable?:string;minGainPct?:number;structure?:StructureAdditionRule}&AtrSettings;
interface Options extends AtrSettings {
 positionVersion?:typeof HOLDING_LEDGER_ADDITION_VERSION;
 kStopVersion?:typeof ADDITION_K_TOUCH_VERSION;
 advantage?: import('./qualityAdvantage').QualityAdvantageRule;
 readAdvantage?: (at:number)=>Promise<import('./qualityAdvantage').QualityAdvantageObservation>;
 structure?:StructureAdditionRule;
 supportReduction?:QualitySupportReductionRule;previousReductions?:readonly QualityReductionFill[];
 geometricLock?:import('./qualityAddition').QualityGeometricLockRule;
 breakevenFloor?:import('./qualityAddition').QualityBreakevenFloorRule;
 previousVetoes?:readonly AdditionVetoRecord[];
 vetoes?:readonly QualityHoldingVeto[];pauseAfterAdditionCount?:number;
 /** Opt-in first box break: both lanes stop adding at this confirmed native close; protection continues. */
 additionsBlockedAt?:number;
 candidates:AdditionCandidate[];required?:AdditionCandidate[];
 /** 这一轮的方向条件注定无法满足（如信号没有所选的探测算法）：不再加仓。 */
 unavailable?:string;
 /** 每轮的扫描规则；alternative＝这一轮的进攻备选（【用户要求】2026-11-05 每轮分流：两条同时等候，先满足者成交，同一分钟先保守）。 */
 roundRules?:(RoundScan&{alternative?:RoundScan})[];
 /** 【用户要求】2026-11-06 结构开局：进攻备选从第几次加仓起才参与竞速（缺省 1＝每一次）。 */
 attackFromRound?:number;maxRounds?:number;minGainPct?:number;row:TradeSignal;entry:number;entryPrice:number;notional:number;end:number;since:number;
 prices:readonly ResearchBar[];previous:readonly QualityAdditionFill[];mirror?:QualityMirrorFill;repeat:boolean;liveAt?:number;carriedAdditions?:number;
 ordinaryExit?:{at:number;price:number;atOpen:boolean;mirror:boolean};load:FishReconstructionLoader;signal:AbortSignal;
 initialPayoffRiskPct?: number;
}
/** Causal five-minute ATR values; a resumed run uses the same seed anchor as the original run. */
function atrReader(o:Options){
 let cursor=qualityHistoryFrom(o.load,Math.floor(o.entry/STEP)*STEP-WARM*STEP,STEP),state:ChartAtrState|undefined;
 if(cursor<0)throw Error('加仓支撑线的5分钟ATR历史不足');
 const values=new Map<number,number>(),series:{bar:VetoBar;atr:number}[]=[];
 const plan=compileFishProgram({id:'add-atr-prices',name:'加仓ATR',short:'ATR',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'5m'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
 const read=async(at:number)=>{
  const cut=Math.floor(at/STEP)*STEP;
  while(cursor<cut){
   if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
   const to=Math.min(cut,cursor+500*STEP),bars=await o.load(o.row,cursor,to,plan,o.signal);validateFishBars(bars,to,(to-cursor)/STEP,STEP);
   for(const bar of bars){if(![bar.high,bar.low,bar.close].every(Number.isFinite)||!(bar.low>0)||bar.high<bar.low)throw Error('加仓ATR行情读数无效');state=advanceChartAtr(state,bar,PERIOD);values.set(bar.openTime+STEP,state.value);series.push({bar:{openTime:bar.openTime,open:bar.open,high:bar.high,low:bar.low,close:bar.close},atr:state.value});}cursor=to;await fishDelay(0,o.signal);
  }
  return values.get(cut);
 };
 return Object.assign(read,{series:()=>series});
}
/** 【用户要求】2026-11-03 未加仓理由：支撑线上移（新 C）却没有加仓的每一次，记下第几次加仓、原因与读数。 */
export interface AdditionSkipRecord {at:number;round:number;kind:string;label:string;reading:string;support?:number}
export interface AdditionVetoRecord {at:number;round:number;kind:string;label:string;reading:string;
 /** 冲高回落锁住时：要收复的最高点与锁住的 5 分钟边界（续算时据此恢复锁）。 */
 lockPeak?:number;lockAt?:number}
export async function findCalculatorAdditions(o:Options):Promise<{fills:QualityAdditionFill[];stop?:SupportStop;stageBoundary?:{at:number;price:number};vetoed?:AdditionVetoRecord[];reductions?:QualityReductionFill[];skipped?:AdditionSkipRecord[];guardPlus?:Dbl5GuardPlusRow}>{
 // 镜像止盈须已成交且留有余仓（2026-11-02 起不限 50%，平衡公式对任意比例成立）。镜像成交那一分钟本身不能排出先后，不加仓。
 const independent=o.positionVersion===HOLDING_LEDGER_ADDITION_VERSION,halfMirror=o.mirror;if(!independent&&!isPartialMirror(halfMirror))return {fills:[]};
 const fills=[...o.previous],priceAt=new Map(o.prices.map(b=>[b.openTime,b.open]));
 const carried=o.carriedAdditions??0;
 let after=Math.max(o.entry,o.since-MINUTE,independent?o.entry:halfMirror!.at,fills.at(-1)?.at??o.entry);const readAtr=atrReader(o),readStructure=createStructureAdditionReader(o),prerequisiteReaders=new Map<readonly AdditionCandidate[],(at:number)=>Promise<import('./qualityAddition').QualityAdditionObservation[]|undefined>>();
 const readIncrease=createAdditionIncreaseReader(o);
 let readImpulse:ReturnType<typeof createImpulseAdditionReader>|undefined;
 let positionAttempts:{at:number;ids:Set<string>}|undefined;
 const skipped:AdditionSkipRecord[]=[],skip=(r:AdditionSkipRecord)=>{skipped.push(r);};
 const historyReaders=new Map<readonly QualityAdditionEntryVeto[],ReturnType<typeof createVetoHistoryReader>>();
 const boxBreakReaders=new Map<string,ReturnType<typeof createVetoHistoryReader>>();
 const vetoed:AdditionVetoRecord[]=[],reductions:QualityReductionFill[]=[...(o.previousReductions??[])];
 // 续算时从上一段最后一条锁住记录恢复（收复判断仍按之后的 5 分钟收盘）
 let pullbackLock:{peak:number;at:number}|undefined=(()=>{const r=[...(o.previousVetoes??[])].reverse().find(v=>v.lockPeak!=null&&v.lockAt!=null);return r?{peak:r.lockPeak!,at:r.lockAt!}:undefined;})();
 // 「持仓期间急跌」要买入以来的 1 分钟线：续算时 o.prices 只从 since 起，前面缺的一段补拉一次（同一笔内复用）
 let minuteHistory:ResearchBar[]|undefined;
 const minutePlan=compileFishProgram({id:'add-veto-minutes',name:'加仓否决分钟线',short:'1m',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'1m'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
 const minutesUntil=async(until:number):Promise<ResearchBar[]>=>{
  if(!minuteHistory){
   const pre:ResearchBar[]=[],start=Math.floor(o.entry/MINUTE)*MINUTE,firstKnown=o.prices[0]?.openTime??o.since;
   for(let c=start;c<firstKnown;c+=1000*MINUTE){const to=Math.min(firstKnown,c+1000*MINUTE),chunk=await o.load(o.row,c,to,minutePlan,o.signal);validateFishBars(chunk,to,(to-c)/MINUTE,MINUTE);pre.push(...chunk);}
   minuteHistory=[...pre,...o.prices];
  }
  return minuteHistory.filter(b=>b.openTime+MINUTE<=until);
 };
 const bars=o.prices.filter(b=>b.openTime<o.end);let size=1;while(size<bars.length)size*=2;
 const highTree=new Float64Array(size*2).fill(-Infinity);
 const lowTree=new Float64Array(size*2).fill(Infinity);bars.forEach((b,i)=>{if(!(b.open>0)||!(b.low>0)||!Number.isFinite(b.open)||!Number.isFinite(b.low)||!Number.isFinite(b.high)||b.high<Math.max(b.open,b.low))throw Error('加仓行情读数无效');lowTree[size+i]=b.low;highTree[size+i]=b.high;});for(let i=size-1;i>0;i--){lowTree[i]=Math.min(lowTree[i*2],lowTree[i*2+1]);highTree[i]=Math.max(highTree[i*2],highTree[i*2+1]);}
 /**
  * K 取防守线时：影线不算，5 分钟收盘连续 m 根低于 K（m 由加仓时的行情状态冻结：上涨 1、震荡 2）才确认，
  * 下一分钟开盘卖出（可能低于 K）。5 分钟桶须整段在上次加仓之后。
  */
 const findGuardStop=(support:number,closes:number,from:number):SupportStop|undefined=>{
  const hourly=fills.at(-1)?.structureEvidence?.algorithmVersion===DBL5_PROFILES['1h'].version;
  const step=hourly?3_600_000:STEP;
  let below=0;const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));
  for(let i=first;i<bars.length;i++){
   const b=bars[i],bucketEnd=b.openTime+MINUTE;if(bucketEnd%step!==0||bucketEnd-step<from)continue;
   below=b.close<support?below+1:0;if(below<closes)continue;
   const next=bars[i+1];if(!next)return;
   const exit=o.ordinaryExit;if(exit&&next.openTime===exit.at&&exit.atOpen)return;
   return {at:next.openTime,price:next.open,support,atOpen:true,confirmCloses:closes,...(hourly?{guardTimeframe:'1h' as const}:{})};
  }
 };
 const findStop=(support:number|undefined,from:number):SupportStop|undefined=>{
  if(support==null)return;
  const closes=fills.at(-1)?.structureEvidence?.guardCloses;
  const current=currentK();
  if(current.k===support&&current.sellK!=null){
   const kStop=closes&&o.kStopVersion!==ADDITION_K_TOUCH_VERSION?findGuardStop(current.sellK,closes,from):findTouchStop(current.sellK,from);
   if(current.sellK===support)return kStop;
   const floor=findTouchStop(support,from);
   return floor&&(!kStop||floor.at<kStop.at||floor.at===kStop.at&&floor.atOpen&&!kStop.atOpen)
    ?{...floor,cause:{id:'addition-floor',kind:'addition-support',label:'保本底线 F',direction:'<=',threshold:support}}
    :kStop;
  }
  if(o.kStopVersion===ADDITION_K_TOUCH_VERSION){const cur=currentK();return findTouchStop(cur.k===support?(cur.guard??support):support,from);}
  if(closes){
   // 【用户要求】2026-11-03 保本底线：防守线 K 照旧收盘确认、下一分钟开盘卖；F（＝support，加仓量按它算）盘中碰到即按 F 卖，谁先到算谁
   const cur=currentK(),guard=cur.k===support?cur.guard:undefined;if(guard==null)return findGuardStop(support,closes,from);
   const confirmed=findGuardStop(guard,closes,from),touched=findTouchStop(support,from);
   const floor=touched&&{...touched,cause:{id:'addition-floor',kind:'addition-support' as const,label:'保本底线 F',direction:'<=' as const,threshold:support}};
   return !floor?confirmed:!confirmed||floor.at<confirmed.at?floor:confirmed;
  }
  return findTouchStop(support,from);
 };
 /** 价格盘中碰到这条线即卖出（跳空按开盘价）。 */
 const findTouchStop=(support:number,from:number):SupportStop|undefined=>{
  const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));
  const search=(node:number,left:number,right:number):number=>{if(right<=first||lowTree[node]>(o.kStopVersion===ADDITION_K_TOUCH_VERSION?support*(1+1e-12):support))return -1;if(right-left===1)return left;const middle=(left+right)>>>1,found=search(node*2,left,middle);return found<0?search(node*2+1,middle,right):found;};
  const index=search(1,0,size),bar=bars[index];if(!bar)return;
  const exit=o.ordinaryExit;if(exit&&bar.openTime===exit.at&&(exit.atOpen||!exit.mirror&&exit.price>=support))return;
  const atOpen=bar.open<=(o.kStopVersion===ADDITION_K_TOUCH_VERSION?support*(1+1e-12):support);return {at:bar.openTime,price:atOpen?bar.open:support,support,atOpen};
 };
 const profitRules=activeHoldingVetoes(o.vetoes).filter(v=>v.kind===ADDITION_PROFIT_KIND).sort((a,b)=>a.id.localeCompare(b.id));
 // 【用户要求】2026-11-03 盈亏比止盈：整笔盈亏 ÷ L₀ ≥ N 时卖出全部持仓；L₀＝初始仓位 × 静态回撤%
 const payoffRules=activeHoldingVetoes(o.vetoes).filter(v=>v.kind===PAYOFF_STOP_KIND),payoffL0Pct=o.initialPayoffRiskPct??payoffStopL0Pct(o.vetoes),payoffL0=payoffL0Pct!=null?o.notional*payoffL0Pct/100:undefined;
 /** 盈亏比止盈：当前持仓不变的这段里，价格涨到 (N×L₀＋持仓成本−已落袋)÷持仓币数 即全部卖出；跳空高开按开盘价。 */
 const findPayoff=(from:number):SupportStop|undefined=>{
  if(!payoffRules.length||!(payoffL0!>0))return;
  const h=holdings(Number.MAX_SAFE_INTEGER);if(!(h.held>0))return;
  const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));let best:SupportStop|undefined;
  for(const v of payoffRules){
   const phaseFrom=mirrorHardStopRange(v,o.mirror,from);if(!Number.isFinite(phaseFrom))continue;const first=Math.max(0,Math.ceil((phaseFrom-(bars[0]?.openTime??phaseFrom))/MINUTE));
   const target=(v.threshold*payoffL0!+h.cost-h.realized)/h.held;if(!(target>0)||!Number.isFinite(target))continue;
   const search=(node:number,left:number,right:number):number=>{if(right<=first||highTree[node]<target*(1-1e-12))return -1;if(right-left===1)return left;const middle=(left+right)>>>1,found=search(node*2,left,middle);return found<0?search(node*2+1,middle,right):found;};
   const bar=bars[search(1,0,size)];if(!bar||!mirrorHardStopActive(v,o.mirror,bar.openTime))continue;
   const ordinary=o.ordinaryExit;if(ordinary&&bar.openTime===ordinary.at&&(ordinary.atOpen||!ordinary.mirror||ordinary.price<=target))continue;
   const atOpen=bar.open>=target*(1-1e-12),price=atOpen?bar.open:target;
   const hit:SupportStop={at:bar.openTime,price,support:currentK().k??o.entryPrice,atOpen,cause:{...(v.mirrorStage?{mirrorStage:v.mirrorStage}:{}),id:v.id,label:v.mirrorStage?holdingVetoName(v):v.label,kind:v.kind,direction:v.direction,threshold:v.threshold,payoffBasis:{l0:payoffL0!,l0Pct:payoffL0Pct!,targetPrice:target,pnl:h.held*price-h.cost+h.realized}}};
   if(!best||hit.at<best.at||hit.at===best.at&&hit.price<best.price)best=hit;
  }
  return best;
 };
 const findPositionExit=(support:number|undefined,from:number):SupportStop|undefined=>{
  const sellK=currentK().sellK??support;
  // 【用户要求】2026-11-03 几何仓位 > 门槛时，止损从 Kₘ 上移到 Kₘ＋x%×首次开仓价，至少保住 x% 的开仓价有效涨幅
  const lockRule=o.geometricLock?.enabled?o.geometricLock:undefined;let lockStop:SupportStop|undefined,locked=false;
  if(lockRule&&sellK!=null&&fills.length){
   const h=holdings(Number.MAX_SAFE_INTEGER),M=h.held/(o.notional/o.entryPrice),line=sellK+lockRule.pct/100*o.entryPrice;
   if(M>lockRule.multiple&&line>sellK){locked=true;const hit=findTouchStop(line,from);if(hit)lockStop={...hit,cause:{id:'geometric-lock',kind:'addition-support',label:`几何仓位 > ${lockRule.multiple} 保住有效涨幅`,direction:'<=',threshold:line,geometricLock:{multiple:M,threshold:lockRule.multiple,pct:lockRule.pct,line,k:sellK}}};}
  }
  const stop0=locked?lockStop:findStop(support,from),payoffHit=findPayoff(from),stop=payoffHit&&(!stop0||payoffHit.at<stop0.at||payoffHit.at===stop0.at&&payoffHit.atOpen&&!stop0.atOpen)?payoffHit:stop0;
  if(!fills.length||sellK==null||support==null||!profitRules.length)return stop;
  const initialCoins=o.notional/o.entryPrice,heldCoins=initialCoins*(1-(halfMirror?.fraction??0))+fills.reduce((n,a)=>n+a.quantity,0)-reductions.reduce((n,r)=>n+r.quantity,0),multiple=heldCoins/initialCoins;
  const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));
  let profit:SupportStop|undefined;
  for(const v of profitRules){
   const phaseFrom=mirrorHardStopRange(v,o.mirror,from);if(!Number.isFinite(phaseFrom))continue;const first=Math.max(0,Math.ceil((phaseFrom-(bars[0]?.openTime??phaseFrom))/MINUTE));
   const required=v.geometricMultiple??100;if(multiple+32*Number.EPSILON*Math.max(1,multiple,required)<required)continue;
   const target=sellK*(1+v.threshold/100);if(!(target>0)||!Number.isFinite(target))throw Error('加仓止盈目标价超出有效范围');
   const search=(node:number,left:number,right:number):number=>{if(right<=first||highTree[node]<target*(1-1e-12))return -1;if(right-left===1)return left;const middle=(left+right)>>>1,found=search(node*2,left,middle);return found<0?search(node*2+1,middle,right):found;};
   const bar=bars[search(1,0,size)];if(!bar||!mirrorHardStopActive(v,o.mirror,bar.openTime))continue;
   const ordinary=o.ordinaryExit;if(ordinary&&bar.openTime===ordinary.at&&(ordinary.atOpen||!ordinary.mirror||ordinary.price<=target))continue;
   const atOpen=bar.open>=target*(1-1e-12),hit={at:bar.openTime,price:atOpen?bar.open:target,support,atOpen,cause:{...(v.mirrorStage?{mirrorStage:v.mirrorStage}:{}),id:v.id,label:v.mirrorStage?holdingVetoName(v):v.label,kind:v.kind,direction:v.direction,threshold:v.threshold,geometricMultiple:required,additionBasis:{geometricMultiple:multiple,equilibriumPrice:sellK,targetPrice:target}}};
   if(!profit||hit.at<profit.at||hit.at===profit.at&&(hit.atOpen&&!profit.atOpen||hit.atOpen===profit.atOpen&&hit.price<profit.price))profit=hit;
  }
  // The minute open is ordered. When both intraminute boundaries touch, retain the protective stop.
  if(!stop)return profit;if(!profit)return stop;
  return profit.at<stop.at||profit.at===stop.at&&profit.atOpen&&!stop.atOpen?profit:stop;
 };

 const hasGuardPlus=!!o.structure?.guardPlusVersion||o.roundRules?.some(round=>round.structure?.guardPlusVersion||round.alternative?.structure?.guardPlusVersion);
 const done=async(stop?:SupportStop)=>{
  const last=fills.at(-1),round=last?o.roundRules?.[carried+fills.length-1]:undefined;
  const lastRule=last?.lane==='attack'?round?.alternative?.structure:round?.structure??o.structure;
  const guardPlus=hasGuardPlus?await readStructure.latestGuardPlus(Math.min(o.end,stop?.at??o.end),lastRule):undefined;
  return {fills,stop,...(vetoed.length?{vetoed}:{}),...(reductions.length?{reductions}:{}),...(skipped.length?{skipped}:{}),...(guardPlus?{guardPlus}:{})};
 };
 /** 当前止损线 K：最近一次加仓的 K，或其后支撑下移减仓移到的 K′。 */
 const currentK=():{k?:number;at?:number;guard?:number;sellK?:number}=>{
  const f=fills.at(-1),r=reductions.at(-1);
  if(r&&(!f||r.at>=f.at))return {k:r.newK,at:r.at,guard:r.newGuardK,sellK:r.newPositionK};
  return f?{k:f.sizing?.support,at:f.at,guard:f.sizing?.guardK,sellK:f.sizing?.positionK}:{};
 };
 /** 某时刻的持仓（含镜像、加仓、此前减仓）：币数、按均价的持仓成本、已实现利润。 */
 const holdings=(at:number)=>{
  if(independent)return replayQualityHoldingLedger({notional:o.notional,entryPrice:o.entryPrice,entryAt:o.entry,additions:fills,mirror:o.mirror,reductions,through:at,details:false});
  const coins0=o.notional/o.entryPrice,m=o.mirror&&(o.mirror.at<at||o.mirror.at===at&&o.mirror.atOpen)?o.mirror:undefined;
  let held=coins0,cost=o.notional,mirrorProfit=0,reductionProfit=0;
  if(m){held-=coins0*m.fraction;cost-=o.notional*m.fraction;mirrorProfit=coins0*m.fraction*(m.price-o.entryPrice);}
  for(const f of fills)if(f.at<=at){held+=f.quantity;cost+=f.notional;}
  for(const r of reductions)if(r.at<=at){held-=r.quantity;cost-=r.costRemoved;reductionProfit+=r.realizedPnl;}
  return {held,cost,mirrorProfit,reductionProfit,realized:mirrorProfit+reductionProfit,mirrorQuantity:coins0*(m?.fraction??0)};
 };
 const dropRule=o.supportReduction?.enabled?o.supportReduction:undefined;
 interface SupportDrop {at:number;support:number;atr:number;evidence:import('./qualityAdditionStructure').StructureAdditionEvidence;basis:number}
 /** 最近一次加仓所依据的箱体支撑（或减仓后的新支撑）在 (from, until) 内首次下移 ≥ minDropAtr×ATR 的 5 分钟收盘。 */
 const findSupportDrop=async(from:number,until:number):Promise<SupportDrop|undefined>=>{
  const last=fills.at(-1),evidence=last?.structureEvidence;if(!dropRule||!last||!evidence||evidence.algorithm==='impulse5m'||isImpulse1115PositionVersion(evidence.algorithmVersion))return;
  const previousRound=o.roundRules?.[carried+fills.length-1];
  const winningAlternative=last.lane==='attack'&&(evidence.algorithmVersion===DBL5_PROFILES['1h'].version||evidence.guardPlus||previousRound?.impulsePosition||previousRound?.alternative?.impulsePosition||previousRound?.impulse1115Position||previousRound?.alternative?.impulse1115Position);
  const rule=winningAlternative?previousRound?.alternative?.structure:previousRound?.structure??o.structure;if(!rule)return;
  const lastReduction=reductions.filter(r=>r.at>last.at).at(-1),basis=lastReduction?lastReduction.newSupport:evidence.basePrice;
  for(const p of await readStructure.supports(rule,until)){
   if(p.at<=from||p.at>=until)continue;
   // A new segment or an expired impulse cannot relax a K frozen by the earlier combination.
   if(evidence.guardPlus&&(p.guardPlus?.segment_id!==evidence.guardPlus.segment_id||
     evidence.guardPlus.guard_source==='IMPULSE'&&p.guardPlus?.active_impulse?.impulse_id!==evidence.guardPlus.active_impulse?.impulse_id))continue;
   const value=rule.kSource==='guard'?p.guard:p.support;if(value==null||!(value>0))continue;
   const atr=p.nativeAtr??await readAtr(p.at);if(!(atr!>0)||!Number.isFinite(atr))continue;
   if(value<basis-dropRule.minDropAtr*atr!)return {at:p.at,support:value,atr:atr!,evidence,basis};
  }
 };
 /** 减仓计算器：X＝(S−K′)÷(T−K′)。S 为整笔保本价，K′＝新支撑−n×ATR，T 为下移确认后下一分钟开盘价。
  * 【用户要求】2026-11-02 K 自最近一次加仓起连续下移达到设定次数（含这一次）时，不再减仓，而是在 T 全仓卖出（返回卖出点）。 */
 const applyDrop=async(d:SupportDrop):Promise<SupportStop|undefined>=>{
  const T=priceAt.get(d.at),{k:Kold,guard:Gold,sellK:sellKold}=currentK();if(!(T!>0)||!Number.isFinite(T)||Kold==null||!(T!>Kold))return;
  const guardSel=structureAdditionK({...d.evidence,basePrice:d.support},d.atr),floorAtr=(Gold??sellKold)!=null?fills.at(-1)?.sizing?.floorAtr:undefined;
  const selected=guardSel&&floorAtr!=null?structureAdditionK({...d.evidence,basePrice:guardSel.k,buffer:floorAtr,bufferUnit:'atr'},d.atr):guardSel;if(!selected||!(selected.k<Kold))return;
  const limit=dropRule!.exitAfterDrops,lastFill=fills.at(-1)?.at??-Infinity,count=reductions.filter(r=>r.at>lastFill).length+1;
  if(limit!=null&&count>=limit)return {at:d.at,price:T!,support:selected.k,atOpen:true,cause:{id:'addition-support-drops',kind:'addition-support',label:`K 连续下移 ${count} 次`,direction:'<=',threshold:selected.k,supportDrops:{count,previousK:Kold,newK:selected.k,support:d.support}}};
  const Kn=selected.k,held=holdings(d.at),cut=supportDropReduction(held,T!,Kn,dropRule!.maxPct);if(!cut)return;
  const {fraction,breakeven}=cut,quantity=fraction*held.held,costRemoved=fraction*held.cost;
  reductions.push({at:d.at,price:T!,fraction,quantity,costRemoved,realizedPnl:quantity*T!-costRemoved,breakeven,previousK:Kold,newK:Kn,previousSupport:d.basis,newSupport:d.support,atr:d.atr,...(floorAtr!=null&&guardSel?(sellKold!=null?{previousPositionK:sellKold,newPositionK:guardSel.k}:{newGuardK:guardSel.k}):{})});
 };
 while(after<o.end){
  if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
  const {k:support,at:supportAt}=currentK(),stop=findPositionExit(support,Math.max(o.since,supportAt??o.since));
  const pendingMirror=independent&&o.mirror&&o.mirror.at>after&&o.mirror.at<o.end?o.mirror.at:undefined;
  const scanEnd=Math.min(stop?Math.min(o.end,stop.at+(stop.atOpen?0:MINUTE)):o.end,pendingMirror!=null?pendingMirror+MINUTE:Infinity);
  if(scanEnd<=after)return done(stop);
  // 【用户要求】2026-11-02 支撑线下移减仓：先找下移事件；比它早的加仓照常处理，否则在下移那一刻按减仓计算器减仓
  const drop=await findSupportDrop(Math.max(after,supportAt??after),scanEnd);
  const completed=carried+fills.length,roundNo=completed+1;
  const roundEntry=o.roundRules?.[completed],alternative=roundNo>=(o.attackFromRound??1)?roundEntry?.alternative:undefined,primaryRule=roundEntry??o;
  const addsDone=completed>=(o.maxRounds??(o.repeat?Infinity:1))||!!primaryRule.unavailable&&(!alternative||!!alternative.unavailable),addEnd=Math.min(drop?Math.min(scanEnd,drop.at):scanEnd,o.additionsBlockedAt??Infinity);
  if(addsDone||addEnd<=after){if(drop){const exit=await applyDrop(drop);if(exit)return done(exit);after=drop.at;continue;}return done(stop);}
  let round:RoundScan|Options=primaryRule;
  const soldBefore=o.notional/o.entryPrice*(halfMirror?.fraction??0);
  const coinsBefore=o.notional/o.entryPrice+fills.reduce((n,f)=>n+f.quantity,0)-soldBefore;
  const roundHolding=independent?holdings(after+MINUTE):undefined;
  if(roundHolding&&!(roundHolding.held>0))return done(stop);
  const realAverageBefore=roundHolding?roundHolding.cost/roundHolding.held:(o.notional+fills.reduce((n,f)=>n+f.notional,0)-o.notional*halfMirror!.fraction)/coinsBefore;
  // 【用户要求】2026-11-01 涨幅门槛相对最新成本线 S（首轮为首次买入价，之后为上一次的 K），不是持仓均价、也不是首仓
  // 2026-11-04 可选「相对持仓均价」（10-31 版口径）：gainBasis＝'average'
  const basis=round.gainBasis==='average'?'real-average' as const:'cost-line' as const,referencePrice=basis==='real-average'?realAverageBefore:support??o.entryPrice;
  const p8=(x:number)=>+x.toPrecision(8);
  const onSkip=(x:import('./qualityAdditionStructure').StructureSkip)=>{
   if(x.reason==='guard-retest'){
    skip({at:x.at,round:roundNo,support:x.support,kind:'guard-retest',label:'等待防守线独立回踩',reading:'首根低点形成的箱底须经独立回踩确认；本次收盘尚未确认'});
    return;
   }
   skip({at:x.at,round:roundNo,support:x.support,...(x.reason==='gain'?{kind:'gain',label:'涨幅门槛未达',reading:`收盘 ${p8(x.close!)} 比${basis==='real-average'?'持仓均价':'成本线 S'} ${p8(x.referencePrice!)} 只涨 ${((x.close!/x.referencePrice!-1)*100).toFixed(2)}%，要求 ≥ ${x.thresholdPct}%`}:x.reason==='no-guard'?{kind:'no-guard',label:'防守线断开',reading:'这一刻防守线刚被跌破、尚未重建，没有 K 基准'}:x.reason==='guard-range'?{kind:'guard-range',label:'防守线是虚线（震荡期）',reading:'只用实线时，震荡期不加仓'}:{kind:'no-old-c',label:'没有旧 C',reading:'上一根 5 分钟线上没有不同的有效箱体（首个箱体或中间支撑失效），K 没有旧 C 可用'})});
  };
  const previousFillAt=fills.at(-1)?.at??o.entry;
  const scanRoundHit=async(rule:RoundScan|Options,end:number,gainBasis:typeof basis,reference:number,start=after,position:Position='native')=>{
   if(rule.unavailable||end<=start)return;
   const gain=rule.minGainPct==null?undefined:{referencePrice:reference,thresholdPct:rule.minGainPct,basis:gainBasis};
   const check=rule.indicatorIncrease ? async(at:number,support?:number)=>{
    const {readings,reason}=await readIncrease(rule.indicatorIncrease!.metrics,at,previousFillAt);
    if(!reason)return readings;
    skip({at,round:roundNo,kind:'indicator-increase',label:'指标读数未较上次成交增大',reading:reason,...(support==null?{}:{support})});
   }:undefined;
   if(position==='native'&&!rule.structure)return findQualityAdditionTrigger({...o,candidates:rule.candidates,required:rule.required,
    after:start,end,priceAt,checkIncrease:check,...(gain?{priceGate:gain}:{})});
   let cursor=start;
   while(cursor<end){
    const hit=position==='impulse'?await (readImpulse??=createImpulseAdditionReader(o))(rule.impulsePosition!,cursor,end,gain):
      position==='impulse1115'?await readStructure.impulse1115(cursor,end,fills,gain,onSkip):
        await readStructure(rule.structure!,cursor,end,fills,gain,onSkip);
    if(!hit||!check)return hit;
    const readings=await check(hit.at,hit.structureEvidence?.supportPrice);
    if(readings)return {...hit,indicatorIncrease:readings};
    cursor=hit.at;
   }
  };
  // Only the new native-break version filters each lane before the race.
  // A vetoed primary must not suppress an eligible alternative at the same time.
  const findRoundHit=async(...args:Parameters<typeof scanRoundHit>)=>{
   const hit=await scanRoundHit(...args),rule=args[0],rules=rule.entryVetoes;
   if(!hit||!rules?.some(v=>v.enabled&&v.kind==='box-break'))return hit;
   const nativeRules=rules.filter(v=>v.enabled&&v.kind==='box-break'),readerKey=JSON.stringify(additionVetoIdentity(nativeRules));
   let read=boxBreakReaders.get(readerKey);
   if(!read){read=createVetoHistoryReader({rules:nativeRules,entry:o.entry,row:o.row,load:o.load,signal:o.signal});boxBreakReaders.set(readerKey,read);}
   const result=await read(hit.at);
   if(!result.hit&&!result.pending)return hit;
   vetoed.push({at:hit.at,round:roundNo,...(result.hit??{kind:'box-break-pending',label:'箱体断裂待判定',reading:result.pending!})});
   return undefined;
  };
  const skipMark=skipped.length;
  let hit:Omit<QualityAdditionFill,'quantity'|'notional'>|undefined;
  if(primaryRule.impulsePosition||alternative?.impulsePosition||primaryRule.impulse1115Position||alternative?.impulse1115Position){
   let first:typeof hit;
   const choose=async(rule:RoundScan|Options,lane:'structure'|'attack',position:Position)=>{
    if(!(position==='native'?additionUsesNativePosition(rule):position==='impulse'?rule.impulsePosition:rule.impulse1115Position))return;
    const key=lane+'-'+position;
    const revisit=positionAttempts?.at===after&&fills.at(-1)?.at!==after&&!positionAttempts.ids.has(key);
    const candidateBasis=rule.gainBasis==='average'?'real-average':'cost-line';
    const reference=candidateBasis==='real-average'?realAverageBefore:support??o.entryPrice;
    const found=await findRoundHit(rule,first?Math.min(addEnd,first.at+MINUTE):addEnd,candidateBasis,reference,revisit?after-MINUTE:after,position);
    if(found&&(!first||found.at<first.at)){
     first=found;round=rule;winner=key;
     if(alternative&&!alternative.unavailable)first.lane=lane;
    }
   };
   let winner='';
   for(const position of ['native','impulse','impulse1115'] as const)await choose(primaryRule,'structure',position);
   if(alternative)for(const position of ['native','impulse','impulse1115'] as const)await choose(alternative,'attack',position);
   hit=first;
   if(hit){
    for(let i=skipped.length-1;i>=skipMark;i--)if(skipped[i].at>hit.at)skipped.splice(i,1);
    if(positionAttempts?.at!==hit.at)positionAttempts={at:hit.at,ids:new Set()};
    positionAttempts.ids.add(winner);
   }
  }else{
   hit=await findRoundHit(round,addEnd,basis,referencePrice);
   if(hit?.structureEvidence){const price=priceAt.get(hit.at);if(!(price!>0)||!Number.isFinite(price))throw Error('缺少箱体加仓下一分钟开盘价');hit.price=price!;}
   // 【用户要求】2026-11-05 每轮分流：这一轮的进攻备选同时等候，只在保守成交之前找；更早成交就走进攻，同一分钟先保守。
   // 进攻赢了时，保守那边在它之后记下的「未加仓理由」作废（下一轮会从成交之后重新扫到）。
   if(alternative&&!alternative.unavailable){
    const altBasis=alternative.gainBasis==='average'?'real-average' as const:'cost-line' as const,altReference=altBasis==='real-average'?realAverageBefore:support??o.entryPrice,altEnd=hit?hit.at:addEnd;
    const alt=await findRoundHit(alternative,altEnd,altBasis,altReference);
    if(alt?.structureEvidence){const price=priceAt.get(alt.at);if(!(price!>0)||!Number.isFinite(price))throw Error('缺少箱体加仓下一分钟开盘价');alt.price=price!;}
    if(alt&&(!hit||alt.at<hit.at)){for(let i=skipped.length-1;i>=skipMark;i--)if(skipped[i].at>alt.at)skipped.splice(i,1);hit=alt;round=alternative;hit.lane='attack';}
    else if(hit)hit.lane='structure';
   }
  }
  // A rejected later lane is speculative once an earlier lane wins.
  if(hit)for(let i=vetoed.length-1;i>=0;i--)if(vetoed[i].round===roundNo&&vetoed[i].at>hit.at&&['box-break','box-break-pending'].includes(vetoed[i].kind))vetoed.splice(i,1);
  if(hit?.structureEvidence&&Number.isNaN(hit.price)){
   const price=priceAt.get(hit.at);
   if(!(price!>0)||!Number.isFinite(price))throw Error('缺少位置加仓下一分钟开盘价');
   hit.price=price!;
  }
  if(!hit){if(drop){const exit=await applyDrop(drop);if(exit)return done(exit);after=drop.at;continue;}if(pendingMirror!=null&&addEnd===pendingMirror+MINUTE){after=pendingMirror;continue;}return done(stop);}
  if(independent&&o.mirror?.at===hit.at){after=hit.at;skip({at:hit.at,round:roundNo,kind:'mirror-minute',label:'镜像成交分钟不加仓',reading:'同一分钟不借用尚未完成的镜像成交与落袋盈亏，等待下一次机会'});continue;}
  // 箱体时机的「方向」指标条件（必要不充分）：事件那一刻不全满足，就跳过这个事件、继续等下一个。
  if(hit.structureEvidence&&round.required?.length){
   let read=prerequisiteReaders.get(round.required);if(!read)prerequisiteReaders.set(round.required,read=requiredConditionsReader(round.required,o));
   const confirmed=await read(hit.at);if(!confirmed){skip({at:hit.at,round:roundNo,support:hit.structureEvidence.supportPrice,kind:'direction',label:'方向条件未满足',reading:`需同时满足：${round.required.map(c=>`${c.label} ${c.direction} ${c.threshold}`).join(' 且 ')}`});after=hit.at;continue;}
   hit.conditions=confirmed;
  }
  // 【用户要求】2026-11-02 加仓否决：方向满足后，加仓那一刻任一否决条件成立就跳过这一次，记下原因，继续等下一个新 C
  // 【用户要求】2026-11-03 冲高回落锁住：收复锁住时的持仓最高点（之后某根 5 分钟收盘 ≥ 该价）之前，新 C 一律不加
  if(pullbackLock){
   await readAtr(hit.at);const cut=Math.floor(hit.at/STEP)*STEP,since=readAtr.series().filter(x=>x.bar.openTime>=pullbackLock!.at&&x.bar.openTime+STEP<=cut);
   if(since.some(x=>x.bar.close>=pullbackLock!.peak))pullbackLock=undefined;
   else{const last=since.at(-1)?.bar.close;vetoed.push({at:hit.at,round:roundNo,kind:'pullback',label:'冲高回落：未收复最高点前不再加仓',reading:`锁住时持仓最高 ${+pullbackLock.peak.toPrecision(8)}，尚未收复${last!=null?`（最新收盘 ${+last.toPrecision(8)}）`:''}`,lockPeak:pullbackLock.peak,lockAt:pullbackLock.at});after=hit.at;continue;}
  }
  if(round.entryVetoes?.some(v=>v.enabled)){
   if(round.entryVetoes.some(v=>v.enabled&&v.kind!=='guard-distance'&&v.kind!=='box-break')){
    await readAtr(hit.at);const cut=Math.floor(hit.at/STEP)*STEP,s=readAtr.series().filter(x=>x.bar.openTime+STEP<=cut);
    const legacyVetoes=round.entryVetoes.filter(v=>v.historyHours==null&&v.kind!=='guard-distance'&&v.kind!=='box-break'),minutes=additionVetoesNeedMinutes(legacyVetoes)?await minutesUntil(hit.at):undefined;
    const veto=evaluateAdditionVetoes(legacyVetoes,s.map(x=>x.bar),s.map(x=>x.atr),o.entry,minutes);
    if(veto){const {lockPeak,...hitText}=veto;if(lockPeak!=null)pullbackLock={peak:lockPeak,at:cut};vetoed.push({at:hit.at,round:roundNo,...hitText,...(lockPeak!=null?{lockPeak,lockAt:cut}:{})});after=hit.at;continue;}
   }
   if(round.entryVetoes.some(v=>v.enabled&&(v.kind!=='box-break'&&(v.historyHours!=null||v.kind==='guard-distance')))){
    let history=historyReaders.get(round.entryVetoes);if(!history){history=createVetoHistoryReader({rules:round.entryVetoes.filter(v=>v.kind!=='box-break'),entry:o.entry,row:o.row,load:o.load,signal:o.signal});historyReaders.set(round.entryVetoes,history);}
    const minute=o.prices[(hit.at-MINUTE-(o.prices[0]?.openTime??hit.at))/MINUTE];
    const result=await history(hit.at,minute);
    if(result.hit||result.pending){
     const distancePending=result.pendingKind==='guard-distance';
     const detail=result.hit??{kind:distancePending?'guard-distance-pending':'history-pending',
      label:distancePending?'防守线距离待判定':'历史扫描等待',reading:result.pending!};
     vetoed.push({at:hit.at,round:roundNo,...detail});after=hit.at;continue;
    }
   }
  }
  const atrAt=Math.floor(hit.at/STEP)*STEP,atr=await readAtr(hit.at);
  if(!(atr!>0)||!Number.isFinite(atr))throw Error('缺少加仓时已收盘的5分钟ATR读数');
  const {supportOffsetAtr}=qualityAdditionAtrSettings(round);
  const impulse1115=isImpulse1115PositionVersion(hit.structureEvidence?.algorithmVersion) ? round.impulse1115Position : undefined;
  const earlyImpulse=hit.structureEvidence?.guardPlus?.early_impulse_event;
  let kAtr=hit.structureEvidence?.nativeAtr??atr!;
  if(hit.structureEvidence&&earlyImpulse&&impulse1115?.version===IMPULSE_1115_CONFIGURABLE_K_VERSION){
   kAtr=earlyImpulse.frozen_atr;
   hit.structureEvidence={...hit.structureEvidence,algorithmVersion:impulse1115.version,
    basePrice:earlyImpulse.impulse_origin_low,bufferUnit:'atr',buffer:impulse1115.bufferAtr,
    parameters:{detection:hit.structureEvidence.parameters,bufferAtr:impulse1115.bufferAtr,referenceAtr:kAtr}};
   hit.featureId=impulse1115.version;
   hit.label=`${IMPULSE_1115_DISPLAY_NAME} · 首次急拉`;
  }
  const boxK=hit.structureEvidence?structureAdditionK(hit.structureEvidence,kAtr):undefined;
  if(boxK&&hit.structureEvidence?.algorithmVersion===IMPULSE_1115_CONFIGURABLE_K_VERSION){
   hit.structureEvidence={...hit.structureEvidence,supportPrice:boxK.k,guardPrice:boxK.k};
   hit.reading=boxK.k;
  }
  // 【用户要求】2026-11-03 K 最小距离：K 离加仓价不足设定百分比时放宽到 T×(1−x%)，加仓量与止损都按放宽后的 K
  const minDistancePct=impulse1115?impulse1115.minDistancePct:
    hit.structureEvidence?.algorithm==='impulse5m'?round.impulsePosition?.minDistancePct:round.structure?.minDistancePct;
  const selected=boxK&&hit.structureEvidence?withMinKDistance(hit.structureEvidence,boxK,hit.price,hit.structureEvidence.nativeAtr??atr!,minDistancePct):boxK;
  const sellK=hit.structureEvidence?selected?.k??NaN:hit.price-supportOffsetAtr*atr!;
  const floor=o.breakevenFloor,followPosition=floor?.version===ADDITION_POSITION_FLOOR_VERSION;
  const floorRule=floor?.enabled&&(followPosition||hit.structureEvidence?.guardCloses&&selected)?floor:undefined;
  const floorK=floorRule?(hit.structureEvidence&&selected?
   structureAdditionK({...hit.structureEvidence,...selected,basePrice:sellK,buffer:floorRule.atr,bufferUnit:'atr'},hit.structureEvidence.nativeAtr??atr!)?.k??NaN:
   sellK-floorRule.atr*atr!):undefined;
  const K=floorK??sellK,S=support??o.entryPrice;after=hit.at;
  if(hit.structureEvidence&&(!selected||hit.price<=hit.structureEvidence.supportPrice||support!=null&&K<support)){const ev=hit.structureEvidence;
   skip({at:hit.at,round:roundNo,support:ev.supportPrice,...(!selected?{kind:'k-invalid',label:'K 算不出来',reading:`冗余 ${ev.buffer}${ev.bufferUnit==='atr'?' ATR':'%'} 大于 K 基准 ${p8(ev.basePrice)}`}:hit.price<=ev.supportPrice?{kind:'below-c',label:'价格已回到新 C 之下',reading:`下一分钟开盘 T ${p8(hit.price)} ≤ 新 C ${p8(ev.supportPrice)}`}:{kind:'k-lower',label:'K 低于上一次的 K',reading:`这次 K ${p8(K)} < 现在的 K ${p8(support!)}，加仓会把止损线往下挪`})});continue;}
  if(followPosition&&floorRule){
   const levels=currentK(),priorSellK=levels.sellK??levels.guard??levels.k;
   if(support!=null&&K<support||priorSellK!=null&&sellK<priorSellK){
    skip({at:hit.at,round:roundNo,kind:'k-lower',label:'卖出线低于当前保护',reading:'本次加仓会下移现有卖出 K 或保本底线 F'});continue;
   }
  }
  if(hit.structureEvidence&&selected)hit.structureEvidence={...hit.structureEvidence,...selected};
  // 2026-11-01 用户删除「入场距离 T ≥ S＋n×ATR」门槛：位置达到即按均衡线 K 定量，不再要求 T 高出 S 多少。
  const buffer=hit.price-S;
  if(!(K>0)){skip({at:hit.at,round:roundNo,kind:'k-invalid',label:'K 算不出来',reading:`K ${p8(K)} ≤ 0`});continue;}
  // 【用户要求】2026-11-04 恢复「指标＋入场距离（S/T/K）」：T 须高出成本线 S 至少 n×ATR 才加（与 10-31 版同一判断，含浮点容差）
  if(!hit.structureEvidence&&round.entryDistanceAtr!=null){const minimum=round.entryDistanceAtr*atr!;
   if(buffer+8*Number.EPSILON*Math.max(hit.price,S,minimum)<minimum){skip({at:hit.at,round:roundNo,kind:'entry-distance',label:'入场距离不足',reading:`T ${p8(hit.price)} 只比成本线 S ${p8(S)} 高 ${(buffer/atr!).toFixed(2)} ATR，要求 ≥ ${round.entryDistanceAtr} ATR`});continue;}}
  // 持仓、成本与落袋利润都扣除了此前的支撑下移减仓（G＝本轮全部已实现净盈亏，减仓所得也算）
  const held=holdings(hit.at),Q=held.held,cost=held.cost;
  const profit=Math.max(0,held.mirrorProfit+held.reductionProfit);
  // 【用户要求】2026-11-03 ORDIUSDT「K 下移时并未减仓，后续的加仓也出了问题」：减仓比例 X 正是让余仓保本价落到 K′ 的那一份，
  // 减仓所得已经花在把成本线压到 K′ 上；再按「成本线 S＝K′、可用＝落袋 − 各次加仓用掉的镜像利润」算，就把这笔所得又算了一遍（多加 8.25%）。
  // 有过支撑下移减仓时改按实际持仓：成本线取整笔保本价 b＝(持仓成本 − 全部已实现净盈亏)÷Q，可用落袋记 0，
  // 于是 Q×(K−b)＝各仓按开仓价在 K 的浮盈垫 + G，与加仓校验同一笔账（b 高于或低于 K′ 都成立）。
  // 没有减仓时两种算法相等（平衡公式保证成本线＝上一次 K），仍用原式，旧结果逐位不变。
  // 只有 v2（version＝2）这样算；v1 的方案与模板照旧（2026-11-03 用户要求模板必须原样复原）。
  const reduced=o.supportReduction?.version===2&&reductions.some(r=>r.at<=hit.at),used=fills.reduce((n,f)=>n+(f.sizing?.mirrorUsed??0),0);
  const Sb=independent?(cost-held.realized)/Q:reduced?(cost-(held.mirrorProfit+held.reductionProfit))/Q:S;
  const state=reduced?{...initialAddPositionState(Sb,Q,profit,cost/Q),mirrorProfitAllocated:profit,mirrorProfitAvailable:0}:{...initialAddPositionState(S,Q,profit,cost/Q),mirrorProfitAllocated:used,mirrorProfitAvailable:Math.max(0,profit-used)};
  const sized=independent?calculateHoldingLedgerAddition(held,hit.price,K):calculateAddPosition({currentPrice:hit.price,support:K,state});after=hit.at;
  if(sized.error==='position_closed')return done(stop);
  if(sized.error==='invalid_input')throw Error('加仓支撑线或持仓状态无效');
  if(sized.error||!(sized.addCoins>0)){skip({at:hit.at,round:roundNo,support:hit.structureEvidence?.supportPrice,kind:'sizing',label:sized.error==='risk_budget_insufficient'?'持仓风险预算不足':sized.error==='mirror_profit_insufficient'?'落袋利润不够':sized.error==='price_not_above_support'?'价格不高于 K':'加仓量为 0',reading:sized.error==='risk_budget_insufficient'?`Q×K−持仓成本＋已实现净盈亏仍差 ${p8(sized.oldLossShortfall)} USDT，不能增加风险`:sized.error==='mirror_profit_insufficient'?`K ${p8(K)} 低于成本线 S ${p8(S)}，旧仓碰 K 的亏损比可用落袋利润多 ${p8(sized.oldLossShortfall)} USDT`:sized.error==='price_not_above_support'?`T ${p8(hit.price)} ≤ K ${p8(K)}`:`按平衡公式算出的加仓量 ${p8(sized.addCoins)} 枚`});continue;}
  const notional=sized.addCoins*hit.price;if(!Number.isFinite(notional)||!Number.isFinite(sized.addCoins))throw Error('加仓币数超出可计算范围');
  // Reject only the opportunity; original sizing inputs, successful rounds and mirror allocations stay intact.
  const advantage=o.readAdvantage?await o.readAdvantage(hit.at):undefined;
  if(o.advantage?.screenWeak&&advantage?.grade==='W'){
   vetoed.push({at:hit.at,round:roundNo,kind:'advantage-weak',label:'价格与状态 S 连续同步走弱',reading:JSON.stringify({...advantage,originalQuantity:sized.addCoins})});continue;
  }
  if(advantage?.grade==='U')skip({at:hit.at,round:roundNo,kind:'advantage-unavailable',label:'优势辅助数据缺失，沿用原规则',reading:advantage.reason??'缺辅助数据'});
  if(advantage)hit={...hit,advantage};
  fills.push({...hit,...(independent?{positionVersion:HOLDING_LEDGER_ADDITION_VERSION,ledger:{costBefore:cost,realizedBefore:held.realized,mirrorQuantityBefore:held.mirrorQuantity,breakevenBefore:Sb}}:{}),...(o.kStopVersion?{kStopVersion:o.kStopVersion}:{}),quantity:sized.addCoins,notional,sizing:{support:K,previousSupport:independent?S:Sb,atr:atr!,atrAt,coinsBefore:Q,realAverageBefore:cost/Q,baseCoins:sized.baseCoins,mirrorCoins:sized.mirrorCoins,mirrorUsed:sized.mirrorUsed,mirrorAvailableBefore:independent?0:state.mirrorProfitAvailable,costBufferAtr:buffer/atr!,...(hit.structureEvidence?{}:{supportOffsetAtr}),...(!hit.structureEvidence&&round.entryDistanceAtr!=null?{requiredBufferAtr:round.entryDistanceAtr}:{}),coverageGap:sized.coverageGap,...(floorRule?{...(followPosition?{positionK:sellK}:{guardK:sellK}),floorAtr:floorRule.atr}:{})}});
  if(carried+fills.length===o.pauseAfterAdditionCount)return {fills,stageBoundary:{at:hit.at,price:hit.price},...(vetoed.length?{vetoed}:{}),...(reductions.length?{reductions}:{}),...(skipped.length?{skipped}:{})};
 }
 return done(findPositionExit(currentK().k,Math.max(o.since,currentK().at??o.since)));
}
