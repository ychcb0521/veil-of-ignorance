import type {FishQualityStudy,QualityGroup} from './quality';
import {mergeQualityPlanCatalogValues} from '../qualityPlanCatalogMerge';
import {readPersistedStateRaw,writePersistedStateRaw} from '../persistedStateStorage';

export const QUALITY_SAVED_PLANS_KEY='quality_sell_plans_v1';
export interface SavedQualityPlan {id:string;updatedAt:number;position:number;deleted?:true;plan?:QualityGroup}
export const qualitySavedPlansKey=(owner?:string)=>`sim_${owner??'anon'}_${QUALITY_SAVED_PLANS_KEY}`;
export function readSavedQualityPlans(owner?:string):SavedQualityPlan[]{
 try{return mergeSavedQualityPlans([],JSON.parse(readPersistedStateRaw(qualitySavedPlansKey(owner))??'[]'));}catch{return [];}
}
export const mergeSavedQualityPlans=(a:unknown,b:unknown):SavedQualityPlan[]=>
 (mergeQualityPlanCatalogValues(a,b) as SavedQualityPlan[]).filter(p=>p.deleted||p.plan?.id===p.id&&!!p.plan.snapshot).sort((x,y)=>(x.position??0)-(y.position??0)||x.id.localeCompare(y.id));
/** Only missing IDs are backfilled. Old study writes cannot revise or resurrect catalog entries. */
export function seedSavedQualityPlans(entries:readonly SavedQualityPlan[],plans:readonly QualityGroup[]=[]):SavedQualityPlan[]{
 const known=new Set(entries.map(p=>p.id));
 return [...entries,...plans.flatMap((p,position)=>known.has(p.id)?[]:[{id:p.id,updatedAt:0,position,plan:structuredClone(p)}])];
}
/** Called only by an explicit Save, never by results/mining/pagehide writes. */
export function editSavedQualityPlans(entries:readonly SavedQualityPlan[],previous:readonly QualityGroup[],next:readonly QualityGroup[],now=Date.now()):SavedQualityPlan[]{
 const before=new Map(previous.map(p=>[p.id,p])),remaining=new Set(next.map(p=>p.id)),updates:SavedQualityPlan[]=[];
 const stamp=Math.max(now,...entries.map(p=>p.updatedAt+1));
 next.forEach((plan,position)=>{
  if(JSON.stringify(before.get(plan.id))!==JSON.stringify(plan))updates.push({id:plan.id,updatedAt:stamp,position,plan:structuredClone(plan)});
 });
 previous.forEach((plan,position)=>{if(!remaining.has(plan.id))updates.push({id:plan.id,updatedAt:stamp,position,deleted:true,plan:structuredClone(plan)});});
 return mergeSavedQualityPlans(seedSavedQualityPlans(entries,previous),updates);
}
export function applySavedQualityPlans(study:FishQualityStudy,entries:readonly SavedQualityPlan[]):FishQualityStudy{
 if(!entries.length)return study;
 const saved=new Map(entries.map(p=>[p.id,p])),plans:QualityGroup[]=[],seen=new Set<string>();
 for(const p of study.sellPlans??[]){const entry=saved.get(p.id);if(entry?.deleted)continue;plans.push(entry?.plan??p);seen.add(p.id);}
 for(const entry of [...entries].sort((a,b)=>a.position-b.position))if(!entry.deleted&&entry.plan&&!seen.has(entry.id)){plans.push(entry.plan);seen.add(entry.id);}
 if(study.sellPlansConfigured&&JSON.stringify(plans)===JSON.stringify(study.sellPlans))return study;
 return {...study,sellPlans:structuredClone(plans),sellPlansConfigured:true,selectedSellId:plans.some(p=>p.id===study.selectedSellId)?study.selectedSellId:undefined};
}
/** Small, independent account key: old pages writing the huge study do not own it. */
export function writeSavedQualityPlans(owner:string|undefined,entries:readonly SavedQualityPlan[]):SavedQualityPlan[]{
 const merged=mergeSavedQualityPlans(readSavedQualityPlans(owner),entries);
 const fullKey=qualitySavedPlansKey(owner),raw=JSON.stringify(merged);
 if(readPersistedStateRaw(fullKey)!==raw)writePersistedStateRaw(fullKey,raw);return merged;
}

export interface RecoverableQualityPlan {plan:QualityGroup;at:number;source:string}
/** Offer frozen historical snapshots for review. Never silently restore a user's deletions. */
export function recoverableQualityPlans(study:FishQualityStudy,entries:readonly SavedQualityPlan[]=[]):RecoverableQualityPlan[]{
 const active=new Set(study.sellPlans?.map(p=>p.id)),candidates=new Map<string,RecoverableQualityPlan>();
 const add=(plan:QualityGroup|undefined,at:number,source:string)=>{if(!plan?.id||active.has(plan.id))return;const old=candidates.get(plan.id);if(!old||at>old.at)candidates.set(plan.id,{plan,at,source});};
 const times=new Map<string,number>();for(const r of study.monitorLibrary?.records??[])times.set(r.settingId,Math.max(times.get(r.settingId)??0,r.updatedAt));
 for(const s of study.monitorLibrary?.settings??[])add(s.plan,times.get(s.id)??0,'监测快照');
 for(const r of study.campaignRuns??[])add(r.plan,r.result.evaluatedAt,'战役快照');
 for(const e of entries)add(e.plan,e.updatedAt,'已保存方案');
 return [...candidates.values()].sort((a,b)=>b.at-a.at);
}
