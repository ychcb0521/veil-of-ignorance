import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCampaignCardData, type CampaignCardData } from '@/lib/campaignListCache';
import { listQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import type { CampaignSection } from '@/lib/campaignSections';

export function useQualityCampaignList(owner: string | undefined, section: CampaignSection) {
  const [snapshot, setSnapshot] = useState({ owner, section, rows: [] as CampaignCardData[], complete: false, error: null as string | null, selectedSellKey: undefined as string | undefined, buyFilterLabel: '' });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!owner || section === 'personal') return;
    let active = true, generation = 0, inFlight = false, queued = false;
    let observedRepair: { id: string; state: string } | undefined;
    const load = async () => {
      if (!active) return;
      const epoch = ++generation;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      try {
        const data = await listQualityCampaignData(owner, 'quality');
        if (active && epoch === generation) observedRepair = data.repair;
        if (active && epoch === generation) setSnapshot({ owner, section, rows: data.rows.map(row => ({ ...buildCampaignCardData(row), peakPriceChangePct: row.campaign.peak_unrealized_pnl })), complete: true, error: data.warning ?? null, selectedSellKey: data.selectedSellKey, buyFilterLabel: data.buyFilterLabel });
      } catch (error) { if (active && epoch === generation) setSnapshot({ owner, section, rows: [], complete: true, error: error instanceof Error ? error.message : String(error), selectedSellKey: undefined, buyFilterLabel: '' }); }
      finally {
        inFlight = false;
        if (active && queued) { queued = false; void load(); }
      }
    };
    // The first checkpoint removes unverified rows. Keep that list stable while the
    // child progress control advances; rebuild all cards once on pause/completion.
    const saved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.owner !== owner) return;
      if (detail.repair?.state === 'running' && observedRepair?.id === detail.repair.id && observedRepair.state === 'running') return;
      // Mark the checkpoint before its async read finishes, so subsequent running saves are coalesced too.
      if (detail.repair) observedRepair = detail.repair;
      void load();
    };
    void load(); window.addEventListener('fish-quality-saved', saved); window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('fish-quality-saved', saved); window.removeEventListener('focus', load); };
  }, [owner, section, revision]);
  const visible = snapshot.owner === owner && snapshot.section === section;
  const rows = useMemo(() => visible ? snapshot.rows : [], [visible, snapshot.rows]);
  const setRows = useCallback((next: CampaignCardData[] | ((prev: CampaignCardData[]) => CampaignCardData[])) => setSnapshot(s => ({ ...s, rows: typeof next === 'function' ? next(s.rows) : next })), []);
  return { rows, setRows, complete: visible && snapshot.complete, refreshing: false, loaded: rows.length, total: rows.length,
    cached: false, error: visible ? snapshot.error : null, failedCount: 0, retry, beginMutation: () => () => undefined, selectedSellKey: visible ? snapshot.selectedSellKey : undefined, buyFilterLabel: visible ? snapshot.buyFilterLabel : '' };
}
