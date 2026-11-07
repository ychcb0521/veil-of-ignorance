import {mergeSavedQualityPlans,readSavedQualityPlans,writeSavedQualityPlans,type SavedQualityPlan} from './qualitySavedPlans';
const STORE='catalogs',writes=new Map<string,Promise<SavedQualityPlan[]>>();
const key=(owner?:string)=>`saved-quality-plans:${owner??'anonymous'}`;
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 if(typeof indexedDB==='undefined'){reject(Error('方案存档不可用'));return;}
 const request=indexedDB.open('veil-quality-sell-plans-v1',1);let expired=false;
 const timer=setTimeout(()=>{expired=true;reject(Error('方案存档超时'));},8000);
 request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
 request.onsuccess=()=>{clearTimeout(timer);if(expired){request.result.close();return;}resolve(request.result);};request.onerror=request.onblocked=()=>{expired=true;clearTimeout(timer);reject(request.error??Error('方案存档被占用'));};
});}
export function saveDurableQualityPlans(owner:string|undefined,entries:readonly SavedQualityPlan[]):Promise<SavedQualityPlan[]>{
 const id=key(owner),task=(writes.get(id)??Promise.resolve([])).catch(()=>[]).then(async()=>{
  const db=await open();try{return await new Promise<SavedQualityPlan[]>((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(id);let merged:SavedQualityPlan[]=[];
   request.onsuccess=()=>{merged=mergeSavedQualityPlans(request.result,entries);store.put(merged,id);};
   tx.oncomplete=()=>resolve(merged);tx.onerror=tx.onabort=()=>reject(tx.error??Error('方案存档写入失败'));
  });}finally{db.close();}
 });
 writes.set(id,task);void task.then(()=>{if(writes.get(id)===task)writes.delete(id);},()=>{if(writes.get(id)===task)writes.delete(id);});return task;
}
export async function loadDurableQualityPlans(owner?:string):Promise<SavedQualityPlan[]>{
 await writes.get(key(owner))?.catch(()=>undefined);
 try{const db=await open();try{const entries=await new Promise<unknown>((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key(owner));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const merged=mergeSavedQualityPlans(entries,readSavedQualityPlans(owner));return merged.length?writeSavedQualityPlans(owner,merged):[];}finally{db.close();}}
 catch{return readSavedQualityPlans(owner);}
}
