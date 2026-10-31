/** Local per-account, per-feature scan settings; intentionally not trading state or a cloud definition. */
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw,writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { FishConstraint } from './algorithm';
import { isSellerFeature, SELLER_FEATURE_CORES, compileFeatureFormula } from '@/lib/deepDig/features';
import { accountFeatureDef } from '@/lib/featureSource';
/** 旧设置里的 H（外层 avg 小时数）读到也不再用：渔已去掉外层 avg。 */
export interface FishPreference { sellerSignVersion?:1; thresholdDefaultsVersion?:number; statistic?:string; lastSuggestion?:string; direction:'>'|'<';threshold:string;constraints:FishConstraint[] }
export const fishPreferenceKey=(id:string)=>`${getUserPrefix()}fish-algorithm-settings.v1:${id}`;
/** 用户截图指定的「结果 · avg_X」默认门槛，按显示单位填写。 */
export const FISH_DEFAULTS_VERSION=1;
export const FISH_DEFAULT_THRESHOLDS:Readonly<Record<string,string>>={cbi2:'0.04',cba:'8',bss:'0.12','drift-speed-z':'15',cdi2:'-0.04',dss:'-0.2',cda:'-8'};
// 只升级 DSP·a 的默认值，其他卡已保存的手动设定不重置。
export const fishDefaultThresholdVersion=(id:string)=>id==='drift-speed-z'?2:FISH_DEFAULTS_VERSION;
export function withFishDefaultThreshold(id:string,p:FishPreference,fillDefault=true):FishPreference {
  if(isSellerFeature(id)&&p.sellerSignVersion!==1){
    const statistic=p.statistic??'结果',core=SELLER_FEATURE_CORES[id];
    let flipped=statistic==='结果'||statistic===core||new RegExp(`^avg_${core}(?:_\\d+)?$`).test(statistic);
    if(!flipped)try{const def=accountFeatureDef(id);flipped=!!def&&compileFeatureFormula(def.formula).program.statements.at(-1)?.name===statistic;}catch{/* Invalid definitions remain editable. */}
    const finite=p.threshold.trim()!==''&&Number.isFinite(Number(p.threshold));
    p={...p,sellerSignVersion:1,...(flipped?{direction:p.direction==='>'?'<':'>',threshold:finite?String(-Number(p.threshold)):p.threshold,lastSuggestion:p.lastSuggestion!==undefined&&Number.isFinite(Number(p.lastSuggestion))?String(-Number(p.lastSuggestion)):undefined}:{}),...(finite?{thresholdDefaultsVersion:fishDefaultThresholdVersion(id)}:{})};
  }
  // A sign-only upgrade must preserve adopted suggestions as well as manual values.
  if(isSellerFeature(id)&&p.threshold.trim()&&Number.isFinite(Number(p.threshold)))return p;
  const value=FISH_DEFAULT_THRESHOLDS[id],version=fishDefaultThresholdVersion(id);
  if(fillDefault&&value&&(p.statistic??'结果')==='结果'&&!p.threshold?.trim())return {...p,threshold:value,lastSuggestion:undefined,thresholdDefaultsVersion:version};
  return p;
}
/** 已保存的偏好原样读取；默认门槛仅用于首次新建偏好。 */
export function readFishPreference(id:string):FishPreference {
  const fallback=withFishDefaultThreshold(id,{statistic:'结果',direction:isSellerFeature(id)?'<':'>',threshold:'',constraints:[],...(isSellerFeature(id)?{sellerSignVersion:1 as const}:{})});
  try{const x=JSON.parse(readPersistedStateRaw(fishPreferenceKey(id))??'null');if(!x)return fallback;return withFishDefaultThreshold(id,{sellerSignVersion:x.sellerSignVersion===1?1:undefined,thresholdDefaultsVersion:typeof x.thresholdDefaultsVersion==='number'?x.thresholdDefaultsVersion:undefined,statistic:typeof x.statistic==='string'?x.statistic:'结果',lastSuggestion:typeof x.lastSuggestion==='string'?x.lastSuggestion:undefined,direction:x.direction==='<'?'<':'>',threshold:typeof x.threshold==='string'?x.threshold:'',constraints:Array.isArray(x.constraints)?x.constraints.filter((c:any)=>c&&typeof c.id==='string'&&typeof c.text==='string'&&typeof c.enabled==='boolean'):[]},false);}catch{return fallback;}
}
export const saveFishPreference=(id:string,p:FishPreference)=>writePersistedStateRaw(fishPreferenceKey(id),JSON.stringify({...p,...(isSellerFeature(id)?{sellerSignVersion:1}:{}),...(FISH_DEFAULT_THRESHOLDS[id]&&(p.statistic??'结果')==='结果'?{thresholdDefaultsVersion:fishDefaultThresholdVersion(id)}:{})}));
