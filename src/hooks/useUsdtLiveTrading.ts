import { useCallback, useEffect, useRef, useState } from 'react';
import type { useUsdtFollow } from './useUsdtFollow';
import type { UsdtMirrorSnapshot } from '@/lib/fish/usdtPositionMirror';
import { readFishPreferences, updateFishPreference } from '@/lib/fish/fishPreferencesDb';
import { readUsdtCampaigns, saveUsdtCampaignBatch, syncClosedUsdtCampaigns } from '@/lib/fish/usdtLiveCampaignStore';

type Follow = ReturnType<typeof useUsdtFollow>;
const recentHistory = 86_400_000;
const retryOverlap = 120_000;

export function useUsdtLiveTrading(owner: string | undefined, follow: Pick<Follow, 'connected' | 'positionMirror' | 'campaignMirror' | 'readPositions' | 'readCampaigns'>) {
  const { connected, positionMirror, campaignMirror, readPositions, readCampaigns } = follow;
  const [positionView, setPositionView] = useState<{ owner: string; snapshot?: UsdtMirrorSnapshot; issue?: string }>();
  const [archiveView, setArchiveView] = useState<{ owner: string; issue?: string }>();
  const wakePositions = useRef<() => void>();
  const retryPositions = useCallback(() => wakePositions.current?.(), []);

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
  return { snapshot: current?.snapshot, issue: current?.issue, retryPositions,
    archiveIssue: archiveView?.owner === owner ? archiveView?.issue : undefined };
}
