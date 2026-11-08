import {expect,it,vi} from 'vitest';
import {firstMatchFixture,SIGNAL_AT,MATCHED_AT} from './qualityFirstMatch.fixture';
import {qualityMonitorEntryAt} from '../qualityAdmissionTime';
import {withQualityScreeningEntries,screeningCell,screeningRowResults,screeningResultIndex,qualityScreeningResults} from '../qualityScreeningResults';
import {collectFishQuality,qualityComparisonRows,qualityRunSamples,qualityResultKey,qualityFilterStatus,type QualityResult,type QualityBuyFilter,type QualityFilterReading} from '../quality';
import {qualityRowResult} from '../qualityComparison';
import {archiveQualityResult} from '../qualityCampaignArchive';
import {buildQualityCampaignData} from '../qualityCampaignProjection';
import {beginQualityMonitorRound,captureQualityMonitorResult} from '../qualityMonitorLibrary';
import {buildQualitySheets} from '../qualityExport';
import type {FishReconstructionLoader} from '../reconstruction';
import {freezeQualityPlan} from '../qualityPlanVersions';
import {beginQualityFilterRound,finishQualityFilterRound} from '../qualityFilterLibrary';

it('buys UAI at the displayed first match, reprices it, and opens the campaign at 2026-04-13 19:40 Beijing time',async()=>{
 const fixture=firstMatchFixture(),row=qualityComparisonRows(fixture.study)[0],plan=fixture.plan;
 const old:QualityResult={key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,status:'closed',entryTime:SIGNAL_AT,entryPrice:100,endTime:SIGNAL_AT+60000,endPrice:95,pnl:-5,returnPct:-5,evaluatedAt:MATCHED_AT,complete:true};
 const original=archiveQualityResult({...fixture.study,results:[old]},old),before=structuredClone(original);
 const study=withQualityScreeningEntries(original,fixture.library),current=qualityComparisonRows(study)[0];
 expect(current.id).toBe(row.id);expect(study.selectedRowIds).toEqual(original.selectedRowIds);
 expect(current.enteredAt).toBe(SIGNAL_AT);expect(qualityRunSamples(study)[0].enteredAt).toBe(SIGNAL_AT);
 expect(qualityMonitorEntryAt(current)).toBe(MATCHED_AT);expect(qualityRowResult(study,current,plan)).toBeUndefined();
 const load=vi.fn<FishReconstructionLoader>(async(_source,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
  const time=from+i*p.step,price=time>=MATCHED_AT?104:100;
  return {openTime:time,open:price,close:price,high:price,low:price,volume:1,quoteVolume:100,takerBuyQuoteVolume:50,takerBuyVolume:.5};
 }));
 const results:QualityResult[]=[];
 await collectFishQuality({study,task:'monitor',signal:new AbortController().signal,onProgress:vi.fn(),onResult:r=>results.push(r)},load,MATCHED_AT+10*60000);
 expect(results).toHaveLength(1);expect(results[0]).toMatchObject({status:'open',entryTime:MATCHED_AT,entryPrice:104,returnPct:0});
 expect(load.mock.calls.find(call=>call[3].step===60000)![1]).toBe(MATCHED_AT);
 const archived=archiveQualityResult({...study,results:[...study.results,...results]},results[0]);
 expect(archived.campaignRuns).toHaveLength(2);expect(archived.campaignRuns![0]).toEqual(original.campaignRuns![0]);
 const run=archived.campaignRuns![1],campaign=buildQualityCampaignData('test',run,'sell');
 expect(run.sample.enteredAt).toBe(MATCHED_AT);expect(campaign.campaign.opened_at).toBe('2026-04-13T11:40:00.000Z');
 expect(campaign.legs[0].pre_entry_price).toBe(104);
 const begun=beginQualityMonitorRound(study,study,MATCHED_AT+1),saved=captureQualityMonitorResult(begun.study,begun.capture,results[0],MATCHED_AT+2);
 expect(saved.monitorLibrary!.records[0]).toMatchObject({enteredAt:MATCHED_AT,result:{entryTime:MATCHED_AT,entryPrice:104}});
 const sheet=buildQualitySheets(archived,[current])[0],value=(header:string)=>sheet.rows[0][sheet.columns.findIndex(c=>c.header===header)];
 expect(value('信号时间')).toBe('2026-04-12 00:26:00');expect(value('买入时间')).toBe('2026-04-13 19:40:00');
 expect(original).toEqual(before);expect(study.sellPlans).toBe(original.sellPlans);
 expect(withQualityScreeningEntries(study,fixture.library)).toBe(study);
});

it('does not shift another entry, exchange, symbol or the original screening start',()=>{
 const {study,library}=firstMatchFixture(),sample=study.samples[0];
 study.samples.push({...sample,id:'other-entry',enteredAt:SIGNAL_AT+60000},{...sample,id:'other-exchange',source:{...sample.source,exchange:'okx'}},{...sample,id:'other-symbol',source:{...sample.source,symbol:'OTHERUSDT'}});
 const before=structuredClone(library),next=withQualityScreeningEntries(study,library);
 const displayed=screeningCell(screeningRowResults(study.samples[0],screeningResultIndex(qualityScreeningResults(study,library))));
 expect(displayed.at).toBe('2026-04-13 19:40:00');expect(displayed.time).toBe(qualityMonitorEntryAt(next.samples[0]));
 expect(next.samples.slice(1)).toEqual(study.samples.slice(1));expect(library).toEqual(before);
 expect(next.samples[0].source).toBe(sample.source);expect(next.samples[0].enteredAt).toBe(SIGNAL_AT);
});

it('honors the displayed round, suppresses stale matching results, and retains admission when only the table is cleared',()=>{
 const {study,library}=firstMatchFixture(),old=library.records[0];
 library.rounds.push({...library.rounds[0],id:'new',startedAt:MATCHED_AT+1});
 library.records.push({...old,id:'new-match',roundId:'new',status:'unmatched',matchedAt:undefined,updatedAt:MATCHED_AT+60000});
 expect(withQualityScreeningEntries(study,library)).toBe(study);
 const selected=withQualityScreeningEntries(study,library,{roundId:'screen'});
 expect(qualityMonitorEntryAt(selected.samples[0])).toBe(MATCHED_AT);
 expect(withQualityScreeningEntries(selected,library,{roundId:'screen',workingRoundId:'new'}).samples[0].monitorEntry).toBeUndefined();
 old.tableClearedAt=MATCHED_AT+60000;
 expect(withQualityScreeningEntries(selected,library,{roundId:'screen'})).toBe(selected);
 expect(withQualityScreeningEntries(selected)).toBe(selected);
});

it.each([undefined,NaN,0])('never falls back to signal time when a matched record has invalid time %s',at=>{
 const {study,library}=firstMatchFixture();library.records[0].matchedAt=at;
 const next=withQualityScreeningEntries(study,library);
 expect(qualityMonitorEntryAt(next.samples[0])).toBeNull();expect(next.samples[0].monitorEntry?.error).toContain('无效');
});

it('requires a specific admission for different first-match times instead of silently picking one',async()=>{
 const {study,library}=firstMatchFixture(),other={...library.rounds[0],id:'other',filters:[{id:'distinct'}] as typeof library.rounds[0]['filters']};
 library.rounds.push(other);library.records.push({...library.records[0],id:'other-match',roundId:'other',matchedAt:MATCHED_AT+60000});
 const next=withQualityScreeningEntries(study,library),load=vi.fn(),results:QualityResult[]=[];
 await collectFishQuality({study:next,task:'monitor',signal:new AbortController().signal,onProgress:vi.fn(),onResult:r=>results.push(r)},load,MATCHED_AT+120000);
 expect(results[0]).toMatchObject({status:'error',reason:expect.stringContaining('多个首次满足时间')});expect(load).not.toHaveBeenCalled();
});
it('uses the single visible first-match time when cleared history contains a different frozen plan and time',()=>{
 const {study,library}=firstMatchFixture(),old={...library.rounds[0],id:'cleared-old',filters:[{id:'older-plan'}] as typeof library.rounds[0]['filters']};
 library.rounds.push(old);library.records.push({...library.records[0],id:'old-match',roundId:old.id,matchedAt:MATCHED_AT-60000,tableClearedAt:MATCHED_AT+60000,updatedAt:MATCHED_AT});
 const before=structuredClone(library),next=withQualityScreeningEntries(study,library);
 expect(qualityMonitorEntryAt(next.samples[0])).toBe(MATCHED_AT);expect(next.samples[0].monitorEntry?.error).toBeUndefined();expect(next.samples[0].monitorEntry?.records).toEqual([JSON.stringify(['screen',library.records[0].id])]);expect(library).toEqual(before);
 // Clearing the visible cell still preserves its saved admission, without rewriting history.
 library.records[0].tableClearedAt=MATCHED_AT+60000;
 expect(withQualityScreeningEntries(next,library,{roundId:'screen'}).samples[0].monitorEntry?.at).toBe(MATCHED_AT);
});

it('restores the same admission from a saved screening snapshot without changing templates or prior results',()=>{
 const {study,library}=firstMatchFixture();study.screeningResults=structuredClone(library.records);study.screeningRounds=structuredClone(library.rounds);
 const next=withQualityScreeningEntries(study);
 expect(qualityMonitorEntryAt(next.samples[0])).toBe(MATCHED_AT);expect(next.screeningResults).toBe(study.screeningResults);
 expect(next.results).toBe(study.results);expect(next.sellPlans).toBe(study.sellPlans);
});

it('keeps standalone filtering at the original input while legacy holding-bound conditions use the admitted buy time',async()=>{
 const {study,library,plan}=firstMatchFixture();
 const filter:QualityBuyFilter={id:'entry-gate',label:'买入条件',enabled:true,metric:'raw',snapshot:plan.snapshot,direction:'>',threshold:101};
 const load:FishReconstructionLoader=async(_s,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
  const time=from+i*p.step,price=time>=MATCHED_AT-5*60000?104:100;
  return {openTime:time,open:price,close:price,high:price,low:price,volume:1,quoteVolume:100,takerBuyQuoteVolume:50,takerBuyVolume:.5};
 });
 const standalone=withQualityScreeningEntries({...study,buyFilters:[filter]},library),readings:QualityFilterReading[]=[],results:QualityResult[]=[];
 await collectFishQuality({study:standalone,task:'filter',signal:new AbortController().signal,onProgress:vi.fn(),onFilterReading:r=>readings.push(r),onResult:r=>results.push(r)},load,MATCHED_AT+60000);
 expect(readings[0].value).toBe(100);expect(results).toEqual([]);
 const begun=beginQualityFilterRound(standalone,{...standalone,filterReadings:readings},MATCHED_AT)!;
 expect(finishQualityFilterRound(begun.study,begun.capture,'complete',MATCHED_AT+1).filterLibrary!.records[0]).toMatchObject({enteredAt:SIGNAL_AT,status:{state:'fail'}});
 const bound={...standalone,independentFilters:undefined,buyFilters:undefined,sellPlans:[freezeQualityPlan({...plan,buyFilters:[filter]})]};
 readings.length=0;
 await collectFishQuality({study:bound,task:'monitor',signal:new AbortController().signal,onProgress:vi.fn(),onFilterReading:r=>readings.push(r),onResult:r=>results.push(r)},load,MATCHED_AT+60000);
 expect(readings[0].value).toBe(104);expect(results[0]).toMatchObject({entryTime:MATCHED_AT,entryPrice:104});
 const current={...bound,filterReadings:readings};
 expect(qualityFilterStatus(current,qualityComparisonRows(current)[0],bound.sellPlans[0]).state).toBe('pass');
});
