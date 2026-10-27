import { expect, it, vi } from 'vitest';
import { enableQualityComparison } from '../qualityComparison';
import { collectFishQuality, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityFilterReadingKey, qualityResultKey } from '../quality';
import { makeQualityBuyFilter, makeQualityHoldingVeto } from '../qualityFilters';
import { qualityRowRunStatus, qualityRunStatusMap, qualitySelectRunState, qualityRunStatusText } from '../qualityRunStatus';
import { collapseQualityTableRows } from '../qualityTableRows';

const T = Date.UTC(2026,9,20);
function fixture() {
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(T), ['AAAUSDT','BBBUSDT'].map((symbol,i) => ({id:symbol,symbol,timeMs:T+i*60000,timeLabel:'',fallbackZone:''}))));
  const filter = makeQualityBuyFilter('state:state','>',.7);
  study.sellPlans = study.sellPlans!.map(p => ({...p,rule:{metric:p.metric,direction:'<',threshold:p.snapshot.threshold},buyFilters:[filter]}));
  return {study,filter,rows:qualityComparisonRows(study)};
}
it('tracks filtering and monitoring separately, shares indicator reads and never counts missing/error as valid completion', () => {
  const {study,filter,rows} = fixture();
  let statuses = qualityRunStatusMap(study,qualityDisplayRows(study)), id = rows[0].id;
  expect(statuses.get(id)?.filter).toMatchObject({total:1,finished:0,complete:false});
  expect(statuses.get(id)?.monitor).toMatchObject({total:2,finished:0,complete:false});
  study.filterReadings = [{key:qualityFilterReadingKey(rows[0],filter),value:.9}];
  statuses = qualityRunStatusMap(study,rows);
  expect(qualityRunStatusText(statuses.get(id)!.filter)).toBe('已经运行'); expect(qualityRunStatusText(statuses.get(id)!.monitor)).toBe('尚未运行');
  study.results = study.sellPlans!.map(p => ({key:qualityResultKey(rows[0],p,0),sampleId:id,groupId:p.id,evaluatedAt:T,status:'closed',returnPct:1}));
  expect(qualityRunStatusMap(study,rows).get(id)?.monitor.complete).toBe(true);
  study.filterReadings[0] = {key:qualityFilterReadingKey(rows[0],filter),error:'missing'};
  statuses = qualityRunStatusMap(study,rows);
  expect(statuses.get(id)?.filter).toMatchObject({complete:false,errors:1}); expect(statuses.get(id)?.monitor.complete).toBe(false);
});
it('reuses filter readings across threshold edits, but invalidates changed formulas, sells and holding vetoes', () => {
  const {study,filter,rows} = fixture(), plan = study.sellPlans![0];
  study.filterReadings = [{key:qualityFilterReadingKey(rows[0],filter),value:.9}];
  study.results = study.sellPlans!.map(p => ({key:qualityResultKey(rows[0],p,0),sampleId:rows[0].id,groupId:p.id,evaluatedAt:T,status:'closed',returnPct:1}));
  plan.buyFilters = [{...filter,threshold:.8}]; expect(qualityRunStatusMap(study,rows).get(rows[0].id)?.filter.complete).toBe(true);
  plan.rule = {...plan.rule!,threshold:.4}; expect(qualityRunStatusMap(study,rows).get(rows[0].id)?.monitor.complete).toBe(false);
  plan.rule = {...plan.rule!,threshold:plan.snapshot.threshold}; plan.holdingVetoes = [makeQualityHoldingVeto('drop-1m','>=',3)];
  expect(qualityRunStatusMap(study,rows).get(rows[0].id)?.monitor.complete).toBe(false);
  plan.buyFilters = [{...filter,snapshot:{...filter.snapshot,definitionKey:'new formula'}}];
  expect(qualityRunStatusMap(study,rows).get(rows[0].id)?.filter.complete).toBe(false);
});
it('recognizes non-bought entries, leaves a fixed detector seller pending and marks open positions as refreshable', () => {
  const {study,filter,rows} = fixture(); study.filterReadings = [{key:qualityFilterReadingKey(rows[0],filter),value:.5}];
  expect(qualityRunStatusMap(study,rows).get(rows[0].id)?.monitor.complete).toBe(true);
  study.selectedSellId = study.sellPlans![0].id;
  expect(qualityRunStatusMap(study,rows).get(rows[0].id)?.monitor.complete).toBe(false);
  study.filterReadings[0].value = .9;
  study.results = study.sellPlans!.map(p => ({key:qualityResultKey(rows[0],p,0),sampleId:rows[0].id,groupId:p.id,evaluatedAt:T,status:'open',returnPct:1,complete:false}));
  expect(qualityRunStatusMap(study,rows).get(rows[0].id)?.monitor).toMatchObject({complete:true,refreshable:2});
});
it('handles merged partially run entries without bulk-selecting their already run siblings', () => {
  const {study,filter,rows} = fixture();
  study.filterReadings = [{key:qualityFilterReadingKey(rows[0],filter),value:.9}];
  const displays = qualityDisplayRows(study), merged = {...collapseQualityTableRows(displays)[0],members:displays};
  const statuses = qualityRunStatusMap(study,displays);
  expect(qualityRowRunStatus(merged,statuses).filter).toMatchObject({total:2,finished:1,complete:false});
  expect(qualitySelectRunState([merged],statuses,'filter',false)).toEqual([displays[1].id]);
  expect(qualitySelectRunState([merged],statuses,'filter',true)).toEqual([displays[0].id]);
  expect(qualitySelectRunState([displays[0]],statuses,'filter',false)).toEqual([]);
});
it('marks unconfigured steps explicitly without treating them as successfully run', () => {
  const study = enableQualityComparison(newQualityStudy()), row = fixture().rows[0], status = qualityRunStatusMap(study,[row]).get(row.id)!;
  expect(qualityRunStatusText(status.filter)).toBe('未设置'); expect(qualityRunStatusText(status.monitor)).toBe('未设置');
  expect(qualitySelectRunState([row],new Map([[row.id,status]]),'monitor',false)).toEqual([]);
});
it('both collectors obey only selected entries, reuse older closed results and leave unselected uncached entries untouched', async () => {
  const {study,filter,rows} = fixture(); study.selectedRowIds = [rows[1].id];
  study.filterReadings = [{key:qualityFilterReadingKey(rows[1],filter),value:.9}];
  study.results = study.sellPlans!.map(p => ({key:qualityResultKey(rows[1],p,0),sampleId:rows[1].id,groupId:p.id,evaluatedAt:T,status:'closed',returnPct:1}));
  const load = vi.fn(async () => {throw new Error('must not fetch');}), result = vi.fn(), reading = vi.fn();
  for (const task of ['filter','monitor'] as const) await collectFishQuality({study,task,signal:new AbortController().signal,onProgress:vi.fn(),onResult:result,onFilterReading:reading},load,T+3600000);
  expect(load).not.toHaveBeenCalled(); expect(result).not.toHaveBeenCalled(); expect(reading).not.toHaveBeenCalled();
  study.selectedRowIds = [];
  for (const task of ['filter','monitor'] as const) await collectFishQuality({study,task,signal:new AbortController().signal,onProgress:vi.fn(),onResult:result,onFilterReading:reading},load,T+3600000);
  expect(load).not.toHaveBeenCalled();
});
