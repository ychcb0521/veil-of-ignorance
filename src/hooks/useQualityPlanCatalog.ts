import {useCallback,useEffect,useState} from 'react';
import {readPersistedStateRaw,writePersistedStateRaw,subscribePersistedStateHydration} from '@/lib/persistedStateStorage';
import {queueSimStatePush} from '@/lib/simStateSync';
import type {QualityPlanTemplate} from '@/lib/fish/qualityPlanTemplates';
export const QUALITY_PLAN_CATALOG_KEY='quality_plan_templates_v1';
const EMPTY:QualityPlanTemplate[]=[];
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
   refresh();
   return unsubscribe;
 }, [owner]);
 const save = useCallback((value: QualityPlanTemplate[]) => {
   const raw = JSON.stringify(value);
   writePersistedStateRaw(key(owner), raw);
   setState({ owner, raw, value });
   if (owner) queueSimStatePush(owner, QUALITY_PLAN_CATALOG_KEY, value, raw);
 }, [owner]);
 return [state.owner===owner?state.value:EMPTY,save] as const;
}
