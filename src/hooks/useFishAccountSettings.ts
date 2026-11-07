import { useCallback, useEffect, useState } from 'react';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { notifyPersistedStateHydrated, subscribePersistedStateHydration, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { hydrateSimState, pushSimStateImmediately } from '@/lib/simStateSync';
import { FISH_ACCOUNT_SETTINGS_KEY, readFishAccountSettings, type FishAccountSettings } from '@/lib/fish/accountSettings';
import { FISH_LOOKBACK_KEY, saveFishLookback } from '@/lib/fish/lookback';

export function useFishAccountSettings(refreshOnFocus = false) {
  const userId = getUserId(), fullKey = getUserPrefix() + FISH_ACCOUNT_SETTINGS_KEY;
  const [snapshot, setSnapshot] = useState(() => ({ fullKey, value: readFishAccountSettings(fullKey) }));
  const settings = snapshot.fullKey === fullKey ? snapshot.value : readFishAccountSettings(fullKey);
  useEffect(() => {
    const refresh = () => setSnapshot({fullKey, value: readFishAccountSettings(fullKey)});
    const unsubscribe = subscribePersistedStateHydration(fullKey, refresh);
    refresh();
    return unsubscribe;
  }, [fullKey]);
  useEffect(() => {
    if (!userId || !refreshOnFocus) return;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { await hydrateSimState(userId, [FISH_ACCOUNT_SETTINGS_KEY]); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, refreshOnFocus]);
  const persist = useCallback(async (key: string, value: unknown) => {
    if (!userId) throw new Error('请先登录后保存账号参数');
    const storageKey = getUserPrefix(userId) + key;
    writePersistedStateRaw(storageKey, JSON.stringify(value));
    notifyPersistedStateHydrated(storageKey);
    let timer: ReturnType<typeof setTimeout>;
    const confirmed = await Promise.race([
      pushSimStateImmediately(userId, key, value),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 15_000); }),
    ]).finally(() => clearTimeout(timer));
    if (!confirmed) {
      throw new Error('参数已暂存本机，云端尚未确认；请联网后再次保存，确认后再换设备');
    }
  }, [userId]);
  const save = useCallback((value: FishAccountSettings) => persist(FISH_ACCOUNT_SETTINGS_KEY, value), [persist]);
  const saveLookback = useCallback(async (value: unknown) => {
    const hours = saveFishLookback(value);
    if (!userId) return hours;
    const latest = readFishAccountSettings(fullKey);
    if (latest) await save({ ...latest, lookbackHours: hours });
    else await persist(FISH_LOOKBACK_KEY, hours);
    return hours;
  }, [userId, fullKey, persist, save]);
  return { settings, save, saveLookback };
}
