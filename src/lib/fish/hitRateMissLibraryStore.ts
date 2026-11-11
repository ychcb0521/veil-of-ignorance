import { noteAccountBlobSaved, syncAccountBlobOnLoad, type AccountBlobAdapter } from '@/lib/accountBlobSync';
import { fishMissRoundSummary, fishMissUpdates, mergeFishActiveMisses, mergeFishMissDirectories, type FishActiveMisses, type FishMissDirectory, type FishMissRound, type FishMissUpdate } from './hitRateMissLibrary';

const DATABASE = 'veil-fish-hit-rate-misses-v1';
const DIRECTORY = 'directories';
const ROUNDS = 'rounds';
const ownerKey = (owner?: string | null) => owner ? `user:${owner}` : 'anonymous';
const activeKey = (owner?: string | null) => [ownerKey(owner), 'active-misses'];
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

async function mergeActive(owner: string | null | undefined, incoming: FishActiveMisses): Promise<FishActiveMisses> {
  const db = await open();
  try {
    return await new Promise<FishActiveMisses>((resolve, reject) => {
      const tx = db.transaction(DIRECTORY, 'readwrite');
      const store = tx.objectStore(DIRECTORY), key = activeKey(owner), request = store.get(key);
      let merged: FishActiveMisses;
      request.onsuccess = () => {
        try {
          merged = mergeFishActiveMisses(request.result, incoming);
          store.put(merged, key);
        }
        catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(merged);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('待复测样本更新失败'));
    });
  } finally { db.close(); }
}

const activeBlob: AccountBlobAdapter<FishActiveMisses> = {
  name: 'fish-hit-rate-active-misses',
  read: owner => read(DIRECTORY, activeKey(owner)),
  async write(owner, value) {
    if (value?.version === 1 && Array.isArray(value.updates) && Array.isArray(value.indexedRounds)) await mergeActive(owner, value);
  },
  async mergeRemote(owner, value) { await activeBlob.write(owner, value); },
  weight: value => value ? value.updates.length + value.indexedRounds.length : 0,
};

export function readFishActiveMisses(owner?: string | null) {
  return read<FishActiveMisses>(DIRECTORY, activeKey(owner));
}

export async function saveFishMissUpdates(owner: string | null | undefined, updates: FishMissUpdate[], indexedRounds: string[] = []) {
  const merged = await mergeActive(owner, { version: 1, updates, indexedRounds });
  if (owner) void noteAccountBlobSaved(activeBlob, owner).then(() => syncAccountBlobOnLoad(activeBlob, owner));
  return merged;
}

export async function loadFishActiveMisses(owner: string | null | undefined, directory: FishMissDirectory, refresh = false) {
  await syncAccountBlobOnLoad(activeBlob, owner, undefined, refresh);
  const previous = await readFishActiveMisses(owner);
  const indexed = new Set(previous?.indexedRounds);
  const updates: FishMissUpdate[] = [];
  const imported: string[] = [];
  for (const summary of directory.rounds) {
    if (indexed.has(summary.id)) continue;
    try {
      const round = await loadFishMissRound(owner, summary.id, refresh);
      updates.push(...fishMissUpdates(round.id, round.startedAt ?? round.completedAt, round.windows));
      imported.push(round.id);
    } catch { /* A round with a pending body can be read again later. */ }
  }
  if (imported.length) await saveFishMissUpdates(owner, updates, imported);
  return await readFishActiveMisses(owner) ?? mergeFishActiveMisses();
}
