import {evaluateOnBars,featureWindowMs} from '../deepDig/features';
import type {Dbl5Checkpoint} from '../dbl5m';
import {formatUTC8} from '../timeFormat';
import {compileFishProgram} from './algorithm';
import {additionVetoLabel,validateAdditionVetoes,type QualityAdditionEntryVeto} from './qualityAdditionVeto';
import {qualityHistoryFrom} from './qualityInitialization';
import type {FishReconstructionLoader} from './reconstruction';
import type {TradeSignal} from '../signalLibrary';
import type {HistoryVetoResult} from './qualityVetoHistory';
import {validateFishBars,FishError} from './shared';
import {screeningTimeSlice} from './screeningYield';
import {BOX_STOP_INVALID_DATA} from './qualityBoxMarketRepair';

/** Reuse frozen native DBL-5 outputs. This adapter never produces a sell trigger or changes sizing. */
export function createBoxBreakVetoReader(rule:QualityAdditionEntryVeto,o:{entry:number;row:TradeSignal;load:FishReconstructionLoader;signal:AbortSignal}) {
 validateAdditionVetoes([rule]);
 const def=rule.boxBreak!.rule.structure.definition;
 const plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:0,constraints:[]}),step=plan.step;
 const from=qualityHistoryFrom(o.load,Math.floor(o.entry/step)*step-Math.ceil(featureWindowMs(def)/step)*step,step);
 if(from<0)throw Error('箱体断裂否决初始化历史不足');
 const load=o.load.boxStopMarketLoad??o.load;
 const timeSlice=screeningTimeSlice(o.signal);
 let cursor=from,checkpoint:Dbl5Checkpoint|undefined,firstBreakAt:number|undefined;
 return async(at:number):Promise<HistoryVetoResult>=>{
  if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
  const cut=Math.floor(at/step)*step;
  try{
   while(firstBreakAt==null&&cursor<cut){
    if(o.signal.aborted)throw new DOMException('已暂停','AbortError');
    const to=Math.min(cut,cursor+500*step),bars=await load(o.row,cursor,to,plan,o.signal);
    validateFishBars(bars,to,(to-cursor)/step,step);
    const out=evaluateOnBars(bars,plan.compiled,{...def,DBL5_symbol:o.row.symbol,DBL5_initialization_start:from,DBL5_initialization_id:'box-stop:'+from,DBL5_checkpoint:checkpoint});
    const rows=out.DBL5_details;
    if(!rows||rows.length!==bars.length)throw Error('箱体断裂否决缺少原生结构读数');
    for(let i=0;i<rows.length;i++){
     if(!rows[i].data_valid)throw Error(BOX_STOP_INVALID_DATA);
     const closedAt=bars[i].openTime+step;
     if(firstBreakAt==null&&closedAt>o.entry&&rows[i].darvas_5m_guard_broken)firstBreakAt=closedAt;
    }
    checkpoint=out.DBL5_checkpoint;cursor=to;
    const pause=timeSlice();if(pause)await pause;
   }
  }catch(error){
   if(o.signal.aborted||!(error instanceof FishError)||!['history','gap'].includes(error.kind))throw error;
   return {pending:'箱体断裂否决缺少连续已收盘行情，暂不放行',pendingKind:'box-break'};
  }
  // Parallel native/impulse lanes can ask an earlier candidate after a later one.
  // Knowing a later break never disqualifies an earlier candidate.
  return firstBreakAt==null||firstBreakAt>at?{}:{hit:{kind:'box-break',label:additionVetoLabel(rule),reading:rule.boxBreak!.version+' · 首次断裂确认于 '+formatUTC8(firstBreakAt)+'；本轮起点以来已发生断裂，防守线重建不解除'}};
 };
}
