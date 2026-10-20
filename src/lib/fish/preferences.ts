/** Local per-account, per-feature scan settings; intentionally not trading state or a cloud definition. */
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw,writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { FishConstraint } from './algorithm';
/** 旧设置里的 H（外层 avg 小时数）读到也不再用：渔已去掉外层 avg。 */
export interface FishPreference { thresholdDefaultsVersion?:number; statistic?:string; lastSuggestion?:string; direction:'>'|'<';threshold:string;constraints:FishConstraint[] }
export const fishPreferenceKey=(id:string)=>`${getUserPrefix()}fish-algorithm-settings.v1:${id}`;
/** 用户截图指定的「结果 · avg_X」默认门槛，按显示单位填写。 */
export const FISH_DEFAULTS_VERSION=1;
export const FISH_DEFAULT_THRESHOLDS:Readonly<Record<string,string>>={cbi2:'0.04',cba:'8',bss:'0.08','drift-speed-z':'10'};
export function withFishDefaultThreshold(id:string,p:FishPreference):FishPreference {
  const value=FISH_DEFAULT_THRESHOLDS[id];
  if(value&&(p.statistic??'结果')==='结果'&&((p.thresholdDefaultsVersion??0)<FISH_DEFAULTS_VERSION||!p.threshold?.trim()||p.threshold===p.lastSuggestion))return {...p,threshold:value,lastSuggestion:undefined,thresholdDefaultsVersion:FISH_DEFAULTS_VERSION};
  return p;
}
/** 无版本标记的旧设置统一恢复指定默认值一次；此后保存的手动值不再重置。 */
export function readFishPreference(id:string):FishPreference {
  const fallback=withFishDefaultThreshold(id,{statistic:'结果',direction:'>',threshold:'',constraints:[]});
  try{const x=JSON.parse(readPersistedStateRaw(fishPreferenceKey(id))??'null');if(!x)return fallback;return withFishDefaultThreshold(id,{thresholdDefaultsVersion:typeof x.thresholdDefaultsVersion==='number'?x.thresholdDefaultsVersion:undefined,statistic:typeof x.statistic==='string'?x.statistic:'结果',lastSuggestion:typeof x.lastSuggestion==='string'?x.lastSuggestion:undefined,direction:x.direction==='<'?'<':'>',threshold:typeof x.threshold==='string'?x.threshold:'',constraints:Array.isArray(x.constraints)?x.constraints.filter((c:any)=>c&&typeof c.id==='string'&&typeof c.text==='string'&&typeof c.enabled==='boolean'):[]});}catch{return fallback;}
}
export const saveFishPreference=(id:string,p:FishPreference)=>writePersistedStateRaw(fishPreferenceKey(id),JSON.stringify({...p,...(FISH_DEFAULT_THRESHOLDS[id]&&(p.statistic??'结果')==='结果'?{thresholdDefaultsVersion:FISH_DEFAULTS_VERSION}:{})}));
