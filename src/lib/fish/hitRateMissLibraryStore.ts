import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { fishMissRoundSummary, mergeFishMissDirectories, type FishMissDirectory, type FishMissRound } from './hitRateMissLibrary';

const DATABASE = 'veil-fish-hit-rate-misses-v1';
const DIRECTORY = 'directories';
const ROUNDS = 'rounds';
const ownerKey = (owner?: string | null) => owner ? `user:${owner}` : 'anonymous';
const bodyKey = (owner: string | null | undefined, id: string) => [ownerKey(owner), id];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(Error('未命中库存储不可用')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const fail = (message: string) => { expired = true; clearTimeout(timer); reject(Error(message)); };
    const timer = setTimeout(() => fail('未命中库读取超时'), 8_000);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DIRECTORY);
      request.result.createObjectStore(ROUNDS);
    };
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => fail('未命中库存储不可用');
  });
}

async function read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function mergeDirectory(owner: string | null | undefined, incoming: FishMissDirectory, round?: FishMissRound) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(round ? [DIRECTORY, ROUNDS] : DIRECTORY, 'readwrite');
      const store = tx.objectStore(DIRECTORY), key = ownerKey(owner), request = store.get(key);
      request.onsuccess = () => {
        try {
          store.put(mergeFishMissDirectories(request.result, incoming), key);
          if (round) tx.objectStore(ROUNDS).put(round, bodyKey(owner, round.id));
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('未命中库保存失败'));
    });
  } finally { db.close(); }
}

const directoryBlob: AccountBlobAdapter<FishMissDirectory> = {
  name: 'fish-hit-rate-miss-directory',
  read: owner => read(DIRECTORY, ownerKey(owner)),
  async write(owner, value) { if (value?.version === 1 && Array.isArray(value.rounds)) await mergeDirectory(owner, value); },
  async mergeRemote(owner, value) { await directoryBlob.write(owner, value); },
  weight: value => value?.rounds.length ?? 0,
};

function roundBlob(id: string): AccountBlobAdapter<FishMissRound> {
  return {
    name: `fish-hit-rate-miss-round/${id}`,
    read: owner => read(ROUNDS, bodyKey(owner, id)),
    async write(owner, round) {
      if (round?.version !== 1 || round.id !== id || !Array.isArray(round.windows)) return;
      await mergeDirectory(owner, { version: 1, rounds: [fishMissRoundSummary(round)] }, round);
    },
    weight: value => value?.count ?? 0,
  };
}

export async function loadFishMissDirectory(owner?: string | null, refresh = false): Promise<FishMissDirectory> {
  await syncAccountBlobOnLoad(directoryBlob, owner, undefined, refresh);
  return await read(DIRECTORY, ownerKey(owner)) ?? { version: 1, rounds: [] };
}

export async function loadFishMissRound(owner: string | null | undefined, id: string, refresh = false): Promise<FishMissRound> {
  const key = bodyKey(owner, id);
  const local = await read<FishMissRound>(ROUNDS, key);
  if (local) return local;
  await syncAccountBlobOnLoad(roundBlob(id), owner, undefined, refresh);
  const round = await read<FishMissRound>(ROUNDS, key);
  if (!round) throw Error('这轮归档还未读取到，请重试');
  return round;
}

export async function saveFishMissRound(owner: string | null | undefined, round: FishMissRound): Promise<void> {
  await mergeDirectory(owner, { version: 1, rounds: [fishMissRoundSummary(round)] }, round);
  if (owner) {
    void noteAccountBlobSaved(roundBlob(round.id), owner);
    void noteAccountBlobSaved(directoryBlob, owner).then(() => syncAccountBlobOnLoad(directoryBlob, owner));
  }
}
