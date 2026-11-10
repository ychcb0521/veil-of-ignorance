import {collectPreEntryMonitor,type PreEntryRun} from './preEntryMonitor';
import {restorePreEntryRecord} from './preEntryArchive';
import type {FishReconstructionLoader} from './reconstruction';
import type {QualityProgress} from './quality';

/** Resume through the unchanged frozen engine, restoring just the record being
 * executed. Restoring every paused history before starting doubled a whole
 * batch on the page and then cloned it again into the worker. */
export async function collectPreEntryWithLazyHistory(task:PreEntryRun,load:FishReconstructionLoader,now:number,signal:AbortSignal,onProgress:(p:QualityProgress)=>void,bounds?:Parameters<typeof collectPreEntryMonitor>[5],afterRecord?:()=>Promise<void>){
  if(!task.records.length)return collectPreEntryMonitor(task,load,now,signal,onProgress,bounds);
  for(let i=0;i<task.records.length;i++){
    if(signal.aborted)throw new DOMException('已暂停','AbortError');
    const original=task.records[i];
    const record=['matched','unmatched','warming'].includes(original.status)?original:await restorePreEntryRecord(original);
    await collectPreEntryMonitor({...task,records:[record]},load,now,signal,p=>onProgress({...p,done:i+p.done,total:task.records.length}),bounds);
    // A slow page must acknowledge this history before the next body is read.
    // Coalescing messages per ID alone still allowed a whole batch of large
    // terminal records to accumulate behind one busy renderer.
    await afterRecord?.();
  }
}
