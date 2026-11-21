import {createLibraryRoundReader} from './libraryRounds';
import {createQualityTemplateDirectory,type QualityTemplateDirectoryGroup} from './qualityTemplateDirectory';
import {monitorRoundStudy} from './qualityMonitorArchive';
import {applyArchiveSourceDeletions} from './libraryDeletion';
import {qualityMonitorArchiveResultCount} from './qualityMonitorLibrary';
import type {FishQualityStudy} from './quality';
export {recentMonitorSource} from './qualityRecentSource';
import type {LibraryDirectoryEdits} from './libraryDirectoryEdits';
import {templateCampaignPath} from './qualityTemplateTable';

// An additive read index. Existing studies, archive IDs and frozen plans remain
// authoritative and are never replaced by this partial representation.
export const RECENT_MONITOR_DIRECTORY_KEY='idb:fish-quality-recent-directory-v1';
export const RECENT_MONITOR_PAGE_SIZE=12;
export const recentMonitorDirectoryKey=(revision:string)=>RECENT_MONITOR_DIRECTORY_KEY+'/'+revision;
export const recentMonitorDeletionsKey=(revision:string)=>'idb:fish-quality-recent-deletions-v1/'+revision;
export interface RecentMonitorEntry {
  id:string;at:number;label:string;summary:string;sourceRoundId?:string;
  templateDirectory:QualityTemplateDirectoryGroup;bodyId?:string;
}
export interface RecentMonitorDirectory {
  version:1;owner:string;sourceRevision:string;generatedAt:number;
  entries:RecentMonitorEntry[];edits?:LibraryDirectoryEdits;total:number;olderMonitorRounds?:number;
  deletions?:Pick<FishQualityStudy,'resolvedLegacySources'|'deletedSources'|'deletedReadings'>;
  deletionsKey?:string;
}
export interface RecentMonitorSnapshot {
  entry:RecentMonitorEntry;
  // Only materialize the requested round. Never clone the multi-GB study.
  body?:()=>FishQualityStudy;
}
export type RecentMonitorBody=FishQualityStudy&{recentMonitorPaths?:Record<string,string>};
export function recentMonitorBody(snapshot:RecentMonitorSnapshot):RecentMonitorBody{
 if(!snapshot.body)throw Error('这份正文需从原归档读取');
 const body=snapshot.body(),paths=Object.fromEntries(body.results.flatMap(result=>{
  const path=templateCampaignPath(result);return path?[[result.key,path]]:[];
 }));
 return Object.keys(paths).length?{...body,recentMonitorPaths:paths}:body;
}
export function recentMonitorSnapshots(study:FishQualityStudy):RecentMonitorSnapshot[]{
  const library=study.monitorLibrary;if(!library)return [];
  const templates=createQualityTemplateDirectory(study,true);
  const settings=new Map(library.settings.map(setting=>[setting.id,setting]));
  const records=new Map(library.records.map((record,index)=>[record.id,{record,index}]));
  const readIds=createLibraryRoundReader(library.rounds);
  const archived=new Set(library.archives?.map(archive=>archive.sourceRoundId));
  const states={running:'运行中',complete:'已完成',paused:'已暂停',failed:'失败'} as const;
  const result:RecentMonitorSnapshot[]=(library.archives??[]).map(archive=>({
    entry:{id:archive.id,at:archive.createdAt,label:archive.reason==='copy'?'载入副本前归档':archive.reason==='copy-source'?'监测轮次快照':'重算前完整归档',
      summary:qualityMonitorArchiveResultCount(archive)==null?'完整快照':qualityMonitorArchiveResultCount(archive)+' 项运行结果',
      sourceRoundId:archive.sourceRoundId,bodyId:archive.study?undefined:archive.id,
      templateDirectory:archive.templateDirectory?templates.present(archive.templateDirectory):templates.groupPlans(archive.study?.sellPlans??[])},
    ...(archive.study?{body:()=>applyArchiveSourceDeletions(archive.study!,study)}:{}),
  }));
  for(const round of library.rounds){
    if(archived.has(round.id))continue;
    const ids=readIds(round),matched=ids.flatMap(id=>{
      const item=records.get(id);return item&&settings.has(item.record.settingId)?[item]:[];
    }).sort((a,b)=>a.index-b.index).map(item=>item.record);
    const plans=[...new Set(matched.map(record=>record.settingId))].map(id=>settings.get(id)!.plan);
    result.push({entry:{id:round.id,at:round.startedAt,label:round.legacy?'历史记录':'监测轮次',
      summary:matched.length+' 条记录 · '+states[round.state]+(round.state==='running'?'（保存时快照）':''),sourceRoundId:round.id,templateDirectory:templates.groupPlans(plans)},
      body:()=>applyArchiveSourceDeletions(monitorRoundStudy(study,round,matched),study)});
  }
  const names=new Map(templates.withHistoricalNames(result.map(({entry})=>({...entry,templateGroup:entry.templateDirectory})),'monitor').map(entry=>[entry.id,entry.templateGroup]));
  return result.map(snapshot=>({...snapshot,entry:{...snapshot.entry,templateDirectory:names.get(snapshot.entry.id)!}}))
    .sort((a,b)=>b.entry.at-a.entry.at||b.entry.id.localeCompare(a.entry.id));
}
export function validRecentMonitorDirectory(value:unknown,owner:string,revision:string):value is RecentMonitorDirectory{
  const v=value as RecentMonitorDirectory|undefined;
  return v?.version===1&&v.owner===owner&&v.sourceRevision===revision&&Number.isFinite(v.generatedAt)
    &&Number.isInteger(v.total)&&v.total>=0&&(!!v.deletions||v.deletionsKey===recentMonitorDeletionsKey(revision))&&Array.isArray(v.entries)&&v.entries.length<=v.total
    &&v.entries.every(entry=>typeof entry.id==='string'&&Number.isFinite(entry.at)
      &&typeof entry.label==='string'&&typeof entry.summary==='string'&&typeof entry.bodyId==='string'
      &&!!entry.templateDirectory&&typeof entry.templateDirectory.title==='string');
}
