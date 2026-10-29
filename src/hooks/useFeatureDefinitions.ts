import { useCallback, useSyncExternalStore } from 'react';
import { accountFeatureDefs } from '@/lib/featureSource';
import { FEATURES_KEY } from '@/lib/deepDig/features';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';

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
  return useSyncExternalStore(subscribe, accountFeatureDefs, accountFeatureDefs);
}
