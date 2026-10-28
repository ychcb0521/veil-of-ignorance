import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { FishProgram } from './algorithm';
import type { FishMemberResult } from './intersection';
import type { FishTurnoverFloor } from './shared';
export const FISH_DEFAULT_LOOKBACK_HOURS=1;
export const fishLookbackKey=()=>`${getUserPrefix()}fish-lookback-hours.v1`;
const defaultVersionKey=()=>`${getUserPrefix()}fish-lookback-default.v2`;
export function validateFishLookback(value:unknown):number {
 const n=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
 if(!Number.isFinite(n)||n<=0||n>8784)throw new Error('扫描覆盖时间须大于 0 且不超过 8784 小时');
 return n;
}
export function readFishLookback():number {
 try{
  // Upgrade the former 12h default once; other custom hours and subsequent explicit 12h edits survive.
  if(readPersistedStateRaw(defaultVersionKey())!=='1'){
   const previous=readPersistedStateRaw(fishLookbackKey());
   if(previous!==null&&Number(previous)===12)writePersistedStateRaw(fishLookbackKey(),'1');
   writePersistedStateRaw(defaultVersionKey(),'1');
  }
  return validateFishLookback(readPersistedStateRaw(fishLookbackKey()));
 }catch{return FISH_DEFAULT_LOOKBACK_HOURS;}
}
export function saveFishLookback(value:unknown):number {const hours=validateFishLookback(value);writePersistedStateRaw(fishLookbackKey(),String(hours));writePersistedStateRaw(defaultVersionKey(),'1');return hours;}
/** The coverage window never replaces formula warm-up or liquidity-gate history. */
export function fishProgramForLookback(plan:FishProgram,hours?:number,floors?:readonly FishTurnoverFloor[]):FishProgram {
 if(hours===undefined)return plan;
 const windowBars=Math.ceil(validateFishLookback(hours)*3600000/plan.step);
 const turnoverBars=Math.ceil(Math.max(0,...(floors??[]).map(f=>f.hours))*3600000/plan.step);
 const N=Math.max(plan.N,plan.warm+windowBars+1,windowBars+turnoverBars+1);
 return {...plan,N,unavailable:plan.unavailable??(N>5000?`扫描过去 ${hours} 小时需要 ${N} 根历史（含指标预热），超过 5000 根上限，请缩短覆盖时间`:undefined)};
}
/** Each algorithm must independently produce a recent known start, preserving intersection/union consistency. */
export function limitFishLookback(result:FishMemberResult,anchorMs:number,hours?:number):FishMemberResult {
 if(hours===undefined||result.outcome!=='hit'||!result.signal)return result;
 const start=result.signal.timeMs;
 if(start<anchorMs-validateFishLookback(hours)*3600000||start>anchorMs){
  const {signal,...rest}=result;
  return {...rest,outcome:'outside',snapshot:{...signal.fish!,outcome:'outside',lookbackHours:hours,lookbackAnchorMs:anchorMs}};
 }
 return {...result,signal:{...result.signal,fish:{...result.signal.fish!,lookbackHours:hours,lookbackAnchorMs:anchorMs}}};
}
