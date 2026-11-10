import {serializeArchiveWork} from '../serializeArchiveWork';
import {encodeStoredQuality} from './qualityBackupEncoding';
import type {SavedQualityPlan} from './qualitySavedPlans';
import type {PreparedAccountBlob} from '../accountBlobSync';
export function prepareStoredQuality(owner:string|undefined,plans:SavedQualityPlan[],knownHash?:string):Promise<PreparedAccountBlob|undefined>{
  return serializeArchiveWork(()=>{
    if(typeof Worker!=='function')return encodeStoredQuality(owner,plans,knownHash);
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('../workers/qualityBackup.worker.ts',import.meta.url),{type:'module'});let settled=false;
      const finish=(result?:PreparedAccountBlob,error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();if(error)reject(error);else resolve(result);};
      const timer=setTimeout(()=>finish(undefined,Error('鱼质量备份超时，本机记录保留')),180_000);
      worker.onmessage=event=>finish(event.data.result,event.data.ok?undefined:Error(event.data.error??'鱼质量备份失败'));
      worker.onerror=worker.onmessageerror=()=>finish(undefined,Error('鱼质量后台备份失败，本机记录保留'));
      try{worker.postMessage({owner,plans,knownHash});}catch(error){finish(undefined,error instanceof Error?error:Error('鱼质量备份失败'));}
    });
  });
}
