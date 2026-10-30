import {newQualityStudy,qualityComparisonRows,qualityResultKey,qualityFilterReadingKey,type FishQualityStudy,type QualitySample,type QualityGroup} from './quality';
import {qualityMonitorRoundRecordIds,type QualityMonitorRound} from './qualityMonitorLibrary';
import {librarySignalIdentity} from './libraryRounds';
import {shortFishHash} from './algorithm';
import {qualityOrigins} from './qualitySources';
/** Older rounds only retain record references. Reconstruct their available frozen fields, never recompute a price or score. */
export function monitorRoundStudy(study:FishQualityStudy,round:QualityMonitorRound):FishQualityStudy{
 const l=study.monitorLibrary;if(!l)return newQualityStudy(round.startedAt);
 const ids=new Set(qualityMonitorRoundRecordIds(l,round)),settings=new Map(l.settings.map(s=>[s.id,s])),records=l.records.filter(r=>ids.has(r.id)&&settings.has(r.settingId));
 const out:FishQualityStudy={...newQualityStudy(round.startedAt),independentFilters:true,groups:[],sellPlans:[],buyFilters:[],filterReadings:[],entryReadings:[],postExitReadings:[]},samples=new Map<string,QualitySample>(),plans=new Map<string,QualityGroup>();
 const identity=(source:QualitySample['source'],entry:number|null)=>JSON.stringify([librarySignalIdentity(source),entry]);
 for(const r of records){const setting=settings.get(r.settingId)!,planId='archive-'+setting.id;
  if(!plans.has(setting.id)){const plan=structuredClone({...setting.plan,id:planId,buyFilters:(setting.plan.buyFilters??[]).map(f=>({...f,id:planId+'/'+f.id}))});plans.set(setting.id,plan);out.sellPlans!.push(plan);out.buyFilters!.push(...plan.buyFilters??[]);}
  const k=identity(r.source,r.enteredAt),sample:QualitySample=samples.get(k)??{importedAt:r.firstSavedAt,id:'archive-row-'+shortFishHash(k),source:structuredClone(r.source),enteredAt:r.enteredAt,basis:r.basis,groups:[]};
  const origins=r.origins??(r.origin?[r.origin]:!setting.detectors.length&&r.basis==='signal'?['library' as const]:qualityOrigins(sample));sample.origins=[...new Set([...(sample.origins??[]),...origins])];sample.origin=sample.origins.length===1?sample.origins[0]:undefined;
  for(const g of setting.detectors){if(!out.groups.some(d=>d.id===g.id))out.groups.push({...structuredClone(g),snapshot:{...structuredClone(g.snapshot),average:NaN,cbi2:NaN,startAverage:NaN,previousAverage:NaN}});if(!sample.groups.includes(g.id))sample.groups.push(g.id);}
  samples.set(k,sample);
 }
 out.samples=[...samples.values()];
 for(const s of out.samples){const snapshots=out.groups.filter(g=>s.groups.includes(g.id)).map(g=>g.snapshot);if(snapshots.length)s.source={...s.source,fish:{...snapshots[0],algorithms:snapshots}};}
 const rows=new Map(qualityComparisonRows(out).map(s=>[identity(s.source,s.enteredAt),s]));
 for(const r of records){const row=rows.get(identity(r.source,r.enteredAt))!,plan=plans.get(r.settingId)!;
  if(r.result)out.results.push({...structuredClone(r.result),sampleId:row.id,groupId:plan.id,key:qualityResultKey(row,plan,0)});
  for(const [i,f] of (plan.buyFilters??[]).entries()){const reading=r.readings[i];if(reading)out.filterReadings!.push({...structuredClone(reading),key:qualityFilterReadingKey(row,f)});}
 }
 return out;
}
