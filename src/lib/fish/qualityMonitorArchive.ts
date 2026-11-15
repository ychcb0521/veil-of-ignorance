import {serializeAccountBlob} from '@/lib/accountBlobCodec';
import {qualityCampaignPath} from '@/lib/campaignSections';
import {hasQualityCampaign, isRetainedQualityRun} from './qualityCampaignArchive';
import {monitorCampaignUnavailable, qualityMonitorCampaignPath} from './qualityMonitorCampaign';
import {setTemplateCampaignPath} from './qualityTemplateTable';
import {renameLibraryDirectoryEdit} from './libraryDirectoryEdits';
import {createQualityTemplateDirectory} from './qualityTemplateDirectory';
import {newQualityStudy,qualityDisplayRows,qualityComparisonRows,qualityResultKey,qualityFilterReadingKey,type FishQualityStudy,type QualitySample,type QualityGroup,type QualityResult} from './quality';
import {archiveQualityMonitorStudy,qualityMonitorRoundRecordIds,type QualityMonitorRound,type QualityMonitorRecord} from './qualityMonitorLibrary';
import {librarySignalIdentity} from './libraryRounds';
import {shortFishHash} from './algorithm';
import {qualityOrigins} from './qualitySources';
import {mergeQualityPlanTemplates} from './qualityPlanTemplates';
import {preserveSourceDeletions} from './libraryDeletion';
/** Older rounds only retain record references. Reconstruct their available frozen fields, never recompute a price or score. */
export function monitorRoundStudy(study:FishQualityStudy,round:QualityMonitorRound, directoryRecords?:readonly QualityMonitorRecord[]):FishQualityStudy{
 const l=study.monitorLibrary;if(!l)return newQualityStudy(round.startedAt);
 const settings=new Map(l.settings.map(s=>[s.id,s]));
 const records=directoryRecords??(()=>{const ids=new Set(qualityMonitorRoundRecordIds(l,round));return l.records.filter(r=>ids.has(r.id)&&settings.has(r.settingId));})();
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
  if(r.result){
   const result={...structuredClone(r.result),sampleId:row.id,groupId:plan.id,key:qualityResultKey(row,plan,0)};
   if(!monitorCampaignUnavailable(r,settings.get(r.settingId)!))setTemplateCampaignPath(result,qualityMonitorCampaignPath(r.id));
   out.results.push(result);
  }
  for(const [i,f] of (plan.buyFilters??[]).entries()){const reading=r.readings[i];if(reading)out.filterReadings!.push({...structuredClone(reading),key:qualityFilterReadingKey(row,f)});}
 }
 return out;
}

/** A working copy owns its nested fields; the prior active table is archived before replacement. */
export function copyMonitorStudy(current:FishQualityStudy,snapshot:FishQualityStudy,at=Date.now(),sourceRoundId?:string):FishQualityStudy{
 let source=current;
 if(sourceRoundId&&current.monitorLibrary&&!current.monitorLibrary.archives?.some(a=>a.sourceRoundId===sourceRoundId)){
  const round=current.monitorLibrary.rounds.find(r=>r.id===sourceRoundId);
  if(round){
   const {monitorLibrary:_monitor,filterLibrary:_filter,campaignRepair:_repair,...frozen}=structuredClone(snapshot);
   const id=`monitor-round-snapshot-${round.id}`,edit=current.monitorLibrary.directoryEdits?.[round.id];
   source={...current,monitorLibrary:{...current.monitorLibrary,...(edit?{directoryEdits:{...current.monitorLibrary.directoryEdits,[id]:{...edit}}}:{}),archives:[...(current.monitorLibrary.archives??[]),{id,version:1,createdAt:round.startedAt,reason:'copy-source',sourceRoundId:round.id,templateDirectory:createQualityTemplateDirectory(current).groupPlans(snapshot.sellPlans ?? []),study:frozen}]}};
  }
 }
 const saved=archiveQualityMonitorStudy(source,at,'copy'),copy=structuredClone(snapshot);
 const {monitorLibrary:_monitor,filterLibrary:_filter,campaignRepair:_repair,...table}=copy;
 const next=preserveSourceDeletions(saved,{...table,planTemplates:structuredClone(mergeQualityPlanTemplates(copy.planTemplates,saved.planTemplates)),monitorLibrary:saved.monitorLibrary,filterLibrary:saved.filterLibrary,campaignRuns:[...(saved.campaignRuns??[]),...(copy.campaignRuns??[]).filter(r=>!saved.campaignRuns?.some(old=>old.result.key===r.result.key))]});
 return {...next,selectedRowIds:qualityDisplayRows(next).map(row=>row.id)};
}
export function editMonitorDirectory(study:FishQualityStudy,id:string,hidden:boolean,at=Date.now()):FishQualityStudy{
 const library=study.monitorLibrary;if(!library||!library.archives?.some(a=>a.id===id)&&!library.rounds.some(r=>r.id===id))return study;
 return {...study,monitorLibrary:{...library,directoryEdits:{...library.directoryEdits,[id]:{...library.directoryEdits?.[id],hidden,at:Math.max(at,(library.directoryEdits?.[id]?.at??0)+1)}}}};
}
/** Reuse the existing durable directory-mark map, understood by already-open older pages. */
export function editLibraryDirectory(study:FishQualityStudy,id:string,hidden:boolean,at=Date.now()):FishQualityStudy{
 const library=study.monitorLibrary??{version:1 as const,importedLegacy:false,settings:[],records:[],rounds:[]};
 return {...study,monitorLibrary:{...library,directoryEdits:{...library.directoryEdits,[id]:{...library.directoryEdits?.[id],hidden,at:Math.max(at,(library.directoryEdits?.[id]?.at??0)+1)}}}};
}
export function renameLibraryDirectory(study:FishQualityStudy,id:string,name:string,at=Date.now()):FishQualityStudy{
 const library=study.monitorLibrary??{version:1 as const,importedLegacy:false,settings:[],records:[],rounds:[]};
 const directoryEdits=renameLibraryDirectoryEdit(library.directoryEdits,id,name,at);
 return directoryEdits===library.directoryEdits?study:{...study,monitorLibrary:{...library,directoryEdits}};
}

/** Archived results may link only to the same persisted trade, never to a later rerun sharing a key. */
export function archivedMonitorCampaignLookup(study:FishQualityStudy){
  const saved=new Map<string,QualityResult>(study.campaignRuns?.filter(run=>!run.supersededBy&&isRetainedQualityRun(run)).map(run=>[run.result.key,run.result]));
  const settings=new Map(study.monitorLibrary?.settings.map(setting=>[setting.id,setting]));
  let records:Map<string,QualityMonitorRecord[]>|undefined;
  return (result:QualityResult)=>{
    if(!hasQualityCampaign(result))return;
    const retained=saved.get(result.key);
    if(retained&&serializeAccountBlob(retained)===serializeAccountBlob(result))return qualityCampaignPath(result.key,'sell');
    if(!records){
      records=new Map();
      for(const record of study.monitorLibrary?.records??[]){
        if(!record.result)continue;
        const key=record.result.key, list=records.get(key);
        if(list)list.push(record);else records.set(key,[record]);
      }
    }
    const matches=records.get(result.key)?.filter(record=>{
      const setting=settings.get(record.settingId);
      return setting&&!monitorCampaignUnavailable(record,setting)&&serializeAccountBlob(record.result)===serializeAccountBlob(result);
    });
    if(matches?.length===1)return qualityMonitorCampaignPath(matches[0].id);
  };
}
