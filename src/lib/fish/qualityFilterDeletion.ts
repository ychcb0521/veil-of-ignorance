import {createLibraryRoundReader} from './libraryRounds';
import type {QualityFilterLibrary} from './qualityFilterLibrary';

export interface FilterDirectoryRemoval {
  rounds: string[];
  records: Record<string,number>;
}
export function mergeFilterRemovals(a?:FilterDirectoryRemoval,b?:FilterDirectoryRemoval) {
  if(!a||!b)return a??b;
  const records={...a.records};
  for(const [id,at] of Object.entries(b.records))records[id]=Math.max(records[id]??0,at);
  return {rounds:[...new Set([...a.rounds,...b.rounds])],records};
}

export function pruneFilterDirectories(library:QualityFilterLibrary):QualityFilterLibrary {
  const marks=library.removals;
  if(!marks)return library;
  const removed=new Set(marks.rounds);
  // Most subsequent saves already contain the pruned library. Avoid expanding
  // every frozen round again when there is no stale data to remove or rebase.
  if(!library.rounds.some(round=>removed.has(round.id)||!!round.base&&removed.has(round.base))&&
    !library.records.some(record=>record.updatedAt<=marks.records[record.id]))return library;
  const read=createLibraryRoundReader(library.rounds),referenced=new Set<string>();
  const rounds=library.rounds.filter(round=>!removed.has(round.id)).map(round=>{
    const ids=read(round);
    for(const id of ids)referenced.add(id);
    for(const record of round.filterSnapshot?.records??[])referenced.add(record.id);
    if(!round.base||!removed.has(round.base))return round;
    const {base,added,removed:_removed,...rest}=round;
    return {...rest,recordIds:ids};
  });
  const records=library.records.filter(record=>referenced.has(record.id)||!(record.updatedAt<=marks.records[record.id]));
  return {...library,rounds,records};
}

export function retireFilterDirectory(library:QualityFilterLibrary,id:string):QualityFilterLibrary|undefined {
  if(library.removals?.rounds.includes(id))return library;
  const read=createLibraryRoundReader(library.rounds);
  const selected=library.rounds.find(r=>r.id===id);
  if((!selected&&id!=='filter-legacy')||selected?.state==='running'||selected?.state==='paused')return;
  const candidates=new Set(selected?read(selected):library.records.map(r=>r.id));
  for(const record of selected?.filterSnapshot?.records??[])candidates.add(record.id);
  for(const round of library.rounds)if(round.id!==id){
    for(const key of read(round))candidates.delete(key);
    for(const record of round.filterSnapshot?.records??[])candidates.delete(record.id);
  }
  const records=Object.fromEntries(library.records.filter(r=>candidates.has(r.id)).map(r=>[r.id,r.updatedAt]));
  return pruneFilterDirectories({...library,removals:mergeFilterRemovals(library.removals,{rounds:[id],records})});
}
