import {expect,it} from 'vitest';
import {newQualityStudy,importQualityFish,importQualityLibrary,qualityComparisonRows,qualityDisplayRows,qualityResultKey,migrateQualitySourceRows} from '../quality';
import {qualityOrigins} from '../qualitySources';
import {enableQualityComparison} from '../qualityComparison';
import {beginQualityMonitorRound,captureQualityMonitorResult,archiveQualityMonitorStudy} from '../qualityMonitorLibrary';
import {markSourceDeletions,preserveSourceDeletions} from '../libraryDeletion';
import {signalDedupKey,type TradeSignal} from '@/lib/signalLibrary';
import {shortFishHash} from '../algorithm';
import {librarySignalIdentity} from '../libraryRounds';
import {BSS_DEF,definitionKey} from '@/lib/deepDig/features';
import {beginQualityFilterRound} from '../qualityFilterLibrary';
import {makeQualityBuyFilter} from '../qualityFilters';
const T=Date.UTC(2026,9,30,6),source:TradeSignal={id:'fish',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish:{featureId:'bss',featureShort:'BSS',definitionKey:definitionKey(BSS_DEF),statistic:'结果',cutoffMs:T,threshold:.12,average:.2,cbi2:.2,startAverage:.2,previousAverage:.1,direction:'>',scale:1}};
function fixture(){let s=importQualityFish(newQualityStudy(T),[source],T);s=importQualityFish(s,[{...source,id:'mined'}],T,'mined');s=importQualityLibrary(s,[{...source,id:'library',fish:undefined}],T);return enableQualityComparison(s);}
it('keeps three independent source memberships but executes one trade for identical signal and entry times',()=>{
 const s=fixture(),row=qualityComparisonRows(s)[0];expect(s.samples).toHaveLength(3);expect(qualityComparisonRows(s)).toHaveLength(1);expect(qualityOrigins(row).sort()).toEqual(['fish','library','mined']);expect(row.groups).toHaveLength(1);
 const other=importQualityLibrary(s,[{...source,id:'later',timeMs:T+1,fish:undefined}],T);expect(qualityComparisonRows(other)).toHaveLength(2);
});
it('unlinks only the deleted source in active, durable and archived results, removing shared results only after the last source',()=>{
 let s=fixture();s.selectedRowIds=qualityDisplayRows(s).map(r=>r.id);s.independentFilters=true;s.buyFilters=[makeQualityBuyFilter('state:state','>',.5)];s=beginQualityFilterRound(s,s,T)!.study;const row=qualityComparisonRows(s)[0],plan=s.sellPlans![0],begun=beginQualityMonitorRound(s,s,T+1);s=begun.study;
 const result={key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T+10,status:'closed' as const,returnPct:12};s=captureQualityMonitorResult({...s,results:[result]},begun.capture,result,T+10);s=archiveQualityMonitorStudy(s,T+20);const original=structuredClone(s);
 for(const [i,origin] of (['fish','mined','library'] as const).entries()){
  s=markSourceDeletions(s,[{source,entry:T,origin}],T+100+i);expect(s.filterLibrary!.records).toHaveLength(i===2?0:1);
  expect(s.samples).toHaveLength(2-i);expect(s.results).toHaveLength(i===2?0:1);expect(s.monitorLibrary!.records.length).toBe(i===2?0:original.monitorLibrary!.records.length);expect(s.monitorLibrary!.archives![0].study.results).toHaveLength(i===2?0:1);
  if(i<2){expect(qualityOrigins(qualityComparisonRows(s)[0])).not.toContain(origin);expect(s.results[0].returnPct).toBe(12);}
 }
 expect(original.samples).toHaveLength(3);expect(preserveSourceDeletions(s,original).samples).toEqual([]);
});
it('retains previously saved library-only results and selection under the shared row identity',()=>{
 let s=enableQualityComparison(importQualityLibrary(newQualityStudy(T),[{...source,fish:undefined}],T));const row=qualityComparisonRows(s)[0],old='row-'+shortFishHash(`lib|${signalDedupKey(source)}|${T}`),plan=s.sellPlans![0],key=qualityResultKey({...row,id:old},plan,0);s.results=[{key,sampleId:old,groupId:plan.id,evaluatedAt:T,status:'closed',returnPct:19},{key:'stale-old-threshold',sampleId:old,groupId:plan.id,evaluatedAt:T+1,status:'closed',returnPct:99}];s.selectedRowIds=[old+'/detector/none'];s=migrateQualitySourceRows(s);expect(s.results[0]).toMatchObject({sampleId:row.id,key:qualityResultKey(row,plan,0),returnPct:19});expect(s.results[1].key).toBe('stale-old-threshold');expect(s.selectedRowIds).toEqual([row.id+'/detector/none']);
});
it('lets actual upstream mining records resolve old unscoped cabin deletions, while a new mining deletion remains final',()=>{
 const key=JSON.stringify([librarySignalIdentity(source),T]),legacy={...newQualityStudy(T),deletedSources:{[key]:T+1}},mined=importQualityFish(legacy,[source],T+2,'mined'),resolved=preserveSourceDeletions(legacy,mined);
 expect(resolved.samples).toHaveLength(1);expect(resolved.resolvedLegacySources![key]).toEqual(['mined']);expect(preserveSourceDeletions(resolved,mined).samples).toHaveLength(1);
 const gone=markSourceDeletions(resolved,[{source,entry:T,origin:'mined'}],T+3);expect(preserveSourceDeletions(gone,importQualityFish(gone,[source],T+4,'mined')).samples).toEqual([]);
});
