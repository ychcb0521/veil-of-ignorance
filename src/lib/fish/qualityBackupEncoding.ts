import {applySavedQualityPlans,type SavedQualityPlan} from './qualitySavedPlans';
import {prepareAccountBlobEncoding} from '../accountBlobCodec';
import type {FishQualityStudy} from './quality';
import {readStoredQualityWithSignalReadings} from './qualitySignalReadingsStore';

/** Same version-1 payload, catalog precedence, archive-directory projection and
 * codec as qualityAccountBlob.read; the whole graph stays in its worker. */
export async function encodeStoredQuality(owner:string|undefined,plans:SavedQualityPlan[],knownHash?:string){
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('veil-fish-quality-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('studies');r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>reject(Error('鱼质量备份读取失败'));});
  let value:FishQualityStudy|undefined;
  try{value=await readStoredQualityWithSignalReadings(db.transaction('studies').objectStore('studies'),`fish-quality:${owner??'anonymous'}`) as FishQualityStudy | undefined;}finally{db.close();}
  if(value==null)return undefined;
  if(value.version!==1||!Array.isArray(value.samples)||!Array.isArray(value.groups)||!Array.isArray(value.results))throw Error('鱼质量备份格式无效，原数据保留');
  value=applySavedQualityPlans(value,plans);
  if(value.monitorLibrary?.archives?.some(a=>a.study))value={...value,monitorLibrary:{...value.monitorLibrary,archives:value.monitorLibrary.archives.map(({study,...entry})=>study?{...entry,resultCount:study.results.length}:entry)}};
  return prepareAccountBlobEncoding(value,knownHash);
}
