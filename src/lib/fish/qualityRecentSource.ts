import type {FishQualityStudy} from './quality';
import {createLibraryRoundReader} from './libraryRounds';
export const RECENT_MONITOR_ROUNDS=24;
export type RecentMonitorSource=FishQualityStudy&{olderMonitorRounds?:number};
/** Pure round helpers keep the backup worker free of browser/auth engines. */
export function recentMonitorSource(study:RecentMonitorSource):RecentMonitorSource{
 const library=study.monitorLibrary;
 let monitorLibrary=library,olderMonitorRounds=study.olderMonitorRounds??0;
 if(library){
  const deleted=(id:string)=>library.directoryEdits?.['monitor-permanent:'+id]?.hidden===true;
  const archives=library.archives?.filter(archive=>!deleted(archive.id)),archived=new Set(archives?.map(archive=>archive.sourceRoundId));
  const eligible=library.rounds.filter(round=>!deleted(round.id)&&!library.directoryEdits?.[round.id]?.hidden&&!archived.has(round.id)).sort((a,b)=>b.startedAt-a.startedAt||b.id.localeCompare(a.id));
  const read=createLibraryRoundReader(library.rounds),ids=new Set<string>();
  const rounds=eligible.slice(0,RECENT_MONITOR_ROUNDS).map(round=>{
   const {base:_base,added:_added,removed:_removed,...rest}=round,recordIds=read(round);
   for(const id of recordIds)ids.add(id);return {...rest,recordIds};
  });
  const records=library.records.filter(record=>ids.has(record.id)),settings=new Set(records.map(record=>record.settingId));
  olderMonitorRounds+=Math.max(0,eligible.length-rounds.length);
  monitorLibrary={...library,archives,rounds,records,settings:library.settings.filter(setting=>settings.has(setting.id))};
 }
 return {version:1,startedAt:study.startedAt,entryMode:'capture',observeHours:0,tracking:false,
  groups:[],samples:[],results:[],selectedRowIds:[],monitorLibrary,olderMonitorRounds,planTemplates:study.planTemplates,
  deletedSources:study.deletedSources,deletedReadings:study.deletedReadings,resolvedLegacySources:study.resolvedLegacySources};
}
