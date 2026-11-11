import { useCallback, useEffect, useState } from 'react';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { notifyPersistedStateHydrated, subscribePersistedStateHydration, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { hydrateSimState, pushSimStateImmediately } from '@/lib/simStateSync';
import { FISH_ACCOUNT_SETTINGS_KEY, readFishAccountSettings, type FishAccountSettings } from '@/lib/fish/accountSettings';
import { FISH_LOOKBACK_KEY, saveFishLookback } from '@/lib/fish/lookback';
import { FISH_WICK_SETTINGS_KEY, readFishDownwardWick, saveFishDownwardWick, validateFishDownwardWick, type FishDownwardWick } from '@/lib/fish/downwardWick';

import { FISH_CAPTURE_TURNOVER_KEY, readCaptureTurnoverSettings, validateFishTurnoverSettings, type FishTurnoverSettings } from '@/lib/fish/turnoverSettings';

export function useFishAccountSettings(refreshOnFocus = false) {
  const userId = getUserId(), prefix = getUserPrefix();
  const fullKey = prefix + FISH_ACCOUNT_SETTINGS_KEY, wickKey = prefix + FISH_WICK_SETTINGS_KEY, turnoverKey = prefix + FISH_CAPTURE_TURNOVER_KEY;
  const [snapshot, setSnapshot] = useState(() => ({ fullKey, value: readFishAccountSettings(fullKey) }));
  const [wickSnapshot, setWickSnapshot] = useState(() => ({ prefix, value: readFishDownwardWick(prefix) }));
  const [turnoverSnapshot, setTurnoverSnapshot] = useState(() => ({ prefix, value: readCaptureTurnoverSettings(prefix) }));
  const turnover = turnoverSnapshot.prefix === prefix ? turnoverSnapshot.value : readCaptureTurnoverSettings(prefix);
  const settings = snapshot.fullKey === fullKey ? snapshot.value : readFishAccountSettings(fullKey);
  const downwardWick = wickSnapshot.prefix === prefix ? wickSnapshot.value : readFishDownwardWick(prefix);
  useEffect(() => {
    const refreshWick = () => setWickSnapshot({ prefix, value: readFishDownwardWick(prefix) });
    const refreshTurnover = () => setTurnoverSnapshot({ prefix, value: readCaptureTurnoverSettings(prefix) });
    const refreshSettings = () => {
      setSnapshot({ fullKey, value: readFishAccountSettings(fullKey) });
      refreshWick();
    };
    const unsubscribeSettings = subscribePersistedStateHydration(fullKey, refreshSettings);
    const unsubscribeWick = subscribePersistedStateHydration(wickKey, refreshWick);
    const unsubscribeTurnover = subscribePersistedStateHydration(turnoverKey, refreshTurnover);
    const onStorage = (event: StorageEvent) => {
      if (event.key === fullKey) refreshSettings();
      else if (event.key === wickKey) refreshWick();
      else if (event.key === turnoverKey) refreshTurnover();
    };
    window.addEventListener('storage', onStorage);
    refreshSettings();
    refreshTurnover();
    return () => {
      unsubscribeSettings();
      unsubscribeWick();
      unsubscribeTurnover();
      window.removeEventListener('storage', onStorage);
    };
  }, [prefix, fullKey, wickKey, turnoverKey]);
  useEffect(() => {
    if (!userId || !refreshOnFocus) return;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { await hydrateSimState(userId, [FISH_ACCOUNT_SETTINGS_KEY, FISH_WICK_SETTINGS_KEY, FISH_CAPTURE_TURNOVER_KEY]); }
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
  const saveDownwardWick = useCallback(async (value: FishDownwardWick) => {
    if (userId) await persist(FISH_WICK_SETTINGS_KEY, validateFishDownwardWick(value));
    else if (!saveFishDownwardWick(value, prefix)) throw new Error('浏览器暂时无法保存插针设置，请重试');
  }, [userId, prefix, persist]);
  const saveTurnover = useCallback(async (value: FishTurnoverSettings) => {
    const next = validateFishTurnoverSettings(value);
    if (userId) await persist(FISH_CAPTURE_TURNOVER_KEY, next);
    else {
      if (!writePersistedStateRaw(turnoverKey, JSON.stringify(next))) throw new Error('浏览器暂时无法保存成交额设置');
      notifyPersistedStateHydrated(turnoverKey);
    }
  }, [userId, turnoverKey, persist]);
  return { settings, downwardWick, turnover, save, saveLookback, saveDownwardWick, saveTurnover };
}
