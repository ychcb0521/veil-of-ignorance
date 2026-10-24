import {useEffect,useState} from 'react';
import {FEATURES_KEY,mergeFeatureDefs,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import {readPersistedStateRaw,subscribePersistedStateHydration} from '@/lib/persistedStateStorage';
import {fishFeatureDefinitions} from '@/lib/fish/features';
export function useFishFeatures(){
  const key=getUserPrefix()+FEATURES_KEY;
  const read=()=>{try{const x=JSON.parse(readPersistedStateRaw(key)??'[]');return fishFeatureDefinitions(mergeFeatureDefs(Array.isArray(x)?x:[]).filter(d=>!d.removed));}catch{return fishFeatureDefinitions(mergeFeatureDefs([]));}};
  const [defs,setDefs]=useState<DeepDigFeatureDef[]>(read);
  useEffect(()=>{const refresh=()=>setDefs(read());const unsubscribe=subscribePersistedStateHydration(key,refresh);const storage=(e:StorageEvent)=>{if(e.key===key||e.key===null)refresh();};refresh();window.addEventListener('storage',storage);window.addEventListener('focus',refresh);return()=>{unsubscribe();window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);};},[key]);
  return defs;
}
