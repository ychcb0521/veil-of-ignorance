import {useCallback,useEffect,useRef,useState} from 'react';
import {subscribePersistedStateHydration} from '@/lib/persistedStateStorage';
import {queueSimStatePush} from '@/lib/simStateSync';
import {QUALITY_SAVED_PLANS_KEY,qualitySavedPlansKey,readSavedQualityPlans,writeSavedQualityPlans,mergeSavedQualityPlans,type SavedQualityPlan} from '@/lib/fish/qualitySavedPlans';
import {loadDurableQualityPlans,saveDurableQualityPlans} from '@/lib/fish/qualitySavedPlansStore';
const EMPTY:SavedQualityPlan[]=[];
export function useQualitySavedPlans(owner?:string){
 const [state,setState]=useState(()=>({owner,value:readSavedQualityPlans(owner)}));
 const current=useRef(state);
 useEffect(()=>{
  const refresh=()=>{
   const old=current.current;
   const raw=readSavedQualityPlans(owner),value=mergeSavedQualityPlans(old.owner===owner?old.value:[],raw);
   if(JSON.stringify(value)!==JSON.stringify(raw)){writeSavedQualityPlans(owner,value);if(owner)queueSimStatePush(owner,QUALITY_SAVED_PLANS_KEY,value);}
   if(old.owner!==owner||JSON.stringify(old.value)!==JSON.stringify(value)){current.current={owner,value};setState(current.current);}
  };
  const storage=(event:StorageEvent)=>{if(event.key===qualitySavedPlansKey(owner))refresh();};
  let active=true;
  const off=subscribePersistedStateHydration(qualitySavedPlansKey(owner),()=>{refresh();void saveDurableQualityPlans(owner,readSavedQualityPlans(owner)).catch(()=>undefined);});window.addEventListener('storage',storage);refresh();
  const before=readSavedQualityPlans(owner);
  void loadDurableQualityPlans(owner).then(value=>{if(active){refresh();if(owner&&JSON.stringify(before)!==JSON.stringify(value))queueSimStatePush(owner,QUALITY_SAVED_PLANS_KEY,value);}});
  return()=>{active=false;off();window.removeEventListener('storage',storage);};
 },[owner]);
 const save=useCallback((entries:SavedQualityPlan[])=>{
  const value=writeSavedQualityPlans(owner,entries);current.current={owner,value};setState(current.current);
  void saveDurableQualityPlans(owner,value).then(merged=>{writeSavedQualityPlans(owner,merged);if(owner&&JSON.stringify(value)!==JSON.stringify(merged))queueSimStatePush(owner,QUALITY_SAVED_PLANS_KEY,merged);}).catch(()=>undefined);
  if(owner)queueSimStatePush(owner,QUALITY_SAVED_PLANS_KEY,value);return value;
 },[owner]);
 return [state.owner===owner?state.value:EMPTY,save] as const;
}
