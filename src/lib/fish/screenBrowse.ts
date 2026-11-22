import type {BrowseGroup,BrowseRow} from './libraryBrowse';
import type {PreEntryLibrary} from './preEntryMonitor';
import type {PreEntryTableClears} from './preEntryTableClears';
import type {LibraryDirectoryEdits} from './libraryDirectoryEdits';
import {mergeLibraryDirectoryEdits} from './libraryDirectoryEdits';

export interface ScreenBrowse {groups:BrowseGroup[];pages:Record<string,BrowseRow[]>}
export function screenBrowse(library:PreEntryLibrary,marks:PreEntryTableClears,directoryEdits?:LibraryDirectoryEdits):ScreenBrowse|undefined{
  const edits=mergeLibraryDirectoryEdits(directoryEdits,library.directoryEdits);
  const byRound=new Map<string,BrowseRow[]>();
  for(const record of library.records){
    if(record.status!=='matched'||edits[record.roundId]?.hidden)continue;
    const bucket=byRound.get(record.roundId)??[],source=record.sample.source;
    bucket.push([source.symbol,source.timeMs,['已入选',record.detail,(marks[record.id]||record.tableClearedAt)?'组合表已清除':''].filter(Boolean).join(' · '),record.id]);
    byRound.set(record.roundId,bucket);
  }
  const pages:Record<string,BrowseRow[]>={},groups:BrowseGroup[]=[];
  for(const round of library.rounds){
    if(round.workspaceDraft||edits[round.id]?.hidden)continue;
    const rows=byRound.get(round.id)??[];
    if(!rows.length&&!round.workspaceSaved)continue;
    rows.sort((a,b)=>b[1]-a[1]||b[3].localeCompare(a[3]));
    const group={id:round.id,at:round.startedAt,title:edits[round.id]?.name??(round.workspaceSaved?'筛选轮次':'入选轮次'),count:rows.length,pages:[] as string[]};
    for(let offset=0;offset<rows.length;offset+=350){
      const key=round.id+'/'+offset;group.pages.push(key);pages[key]=rows.slice(offset,offset+350);
    }
    groups.push(group);
  }
  return groups.length?{groups:groups.sort((a,b)=>b.at-a.at),pages}:undefined;
}
