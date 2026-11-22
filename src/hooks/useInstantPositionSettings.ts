import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { subscribePersistedStateHydration, readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { DEFAULT_INSTANT_POSITION, FISH_INSTANT_POSITION_KEY, sizeInstantEntry, type InstantPositionSettings } from '@/lib/fish/instantPositionSettings';
import { persistFishAccountPreference } from './useFishAccountSettings';

export function useInstantPositionSettings(owner?: string) {
  const key = owner && getUserPrefix(owner) + FISH_INSTANT_POSITION_KEY;
  const subscribe = useCallback((notify: () => void) => {
    if (!key) return () => {};
    const unsubscribe = subscribePersistedStateHydration(key, notify);
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) notify(); };
    window.addEventListener('storage', onStorage);
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, [key]);
  const raw = useSyncExternalStore(subscribe, () => key ? readPersistedStateRaw(key) : null);
  const parsed = useMemo(() => {
    try {
      const settings: InstantPositionSettings | null = JSON.parse(raw ?? 'null');
      if (settings) sizeInstantEntry(settings);
      return { settings: settings ?? DEFAULT_INSTANT_POSITION };
    } catch { return { settings: null, issue: '已存仓位参数无效，请重新设置' }; }
  }, [raw]);
  const save = async (settings: InstantPositionSettings | null) => {
    if (!owner) throw Error('请先登录后保存仓位设置');
    if (settings) sizeInstantEntry(settings);
    await persistFishAccountPreference(owner, FISH_INSTANT_POSITION_KEY, settings);
  };
  return { ...parsed, save };
}
