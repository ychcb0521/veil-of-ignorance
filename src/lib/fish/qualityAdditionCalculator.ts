import {advanceChartAtr,type ChartAtrState} from '@/lib/atr';
import {calculateAddPosition,initialAddPositionState} from '@/lib/addPositionCoverage';
import {compileFishProgram} from './algorithm';
import {validateFishBars,fishDelay} from './shared';
import {findQualityAdditionTrigger,requiredConditionsReader,type AdditionCandidate} from './qualityAdditionScan';
import {isPartialMirror,qualityAdditionAtrSettings,supportDropReduction,type QualityAdditionFill,type QualityAdditionRoundRule,type QualityReductionFill,type QualitySupportReductionRule} from './qualityAddition';
import {createStructureAdditionReader,structureAdditionK,withMinKDistance,type StructureAdditionRule} from './qualityAdditionStructure';
import {additionVetoesNeedMinutes,evaluateAdditionVetoes,type QualityAdditionEntryVeto,type VetoBar} from './qualityAdditionVeto';
import {ADDITION_PROFIT_KIND,PAYOFF_STOP_KIND,activeHoldingVetoes,payoffStopL0Pct,type QualityHoldingVeto,type QualityExitCause} from './qualityVeto';
import type {QualityMirrorFill} from './qualityMirror';
import type {FishReconstructionLoader} from './reconstruction';
import type {TradeSignal} from '@/lib/signalLibrary';
import type {ResearchBar} from '@/lib/deepRsa/window';
const MINUTE=60000,STEP=5*MINUTE,PERIOD=14,WARM=PERIOD*20+1;
interface SupportStop {at:number;price:number;support:number;atOpen:boolean;cause?:QualityExitCause;confirmCloses?:number}
type AtrSettings=Pick<QualityAdditionRoundRule,'entryBufferAtr'|'supportOffsetAtr'|'entryDistanceAtr'|'gainBasis'>&{entryVetoes?:QualityAdditionEntryVeto[]};
type RoundScan={candidates:AdditionCandidate[];required?:AdditionCandidate[];unavailable?:string;minGainPct?:number;structure?:StructureAdditionRule}&AtrSettings;
interface Options extends AtrSettings {
 structure?:StructureAdditionRule;
 supportReduction?:QualitySupportReductionRule;previousReductions?:readonly QualityReductionFill[];
 geometricLock?:import('./qualityAddition').QualityGeometricLockRule;
 breakevenFloor?:import('./qualityAddition').QualityBreakevenFloorRule;
 previousVetoes?:readonly AdditionVetoRecord[];
 vetoes?:readonly QualityHoldingVeto[];pauseAfterAdditionCount?:number;
 candidates:AdditionCandidate[];required?:AdditionCandidate[];
 /** 这一轮的方向条件注定无法满足（如信号没有所选的探测算法）：不再加仓。 */
 unavailable?:string;
 /** 每轮的扫描规则；alternative＝这一轮的进攻备选（【用户要求】2026-11-05 每轮分流：两条同时等候，先满足者成交，同一分钟先保守）。 */
 roundRules?:(RoundScan&{alternative?:RoundScan})[];
 /** 【用户要求】2026-11-06 结构开局：进攻备选从第几次加仓起才参与竞速（缺省 1＝每一次）。 */
 attackFromRound?:number;maxRounds?:number;minGainPct?:number;row:TradeSignal;entry:number;entryPrice:number;notional:number;end:number;since:number;
 prices:readonly ResearchBar[];previous:readonly QualityAdditionFill[];mirror?:QualityMirrorFill;repeat:boolean;
 ordinaryExit?:{at:number;price:number;atOpen:boolean;mirror:boolean};load:FishReconstructionLoader;signal:AbortSignal;
}
/** Causal five-minute ATR values; a resumed run uses the same seed anchor as the original run. */
function atrReader(o:Options){
 let cursor=Math.floor(o.entry/STEP)*STEP-WARM*STEP,state:ChartAtrState|undefined;
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
export async function findCalculatorAdditions(o:Options):Promise<{fills:QualityAdditionFill[];stop?:SupportStop;stageBoundary?:{at:number;price:number};vetoed?:AdditionVetoRecord[];reductions?:QualityReductionFill[];skipped?:AdditionSkipRecord[]}>{
 // 镜像止盈须已成交且留有余仓（2026-11-02 起不限 50%，平衡公式对任意比例成立）。镜像成交那一分钟本身不能排出先后，不加仓。
 const halfMirror=o.mirror;if(!isPartialMirror(halfMirror))return {fills:[]};
 const fills=[...o.previous],priceAt=new Map(o.prices.map(b=>[b.openTime,b.open]));
 let after=Math.max(o.entry,o.since-MINUTE,halfMirror.at,fills.at(-1)?.at??o.entry);const readAtr=atrReader(o),readStructure=createStructureAdditionReader(o),prerequisiteReaders=new Map<readonly AdditionCandidate[],(at:number)=>Promise<import('./qualityAddition').QualityAdditionObservation[]|undefined>>();
 const skipped:AdditionSkipRecord[]=[],skip=(r:AdditionSkipRecord)=>{skipped.push(r);};
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
  let below=0;const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));
  for(let i=first;i<bars.length;i++){
   const b=bars[i],bucketEnd=b.openTime+MINUTE;if(bucketEnd%STEP!==0||bucketEnd-STEP<from)continue;
   below=b.close<support?below+1:0;if(below<closes)continue;
   const next=bars[i+1];if(!next)return;
   const exit=o.ordinaryExit;if(exit&&next.openTime===exit.at&&exit.atOpen)return;
   return {at:next.openTime,price:next.open,support,atOpen:true,confirmCloses:closes};
  }
 };
 const findStop=(support:number|undefined,from:number):SupportStop|undefined=>{
  if(support==null)return;
  const closes=fills.at(-1)?.structureEvidence?.guardCloses;
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
  const search=(node:number,left:number,right:number):number=>{if(right<=first||lowTree[node]>support)return -1;if(right-left===1)return left;const middle=(left+right)>>>1,found=search(node*2,left,middle);return found<0?search(node*2+1,middle,right):found;};
  const index=search(1,0,size),bar=bars[index];if(!bar)return;
  const exit=o.ordinaryExit;if(exit&&bar.openTime===exit.at&&(exit.atOpen||!exit.mirror&&exit.price>=support))return;
  const atOpen=bar.open<=support;return {at:bar.openTime,price:atOpen?bar.open:support,support,atOpen};
 };
 const profitRules=activeHoldingVetoes(o.vetoes).filter(v=>v.kind===ADDITION_PROFIT_KIND).sort((a,b)=>a.id.localeCompare(b.id));
 // 【用户要求】2026-11-03 盈亏比止盈：整笔盈亏 ÷ L₀ ≥ N 时卖出全部持仓；L₀＝初始仓位 × 静态回撤%
 const payoffRules=activeHoldingVetoes(o.vetoes).filter(v=>v.kind===PAYOFF_STOP_KIND),payoffL0Pct=payoffStopL0Pct(o.vetoes),payoffL0=payoffL0Pct!=null?o.notional*payoffL0Pct/100:undefined;
 /** 盈亏比止盈：当前持仓不变的这段里，价格涨到 (N×L₀＋持仓成本−已落袋)÷持仓币数 即全部卖出；跳空高开按开盘价。 */
 const findPayoff=(from:number):SupportStop|undefined=>{
  if(!payoffRules.length||!(payoffL0!>0))return;
  const h=holdings(Number.MAX_SAFE_INTEGER);if(!(h.held>0))return;
  const first=Math.max(0,Math.ceil((from-(bars[0]?.openTime??from))/MINUTE));let best:SupportStop|undefined;
  for(const v of payoffRules){
   const target=(v.threshold*payoffL0!+h.cost-h.realized)/h.held;if(!(target>0)||!Number.isFinite(target))continue;
   const search=(node:number,left:number,right:number):number=>{if(right<=first||highTree[node]<target*(1-1e-12))return -1;if(right-left===1)return left;const middle=(left+right)>>>1,found=search(node*2,left,middle);return found<0?search(node*2+1,middle,right):found;};
   const bar=bars[search(1,0,size)];if(!bar)continue;
   const ordinary=o.ordinaryExit;if(ordinary&&bar.openTime===ordinary.at&&(ordinary.atOpen||!ordinary.mirror||ordinary.price<=target))continue;
   const atOpen=bar.open>=target*(1-1e-12),price=atOpen?bar.open:target;
   const hit:SupportStop={at:bar.openTime,price,support:currentK().k??o.entryPrice,atOpen,cause:{id:v.id,label:v.label,kind:v.kind,direction:v.direction,threshold:v.threshold,payoffBasis:{l0:payoffL0!,l0Pct:payoffL0Pct!,targetPrice:target,pnl:h.held*price-h.cost+h.realized}}};
   if(!best||hit.at<best.at||hit.at===best.at&&hit.price<best.price)best=hit;
  }
  return best;
 };
 const findPositionExit=(support:number|undefined,from:number):SupportStop|undefined=>{
  // 【用户要求】2026-11-03 几何仓位 > 门槛时，止损从 Kₘ 上移到 Kₘ＋x%×首次开仓价，至少保住 x% 的开仓价有效涨幅
  const lockRule=o.geometricLock?.enabled?o.geometricLock:undefined;let lockStop:SupportStop|undefined,locked=false;
  if(lockRule&&support!=null&&fills.length){
   const h=holdings(Number.MAX_SAFE_INTEGER),M=h.held/(o.notional/o.entryPrice),line=support+lockRule.pct/100*o.entryPrice;
   if(M>lockRule.multiple&&line>support){locked=true;const hit=findTouchStop(line,from);if(hit)lockStop={...hit,cause:{id:'geometric-lock',kind:'addition-support',label:`几何仓位 > ${lockRule.multiple} 保住有效涨幅`,direction:'<=',threshold:line,geometricLock:{multiple:M,threshold:lockRule.multiple,pct:lockRule.pct,line,k:support}}};}
  }
  const stop0=locked?lockStop:findStop(support,from),payoffHit=findPayoff(from),stop=payoffHit&&(!stop0||payoffHit.at<stop0.at||payoffHit.at===stop0.at&&payoffHit.atOpen&&!stop0.atOpen)?payoffHit:stop0;
  if(!fills.length||support==null||!profitRules.length)return stop;
  const initialCoins=o.notional/o.entryPrice,heldCoins=initialCoins*(1-halfMirror.fraction)+fills.reduce((n,a)=>n+a.quantity,0)-reductions.reduce((n,r)=>n+r.quantity,0),multiple=heldCoins/initialCoins;
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

 const done=(stop?:SupportStop)=>({fills,stop,...(vetoed.length?{vetoed}:{}),...(reductions.length?{reductions}:{}),...(skipped.length?{skipped}:{})});
 /** 当前止损线 K：最近一次加仓的 K，或其后支撑下移减仓移到的 K′。 */
 const currentK=():{k?:number;at?:number;guard?:number}=>{const f=fills.at(-1),r=reductions.at(-1);if(r&&(!f||r.at>=f.at))return {k:r.newK,at:r.at,guard:r.newGuardK};return f?{k:f.sizing?.support,at:f.at,guard:f.sizing?.guardK}:{};};
 /** 某时刻的持仓（含镜像、加仓、此前减仓）：币数、按均价的持仓成本、已实现利润。 */
 const holdings=(at:number)=>{
  const coins0=o.notional/o.entryPrice,m=o.mirror&&(o.mirror.at<at||o.mirror.at===at&&o.mirror.atOpen)?o.mirror:undefined;
  let held=coins0,cost=o.notional,mirrorProfit=0,reductionProfit=0;
  if(m){held-=coins0*m.fraction;cost-=o.notional*m.fraction;mirrorProfit=coins0*m.fraction*(m.price-o.entryPrice);}
  for(const f of fills)if(f.at<=at){held+=f.quantity;cost+=f.notional;}
  for(const r of reductions)if(r.at<=at){held-=r.quantity;cost-=r.costRemoved;reductionProfit+=r.realizedPnl;}
  return {held,cost,mirrorProfit,reductionProfit,realized:mirrorProfit+reductionProfit};
 };
 const dropRule=o.supportReduction?.enabled?o.supportReduction:undefined;
 interface SupportDrop {at:number;support:number;atr:number;evidence:import('./qualityAdditionStructure').StructureAdditionEvidence;basis:number}
 /** 最近一次加仓所依据的箱体支撑（或减仓后的新支撑）在 (from, until) 内首次下移 ≥ minDropAtr×ATR 的 5 分钟收盘。 */
 const findSupportDrop=async(from:number,until:number):Promise<SupportDrop|undefined>=>{
  const last=fills.at(-1),evidence=last?.structureEvidence;if(!dropRule||!last||!evidence)return;
  const rule=o.roundRules?.[fills.length-1]?.structure??o.structure;if(!rule)return;
  const lastReduction=reductions.filter(r=>r.at>last.at).at(-1),basis=lastReduction?lastReduction.newSupport:evidence.basePrice;
  for(const p of await readStructure.supports(rule,until)){
   if(p.at<=from||p.at>=until)continue;
   const value=rule.kSource==='guard'?p.guard:p.support;if(value==null||!(value>0))continue;
   const atr=await readAtr(p.at);if(!(atr!>0)||!Number.isFinite(atr))continue;
   if(value<basis-dropRule.minDropAtr*atr!)return {at:p.at,support:value,atr:atr!,evidence,basis};
  }
 };
 /** 减仓计算器：X＝(S−K′)÷(T−K′)。S 为整笔保本价，K′＝新支撑−n×ATR，T 为下移确认后下一分钟开盘价。
  * 【用户要求】2026-11-02 K 自最近一次加仓起连续下移达到设定次数（含这一次）时，不再减仓，而是在 T 全仓卖出（返回卖出点）。 */
 const applyDrop=async(d:SupportDrop):Promise<SupportStop|undefined>=>{
  const T=priceAt.get(d.at),{k:Kold,guard:Gold}=currentK();if(!(T!>0)||!Number.isFinite(T)||Kold==null||!(T!>Kold))return;
  const guardSel=structureAdditionK({...d.evidence,basePrice:d.support},d.atr),floorAtr=Gold!=null?fills.at(-1)?.sizing?.floorAtr:undefined;
  const selected=guardSel&&floorAtr!=null?structureAdditionK({...d.evidence,basePrice:guardSel.k,buffer:floorAtr,bufferUnit:'atr'},d.atr):guardSel;if(!selected||!(selected.k<Kold))return;
  const limit=dropRule!.exitAfterDrops,lastFill=fills.at(-1)?.at??-Infinity,count=reductions.filter(r=>r.at>lastFill).length+1;
  if(limit!=null&&count>=limit)return {at:d.at,price:T!,support:selected.k,atOpen:true,cause:{id:'addition-support-drops',kind:'addition-support',label:`K 连续下移 ${count} 次`,direction:'<=',threshold:selected.k,supportDrops:{count,previousK:Kold,newK:selected.k,support:d.support}}};
  const Kn=selected.k,held=holdings(d.at),cut=supportDropReduction(held,T!,Kn,dropRule!.maxPct);if(!cut)return;
  const {fraction,breakeven}=cut,quantity=fraction*held.held,costRemoved=fraction*held.cost;
  reductions.push({at:d.at,price:T!,fraction,quantity,costRemoved,realizedPnl:quantity*T!-costRemoved,breakeven,previousK:Kold,newK:Kn,previousSupport:d.basis,newSupport:d.support,atr:d.atr,...(floorAtr!=null&&guardSel?{newGuardK:guardSel.k}:{})});
 };
 while(after<o.end){
  if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
  const {k:support,at:supportAt}=currentK(),stop=findPositionExit(support,Math.max(o.since,supportAt??o.since));
  const scanEnd=stop?Math.min(o.end,stop.at+(stop.atOpen?0:MINUTE)):o.end;
  if(scanEnd<=after)return done(stop);
  // 【用户要求】2026-11-02 支撑线下移减仓：先找下移事件；比它早的加仓照常处理，否则在下移那一刻按减仓计算器减仓
  const drop=await findSupportDrop(Math.max(after,supportAt??after),scanEnd);
  const roundEntry=o.roundRules?.[fills.length],alternative=fills.length+1>=(o.attackFromRound??1)?roundEntry?.alternative:undefined,primaryRule=roundEntry??o;
  const addsDone=fills.length>=(o.maxRounds??(o.repeat?Infinity:1))||!!primaryRule.unavailable&&(!alternative||!!alternative.unavailable),addEnd=drop?Math.min(scanEnd,drop.at):scanEnd;
  if(addsDone||addEnd<=after){if(drop){const exit=await applyDrop(drop);if(exit)return done(exit);after=drop.at;continue;}return done(stop);}
  let round:RoundScan|Options=primaryRule;
  const soldBefore=o.notional/o.entryPrice*halfMirror.fraction;
  const coinsBefore=o.notional/o.entryPrice+fills.reduce((n,f)=>n+f.quantity,0)-soldBefore;
  const realAverageBefore=(o.notional+fills.reduce((n,f)=>n+f.notional,0)-o.notional*halfMirror.fraction)/coinsBefore;
  // 【用户要求】2026-11-01 涨幅门槛相对最新成本线 S（首轮为首次买入价，之后为上一次的 K），不是持仓均价、也不是首仓
  // 2026-11-04 可选「相对持仓均价」（10-31 版口径）：gainBasis＝'average'
  const basis=round.gainBasis==='average'?'real-average' as const:'cost-line' as const,referencePrice=basis==='real-average'?realAverageBefore:support??o.entryPrice;
  const roundNo=fills.length+1,p8=(x:number)=>+x.toPrecision(8);
  const onSkip=(x:import('./qualityAdditionStructure').StructureSkip)=>skip({at:x.at,round:roundNo,support:x.support,...(x.reason==='gain'?{kind:'gain',label:'涨幅门槛未达',reading:`收盘 ${p8(x.close!)} 比${basis==='real-average'?'持仓均价':'成本线 S'} ${p8(x.referencePrice!)} 只涨 ${((x.close!/x.referencePrice!-1)*100).toFixed(2)}%，要求 ≥ ${x.thresholdPct}%`}:x.reason==='no-guard'?{kind:'no-guard',label:'防守线断开',reading:'这一刻防守线刚被跌破、尚未重建，没有 K 基准'}:x.reason==='guard-range'?{kind:'guard-range',label:'防守线是虚线（震荡期）',reading:'只用实线时，震荡期不加仓'}:{kind:'no-old-c',label:'没有旧 C',reading:'上一根 5 分钟线上没有不同的有效箱体（首个箱体或中间支撑失效），K 没有旧 C 可用'})});
  const skipMark=skipped.length;
  let hit=round.unavailable?undefined:round.structure?await readStructure(round.structure,after,addEnd,fills,round.minGainPct!=null?{referencePrice,thresholdPct:round.minGainPct,basis}:undefined,onSkip):await findQualityAdditionTrigger({...o,candidates:round.candidates,required:round.required,after,end:addEnd,priceAt,...(round.minGainPct!=null?{priceGate:{referencePrice,thresholdPct:round.minGainPct,basis}}:{})});
  if(hit?.structureEvidence){const price=priceAt.get(hit.at);if(!(price!>0)||!Number.isFinite(price))throw Error('缺少箱体加仓下一分钟开盘价');hit.price=price!;}
  // 【用户要求】2026-11-05 每轮分流：这一轮的进攻备选同时等候，只在保守成交之前找；更早成交就走进攻，同一分钟先保守。
  // 进攻赢了时，保守那边在它之后记下的「未加仓理由」作废（下一轮会从成交之后重新扫到）。
  if(alternative&&!alternative.unavailable){
   const altBasis=alternative.gainBasis==='average'?'real-average' as const:'cost-line' as const,altReference=altBasis==='real-average'?realAverageBefore:support??o.entryPrice,altEnd=hit?hit.at:addEnd;
   const alt=altEnd<=after?undefined:alternative.structure?await readStructure(alternative.structure,after,altEnd,fills,alternative.minGainPct!=null?{referencePrice:altReference,thresholdPct:alternative.minGainPct,basis:altBasis}:undefined,onSkip):await findQualityAdditionTrigger({...o,candidates:alternative.candidates,required:alternative.required,after,end:altEnd,priceAt,...(alternative.minGainPct!=null?{priceGate:{referencePrice:altReference,thresholdPct:alternative.minGainPct,basis:altBasis}}:{})});
   if(alt?.structureEvidence){const price=priceAt.get(alt.at);if(!(price!>0)||!Number.isFinite(price))throw Error('缺少箱体加仓下一分钟开盘价');alt.price=price!;}
   if(alt&&(!hit||alt.at<hit.at)){for(let i=skipped.length-1;i>=skipMark;i--)if(skipped[i].at>alt.at)skipped.splice(i,1);hit=alt;round=alternative;hit.lane='attack';}
   else if(hit)hit.lane='structure';
  }
  if(!hit){if(drop){const exit=await applyDrop(drop);if(exit)return done(exit);after=drop.at;continue;}return done(stop);}
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
   else{const last=since.at(-1)?.bar.close;vetoed.push({at:hit.at,round:fills.length+1,kind:'pullback',label:'冲高回落：未收复最高点前不再加仓',reading:`锁住时持仓最高 ${+pullbackLock.peak.toPrecision(8)}，尚未收复${last!=null?`（最新收盘 ${+last.toPrecision(8)}）`:''}`,lockPeak:pullbackLock.peak,lockAt:pullbackLock.at});after=hit.at;continue;}
  }
  if(round.entryVetoes?.some(v=>v.enabled)){
   await readAtr(hit.at);const cut=Math.floor(hit.at/STEP)*STEP,s=readAtr.series().filter(x=>x.bar.openTime+STEP<=cut);
   const minutes=additionVetoesNeedMinutes(round.entryVetoes)?await minutesUntil(hit.at):undefined;
   const veto=evaluateAdditionVetoes(round.entryVetoes,s.map(x=>x.bar),s.map(x=>x.atr),o.entry,minutes);
   if(veto){const {lockPeak,...hitText}=veto;if(lockPeak!=null)pullbackLock={peak:lockPeak,at:cut};vetoed.push({at:hit.at,round:fills.length+1,...hitText,...(lockPeak!=null?{lockPeak,lockAt:cut}:{})});after=hit.at;continue;}
  }
  const atrAt=Math.floor(hit.at/STEP)*STEP,atr=await readAtr(hit.at);
  if(!(atr!>0)||!Number.isFinite(atr))throw Error('缺少加仓时已收盘的5分钟ATR读数');
  const {supportOffsetAtr}=qualityAdditionAtrSettings(round);
  const boxK=hit.structureEvidence?structureAdditionK(hit.structureEvidence,atr!):undefined;
  // 【用户要求】2026-11-03 K 最小距离：K 离加仓价不足设定百分比时放宽到 T×(1−x%)，加仓量与止损都按放宽后的 K
  const selected=boxK&&hit.structureEvidence?withMinKDistance(hit.structureEvidence,boxK,hit.price,atr!,round.structure?.minDistancePct):boxK;
  const floorRule=o.breakevenFloor?.enabled&&hit.structureEvidence?.guardCloses&&selected?o.breakevenFloor:undefined;
  const floorK=floorRule?structureAdditionK({...hit.structureEvidence!,...selected!,basePrice:selected!.k,buffer:floorRule.atr,bufferUnit:'atr'},atr!)?.k??NaN:undefined;
  const K=floorK??(hit.structureEvidence?selected?.k??NaN:hit.price-supportOffsetAtr*atr!),S=support??o.entryPrice;after=hit.at;
  if(hit.structureEvidence&&(!selected||hit.price<=hit.structureEvidence.supportPrice||support!=null&&K<support)){const ev=hit.structureEvidence;
   skip({at:hit.at,round:roundNo,support:ev.supportPrice,...(!selected?{kind:'k-invalid',label:'K 算不出来',reading:`冗余 ${ev.buffer}${ev.bufferUnit==='atr'?' ATR':'%'} 大于 K 基准 ${p8(ev.basePrice)}`}:hit.price<=ev.supportPrice?{kind:'below-c',label:'价格已回到新 C 之下',reading:`下一分钟开盘 T ${p8(hit.price)} ≤ 新 C ${p8(ev.supportPrice)}`}:{kind:'k-lower',label:'K 低于上一次的 K',reading:`这次 K ${p8(K)} < 现在的 K ${p8(support!)}，加仓会把止损线往下挪`})});continue;}
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
  const Sb=reduced?(cost-(held.mirrorProfit+held.reductionProfit))/Q:S;
  const state=reduced?{...initialAddPositionState(Sb,Q,profit,cost/Q),mirrorProfitAllocated:profit,mirrorProfitAvailable:0}:{...initialAddPositionState(S,Q,profit,cost/Q),mirrorProfitAllocated:used,mirrorProfitAvailable:Math.max(0,profit-used)};
  const sized=calculateAddPosition({currentPrice:hit.price,support:K,state});after=hit.at;
  if(sized.error==='invalid_input')throw Error('加仓支撑线或持仓状态无效');
  if(sized.error||!(sized.addCoins>0)){skip({at:hit.at,round:roundNo,support:hit.structureEvidence?.supportPrice,kind:'sizing',label:sized.error==='mirror_profit_insufficient'?'落袋利润不够':sized.error==='price_not_above_support'?'价格不高于 K':'加仓量为 0',reading:sized.error==='mirror_profit_insufficient'?`K ${p8(K)} 低于成本线 S ${p8(S)}，旧仓碰 K 的亏损比可用落袋利润多 ${p8(sized.oldLossShortfall)} USDT`:sized.error==='price_not_above_support'?`T ${p8(hit.price)} ≤ K ${p8(K)}`:`按平衡公式算出的加仓量 ${p8(sized.addCoins)} 枚`});continue;}
  const notional=sized.addCoins*hit.price;if(!Number.isFinite(notional)||!Number.isFinite(sized.addCoins))throw Error('加仓币数超出可计算范围');
  fills.push({...hit,quantity:sized.addCoins,notional,sizing:{support:K,previousSupport:Sb,atr:atr!,atrAt,coinsBefore:Q,realAverageBefore:cost/Q,baseCoins:sized.baseCoins,mirrorCoins:sized.mirrorCoins,mirrorUsed:sized.mirrorUsed,mirrorAvailableBefore:state.mirrorProfitAvailable,costBufferAtr:buffer/atr!,...(hit.structureEvidence?{}:{supportOffsetAtr}),...(!hit.structureEvidence&&round.entryDistanceAtr!=null?{requiredBufferAtr:round.entryDistanceAtr}:{}),coverageGap:sized.coverageGap,...(floorRule?{guardK:selected!.k,floorAtr:floorRule.atr}:{})}});
  if(fills.length===o.pauseAfterAdditionCount)return {fills,stageBoundary:{at:hit.at,price:hit.price},...(vetoed.length?{vetoed}:{}),...(reductions.length?{reductions}:{}),...(skipped.length?{skipped}:{})};
 }
 return done(findPositionExit(currentK().k,Math.max(o.since,currentK().at??o.since)));
}
