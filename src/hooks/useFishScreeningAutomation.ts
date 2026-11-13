import { useCallback, useEffect, useRef, useState } from 'react';
import { signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { fishNotifyMissing } from '@/lib/fish/notify';
import { readPersistedStateRaw, subscribePersistedStateHydration, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { FISH_AUTOMATIC_SCREENING_KEY, readAutomaticScreeningSettings, selectedPreEntryPlan } from '@/lib/fish/preEntryActivePlan';
import { isAutomaticPreEntryRound, type PreEntrySettings } from '@/lib/fish/preEntryMonitor';
import type { QualityGroup } from '@/lib/fish/quality';
import { validatePreEntryThreeStage } from '@/lib/fish/preEntryThreeStage';
import { freezeSavedPlans, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { persistFishAccountPreference } from './useFishAccountSettings';
import { readAutomaticPreEntryCheckpoint } from '@/lib/fish/preEntryPersistence';
import type { AutomaticScreeningMatch } from './usePreEntryMonitor';
import type { FishQualityState } from './useFishQuality';
import type { useFishNotify } from './useFishNotify';

const MINUTE = 60_000;
const QUEUE_KEY = 'veil.fish-screening-queue.v1:';
const queuePrefix = (owner: string) => `${QUEUE_KEY}${encodeURIComponent(owner)}:`;
const isJobKey = (owner: string, key: string) => key.startsWith(queuePrefix(owner) + 'job:') || key.startsWith(queuePrefix(owner) + 'instant-job:');
export const screenedFishMailLock = (owner: string) => queuePrefix(owner) + 'mail';
interface Job {
  key: string;
  id: string;
  source: TradeSignal;
  settings?: PreEntrySettings;
  instantTrading?: true;
  nextCheckAt: number;
  nextMailAt?: number;
  matched?: true;
  mailFailures?: number;
  sent?: string[];
  failures?: number;
  runner?: string;
}

function readJob(key: string): Job | undefined {
  try {
    const value = JSON.parse(readPersistedStateRaw(key) ?? 'null');
    return value?.source && value.key === key && typeof value.id === 'string' ? value as Job : undefined;
  } catch { return undefined; }
}

function readQueue(owner: string): Job[] {
  try {
    return Object.keys(localStorage).filter(key => isJobKey(owner, key))
      .map(readJob).filter((job): job is Job => !!job);
  } catch { return []; }
}

type Monitor = NonNullable<FishQualityState['preEntry']>;

/** The authenticated app shell owns capture work and email receipts across panel changes. */
export function useFishScreeningAutomation(owner: string | undefined, ready: boolean, monitor: Monitor | undefined, notify: ReturnType<typeof useFishNotify>) {
  const [saved, setSaved] = useState(() => ({ owner, value: owner ? readAutomaticScreeningSettings(owner) : undefined }));
  const settings = saved.owner === owner ? saved.value : owner ? readAutomaticScreeningSettings(owner) : undefined;
  useEffect(() => {
    if (!owner) return;
    const key = getUserPrefix(owner) + FISH_AUTOMATIC_SCREENING_KEY;
    const refresh = () => setSaved({ owner, value: readAutomaticScreeningSettings(owner) });
    const onStorage = (event: StorageEvent) => { if (event.key === key) refresh(); };
    const unsubscribe = subscribePersistedStateHydration(key, refresh);
    window.addEventListener('storage', onStorage);
    refresh();
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, [owner]);

  const saveSettings = useCallback(async (plans: QualityGroup[], hours: number) => {
    if (!owner) throw Error('请先登录后保存筛选鱼条件');
    if (!Number.isFinite(hours) || hours <= 0 || hours > 8784) throw Error('单标的筛选时限须大于 0 且不超过 8784 小时');
    if (plans.length !== 1 || !plans[0].preEntryThreeStage) throw Error('请保存一套三阶筛选方案');
    validatePreEntryThreeStage(plans[0].preEntryThreeStage);
    const previous = readAutomaticScreeningSettings(owner);
    const frozen = structuredClone(freezeSavedPlans(previous?.plans, plans));
    if (planVersionChanges(frozen[0]).length) throw Error('冻结的算法版本已变化，请保留原方案并使用可执行的副本');
    await persistFishAccountPreference(owner, FISH_AUTOMATIC_SCREENING_KEY, {
      plans: frozen, hours, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
    } satisfies PreEntrySettings);
  }, [owner]);

  const [jobs, setJobs] = useState<Job[]>(() => owner ? readQueue(owner) : []);
  const pauseKey = owner ? queuePrefix(owner) + 'paused' : '';
  const [paused, setPaused] = useState(() => !!pauseKey && readPersistedStateRaw(pauseKey) === '1');
  const [storageIssue, setStorageIssue] = useState(false);
  const current = useRef({ jobs, ready, monitor, notify, paused });
  current.current = { jobs, ready, monitor, notify, paused };
  const busy = useRef({ scan: false, mail: false });
  const wake = useRef<() => void>();
  const tab = useRef<string>();
  if (!tab.current) tab.current = crypto.randomUUID();

  const save = useCallback((job: Job, done = false) => {
    const durable = writePersistedStateRaw(job.key, JSON.stringify(done ? { done: true } : job));
    if (!durable) setStorageIssue(true);
    const previous = current.current.jobs;
    const next = done ? previous.filter(value => value.key !== job.key)
      : previous.some(value => value.key === job.key) ? previous.map(value => value.key === job.key ? job : value) : [...previous, job];
    current.current.jobs = next;
    setJobs(next);
    return durable;
  }, []);

  const enqueue = useCallback((source: TradeSignal) => {
    if (!owner) return;
    const identity = encodeURIComponent(signalDedupKey(source));
    const legacyKey = queuePrefix(owner) + 'job:' + identity;
    const instantKey = queuePrefix(owner) + 'instant-job:' + identity;
    if (readPersistedStateRaw(legacyKey) != null || readPersistedStateRaw(instantKey) != null) return;
    const monitor = current.current.monitor;
    const settings = readAutomaticScreeningSettings(owner) ?? (monitor?.ready ? monitor.library.settings : undefined);
    const job: Job = { key: instantKey, id: 'pre-entry-auto-' + identity, source, nextCheckAt: 0,
      settings: selectedPreEntryPlan(settings?.plans) ? settings : undefined, instantTrading: true };
    // Earlier tabs only understand the legacy queue and its done receipts.
    const durable = save(job);
    if (durable && !writePersistedStateRaw(legacyKey, JSON.stringify({ done: true }))) setStorageIssue(true);
    wake.current?.();
  }, [owner, save]);

  const setAutoPaused = useCallback((value: boolean) => {
    if (!pauseKey) return;
    if (!writePersistedStateRaw(pauseKey, value ? '1' : '0')) setStorageIssue(true);
    current.current.paused = value;
    setPaused(value);
    if (value) current.current.monitor?.pauseAutomatic?.();
    if (!value) for (const entry of current.current.jobs) {
      const job = readJob(entry.key);
      if (job) save({ ...job, nextCheckAt: 0 });
    }
    if (!value) wake.current?.();
  }, [pauseKey, save]);

  useEffect(() => {
    if (!owner) return;
    setJobs(readQueue(owner));
    setPaused(readPersistedStateRaw(pauseKey) === '1');
    const lifetime = new AbortController();
    const refresh = (event: StorageEvent) => {
      if (event.key === pauseKey) {
        const next = readPersistedStateRaw(pauseKey) === '1';
        current.current.paused = next;
        setPaused(next);
        if (next) current.current.monitor?.pauseAutomatic?.();
      }
      if (!event.key || isJobKey(owner, event.key)) {
        current.current.jobs = readQueue(owner);
        setJobs(current.current.jobs);
      }
      if (!event.key || event.key === pauseKey || isJobKey(owner, event.key)) wake.current?.();
    };
    window.addEventListener('storage', refresh);
    const exclusive = async (kind: 'scan' | 'mail', run: () => Promise<boolean | void>) => {
      if (busy.current[kind] || lifetime.signal.aborted) return;
      busy.current[kind] = true;
      let advanced: boolean | void = undefined;
      try {
        advanced = navigator.locks
          ? await navigator.locks.request(kind === 'mail' ? screenedFishMailLock(owner) : queuePrefix(owner) + kind, { ifAvailable: true }, lock => lock ? run() : undefined)
          : await run();
      } catch {
        if (!lifetime.signal.aborted) setStorageIssue(true);
      } finally {
        busy.current[kind] = false;
        if (advanced && !lifetime.signal.aborted) queueMicrotask(() => wake.current?.());
      }
    };
    const mail = (entry: Job, match?: AutomaticScreeningMatch) => {
      const config = current.current.notify.config;
      if (config.enabled && fishNotifyMissing(config)) return;
      void exclusive('mail', async () => {
        const job = readJob(entry.key);
        if (!job || (job.nextMailAt ?? 0) > Date.now() || lifetime.signal.aborted) return;
        const saved = match ? undefined : await readAutomaticPreEntryCheckpoint(owner, job.id);
        const round = match?.round ?? saved?.rounds[0], record = match?.record ?? saved?.records[0];
        if (!round || round.id !== job.id || !isAutomaticPreEntryRound(round) || record?.roundId !== job.id || record.status !== 'matched'
          || !Number.isFinite(record.matchedAt) || record.matchedAt! <= 0 || lifetime.signal.aborted) return;
        const live = current.current.notify;
        if (!live.config.enabled) { save(job, true); return true; }
        if (fishNotifyMissing(live.config)) return;
        const sent = new Set(job.sent);
        const recipients = live.config.emails.filter(recipient => !sent.has(recipient));
        if (!recipients.length) { save(job, true); return true; }
        // Keep a recovery delay if the tab closes during an unacknowledged request.
        save({ ...job, matched: true, nextMailAt: Date.now() + MINUTE });
        const delivered = await live.sendAdmission(record, round, recipients, {
          signal: lifetime.signal,
          onRecipient: recipient => {
            sent.add(recipient);
            const latest = readJob(job.key);
            if (latest) save({ ...latest, sent: [...sent], nextMailAt: Date.now() + MINUTE });
          },
        });
        if (lifetime.signal.aborted) return;
        const latest = readJob(job.key);
        if (!latest) return;
        if (delivered) save(latest, true);
        else {
          const mailFailures = (latest.mailFailures ?? 0) + 1;
          save({ ...latest, mailFailures, nextMailAt: Date.now() + Math.min(MINUTE, 5000 * 2 ** Math.min(mailFailures - 1, 4)) });
        }
        return true;
      });
    };
    const tick = () => {
      const { jobs, ready, monitor, paused } = current.current;
      if (!ready || !monitor?.ready || !jobs.length || lifetime.signal.aborted) return;
      const ids = new Set(jobs.map(job => job.id));
      const records = new Map(monitor.library.records.filter(record => ids.has(record.roundId)).map(record => [record.roundId, record]));
      const now = Date.now();
      for (const job of jobs) {
        const record = records.get(job.id);
        if (!monitor.automaticRunning && (record?.status === 'unmatched' || record?.status === 'warming')) save(job, true);
      }
      const next = jobs.filter(job => !job.matched && job.nextCheckAt <= now && (!records.has(job.id) || ['queued', 'paused', 'error', 'matched'].includes(records.get(job.id)!.status)))
        .reduce<Job | undefined>((first, job) => !first || job.nextCheckAt < first.nextCheckAt ? job : first, undefined);
      if (next && !paused && !(monitor.automaticRunning ?? monitor.running) && (records.has(next.id) || (next.settings ?? readAutomaticScreeningSettings(owner) ?? monitor.library.settings)?.plans.length)) void exclusive('scan', async () => {
        const job = readJob(next.key);
        const active = current.current.monitor;
        if (!job || job.matched || job.nextCheckAt > Date.now() || !active?.startAutomatic
          || (active.automaticRunning ?? active.running) || current.current.paused || lifetime.signal.aborted) return;
        // Persist the next attempt before starting, so a reload can safely resume the same frozen round.
        const settings = job.settings ?? readAutomaticScreeningSettings(owner) ?? active.library.settings;
        save({ ...job, settings: selectedPreEntryPlan(settings?.plans) ? settings : undefined,
          runner: tab.current, nextCheckAt: Date.now() + MINUTE });
        await active.startAutomatic(job.id, job.source, !!job.runner && job.runner !== tab.current, match => {
          const latest = readJob(job.key);
          if (!latest || lifetime.signal.aborted) return;
          const matched = { ...latest, matched: true as const };
          save(matched);
          mail(matched, match);
        }, settings, job.instantTrading);
        if (lifetime.signal.aborted) return;
        const saved = readJob(job.key);
        if (!saved) return;
        const record = current.current.monitor?.library.records.find(record => record.roundId === job.id);
        const failures = record?.status === 'error' ? (job.failures ?? 0) + 1 : 0;
        const nextClose = (Math.floor(Date.now() / MINUTE) + 1) * MINUTE + 2000;
        save({ ...saved, failures, nextCheckAt: failures ? Date.now() + Math.min(15, 2 ** Math.min(failures, 4)) * MINUTE : nextClose });
        return true;
      });
      const pendingMail = jobs.find(job => (job.nextMailAt ?? 0) <= now && (job.matched || records.get(job.id)?.status === 'matched'));
      if (pendingMail) mail(pendingMail);
    };
    wake.current = tick;
    const timer = setInterval(tick, 1200);
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      lifetime.abort();
      wake.current = undefined;
      clearInterval(timer);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('online', tick);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [owner, pauseKey, save]);
  useEffect(() => { wake.current?.(); }, [ready, monitor?.ready, monitor?.automaticRunning, monitor?.library.settings, settings, notify.config]);

  const matchedIds = jobs.length ? new Set(monitor?.library.records.filter(record => record.status === 'matched').map(record => record.roundId)) : undefined;
  const awaitingMail = jobs.filter(job => job.matched || matchedIds?.has(job.id)).length;
  const pending = jobs.length - awaitingMail;
  return { enqueue, paused, setAutoPaused, pending, awaitingMail: jobs.length - pending, storageIssue, settings, saveSettings };
}
