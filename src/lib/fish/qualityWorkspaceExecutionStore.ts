import {newQualityStudy,standaloneBuyFilters,type FishQualityStudy} from './quality';
import {qualityWorkspaceData,preserveQualityWorkspace,preserveQualitySignalReadings,preserveQualityFilterDraft} from './qualitySignalReadingsStore';
import {saveQualityStudy as saveHistoricalStudy} from './qualityStore';
import {serializeArchiveWork} from '../serializeArchiveWork';
export {mergeQualityWorkspaceExecution} from './qualityWorkspaceExecutionMerge';

export function independentWorkspaceFilters(study:FishQualityStudy):FishQualityStudy {
 return study.independentFilters ? study : {...study,independentFilters:true,buyFilters:standaloneBuyFilters(study)};
}
const key=(owner?:string)=>'fish-quality:'+(owner??'anonymous');
const executionKey=(owner?:string)=>key(owner)+':workspace-execution-v1';
async function open(){return new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open('veil-fish-quality-v1',1);
 let expired=false;const timer=setTimeout(()=>{expired=true;reject(Error('组合表运行存储超时，请重试'));},8000);
 request.onupgradeneeded=()=>request.result.createObjectStore('studies');
 request.onsuccess=()=>{clearTimeout(timer);if(expired)request.result.close();else resolve(request.result);};request.onerror=request.onblocked=()=>{expired=true;clearTimeout(timer);reject(Error('组合表运行存储不可用，请重试'));};
});}
/** Read the independent working table and settings siblings, never the old study row. */
export async function loadQualityWorkspaceExecution(owner:string|undefined,information:FishQualityStudy,settings:FishQualityStudy){
 const db=await open();
 try{return await new Promise<FishQualityStudy>((resolve,reject)=>{
  const tx=db.transaction('studies','readonly'),store=tx.objectStore('studies');
  const execution=store.get(executionKey(owner)),readings=store.get(key(owner)+':signal-readings'),filter=store.get(key(owner)+':workspace-filter');
  tx.oncomplete=()=>{
   const saved=execution.result as FishQualityStudy|undefined;
   const base=preserveQualityFilterDraft(filter.result,preserveQualitySignalReadings(readings.result,{...newQualityStudy(),...settings,...saved,workspaceExecution:1 as const}));
   const study=preserveQualityWorkspace(information,base);
   // The small settings catalog owns plans and templates; captured records own their detector groups.
   resolve(independentWorkspaceFilters({...study,workspaceExecution:1,sellPlans:settings.sellPlans,planTemplates:settings.planTemplates}));
  };
  tx.onerror=tx.onabort=()=>reject(tx.error??Error('组合表运行读取失败，请重试'));
 });}finally{db.close();}
}
export function saveQualityWorkspaceExecution(owner:string|undefined,study:FishQualityStudy){
 return serializeArchiveWork(async()=>{
 const db=await open();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('studies','readwrite'),store=tx.objectStore('studies');
  tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??Error('组合表运行保存失败，请重试'));
  const request=store.get(key(owner)+':workspace');
  request.onsuccess=()=>{
   try{
    const next=preserveQualityWorkspace(request.result,study);
    // Independent keys are invisible to older writers. Frozen assets stay in their own catalog.
    store.put({...next,planTemplates:undefined,workspaceExecution:1},executionKey(owner));
    if(next.workspaceUpdatedAt)store.put(qualityWorkspaceData(next),key(owner)+':workspace');
   }catch(cause){tx.abort();reject(cause);}
  };
 });
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('fish-quality-saved',{detail:{owner}}));
 return true;}finally{db.close();}
 });
}
export const saveExecutableQualityStudy=(owner:string|undefined,study:FishQualityStudy,options?:Parameters<typeof saveHistoricalStudy>[2])=>
 study.workspaceExecution===1?saveQualityWorkspaceExecution(owner,study):options?saveHistoricalStudy(owner,study,options):saveHistoricalStudy(owner,study);
