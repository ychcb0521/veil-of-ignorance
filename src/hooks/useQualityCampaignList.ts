import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCampaignCardData, type CampaignCardData } from '@/lib/campaignListCache';
import { listLocalInstantCampaignData, listQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import { qualityCampaignTrashKey, type CampaignSection } from '@/lib/campaignSections';
import { loadQualityCampaignTrash, readQualityCampaignTrash, subscribeQualityCampaignTrash, type QualityCampaignTrash } from '@/lib/fish/qualityCampaignTrash';

import { subscribeInstantCampaigns } from '@/lib/fish/instantCampaignStore';

export function useQualityCampaignList(owner: string | undefined, section: CampaignSection, binView = false) {
  const [snapshot, setSnapshot] = useState({ owner, section, rows: [] as CampaignCardData[], complete: false, error: null as string | null, selectedSellKey: undefined as string | undefined, buyFilterLabel: '' });
  const [trash, setTrash] = useState<{ owner?: string; section?: CampaignSection; marks?: QualityCampaignTrash; error?: string }>({});
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!owner || section === 'personal') return;
    let active = true;
    let revision = 0;
    const refresh = (synchronize = false) => {
      const current = ++revision;
      const read = synchronize ? loadQualityCampaignTrash : readQualityCampaignTrash;
      void read(owner, section).then(
        marks => { if (active && current === revision) setTrash({ owner, section, marks }); },
        error => {
          if (active && current === revision) {
            setTrash(previous => ({
              owner, section,
              marks: previous.owner === owner && previous.section === section ? previous.marks : undefined,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        },
      );
    };
    const onChange = () => refresh();
    const unsubscribe = subscribeQualityCampaignTrash(owner, onChange);
    if (section === 'instant') {
      void readQualityCampaignTrash(owner, section).then(marks => {
        if (active) setTrash(previous => previous.owner === owner && previous.section === section && previous.marks ? previous : { owner, section, marks });
      }).catch(() => undefined);
    }
    refresh(true);
    window.addEventListener('focus', onChange);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', onChange); };
  }, [owner, section, revision]);
  useEffect(() => {
    if (!owner || section === 'personal') return;
    let active = true, generation = 0, inFlight = false, queued = false;
    const controller=new AbortController();
    let observedRepair: { id: string; state: string } | undefined;
    const cards = (rows: Awaited<ReturnType<typeof listLocalInstantCampaignData>>) =>
      rows.map(row => ({ ...buildCampaignCardData(row), peakPriceChangePct: row.campaign.comparison?.instant ? row.campaign.comparison.holdingMetrics?.peakPct : row.campaign.peak_unrealized_pnl }));
    const showLocal = async () => {
      try {
        const rows = cards(await listLocalInstantCampaignData(owner));
        if (!active || !rows.length) return;
        setSnapshot(previous => {
          const sameSection = previous.owner === owner && previous.section === section;
          const byId = new Map(sameSection ? previous.rows.map(row => [row.campaign.id, row]) : []);
          for (const row of rows) byId.set(row.campaign.id, row);
          return { owner, section, rows: [...byId.values()], complete: sameSection && previous.complete,
            error: sameSection ? previous.error : null, selectedSellKey: undefined, buyFilterLabel: '' };
        });
      } catch { /* The cloud read can still succeed when browser storage is unavailable. */ }
    };
    const load = async () => {
      if (!active) return;
      const epoch = ++generation;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      try {
        const data = await listQualityCampaignData(owner, section,controller.signal);
        if (active && epoch === generation) observedRepair = data.repair;
        if (active && epoch === generation) setSnapshot({ owner, section, rows: cards(data.rows), complete: true, error: data.warning ?? null, selectedSellKey: data.selectedSellKey, buyFilterLabel: data.buyFilterLabel });
      } catch (error) { if (active && epoch === generation) setSnapshot(previous => ({ ...(previous.owner === owner && previous.section === section ? previous : { owner, section, rows: [], selectedSellKey: undefined, buyFilterLabel: '' }), complete: true, error: error instanceof Error ? error.message : String(error) })); }
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
    const unsubscribe = section === 'instant' ? subscribeInstantCampaigns(owner, () => void showLocal()) : undefined;
    if (section === 'instant') void showLocal();
    if (section === 'quality') window.addEventListener('fish-quality-saved', saved);
    void load();
    window.addEventListener('focus', load);
    if (section === 'instant') window.addEventListener('online', load);
    return () => { active = false; controller.abort(); unsubscribe?.(); window.removeEventListener('fish-quality-saved', saved); window.removeEventListener('focus', load); window.removeEventListener('online', load); };
  }, [owner, section, revision]);
  const visible = snapshot.owner === owner && snapshot.section === section;
  const trashVisible = trash.owner === owner && trash.section === section;
  const marks = trashVisible ? trash.marks : undefined;
  const trashError = trashVisible ? trash.error : undefined;
  const partition = useMemo(() => {
    const active: CampaignCardData[] = [], deleted: CampaignCardData[] = [];
    if (visible && marks) for (const row of snapshot.rows) {
      const mark = marks[qualityCampaignTrashKey(row.campaign.id)];
      if (mark?.state === 'purged') continue;
      if (mark?.state === 'deleted') {
        deleted.push({ ...row, campaign: { ...row.campaign, deleted_at: new Date(mark.at).toISOString() } });
      } else active.push(row);
    }
    deleted.sort((a, b) => b.campaign.deleted_at!.localeCompare(a.campaign.deleted_at!));
    return { active, deleted, deletedCampaigns: deleted.map(row => row.campaign) };
  }, [visible, snapshot.rows, marks]);
  const rows = binView ? partition.deleted : partition.active;
  const setRows = useCallback((next: CampaignCardData[] | ((prev: CampaignCardData[]) => CampaignCardData[])) => setSnapshot(s => ({ ...s, rows: typeof next === 'function' ? next(s.rows) : next })), []);
  return { rows, setRows, deletedCampaigns: partition.deletedCampaigns, complete: visible && snapshot.complete && !!marks, refreshing: false, loaded: rows.length, total: rows.length,
    cached: false, error: trashError ?? (visible ? snapshot.error : null), failedCount: 0, retry, beginMutation: () => () => undefined, selectedSellKey: visible ? snapshot.selectedSellKey : undefined, buyFilterLabel: visible ? snapshot.buyFilterLabel : '' };
}
