import {dbl5Parameters} from '../dbl5m';
import {IMPULSE_1115_CLASSIFICATION_DEF,definitionKey,evaluateOnBars,featureWindowMs,type DeepDigFeatureDef} from '../deepDig/features';
import {IMPULSE_1115_CLASSIFICATION_VERSION,impulse1115ClassificationParams,type Impulse1115ClassificationCheckpoint} from '../impulse1115Classification';
import {DBL5_GUARD_PLUS_PARAMS,type Dbl5GuardPlusCheckpoint,type GuardPlusImpulse} from '../dbl5GuardPlus';
import {DBL5_MARKET_RULE_VERSION,dbl5TickAt} from '../dbl5mMarketRules';
import {compileFishProgram,shortFishHash} from './algorithm';
import {validateHoldingImpulse1115Rule,HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION} from './holdingImpulse1115Classification';
import {structureAdditionK,type StructureAdditionEvidence,type StructureSkipReporter} from './qualityAdditionStructure';
import {qualityHistoryFrom} from './qualityInitialization';
import {validateFishBars,fishDelay} from './shared';
import type {QualityAdditionFill} from './qualityAddition';
import type {FishReconstructionLoader} from './reconstruction';
import type {TradeSignal} from '../signalLibrary';

export const CLASSIFIED_IMPULSE_POSITION_VERSION='holding-impulse-1115-classified-position-v1';
export const CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION='holding-impulse-1115-classified-line-k-v2';
export const CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION='holding-impulse-1115-classified-origin-k-v3';
export const isClassifiedImpulsePositionVersion=(version?:string)=>version===CLASSIFIED_IMPULSE_POSITION_VERSION||version===CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION||version===CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION;
export interface ClassifiedImpulsePosition {
 version:typeof CLASSIFIED_IMPULSE_POSITION_VERSION|typeof CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION|typeof CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION;mainClass:1|2;definition:DeepDigFeatureDef;
 bufferAtr:number;minDistancePct?:number;skipNative?:true;
}
export const classifiedImpulsePositionLabel=(mainClass:1|2)=>`DBL-5-急拉线-1115 · ${mainClass===1?'一类':'二类'}`;
export function defaultClassifiedImpulsePosition(mainClass:1|2,definitions:readonly DeepDigFeatureDef[]=[],version:ClassifiedImpulsePosition['version']=CLASSIFIED_IMPULSE_ORIGIN_K_POSITION_VERSION):ClassifiedImpulsePosition{
 const definition=structuredClone(definitions.find(d=>d.id===IMPULSE_1115_CLASSIFICATION_VERSION)??IMPULSE_1115_CLASSIFICATION_DEF);
 definition.DBL5C_parameters={...impulse1115ClassificationParams(definition.DBL5C_parameters)};
 return {version,mainClass,definition,bufferAtr:DBL5_GUARD_PLUS_PARAMS.bufferAtr};
}
export function validateClassifiedImpulsePositions(positions:readonly ClassifiedImpulsePosition[]|undefined){
 const seen=new Set<number>();for(const p of positions??[]){
  if(!isClassifiedImpulsePositionVersion(p.version)||![1,2].includes(p.mainClass)||seen.has(p.mainClass)||!Number.isFinite(p.bufferAtr)||p.bufferAtr<0||p.bufferAtr>20||p.skipNative!=null&&p.skipNative!==true||p.minDistancePct!=null&&(!Number.isFinite(p.minDistancePct)||p.minDistancePct<=0||p.minDistancePct>=50))throw Error('急拉分类位置须使用独立版本、唯一的一／二类及有效 K 参数');
  seen.add(p.mainClass);if(p.definition.interval!=='5m')throw Error('急拉分类位置只使用已收盘5分钟证据');
  validateHoldingImpulse1115Rule({version:HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION,definition:p.definition});
 }
}
export const classifiedImpulsePositionsIdentity=(positions:readonly ClassifiedImpulsePosition[]=[])=>positions.map(p=>[p.version,p.mainClass,p.bufferAtr,p.minDistancePct??null,p.skipNative??null,definitionKey(p.definition)]);

/** New evidence only: latest native line, completed six-case transitions, no warmup/repeated-state opportunities. */
export function createClassifiedImpulsePositionReader(o:{row:TradeSignal;entry:number;load:FishReconstructionLoader;signal:AbortSignal;liveAt?:number}){
 const STEP=300000,readers=new Map<string,ReturnType<typeof make>>();
 function make(position:ClassifiedImpulsePosition){
  validateClassifiedImpulsePositions([position]);const def=position.definition,plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:0,constraints:[]});
  const from=qualityHistoryFrom(o.load,def.DBL5_initialization_start??Math.floor(o.entry/STEP)*STEP-Math.ceil(featureWindowMs(def)/STEP)*STEP,STEP);
  if(from<0)throw Error('急拉分类位置缺少冻结起点前的预热行情');
  let cursor=from,source:Dbl5GuardPlusCheckpoint|undefined,classification:Impulse1115ClassificationCheckpoint|undefined;
  const origins=new Map<string,GuardPlusImpulse>(),decisions:{e:StructureAdditionEvidence;close:number}[]=[];
  const advance=async(cut:number,stop:()=>boolean)=>{
   while(cursor<cut){
    if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
    const to=Math.min(cut,cursor+500*STEP),bars=await (o.load.boxStopMarketLoad??o.load)(o.row,cursor,to,plan,o.signal);validateFishBars(bars,to,(to-cursor)/STEP,STEP);
    const result=evaluateOnBars(bars,plan.compiled,{...def,DBL5_config:def.DBL5_config?dbl5Parameters(def.DBL5_config):undefined,DBL5_symbol:o.row.symbol,DBL5_initialization_start:from,DBL5_initialization_id:'classified-impulse-addition:'+from,DBL5P_checkpoint:source,DBL5C_checkpoint:classification});
    if(result.DBL5C_details?.length!==bars.length||!result.DBL5P_checkpoint||!result.DBL5C_checkpoint)throw Error('急拉分类位置缺少完整原生已收盘证据');
    source=result.DBL5P_checkpoint;classification=result.DBL5C_checkpoint;
    const plus=new Map(result.DBL5P_details?.map(r=>[r.at,r])),native=new Map(result.DBL5_details?.map(r=>[r.at,r]));
    result.DBL5C_details.forEach((point,i)=>{
     const early=plus.get(point.at)?.early_impulse_event;if(early)origins.set(early.impulse_id,early);
     const line=point.current;if(!line?.available||line.mainClass!==position.mainClass||line.case==null||line.at!==point.at||point.at<=o.entry)return;
     const origin=origins.get(line.lineId),bar=bars[i],base=native.get(point.at);if(!origin||!base?.data_valid)throw Error('急拉分类位置缺少该线冻结起点或原生精度证据');
     const tick=bar.DBL5_order_tick_size??dbl5TickAt(o.row.symbol,bar.openTime,base.tick_size,bar.PRS6H_data_source);if(tick==null)throw Error('急拉分类位置缺少历史报价精度');
     // v3 uses the origin low, matching the unclassified 1115 K. Frozen v1/v2 bases remain executable.
     const basePrice=position.version===CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION?line.price:origin.impulse_origin_low;
     const selected=structureAdditionK({basePrice,buffer:position.bufferAtr,bufferUnit:'atr',tickSize:String(tick)},line.frozenAtr);if(!selected)throw Error('急拉分类位置 K 无效');
     const id=[line.lineId,line.status,line.at,shortFishHash(JSON.stringify(classifiedImpulsePositionsIdentity([position])))].join(':');
     decisions.push({close:bar.close,e:{algorithm:'dbl5',trigger:'confirm',event:'IMPULSE_CLASS_'+position.mainClass,eventId:id,boxId:id,episodeId:base.episode_id,at:point.at,confirmedAt:point.at,supportPrice:selected.k,upperPrice:bar.high,nativeInvalidation:null,tickSize:String(tick),algorithmVersion:position.version,definitionKey:definitionKey(def),parameters:{classification:IMPULSE_1115_CLASSIFICATION_VERSION,mainClass:position.mainClass,parameters:def.DBL5C_parameters,bufferAtr:position.bufferAtr},initializationStart:from,dataChecksum:base.data_checksum,marketRuleVersion:DBL5_MARKET_RULE_VERSION,kBasis:'support',basePrice,bufferUnit:'atr',buffer:position.bufferAtr,nativeAtr:line.frozenAtr,guardPrice:selected.k,guardRegime:'trend',guardCloses:1,impulseClassification:{version:IMPULSE_1115_CLASSIFICATION_VERSION,lineId:line.lineId,linePrice:line.price,mainClass:line.mainClass,case:line.case,status:line.status,confirmedAt:line.at}}});
    });cursor=to;await fishDelay(0,o.signal);if(stop())break;
   }
  };
  return async(after:number,end:number,previous:readonly QualityAdditionFill[],gain?:{referencePrice:number;thresholdPct:number;basis?:'real-average'|'cost-line'},onSkip?:StructureSkipReporter)=>{
   const used=new Set(previous.flatMap(f=>f.structureEvidence?[f.structureEvidence.boxId]:[]));
   if(gain&&(!(gain.referencePrice>0)||!Number.isFinite(gain.referencePrice)))throw Error('加仓涨幅基准价无效');
   const eligible=(e:StructureAdditionEvidence)=>e.at>after&&e.at<end&&!used.has(e.boxId)&&(o.liveAt==null||o.liveAt>=e.at&&o.liveAt<e.at+STEP);
   const found=()=>decisions.some(({e,close})=>eligible(e)&&(!gain||close>=gain.referencePrice*(1+gain.thresholdPct/100)));
   if(!found())await advance(Math.floor(end/STEP)*STEP,found);
   for(const {e,close} of decisions){
    if(!eligible(e))continue;
    if(gain&&close<gain.referencePrice*(1+gain.thresholdPct/100)){onSkip?.({at:e.at,support:e.supportPrice,reason:'gain',close,referencePrice:gain.referencePrice,thresholdPct:gain.thresholdPct});continue;}
    return {at:e.at,price:NaN,scanFrom:o.entry,reading:e.supportPrice,threshold:0,direction:'>' as const,metric:'confirmed_impulse_class',label:classifiedImpulsePositionLabel(position.mainClass),featureId:position.version,definitionKey:e.definitionKey,barOpenTime:e.at-STEP,structureEvidence:structuredClone(e),...(gain?{priceGate:{...gain,basis:gain.basis??'real-average' as const,observedPrice:close,gainPct:(close/gain.referencePrice-1)*100,confirmedAt:e.at}}:{})};
   }
  };
 }
 return (position:ClassifiedImpulsePosition,after:number,end:number,previous:readonly QualityAdditionFill[],gain?:{referencePrice:number;thresholdPct:number;basis?:'real-average'|'cost-line'},onSkip?:StructureSkipReporter)=>{
  const key=shortFishHash(JSON.stringify(classifiedImpulsePositionsIdentity([position])));let read=readers.get(key);if(!read){read=make(position);readers.set(key,read);}return read(after,end,previous,gain,onSkip);
 };
}
