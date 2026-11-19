import {
  IMPULSE_1115_CLASSIFICATION_DEF,checkDefinition,compileFeatureFormula,definitionKey,evaluateOnBars,featureWindowMs,
  type DeepDigFeatureDef,
} from '../deepDig/features';
import {DBL5_STEP} from '../dbl5m';
import {
  IMPULSE_1115_CLASSIFICATION_VERSION,impulse1115ClassificationParams,
  type Impulse1115ClassificationCheckpoint,type Impulse1115ClassificationRow,
} from '../impulse1115Classification';
import type {Dbl5GuardPlusCheckpoint} from '../dbl5GuardPlus';
import type {TradeSignal} from '../signalLibrary';
import {compileFishProgram,shortFishHash} from './algorithm';
import {qualityHistoryFrom} from './qualityInitialization';
import type {FishReconstructionLoader} from './reconstruction';
import {validateFishBars} from './shared';
import {screeningTimeSlice} from './screeningYield';

export const HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION='holding-impulse-1115-classification-v1';
export interface HoldingImpulse1115Rule {
  version:typeof HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION;
  definition:DeepDigFeatureDef;
}
export interface HoldingImpulse1115Reading {
  version:typeof HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION;
  identity:string;
  entry:number;
  from:number;
  through:number;
  requestedAt:number;
  status:'ready'|'waiting';
  message?:string;
  row?:Impulse1115ClassificationRow;
  sourceCheckpoint?:Dbl5GuardPlusCheckpoint;
  classificationCheckpoint?:Impulse1115ClassificationCheckpoint;
}
export function defaultHoldingImpulse1115Rule(definition=IMPULSE_1115_CLASSIFICATION_DEF):HoldingImpulse1115Rule {
  return {version:HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION,definition:structuredClone(definition)};
}
export function validateHoldingImpulse1115Rule(rule:HoldingImpulse1115Rule){
  if(rule.version!==HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION)throw Error('持仓急拉分类适配版本不匹配，请保留原方案核查');
  if(!compileFeatureFormula(rule.definition.formula).usesImpulse1115Classification)throw Error('请选择急拉线1115持仓分类的冻结定义');
  const check=checkDefinition(rule.definition);
  if(check.formula)throw Error(check.formula);
  impulse1115ClassificationParams(rule.definition.DBL5C_parameters);
}
export function holdingImpulse1115Identity(rule:HoldingImpulse1115Rule|undefined):unknown[] {
  return rule?[rule.version,IMPULSE_1115_CLASSIFICATION_VERSION,definitionKey(rule.definition)]:[];
}

/** Observation only. Errors are visible on this reading and cannot change trade status or fills. */
export async function readHoldingImpulse1115Classification(
  rule:HoldingImpulse1115Rule,
  options:{row:TradeSignal;entry:number;at:number;load:FishReconstructionLoader;signal:AbortSignal;previous?:HoldingImpulse1115Reading},
):Promise<HoldingImpulse1115Reading>{
  const {row,entry,at,load,signal}=options,step=DBL5_STEP,cut=Math.floor(at/step)*step;
  const identity=shortFishHash(JSON.stringify([holdingImpulse1115Identity(rule),row.symbol,row.market,row.exchange,entry]));
  const def=rule.definition;
  const from=qualityHistoryFrom(load,def.DBL5_initialization_start??Math.floor(entry/step)*step-Math.ceil(featureWindowMs(def)/step)*step,step);
  const old=options.previous;
  const prior=old?.version===HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION&&old.identity===identity&&old.entry===entry&&
    old.from===from&&old.through<=cut&&!!old.sourceCheckpoint&&!!old.classificationCheckpoint?old:undefined;
  let cursor=prior?.through??from,sourceCheckpoint=prior?.sourceCheckpoint,classificationCheckpoint=prior?.classificationCheckpoint,latest=prior?.row;
  const reading=(status:HoldingImpulse1115Reading['status'],message?:string):HoldingImpulse1115Reading=>({
    version:HOLDING_IMPULSE_1115_CLASSIFICATION_VERSION,identity,entry,from,through:cursor,requestedAt:at,status,
    ...(message?{message}:{}),...(latest?{row:latest}:{}),...(sourceCheckpoint?{sourceCheckpoint}:{}),
    ...(classificationCheckpoint?{classificationCheckpoint}:{}),
  });
  try{
    if(signal.aborted)throw new DOMException('已暂停','AbortError');
    validateHoldingImpulse1115Rule(rule);
    if(!Number.isFinite(entry)||!Number.isFinite(at)||entry>at||from<0||from>cut)throw Error('持仓分类缺少有效的买入时间或冻结回放起点');
    const plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:0,constraints:[]});
    const nativeLoad=load.boxStopMarketLoad??load,timeSlice=screeningTimeSlice(signal);
    while(cursor<cut){
      if(signal.aborted)throw new DOMException('已暂停','AbortError');
      const to=Math.min(cut,cursor+500*step),bars=await nativeLoad(row,cursor,to,plan,signal);
      validateFishBars(bars,to,(to-cursor)/step,step);
      const out=evaluateOnBars(bars,plan.compiled,{...def,DBL5_symbol:row.symbol,
        DBL5_initialization_start:from,DBL5_initialization_id:'holding-impulse-classification:'+entry,
        DBL5P_checkpoint:sourceCheckpoint,DBL5C_checkpoint:classificationCheckpoint});
      if(!out.DBL5C_details||out.DBL5C_details.length!==bars.length||!out.DBL5P_checkpoint||!out.DBL5C_checkpoint)
        throw Error('持仓分类缺少完整的原生已收盘5m证据');
      sourceCheckpoint=out.DBL5P_checkpoint;classificationCheckpoint=out.DBL5C_checkpoint;
      latest=out.DBL5C_details.at(-1);cursor=to;
      const pause=timeSlice();if(pause)await pause;
    }
    return latest?.current?.available?reading('ready'):reading('waiting',
      latest?.current?'行情不连续，等待从冻结起点修复；保留原分类历史':'尚无已确认急拉线，等待原生急拉形成');
  }catch(error){
    if(signal.aborted||error instanceof DOMException&&error.name==='AbortError')throw error;
    return reading('waiting',error instanceof Error?error.message:'等待连续已收盘5m行情');
  }
}
