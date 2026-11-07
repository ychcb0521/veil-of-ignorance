import { useCallback, useEffect, useState } from 'react';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { notifyPersistedStateHydrated, subscribePersistedStateHydration, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { hydrateSimState, pushSimStateImmediately } from '@/lib/simStateSync';
import { FISH_ACCOUNT_SETTINGS_KEY, readFishAccountSettings, type FishAccountSettings } from '@/lib/fish/accountSettings';

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
  const save = useCallback(async (value: FishAccountSettings) => {
    if (!userId) throw new Error('请先登录后保存账号参数');
    writePersistedStateRaw(fullKey, JSON.stringify(value));
    notifyPersistedStateHydrated(fullKey);
    let timer: ReturnType<typeof setTimeout>;
    const confirmed = await Promise.race([
      pushSimStateImmediately(userId, FISH_ACCOUNT_SETTINGS_KEY, value),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 15_000); }),
    ]).finally(() => clearTimeout(timer));
    if (!confirmed) {
      throw new Error('参数已暂存本机，云端尚未确认；请联网后再次保存，确认后再换设备');
    }
  }, [userId, fullKey]);
  return { settings, save };
}
