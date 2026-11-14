import { useCallback, useEffect, useRef, useState } from 'react';
import { getUnpersistedStateMetadata, readPersistedStateRaw, subscribePersistedStateHydration, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { FISH_INSTANT_MONITOR_KEY, INSTANT_TEMPLATE_MONITOR, instantMonitorTemplateIssue, readInstantMonitorSettings, type InstantMonitorPlanChoice } from '@/lib/fish/instantMonitorSettings';
import { readFishPreferences, updateFishPreference } from '@/lib/fish/fishPreferencesDb';
import { pushSimStateImmediately } from '@/lib/simStateSync';

type Backup = { raw: string; savedAt: number; synced?: true };
const backupKey = (owner: string) => 'instant-monitor-settings.v1/' + encodeURIComponent(owner);
const syncOptions = { preference: true, waitForRetry: true };
type Pending = { owner: string; backup: Backup };

async function markBackupSynced(owner: string, backup: Backup) {
  try {
    if (typeof indexedDB === 'undefined') return;
    await updateFishPreference<Backup | null>(backupKey(owner), previous =>
      previous?.raw === backup.raw && previous.savedAt === backup.savedAt ? { ...previous, synced: true } : previous ?? null);
  } catch { /* The server already confirmed the snapshot. */ }
}

export function useInstantMonitorSettings(owner: string | undefined) {
  const [saved, setSaved] = useState(() => ({ owner, settings: owner ? readInstantMonitorSettings(owner) : undefined }));
  const [pendingOwner, setPendingOwner] = useState<string>();
  const inFlight = useRef<Pending>();
  const pending = useRef<Pending>();
  useEffect(() => {
    if (!owner) return;
    const key = getUserPrefix(owner) + FISH_INSTANT_MONITOR_KEY;
    const refresh = () => setSaved({ owner, settings: readInstantMonitorSettings(owner) });
    const onStorage = (event: StorageEvent) => { if (event.key === key) refresh(); };
    const unsubscribe = subscribePersistedStateHydration(key, refresh);
    window.addEventListener('storage', onStorage);
    refresh();

    let active = true;
    const syncPending = async () => {
      const item = pending.current;
      if (!active || inFlight.current || item?.owner !== owner || readPersistedStateRaw(key) !== item.backup.raw) return;
      inFlight.current = item;
      try {
        if (await pushSimStateImmediately(owner, FISH_INSTANT_MONITOR_KEY, JSON.parse(item.backup.raw), syncOptions)) {
          if (active && pending.current === item) {
            pending.current = undefined;
            setPendingOwner(undefined);
          }
          await markBackupSynced(owner, item.backup);
          if (active) refresh();
        }
      } finally {
        if (inFlight.current === item) inFlight.current = undefined;
      }
    };
    const onOnline = () => { void syncPending(); };
    window.addEventListener('online', onOnline);

    const startingRaw = readPersistedStateRaw(key);
    if (typeof indexedDB !== 'undefined') void readFishPreferences<Backup | null>([backupKey(owner)]).then(([backup]) => {
      if (!active || !backup || inFlight.current || readPersistedStateRaw(key) !== startingRaw) return;
      const metadata = getUnpersistedStateMetadata(key);
      let shadow = 0;
      try { shadow = Number(localStorage.getItem(key + '__syncts')) || 0; } catch { /* Storage unavailable. */ }
      const existingAt = Math.max(shadow, metadata?.updatedAt ?? 0);
      if (startingRaw === backup.raw && backup.synced) return;
      if (startingRaw !== null && startingRaw !== backup.raw && existingAt >= backup.savedAt) return;

      if (startingRaw !== backup.raw) {
        writePersistedStateRaw(key, backup.raw, backup.synced ? { source: 'remote', updatedAt: backup.savedAt } : undefined);
      }
      if (!backup.synced) {
        pending.current = { owner, backup };
        setPendingOwner(owner);
        if (navigator.onLine !== false) onOnline();
      }
    }).catch(() => { /* The existing local or cloud settings remain available. */ });
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('storage', onStorage);
      if (pending.current?.owner === owner) pending.current = undefined;
      setPendingOwner(current => current === owner ? undefined : current);
      if (inFlight.current?.owner === owner) inFlight.current = undefined;
    };
  }, [owner]);
  const save = useCallback(async (template?: InstantMonitorPlanChoice) => {
    if (!owner) throw new Error('请先登录后保存持仓监测设置');
    const issue = template && instantMonitorTemplateIssue(template);
    if (issue) throw new Error(issue);
    const settings = template ? {
      version: INSTANT_TEMPLATE_MONITOR, templateId: template.id, name: template.name, plan: structuredClone(template.plan),
    } : null;
    const key = getUserPrefix(owner) + FISH_INSTANT_MONITOR_KEY;
    const backup = { raw: JSON.stringify(settings), savedAt: Date.now() };
    const savedLocally = writePersistedStateRaw(key, backup.raw);
    const localBackup = (async () => {
      try {
        if (typeof indexedDB === 'undefined') return false;
        // A full localStorage must not make the frozen plan exist only in memory.
        const stored = await updateFishPreference<Backup | null>(backupKey(owner), previous => {
          if (readPersistedStateRaw(key) !== backup.raw) return previous ?? null;
          return backup;
        });
        return stored?.raw === backup.raw && stored.savedAt === backup.savedAt;
      } catch { return false; }
    })();
    const item = { owner, backup };
    pending.current = item;
    setPendingOwner(owner);
    inFlight.current = item;
    try {
      const confirmed = await pushSimStateImmediately(owner, FISH_INSTANT_MONITOR_KEY, settings, syncOptions);
      if (confirmed) {
        if (pending.current === item) {
          pending.current = undefined;
          setPendingOwner(undefined);
        }
        void localBackup.then(() => markBackupSynced(owner, backup));
        return;
      }
      if (readPersistedStateRaw(key) !== backup.raw) return;
      if (savedLocally || await localBackup) return 'local' as const;
      throw new Error('本机和云端暂未确认保存，请保留页面并重试。');
    } finally {
      if (inFlight.current === item) inFlight.current = undefined;
    }
  }, [owner]);
  return { settings: saved.owner === owner ? saved.settings : undefined, save, pendingCloud: !!owner && pendingOwner === owner };
}
