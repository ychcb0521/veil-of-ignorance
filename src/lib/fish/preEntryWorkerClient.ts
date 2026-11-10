import {type PreEntryRun} from './preEntryMonitor';
import {preEntryRecordPending} from './preEntryMonitor';
import {collectPreEntryWithLazyHistory} from './preEntryLazyHistory';
import type { FishReconstructionLoader } from './reconstruction';
import type { QualityProgress } from './quality';
import { applyScreeningRecordDelta, screeningError, restoreScreeningError, type ScreeningWorkerInput, type ScreeningWorkerOutput } from './preEntryWorkerProtocol';

/** Same frozen engine and shared market loader; only calculation moves off the UI thread. */
export async function collectPreEntryInWorker(task:PreEntryRun,load:FishReconstructionLoader,now:number,signal:AbortSignal,onProgress:(p:QualityProgress)=>void,bounds?:{start?:(symbol:string)=>Promise<number|undefined>;end?:(symbol:string)=>Promise<number>}):Promise<void>{
  if(signal.aborted)throw new DOMException('已暂停','AbortError');
  if(typeof Worker!=='function')return collectPreEntryWithLazyHistory(task,load,now,signal,onProgress,bounds);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../workers/preEntryScan.worker.ts',import.meta.url),{type:'module'});
    const records=new Map(task.records.map(r=>[r.id,r]));
    let settled=false,abortTimer:ReturnType<typeof setTimeout>|undefined;
    const send=(message:ScreeningWorkerInput)=>{if(!settled)worker.postMessage(message);};
    const finish=(error?:Error)=>{
      if(settled)return;settled=true;clearTimeout(abortTimer);signal.removeEventListener('abort',abort);worker.terminate();
      if(error){
        // Keep the last acknowledged cursor resumable even if the worker itself fails.
        for(const record of records.values())if(record.status==='scanning')task.onRecord({...record,status:'paused',updatedAt:Date.now(),detail:'后台筛选已暂停，保留最后进度，可继续'});
        reject(error);
      }else resolve();
    };
    const abort=()=>{send({type:'abort'});abortTimer=setTimeout(()=>finish(new DOMException('已暂停','AbortError')),3000);};
    signal.addEventListener('abort',abort,{once:true});
    worker.onerror=worker.onmessageerror=()=>finish(Error('后台筛选线程异常，最后进度已保留，请继续筛选'));
    worker.onmessage=async(e:MessageEvent<ScreeningWorkerOutput>)=>{
      if(settled)return;
      const m=e.data;
      try{
        if(m.type==='record'){
          const record=applyScreeningRecordDelta(records.get(m.delta.record.id),m.delta);records.set(record.id,record);task.onRecord(record);if(!preEntryRecordPending(record))records.delete(record.id);send({type:'ack',seq:m.seq});
        }else if(m.type==='progress')onProgress(m.value);
        else if(m.type==='done')finish(m.error?restoreScreeningError(m.error):signal.aborted?new DOMException('已暂停','AbortError'):undefined);
        else if(m.type==='request'){
          try{
            const value=m.method==='load'?await load(m.row,m.from,m.cut,m.plan,signal):await bounds?.[m.method]?.(m.symbol);
            send({type:'response',id:m.id,value});
          }catch(error){send({type:'response',id:m.id,error:screeningError(error)});}
        }
      }catch(error){finish(error instanceof Error?error:Error(String(error)));}
    };
    try{
      // Completed rows only contribute to progress; their large histories never need to be cloned into the engine.
      const inputs=task.records.map(r=>['matched','unmatched','warming'].includes(r.status)?{...r,exclusionProcess:undefined}:r);
      send({type:'start',round:task.round,records:inputs,now,initialization:load.turingInitialization,bounds:{start:!!bounds?.start,end:!!bounds?.end}});
      if(signal.aborted)abort();
    }catch(error){finish(error instanceof Error?error:Error('后台筛选启动失败'));}
  });
}
