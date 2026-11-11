import { useCallback, useEffect, useRef, useState } from 'react';
import { signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { fishNotifyMissing } from '@/lib/fish/notify';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { readAutomaticPreEntryCheckpoint } from '@/lib/fish/preEntryPersistence';
import type { FishQualityState } from './useFishQuality';
import type { useFishNotify } from './useFishNotify';

const MINUTE = 60_000;
const QUEUE_KEY = 'veil.fish-screening-queue.v1:';
const queuePrefix = (owner: string) => `${QUEUE_KEY}${encodeURIComponent(owner)}:`;
interface Job {
  key: string;
  id: string;
  source: TradeSignal;
  nextCheckAt: number;
  nextMailAt?: number;
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
    return Object.keys(localStorage).filter(key => key.startsWith(queuePrefix(owner) + 'job:'))
      .map(readJob).filter((job): job is Job => !!job);
  } catch { return []; }
}

type Monitor = NonNullable<FishQualityState['preEntry']>;

/** The authenticated app shell owns capture work and email receipts across panel changes. */
export function useFishScreeningAutomation(owner: string | undefined, ready: boolean, monitor: Monitor | undefined, notify: ReturnType<typeof useFishNotify>) {
  const [jobs, setJobs] = useState<Job[]>(() => owner ? readQueue(owner) : []);
  const pauseKey = owner ? queuePrefix(owner) + 'paused' : '';
  const [paused, setPaused] = useState(() => !!pauseKey && readPersistedStateRaw(pauseKey) === '1');
  const [storageIssue, setStorageIssue] = useState(false);
  const current = useRef({ jobs, ready, monitor, notify, paused });
  current.current = { jobs, ready, monitor, notify, paused };
  const busy = useRef({ scan: false, mail: false });
  const tab = useRef<string>();
  if (!tab.current) tab.current = crypto.randomUUID();

  const save = useCallback((job: Job, done = false) => {
    if (!writePersistedStateRaw(job.key, JSON.stringify(done ? { done: true } : job))) setStorageIssue(true);
    const previous = current.current.jobs;
    const next = done ? previous.filter(value => value.key !== job.key)
      : previous.some(value => value.key === job.key) ? previous.map(value => value.key === job.key ? job : value) : [...previous, job];
    current.current.jobs = next;
    setJobs(next);
  }, []);

  const enqueue = useCallback((source: TradeSignal) => {
    if (!owner) return;
    const identity = encodeURIComponent(signalDedupKey(source));
    const key = queuePrefix(owner) + 'job:' + identity;
    if (readPersistedStateRaw(key) != null) return;
    save({ key, id: 'pre-entry-auto-' + identity, source, nextCheckAt: 0 });
  }, [owner, save]);

  const setAutoPaused = useCallback((value: boolean) => {
    if (!pauseKey) return;
    if (!writePersistedStateRaw(pauseKey, value ? '1' : '0')) setStorageIssue(true);
    setPaused(value);
    if (value && current.current.monitor?.automaticRunning) current.current.monitor.pause();
    if (!value) for (const entry of current.current.jobs) {
      const job = readJob(entry.key);
      if (job) save({ ...job, nextCheckAt: 0 });
    }
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
        if (next && current.current.monitor?.automaticRunning) current.current.monitor.pause();
      }
      if (!event.key || event.key.startsWith(queuePrefix(owner) + 'job:')) {
        current.current.jobs = readQueue(owner);
        setJobs(current.current.jobs);
      }
    };
    window.addEventListener('storage', refresh);
    const exclusive = async (kind: 'scan' | 'mail', run: () => Promise<void>) => {
      if (busy.current[kind] || lifetime.signal.aborted) return;
      busy.current[kind] = true;
      try {
        if (navigator.locks) await navigator.locks.request(queuePrefix(owner) + kind, { ifAvailable: true }, lock => lock ? run() : undefined);
        else await run();
      } catch {
        if (!lifetime.signal.aborted) setStorageIssue(true);
      } finally { busy.current[kind] = false; }
    };
    const tick = () => {
      const { jobs, ready, monitor, notify, paused } = current.current;
      if (!ready || !monitor?.ready || !jobs.length || lifetime.signal.aborted) return;
      const ids = new Set(jobs.map(job => job.id));
      const records = new Map(monitor.library.records.filter(record => ids.has(record.roundId)).map(record => [record.roundId, record]));
      const now = Date.now();
      for (const job of jobs) {
        const record = records.get(job.id);
        if (!monitor.automaticRunning && (record?.status === 'unmatched' || record?.status === 'warming')) save(job, true);
      }
      const next = jobs.filter(job => job.nextCheckAt <= now && (!records.has(job.id) || ['queued', 'paused', 'error'].includes(records.get(job.id)!.status)))
        .reduce<Job | undefined>((first, job) => !first || job.nextCheckAt < first.nextCheckAt ? job : first, undefined);
      if (next && !paused && !monitor.running && (records.has(next.id) || monitor.library.settings?.plans.length)) void exclusive('scan', async () => {
        const job = readJob(next.key);
        const active = current.current.monitor;
        if (!job || job.nextCheckAt > Date.now() || !active?.startAutomatic || active.running || current.current.paused || lifetime.signal.aborted) return;
        // Persist the next attempt before starting, so a reload can safely resume the same frozen round.
        save({ ...job, runner: tab.current, nextCheckAt: Date.now() + MINUTE });
        await active.startAutomatic(job.id, job.source, !!job.runner && job.runner !== tab.current);
        if (lifetime.signal.aborted) return;
        const saved = readJob(job.key);
        if (!saved) return;
        const record = current.current.monitor?.library.records.find(record => record.roundId === job.id);
        const failures = record?.status === 'error' ? (job.failures ?? 0) + 1 : 0;
        const nextClose = (Math.floor(Date.now() / MINUTE) + 1) * MINUTE + 2000;
        save({ ...saved, failures, nextCheckAt: failures ? Date.now() + Math.min(15, 2 ** Math.min(failures, 4)) * MINUTE : nextClose });
      });
      const pendingMail = jobs.find(job => (job.nextMailAt ?? 0) <= now && records.get(job.id)?.status === 'matched');
      if (pendingMail && (!notify.config.enabled || !fishNotifyMissing(notify.config))) void exclusive('mail', async () => {
        const job = readJob(pendingMail.key);
        if (!job || (job.nextMailAt ?? 0) > Date.now() || lifetime.signal.aborted) return;
        const saved = await readAutomaticPreEntryCheckpoint(owner, job.id);
        const round = saved?.rounds[0], record = saved?.records[0];
        const live = current.current;
        if (!round || record?.status !== 'matched' || lifetime.signal.aborted) return;
        if (!live.notify.config.enabled) { save(job, true); return; }
        if (fishNotifyMissing(live.notify.config)) return;
        const sent = new Set(job.sent);
        const recipients = live.notify.config.emails.filter(recipient => !sent.has(recipient));
        if (!recipients.length) { save(job, true); return; }
        save({ ...job, nextMailAt: Date.now() + MINUTE });
        const delivered = await live.notify.sendAdmission(record, round, recipients, {
          signal: lifetime.signal,
          onRecipient: recipient => {
            sent.add(recipient);
            save({ ...job, sent: [...sent], nextMailAt: Date.now() + MINUTE });
          },
        });
        if (!lifetime.signal.aborted && delivered) save(job, true);
      });
    };
    const timer = setInterval(tick, 1200);
    tick();
    return () => { lifetime.abort(); clearInterval(timer); window.removeEventListener('storage', refresh); };
  }, [owner, pauseKey, save]);

  const jobIds = new Set(jobs.map(job => job.id));
  const awaitingMail = jobs.length ? monitor?.library.records.filter(record => record.status === 'matched' && jobIds.has(record.roundId)).length ?? 0 : 0;
  const pending = jobs.length - awaitingMail;
  return { enqueue, paused, setAutoPaused, pending, awaitingMail: jobs.length - pending, storageIssue };
}
