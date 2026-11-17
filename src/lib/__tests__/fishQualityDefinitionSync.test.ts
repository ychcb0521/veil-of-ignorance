import { afterEach, expect, it, vi } from 'vitest';
import { STATE_DEF, CDA_DEF, CDA_HOURLY_DEF, definitionKey, FEATURES_KEY } from '@/lib/deepDig/features';
import { enableQualityComparison, qualityRowResult, syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';
import { collectFishQuality, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityDefinition, qualityResultKey } from '@/lib/fish/quality';
import { buildQualityCampaignData } from '@/lib/fish/qualityCampaigns';

const T = Date.UTC(2026, 3, 2, 9, 8), M = 60000;
const changed = { ...STATE_DEF, formula: STATE_DEF.formula.replace('wb = 1 ', 'wb = 3 '), halfLifeHours: 3, avgHours: 12 };
afterEach(() => localStorage.clear());
function seeded() {
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(), [{id:'sto',symbol:'STOUSDT',timeMs:T,timeLabel:'',fallbackZone:'',quality:3}] ), [STATE_DEF,CDA_DEF]);
  const row = qualityComparisonRows(study)[0], plan = study.sellPlans![0];
  plan.rule = {metric:'state',direction:'<',threshold:.5};
  delete plan.definitionSource; // Pre-fix shared sell, frozen from the hard-coded built-in.
  study.selectedRowIds = [row.id];
  study.results = [{key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T+M,status:'closed',complete:true,entryTime:T,entryPrice:1.264,endTime:T+367*M,endPrice:.47347,pnl:-62.54,returnPct:-62.54,exitReading:.488436431}];
  return {study,row,plan};
}
it('freezes current account formulas and parameters, keeps raw scale one and does not change research definitions', () => {
  const saved = JSON.stringify([changed]); localStorage.setItem('sim_anon_'+FEATURES_KEY,saved);
  const study=enableQualityComparison(newQualityStudy()), plan=study.sellPlans![0];
  expect(qualityDefinition(plan.snapshot)).toMatchObject({formula:JSON.parse(definitionKey({...changed,interval:'5m'}))[0],halfLifeHours:3,avgHours:12,interval:'5m'});
  expect(plan).toMatchObject({definitionSource:'account',metric:'state',snapshot:{scale:1}});
  expect(localStorage.getItem('sim_anon_'+FEATURES_KEY)).toBe(saved);
});
it('invalidates complete cached results when formulas change and preserves older experiments, thresholds, entries and selections', async () => {
  const {study,row,plan}=seeded(), before=structuredClone(study), archived=archiveQualityStudy(study);
  const synced=syncQualitySellDefinitions(archived,[changed,CDA_DEF]);
  expect(synced.sellPlans![0].rule).toEqual(plan.rule);
  expect(synced.samples).toBe(study.samples); expect(synced.selectedRowIds).toBe(study.selectedRowIds);
  expect(qualityRowResult(synced,row,synced.sellPlans![0])).toBeUndefined();
  expect(qualityResultKey(row,synced.sellPlans![0],0)).not.toBe(study.results[0].key);
  expect(synced.campaignRuns![0].plan.snapshot.definitionKey).toBe(plan.snapshot.definitionKey);
  expect(synced.campaignRuns![0].result.returnPct).toBe(-62.54);
  expect(syncQualitySellDefinitions(synced,[changed,CDA_DEF])).toBe(synced);
  const load=vi.fn(async (_r,from,cut,p)=>Array.from({length:(cut-from)/p.step},(_,i)=>({openTime:from+i*p.step,open:1,high:1,low:1,close:1,volume:1,quoteVolume:1,takerBuyVolume:.5,takerBuyQuoteVolume:.5,refClose:1})));
  await collectFishQuality({study:synced,signal:new AbortController().signal,onProgress:vi.fn(),onResult:vi.fn()},load,T+10*M);
  expect(load).toHaveBeenCalled(); expect(study).toEqual(before);
});
it('shows the frozen formula, exact trigger and a distinct historical version in comparison campaign metadata', () => {
  const {study}=seeded(), run=archiveQualityStudy(study).campaignRuns![0];
  const data=buildQualityCampaignData('owner',run,'sell');
  expect(data.campaign.comparison?.sellLabel).toContain('历史公式');
  expect(data.campaign.comparison?.sellEvidence).toMatchObject({formula:JSON.parse(planKey())[0],source:'historical',metric:'state',direction:'<',threshold:.5,reading:.488436431,confirmedAt:T+367*M});
  expect(data.tradeRecords[0].closeTime).toBe(T+367*M);
  expect(run.plan.snapshot.definitionKey).toBe(definitionKey({...STATE_DEF,interval:'5m'}));
});
const planKey=()=>definitionKey({...STATE_DEF,interval:'5m'});

it('keeps generated averages and anonymous outputs executable and syncing twice is a no-op', async () => {
  const { makeQualitySellPlan } = await import('@/lib/fish/qualitySellPlans');
  for (const formula of ['state = C', 'ln(C / prev(C))']) {
    const def = { ...STATE_DEF, formula };
    const metric = formula.startsWith('state') ? 'avg_state' : '_feature_value';
    const plan = makeQualitySellPlan('state:' + metric, '<', .5, [def]);
    const study = { ...newQualityStudy(), sellPlansConfigured: true, sellPlans: [plan] };
    const next = syncQualitySellDefinitions(study, [def]);
    expect(qualityDefinition(next.sellPlans![0].snapshot).formula).toContain(metric + ' =');
    expect(syncQualitySellDefinitions(next, [def])).toBe(next);
  }
});


it('keeps the hourly CDA executable in filters, staged sellers and hard vetoes while preserving legacy fingerprints', async () => {
  const { makeQualityBuyFilter, makeQualityHoldingVeto, makeQualitySignalMetrics } = await import('@/lib/fish/qualityFilters');
  const { makeQualitySellPlan } = await import('@/lib/fish/qualitySellPlans');
  const { freezeQualityPlan, planVersionChanges } = await import('@/lib/fish/qualityPlanVersions');
  const { qualityMetricPlan } = await import('@/lib/fish/quality');
  const defs = [CDA_DEF, CDA_HOURLY_DEF];
  const cdaHour = CDA_HOURLY_DEF.id + ':CDA';
  const cdaAvg = CDA_HOURLY_DEF.id + ':avg_CDA_2';
  const sell = makeQualitySellPlan(cdaHour, '<', -10, defs);
  const sellAverage = makeQualitySellPlan(cdaAvg, '<', -10, defs);
  const filter = makeQualityBuyFilter(cdaAvg, '<', -12, true, defs);
  const veto = makeQualityHoldingVeto(cdaHour, '<', -15, true, defs);
  const [signalMetric] = makeQualitySignalMetrics([cdaHour], defs);
  const old = makeQualitySellPlan('cda:CDA', '<', -10, defs);
  const legacy = {...old, snapshot: {...old.snapshot, featureShort:'CDA', featureName:'买方阻力'}};
  const frozenLegacy = freezeQualityPlan(legacy);
  const frozen = freezeQualityPlan({...sell, buyFilters:[filter], holdingVetoes:[veto],
    combo:{beforeLabel:sell.label, switchPct:2.5, after:{label:sellAverage.label, metric:sellAverage.metric,
      snapshot:sellAverage.snapshot, rule:{metric:sellAverage.metric, direction:'<', threshold:-10}}}});
  expect(planVersionChanges(JSON.parse(JSON.stringify(frozenLegacy)))).toEqual([]);
  expect(planVersionChanges(JSON.parse(JSON.stringify(frozen)))).toEqual([]);
  expect(frozenLegacy.frozenVersions?.some(v => v.key === 'cda-hourly')).toBe(false);
  expect(frozen.frozenVersions?.find(v => v.key === 'cda-hourly')?.version).toContain('cda-1h-v1');
  for (const item of [filter, sell, sellAverage, signalMetric]) {
    expect(qualityMetricPlan(item.snapshot, item.metric).plan.step).toBe(3_600_000);
  }
  expect(qualityMetricPlan(veto.snapshot!, veto.metric).plan.step).toBe(3_600_000);
  expect(qualityMetricPlan(old.snapshot, old.metric).plan.step).toBe(300_000);
  const study = { ...newQualityStudy(), sellPlans:[frozen, frozenLegacy] };
  expect(syncQualitySellDefinitions(study, defs).sellPlans).toEqual(study.sellPlans);
});
