import {newQualityStudy,qualityEntryIdentity,qualityDisplayRows,type FishQualityStudy,type QualitySample} from './quality';
import {qualityOrigins} from './qualitySources';
import {emptyPreEntryLibrary,mergePreEntryLibraries} from './preEntryMonitor';

/** Independent input copies for a directory union. Source archives and active holding plans stay owned by their stores. */
export function combineDirectoryStudies(studies:readonly FishQualityStudy[]):FishQualityStudy {
 if(!studies.length)throw Error('请至少选择一个目录');
 if(studies.length===1)return structuredClone(studies[0]);
 const out:FishQualityStudy={...newQualityStudy(Math.min(...studies.map(s=>s.startedAt))),independentFilters:true,sellPlans:[]};
 const samples=new Map<string,QualitySample>();
 const groups=new Map<string,FishQualityStudy['groups'][number]>();
 const filters=new Map<string,NonNullable<FishQualityStudy['buyFilters']>[number]>(),readings=new Map<string,NonNullable<FishQualityStudy['filterReadings']>[number]>(),results=new Map<string,FishQualityStudy['results'][number]>();
 let screening=emptyPreEntryLibrary(),hasScreening=false;
 for(const [i,input]of studies.entries()){
  const s=structuredClone(input);
  for(const group of s.groups)if(!groups.has(group.id))groups.set(group.id,group);
  for(const sample of s.samples){
   const previous=samples.get(sample.id);
   if(previous&&qualityEntryIdentity(previous.source,previous.enteredAt)===qualityEntryIdentity(sample.source,sample.enteredAt)){
    const origins=[...new Set([...qualityOrigins(previous),...qualityOrigins(sample)])];
    samples.set(sample.id,{...previous,groups:[...new Set([...previous.groups,...sample.groups])],origins,origin:origins.length===1?origins[0]:undefined});
   }else if(previous){const id=`directory-${i}:${sample.id}`;samples.set(id,{...sample,id});}
   else samples.set(sample.id,sample);
  }
  for(const filter of s.buyFilters??[])if(!filters.has(filter.id))filters.set(filter.id,filter);
  for(const reading of s.filterReadings??[])if(!readings.has(reading.key)||(readings.get(reading.key)!.at??0)<=(reading.at??0))readings.set(reading.key,reading);
  for(const result of s.results)if(!results.has(result.key)||results.get(result.key)!.evaluatedAt<=result.evaluatedAt)results.set(result.key,result);
  if(s.screeningResults||s.screeningRounds){hasScreening=true;screening=mergePreEntryLibraries(screening,{version:1,records:s.screeningResults??[],rounds:s.screeningRounds??[]});}
 }
 out.samples=[...samples.values()];out.groups=[...groups.values()];out.buyFilters=[...filters.values()];out.filterReadings=[...readings.values()];out.results=[...results.values()];
 if(hasScreening){out.screeningResults=screening.records;out.screeningRounds=screening.rounds;}
 out.selectedRowIds=qualityDisplayRows(out).map(row=>row.id);
 return out;
}
