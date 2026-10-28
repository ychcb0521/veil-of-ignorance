import { fishProgramForLookback } from './lookback';
/**
 * Raw scan conclusions never go through the generic cloud state store (it mirrors into the ~5 MB localStorage).
 * 【用户要求】2026-10-27 扫描结果也跟账号走：经 accountBlobSync 压缩后存到账号（不进 localStorage），换电脑登录也能看到。
 */
import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { compileFishProgram, type FishAlgorithmSettings } from './algorithm';
import type { DeepDigFeatureDef } from '../deepDig/features';
import type { FishCombinationRound, FishProgress } from '../fishScanner';
import type { FishCombination, FishMemberResult } from './intersection';
import type { TradeSignal } from '../signalLibrary';
export interface FishSession {
  /** Restored conclusions must never be relabeled as having passed a newer admission rule. */
  needsRescan?: string;
  data: FishCombinationRound;
  mode: FishCombination;
  keys: string[];
  added: string[];
  refreshed: [string, TradeSignal][];
  edits: [string, {signal?: TradeSignal; deleted?: boolean}][];
  progress: FishProgress | null;
}
interface StoredSession extends Omit<FishSession, 'data'> {
  version: 1;
  data: Omit<FishCombinationRound, 'plans' | 'results'> & {
    plans: {def: DeepDigFeatureDef; settings: FishAlgorithmSettings; algorithmKey?: string}[];
    results: [string, [number, FishMemberResult][]][];
  };
}
const db = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('veil-fish-session-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('rounds');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('本机结果库被其它标签页占用'));
});
// Serialize writes so a slow previous view cannot overwrite a newer selection or scan.
let queue: Promise<unknown> = Promise.resolve();
const savedRounds = new Map<string, FishCombinationRound>();
export function saveFishSession(owner: string | undefined, session: FishSession | null): Promise<void> {
  const key=owner??'anonymous';
  const view=session?{...session,data:undefined}:null;
  const write = async () => {
    const database = await db();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction('rounds', 'readwrite'), store = tx.objectStore('rounds');
        if(session){
          if(savedRounds.get(key)!==session.data){
            const payload:StoredSession={...session,version:1,data:{...session.data,
              plans:session.data.plans.map(p=>({def:p.def,settings:p.settings,algorithmKey:p.algorithmKey})),
              results:[...session.data.results].map(([id,members])=>[id,[...members]]),
            }};
            store.put(payload,key);
          }
          store.put(view,[key,'view']);
        }else{store.delete(key);store.delete([key,'view']);}
        tx.oncomplete = () => {if(session)savedRounds.set(key,session.data);else savedRounds.delete(key);resolve();};
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally { database.close(); }
  };
  const task = queue.then(write, write);
  queue = task.catch(() => {});
  void task.then(() => noteAccountBlobSaved(fishSessionAccountBlob, owner), () => {});
  return task;
}
export async function loadFishSession(owner: string | undefined): Promise<FishSession | null> {
  await syncAccountBlobOnLoad(fishSessionAccountBlob, owner);
  await queue;
  const database = await db();
  try {
    const key=owner??'anonymous',store=database.transaction('rounds').objectStore('rounds');
    const read=(request:IDBRequest)=>new Promise<unknown>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const [raw,view]=await Promise.all([read(store.get(key)),read(store.get([key,'view']))]);
    const value=raw as StoredSession|undefined;
    if(!value||value.version!==1)return null;
    const data:FishCombinationRound={...value.data,
      plans:value.data.plans.map(p=>fishProgramForLookback(compileFishProgram(p.def,p.settings),value.data.lookbackHours)),
      results:new Map(value.data.results.map(([id,members])=>[id,new Map(members)])),
    };
    const changed=data.plans.some((plan,i)=>{
      const previous=value.data.plans[i].algorithmKey;
      return previous!==undefined?previous!==plan.algorithmKey:!!plan.stateHold;
    });
    const needsRescan=changed?'捕捞规则已更新，上一轮未按当前规则核验。请重新捕捞，已有鱼记录保留。':undefined;
    savedRounds.set(key,data);
    return {...value,...view as Omit<FishSession,'data'>,data,needsRescan};
  } finally { database.close(); }
}

interface StoredSessionPair { payload: StoredSession; view: unknown }
const readPair = (request: IDBRequest) => new Promise<unknown>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
/** 账号云端存档：存的是本机库里的原始两条（结果 + 视图），取回时排进同一条写队列。 */
export const fishSessionAccountBlob: AccountBlobAdapter<StoredSessionPair> = {
  name: 'fish-session',
  async read(owner) {
    await queue;
    const database = await db();
    try {
      const store = database.transaction('rounds').objectStore('rounds');
      const [payload, view] = await Promise.all([readPair(store.get(owner)), readPair(store.get([owner, 'view']))]);
      const value = payload as StoredSession | undefined;
      return value && value.version === 1 ? { payload: value, view } : undefined;
    } finally { database.close(); }
  },
  write(owner, pair) {
    const write = async () => {
      const database = await db();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction('rounds', 'readwrite'), store = tx.objectStore('rounds');
          if (pair?.payload?.version === 1) { store.put(pair.payload, owner); store.put(pair.view ?? null, [owner, 'view']); }
          else { store.delete(owner); store.delete([owner, 'view']); }
          tx.oncomplete = () => { savedRounds.delete(owner); resolve(); };
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally { database.close(); }
    };
    const task = queue.then(write, write);
    queue = task.catch(() => {});
    return task;
  },
  weight: pair => pair?.payload ? Math.max(1, pair.payload.data.results.length) : 0,
};
