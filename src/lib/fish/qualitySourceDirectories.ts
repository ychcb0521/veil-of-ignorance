import {qualityEntryIdentity,type FishQualityStudy,type QualitySample} from './quality';
import {filterDirectoryData} from './qualityLibraryDirectory';
import {preEntrySignal,type PreEntryLibrary} from './preEntryMonitor';
import {miningAlgorithmFamily} from './miningLibraryDirectory';
export interface QualitySourceDirectory {kind:'filter'|'pre-entry'|'mined';id:string}
export function latestEntryDirectory(library:PreEntryLibrary|undefined,edits:Record<string,{hidden:boolean}>={}){
 const matched=new Set(library?.records.filter(r=>!!preEntrySignal(r)).map(r=>r.roundId));
 return library?.rounds.filter(r=>matched.has(r.id)&&!edits[r.id]?.hidden).sort((a,b)=>b.startedAt-a.startedAt||b.id.localeCompare(a.id))[0];
}
export function sourceDirectoryKeys(choice:QualitySourceDirectory|undefined,study:Pick<FishQualityStudy,'filterLibrary'>,entry?:PreEntryLibrary):Set<string>|undefined{
 if(!choice||choice.kind==='mined')return;
 if(choice.kind==='filter'){
  const library=study.filterLibrary;if(!library)return new Set();const round=library.rounds.find(r=>r.id===choice.id);
  if(!round&&choice.id!=='filter-legacy')return new Set();
  return new Set(filterDirectoryData(library,round).records.map(r=>qualityEntryIdentity(r.source,r.enteredAt)));
 }
 return new Set((entry?.records??[]).filter(r=>r.roundId===choice.id).flatMap(r=>{const signal=preEntrySignal(r);return signal?[qualityEntryIdentity(signal,signal.timeMs)]:[];}));
}
export function matchesMiningDirectory(row:QualitySample,groups:FishQualityStudy['groups'],id:string){
 const group=groups.find(g=>g.id===row.detectorId);return !!group&&miningAlgorithmFamily(group.snapshot)===id.replace(/^mining-family-/,'');
}
