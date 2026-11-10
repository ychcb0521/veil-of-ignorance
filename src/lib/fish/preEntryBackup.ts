import {serializeArchiveWork} from '../serializeArchiveWork';
import { encodeStoredPreEntry } from './preEntryBackupEncoding';
import type { PreparedAccountBlob } from '../accountBlobSync';

async function prepareStored(owner: string, knownHash?: string): Promise<PreparedAccountBlob | undefined> {
  if (typeof Worker !== 'function') return encodeStoredPreEntry(owner, knownHash);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/preEntryBackup.worker.ts', import.meta.url), {type:'module'});
    let settled = false;
    const finish = (result?: PreparedAccountBlob, error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(undefined, Error('入选库云端备份编码超时，本机记录仍保留')), 180000);
    worker.onmessage = (e: MessageEvent<{ok:boolean;result?:PreparedAccountBlob;error?:string}>) => finish(e.data.result,e.data.ok?undefined:Error(e.data.error??'入选库备份编码失败'));
    worker.onerror = worker.onmessageerror = () => finish(undefined, Error('入选库后台备份失败，本机记录仍保留'));
    try {worker.postMessage({owner,knownHash});} catch(error) {finish(undefined,error instanceof Error?error:Error('入选库备份失败'));}
  });
}

export function prepareStoredPreEntry(owner:string,knownHash?:string):Promise<PreparedAccountBlob|undefined>{return serializeArchiveWork(()=>prepareStored(owner,knownHash));}
