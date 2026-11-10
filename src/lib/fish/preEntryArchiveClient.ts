import type {PreEntryLibrary,PreEntryRecord} from './preEntryMonitor';
import type {FishQualityStudy} from './quality';
import {readPreEntrySnapshot} from './preEntryPersistence';
import {projectPreEntryRecords} from './preEntryArchive';
import {restorePreEntryLibrary} from './preEntryArchive';
import {parsePreEntryLibraryBackup} from './preEntryLibraryTransfer';
import {serializeArchiveWork} from '../serializeArchiveWork';
type Request={owner?:string;preview?:boolean;rebuild?:boolean}&({kind:'load'}|{kind:'project';records:PreEntryRecord[]}|{kind:'decode';enc:'gzip'|'json';pieces:readonly string[]}|{kind:'backup';library:PreEntryLibrary}|{kind:'import';file:File}|{kind:'tables';tables:{id:string;study:FishQualityStudy}[]});
function request<T>(body:Request,fallback:()=>Promise<T>,preview?:(library:PreEntryLibrary)=>void):Promise<T>{
  return serializeArchiveWork(()=>{
    if(typeof Worker!=='function')return fallback();
    return new Promise<T>((resolve,reject)=>{
      const worker=new Worker(new URL('../workers/preEntryArchive.worker.ts',import.meta.url),{type:'module'});let settled=false;
      const finish=(value?:T,error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();if(error)reject(error);else resolve(value as T);};
      const timer=setTimeout(()=>finish(undefined,Error('筛选库读取超时，原数据保留，请重试')),300_000);
      worker.onmessage=event=>{if(event.data.preview){preview?.(event.data.preview);return;}finish(event.data.value,event.data.ok?undefined:Error(event.data.error??'筛选库读取失败'));};
      worker.onerror=worker.onmessageerror=()=>finish(undefined,Error('筛选库后台读取失败，原数据保留'));
      try{worker.postMessage(body);}catch(error){finish(undefined,error instanceof Error?error:Error('筛选库读取失败'));}
    });
  });
}
export function readProjectedPreEntry(owner?:string,preview?:(library:PreEntryLibrary)=>void,rebuild=false):Promise<PreEntryLibrary|undefined>{return request({kind:'load',owner,preview:!!preview,rebuild},async()=>{const library=await readPreEntrySnapshot(owner);return library?{...library,records:await projectPreEntryRecords(library.records,owner)}:undefined;},preview);}
export function projectPreEntryBatch(owner:string|undefined,records:PreEntryRecord[]):Promise<PreEntryRecord[]>{return request({kind:'project',owner,records},()=>projectPreEntryRecords(records,owner));}
export function decodeProjectedPreEntry(owner:string,enc:'gzip'|'json',pieces:readonly string[]):Promise<unknown>{return request({kind:'decode',owner,enc,pieces},async()=>{const {decodeAccountBlob}=await import('../accountBlobSync');const value=await decodeAccountBlob(enc,pieces) as PreEntryLibrary;return {...value,records:await projectPreEntryRecords(value.records,owner)};});}
export function preparePreEntryDownload(owner:string|undefined,library:PreEntryLibrary):Promise<Blob>{return request({kind:'backup',owner,library},async()=>new Blob([JSON.stringify({format:'veil-pre-entry-library',version:1,exportedAt:Date.now(),library:await restorePreEntryLibrary(library)})],{type:'application/json'}));}
export function importPreEntryFile(owner:string|undefined,file:File):Promise<PreEntryLibrary>{return request({kind:'import',owner,file},async()=>parsePreEntryLibraryBackup(await file.text()));}
export function preparePreEntryTables(tables:{id:string;study:FishQualityStudy}[]):Promise<Blob>{return request({kind:'tables',tables},async()=>{const {buildQualitySheets}=await import('./qualityExport'),{qualityComparisonRows}=await import('./quality'),{buildXlsx}=await import('../xlsxWorkbook');const sheets=[];for(let i=0;i<tables.length;i++){const study=await import('./preEntryArchive').then(m=>m.restorePreEntryStudy(tables[i].study));sheets.push(...buildQualitySheets(study,qualityComparisonRows(study)).map((sheet,j)=>({...sheet,name:`${i+1}-${j+1}-${sheet.name}`.slice(0,31)})));}return buildXlsx(sheets);});}
