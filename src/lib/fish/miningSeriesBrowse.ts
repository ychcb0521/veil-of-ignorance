import type {FishMiningLibrary} from './miningLibrary';
import type {BrowseRow} from './libraryBrowse';
import {miningRecordSavedAt} from './libraryDeletion';
import {miningBrowseRows,miningBrowseSeriesRows} from './libraryBrowseProjection';
import {miningSeriesTypes,miningSeriesDirectoryId} from './miningSeries';
export type BrowseGroupRows={id:string;title:string;at:number;rows:BrowseRow[];children?:BrowseGroupRows[]};
type GroupRows=BrowseGroupRows;
export function miningBrowseSeriesGroups(library:FishMiningLibrary,edits?:Record<string,{hidden?:boolean;at:number;name?:string}>) {
 const groups=new Map<string,GroupRows>(),runs=new Map(library.runs.map(r=>[r.id,r]));
 for(const record of library.records){
   const parents=new Set<string>();
   const parentRows=new Map(miningBrowseRows(record,runs.get(record.runId)).map(item=>[item.family,item.row]));
   for(const {family,series,row} of miningBrowseSeriesRows(record,runs.get(record.runId))){
     const id='mining-family-'+family,edit=edits?.[id];
     if(edit?.hidden&&miningRecordSavedAt(record)<=edit.at)continue;
     const group:GroupRows=groups.get(id)??{id,at:0,title:edit?.name??family+' 系列',rows:[],children:miningSeriesTypes.map(type=>({id:miningSeriesDirectoryId(id,type.id),title:type.label,at:0,rows:[]}))};
     if(!parents.has(id)){group.rows.push(parentRows.get(family)!);parents.add(id);}
     group.at=Math.max(group.at,row[1]);
     const childId=miningSeriesDirectoryId(id,series.id);
     let child=group.children!.find(item=>item.id===childId);
     if(!child){child={id:childId,title:series.label,at:0,rows:[]};group.children!.push(child);}
     child.rows.push(row);child.at=Math.max(child.at,row[1]);groups.set(id,group);
   }
 }
 return [...groups.values()];
}
