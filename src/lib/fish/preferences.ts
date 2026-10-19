/** Local per-account, per-feature scan settings; intentionally not trading state or a cloud definition. */
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw,writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { FishConstraint } from './algorithm';
/** 旧设置里的 H（外层 avg 小时数）读到也不再用：渔已去掉外层 avg。 */
export interface FishPreference { statistic?:string; lastSuggestion?:string; direction:'>'|'<';threshold:string;constraints:FishConstraint[] }
export const fishPreferenceKey=(id:string)=>`${getUserPrefix()}fish-algorithm-settings.v1:${id}`;
/** 阈值默认留空：由信号库算出的建议区间自动填（> 取 P25，< 取 P75），也可以手动输入。 */
export function readFishPreference(id:string):FishPreference {
  const fallback:FishPreference={statistic:'结果',direction:'>',threshold:'',constraints:[]};
  try{const x=JSON.parse(readPersistedStateRaw(fishPreferenceKey(id))??'null');if(!x)return fallback;return {statistic:typeof x.statistic==='string'?x.statistic:'结果',lastSuggestion:typeof x.lastSuggestion==='string'?x.lastSuggestion:undefined,direction:x.direction==='<'?'<':'>',threshold:typeof x.threshold==='string'?x.threshold:fallback.threshold,constraints:Array.isArray(x.constraints)?x.constraints.filter((c:any)=>c&&typeof c.id==='string'&&typeof c.text==='string'&&typeof c.enabled==='boolean'):[]};}catch{return fallback;}
}
export const saveFishPreference=(id:string,p:FishPreference)=>writePersistedStateRaw(fishPreferenceKey(id),JSON.stringify(p));
