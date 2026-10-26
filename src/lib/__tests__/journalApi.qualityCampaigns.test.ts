import { beforeEach, expect, it, vi } from 'vitest';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityResultKey, type FishQualityStudy } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';
import { getCampaignFullData, getCampaignWithLegs, listCounterfactuals } from '@/lib/journalApi';
import { qualityCampaignId } from '@/lib/campaignSections';
import { prepareQualityRepair, applyQualityRepair } from '@/lib/fish/qualityRepair';
import { STATE_DEF } from '@/lib/deepDig/features';
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
it('resolves an old campaign URL to its corrected trade without duplicate personal writes',async()=>{
  const old=state.study!.results[0], id=qualityCampaignId(old.key);
  const prepared=prepareQualityRepair(state.study!,[{...STATE_DEF,formula:'state = C / 200'}],1792459000000), task=prepared.tasks[0];
  state.study=applyQualityRepair(prepared.study,prepared.batch.id,task,{...old,key:task.key,endPrice:12,pnl:20,returnPct:20,peakPct:20,adversePct:0,drawdownPct:0,uncapturedPct:0,heldHours:1/6},1792459000001);
  const full=await getCampaignFullData(id);
  expect(full.campaign.id).toBe(qualityCampaignId(task.key)); expect(full.tradeRecords[0].pnl).toBe(20);
  expect(full.campaign.comparison?.repair?.status).toBe('verified'); expect(state.from).not.toHaveBeenCalled();
});
