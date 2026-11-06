/** Explicit source deletion, shared by all library views and durable merges. */
import {librarySignalIdentity} from './libraryRounds';
import type {TradeSignal} from '@/lib/signalLibrary';
import {qualityComparisonRows,activeStandaloneBuyFilters,activeBuyFilters,qualityFilterReadingKey,type FishQualityStudy} from './quality';
import type {FishMiningLibrary, FishMiningRecord} from './miningLibrary';
import {miningCaptureTime,qualityOrigins,mergeLegacySourceResolutions,type LegacySourceResolutions,type QualityOrigin,type QualityProvenance} from './qualitySources';
export type SourceDeletions=Record<string,number>;
export type DeleteTarget={source:Pick<TradeSignal,'symbol'|'timeMs'|'exchange'|'market'|'underlying'>;entry:number|null;origin?:QualityOrigin;miningCaptureId?:string};
export const deletionKey=(t:DeleteTarget)=>JSON.stringify(t.miningCaptureId === undefined
 ? [librarySignalIdentity(t.source),t.entry,t.origin??'*']
 : [librarySignalIdentity(t.source),t.entry,'mined-capture',t.miningCaptureId]);
export const fishDeleteTarget=(source:TradeSignal):DeleteTarget=>({source,entry:source.mined?.anchorMs??source.fish?.cutoffMs??null});
export function mergeSourceDeletions(...maps:(SourceDeletions|undefined)[]):SourceDeletions{const out:SourceDeletions={};for(const map of maps)for(const [k,v] of Object.entries(map??{}))if(Number.isFinite(v)&&v>0)out[k]=Math.max(out[k]??0,v);return out;}
export function sourceDeletionMatcher(marks:SourceDeletions={},resolved:LegacySourceResolutions={}){
 const index=new Map<string,{key:string;entry:number|null;origin?:QualityOrigin|'*'|'mined-capture';captureId?:string;at:number}[]>();
 for(const [key,at] of Object.entries(marks)){
  if(!(at>0))continue;
  try{const [source,entry,origin,captureId]=JSON.parse(key),id=JSON.stringify(source),values=index.get(id)??[];values.push({key,entry,origin,captureId,at});index.set(id,values);}catch{/* Invalid legacy marks never match. */}
 }
 return (source:DeleteTarget['source'],entry:number|null,origin?:QualityOrigin,captureId?:string,capturedAt?:number|null)=>!!index.get(JSON.stringify(librarySignalIdentity(source)))?.some(v=>{
  if(v.entry!==null&&v.entry!==entry)return false;
  // A separate tag also keeps older builds from treating this as a whole-source deletion.
  if(v.origin==='mined-capture')return origin==='mined'&&captureId!==undefined&&v.captureId===captureId;
  if(v.origin==='mined'&&origin==='mined'&&capturedAt!=null&&capturedAt>v.at)return false;
  return !origin||v.origin==='*'||!v.origin&&!resolved[v.key]?.includes(origin)||v.origin===origin;
 });
}
/** A remaining capture at this entry still owns its shared filtering and monitoring results. */
export function miningRecordDeleteTargets(records: readonly FishMiningRecord[], selected: ReadonlySet<string>): DeleteTarget[] {
 const retained = new Map<string, Set<string>>();
 for (const record of records) {
  if (selected.has(record.id)) continue;
  const key = deletionKey({ source: record.signal, entry: record.anchorMs, origin: 'mined' });
  const ids = retained.get(key) ?? new Set<string>();
  ids.add(record.signal.id);
  retained.set(key, ids);
 }
 const targets = new Map<string, DeleteTarget>();
 for (const record of records) {
  if (!selected.has(record.id)) continue;
  const target: DeleteTarget = { source: record.signal, entry: record.anchorMs, origin: 'mined' };
  const siblings = retained.get(deletionKey(target));
  if (siblings?.has(record.signal.id)) continue;
  if (siblings) target.miningCaptureId = record.signal.id;
  targets.set(deletionKey(target), target);
 }
 return [...targets.values()];
}
export function markSourceDeletions(study:FishQualityStudy,targets:readonly DeleteTarget[],at=Date.now()):FishQualityStudy{return applySourceDeletions({...study,deletedSources:mergeSourceDeletions(study.deletedSources,Object.fromEntries(targets.map(t=>[deletionKey(t),at])))});}
function pruneRounds<T extends {recordIds?:string[];added?:string[];removed?:string[]}>(rounds:T[],removed:Set<string>):T[]{return rounds.map(r=>({...r,...(r.recordIds?{recordIds:r.recordIds.filter(id=>!removed.has(id))}:{}),...(r.added?{added:r.added.filter(id=>!removed.has(id))}:{}),...(r.removed?{removed:r.removed.filter(id=>!removed.has(id))}:{})}));}
export function applySourceDeletions(study:FishQualityStudy):FishQualityStudy{
 if(!Object.keys(study.deletedSources??{}).length&&!Object.keys(study.deletedReadings??{}).length)return study;
 const gone=sourceDeletionMatcher(study.deletedSources,study.resolvedLegacySources),before=qualityComparisonRows(study),identity=(r:{source:DeleteTarget['source'];enteredAt:number|null})=>JSON.stringify([librarySignalIdentity(r.source),r.enteredAt]),inheritedRows=new Map(before.map(s=>[identity(s),s]));
 const clean=<T extends QualityProvenance & {source:DeleteTarget['source'] & {id?:string};enteredAt:number|null}>(r:T, capture?:TradeSignal):T|undefined=>{
  const inherited=!r.origins&&!r.origin?inheritedRows.get(identity(r)):undefined;
  const origins=qualityOrigins(inherited??r),kept=origins.filter(o=>!gone(r.source,r.enteredAt,o,capture?.id,capture?miningCaptureTime(capture):undefined));
  return !kept.length?undefined:kept.length===origins.length?r:{...r,origin:kept.length===1?kept[0]:undefined,origins:kept};
 };
 const samples=study.samples.flatMap(s=>{const r=clean(s,s.source);return r?[r]:[];}),after=qualityComparisonRows({...study,samples}),remainingIds=new Set([...samples,...after].map(s=>s.id)),sampleIds=new Set([...study.samples,...before].filter(s=>!remainingIds.has(s.id)).map(s=>s.id));
 const filterRecords=study.filterLibrary?.records.flatMap(r=>{const next=clean(r);return next?[next]:[];}),monitorRecords=study.monitorLibrary?.records.flatMap(r=>{const next=clean(r);return next?[next]:[];});
 const keptFilters=new Set(filterRecords?.map(r=>r.id)),keptMonitors=new Set(monitorRecords?.map(r=>r.id)),filterIds=new Set((study.filterLibrary?.records??[]).filter(r=>!keptFilters.has(r.id)).map(r=>r.id)),monitorIds=new Set((study.monitorLibrary?.records??[]).filter(r=>!keptMonitors.has(r.id)).map(r=>r.id)),filters=study.filterLibrary?.records.filter(r=>filterIds.has(r.id))??[],monitors=study.monitorLibrary?.records.filter(r=>monitorIds.has(r.id))??[];
 const removedReadings=new Set(filters.flatMap(r=>r.readings.flatMap(x=>x?[x.key]:[]))),remainingReadings=new Set(study.filterLibrary?.records.filter(r=>!filterIds.has(r.id)).flatMap(r=>r.readings.flatMap(x=>x?[x.key]:[]))??[]);
 const activeFilters=[...activeStandaloneBuyFilters(study),...(study.sellPlans??[]).flatMap(p=>activeBuyFilters(study,p))];for(const sample of after)for(const filter of activeFilters)remainingReadings.add(qualityFilterReadingKey(sample,filter));
 const results=study.results.filter(r=>!sampleIds.has(r.sampleId)),runs=study.campaignRuns?.flatMap(r=>{const sample=clean(r.sample);return sample?[sample===r.sample?r:{...r,sample}]:[];});
 const removedEntries=new Set<string>(),keptEntries=new Set<string>(),removedExits=new Set<string>(),keptExits=new Set<string>();
 const observe=(source:DeleteTarget['source'],entry:number|null,result:{endTime?:number;endPrice?:number}|undefined,removed:boolean)=>{const prefix=JSON.stringify([source.exchange??'binance',source.market??'crypto',source.symbol,source.underlying??null]);(removed?removedEntries:keptEntries).add(prefix+'|'+entry);if(result)(removed?removedExits:keptExits).add(prefix+'|'+result.endTime+'|'+result.endPrice);};
 for(const r of study.monitorLibrary?.records??[])observe(r.source,r.enteredAt,r.result,monitorIds.has(r.id));
 for(const r of study.campaignRuns??[])observe(r.sample.source,r.sample.enteredAt,r.result,!clean(r.sample));
 const bySample=new Map([...study.samples,...qualityComparisonRows(study)].map(s=>[s.id,s]));for(const r of study.results){const s=bySample.get(r.sampleId);if(s)observe(s.source,s.enteredAt,r,sampleIds.has(s.id));}
 const keepObservation=(key:string,exit:boolean)=>{try{const v=JSON.parse(key),k=JSON.stringify(v.slice(1,5))+'|'+v[5]+(exit?'|'+v[6]:'');return !(exit?removedExits:removedEntries).has(k)||(exit?keptExits:keptEntries).has(k);}catch{return true;}};
 const retainedObservation=(key:string,exit:boolean)=>{try{const v=JSON.parse(key),k=JSON.stringify(v.slice(1,5))+'|'+v[5]+(exit?'|'+v[6]:'');return (exit?keptExits:keptEntries).has(k);}catch{return false;}};
 const readingMarks=mergeSourceDeletions(study.deletedReadings),at=Object.values(study.deletedSources??{}).reduce((n,v)=>Math.max(n,v),1);
 for(const key of removedReadings)if(!remainingReadings.has(key))readingMarks[key]=at;
 for(const r of study.entryReadings??[])if(!keepObservation(r.key,false))readingMarks[r.key]=at;
 for(const r of study.postExitReadings??[])if(!keepObservation(r.key,true))readingMarks[r.key]=at;
 // Shared observations remain valid for a surviving origin, including an independent library restored from a legacy unscoped mark.
 for(const key of remainingReadings)delete readingMarks[key];
 for(const r of study.entryReadings??[])if(retainedObservation(r.key,false))delete readingMarks[r.key];
 for(const r of study.postExitReadings??[])if(retainedObservation(r.key,true))delete readingMarks[r.key];
 const filterReadings=study.filterReadings?.filter(r=>!readingMarks[r.key]),entryReadings=study.entryReadings?.filter(r=>!readingMarks[r.key]),postExitReadings=study.postExitReadings?.filter(r=>!readingMarks[r.key]);
 // 正文已单独存放的归档（只有目录）在读出正文时再套用删除标记，见 applyArchiveSourceDeletions。
 const archives=study.monitorLibrary?.archives?.map(a=>{if(!a.study)return a;const next=applyArchiveSourceDeletions(a.study,study);return next===a.study?a:{...a,study:next};});
 const archivesChanged=archives?.some((a,i)=>a!==study.monitorLibrary!.archives![i]);
 const changed=archivesChanged||filterReadings?.length!==study.filterReadings?.length||entryReadings?.length!==study.entryReadings?.length||postExitReadings?.length!==study.postExitReadings?.length||samples.length!==study.samples.length||samples.some((s,i)=>s!==study.samples[i])||filterRecords?.some((r,i)=>r!==study.filterLibrary!.records[i])||monitorRecords?.some((r,i)=>r!==study.monitorLibrary!.records[i])||filters.length||monitors.length||runs?.some((r,i)=>r!==study.campaignRuns![i])||runs?.length!==study.campaignRuns?.length;
 if(!changed)return study;
 return {...study,deletedReadings:readingMarks,samples,results,campaignRuns:runs,selectedRowIds:study.selectedRowIds?.filter(id=>!sampleIds.has(id)&&!sampleIds.has(id.split('/detector/')[0])),
  filterReadings,entryReadings,postExitReadings,
  ...(study.filterLibrary?{filterLibrary:{...study.filterLibrary,records:filterRecords!,rounds:pruneRounds(study.filterLibrary.rounds,filterIds)}}:{}),
  ...(study.monitorLibrary?{monitorLibrary:{...study.monitorLibrary,...(archives?{archives}:{}),records:monitorRecords!,rounds:pruneRounds(study.monitorLibrary.rounds,monitorIds)}}:{})};
}
/** 归档快照套用当前总表的删除标记（标记只增不减，读出时再套用与保存时套用结果一致）。 */
export function applyArchiveSourceDeletions<T extends Omit<FishQualityStudy,'monitorLibrary'|'filterLibrary'|'campaignRepair'>>(archived:T,current:Pick<FishQualityStudy,'resolvedLegacySources'|'deletedSources'|'deletedReadings'>):T{const input={...archived,resolvedLegacySources:mergeLegacySourceResolutions(archived.resolvedLegacySources,current.resolvedLegacySources),deletedSources:mergeSourceDeletions(archived.deletedSources,current.deletedSources),deletedReadings:mergeSourceDeletions(archived.deletedReadings,current.deletedReadings)},next=applySourceDeletions(input as FishQualityStudy);return next===input?archived:next as unknown as T;}
export function preserveSourceDeletions(saved:FishQualityStudy|undefined,incoming:FishQualityStudy){if(saved===incoming)return incoming;const marks=mergeSourceDeletions(saved?.deletedSources,incoming.deletedSources);return Object.keys(marks).length?applySourceDeletions({...incoming,resolvedLegacySources:mergeLegacySourceResolutions(saved?.resolvedLegacySources,incoming.resolvedLegacySources),deletedSources:marks,deletedReadings:mergeSourceDeletions(saved?.deletedReadings,incoming.deletedReadings)}):incoming;}
export function pruneMiningDeletions(library:FishMiningLibrary):FishMiningLibrary{const ids=new Set(Object.keys(library.deletedRecords??{}));if(!ids.size)return library;return {...library,records:library.records.filter(r=>!ids.has(r.id)),anchors:library.anchors.map(a=>({...a,recordIds:a.recordIds.filter(id=>!ids.has(id))}))};}
export function deleteMiningRecords(library:FishMiningLibrary,ids:readonly string[],at=Date.now()):FishMiningLibrary{return pruneMiningDeletions({...library,deletedRecords:mergeSourceDeletions(library.deletedRecords,Object.fromEntries(ids.map(id=>[id,at])))});}
