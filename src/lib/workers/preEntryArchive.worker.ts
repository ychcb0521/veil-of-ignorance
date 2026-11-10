import {readPreEntrySnapshot,validPreEntryLibrary,readPreEntryReadModel,readPreEntryCacheRevision,cachePreEntryReadModel,readPreEntryTableClears} from '../fish/preEntryPersistence';
import {withPreEntryTableClears} from '../fish/preEntryTableClears';
import {projectPreEntryRecord,projectPreEntryRecords} from '../fish/preEntryArchive';
import {deserializeAccountBlobStream} from '../accountBlobStream';
import {serializePreEntryLibraryChunks} from '../fish/preEntryArchiveStream';
import {accountBlobChunkBatches} from '../accountBlobChunkEncoding';
import {validatePreEntryLibraryBackupValue} from '../fish/preEntryLibraryTransfer';
import type {PreEntryLibrary,PreEntryRecord} from '../fish/preEntryMonitor';
import type {FishQualityStudy} from '../fish/quality';
import {qualityComparisonRows} from '../fish/quality';
import {restorePreEntryStudy} from '../fish/preEntryArchive';
import {buildQualitySheets} from '../fish/qualityExport';
import {buildXlsx} from '../xlsxWorkbook';

type Request={owner?:string;preview?:boolean;rebuild?:boolean}&({kind:'load'}|{kind:'project';records:PreEntryRecord[]}|{kind:'decode';enc:'gzip'|'json';pieces:readonly string[]}|{kind:'backup';library:PreEntryLibrary}|{kind:'import';file:File}|{kind:'tables';tables:{id:string;study:FishQualityStudy}[]});
self.onmessage=async(event:MessageEvent<Request>)=>{
  try{
    const request=event.data;let value:PreEntryLibrary|PreEntryRecord[]|Blob|undefined;
    if(request.kind==='tables'){
      const sheets=[];
      for(let i=0;i<request.tables.length;i++){const study=await restorePreEntryStudy(request.tables[i].study);sheets.push(...buildQualitySheets(study,qualityComparisonRows(study)).map((sheet,j)=>({...sheet,name:`${i+1}-${j+1}-${sheet.name}`.slice(0,31)})));}
      value=buildXlsx(sheets);
    }else if(request.kind==='backup'){
      const encoder=new TextEncoder(),parts:BlobPart[]=[`{"format":"veil-pre-entry-library","version":1,"exportedAt":${Date.now()},"library":`];
      // Blob parts can be disk backed by the browser. Do not keep the complete
      // restored object graph or all UTF-8 ArrayBuffers reachable until the end.
      for await(const chunk of accountBlobChunkBatches(()=>serializePreEntryLibraryChunks(request.library)))parts.push(new Blob([encoder.encode(chunk) as Uint8Array<ArrayBuffer>]));
      parts.push('}');
      value=new Blob(parts,{type:'application/json'});
    }else if(request.kind==='project')value=await projectPreEntryRecords(request.records,request.owner);
    else if(request.kind==='load'){
      const revision=await readPreEntryCacheRevision(request.owner);
      const cached=!request.rebuild&&await readPreEntryReadModel(request.owner);
      const library=cached||await readPreEntrySnapshot(request.owner);
      if(library){if(request.preview)self.postMessage({preview:{...library,records:library.records.map(record=>projectPreEntryRecord(record,request.owner,false).record)}});for(let i=0;i<library.records.length;i++){const next=projectPreEntryRecord(library.records[i],request.owner);await next.saved;library.records[i]=next.record;}const merged=await cachePreEntryReadModel(request.owner,library,true,false,revision);value=withPreEntryTableClears({...merged,records:await projectPreEntryRecords(merged.records,request.owner)},await readPreEntryTableClears(request.owner));}
    }else{
      let index=0;
      const bytes=request.kind==='import'?request.file.stream():request.enc==='gzip'?(()=>{const binary=atob(request.pieces.join('')),data=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);return new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));})():new ReadableStream<string>({pull(controller){if(index<request.pieces.length)controller.enqueue(request.pieces[index++]);else controller.close();}}).pipeThrough(new TextEncoderStream());
      let pending:Promise<void>[]=[];
      const decoded=await deserializeAccountBlobStream(bytes,{record(record,path){
        const recordPath=request.kind==='import'?path.length===4&&path[1]==='library'&&path[2]==='records'&&typeof path[3]==='number':path.length===3&&path[1]==='records'&&typeof path[2]==='number';
        if(!recordPath)return record;
        if((record as PreEntryRecord)?.processRef)throw Error('外部筛选库存档不能包含本机历史引用，请使用完整备份');
        const next=projectPreEntryRecord(record as PreEntryRecord,request.owner);if(next.saved)pending.push(next.saved);return next.record;
      },async flush(){const writes=pending;pending=[];await Promise.all(writes);}});
      if(request.kind==='import')value=validatePreEntryLibraryBackupValue(decoded,true);
      else{if(!validPreEntryLibrary(decoded))throw Error('筛选库存档格式无效，原库保留');value=decoded;}
    }
    self.postMessage({ok:true,value});
  }catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'筛选库后台读取失败'});}
};
