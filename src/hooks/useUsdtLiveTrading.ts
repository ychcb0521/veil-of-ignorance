import { useCallback, useEffect, useRef, useState } from 'react';
import type { useUsdtFollow } from './useUsdtFollow';
import { usdtMirrorRevision, type UsdtMirrorHistory, type UsdtMirrorSnapshot } from '@/lib/fish/usdtPositionMirror';
import { readFishPreferences, updateFishPreference } from '@/lib/fish/fishPreferencesDb';
import { readUsdtCampaigns, saveUsdtCampaignBatch, syncClosedUsdtCampaigns } from '@/lib/fish/usdtLiveCampaignStore';
import type { UsdtLiveCampaign } from '@/lib/fish/usdtLiveCampaign';

type Follow = ReturnType<typeof useUsdtFollow>;
const recentHistory = 86_400_000;
const retryOverlap = 120_000;
const EMPTY_HISTORIES: ReadonlyMap<string, UsdtMirrorHistory> = new Map();

function usePositionHistories(snapshot: UsdtMirrorSnapshot | undefined, read: Follow['readPositionHistory'], attempt: number) {
  const [histories, setHistories] = useState(EMPTY_HISTORIES);
  const positions = useRef(snapshot?.positions);
  positions.current = snapshot?.positions;
  const hasPositions = !!snapshot?.positions.length;
  useEffect(() => {
    setHistories(EMPTY_HISTORIES);
    if (!hasPositions) return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const history = new Map<string, UsdtMirrorHistory>();
    const retryAt = new Map<string, number>();
    let busy = false;
    const tick = async () => {
      if (busy || signal.aborted || document.hidden) return;
      busy = true;
      try {
        const rows = positions.current ?? [];
        const revisions = new Set(rows.map(usdtMirrorRevision));
        for (const revision of history.keys()) {
          if (!revisions.has(revision)) {
            history.delete(revision);
            retryAt.delete(revision);
          }
        }
        for (const position of rows) {
          if (signal.aborted || document.hidden) return;
          const revision = usdtMirrorRevision(position);
          if (history.has(revision) && Date.now() < (retryAt.get(revision) ?? Infinity)) continue;
          let result: UsdtMirrorHistory;
          try { result = await read(position, signal); }
          catch (error) { result = { fills: [], issue: error instanceof Error ? error.message : '币安成交读取失败' }; }
          if (signal.aborted || !positions.current?.some(row => usdtMirrorRevision(row) === revision)) continue;
          history.set(revision, result);
          if (!result.openedAt && result.issue) retryAt.set(revision, Date.now() + 24_000);
          else retryAt.delete(revision);
          setHistories(new Map(history));
        }
      } finally { busy = false; }
    };
    const refresh = () => void tick();
    const timer = window.setInterval(refresh, 8000);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      lifetime.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [hasPositions, read, attempt]);
  return hasPositions ? histories : EMPTY_HISTORIES;
}

export function useUsdtLiveTrading(owner: string | undefined, follow: Pick<Follow, 'connected' | 'positionMirror' | 'campaignMirror' | 'readPositions' | 'readCampaigns' | 'readPositionHistory'>) {
  const { connected, positionMirror, campaignMirror, readPositions, readCampaigns, readPositionHistory } = follow;
  const [positionView, setPositionView] = useState<{ owner: string; snapshot?: UsdtMirrorSnapshot; issue?: string }>();
  const [archiveView, setArchiveView] = useState<{ owner: string; issue?: string }>();
  const [openCampaigns, setOpenCampaigns] = useState<{ owner: string; rows: UsdtLiveCampaign[] }>();
  const wakePositions = useRef<() => void>();
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const retryPositions = useCallback(() => {
    wakePositions.current?.();
    setHistoryAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    if (!owner || !connected || !positionMirror) {
      setPositionView(undefined);
      return;
    }
    const lifetime = new AbortController();
    let busy = false;
    const refresh = () => {
      if (busy || document.hidden || lifetime.signal.aborted) return;
      busy = true;
      void readPositions(lifetime.signal).then(snapshot => {
        if (!lifetime.signal.aborted) setPositionView({ owner, snapshot });
      }, error => {
        if (!lifetime.signal.aborted) setPositionView(prior => ({ owner,
          snapshot: prior?.owner === owner ? prior.snapshot : undefined,
          issue: error instanceof Error ? error.message : '币安持仓读取失败' }));
      }).finally(() => { busy = false; });
    };
    wakePositions.current = refresh;
    const interval = window.setInterval(refresh, 8000);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => { lifetime.abort(); wakePositions.current = undefined; window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [owner, connected, positionMirror, readPositions]);

  useEffect(() => {
    if (!owner || !connected || !campaignMirror || typeof indexedDB === 'undefined') return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const cursorKey = 'usdt-campaign-sync-v1/' + encodeURIComponent(owner);
    let busy = false;
    const sync = async () => {
      if (signal.aborted) return;
      const [previous] = await readFishPreferences<number>([cursorKey]);
      const open = (await readUsdtCampaigns(owner, saved => !saved.campaign.closedAt))
        .map(({ campaign }) => ({ symbol: campaign.symbol, openedAt: campaign.openedAt }));
      if (signal.aborted) return;
      const now = Date.now();
      const since = Math.max(1, Math.min(now, previous ?? now - recentHistory) - retryOverlap);
      const batch = await readCampaigns(since, open, signal);
      if (signal.aborted) return;
      setOpenCampaigns({ owner, rows: batch.campaigns.filter(row => !row.closedAt) });
      await saveUsdtCampaignBatch(owner, batch.campaigns, batch.observedAt);
      await updateFishPreference<number>(cursorKey, cursor => Math.max(cursor ?? 0, batch.observedAt));
      await syncClosedUsdtCampaigns(owner, signal);
      if (!signal.aborted) setArchiveView({ owner, issue: batch.incomplete ? '部分较早成交超出币安可查询范围' : undefined });
    };
    const refresh = () => {
      if (busy || signal.aborted) return;
      busy = true;
      // Non-blocking lock requests cannot take an abort signal. The work itself checks the effect's lifetime.
      const work = navigator.locks ? navigator.locks.request('veil-usdt-campaign:' + owner, { ifAvailable: true },
        lock => lock ? sync() : undefined) : sync();
      void work.catch(error => {
        if (!signal.aborted) setArchiveView({ owner, issue: error instanceof Error ? error.message : '实盘战役等待同步' });
      }).finally(() => { busy = false; });
    };
    const interval = window.setInterval(refresh, 16_000);
    window.addEventListener('online', refresh);
    refresh();
    return () => { lifetime.abort(); window.clearInterval(interval); window.removeEventListener('online', refresh); };
  }, [owner, connected, campaignMirror, readCampaigns]);

  const current = connected && positionView?.owner === owner ? positionView : undefined;
  const histories = usePositionHistories(current?.snapshot, readPositionHistory, historyAttempt);
  return { snapshot: current?.snapshot, issue: current?.issue, retryPositions, histories,
    openCampaigns: connected && openCampaigns?.owner === owner ? openCampaigns?.rows : undefined,
    archiveIssue: archiveView?.owner === owner ? archiveView?.issue : undefined };
}
