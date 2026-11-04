import {useCallback,useEffect,useState} from 'react';
import {readPersistedStateRaw,writePersistedStateRaw,subscribePersistedStateHydration} from '@/lib/persistedStateStorage';
import {queueSimStatePush} from '@/lib/simStateSync';
import type {QualityPlanTemplate} from '@/lib/fish/qualityPlanTemplates';
export const QUALITY_PLAN_CATALOG_KEY='quality_plan_templates_v1';
const EMPTY:QualityPlanTemplate[]=[];
const key=(owner?:string)=>`sim_${owner??'anon'}_${QUALITY_PLAN_CATALOG_KEY}`;
const read=(owner?:string):QualityPlanTemplate[]=>{try{const v=JSON.parse(readPersistedStateRaw(key(owner))??'[]');return Array.isArray(v)?v:[];}catch{return [];}};
/** Template inbox stays small and account-scoped; hydration never uploads defaults. */
export function useQualityPlanCatalog(owner?:string){
 const [state,setState]=useState(()=>({owner,value:read(owner)}));
 useEffect(()=>{
  const refresh=()=>setState(old=>{const value=read(owner);return old.owner===owner&&JSON.stringify(old.value)===JSON.stringify(value)?old:{owner,value};});
  const off=subscribePersistedStateHydration(key(owner),refresh);refresh();return off;
 },[owner]);
 const save=useCallback((value:QualityPlanTemplate[])=>{
  writePersistedStateRaw(key(owner),JSON.stringify(value));setState({owner,value});
  if(owner)queueSimStatePush(owner,QUALITY_PLAN_CATALOG_KEY,value);
 },[owner]);
 return [state.owner===owner?state.value:EMPTY,save] as const;
}
