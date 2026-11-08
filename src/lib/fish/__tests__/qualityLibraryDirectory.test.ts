import {expect,it} from 'vitest';
import {newQualityStudy,qualityComparisonRows,qualityFilterReadingKey,qualityMembers,type QualitySample} from '../quality';
import {makeQualityBuyFilter} from '../qualityFilters';
import {beginQualityFilterRound,finishQualityFilterRound,preserveQualityFilterLibrary} from '../qualityFilterLibrary';
import {filterDirectoryStudy,entryDirectoryStudy} from '../qualityLibraryDirectory';
import {miningAlgorithmDirectories,miningAlgorithmFamily,miningDirectoryStudy} from '../miningLibraryDirectory';
import {emptyMiningLibrary} from '../miningLibrary';
import {emptyPreEntryLibrary,type PreEntryLibrary} from '../preEntryMonitor';
import {parsePreEntryLibraryBackup} from '../preEntryLibraryTransfer';
import {markSourceDeletions} from '../libraryDeletion';
import {editLibraryDirectory,copyMonitorStudy} from '../qualityMonitorArchive';
import {preserveQualityMonitorLibrary} from '../qualityMonitorLibrary';
import {validateLibraryPayload} from '../libraryTransfer';
import {STATE_DEF,definitionKey} from '@/lib/deepDig/features';
import {latestEntryDirectory,sourceDirectoryKeys} from '../qualitySourceDirectories';
const T=Date.UTC(2026,10,8);
function sample():QualitySample{return {id:'source',source:{id:'source',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:'',quality:4},enteredAt:T,basis:'signal',groups:[],importedAt:T,origin:'library'};}
function filtered(){const study={...newQualityStudy(T),independentFilters:true as const,buyFilters:[makeQualityBuyFilter('state:state','>',.7)],samples:[sample()]};study.selectedRowIds=qualityComparisonRows(study).map(r=>r.id);const first=beginQualityFilterRound(study,study,T)!;first.capture.readings.set(qualityFilterReadingKey(first.capture.tasks[0].sample,study.buyFilters[0]),{key:qualityFilterReadingKey(first.capture.tasks[0].sample,study.buyFilters[0]),value:.8,at:T-60000});return {study:finishQualityFilterRound(first.study,first.capture,'complete',T+1),firstId:first.capture.roundId};}
it('keeps each new filter round independent when the same record is evaluated again, including scores and formula snapshots',()=>{
 const {study:first,firstId}=filtered(),old=structuredClone(first.filterLibrary!.rounds.find(r=>r.id===firstId)!.filterSnapshot);
 const second=beginQualityFilterRound(first,first,T+2)!;second.capture.readings.set(qualityFilterReadingKey(second.capture.tasks[0].sample,first.buyFilters![0]),{key:qualityFilterReadingKey(second.capture.tasks[0].sample,first.buyFilters![0]),value:.2});
 const next=finishQualityFilterRound(second.study,second.capture,'complete',T+3),round=next.filterLibrary!.rounds[0],table=filterDirectoryStudy(next.filterLibrary!,round);
 expect(next.filterLibrary!.rounds.find(r=>r.id===firstId)!.filterSnapshot).toEqual(old);expect(next.filterLibrary!.records[0].readings[0]!.value).toBe(.2);
 expect(table.filterReadings![0].value).toBe(.8);expect(table.samples[0].source.quality).toBe(4);expect(table.buyFilters![0].snapshot).toEqual(first.buyFilters![0].snapshot);
 const stale={...next,filterLibrary:{version:1 as const,settings:next.filterLibrary!.settings,records:next.filterLibrary!.records,rounds:next.filterLibrary!.rounds}};
 const merged=preserveQualityFilterLibrary(next,stale);expect(merged.filterLibrary!.rounds[0].filterSnapshot).toEqual(next.filterLibrary!.rounds[0].filterSnapshot);
 validateLibraryPayload({filter:merged.filterLibrary});
});
it('does not invent missing fields for legacy rounds and prevents source deletion from being undone by directory snapshots',()=>{
 const {study}=filtered(),legacy=structuredClone(study.filterLibrary!);delete legacy.rounds[0].filterSnapshot;delete legacy.records[0].sample;delete legacy.records[0].source.quality;
 const table=filterDirectoryStudy(legacy,legacy.rounds[0]);expect(table.samples[0].source.quality).toBeUndefined();expect(table.groups).toEqual([]);
 const deleted=markSourceDeletions(study,[{source:sample().source,entry:T,origin:'library'}],T+9);
 expect(deleted.filterLibrary!.rounds[0].filterSnapshot!.records).toEqual([]);
});
it('merges reversible directory marks through the existing monitor map understood by older pages',()=>{
 const {study,firstId}=filtered(),hidden=editLibraryDirectory(study,firstId,true,T+3),restored=editLibraryDirectory(hidden,firstId,false,T+2);
 expect(restored.monitorLibrary!.directoryEdits![firstId]).toEqual({hidden:false,at:T+4});
 expect(preserveQualityMonitorLibrary(restored,hidden).monitorLibrary!.directoryEdits).toEqual(restored.monitorLibrary!.directoryEdits);
 const mining=editLibraryDirectory(restored,'mining-family-CDA',true,T+4),entry=editLibraryDirectory(mining,'pre-entry-round',true,T+5);
 expect(entry.monitorLibrary!.directoryEdits).toMatchObject({'mining-family-CDA':{hidden:true},'pre-entry-round':{hidden:true}});
});
it('groups algorithm versions and thresholds by family using actual OR hits and preserves the original mining entry',()=>{
 const snapshot={featureId:'cda',featureShort:'CDA',statistic:'result',direction:'>' as const,threshold:1,average:2,cbi2:2,startAverage:0,previousAverage:0,cutoffMs:T};
 const signal={...sample().source,mined:{anchorMs:T+60000},fish:{...snapshot,combination:'or' as const,hitAlgorithms:[1],algorithms:[snapshot,{...snapshot,featureId:'bss'}]}};
 const records=[{id:'1',runId:'r',anchorMs:T+60000,catchKey:'1',signal,firstSavedAt:T,updatedAt:T},{id:'2',runId:'r2',anchorMs:T+120000,catchKey:'2',signal:{...signal,id:'2',fish:{...snapshot,featureId:'cda-no-btc-v1',threshold:2}},firstSavedAt:T,updatedAt:T}];
 const library={...emptyMiningLibrary(),records},before=structuredClone(library),directories=miningAlgorithmDirectories(library);
 expect(directories.map(d=>d.family)).toEqual(['CDA']);expect(directories[0].records).toHaveLength(2);
 expect(miningAlgorithmFamily({featureId:'cbi2-v2'})).toBe('CBI-2');
 const table=miningDirectoryStudy(records,'CDA');expect(table.samples.map(s=>s.enteredAt).sort()).toEqual([T+60000,T+120000]);expect(table.groups).toHaveLength(2);expect(qualityMembers(table.samples[0].source)).toHaveLength(1);expect(library).toEqual(before);
});
function entry():PreEntryLibrary{const base=sample();return {...emptyPreEntryLibrary(),rounds:[{id:'r',startedAt:T,updatedAt:T,filters:[],hours:0,state:'complete'}],records:[{id:'match',roundId:'r',sample:base,startTime:T,cursor:T+60000,matchedAt:T+60000,status:'matched',readings:[],updatedAt:T+60000},{id:'error',roundId:'r',sample:base,startTime:T,cursor:T,status:'error',readings:[],updatedAt:T}]};}
it('projects only matched entries using the same first-match signal and entry times as the main table',()=>{
 const library=entry(),before=structuredClone(library),table=entryDirectoryStudy(library,library.rounds[0]);expect(table.samples).toHaveLength(1);expect(table.samples[0].source.timeMs).toBe(T+60000);expect(table.samples[0].enteredAt).toBe(T+60000);expect(table.samples[0].source.quality).toBe(4);expect(table.samples[0].source.preEntryMonitor!.sourceTime).toBe(T);expect(table.results).toEqual([]);
 table.samples[0].source.quality=1;expect(library).toEqual(before);
});
it('round-trips admission history without reinterpreting formulas or versions and rejects broken references',()=>{
 const library=entry();library.rounds[0].filters=[makeQualityBuyFilter('state:state','>',.7)];library.rounds[0].filters[0].snapshot.definitionKey=definitionKey(STATE_DEF);
 const backup=(l:PreEntryLibrary)=>JSON.stringify({format:'veil-pre-entry-library',version:1,library:l});expect(parsePreEntryLibraryBackup(backup(library))).toEqual(library);
 library.records[0].roundId='missing';expect(()=>parsePreEntryLibraryBackup(backup(library))).toThrow('入选库记录无效');
});
it('preserves saved templates and their deletion tombstones when a directory without templates is copied',()=>{
 const {study}=filtered(),filter=study.buyFilters![0];
 study.planTemplates=[{id:'keep',name:'核心模板',savedAt:T,updatedAt:T,plan:{id:'plan',label:'原方案',snapshot:filter.snapshot,metric:filter.metric,rule:{metric:filter.metric,direction:'<',threshold:.5}}},{id:'deleted',name:'已删除',savedAt:T,updatedAt:T+1,deleted:true}];
 const original=structuredClone(study.planTemplates),snapshot=filterDirectoryStudy(study.filterLibrary!,study.filterLibrary!.rounds[0]),copy=copyMonitorStudy(study,snapshot,T+9);
 expect(copy.planTemplates).toEqual(original);expect(study.planTemplates).toEqual(original);expect(copy.monitorLibrary!.archives!.at(-1)!.study!.samples).toEqual(study.samples);
 copy.planTemplates![0].plan!.rule!.threshold=.9;expect(study.planTemplates).toEqual(original);
});
it('does not resurrect a deleted source when loading a directory captured before the deletion',()=>{
 const {study}=filtered(),snapshot=filterDirectoryStudy(study.filterLibrary!,study.filterLibrary!.rounds[0]),deleted=markSourceDeletions(study,[{source:sample().source,entry:T,origin:'library'}],T+1),copy=copyMonitorStudy(deleted,snapshot,T+2);
 expect(copy.samples).toEqual([]);expect(copy.deletedSources).toEqual(deleted.deletedSources);
});
it('finds the newest visible screening directory with actual matches, and limits its rows to that round',()=>{
 const library=entry();library.rounds.push({...library.rounds[0],id:'newer-empty',startedAt:T+10},{...library.rounds[0],id:'newer',startedAt:T+5});library.records.push({...library.records[0],id:'new-match',roundId:'newer',matchedAt:T+120000});
 expect(latestEntryDirectory(library)!.id).toBe('newer');expect(latestEntryDirectory(library,{newer:{hidden:true}})!.id).toBe('r');
 const keys=sourceDirectoryKeys({kind:'pre-entry',id:'newer'},newQualityStudy(T),library);expect(keys!.size).toBe(1);
 expect(latestEntryDirectory({...library,records:[]})).toBeUndefined();
});
