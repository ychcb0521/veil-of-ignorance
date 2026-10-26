import { beforeEach, expect, it, vi } from 'vitest';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityResultKey, type FishQualityStudy } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';
import { getCampaignFullData, getCampaignWithLegs, listCounterfactuals } from '@/lib/journalApi';
import { qualityCampaignId } from '@/lib/campaignSections';
const state = vi.hoisted(() => ({ owner: 'owner-a', study: null as FishQualityStudy | null, load: vi.fn(), from: vi.fn(() => { throw new Error('Paper campaigns must never use a personal table'); }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: state.owner } } } }) }, from: state.from } }));
vi.mock('@/lib/fish/qualityStore', () => ({ loadQualityStudy: state.load }));
beforeEach(() => {
  state.owner = 'owner-a'; state.from.mockClear();
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(), [{ id: 'lib', symbol: 'AAAUSDT', timeMs: 1792454400000, timeLabel: '', fallbackZone: '' }]));
  const row = qualityComparisonRows(study)[0], plan = study.sellPlans![0]; plan.rule = { metric: plan.metric, direction: '<', threshold: .5 };
  study.results = [{ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: 1792455000000, status: 'closed', entryTime: 1792454400000, entryPrice: 10, endTime: 1792455000000, endPrice: 11, pnl: 10, returnPct: 10 }];
  state.study = archiveQualityStudy(study);
  state.load.mockReset().mockImplementation(async (owner: string) => ({ study: owner === 'owner-a' ? state.study : newQualityStudy() }));
});
it('opens an evaluated campaign through the existing full/detail API without reading or healing personal tables', async () => {
  const id = qualityCampaignId(state.study!.results[0].key);
  const full = await getCampaignFullData(id); expect(full.tradeRecords[0].pnl).toBe(10); expect(full.campaign.user_id).toBe('owner-a');
  expect((await getCampaignWithLegs(id)).legs).toHaveLength(1); expect(await listCounterfactuals(id)).toEqual([]); expect(state.from).not.toHaveBeenCalled();
});
it('does not expose a previous account’s experiment through a retained URL or preloaded source', async () => {
  const id = qualityCampaignId(state.study!.results[0].key), previous = await getCampaignFullData(id);
  state.owner = 'owner-b';
  await expect(getCampaignFullData(id, { source: { campaign: previous.campaign, legs: previous.legs } })).rejects.toThrow('本账号未找到');
  expect(state.from).not.toHaveBeenCalled(); expect(state.load).toHaveBeenLastCalledWith('owner-b');
});
