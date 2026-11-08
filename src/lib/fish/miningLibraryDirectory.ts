import {miningLibraryConditions} from './libraryConditions';
import {emptyMiningLibrary,miningRecordSignal,type FishMiningLibrary,type FishMiningRecord} from './miningLibrary';
import {newQualityStudy,importQualityFish,qualityComparisonRows,qualityMembers,qualityGroupId} from './quality';
import type {FishSnapshot} from './algorithm';
export function miningAlgorithmFamily(snapshot:Pick<FishSnapshot,'featureId'|'featureShort'|'statistic'>):string{
 const text=(snapshot.featureId??snapshot.featureShort??snapshot.statistic??'').toLowerCase().replace(/[_\s-]/g,'');
 const families:[RegExp,string][]=[[/^cbi2|^avgcbi2/,'CBI-2'],[/^cda|^avgcda/,'CDA'],[/^bss|^avgbss/,'BSS'],[/^cba|^avgcba/,'CBA'],[/^cbi|^avgcbi/,'CBI'],[/^state|^s\d*$|^avgstate/,'S'],[/^driftspeed|^dsp|^az$/,'DSP'],[/^dbl5/,'DBL-5'],[/^sbs5/,'SBS-5M'],[/^prs6/,'PRS-6H']];
 return families.find(([pattern])=>pattern.test(text))?.[1]??snapshot.featureId??snapshot.featureShort??'未分类';
}
export function miningAlgorithmDirectories(library:FishMiningLibrary){
 const runs=new Map(library.runs.map(r=>[r.id,r])),groups=new Map<string,FishMiningRecord[]>();
 for(const record of library.records){const saved=miningLibraryConditions(record,runs.get(record.runId));
  // An OR scan's non-hits never create a directory membership.
  const families=new Set(saved.conditions.length?saved.conditions.map(c=>miningAlgorithmFamily(c.snapshot)):['未分类']);
  for(const family of families){const list=groups.get(family)??[];list.push(record);groups.set(family,list);}
 }
 return [...groups].map(([family,records])=>({id:'mining-family-'+family,family,records})).sort((a,b)=>a.family.localeCompare(b.family));
}
export function miningFamilyLibrary(library:FishMiningLibrary,records:FishMiningRecord[]):FishMiningLibrary{
 const ids=new Set(records.map(r=>r.id)),runIds=new Set(records.map(r=>r.runId));
 return {...emptyMiningLibrary(),runs:library.runs.filter(r=>runIds.has(r.id)),records,anchors:library.anchors.filter(a=>runIds.has(a.runId)).map(a=>({...a,recordIds:a.recordIds.filter(id=>ids.has(id))}))};
}
export function miningDirectoryStudy(records:readonly FishMiningRecord[],family:string){
 const out=importQualityFish({...newQualityStudy(0),independentFilters:true,sellPlans:[]},records.map(miningRecordSignal),0,'mined');
 const ids=new Set(records.flatMap(r=>qualityMembers(r.signal).filter(s=>miningAlgorithmFamily(s)===family).map(qualityGroupId)));
 out.groups=out.groups.filter(g=>ids.has(g.id));out.samples=out.samples.map(s=>({...s,groups:s.groups.filter(id=>ids.has(id))}));
 out.selectedRowIds=qualityComparisonRows(out).map(r=>r.id);return out;
}
