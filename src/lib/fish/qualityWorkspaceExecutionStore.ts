import {newQualityStudy,type FishQualityStudy} from './quality';
import {qualityWorkspaceData,preserveQualityWorkspace,preserveQualitySignalReadings,preserveQualityFilterDraft} from './qualitySignalReadingsStore';
import {saveQualityStudy as saveHistoricalStudy} from './qualityStore';
import {preserveQualityFilterLibrary} from './qualityFilterLibrary';
import {preserveQualityMonitorLibrary} from './qualityMonitorLibrary';

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
   resolve({...study,workspaceExecution:1,sellPlans:settings.sellPlans,planTemplates:settings.planTemplates});
  };
  tx.onerror=tx.onabort=()=>reject(tx.error??Error('组合表运行读取失败，请重试'));
 });}finally{db.close();}
}
export async function saveQualityWorkspaceExecution(owner:string|undefined,study:FishQualityStudy){
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
 });return true;}finally{db.close();}
}
export const saveExecutableQualityStudy=(owner:string|undefined,study:FishQualityStudy,options?:Parameters<typeof saveHistoricalStudy>[2])=>
 study.workspaceExecution===1?saveQualityWorkspaceExecution(owner,study):options?saveHistoricalStudy(owner,study,options):saveHistoricalStudy(owner,study);

/** Explicit historical reads retain the current working results and append saved rounds. */
export function mergeQualityWorkspaceExecution(history:FishQualityStudy,working:FishQualityStudy){
 const combined=preserveQualityFilterLibrary(working,preserveQualityMonitorLibrary(working,preserveQualityWorkspace(working,history)));
 const readings=<T extends {key:string}>(old:readonly T[]|undefined,next:readonly T[]|undefined)=>[...new Map([...(old??[]),...(next??[])].map(item=>[item.key,item])).values()];
 return {...combined,workspaceExecution:undefined,
  results:[...new Map([...history.results,...working.results].map(result=>[result.key,result])).values()],
  buyFilters:working.buyFilters,independentFilters:working.independentFilters,
  workspaceFilterDraft:working.workspaceFilterDraft,workspaceFilterDraftUpdatedAt:working.workspaceFilterDraftUpdatedAt,
  signalMetrics:working.signalMetrics,signalMetricsUpdatedAt:working.signalMetricsUpdatedAt,turingStaticSettings:working.turingStaticSettings,
  signalReadings:readings(history.signalReadings,working.signalReadings),filterReadings:readings(history.filterReadings,working.filterReadings),
 };
}
