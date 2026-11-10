import type {PreEntryLibrary,PreEntryRecord} from './preEntryMonitor';
import type {FishQualityStudy} from './quality';
import {latestScreeningExclusion} from './latestScreeningExclusion';
import {fingerprintAccountBlob,serializeAccountBlob} from '../accountBlobCodec';

/** A private read model only. Canonical libraries, backups and saved studies
 * retain the full original process; a missing body is an error, never an empty audit. */
export interface PreEntryProcessRef {key:string;entries:number;owner?:string}
const DATABASE='veil-pre-entry-process-bodies-v1',STORE='bodies';
function open():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=request.onblocked=()=>reject(Error('筛选历史正文暂不可用，原记录保留'));
  });
}
async function put(key:string,value:NonNullable<PreEntryRecord['exclusionProcess']>):Promise<void>{
  const db=await open();
  try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??Error('筛选历史正文未保存'));
  });}finally{db.close();}
}
async function get(key:string):Promise<NonNullable<PreEntryRecord['exclusionProcess']>>{
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
    const request=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
    request.onsuccess=()=>request.result?.version===1&&Array.isArray(request.result.entries)?resolve(request.result):reject(Error('筛选历史正文尚未就绪，请重新读取；原库未删除'));
    request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
/** Full record timestamps/cursors plus the last observation identify an immutable
 * checkpoint. Include the entire evidence so equal timestamps cannot overwrite
 * a distinct original history. Original v1-v6 storage is untouched. */
export function projectPreEntryRecord(record:PreEntryRecord,owner?:string,persist=true):{record:PreEntryRecord;saved?:Promise<void>}{
  const process=record.exclusionProcess;
  if(record.processRef||!process||process.entries.length<=16)return {record};
  const last=process.entries.at(-1);
  const signature=fingerprintAccountBlob(serializeAccountBlob([record.id,record.updatedAt,record.cursor,process]));
  const ref:PreEntryProcessRef={owner,key:`${owner??'anonymous'}:${record.id}:${signature}`,entries:process.entries.length};
  const entries=latestScreeningExclusion(process);
  // Keep the final checkpoint too: merge ordering still sees the exact coverage.
  if(last&&!entries.some(e=>e.through===last.through&&e.kind===last.kind))entries.push(last);
  return {record:{...record,processRef:ref,exclusionProcess:{...process,entries}},saved:persist?put(ref.key,process):undefined};
}
export async function projectPreEntryRecords(records:readonly PreEntryRecord[],owner?:string):Promise<PreEntryRecord[]>{
  const projected:PreEntryRecord[]=[];
  for(const record of records){const next=projectPreEntryRecord(record,owner);await next.saved;projected.push(next.record);}
  return projected;
}
export async function restorePreEntryRecord(record:PreEntryRecord):Promise<PreEntryRecord>{
  if(!record.processRef)return record;
  const {processRef,...value}=record,process=await get(processRef.key);
  if(process.entries.length!==processRef.entries)throw Error('筛选历史正文校验不符，原库未改写');
  return {...value,exclusionProcess:process};
}
export async function restorePreEntryLibrary(library:PreEntryLibrary):Promise<PreEntryLibrary>{
  if(!library.records.some(r=>r.processRef))return library;
  const records:PreEntryRecord[]=[];
  for(const record of library.records)records.push(await restorePreEntryRecord(record));
  return {...library,records};
}
/** Stored table snapshots and their archives use the same complete original wire. */
export async function restorePreEntryStudy(study:FishQualityStudy):Promise<FishQualityStudy>{
  let next=study;
  if(study.screeningResults?.some(r=>r.processRef)){
    const records:PreEntryRecord[]=[];for(const record of study.screeningResults)records.push(await restorePreEntryRecord(record));
    next={...next,screeningResults:records};
  }
  if(study.monitorLibrary?.archives?.some(a=>a.study)){
    const archives=[];
    for(const archive of study.monitorLibrary.archives){const body=archive.study&&await restorePreEntryStudy(archive.study);archives.push(body===archive.study?archive:{...archive,study:body});}
    if(archives.some((a,i)=>a!==study.monitorLibrary!.archives![i]))next={...next,monitorLibrary:{...study.monitorLibrary,archives}};
  }
  return next;
}
