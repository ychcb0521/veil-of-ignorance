import { FISH_ACCOUNT_SETTINGS_KEY, readFishAccountSettings } from './accountSettings';
import type { FishAutoSchedule } from './autoScan';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { FishProgram } from './algorithm';
import type { FishMemberResult } from './intersection';
import { FISH_MAX_HISTORY_BARS, type FishTurnoverFloor } from './shared';
export const FISH_DEFAULT_LOOKBACK_HOURS=1;
export const FISH_LOOKBACK_KEY='fish-lookback-hours.v1';
export const FISH_LOOKBACK_POLICY_KEY = 'fish-lookback-policy.v1';
export const fishLookbackKey=()=>getUserPrefix()+FISH_LOOKBACK_KEY;
export interface FishLookbackPreference { hours: number; followsInterval: boolean }
const defaultVersionKey=()=>`${getUserPrefix()}fish-lookback-default.v2`;
export function validateFishLookback(value:unknown):number {
 const n=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
 if(!Number.isFinite(n)||n<=0||n>8784)throw new Error('扫描覆盖时间须大于 0 且不超过 8784 小时');
 return n;
}
export function readFishLookback():number {
 return readFishAccountSettings()?.lookbackHours ?? readLegacyFishLookback(getUserPrefix());
}
function readLegacyFishLookback(prefix: string): number {
 const key = prefix + FISH_LOOKBACK_KEY;
 const versionKey = prefix + 'fish-lookback-default.v2';
 try{
  // Upgrade the former 12h default once; other custom hours and subsequent explicit 12h edits survive.
  if(readPersistedStateRaw(versionKey)!=='1'){
   const previous=readPersistedStateRaw(key);
   if(previous!==null&&Number(previous)===12&&!readPersistedStateRaw(prefix + FISH_LOOKBACK_POLICY_KEY))writePersistedStateRaw(key,'1');
   writePersistedStateRaw(versionKey,'1');
  }
  return validateFishLookback(readPersistedStateRaw(key));
 }catch{return FISH_DEFAULT_LOOKBACK_HOURS;}
}
export function saveFishLookback(value:unknown):number {const hours=validateFishLookback(value);writePersistedStateRaw(fishLookbackKey(),String(hours));writePersistedStateRaw(defaultVersionKey(),'1');return hours;}
export function readFishLookbackPreference(prefix = getUserPrefix()): FishLookbackPreference {
 const saved = readFishAccountSettings(prefix + FISH_ACCOUNT_SETTINGS_KEY);
 const hours = saved?.lookbackHours ?? readLegacyFishLookback(prefix);
 if (saved) return { hours, followsInterval: saved.lookbackFollowsInterval ?? (hours === FISH_DEFAULT_LOOKBACK_HOURS) };
 try {
  const policy = JSON.parse(readPersistedStateRaw(prefix + FISH_LOOKBACK_POLICY_KEY) ?? 'null');
  // The numeric preference remains readable by old tabs. An older tab's distinct value is a custom edit.
  if (policy?.hours === hours && typeof policy.followsInterval === 'boolean') return { hours, followsInterval: policy.followsInterval };
 } catch { /* Use the legacy preference when the policy is invalid. */ }
 return { hours, followsInterval: hours === FISH_DEFAULT_LOOKBACK_HOURS };
}
export function resolveFishCaptureLookback(preference: FishLookbackPreference, schedule?: FishAutoSchedule): number {
 return preference.followsInterval && schedule?.mode === 'auto' ? schedule.hours : preference.hours;
}
/** The coverage window never replaces formula warm-up or liquidity-gate history. */
export function fishProgramForLookback(plan:FishProgram,hours?:number,floors?:readonly FishTurnoverFloor[]):FishProgram {
 if(hours===undefined)return plan;
 const windowBars=Math.ceil(validateFishLookback(hours)*3600000/plan.step);
 const turnoverBars=Math.ceil(Math.max(0,...(floors??[]).map(f=>f.hours))*3600000/plan.step);
 const N=Math.max(plan.N,plan.warm+windowBars+1,windowBars+turnoverBars+1);
 return {...plan,N,unavailable:plan.unavailable??(N>FISH_MAX_HISTORY_BARS?`扫描过去 ${hours} 小时需要 ${N} 根历史（含指标预热），超过 ${FISH_MAX_HISTORY_BARS} 根上限，请缩短覆盖时间`:undefined)};
}
/** Each algorithm must independently produce a recent known start, preserving intersection/union consistency. */
export function limitFishLookback(result:FishMemberResult,anchorMs:number,hours?:number,expectedCutoff?:number):FishMemberResult {
 if(hours===undefined||result.outcome!=='hit')return result;
 const span=validateFishLookback(hours),start=result.signal?.timeMs;
 if(!Number.isFinite(anchorMs)||anchorMs<=0||start===undefined||!Number.isFinite(start)||start<=0){
  const {signal,...rest}=result;return {...rest,outcome:'readings',...(signal?.fish?{snapshot:{...signal.fish,outcome:'readings',lookbackHours:span,lookbackAnchorMs:anchorMs}}:{})};
 }
 const evidence=result.signal!.fish;
 if(expectedCutoff!==undefined&&evidence?.cutoffMs!==expectedCutoff||evidence?.lookbackAnchorMs!==undefined&&evidence.lookbackAnchorMs!==anchorMs||evidence?.lookbackHours!==undefined&&evidence.lookbackHours!==span){
  const {signal,...rest}=result;return {...rest,outcome:'readings',snapshot:{...signal.fish!,outcome:'readings',lookbackHours:span,lookbackAnchorMs:anchorMs}};
 }
 if(start<anchorMs-span*3600000||start>anchorMs){
  const {signal,...rest}=result;
  return {...rest,outcome:'outside',outsideStartMs:start,snapshot:{...signal.fish!,outcome:'outside',lookbackHours:hours,lookbackAnchorMs:anchorMs}};
 }
 return {...result,signal:{...result.signal,fish:{...result.signal.fish!,lookbackHours:hours,lookbackAnchorMs:anchorMs}}};
}
