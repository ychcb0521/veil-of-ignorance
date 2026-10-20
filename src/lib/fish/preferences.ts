/** Local per-account, per-feature scan settings; intentionally not trading state or a cloud definition. */
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw,writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { FishConstraint } from './algorithm';
/** 旧设置里的 H（外层 avg 小时数）读到也不再用：渔已去掉外层 avg。 */
export interface FishPreference { statistic?:string; lastSuggestion?:string; direction:'>'|'<';threshold:string;constraints:FishConstraint[] }
export const fishPreferenceKey=(id:string)=>`${getUserPrefix()}fish-algorithm-settings.v1:${id}`;
/** 用户截图指定的「结果 · avg_X」默认门槛，按显示单位填写。 */
export const FISH_DEFAULT_THRESHOLDS:Readonly<Record<string,string>>={cbi2:'0.04',cba:'8',bss:'0.08','drift-speed-z':'10'};
export function withFishDefaultThreshold(id:string,p:FishPreference):FishPreference {
  const value=FISH_DEFAULT_THRESHOLDS[id];
  if(value&&(p.statistic??'结果')==='结果'&&(!p.threshold?.trim()||p.threshold===p.lastSuggestion))return {...p,threshold:value,lastSuggestion:undefined};
  return p;
}
/** 四项使用固定默认门槛，其余特征仍留空；已手动修改的数值保持不变。 */
export function readFishPreference(id:string):FishPreference {
  const fallback=withFishDefaultThreshold(id,{statistic:'结果',direction:'>',threshold:'',constraints:[]});
  try{const x=JSON.parse(readPersistedStateRaw(fishPreferenceKey(id))??'null');if(!x)return fallback;return withFishDefaultThreshold(id,{statistic:typeof x.statistic==='string'?x.statistic:'结果',lastSuggestion:typeof x.lastSuggestion==='string'?x.lastSuggestion:undefined,direction:x.direction==='<'?'<':'>',threshold:typeof x.threshold==='string'?x.threshold:'',constraints:Array.isArray(x.constraints)?x.constraints.filter((c:any)=>c&&typeof c.id==='string'&&typeof c.text==='string'&&typeof c.enabled==='boolean'):[]});}catch{return fallback;}
}
export const saveFishPreference=(id:string,p:FishPreference)=>writePersistedStateRaw(fishPreferenceKey(id),JSON.stringify(p));
