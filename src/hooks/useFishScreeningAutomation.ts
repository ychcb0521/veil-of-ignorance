import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { fishNotifyMissing } from '@/lib/fish/notify';
import { readPersistedStateRaw, subscribePersistedStateHydration, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { FISH_AUTOMATIC_SCREENING_KEY, readAutomaticScreeningSettings, selectedPreEntryPlan } from '@/lib/fish/preEntryActivePlan';
import { TURING_SCREENING_INITIALIZATION_VERSION } from '@/lib/fish/qualityInitialization';
import { isAutomaticPreEntryRound, type PreEntrySettings } from '@/lib/fish/preEntryMonitor';
import { isScreeningJob, readLocalScreeningQueue, readLocalScreeningValue, readScreeningQueue, readScreeningValue,
  screeningQueueJobKey, screeningQueuePrefix, writeScreeningQueueValue, type ScreeningJob as Job, type ScreeningQueueValue } from '@/lib/fish/screeningQueue';
import type { QualityGroup } from '@/lib/fish/quality';
import { validatePreEntryThreeStage } from '@/lib/fish/preEntryThreeStage';
import { freezeSavedPlans, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { persistFishAccountPreference } from './useFishAccountSettings';
import { readAutomaticPreEntryCheckpoint } from '@/lib/fish/preEntryPersistence';
import type { AutomaticScreeningMatch } from './usePreEntryMonitor';
import type { FishQualityState } from './useFishQuality';
import type { useFishNotify } from './useFishNotify';

const MINUTE = 60_000;
export const screenedFishMailLock = (owner: string) => screeningQueuePrefix(owner) + 'mail';

function createQueueSession(owner?: string) {
  const prefix = owner ? screeningQueuePrefix(owner) : '';
  return {
    prefix,
    entries: prefix ? readLocalScreeningQueue(prefix) : new Map<string, ScreeningQueueValue>(),
    pendingWrites: new Map<string, ScreeningQueueValue>(),
    failedWrites: new Set<string>(),
    ready: typeof indexedDB === 'undefined',
    channel: undefined as BroadcastChannel | undefined,
    tails: new Map<string, Promise<boolean>>(),
  };
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
    if (plans[0].initialization === TURING_SCREENING_INITIALIZATION_VERSION) throw Error('图灵杯方案适用于手动回放，请为新鱼选择常规筛选方案');
    validatePreEntryThreeStage(plans[0].preEntryThreeStage);
    const previous = readAutomaticScreeningSettings(owner);
    const frozen = structuredClone(freezeSavedPlans(previous?.plans, plans));
    if (planVersionChanges(frozen[0]).length) throw Error('冻结的算法版本已变化，请保留原方案并使用可执行的副本');
    await persistFishAccountPreference(owner, FISH_AUTOMATIC_SCREENING_KEY, {
      plans: frozen, hours, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
    } satisfies PreEntrySettings);
  }, [owner]);

  const queue = useMemo(() => createQueueSession(owner), [owner]);
  const { prefix } = queue;
  const pauseKey = prefix ? prefix + 'paused' : '';
  const [paused, setPaused] = useState(() => !!pauseKey && readPersistedStateRaw(pauseKey) === '1');
  const [storageIssue, setStorageIssue] = useState(false);
  const [attemptIssues, setAttemptIssues] = useState({ scan: '', mail: '' });
  const [jobs, setJobs] = useState(() => [...queue.entries.values()].filter(isScreeningJob));
  const current = useRef({ ready, monitor, notify, paused });
  current.current = { ready, monitor, notify, paused };
  const currentQueue = useRef(queue);
  currentQueue.current = queue;
  const wake = useRef<(resume?: boolean) => void>();
  const tab = useRef<string>();
  if (!tab.current) tab.current = crypto.randomUUID();

  const publish = useCallback(() => {
    if (currentQueue.current !== queue) return;
    setJobs([...queue.entries.values()].filter(isScreeningJob));
    setStorageIssue(queue.failedWrites.size > 0);
  }, [queue]);

  const persist = useCallback((key: string, value: ScreeningQueueValue) => {
    const previous = queue.tails.get(key);
    const write = async () => {
      if (queue.pendingWrites.get(key) !== value) return false;
      const durable = await writeScreeningQueueValue(prefix, key, value);
      if (queue.pendingWrites.get(key) === value) {
        if (durable) {
          queue.pendingWrites.delete(key);
          queue.failedWrites.delete(key);
          try { queue.channel?.postMessage(key); } catch { /* Another tab can still recover on focus. */ }
        } else queue.failedWrites.add(key);
        publish();
      }
      return durable;
    };
    const task = previous ? previous.then(write) : write();
    queue.tails.set(key, task);
    void task.then(() => { if (queue.tails.get(key) === task) queue.tails.delete(key); });
    return task;
  }, [queue, prefix, publish]);

  const save = useCallback((job: Job, done = false) => {
    const revision = Math.max(Date.now(), (queue.entries.get(job.key)?.revision ?? 0) + 1);
    const value: ScreeningQueueValue = done ? { done: true, revision } : { ...job, revision };
    queue.entries.set(job.key, value);
    queue.pendingWrites.set(job.key, value);
    publish();
    return persist(job.key, value);
  }, [queue, publish, persist]);

  const enqueue = useCallback((source: TradeSignal) => {
    if (!owner) return;
    const identity = encodeURIComponent(signalDedupKey(source));
    const legacyKey = prefix + 'job:' + identity;
    const instantKey = prefix + 'instant-job:' + identity;
    const monitor = current.current.monitor;
    const settings = readAutomaticScreeningSettings(owner) ?? (monitor?.ready ? monitor.library.settings : undefined);
    const job: Job = { key: instantKey, id: 'pre-entry-auto-' + identity, source, nextCheckAt: 0,
      settings: selectedPreEntryPlan(settings?.plans) ? settings : undefined, instantTrading: true };
    const add = async () => {
      if (queue.entries.has(legacyKey) || queue.entries.has(instantKey)) return;
      if (readLocalScreeningValue(legacyKey) || readLocalScreeningValue(instantKey)) return;
      const prior = typeof indexedDB === 'undefined' ? [] : await Promise.all([readScreeningValue(legacyKey), readScreeningValue(instantKey)]);
      if (prior.some(Boolean) || queue.entries.has(instantKey)) return;
      await save(job);
    };
    const lock = navigator.locks;
    const added = lock ? lock.request(instantKey + ':enqueue', add).catch(add) : add();
    void added.then(() => { if (currentQueue.current === queue) wake.current?.(); });
  }, [owner, prefix, queue, save]);

  const setAutoPaused = useCallback((value: boolean) => {
    if (!pauseKey) return;
    const durable = writePersistedStateRaw(pauseKey, value ? '1' : '0');
    if (durable) queue.failedWrites.delete(pauseKey); else queue.failedWrites.add(pauseKey);
    publish();
    current.current.paused = value;
    setPaused(value);
    if (value) current.current.monitor?.pauseAutomatic?.();
    if (!value) queueMicrotask(() => wake.current?.(true));
  }, [pauseKey, queue, publish]);

  useEffect(() => {
    if (!owner) return;
    const initialPause = readPersistedStateRaw(pauseKey) === '1';
    current.current.paused = initialPause;
    setPaused(initialPause);
    setAttemptIssues({ scan: '', mail: '' });
    publish();
    const lifetime = new AbortController();
    const busy = { scan: false, mail: false };
    const refreshKey = async (key: string) => {
      const value = await readScreeningValue(key);
      if (lifetime.signal.aborted || queue.pendingWrites.has(key)) return;
      if (value && (value.revision ?? 0) >= (queue.entries.get(key)?.revision ?? 0)) {
        queue.entries.set(key, value);
        publish();
      }
      wake.current?.();
    };
    let loading = false, queueReadFailed = false;
    const hydrate = async () => {
      if (loading || lifetime.signal.aborted) return;
      loading = true;
      try {
        for (const [key, value] of await readScreeningQueue(prefix)) {
          if (lifetime.signal.aborted) return;
          if (!queue.pendingWrites.has(key) && (value.revision ?? 0) >= (queue.entries.get(key)?.revision ?? 0)) queue.entries.set(key, value);
        }
        queueReadFailed = false;
      } catch { queueReadFailed = true; }
      finally {
        loading = false;
        if (!lifetime.signal.aborted) {
          queue.ready = true;
          publish();
          wake.current?.();
        }
      }
    };
    try {
      queue.channel = new BroadcastChannel(prefix);
      queue.channel.onmessage = event => {
        if (typeof event.data === 'string' && screeningQueueJobKey(prefix, event.data)) void refreshKey(event.data);
      };
    } catch { /* Existing tabs can also signal changes through local storage. */ }
    const refresh = (event: StorageEvent) => {
      if (event.key === pauseKey) {
        const next = readPersistedStateRaw(pauseKey) === '1';
        current.current.paused = next;
        setPaused(next);
        if (next) current.current.monitor?.pauseAutomatic?.();
        else wake.current?.(true);
      }
      if (!event.key) void hydrate();
      else if (screeningQueueJobKey(prefix, event.key)) void refreshKey(event.key);
    };
    window.addEventListener('storage', refresh);
    const readJob = async (key: string) => {
      const stored = await readScreeningValue(key);
      const previous = queue.entries.get(key);
      const value = queue.pendingWrites.get(key) ?? (stored && (stored.revision ?? 0) >= (previous?.revision ?? 0) ? stored : previous);
      if (value && value !== previous) {
        queue.entries.set(key, value);
        publish();
      }
      return isScreeningJob(value) ? value : undefined;
    };
    const exclusive = async (kind: 'scan' | 'mail', run: () => Promise<boolean | void>) => {
      if (busy[kind] || lifetime.signal.aborted) return;
      busy[kind] = true;
      let advanced: boolean | void = undefined;
      try {
        advanced = navigator.locks
          ? await navigator.locks.request(kind === 'mail' ? screenedFishMailLock(owner) : prefix + kind, { ifAvailable: true }, lock => lock ? run() : undefined)
          : await run();
      } catch {
        if (!lifetime.signal.aborted) setAttemptIssues(issues => ({ ...issues, [kind]: kind === 'scan' ? '筛选处理中断，将自动重试' : '入选通知待重试' }));
      } finally {
        busy[kind] = false;
        if (advanced && !lifetime.signal.aborted) queueMicrotask(() => wake.current?.());
      }
    };
    const mail = (entry: Job, match?: AutomaticScreeningMatch) => {
      const config = current.current.notify.config;
      if (config.enabled && fishNotifyMissing(config)) return;
      void exclusive('mail', async () => {
        const job = await readJob(entry.key);
        if (!job || (job.nextMailAt ?? 0) > Date.now() || lifetime.signal.aborted) return;
        const saved = match ? undefined : await readAutomaticPreEntryCheckpoint(owner, job.id);
        const round = match?.round ?? saved?.rounds[0], record = match?.record ?? saved?.records[0];
        if (!round || round.id !== job.id || round.state !== 'complete' || !isAutomaticPreEntryRound(round) || record?.roundId !== job.id || record.status !== 'matched'
          || !Number.isFinite(record.matchedAt) || record.matchedAt! <= 0 || lifetime.signal.aborted) return;
        const live = current.current.notify;
        if (!live.config.enabled) { await save(job, true); setAttemptIssues(issues => issues.mail ? { ...issues, mail: '' } : issues); return true; }
        if (fishNotifyMissing(live.config)) return;
        const sent = new Set(job.sent);
        const recipients = live.config.emails.filter(recipient => !sent.has(recipient));
        if (!recipients.length) { await save(job, true); return true; }
        // Keep a recovery delay if the tab closes during an unacknowledged request.
        if (!await save({ ...job, matched: true, nextMailAt: Date.now() + MINUTE })) return;
        if (lifetime.signal.aborted) return;
        const delivered = await live.sendAdmission(record, round, recipients, {
          signal: lifetime.signal,
          onRecipient: async recipient => {
            sent.add(recipient);
            const latest = await readJob(job.key);
            if (latest && !await save({ ...latest, sent: [...sent], nextMailAt: Date.now() + MINUTE })) throw Error('邮件回执保存待重试');
          },
        });
        if (lifetime.signal.aborted) return;
        const latest = await readJob(job.key);
        if (!latest) return;
        if (delivered) { await save(latest, true); setAttemptIssues(issues => issues.mail ? { ...issues, mail: '' } : issues); }
        else {
          const mailFailures = (latest.mailFailures ?? 0) + 1;
          await save({ ...latest, mailFailures, nextMailAt: Date.now() + Math.min(MINUTE, 5000 * 2 ** Math.min(mailFailures - 1, 4)) });
        }
        return true;
      });
    };
    let retryAt = 0;
    const resumeJobs = new Set<string>();
    const tick = (resumeNow = false) => {
      if (lifetime.signal.aborted) return;
      if (resumeNow) for (const [key, value] of queue.entries) if (isScreeningJob(value)) resumeJobs.add(key);
      const now = Date.now();
      if (now >= retryAt && (queue.failedWrites.size || queueReadFailed)) {
        retryAt = now + 5000;
        if (queueReadFailed) void hydrate();
        for (const key of queue.failedWrites) {
          if (key === pauseKey) {
            if (writePersistedStateRaw(key, current.current.paused ? '1' : '0')) { queue.failedWrites.delete(key); publish(); }
          } else {
            const value = queue.pendingWrites.get(key);
            if (value && !queue.tails.has(key)) void persist(key, value);
          }
        }
      }
      const { ready, monitor, paused } = current.current;
      if (!queue.ready || !ready || !monitor?.ready) return;
      const jobs = [...queue.entries.values()].filter(isScreeningJob);
      if (!jobs.length) return;
      const ids = new Set(jobs.map(job => job.id));
      const records = new Map(monitor.library.records.filter(record => ids.has(record.roundId)).map(record => [record.roundId, record]));
      const completed = new Set(monitor.library.rounds.filter(round => ids.has(round.id) && round.state === 'complete').map(round => round.id));
      const defaultSettings = readAutomaticScreeningSettings(owner) ?? monitor.library.settings;
      const next = jobs.filter(job => !job.matched && (resumeJobs.has(job.key) || job.nextCheckAt <= now)
        && (records.has(job.id) || (job.settings ?? defaultSettings)?.plans.length))
        .reduce<Job | undefined>((first, job) => !first || job.nextCheckAt < first.nextCheckAt ? job : first, undefined);
      if (next && !paused && !(monitor.automaticRunning ?? monitor.running)) void exclusive('scan', async () => {
        const job = await readJob(next.key);
        const active = current.current.monitor;
        if (!job || job.matched || !resumeJobs.has(job.key) && job.nextCheckAt > Date.now() || !active?.startAutomatic
          || (active.automaticRunning ?? active.running) || current.current.paused || lifetime.signal.aborted) return;
        // Persist the next attempt before starting, so a reload can safely resume the same frozen round.
        const settings = job.settings ?? readAutomaticScreeningSettings(owner) ?? active.library.settings;
        resumeJobs.delete(job.key);
        await save({ ...job, settings: selectedPreEntryPlan(settings?.plans) ? settings : undefined,
          runner: tab.current, nextCheckAt: Date.now() + MINUTE });
        if (lifetime.signal.aborted || current.current.paused) return;
        let matchedWrite: Promise<boolean> | undefined;
        await active.startAutomatic(job.id, job.source, !!job.runner && job.runner !== tab.current, match => {
          const latest = queue.entries.get(job.key);
          if (!isScreeningJob(latest) || lifetime.signal.aborted) return;
          matchedWrite = save({ ...latest, matched: true });
          void matchedWrite.then(() => mail(job, match));
        }, settings, job.instantTrading);
        if (lifetime.signal.aborted) return;
        setAttemptIssues(issues => issues.scan ? { ...issues, scan: '' } : issues);
        if (matchedWrite) { await matchedWrite; return true; }
        const saved = await readJob(job.key);
        if (!saved || saved.matched) return true;
        const checkpoint = typeof indexedDB === 'undefined' ? undefined : await readAutomaticPreEntryCheckpoint(owner, job.id);
        const record = checkpoint?.records[0] ?? current.current.monitor?.library.records.find(record => record.roundId === job.id);
        if ((record?.status === 'unmatched' || record?.status === 'warming') && (checkpoint || typeof indexedDB === 'undefined')) {
          await save(saved, true);
          return true;
        }
        const failures = record?.status === 'error' ? (job.failures ?? 0) + 1 : 0;
        const nextClose = (Math.floor(Date.now() / MINUTE) + 1) * MINUTE + 2000;
        await save({ ...saved, failures, nextCheckAt: failures ? Date.now() + Math.min(15, 2 ** Math.min(failures, 4)) * MINUTE : nextClose });
        return true;
      });
      const pendingMail = jobs.find(job => (job.nextMailAt ?? 0) <= now && (job.matched || completed.has(job.id) && records.get(job.id)?.status === 'matched'));
      if (pendingMail) mail(pendingMail);
    };
    wake.current = tick;
    const poll = () => tick();
    const refreshAndPoll = () => { void hydrate(); tick(); };
    const timer = setInterval(poll, 1200);
    window.addEventListener('online', refreshAndPoll);
    window.addEventListener('focus', refreshAndPoll);
    document.addEventListener('visibilitychange', poll);
    void hydrate();
    tick();
    return () => {
      lifetime.abort();
      wake.current = undefined;
      clearInterval(timer);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('online', refreshAndPoll);
      window.removeEventListener('focus', refreshAndPoll);
      document.removeEventListener('visibilitychange', poll);
      queue.channel?.close();
      queue.channel = undefined;
    };
  }, [owner, pauseKey, persist, prefix, publish, queue, save]);
  useEffect(() => { wake.current?.(); }, [ready, monitor?.ready, monitor?.automaticRunning, monitor?.library.settings, paused, settings, notify.config]);

  const matchedIds = useMemo(() => {
    if (!jobs.length || !monitor) return undefined;
    const complete = new Set(monitor.library.rounds.filter(round => round.state === 'complete').map(round => round.id));
    return new Set(monitor.library.records.filter(record => record.status === 'matched' && complete.has(record.roundId)).map(record => record.roundId));
  }, [jobs.length, monitor?.library]);
  const awaitingMail = jobs.filter(job => job.matched || matchedIds?.has(job.id)).length;
  const pending = jobs.length - awaitingMail;
  return { enqueue, paused, setAutoPaused, pending, awaitingMail: jobs.length - pending, storageIssue, attemptIssue: attemptIssues.scan || attemptIssues.mail, settings, saveSettings };
}
