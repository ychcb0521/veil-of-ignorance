/** Explicit source deletion, shared by all library views and durable merges. */
import {librarySignalIdentity} from './libraryRounds';
import type {TradeSignal} from '@/lib/signalLibrary';
import type {FishQualityStudy} from './quality';
import type {FishMiningLibrary} from './miningLibrary';
export type SourceDeletions=Record<string,number>;
export type DeleteTarget={source:Pick<TradeSignal,'symbol'|'timeMs'|'exchange'|'market'|'underlying'>;entry:number|null};
export const deletionKey=(t:DeleteTarget)=>JSON.stringify([librarySignalIdentity(t.source),t.entry]);
export const fishDeleteTarget=(source:TradeSignal):DeleteTarget=>({source,entry:source.mined?.anchorMs??source.fish?.cutoffMs??null});
export function mergeSourceDeletions(...maps:(SourceDeletions|undefined)[]):SourceDeletions{const out:SourceDeletions={};for(const map of maps)for(const [k,v] of Object.entries(map??{}))if(Number.isFinite(v)&&v>0)out[k]=Math.max(out[k]??0,v);return out;}
export function sourceDeletionMatcher(marks:SourceDeletions={}){const index=new Map<string,Set<number|null>>();for(const [key,at] of Object.entries(marks)){if(!(at>0))continue;try{const [source,entry]=JSON.parse(key),id=JSON.stringify(source),values=index.get(id)??new Set<number|null>();values.add(entry);index.set(id,values);}catch{/* Invalid legacy marks never match. */}}return (source:DeleteTarget['source'],entry:number|null)=>{const values=index.get(JSON.stringify(librarySignalIdentity(source)));return !!values&&(values.has(null)||values.has(entry));};}
export function markSourceDeletions(study:FishQualityStudy,targets:readonly DeleteTarget[],at=Date.now()):FishQualityStudy{return applySourceDeletions({...study,deletedSources:mergeSourceDeletions(study.deletedSources,Object.fromEntries(targets.map(t=>[deletionKey(t),at])))});}
function pruneRounds<T extends {recordIds?:string[];added?:string[];removed?:string[]}>(rounds:T[],removed:Set<string>):T[]{return rounds.map(r=>({...r,...(r.recordIds?{recordIds:r.recordIds.filter(id=>!removed.has(id))}:{}),...(r.added?{added:r.added.filter(id=>!removed.has(id))}:{}),...(r.removed?{removed:r.removed.filter(id=>!removed.has(id))}:{})}));}
export function applySourceDeletions(study:FishQualityStudy):FishQualityStudy{
 if(!Object.keys(study.deletedSources??{}).length&&!Object.keys(study.deletedReadings??{}).length)return study;
 const gone=sourceDeletionMatcher(study.deletedSources),samples=study.samples.filter(s=>!gone(s.source,s.enteredAt)),sampleIds=new Set(study.samples.filter(s=>gone(s.source,s.enteredAt)).map(s=>s.id));
 const filters=study.filterLibrary?.records.filter(r=>gone(r.source,r.enteredAt))??[],monitors=study.monitorLibrary?.records.filter(r=>gone(r.source,r.enteredAt))??[],filterIds=new Set(filters.map(r=>r.id)),monitorIds=new Set(monitors.map(r=>r.id));
 const removedReadings=new Set(filters.flatMap(r=>r.readings.flatMap(x=>x?[x.key]:[]))),remainingReadings=new Set(study.filterLibrary?.records.filter(r=>!filterIds.has(r.id)).flatMap(r=>r.readings.flatMap(x=>x?[x.key]:[]))??[]);
 const results=study.results.filter(r=>!sampleIds.has(r.sampleId)),runs=study.campaignRuns?.filter(r=>!gone(r.sample.source,r.sample.enteredAt));
 const removedEntries=new Set<string>(),keptEntries=new Set<string>(),removedExits=new Set<string>(),keptExits=new Set<string>();
 const observe=(source:DeleteTarget['source'],entry:number|null,result:{endTime?:number;endPrice?:number}|undefined,removed:boolean)=>{const prefix=JSON.stringify([source.exchange??'binance',source.market??'crypto',source.symbol,source.underlying??null]);(removed?removedEntries:keptEntries).add(prefix+'|'+entry);if(result)(removed?removedExits:keptExits).add(prefix+'|'+result.endTime+'|'+result.endPrice);};
 for(const r of study.monitorLibrary?.records??[])observe(r.source,r.enteredAt,r.result,monitorIds.has(r.id));
 for(const r of study.campaignRuns??[])observe(r.sample.source,r.sample.enteredAt,r.result,gone(r.sample.source,r.sample.enteredAt));
 const bySample=new Map(study.samples.map(s=>[s.id,s]));for(const r of study.results){const s=bySample.get(r.sampleId);if(s)observe(s.source,s.enteredAt,r,sampleIds.has(s.id));}
 const keepObservation=(key:string,exit:boolean)=>{try{const v=JSON.parse(key),k=JSON.stringify(v.slice(1,5))+'|'+v[5]+(exit?'|'+v[6]:'');return !(exit?removedExits:removedEntries).has(k)||(exit?keptExits:keptEntries).has(k);}catch{return true;}};
 const readingMarks=mergeSourceDeletions(study.deletedReadings),at=Object.values(study.deletedSources??{}).reduce((n,v)=>Math.max(n,v),1);
 for(const key of removedReadings)if(!remainingReadings.has(key))readingMarks[key]=at;
 for(const r of study.entryReadings??[])if(!keepObservation(r.key,false))readingMarks[r.key]=at;
 for(const r of study.postExitReadings??[])if(!keepObservation(r.key,true))readingMarks[r.key]=at;
 const filterReadings=study.filterReadings?.filter(r=>!readingMarks[r.key]),entryReadings=study.entryReadings?.filter(r=>!readingMarks[r.key]),postExitReadings=study.postExitReadings?.filter(r=>!readingMarks[r.key]);
 const changed=filterReadings?.length!==study.filterReadings?.length||entryReadings?.length!==study.entryReadings?.length||postExitReadings?.length!==study.postExitReadings?.length||samples.length!==study.samples.length||filters.length||monitors.length||runs?.length!==study.campaignRuns?.length;
 if(!changed)return study;
 return {...study,deletedReadings:readingMarks,samples,results,campaignRuns:runs,selectedRowIds:study.selectedRowIds?.filter(id=>!sampleIds.has(id)&&!sampleIds.has(id.split('/detector/')[0])),
  filterReadings,entryReadings,postExitReadings,
  ...(study.filterLibrary?{filterLibrary:{...study.filterLibrary,records:study.filterLibrary.records.filter(r=>!filterIds.has(r.id)),rounds:pruneRounds(study.filterLibrary.rounds,filterIds)}}:{}),
  ...(study.monitorLibrary?{monitorLibrary:{...study.monitorLibrary,records:study.monitorLibrary.records.filter(r=>!monitorIds.has(r.id)),rounds:pruneRounds(study.monitorLibrary.rounds,monitorIds)}}:{})};
}
export function preserveSourceDeletions(saved:FishQualityStudy|undefined,incoming:FishQualityStudy){if(saved===incoming)return incoming;const marks=mergeSourceDeletions(saved?.deletedSources,incoming.deletedSources);return Object.keys(marks).length?applySourceDeletions({...incoming,deletedSources:marks,deletedReadings:mergeSourceDeletions(saved?.deletedReadings,incoming.deletedReadings)}):incoming;}
export function pruneMiningDeletions(library:FishMiningLibrary):FishMiningLibrary{const ids=new Set(Object.keys(library.deletedRecords??{}));if(!ids.size)return library;return {...library,records:library.records.filter(r=>!ids.has(r.id)),anchors:library.anchors.map(a=>({...a,recordIds:a.recordIds.filter(id=>!ids.has(id))}))};}
export function deleteMiningRecords(library:FishMiningLibrary,ids:readonly string[],at=Date.now()):FishMiningLibrary{return pruneMiningDeletions({...library,deletedRecords:mergeSourceDeletions(library.deletedRecords,Object.fromEntries(ids.map(id=>[id,at])))});}
