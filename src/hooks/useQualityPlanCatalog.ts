import {useCallback,useEffect,useState} from 'react';
import {readPersistedStateRaw,writePersistedStateRaw,subscribePersistedStateHydration} from '@/lib/persistedStateStorage';
import {queueSimStatePush} from '@/lib/simStateSync';
import {mergeQualityPlanTemplates, sameQualityPlanTemplates, type QualityPlanTemplate} from '@/lib/fish/qualityPlanTemplates';
import {readFishPreferences, updateFishPreference} from '@/lib/fish/fishPreferencesDb';
export const QUALITY_PLAN_CATALOG_KEY='quality_plan_templates_v1';
const EMPTY:QualityPlanTemplate[]=[];
const durableKey = (owner?: string) => 'quality-plan-catalog:' + (owner ?? 'anon');

export function saveDurableQualityPlanCatalog(owner: string | undefined, templates: readonly QualityPlanTemplate[]) {
 return updateFishPreference<QualityPlanTemplate[]>(durableKey(owner),
   previous => mergeQualityPlanTemplates(previous, templates) ?? EMPTY);
}
const key=(owner?:string)=>`sim_${owner??'anon'}_${QUALITY_PLAN_CATALOG_KEY}`;
function parseCatalog(raw: string | null): QualityPlanTemplate[] {
  if (raw === null) return EMPTY;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : EMPTY;
  } catch {
    return EMPTY;
  }
}
/** Keep the catalog account-scoped and parse only when the stored value changes. */
export function useQualityPlanCatalog(owner?:string){
 const [state, setState] = useState(() => {
   const raw = readPersistedStateRaw(key(owner));
   return { owner, raw, value: parseCatalog(raw) };
 });
 useEffect(() => {
   const storageKey = key(owner);
   const refresh = () => {
     const raw = readPersistedStateRaw(storageKey);
     setState(old => old.owner === owner && old.raw === raw ? old : { owner, raw, value: parseCatalog(raw) });
   };
   const unsubscribe = subscribePersistedStateHydration(storageKey, refresh);
   let active = true;
   refresh();
   void readFishPreferences<QualityPlanTemplate[]>([durableKey(owner)]).then(([stored]) => {
     if (!active || !stored?.length) return;
     setState(old => {
       if (old.owner !== owner) return old;
       const value = mergeQualityPlanTemplates(stored, old.value) ?? EMPTY;
       return sameQualityPlanTemplates(old.value, value) ? old : {...old, value};
     });
   }).catch(() => { /* Legacy browser storage and cloud hydration remain available. */ });
   return () => { active = false; unsubscribe(); };
 }, [owner]);
 const save = useCallback((value: QualityPlanTemplate[]) => {
   const raw = JSON.stringify(value);
   if (!writePersistedStateRaw(key(owner), raw)) {
     void saveDurableQualityPlanCatalog(owner, value).catch(() => undefined);
   }
   setState({ owner, raw, value });
   if (owner) queueSimStatePush(owner, QUALITY_PLAN_CATALOG_KEY, value, raw);
 }, [owner]);
 return [state.owner===owner?state.value:EMPTY,save] as const;
}
