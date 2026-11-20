import {pruneMiningDeletions,mergeSourceDeletions} from './libraryDeletion';
import {emptyMiningLibrary,type FishMiningLibrary} from './miningLibrary';
import {readMiningPages,writeMiningPages} from './miningDiskPages';
const DATABASE = 'veil-fish-mining-library-v1', STORE = 'libraries';
export const keyOf = (owner: string | null | undefined) => owner ? `user:${owner}` : 'anonymous';
const deletionKeyOf = (key: string) => `deleted:${key}`;
export type MiningDeletions = Pick<FishMiningLibrary, 'deletedRecords' | 'clearedAt'>;

export function mergeDeletions(a?: MiningDeletions, b?: MiningDeletions): MiningDeletions {
  return {
    deletedRecords: mergeSourceDeletions(a?.deletedRecords, b?.deletedRecords),
    clearedAt: Math.max(a?.clearedAt ?? 0, b?.clearedAt ?? 0) || undefined,
  };
}

export function hasDeletions(value?: MiningDeletions) {
  return !!(value?.clearedAt || Object.keys(value?.deletedRecords ?? {}).length);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('捕捞库存储超时')); }, 8_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('捕捞库存储不可用')); };
  });
}
/** Deletion marks have their own account blob; reconciling it never needs signal pages. */
export async function localMiningMarks(key:string,incoming?:MiningDeletions):Promise<MiningDeletions|undefined>{
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      let result:MiningDeletions|undefined;
      const tx=db.transaction(STORE,incoming?'readwrite':'readonly'),store=tx.objectStore(STORE);
      const legacy=store.get(key),marks=store.get(deletionKeyOf(key));
      marks.onsuccess=()=>{
        const local=mergeDeletions(legacy.result,marks.result);
        result=incoming?mergeDeletions(local,incoming):local;
        if(!hasDeletions(result)){result=undefined;if(!incoming)resolve(undefined);return;}
        if(incoming&&JSON.stringify(result)!==JSON.stringify(mergeDeletions(marks.result)))store.put(result,deletionKeyOf(key));
        if(!incoming)resolve(result);
      };
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error);

    });
  } finally {db.close();}
}

export async function readRaw(key:string):Promise<FishMiningLibrary|undefined> {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE),store=tx.objectStore(STORE),marks=store.get(deletionKeyOf(key));
      tx.onerror=tx.onabort=()=>reject(tx.error);
      readMiningPages(store,key,library=>{
        if(!library&&!marks.result){resolve(undefined);return;}
        resolve(pruneMiningDeletions({...library??emptyMiningLibrary(),...mergeDeletions(library,marks.result)}));
      },reject);
    });
  } finally {db.close();}
}

export async function transform(key:string,apply:(library:FishMiningLibrary)=>FishMiningLibrary):Promise<{changed:boolean;marked:boolean}> {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      let changed=false,marked=false;
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),marks=store.get(deletionKeyOf(key));
      const fail=(e:unknown)=>{try{tx.abort();}catch{} reject(e);};
      readMiningPages(store,key,(library,previous)=>{
        const original=library??emptyMiningLibrary();
        const before=pruneMiningDeletions({...original,...mergeDeletions(original,marks.result)});
        const applied=apply(before),deletions=mergeDeletions(before,applied);
        if(applied!==before) {writeMiningPages(store,key,pruneMiningDeletions({...applied,...deletions}),previous,fail);changed=true;}
        if(hasDeletions(deletions)&&JSON.stringify(mergeDeletions(marks.result))!==JSON.stringify(deletions)){
          store.put(deletions,deletionKeyOf(key));marked=true;
        }
      },fail);
      tx.oncomplete=()=>resolve({changed,marked});tx.onerror=tx.onabort=()=>reject(tx.error);
    });
  } finally {db.close();}
}
