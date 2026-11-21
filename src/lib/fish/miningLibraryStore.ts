/**
 * 捕捞库的本机存储（IndexedDB，按账号一份）+ 账号云端存档（accountBlobSync，键 idb:fish-mining-library）。
 * 写入按账号串行：读 → 合并 → 写在同一个事务里，另一个标签页的写入不会被覆盖。
 */
import {readFishLibrary} from './libraryLoadQueue';
import { noteAccountBlobSaved, syncAccountBlobOnLoad, syncAccountBlobFully, type AccountBlobAdapter, type AccountBlobSyncStatus } from '@/lib/accountBlobSync';
import {keyOf,readRaw,transform,localMiningMarks,hasDeletions,type MiningDeletions} from './miningDisk';
import {decodeMiningArchive,containsMiningMerge} from './miningRestore';
import {prepareAccountBlobEncoding} from '../accountBlobCodec';
import { emptyMiningLibrary, mergeMiningLibraries, normalizeMiningLibrary, restoreMiningImport, type FishMiningLibrary } from './miningLibrary';

export const MINING_LIBRARY_EVENT = 'fish-mining-library-saved';
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, run.catch(() => undefined));
  return run;
}
const announce = (owner: string | null | undefined, fromRestore = false) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MINING_LIBRARY_EVENT, { detail: { owner: owner ?? null, fromRestore } }));
};

/** Old pages write the original library key. New pages keep deletion marks independently of those writes. */
const miningDeletionsAccountBlob: AccountBlobAdapter<MiningDeletions> = {
  name: 'fish-mining-deletions-v1',
  async read(owner) {
    const key = keyOf(owner);
    await queues.get(key);
    return localMiningMarks(key);
  },
  async write(owner, value) {
    if (!hasDeletions(value)) return;
    const key = keyOf(owner);
    await enqueue(key, () => localMiningMarks(key,value));
    announce(owner,true);
  },
  async mergeRemote(owner,value){
    if(!hasDeletions(value))return;
    const key=keyOf(owner);
    const marks=await enqueue(key,()=>localMiningMarks(key,value));
    announce(owner,true);
    if(marks?.clearedAt===value.clearedAt&&Object.keys(marks?.deletedRecords??{}).length===Object.keys(value.deletedRecords??{}).length&&
      Object.entries(value.deletedRecords??{}).every(([id,at])=>marks?.deletedRecords?.[id]===at))return 'matchesRemote';
  },
  weight: value => Object.keys(value?.deletedRecords ?? {}).length + Number(!!value?.clearedAt),
};

const miningReads = new Map<string | undefined, Promise<AccountBlobSyncStatus[]>>();
function reconcileMiningLibrary(owner?: string) {
  const pending = miningReads.get(owner);
  if (pending) return pending;
  const task = readFishLibrary(owner, 'mining', async () => {
    const marks = await syncAccountBlobOnLoad(miningDeletionsAccountBlob, owner, undefined, true);
    const library = await syncAccountBlobOnLoad(miningLibraryAccountBlob, owner, 600_000, true);
    return [marks, library];
  });
  miningReads.set(owner, task);
  const release = () => { if (miningReads.get(owner) === task) miningReads.delete(owner); };
  void task.then(release, release);
  return task;
}

/** 读捕捞库（先与账号云端对一次账）。读不到返回空库。 */
export async function loadMiningLibrary(owner: string | null | undefined, onLocal?: (value:FishMiningLibrary)=>void): Promise<FishMiningLibrary> {
  if (typeof indexedDB === 'undefined') return emptyMiningLibrary();
  const key=keyOf(owner);
  const local=onLocal?await readRaw(key):undefined;
  if(local)onLocal?.(local);
  const states=await reconcileMiningLibrary(owner??undefined);
  if(owner&&states.some(s=>s==='failed'||s==='timed_out'||s==='skipped')) throw Error('账号捕捞库尚未同步，当前显示本机记录');
  await queues.get(key);
  if(local&&states.every(status=>status==='unchanged'))return local;
  return await readRaw(key) ?? emptyMiningLibrary();
}
/** Full downloads must report storage failure instead of quietly exporting an empty library. */
export async function loadMiningLibraryForTransfer(owner?:string):Promise<FishMiningLibrary>{
 const states=await reconcileMiningLibrary(owner);
 if(owner&&states.some(s=>s==='failed'||s==='timed_out'||s==='skipped'))throw Error('完整账号捕捞库尚未同步，请重试');
 await queues.get(keyOf(owner));return await readRaw(keyOf(owner))??emptyMiningLibrary();
}
/** 改捕捞库：排队、在事务里合并写入；成功后通知界面并安排上传。失败不抛（挖掘本身不受影响）。 */
export function updateMiningLibrary(owner: string | null | undefined, apply: (library: FishMiningLibrary) => FishMiningLibrary): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(false);
  const key = keyOf(owner);
  return enqueue(key, async () => {
    try {
      const { changed, marked } = await transform(key, apply);
      if (changed) { announce(owner); void noteAccountBlobSaved(miningLibraryAccountBlob, owner ?? undefined); }
      if (marked) void noteAccountBlobSaved(miningDeletionsAccountBlob, owner ?? undefined);
      return true;
    } catch { return false; }
  });
}

export const miningLibraryAccountBlob: AccountBlobAdapter<FishMiningLibrary> = {
  name: 'fish-mining-library',
  localReceiptName: 'fish-mining-library-pages-v1',
  decodeRemote: (_owner,enc,pieces)=>decodeMiningArchive(enc,pieces),
  async prepareStored(owner,knownHash){
    if(typeof Worker==='undefined'){const value=await readRaw(keyOf(owner));return value?prepareAccountBlobEncoding(value,knownHash):undefined;}
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('../workers/miningBlobEncoder.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=e=>{worker.terminate();if(e.data.ok)resolve(e.data.result);else reject(Error('捕捞库编码失败'));};
      worker.onerror=e=>{worker.terminate();reject(Error(e.message));};
      worker.postMessage({owner,knownHash});
    });
  },
  async mergeRemote(owner,value){
    if(!value)return miningLibraryAccountBlob.write(owner,value);
    const incoming=normalizeMiningLibrary(value);
    let identical=false;
    await enqueue(keyOf(owner),()=>transform(keyOf(owner),local=>{
      const merged=mergeMiningLibraries(local,incoming);
      identical=containsMiningMerge(incoming,merged);
      return merged;
    }));
    announce(owner,true);
    return identical?'matchesRemote':undefined;
  },
  async read(owner) { const key = keyOf(owner); await queues.get(key); try { return await readRaw(key); } catch { return undefined; } },
  write(owner, library) {
    const key = keyOf(owner);
    // 取回云端那份时与本机合并（本机可能有还没上传的档）；只增不减
    return enqueue(key, async () => {
      const { marked } = await transform(key, local => library ? mergeMiningLibraries(local, normalizeMiningLibrary(library)) : local);
      if (marked) void noteAccountBlobSaved(miningDeletionsAccountBlob, owner);
      announce(owner);
    });
  },
  weight: library => library ? Object.keys(library.deletedRecords??{}).length + library.records.length + library.anchors.length + Number(!!library.clearedAt) : 0,
};

export async function syncMiningLibraryChange(owner?: string, deleted = false): Promise<boolean> {
  if (!owner) return true;
  const adapters = deleted ? [miningDeletionsAccountBlob, miningLibraryAccountBlob] : [miningLibraryAccountBlob];
  const states = await Promise.all(adapters.map(async adapter => {
    await noteAccountBlobSaved(adapter, owner);
    return syncAccountBlobFully(adapter, owner, 12_000, true);
  }));
  return states.every(status => status === 'pushed' || status === 'unchanged');
}

export async function importMiningLibraries(owner: string | undefined, incoming: readonly FishMiningLibrary[]) {
  await reconcileMiningLibrary(owner);
  if (!await updateMiningLibrary(owner, library => incoming.reduce((current, next) => restoreMiningImport(current, next), library))) {
    throw Error('捕捞库未能保存导入记录，请重试');
  }
  return syncMiningLibraryChange(owner);
}
