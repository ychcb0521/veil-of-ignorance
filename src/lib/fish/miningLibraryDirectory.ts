import {capturedReading,miningHitSnapshots,miningFamilySnapshot} from './libraryConditions';
import {emptyMiningLibrary,miningRecordSignal,type FishMiningLibrary,type FishMiningRecord,type FishMiningRun} from './miningLibrary';
import {newQualityStudy,importQualityFish,qualityComparisonRows,qualityMembers,qualityGroupId,qualityMiningEntryKey} from './quality';
import {fishMetricLabel} from './records';
import type {FishSnapshot} from './algorithm';
export function miningAlgorithmFamily(snapshot:Pick<FishSnapshot,'featureId'|'featureShort'|'statistic'>):string{
 const text=(snapshot.featureId??snapshot.featureShort??snapshot.statistic??'').toLowerCase().replace(/[_\s-]/g,'');
 const families:[RegExp,string][]=[[/^cbi2|^avgcbi2/,'CBI-2'],[/^cda|^avgcda/,'CDA'],[/^bss|^avgbss/,'BSS'],[/^cba|^avgcba/,'CBA'],[/^cbi|^avgcbi/,'CBI'],[/^state|^s\d*$|^avgstate/,'S'],[/^driftspeed|^dsp|^az$/,'DSP'],[/^dbl5/,'DBL-5'],[/^sbs5/,'SBS-5M'],[/^prs6/,'PRS-6H']];
 return families.find(([pattern])=>pattern.test(text))?.[1]??snapshot.featureId??snapshot.featureShort??'未分类';
}
export function miningAlgorithmDirectories(library:FishMiningLibrary){
 const runs=new Map(library.runs.map(r=>[r.id,r])),groups=new Map<string,FishMiningRecord[]>();
 for(const record of library.records){const members=miningHitSnapshots(record,runs.get(record.runId));
  // An OR scan's non-hits never create a directory membership.
  const families=new Set(members.length?members.map(s=>miningAlgorithmFamily(miningFamilySnapshot(s))):['未分类']);
  for(const family of families){const list=groups.get(family)??[];list.push(record);groups.set(family,list);}
 }
 return [...groups].map(([family,records])=>({id:'mining-family-'+family,family,records})).sort((a,b)=>a.family.localeCompare(b.family));
}
export function miningFamilyLibrary(library:FishMiningLibrary,records:FishMiningRecord[]):FishMiningLibrary{
 const ids=new Set(records.map(r=>r.id)),runIds=new Set(records.map(r=>r.runId));
 return {...emptyMiningLibrary(),runs:library.runs.filter(r=>runIds.has(r.id)),records,anchors:library.anchors.filter(a=>runIds.has(a.runId)).map(a=>({...a,recordIds:a.recordIds.filter(id=>ids.has(id))}))};
}
export interface MiningDirectoryEvidence {
 family:string;
 records:readonly FishMiningRecord[];
 runs:ReadonlyMap<string,FishMiningRun>;
}
export interface MiningDetectorReading {
 metric:string;
 seriesKey:string;
 reading?:number;
 rawReading?:number;
 percentile?:number;
 sampleCount?:number;
}
export function miningReadingsByEntry({family,records,runs}:MiningDirectoryEvidence) {
 const byEntry=new Map<string,MiningDetectorReading[]>();
 const distributions=new Map<string,MiningDetectorReading[]>();
 // A frozen formula can be several KB. Keep it once when identifying comparable series.
 const definitions=new Map<string,number>();
 for(const record of records){
  const members=miningHitSnapshots(record,runs.get(record.runId));
  const entry=qualityMiningEntryKey(miningRecordSignal(record));
  const readings=byEntry.get(entry)??[];
  for(const member of members){
   const feature=miningFamilySnapshot(member);
   if(miningAlgorithmFamily(feature)!==family)continue;
   const metric=fishMetricLabel(member), {reading,rawReading,scale}=capturedReading(member);
   const definition=member.definitionKey??'';
   if(!definitions.has(definition))definitions.set(definition,definitions.size);
   const seriesKey=JSON.stringify([feature.featureId??feature.featureShort,metric,definitions.get(definition),member.interval,member.unit,scale]);
   if(readings.some(r=>r.seriesKey===seriesKey&&r.reading===reading&&r.rawReading===rawReading))continue;
   const item:MiningDetectorReading={metric,seriesKey,reading,rawReading};
   readings.push(item);
   if(reading!==undefined){
    const series=distributions.get(seriesKey)??[];
    series.push(item);
    distributions.set(seriesKey,series);
   }
  }
  byEntry.set(entry,readings);
 }
 for(const series of distributions.values()){
  series.sort((a,b)=>a.reading!-b.reading!);
  // Empirical CDF. The last rank in each tie counts all observations <= the value.
  let end=series.length;
  while(end>0){
   const value=series[end-1].reading, percentile=100*end/series.length;
   do{
    const item=series[--end];
    item.percentile=percentile;
    item.sampleCount=series.length;
   }while(end>0&&series[end-1].reading===value);
  }
 }
 return byEntry;
}
export function miningDirectoryStudy(records:readonly FishMiningRecord[],family:string){
 const out=importQualityFish({...newQualityStudy(0),independentFilters:true,sellPlans:[]},records.map(miningRecordSignal),0,'mined');
 const ids=new Set(records.flatMap(r=>qualityMembers(r.signal).filter(s=>miningAlgorithmFamily(s)===family).map(qualityGroupId)));
 out.groups=out.groups.filter(g=>ids.has(g.id));out.samples=out.samples.map(s=>({...s,groups:s.groups.filter(id=>ids.has(id))}));
 out.selectedRowIds=qualityComparisonRows(out).map(r=>r.id);return out;
}
