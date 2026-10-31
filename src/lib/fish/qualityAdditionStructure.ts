/** Closed 5m structure events and frozen K selection for paper holding additions. */
import {compileFeatureFormula,definitionKey,evaluateOnBars,featureWindowMs,DBL5_DEF,SBS5M_DEF,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {dbl5Parameters,dbl5TickRule,dbl5TickPrice,type Dbl5Row,type Dbl5Checkpoint} from '@/lib/dbl5m';
import {DBL5_MARKET_RULE_VERSION,dbl5TickAt} from '@/lib/dbl5mMarketRules';
import {sbsParameters,type SbsRow,type SbsCheckpoint} from '@/lib/sbs5m';
import {compileFishProgram} from './algorithm';
import {fishDelay,validateFishBars} from './shared';
import type {QualityAdditionFill} from './qualityAddition';
import type {FishReconstructionLoader} from './reconstruction';
import type {TradeSignal} from '@/lib/signalLibrary';
const STEP=300000,MINUTE=60000;
export interface StructureAdditionRule {
 algorithm:'dbl5'|'sbs5m';trigger:'raise'|'confirm'|'retest';kBasis:'support'|'invalidation';
 bufferUnit:'atr'|'percent';buffer:number;
 /** Exact native parameters are frozen when the plan is saved. */
 definition:DeepDigFeatureDef;
}
export interface StructureAdditionEvidence {
 algorithm:StructureAdditionRule['algorithm'];trigger:StructureAdditionRule['trigger'];event:string;eventId:string;
 boxId:string;episodeId:string|null;at:number;confirmedAt:number;supportPrice:number;upperPrice:number;nativeInvalidation:number|null;
 tickSize:string;algorithmVersion:string;definitionKey:string;parameters:unknown;initializationStart:number;dataChecksum:string;marketRuleVersion:string;
 kBasis:StructureAdditionRule['kBasis'];basePrice:number;bufferUnit:StructureAdditionRule['bufferUnit'];buffer:number;
 /** Set only when sizing accepts a fill; no subsequent candle can move this K. */
 bufferPrice?:number;k?:number;
}
export function defaultStructureAddition(algorithm:StructureAdditionRule['algorithm']='dbl5',definitions:readonly DeepDigFeatureDef[]=[]):StructureAdditionRule {
 const builtin=algorithm==='dbl5'?DBL5_DEF:SBS5M_DEF;
 const definition=structuredClone(definitions.find(d=>d.id===builtin.id)??builtin);
 return {algorithm,trigger:'raise',kBasis:'support',bufferUnit:'atr',buffer:.5,definition:{...definition,interval:'5m'}};
}
export function validateStructureAddition(rule?:StructureAdditionRule):asserts rule is StructureAdditionRule {
 if(!rule||!['dbl5','sbs5m'].includes(rule.algorithm)||!['raise','confirm','retest'].includes(rule.trigger)||!['support','invalidation'].includes(rule.kBasis)||!['atr','percent'].includes(rule.bufferUnit))throw Error('箱体加仓算法或触发方式无效');
 if(rule.algorithm==='dbl5'&&(rule.trigger==='retest'||rule.kBasis==='invalidation'))throw Error('DBL-5 不提供独立回踩确认或算法失效线，请选择已确认下轨');
 if(!Number.isFinite(rule.buffer)||rule.buffer<0||rule.bufferUnit==='percent'&&rule.buffer>=100)throw Error('支撑冗余须为不小于 0 的有限数字；百分比须小于 100');
 const def=rule.definition,builtin=rule.algorithm==='dbl5'?DBL5_DEF:SBS5M_DEF;
 if(!def||def.id!==builtin.id||def.chartTemplate!==builtin.chartTemplate||def.interval!=='5m'||def.formula!==builtin.formula)throw Error('箱体加仓须使用原生5分钟结构定义，请重新选择算法');
 if(rule.algorithm==='dbl5')dbl5Parameters(def.DBL5_config);else sbsParameters(def.SBS5M_config);
}
export const structureAdditionIdentity=(r:StructureAdditionRule)=>['box-addition-v1',r.algorithm,r.trigger,r.kBasis,r.bufferUnit,r.buffer,definitionKey(r.definition),DBL5_MARKET_RULE_VERSION];
export const structureAlgorithmLabel=(r:Pick<StructureAdditionRule,'algorithm'>)=>r.algorithm==='dbl5'?'DBL-5':'SBS-5M';
export const structureTriggerLabel=(r:Pick<StructureAdditionRule,'trigger'>)=>r.trigger==='raise'?'支撑抬高确认':r.trigger==='confirm'?'新箱体确认':'独立回踩成功';
export const structureAdditionLabel=(r:StructureAdditionRule)=>`${structureAlgorithmLabel(r)} · ${structureTriggerLabel(r)} · K＝${r.kBasis==='support'?'已确认下轨':'固定失效线'}−${r.buffer}${r.bufferUnit==='atr'?'ATR':'%'}`;
/** Only selected, still-active confirmed structures may emit a decision. Pending boxes never qualify. */
export function structureAdditionSignal(rule:StructureAdditionRule,row:Dbl5Row|SbsRow,initializationStart:number):StructureAdditionEvidence|undefined {
 if(!row.data_valid)throw Error('箱体加仓行情或历史报价精度无效，不能作为加仓依据');
 if(rule.algorithm==='dbl5'){
  const r=row as Dbl5Row,a=r.active;if(!r.darvas_5m_available||!a)return;
  const allowed=rule.trigger==='raise'?['UP_STEP','NESTED_HIGHER_FLOOR']:['BASELINE','UP_STEP','NESTED_HIGHER_FLOOR','SAME_FLOOR'];
  const event=r.events.find(e=>allowed.includes(e.type)&&e.box_id===a.box_id&&e.at===r.at);if(!event)return;
  return {algorithm:rule.algorithm,trigger:rule.trigger,event:event.type,eventId:event.id,boxId:a.box_id,episodeId:a.episode_id,at:r.at,confirmedAt:a.confirmed_at,supportPrice:a.D,upperPrice:a.U,nativeInvalidation:null,tickSize:a.tick_size,algorithmVersion:r.algorithm_version,definitionKey:definitionKey(rule.definition),parameters:r.effective_parameters,initializationStart,dataChecksum:r.data_checksum,marketRuleVersion:DBL5_MARKET_RULE_VERSION,kBasis:rule.kBasis,basePrice:a.D,bufferUnit:rule.bufferUnit,buffer:rule.buffer};
 }
 const r=row as SbsRow,a=r.active;if(r.support_status!=='ACTIVE'||!a||r.at==null||a.confirmed_at==null)return;
 const allowed=rule.trigger==='raise'?['STEP_CONFIRMED']:rule.trigger==='confirm'?['BASELINE_CONFIRMED','STEP_CONFIRMED']:['RETEST_SUCCEEDED'];
 const event=r.events.find(e=>allowed.includes(e.type)&&e.box_id===a.box_id&&e.at===r.at);if(!event)return;
 return {algorithm:rule.algorithm,trigger:rule.trigger,event:event.type,eventId:event.id,boxId:a.box_id,episodeId:a.episode_id,at:r.at,confirmedAt:a.confirmed_at,supportPrice:a.s,upperPrice:a.u,nativeInvalidation:a.K,tickSize:dbl5TickRule(a.tick),algorithmVersion:r.feature_version,definitionKey:definitionKey(rule.definition),parameters:sbsParameters(rule.definition.SBS5M_config),initializationStart,dataChecksum:r.data_checksum,marketRuleVersion:DBL5_MARKET_RULE_VERSION,kBasis:rule.kBasis,basePrice:rule.kBasis==='invalidation'?a.K:a.s,bufferUnit:rule.bufferUnit,buffer:rule.buffer};
}
/** Floor a derived stop to the venue tick using decimal integers, never infer tick from price digits. */
export function structureAdditionK(e:StructureAdditionEvidence,atr:number):{k:number;bufferPrice:number}|undefined {
 if(!(atr>0)||!Number.isFinite(atr)||!(e.basePrice>0)||!Number.isFinite(e.basePrice)||!Number.isFinite(e.buffer)||e.buffer<0)return;
 const decimal=(v:number|string)=>{const m=/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(v));if(!m)throw Error('箱体K价格无效');let n=BigInt(m[1]+(m[2]??'')),s=(m[2]?.length??0)-Number(m[3]??0);if(s<0){n*=10n**BigInt(-s);s=0;}return {n,d:10n**BigInt(s)};};
 const base=decimal(e.basePrice),buffer=decimal(e.buffer),scale=decimal(e.bufferUnit==='atr'?atr:e.basePrice),t=decimal(dbl5TickRule(e.tickSize));
 const marginN=buffer.n*scale.n,marginD=buffer.d*scale.d*(e.bufferUnit==='percent'?100n:1n);
 const priceN=base.n*marginD-marginN*base.d,priceD=base.d*marginD;
 if(priceN<=0n||t.n<=0n)return;
 const ticks=priceN*t.d/(priceD*t.n);
 if(ticks<=0n)return;
 const k=dbl5TickPrice(ticks,e.tickSize);return {k,bufferPrice:e.basePrice-k};
}
interface ReaderOptions {row:TradeSignal;entry:number;end:number;load:FishReconstructionLoader;signal:AbortSignal}
/** Fixed entry-relative replay origin, sequential checkpoints across pages; resume replays the same origin. */
export function createStructureAdditionReader(o:ReaderOptions){
 const readers=new Map<string,{read:(after:number,end:number,used:ReadonlySet<string>,gain?:{referencePrice:number;thresholdPct:number})=>Promise<Omit<QualityAdditionFill,'quantity'|'notional'>|undefined>}>();
 return async(rule:StructureAdditionRule,after:number,end:number,previous:readonly QualityAdditionFill[],gain?:{referencePrice:number;thresholdPct:number})=>{
  validateStructureAddition(rule);const key=JSON.stringify(structureAdditionIdentity(rule));let reader=readers.get(key);
  if(!reader){
   const def=rule.definition,compiled=compileFeatureFormula(def.formula),plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:0,constraints:[]});
   const from=Math.floor(o.entry/STEP)*STEP-Math.ceil(featureWindowMs(def)/STEP)*STEP;
   if(from<0)throw Error('箱体加仓历史不足');
   let cursor=from,dbl:Dbl5Checkpoint|undefined,sbs:SbsCheckpoint|undefined;
   const decisions:{e:StructureAdditionEvidence;close:number}[]=[],invalid:number[]=[];
   reader={read:async(after,until,used,gain)=>{
    const cut=Math.floor(until/STEP)*STEP;
    while(cursor<cut){
     if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
     const to=Math.min(cut,cursor+500*STEP),bars=await o.load(o.row,cursor,to,plan,o.signal);validateFishBars(bars,to,(to-cursor)/STEP,STEP);
     const result=evaluateOnBars(bars,compiled,{...def,DBL5_symbol:o.row.symbol,DBL5_initialization_start:from,DBL5_initialization_id:`holding-addition:${from}`,DBL5_checkpoint:dbl,SBS5M_symbol:o.row.symbol,SBS5M_initialization_id:`holding-addition:${from}`,SBS5M_checkpoint:sbs});
     dbl=result.DBL5_checkpoint;sbs=result.SBS5M_checkpoint;
     const rows=rule.algorithm==='dbl5'?result.DBL5_details!:result.SBS5M_details!;
     const closes=new Map(bars.map(b=>[b.openTime+STEP,b.close])),sources=new Map(bars.map(b=>[b.openTime+STEP,b.PRS6H_data_source??'binance-usdm']));
     for(const row of rows){if(!row.data_valid){if(row.at!=null)invalid.push(row.at);continue;}const e=structureAdditionSignal(rule,row,from);if(e&&e.at>o.entry){e.tickSize=dbl5TickRule(dbl5TickAt(o.row.symbol,e.at-STEP,e.tickSize,sources.get(e.at))!);decisions.push({e,close:closes.get(e.at)!});}}
     cursor=to;await fishDelay(0,o.signal);
     if(decisions.some(({e,close})=>e.at>after&&e.at<until&&!used.has(`${e.algorithm}:${e.boxId}`)&&(!gain||close>=gain.referencePrice*(1+gain.thresholdPct/100))))break;
    }
    for(const {e,close} of decisions){
     if(e.at<=after||e.at>=until||used.has(`${e.algorithm}:${e.boxId}`))continue;
     let priceGate:QualityAdditionFill['priceGate'];
     if(gain){if(!(gain.referencePrice>0)||!Number.isFinite(gain.referencePrice))throw Error('加仓涨幅基准价无效');if(close<gain.referencePrice*(1+gain.thresholdPct/100))continue;priceGate={basis:'real-average',...gain,observedPrice:close,gainPct:(close/gain.referencePrice-1)*100,confirmedAt:e.at};}
     if(invalid.some(t=>t<=e.at))throw Error('箱体加仓行情或历史报价精度无效，不能作为加仓依据');
     return {at:e.at,price:NaN,scanFrom:o.entry,reading:e.supportPrice,threshold:0,direction:'>',metric:'confirmed_support',label:`${structureAlgorithmLabel(rule)} · ${structureTriggerLabel(rule)}`,featureId:def.id,definitionKey:e.definitionKey,barOpenTime:e.at-STEP,structureEvidence:structuredClone(e),...(priceGate?{priceGate}:{})};
    }
    if(invalid.some(t=>t<until))throw Error('箱体加仓行情或历史报价精度无效，不能作为加仓依据');
   }};readers.set(key,reader);
  }
  return reader.read(after,end,new Set(previous.flatMap(f=>f.structureEvidence?[`${f.structureEvidence.algorithm}:${f.structureEvidence.boxId}`]:[])),gain);
 };
}
