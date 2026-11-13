import { useEffect, useMemo, useRef, useState } from 'react';
import { instantCampaignInput } from '@/lib/fish/instantCampaign';
import { readInstantCampaignJobs, saveInstantCampaignInput, saveInstantCampaignSnapshot, syncInstantCampaign } from '@/lib/fish/instantCampaignStore';
import { buildPageInstantCampaign } from './useFish';
import type { FishCdaTracking } from './useFishCdaTracking';

export function useInstantCampaigns(owner: string | undefined, cda: FishCdaTracking) {
  const inputs = useMemo(() => cda.admitted?.flatMap(({ record, round }) => {
    const alert = cda.alerts.get(record.id);
    const input = alert && instantCampaignInput(record, round, alert);
    return input ? [input] : [];
  }) ?? [], [cda.admitted, cda.alerts]);
  const latest = useRef(inputs);
  latest.current = inputs;
  const wake = useRef<() => void>();
  const [issue, setIssue] = useState('');

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
        if (seen.has(input.id)) continue;
        await saveInstantCampaignInput(owner, input);
        seen.add(input.id);
      }
      if (navigator.onLine === false) return;
      const errors: string[] = [];
      for (const job of await readInstantCampaignJobs(owner)) {
        if (signal.aborted) return;
        if (job.synced || (retryAt.get(job.input.id) ?? 0) > Date.now()) continue;
        let snapshot = job.snapshot;
        try {
          if (!snapshot) {
            const frozen = await buildPageInstantCampaign(job.input, signal);
            if (signal.aborted) return;
            snapshot = await saveInstantCampaignSnapshot(owner, frozen);
          }
          if (!signal.aborted) await syncInstantCampaign(owner, snapshot, signal);
          retryAt.delete(job.input.id);
        } catch (error) {
          if (signal.aborted) return;
          retryAt.set(job.input.id, Date.now() + 30_000);
          errors.push(job.input.source.symbol + (snapshot ? ' · 战役待同步' : ' · 战役待生成')
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
        else if (retryAt.size || latest.current.some(input => !seen.has(input.id))) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(tick, 30_000);
        }
      });
    };
    const online = () => { retryAt.clear(); tick(); };
    wake.current = tick;
    window.addEventListener('online', online);
    window.addEventListener('focus', tick);
    tick();
    return () => {
      lifetime.abort();
      wake.current = undefined;
      clearTimeout(retryTimer);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', tick);
    };
  }, [owner]);

  useEffect(() => { wake.current?.(); }, [inputs]);
  return issue;
}
