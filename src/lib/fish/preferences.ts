/** Local per-account, per-feature scan settings; intentionally not trading state or a cloud definition. */
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw,writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { FishConstraint } from './algorithm';
export interface FishPreference { H:string;direction:'>'|'<';threshold:string;constraints:FishConstraint[] }
export const fishPreferenceKey=(id:string)=>`${getUserPrefix()}fish-algorithm-settings.v1:${id}`;
export function readFishPreference(id:string):FishPreference {
  const fallback:FishPreference={H:'24',direction:'>',threshold:id==='cbi2'?'0.3':'',constraints:[]};
  try{const x=JSON.parse(readPersistedStateRaw(fishPreferenceKey(id))??'null');if(!x)return fallback;return {H:typeof x.H==='string'?x.H:fallback.H,direction:x.direction==='<'?'<':'>',threshold:typeof x.threshold==='string'?x.threshold:fallback.threshold,constraints:Array.isArray(x.constraints)?x.constraints.filter((c:any)=>c&&typeof c.id==='string'&&typeof c.text==='string'&&typeof c.enabled==='boolean'):[]};}catch{return fallback;}
}
export const saveFishPreference=(id:string,p:FishPreference)=>writePersistedStateRaw(fishPreferenceKey(id),JSON.stringify(p));
