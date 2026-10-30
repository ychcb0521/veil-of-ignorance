import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { accountFeatureDefs } from '@/lib/featureSource';
import { FEATURES_KEY, ensureSellerRetentionCopies } from '@/lib/deepDig/features';
import { getUserPrefix, getUserId } from '@/lib/userStoragePrefix';
import { queueSimStatePush } from '@/lib/simStateSync';
import { readPersistedStateRaw, writePersistedStateRaw, subscribePersistedStateHydration } from '@/lib/persistedStateStorage';

/** One live definition list for local saves, cloud restores and other tabs. */
export function useFeatureDefinitions() {
  const key = getUserPrefix() + FEATURES_KEY;
  const subscribe = useCallback((refresh: () => void) => {
    const unsubscribe = subscribePersistedStateHydration(key, refresh);
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) refresh(); };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', refresh);
    return () => { unsubscribe(); window.removeEventListener('storage', storage); window.removeEventListener('focus', refresh); };
  }, [key]);
  const definitions=useSyncExternalStore(subscribe, accountFeatureDefs, accountFeatureDefs);
  useEffect(()=>{let saved;try{saved=JSON.parse(readPersistedStateRaw(key)??'[]');}catch{return;}if(!Array.isArray(saved))return;const next=ensureSellerRetentionCopies(saved);if(next===saved)return;writePersistedStateRaw(key,JSON.stringify(next));const owner=getUserId();if(owner)queueSimStatePush(owner,FEATURES_KEY,next);},[key,definitions]);
  return definitions;
}
