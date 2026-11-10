import {serializeArchiveWork} from '../serializeArchiveWork';
import { encodeStoredPreEntry } from './preEntryBackupEncoding';
import type { PreparedAccountBlob } from '../accountBlobSync';

async function prepareStored(owner: string|undefined, knownHash?: string): Promise<{result:Promise<PreparedAccountBlob|undefined>}> {
  let ready!:()=>void;
  const snapshot=new Promise<void>(resolve=>{ready=resolve;});
  const result=typeof Worker!=='function'?encodeStoredPreEntry(owner,knownHash,ready).finally(ready):new Promise<PreparedAccountBlob|undefined>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/preEntryBackup.worker.ts', import.meta.url), {type:'module'});
    let settled = false;
    const finish = (result?: PreparedAccountBlob, error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); worker.terminate();
      ready();if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(undefined, Error('入选库云端备份编码超时，本机记录仍保留')), 180000);
    worker.onmessage = (e: MessageEvent<{snapshotReady?:boolean;ok:boolean;result?:PreparedAccountBlob;error?:string}>) => {if(e.data.snapshotReady){ready();return;}finish(e.data.result,e.data.ok?undefined:Error(e.data.error??'入选库备份编码失败'));};
    worker.onerror = worker.onmessageerror = () => finish(undefined, Error('入选库后台备份失败，本机记录仍保留'));
    try {worker.postMessage({owner,knownHash});} catch(error) {finish(undefined,error instanceof Error?error:Error('入选库备份失败'));}
  });
  void result.catch(()=>undefined);
  await snapshot;
  // Only snapshot acquisition uses the large-archive gate. Immutable body reads
  // and bounded encoding may continue while checkpoints durably save new rows.
  return {result};
}

export async function prepareStoredPreEntry(owner:string|undefined,knownHash?:string):Promise<PreparedAccountBlob|undefined>{const {result}=await serializeArchiveWork(()=>prepareStored(owner,knownHash));return result;}
