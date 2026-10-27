import { expect, it } from 'vitest';
import { STATE_DEF, definitionKey } from '@/lib/deepDig/features';
import { newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityFilterReadingKey, qualityGroupId, qualityResultKey } from '../quality';
import { enableQualityComparison } from '../qualityComparison';
import { makeQualityBuyFilter } from '../qualityFilters';
import { QUALITY_RETURN_CUTS, qualityReturnSummary, qualityReturnTrades, type QualityReturnTrade } from '../qualityReturnStatistics';

const T = Date.UTC(2026,9,20);
function fixture() {
  const study = enableQualityComparison(newQualityStudy(T));
  const snapshots = [.5,.7].map(threshold => ({ featureId:'state', featureShort:'状态 S', statistic:'state', definitionKey:definitionKey(STATE_DEF), interval:'5m', scale:1, threshold, direction:'>' as const, cutoffMs:T, average:.8, cbi2:.8, startAverage:.8, previousAverage:.4 }));
  study.groups = snapshots.map(snapshot => ({id:qualityGroupId(snapshot),label:'状态 S',metric:'state',snapshot}));
  study.samples = [{ id:'s', groups:study.groups.map(g => g.id), enteredAt:T, basis:'capture', importedAt:T, source:{id:'source',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish:{...snapshots[0],algorithms:snapshots,combination:'and'}} }];
  study.sellPlans = study.sellPlans!.map(p => ({ ...p, rule:{metric:p.metric,direction:'<',threshold:p.snapshot.threshold} }));
  const row = qualityComparisonRows(study)[0];
  study.results = study.sellPlans.map(p => ({key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T,status:'closed',returnPct:120,adversePct:-5,heldHours:1}));
  return study;
}
const totals = (s: ReturnType<typeof qualityReturnSummary>) => [s.drawdown,s.seller,s.filter,s.detector,s.sellType].map(bins => bins.reduce((sum,b) => sum+b.n,0));

it('deduplicates expanded detector rows but counts each seller-entry experiment separately', () => {
  const study = fixture(), rows = qualityDisplayRows(study), trades = qualityReturnTrades(study,rows);
  expect(rows).toHaveLength(2); expect(trades).toHaveLength(2);
  const stats = qualityReturnSummary(trades,100);
  expect(stats).toMatchObject({ n:2, entries:1, sellers:2 });
  expect(stats.seller).toHaveLength(2); expect(stats.detector).toEqual([{label:'状态 S',n:2}]);
  const levels = qualityReturnSummary(trades,100,'level');
  expect(levels.detector).toHaveLength(1); expect(levels.detector[0].label).toContain('> 0.5'); expect(levels.detector[0].label).toContain('> 0.7');
  expect(totals(stats)).toEqual([2,2,2,2,2]);
});

it('includes exact return boundaries in six nested cohorts, excludes invalid/open results and deduplicates trial IDs', () => {
  const study = fixture(), base = qualityReturnTrades(study,qualityDisplayRows(study))[0];
  const trades = [100,50,40,30,20,10,9.999,NaN,Infinity].map((value,i) => ({...base,trialId:String(i),id:String(i),result:{...base.result,returnPct:value}}));
  trades.push({...base,trialId:'open',result:{...base.result,status:'open',returnPct:200}});
  trades.push(trades[0]);
  expect(QUALITY_RETURN_CUTS.map(cut => qualityReturnSummary(trades,cut).n)).toEqual([1,2,3,4,5,6]);
  for (const cut of QUALITY_RETURN_CUTS) { const s = qualityReturnSummary(trades,cut); expect(totals(s)).toEqual(Array(5).fill(s.n)); }
});

it('assigns all drawdown boundaries including zero and absent measurements to disjoint complete slices', () => {
  const study = fixture(), base = qualityReturnTrades(study,qualityDisplayRows(study))[0];
  const trades = [0,1,3,5,8,10,20,undefined].map((dd,i) => ({...base,trialId:String(i),result:{...base.result,adversePct:dd == null ? undefined : -dd}}));
  const stats = qualityReturnSummary(trades,100);
  expect(stats.drawdown.map(b => b.n)).toEqual([1,1,1,1,1,1,1,1]);
  expect(totals(stats)).toEqual([8,8,8,8,8]);
});

it('preserves complete original detector attribution when the visible table selects just one detector level', () => {
  const study = fixture(), rows = qualityDisplayRows(study).filter(r => r.detectorId === study.groups[0].id);
  const stats = qualityReturnSummary(qualityReturnTrades(study,rows),100,'level');
  expect(stats.detector[0].label).toContain('> 0.5'); expect(stats.detector[0].label).toContain('> 0.7');
});

it('uses full enabled AND filter combinations, merges variable identities and keeps threshold configurations separate', () => {
  const study = fixture(), low = makeQualityBuyFilter('state:state','>',.5), high = {...low,id:'high',threshold:.7};
  study.sellPlans = [study.sellPlans![0],{...study.sellPlans![0],id:'other',buyFilters:[low,high,low]}, {...study.sellPlans![0],id:'third',buyFilters:[low]}];
  const row = qualityComparisonRows(study)[0];
  study.filterReadings = [{key:qualityFilterReadingKey(row,low),value:.9,at:T}];
  study.results = study.sellPlans.map(p => ({...study.results[0],key:qualityResultKey(row,p,0),groupId:p.id}));
  const trades = qualityReturnTrades(study,qualityDisplayRows(study)), variables = qualityReturnSummary(trades,100), levels = qualityReturnSummary(trades,100,'level');
  expect(variables.filter).toHaveLength(2); expect(variables.filter.find(b => b.label === low.label)?.n).toBe(2);
  expect(variables.seller).toHaveLength(1); expect(levels.seller).toHaveLength(3);
  expect(levels.filter).toHaveLength(3); expect(levels.filter.find(b => b.label.includes('且'))?.label.match(/> 0.5/g)).toHaveLength(1);
  expect(totals(levels)).toEqual([3,3,3,3,3]);
  study.filterReadings[0].value = .4;
  expect(qualityReturnTrades(study,qualityDisplayRows(study))).toHaveLength(1);
});

it('distinguishes unconfigured filters, library attribution, unknown attribution and unknown sell causes', () => {
  const study = fixture(), rows = qualityDisplayRows(study), base = qualityReturnTrades(study,rows)[0];
  const unknown: QualityReturnTrade = {...base,trialId:'unknown',detector:{variable:{id:'unknown',label:'探测归属未记录'},level:{id:'unknown',label:'探测归属未记录'}},sellType:'触发原因未记录'};
  const library: QualityReturnTrade = {...base,trialId:'library',detector:{variable:{id:'library',label:'无探测算法（信号库）'},level:{id:'library',label:'无探测算法（信号库）'}}};
  const stats = qualityReturnSummary([unknown,library],100);
  expect(stats.detector).toHaveLength(2); expect(stats.filter).toEqual([{label:'未设置过滤',n:2}]); expect(stats.sellType.find(b => b.label === '触发原因未记录')?.n).toBe(1);
  study.groups = study.groups.slice(0,1);
  expect(qualityReturnSummary(qualityReturnTrades(study,rows),100).detector[0].label).toContain('部分探测归属未记录');
});
