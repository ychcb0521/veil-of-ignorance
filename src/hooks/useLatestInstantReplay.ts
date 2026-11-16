import { useEffect, useState } from 'react';
import { readLatestCloudInstantReplay, readLatestLocalInstantReplay, subscribeInstantCampaigns } from '@/lib/fish/instantCampaignStore';
import { readLatestCloudUsdtReplay, readLatestLocalUsdtReplay } from '@/lib/fish/usdtLiveCampaignStore';
import { laterInstantReplayEntry, type InstantReplayEntry } from '@/lib/fish/latestScreenedReplaySymbol';

export function useLatestInstantReplay(owner: string | undefined, enabled: boolean) {
  const [saved, setSaved] = useState<{ owner: string; local?: InstantReplayEntry; cloud?: InstantReplayEntry }>();
  useEffect(() => {
    if (!owner || !enabled) return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let revision = 0;
    let pending: ReturnType<typeof setTimeout>;

    const readLocal = async () => {
      if (typeof indexedDB === 'undefined') return;
      const epoch = ++revision;
      const [screened, binance] = await Promise.all([
        readLatestLocalInstantReplay(owner).catch(() => undefined),
        readLatestLocalUsdtReplay(owner).catch(() => undefined),
      ]);
      if (signal.aborted || epoch !== revision) return;
      const local = laterInstantReplayEntry(screened, binance);
      setSaved(previous => ({ owner, cloud: previous?.owner === owner ? previous.cloud : undefined, local }));
    };
    const refresh = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void readLocal(), 150);
    };
    const readCloud = async () => {
      const [screened, binance] = await Promise.all([
        readLatestCloudInstantReplay(owner, signal).catch(() => undefined),
        readLatestCloudUsdtReplay(owner, signal).catch(() => undefined),
      ]);
      if (signal.aborted) return;
      const cloud = laterInstantReplayEntry(screened, binance);
      setSaved(previous => ({ owner, local: previous?.owner === owner ? previous.local : undefined, cloud }));
    };
    const unsubscribe = subscribeInstantCampaigns(owner, refresh);
    window.addEventListener('online', readCloud);
    void readLocal();
    if (navigator.onLine) void readCloud();
    return () => {
      lifetime.abort();
      clearTimeout(pending);
      unsubscribe();
      window.removeEventListener('online', readCloud);
    };
  }, [owner, enabled]);
  return saved && saved.owner === owner ? laterInstantReplayEntry(saved.local, saved.cloud) : undefined;
}
