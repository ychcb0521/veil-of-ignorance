import { expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { activeBuyFilters, collectFishQuality, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityFilterReadingKey, qualityResultKey, separateQualityFilters, type QualityBuyFilter, type QualityFilterReading, type QualityResult } from '@/lib/fish/quality';
import { enableQualityComparison, qualityComparisonStats } from '@/lib/fish/qualityComparison';
import { beginQualityFilterRound, finishQualityFilterRound } from '@/lib/fish/qualityFilterLibrary';
import { beginQualityMonitorRound } from '@/lib/fish/qualityMonitorLibrary';
import { qualityFilterColumns } from '@/lib/fish/qualityFilterColumns';
import { qualityRunStatusMap } from '@/lib/fish/qualityRunStatus';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
const T = Date.UTC(2026,9,20), M = 60_000;
const def = {id:'test-independent',name:'测试',short:'T',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const,halfLifeHours:6,avgHours:24};
const filter = (threshold=200):QualityBuyFilter => ({id:`f-${threshold}`,label:'测试',metric:'raw',direction:'>',threshold,enabled:true,snapshot:{featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'5m',scale:1,unit:'',direction:'>',threshold,cutoffMs:0,average:0,cbi2:0,startAverage:0,previousAverage:0}});
function base() {
 const study=importQualityLibrary(enableQualityComparison(newQualityStudy(T)),['AAAUSDT','BBBUSDT'].map((symbol,i)=>({id:symbol,symbol,timeMs:T+(7+i*20)*M,timeLabel:'',fallbackZone:''})));
 study.sellPlans=study.sellPlans!.map(plan=>({...plan,execution:undefined,metric:'raw',snapshot:filter().snapshot,rule:{metric:'raw',direction:'<' as const,threshold:101}}));
 study.selectedRowIds=qualityComparisonRows(study).map(row=>row.id);
 return study;
}
const loader = ():FishReconstructionLoader => vi.fn(async(_row,from,cut,plan)=>Array.from({length:Math.max(0,Math.ceil((cut-from)/plan.step))},(_,i)=>({openTime:from+i*plan.step,open:100,high:100,low:100,close:100,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50})));

it('migrates every filter level once without rewriting legacy snapshots, results or later independent edits',()=>{
 const old=base(), [a,b]=old.sellPlans!, f=filter();
 a.buyFilters=[f];b.buyFilters=[f,{...filter(300),enabled:false}];
 const row=qualityComparisonRows(old)[0];
 old.results=[{key:qualityResultKey(row,a,0),sampleId:row.id,groupId:a.id,status:'closed',evaluatedAt:T,entryTime:T,entryPrice:100,endTime:T+M,endPrice:110,pnl:10,returnPct:10}];
 const archived=archiveQualityStudy(old), original=structuredClone(archived), migrated=separateQualityFilters(archived);
 expect(migrated.buyFilters?.map(f=>[f.threshold,f.enabled])).toEqual([[200,true],[300,false]]);
 expect(migrated.legacyFilterBindings).toEqual([{planId:a.id,filters:a.buyFilters},{planId:b.id,filters:b.buyFilters}]);
 expect(migrated.sellPlans!.every(p=>p.buyFilters===undefined)).toBe(true);
 expect(migrated.results).toEqual(old.results);expect(migrated.campaignRuns).toEqual(archived.campaignRuns);expect(archived).toEqual(original);
 expect(activeBuyFilters(migrated,migrated.sellPlans![0])).toEqual([]);
 migrated.buyFilters=[];expect(separateQualityFilters(migrated)).toBe(migrated);
});
it('runs filters with zero sell algorithms, strictly on selected rows, and archives them without a seller',async()=>{
 const study=separateQualityFilters(base()), rows=qualityComparisonRows(study), f=filter();
 study.sellPlans=[];study.buyFilters=[f];study.selectedRowIds=[rows[1].id];
 const reads:QualityFilterReading[]=[], results=vi.fn(), load=loader();
 const begun=beginQualityFilterRound(study,study,T)!;
 await collectFishQuality({study,task:'filter',signal:new AbortController().signal,onProgress:vi.fn(),onResult:results,onFilterReading:r=>reads.push(r)},load,T+90*M);
 expect(load).toHaveBeenCalled();expect(results).not.toHaveBeenCalled();expect(reads).toHaveLength(1);expect(reads[0].key).toBe(qualityFilterReadingKey(rows[1],f));
 const catalog=qualityFilterColumns(study);expect(catalog).toHaveLength(1);expect(catalog[0].plans).toEqual([]);
 for(const r of reads)begun.capture.readings.set(r.key,r);
 const done=finishQualityFilterRound(begun.study,begun.capture,'complete',T+M);
 expect(done.filterLibrary!.settings[0].plans).toEqual([]);expect(done.filterLibrary!.records).toHaveLength(1);expect(done.filterLibrary!.records[0].status.state).toBe('fail');
 expect(done.monitorLibrary).toBeUndefined();expect(done.results).toEqual([]);
});
it.each(['pending','fail','error'] as const)('monitoring ignores %s filters and never submits a filter reading',async state=>{
 const study=separateQualityFilters(base()), rows=qualityComparisonRows(study), f=filter();study.buyFilters=[f];
 if(state!=='pending')study.filterReadings=rows.map(row=>({key:qualityFilterReadingKey(row,f),...(state==='fail'?{value:100}:{error:'filter data missing'})}));
 const reads=vi.fn(), results:QualityResult[]=[];
 await collectFishQuality({study,task:'monitor',signal:new AbortController().signal,onProgress:vi.fn(),onResult:r=>results.push(r),onFilterReading:reads},loader(),T+90*M);
 expect(reads).not.toHaveBeenCalled();expect(results).toHaveLength(4);expect(results.every(r=>r.status==='closed')).toBe(true);
 const done={...study,results}, stats=qualityComparisonStats(done,rows,true), statuses=qualityRunStatusMap(done,rows);
 expect(stats.filter.on).toBe(false);expect(stats.sells.map(s=>s.n)).toEqual([2,2]);
 expect(statuses.get(rows[0].id)?.monitor.complete).toBe(true);
 expect(statuses.get(rows[0].id)?.filter.complete).toBe(state==='fail');
 const round=beginQualityMonitorRound(done,done,T).study;
 expect(round.monitorLibrary!.settings.every(s=>s.plan.buyFilters?.length===0)).toBe(true);
 expect(round.monitorLibrary!.records.every(r=>r.filterStatus.state==='none'&&r.readings.length===0)).toBe(true);
 const changed=beginQualityMonitorRound(round,{...done,buyFilters:[filter(400)]},T+M).study;
 expect(changed.monitorLibrary!.settings).toHaveLength(round.monitorLibrary!.settings.length);
});
