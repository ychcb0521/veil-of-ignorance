import { useEffect, useMemo, useRef, useState } from 'react';
import { instantCampaignInput, instantPositionInput, type InstantPositionFill, type InstantPositionInput, type InstantCampaignInput } from '@/lib/fish/instantCampaign';
import { readInstantPositionLedger, reconcileOpenInstantPositions, type InstantPositionClose, readPendingInstantCampaignJobs, saveInstantCampaignInput, saveInstantPosition, saveInstantCampaignSnapshot, subscribeInstantCampaigns, syncInstantCampaign } from '@/lib/fish/instantCampaignStore';
import { buildPageInstantCampaign, openPageInstantPosition } from './useFish';
import type { FishCdaTracking } from './useFishCdaTracking';

function campaignIssueDetail(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const message = error.message.trim();
  if (/<!doctype\s+html|<html\b|<script\b/i.test(message)) return '云端接口返回了网页，稍后会自动重试。';
  return message.length > 180 ? message.slice(0, 180) + '…' : message;
}

export function useInstantCampaigns(owner: string | undefined, cda: FishCdaTracking, autoPositions = false) {
  const inputs = useMemo<(InstantPositionInput | InstantCampaignInput)[]>(() => [...(cda.localSales ?? []), ...(cda.admitted ?? [])].flatMap(({ record, round }) => {
    const alert = cda.alerts.get(record.id);
    const input = alert ? instantCampaignInput(record, round, alert, cda.monitorResults?.get(record.id)) : autoPositions ? instantPositionInput(record, round) : undefined;
    return input ? [input] : [];
  }), [cda.admitted, cda.localSales, cda.alerts, cda.monitorResults, autoPositions]);
  const latest = useRef(inputs);
  latest.current = inputs;
  const wake = useRef<() => void>();
  const [issue, setIssue] = useState('');
  const [ledger, setLedger] = useState<{ owner?: string; positions: InstantPositionFill[]; history: InstantPositionClose[] }>({ positions: [], history: [] });
  useEffect(() => {
    if (!owner || !autoPositions) return;
    let alive = true, revision = 0;
    const read = async () => {
      const epoch = ++revision;
      const next = await readInstantPositionLedger(owner);
      if (alive && epoch === revision) setLedger({ owner, ...next });
    };
    const refresh = () => void read().catch(() => undefined);
    const unsubscribe = subscribeInstantCampaigns(owner, refresh);
    refresh();
    const lifetime = new AbortController();
    let reconciling = false;
    const reconcile = async () => {
      if (reconciling || !navigator.onLine) return;
      reconciling = true;
      try { await reconcileOpenInstantPositions(owner, lifetime.signal); }
      catch { /* Keep local executions and retry when connectivity returns. */ }
      finally { reconciling = false; }
    };
    void reconcile();
    const timer = window.setInterval(reconcile, 60_000);
    window.addEventListener('online', reconcile);
    window.addEventListener('focus', reconcile);
    return () => {
      alive = false;
      lifetime.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', reconcile);
      window.removeEventListener('focus', reconcile);
      unsubscribe();
    };
  }, [owner, autoPositions]);

  useEffect(() => {
    setIssue('');
    if (!owner || typeof indexedDB === 'undefined') return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let running = false, requested = false, needsRetry = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const retries = new Map<string, { at: number; issue: string }>();

    const process = async () => {
      for (const input of latest.current) {
        if (signal.aborted) return;
        const key = input.id + ('sell' in input ? ':sold' : ':admitted');
        if (seen.has(key)) continue;
        if ('sell' in input) await saveInstantCampaignInput(owner, input);
        else await saveInstantPosition(owner, input);
        seen.add(key);
        retries.delete(input.id);
      }
      if (navigator.onLine === false) return;
      const jobs = await readPendingInstantCampaignJobs(owner, autoPositions);
      const pending = new Set(jobs.map(job => job.input.id));
      for (const id of retries.keys()) if (!pending.has(id)) retries.delete(id);
      // Record new positions before attempting potentially slow cloud writes for earlier sales.
      jobs.sort((a, b) => Number('sell' in a.input) - Number('sell' in b.input));
      for (const job of jobs) {
        if (signal.aborted) return;
        if ((retries.get(job.input.id)?.at ?? 0) > Date.now()) continue;
        let snapshot = job.snapshot;
        try {
          if (!('sell' in job.input)) {
            if (!autoPositions || job.opened) continue;
            const opened = await openPageInstantPosition(job.input, signal);
            if (!signal.aborted) await saveInstantPosition(owner, job.input, opened);
            retries.delete(job.input.id);
            continue;
          }
          if (!snapshot) {
            const frozen = await buildPageInstantCampaign({ ...job.input, opened: job.opened }, signal);
            if (signal.aborted) return;
            snapshot = await saveInstantCampaignSnapshot(owner, frozen);
          }
          if (!signal.aborted) await syncInstantCampaign(owner, snapshot, signal);
          retries.delete(job.input.id);
        } catch (error) {
          if (signal.aborted) return;
          const detail = campaignIssueDetail(error);
          const issue = job.input.source.symbol + (snapshot ? ' · 战役待同步' : 'sell' in job.input ? ' · 战役待生成' : ' · 等待开仓价')
            + (detail ? '（' + detail + '）' : '');
          retries.set(job.input.id, { at: Date.now() + 30_000, issue });
        }
      }
      if (!signal.aborted) setIssue(retries.values().next().value?.issue ?? '');
    };

    const tick = () => {
      if (signal.aborted) return;
      if (running) { requested = true; return; }
      running = true;
      needsRetry = false;
      clearTimeout(retryTimer);
      const work = navigator.locks
        ? navigator.locks.request('veil-instant-campaign:' + owner, { signal }, process)
        : process();
      void work.catch(error => {
        if (!signal.aborted) {
          needsRetry = true;
          const detail = campaignIssueDetail(error);
          setIssue(detail ? '即时交易 · ' + detail : '即时交易等待重试');
        }
      }).finally(() => {
        running = false;
        if (signal.aborted) return;
        if (requested) { requested = false; tick(); }
        else if (needsRetry || retries.size || latest.current.some(input => !seen.has(input.id + ('sell' in input ? ':sold' : ':admitted')))) {
          retryTimer = setTimeout(tick, 30_000);
        }
      });
    };
    const online = () => { retries.clear(); tick(); };
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
  const positions = ledger.owner === owner ? ledger.positions.filter(row => {
    if (sold.has(row.id)) return false;
    const result = cda.monitorResults?.get(row.recordId);
    if (result?.status === 'closed' && result.entryTime === Math.floor(row.buyAt / 60_000) * 60_000) return false;
    const manual = cda.manualPositions?.get(row.recordId);
    return !(manual && manual.startedAt >= row.buyAt && manual.fills.at(-1)?.fraction === 1);
  }) : [];
  return { issue, positions, history: ledger.owner === owner ? ledger.history : [] };
}
