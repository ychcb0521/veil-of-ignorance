import { useEffect, useMemo, useRef, useState } from 'react';
import { instantCampaignInput, instantPositionInput, type InstantPositionFill, type InstantPositionInput, type InstantCampaignInput } from '@/lib/fish/instantCampaign';
import { readInstantCampaignJobs, saveInstantCampaignInput, saveInstantPosition, saveInstantCampaignSnapshot, subscribeInstantCampaigns, syncInstantCampaign } from '@/lib/fish/instantCampaignStore';
import { buildPageInstantCampaign, openPageInstantPosition } from './useFish';
import type { FishCdaTracking } from './useFishCdaTracking';

export function useInstantCampaigns(owner: string | undefined, cda: FishCdaTracking, autoPositions = false) {
  const inputs = useMemo<(InstantPositionInput | InstantCampaignInput)[]>(() => [...(cda.localSales ?? []), ...(cda.admitted ?? [])].flatMap(({ record, round }) => {
    const alert = cda.alerts.get(record.id);
    const input = alert ? instantCampaignInput(record, round, alert) : autoPositions ? instantPositionInput(record, round) : undefined;
    return input ? [input] : [];
  }), [cda.admitted, cda.localSales, cda.alerts, autoPositions]);
  const latest = useRef(inputs);
  latest.current = inputs;
  const wake = useRef<() => void>();
  const [issue, setIssue] = useState('');
  const [open, setOpen] = useState<{ owner?: string; rows: InstantPositionFill[] }>({ rows: [] });
  useEffect(() => {
    if (!owner || !autoPositions) return;
    let alive = true, revision = 0;
    const read = async () => {
      const epoch = ++revision;
      const jobs = await readInstantCampaignJobs(owner);
      if (alive && epoch === revision) setOpen({ owner, rows: jobs.flatMap(job =>
        job.opened && !job.snapshot && !('sell' in job.input) ? [job.opened] : []) });
    };
    const refresh = () => void read().catch(() => undefined);
    const unsubscribe = subscribeInstantCampaigns(owner, refresh);
    refresh();
    return () => { alive = false; unsubscribe(); };
  }, [owner, autoPositions]);

  useEffect(() => {
    setIssue('');
    if (!owner || typeof indexedDB === 'undefined') return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let running = false, requested = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const retryAt = new Map<string, number>();

    const process = async () => {
      for (const input of latest.current) {
        if (signal.aborted) return;
        const key = input.id + ('sell' in input ? ':sold' : ':admitted');
        if (seen.has(key)) continue;
        if ('sell' in input) await saveInstantCampaignInput(owner, input);
        else await saveInstantPosition(owner, input);
        seen.add(key);
        retryAt.delete(input.id);
      }
      if (navigator.onLine === false) return;
      const errors: string[] = [];
      const jobs = await readInstantCampaignJobs(owner);
      // Record new positions before attempting potentially slow cloud writes for earlier sales.
      jobs.sort((a, b) => Number('sell' in a.input) - Number('sell' in b.input));
      for (const job of jobs) {
        if (signal.aborted) return;
        if (job.synced || (retryAt.get(job.input.id) ?? 0) > Date.now()) continue;
        let snapshot = job.snapshot;
        try {
          if (!('sell' in job.input)) {
            if (!autoPositions || job.opened) continue;
            const opened = await openPageInstantPosition(job.input, signal);
            if (!signal.aborted) await saveInstantPosition(owner, job.input, opened);
            retryAt.delete(job.input.id);
            continue;
          }
          if (!snapshot) {
            const frozen = await buildPageInstantCampaign({ ...job.input, opened: job.opened }, signal);
            if (signal.aborted) return;
            snapshot = await saveInstantCampaignSnapshot(owner, frozen);
          }
          if (!signal.aborted) await syncInstantCampaign(owner, snapshot, signal);
          retryAt.delete(job.input.id);
        } catch (error) {
          if (signal.aborted) return;
          retryAt.set(job.input.id, Date.now() + 30_000);
          errors.push(job.input.source.symbol + (snapshot ? ' · 战役待同步' : 'sell' in job.input ? ' · 战役待生成' : ' · 等待开仓价')
            + (error instanceof Error ? '（' + error.message + '）' : ''));
        }
      }
      if (!signal.aborted) setIssue(previous => errors[0] ?? (retryAt.size ? previous : ''));
    };

    const tick = () => {
      if (signal.aborted) return;
      if (running) { requested = true; return; }
      running = true;
      const work = navigator.locks
        ? navigator.locks.request('veil-instant-campaign:' + owner, { signal }, process)
        : process();
      void work.catch(error => {
        if (!signal.aborted) setIssue(error instanceof Error ? '即时交易 · ' + error.message : '即时交易等待重试');
      }).finally(() => {
        running = false;
        if (signal.aborted) return;
        if (requested) { requested = false; tick(); }
        else if (retryAt.size || latest.current.some(input => !seen.has(input.id + ('sell' in input ? ':sold' : ':admitted')))) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(tick, 30_000);
        }
      });
    };
    const online = () => { retryAt.clear(); tick(); };
    wake.current = tick;
    window.addEventListener('online', online);
    window.addEventListener('focus', tick);
    const unsubscribe = subscribeInstantCampaigns(owner, tick);
    tick();
    return () => {
      lifetime.abort();
      unsubscribe();
      wake.current = undefined;
      clearTimeout(retryTimer);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', tick);
    };
  }, [owner, autoPositions]);

  useEffect(() => { wake.current?.(); }, [inputs]);
  const sold = useMemo(() => new Set(inputs.filter(input => 'sell' in input).map(input => input.id)), [inputs]);
  return { issue, positions: open.owner === owner ? open.rows.filter(row => !sold.has(row.id)) : [] };
}
