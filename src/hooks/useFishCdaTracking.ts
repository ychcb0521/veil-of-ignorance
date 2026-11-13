import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FishSnapshot } from '@/lib/fish/algorithm';
import { fishNotifyMissing } from '@/lib/fish/notify';
import type { PreEntryLibrary, PreEntryRecord, PreEntryRound } from '@/lib/fish/preEntryMonitor';
import { readAutomaticPreEntryCheckpoint, readAutomaticPreEntrySales } from '@/lib/fish/preEntryPersistence';
import { freezeScreenedCda, SCREENED_CDA_STEP, SCREENED_CDA_GUARD_RULE, validScreenedSale, type ScreenedCdaGuardProgress, type ScreenedCdaTrigger } from '@/lib/fish/screenedCda';
import { readFishPreferences, readFishPreferenceEntries, writeFishPreference } from '@/lib/fish/fishPreferencesDb';
import { markPageInstantPosition, readPageScreenedCda } from './useFish';
import { screenedFishMailLock } from './useFishScreeningAutomation';
import type { InstantPositionInput } from '@/lib/fish/instantCampaign';
import { saveInstantCampaignInput } from '@/lib/fish/instantCampaignStore';
import type { useFishNotify } from './useFishNotify';

const CONFIG_KEY = 'veil.fish-cda-tracking.v1:';
const POLL_MS = 2000;
const CLOSE_GRACE_MS = 1000;
type Settings = { enabledAt: number; snapshot: FishSnapshot };
export interface ScreenedFishAdmission { record: PreEntryRecord; round: PreEntryRound }
interface Checkpoint {
  after: number;
  alert?: ScreenedCdaTrigger;
  progress?: ScreenedCdaGuardProgress;
  sent?: string[];
  delivered?: true;
  nextMailAt?: number;
  failures?: number;
}
export interface FishCdaTracking {
  enabled: boolean;
  active: number;
  awaitingMail: number;
  alerts: ReadonlyMap<string, ScreenedCdaTrigger>;
  admitted?: readonly ScreenedFishAdmission[];
  localSales?: readonly ScreenedFishAdmission[];
  hasSavedSales?: boolean;
  campaignIssue?: string;
  closePosition?: (input: InstantPositionInput) => Promise<void>;
  error: string;
  saving: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
}

function readLocal<T>(key: string): T | undefined {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined; }
  catch { return undefined; }
}

function initialCursor(record: PreEntryRecord, settings: Settings) {
  const start = Math.max(record.matchedAt!, settings.enabledAt);
  return Math.ceil(start / SCREENED_CDA_STEP) * SCREENED_CDA_STEP - SCREENED_CDA_STEP;
}

/** Opt-in watches are owned by the authenticated app, regardless of the open panel. */
export function useFishCdaTracking(owner: string | undefined, library: PreEntryLibrary | undefined, ready: boolean,
  notify: ReturnType<typeof useFishNotify>, autoPositions = false): FishCdaTracking {
  const configKey = owner ? CONFIG_KEY + encodeURIComponent(owner) : '';
  const jobPrefix = configKey + ':';
  const [settings, setSettings] = useState<Settings>();
  const activeSettings = useMemo(() => {
    if (!autoPositions || settings) return settings;
    try { return { enabledAt: 0, snapshot: freezeScreenedCda() }; }
    catch { return undefined; }
  }, [autoPositions, settings]);
  const [saving, setSaving] = useState(!!configKey);
  const [error, setError] = useState('');
  const [savedSales, setSavedSales] = useState<{ owner: string; admitted: ScreenedFishAdmission[] }>();
  const [revision, setRevision] = useState(0);
  const [refreshVersion, refreshCheckpoints] = useState(0);
  const checkpoints = useRef(new Map<string, Checkpoint>());
  const changes = useRef<BroadcastChannel>();
  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!configKey) return;
    setSaving(true);
    try {
      const next = enabled ? { enabledAt: Date.now(), snapshot: freezeScreenedCda() } : undefined;
      await writeFishPreference(configKey, next ?? null);
      // An already open 630 tab still reads its own saved toggle.
      if (!enabled && readLocal<Settings>(configKey)) {
        try { localStorage.setItem(configKey, 'null'); } catch { /* The new toggle is already durable. */ }
      }
      setSettings(next);
      changes.current?.postMessage('settings');
      setError('');
    } catch (cause) {
      setError(cause instanceof DOMException ? 'CDA 追踪设置未能保存到浏览器数据库，请重试'
        : cause instanceof Error ? cause.message : 'CDA 追踪设置保存失败');
    } finally { setSaving(false); }
  }, [configKey]);
  const admitted = useMemo(() => {
    if (!owner || !ready || !library) return [];
    const rounds = new Map(library.rounds.filter(round => round.automatic && round.state === 'complete').map(round => [round.id, round]));
    return library.records.flatMap(record => {
      const round = rounds.get(record.roundId);
      return round && record.status === 'matched' && Number.isFinite(record.matchedAt) && record.matchedAt! > 0
        ? [{ record, round }] : [];
    });
  }, [library?.records, library?.rounds, owner, ready]);
  const entries = useMemo(() => autoPositions ? admitted : settings ? admitted.filter(({record}) => record.updatedAt >= settings.enabledAt) : [], [admitted, autoPositions, settings]);
  const current = useRef({ entries, notify });
  current.current = { entries, notify };
  const wake = useRef<() => void>();
  const manual = useRef<(input: InstantPositionInput) => Promise<void>>();
  const closePosition = useCallback(async (input: InstantPositionInput) => {
    if (!manual.current) throw Error('即时交易正在初始化，请稍后再试');
    await manual.current(input);
  }, []);

  useEffect(() => {
    if (!configKey) return;
    let alive = true;
    const refresh = async () => {
      try {
        const [saved] = await readFishPreferences<Settings | null>([configKey]);
        if (alive) setSettings(saved === undefined ? readLocal<Settings>(configKey) : saved ?? undefined);
      } catch {
        if (alive) setError('CDA 追踪的浏览器数据库暂不可用，请重新打开页面');
      } finally { if (alive) setSaving(false); }
    };
    const refreshLegacy = (event: StorageEvent) => {
      if (event.key === configKey || event.key === null) void refresh();
      if (event.key?.startsWith(jobPrefix)) refreshCheckpoints(version => version + 1);
    };
    try {
      changes.current = new BroadcastChannel(configKey);
      changes.current.onmessage = event => {
        if (event.data === 'settings') void refresh();
        if (event.data === 'alert') refreshCheckpoints(version => version + 1);
      };
    } catch { /* The stored settings will also be read when the page opens. */ }
    window.addEventListener('storage', refreshLegacy);
    void refresh();
    return () => {
      alive = false;
      window.removeEventListener('storage', refreshLegacy);
      changes.current?.close();
      changes.current = undefined;
    };
  }, [configKey, jobPrefix]);

  useEffect(() => {
    if (!owner || typeof indexedDB === 'undefined') return;
    let active = true;
    void (async () => {
      const stored = await readFishPreferenceEntries<Checkpoint>(jobPrefix);
      const sales = new Map<string, Checkpoint>();
      for (const [key, saved] of stored) if (saved?.alert) sales.set(key, saved);
      // Existing browser checkpoints from before IndexedDB are read without rewriting.
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith(jobPrefix)) continue;
          const suffix = key.slice(jobPrefix.length);
          const saved = readLocal<Checkpoint>(key);
          if (!sales.has(suffix) && saved?.alert) sales.set(suffix, saved);
        }
      } catch { /* The IndexedDB sales remain available. */ }
      if (!active || !sales.size) return;
      for (const [suffix, saved] of sales) {
        const key = jobPrefix + suffix;
        if (!checkpoints.current.get(key)?.alert) checkpoints.current.set(key, saved);
      }
      setSavedSales(previous => previous?.owner === owner ? previous : { owner, admitted: [] });
      const ids = [...sales.keys()].flatMap(key => {
        try { return [decodeURIComponent(key)]; } catch { return []; }
      });
      const saved = await readAutomaticPreEntrySales(owner, ids);
      if (!active) return;
      setSavedSales({ owner, admitted: saved });
      setRevision(value => value + 1);
    })().catch(() => undefined); // Full library recovery remains available for older archives.
    return () => { active = false; };
  }, [owner, jobPrefix, refreshVersion]);

  const localSales = owner && savedSales?.owner === owner ? savedSales.admitted : undefined;

  useEffect(() => {
    if (!admitted.length) return;
    let active = true;
    const keys = admitted.map(({record}) => jobPrefix + encodeURIComponent(record.id));
    void readFishPreferences<Checkpoint>(keys).then(rows => {
      if (!active) return;
      keys.forEach((key, i) => {
        const saved = rows[i] ?? readLocal<Checkpoint>(key);
        const existing = checkpoints.current.get(key);
        if (saved && (!existing || (saved.alert && !existing.alert))) checkpoints.current.set(key, saved);
      });
      setRevision(value => value + 1);
      wake.current?.();
    }, () => { if (active) setError('CDA 追踪进度读取失败，请重试'); });
    return () => { active = false; };
  }, [admitted, jobPrefix, refreshVersion]);

  useEffect(() => {
    const settings = activeSettings;
    if (!settings || !owner) return;
    const lifetime = new AbortController();
    let scanning = false, mailing = false;
    const retry = new Map<string, number>();
    const errors = new Map<string, string>();
    const keyOf = (record: PreEntryRecord) => jobPrefix + encodeURIComponent(record.id);
    const read = (record: PreEntryRecord) => checkpoints.current.get(keyOf(record)) ?? readLocal<Checkpoint>(keyOf(record));
    const refresh = async (records: readonly PreEntryRecord[]) => {
      const keys = records.map(keyOf), values = await readFishPreferences<Checkpoint>(keys);
      let changed = false;
      keys.forEach((key, i) => {
        const value = values[i] ?? readLocal<Checkpoint>(key);
        if (value && JSON.stringify(checkpoints.current.get(key)) !== JSON.stringify(value)) {
          checkpoints.current.set(key, value);
          changed = true;
        }
      });
      if (changed) setRevision(revision => revision + 1);
    };
    const save = async (record: PreEntryRecord, value: Checkpoint) => {
      const key = keyOf(record);
      await writeFishPreference(key, value);
      checkpoints.current.set(key, value);
      // Keep receipts visible to a concurrently open 630 page using a legacy watch.
      if (readLocal<Settings>(configKey)) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* IndexedDB is the durable source. */ }
      }
      setRevision(revision => revision + 1);
    };
    const lock = (name: string, callback: () => Promise<void>) => navigator.locks
      ? navigator.locks.request(name, { ifAvailable: true }, found => found ? callback() : undefined)
      : callback();

    const send = () => {
      if (mailing || lifetime.signal.aborted) return;
      const { config } = current.current.notify;
      if (!config.enabled || fishNotifyMissing(config)) return;
      const next = current.current.entries.find(({record}) => {
        const checkpoint = read(record);
        return checkpoint?.alert && !checkpoint.delivered && (checkpoint.nextMailAt ?? 0) <= Date.now();
      });
      if (!next) return;
      mailing = true;
      void lock(screenedFishMailLock(owner), async () => {
        const { record, round } = next;
        await refresh([record]);
        const checkpoint = read(record);
        if (lifetime.signal.aborted || !checkpoint?.alert || checkpoint.delivered || (checkpoint.nextMailAt ?? 0) > Date.now()) return;
        const live = current.current.notify;
        if (!live.config.enabled || fishNotifyMissing(live.config)) return;
        const sent = new Set(checkpoint.sent);
        const recipients = live.config.emails.filter(email => !sent.has(email));
        if (!recipients.length) { await save(record, { ...checkpoint, delivered: true }); return; }
        // Keep a recovery delay for a tab that closes after requesting an email.
        const inFlight = { ...checkpoint, nextMailAt: Date.now() + 60_000 };
        await save(record, inFlight);
        const ok = await live.sendCdaAlert(record, round, checkpoint.alert, recipients, {
          signal: lifetime.signal,
          onRecipient: async email => { sent.add(email); await save(record, { ...inFlight, sent: [...sent] }); },
        });
        if (lifetime.signal.aborted) return;
        const failures = (checkpoint.failures ?? 0) + 1;
        await save(record, ok ? { ...checkpoint, delivered: true, sent: [...sent] }
          : { ...checkpoint, sent: [...sent], failures, nextMailAt: Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(failures - 1, 4)) });
      }).catch(() => { if (!lifetime.signal.aborted) setError('CDA 邮件待重试'); })
        .finally(() => { mailing = false; });
    };

    // Re-read open legacy watches from their original start to recover either
    // condition already reached. Confirmed sales and delivery receipts stay as saved.
    const start = (record: PreEntryRecord) => initialCursor(record, autoPositions ? { ...settings, enabledAt: 0 } : settings);
    const cursor = (record: PreEntryRecord, checkpoint?: Checkpoint) => !autoPositions || checkpoint?.progress?.version === SCREENED_CDA_GUARD_RULE
      ? checkpoint?.after ?? start(record) : start(record);
    const eligible = (entry: ScreenedFishAdmission, target: number) => {
      const checkpoint = read(entry.record);
      return !checkpoint?.alert && (retry.get(entry.record.id) ?? 0) <= Date.now()
        && cursor(entry.record, checkpoint) < target;
    };
    const tick = () => {
      send();
      if (scanning || lifetime.signal.aborted || navigator.onLine === false) return;
      const target = Math.floor((Date.now() - CLOSE_GRACE_MS) / SCREENED_CDA_STEP) * SCREENED_CDA_STEP;
      const due = current.current.entries.filter(entry => eligible(entry, target));
      if (!due.length) return;
      scanning = true;
      void lock(configKey + ':scan', async () => {
        // The admission record must be durable before its first CDA evaluation.
        await refresh(due.map(entry => entry.record));
        const work = await Promise.all(due.filter(entry => eligible(entry, target)).map(async entry => {
          const { record, round } = entry;
          const checkpoint = read(record);
          try {
            if (!checkpoint) {
              const durable = await readAutomaticPreEntryCheckpoint(owner, round.id);
              const match = durable?.records.find(saved => saved.id === record.id && saved.status === 'matched');
              if (!match || (!autoPositions && match.updatedAt < settings.enabledAt)) {
                retry.set(record.id, Date.now() + 5000);
                return;
              }
            }
            return { id: record.id, source: record.sample.source, after: cursor(record, checkpoint),
              ...(autoPositions ? { observeAfter: record.matchedAt!, progress: checkpoint?.progress } : {}) };
          } catch {
            retry.set(record.id, Date.now() + 5000);
            errors.set(record.id, record.sample.source.symbol + ' · 等待入选记录恢复');
            setError(errors.values().next().value ?? '');
            return;
          }
        }));
        if (lifetime.signal.aborted) return;
        const tasks = work.filter(task => task !== undefined);
        if (!tasks.length) return;
        const records = new Map(due.map(({ record }) => [record.id, record]));
        await readPageScreenedCda(tasks, settings.snapshot, target, lifetime.signal, async (id, result, cause) => {
          if (lifetime.signal.aborted) return;
          const record = records.get(id);
          if (!record) return;
          if (!result) {
            retry.set(id, Date.now() + 5000);
            errors.set(id, record.sample.source.symbol + ' · ' + (cause instanceof Error ? cause.message : '等待 CDA 行情'));
            setError(errors.values().next().value ?? '');
            return;
          }
          retry.delete(id);
          if (errors.delete(id)) setError(errors.values().next().value ?? '');
          if (result.through > cursor(record, read(record))) {
            await save(record, { after: result.through, alert: result.trigger, progress: result.progress });
            if (result.trigger) {
              changes.current?.postMessage('alert');
              send();
            }
          }
        });
      }).catch(cause => {
        if (!lifetime.signal.aborted) {
          for (const {record} of due) retry.set(record.id, Date.now() + 5000);
          setError(cause instanceof Error ? cause.message : 'CDA 行情待重试');
        }
      }).finally(() => { scanning = false; });
    };
    manual.current = async input => {
      const perform = async () => {
        const key = jobPrefix + encodeURIComponent(input.recordId);
        const [saved] = await readFishPreferences<Checkpoint>([key]);
        if (validScreenedSale(saved?.alert ?? checkpoints.current.get(key)?.alert ?? readLocal<Checkpoint>(key)?.alert)) throw Error('这笔仓位已经卖出');
        const mark = await markPageInstantPosition(input, lifetime.signal);
        if (lifetime.signal.aborted) throw Error('平仓已取消');
        const value = { after: mark.at, alert: { at: Math.max(mark.at, input.buyAt + 1, Date.now()), closePrice: mark.price,
          evidence: { version: SCREENED_CDA_GUARD_RULE, reason: 'manual' as const, priceAt: mark.at } } };
        await writeFishPreference(key, value);
        checkpoints.current.set(key, value);
        changes.current?.postMessage('alert');
        setRevision(revision => revision + 1);
        await saveInstantCampaignInput(owner, { ...input, sell: value.alert }).catch(() => undefined);
        send();
      };
      if (navigator.locks) await navigator.locks.request(configKey + ':scan', { signal: lifetime.signal }, perform);
      else {
        if (scanning) throw Error('正在核对自动卖出，请稍后重试');
        scanning = true;
        try { await perform(); } finally { scanning = false; }
      }
    };
    wake.current = tick;
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      lifetime.abort();
      wake.current = undefined;
      manual.current = undefined;
      window.clearInterval(timer);
      window.removeEventListener('online', tick);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [configKey, jobPrefix, owner, activeSettings, autoPositions]);

  useEffect(() => { wake.current?.(); }, [entries, notify.config]);
  const counts = useMemo(() => {
    let active = 0, awaitingMail = 0;
    for (const { record } of entries) {
      const key = jobPrefix + encodeURIComponent(record.id);
      const checkpoint = checkpoints.current.get(key) ?? readLocal<Checkpoint>(key);
      if (!checkpoint?.alert) active++;
      else if (!checkpoint.delivered) awaitingMail++;
    }
    return { active, awaitingMail };
  }, [entries, jobPrefix, revision]);
  const alerts = useMemo(() => {
    const result = new Map<string, ScreenedCdaTrigger>();
    for (const { record } of [...(localSales ?? []), ...admitted]) {
      const key = jobPrefix + encodeURIComponent(record.id);
      const alert = (checkpoints.current.get(key) ?? readLocal<Checkpoint>(key))?.alert;
      if (validScreenedSale(alert)) result.set(record.id, alert);
    }
    return result;
  }, [admitted, localSales, jobPrefix, revision]);
  const mailIssue = settings && counts.awaitingMail ? !notify.config.enabled ? '邮件提醒已关闭' : fishNotifyMissing(notify.config) : '';
  return { enabled: !!activeSettings, closePosition, saving, error: error || mailIssue || '', setEnabled, alerts, admitted, localSales, hasSavedSales: !!owner && savedSales?.owner === owner, ...counts };
}
