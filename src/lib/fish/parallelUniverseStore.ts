import type { ParallelAttempt, ParallelSignal } from './parallelUniverse';

export interface RegretCandidate {
  id: string;
  symbol: string;
  entryTime: number | null;
  signal?: ParallelSignal;
}

const CANDIDATES = 'candidates';
const HISTORY = 'history';
const SETTINGS = 'settings';
const key = (owner: string | undefined) => owner ? 'user:' + owner : 'anonymous';

async function transaction<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('veil-fish-regret-library-v1', 1);
    request.onupgradeneeded = () => {
      for (const store of [CANDIDATES, HISTORY, SETTINGS]) request.result.createObjectStore(store);
    };
    request.onblocked = () => { blocked = true; reject(Error('后悔库正在其他页面升级')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? Error('后悔库操作失败'));
      work(tx, next => { value = next; });
    });
  } finally {
    db.close();
  }
}

export interface ParallelSettings {
  plans?: import('./quality').QualityGroup[];
  planId: string;
  additionCount: number;
  observeHours: number;
}

export function loadParallelSettings(owner?: string) {
  return transaction<ParallelSettings | undefined>(SETTINGS, 'readonly', (tx, result) => {
    const request = tx.objectStore(SETTINGS).get(key(owner));
    request.onsuccess = () => result(request.result);
  });
}

export function saveParallelSettings(owner: string | undefined, settings: ParallelSettings) {
  return transaction<void>(SETTINGS, 'readwrite', tx => {
    tx.objectStore(SETTINGS).put(settings, key(owner));
  });
}

export function saveParallelAttempt(owner: string | undefined, attempt: ParallelAttempt) {
  const { candidate, proposedSignal } = attempt;
  const id = candidate.signalId ?? candidate.id;
  const ownerKey = key(owner);
  return transaction<void>([CANDIDATES, HISTORY], 'readwrite', tx => {
    const store = tx.objectStore(CANDIDATES);
    const history = tx.objectStore(HISTORY);
    const historyKey = [ownerKey, id, attempt.baseline.evaluatedAt, attempt.id];
    const existing = history.getKey(historyKey);
    existing.onsuccess = () => {
      if (existing.result !== undefined) return;
      const request = store.get([ownerKey, id]);
      request.onsuccess = () => {
        const previous: RegretCandidate | undefined = request.result;
        const signal = previous?.signal ?? proposedSignal;
        store.put({ id, symbol: candidate.source.symbol, entryTime: candidate.enteredAt, signal }, [ownerKey, id]);
        history.add({ ...attempt, emitted: !previous?.signal && !!proposedSignal }, historyKey);
      };
    };
  });
}

const PAGE_SIZE = 40;
function page<T>(store: string, prefix: string[], before?: IDBValidKey) {
  return transaction<{ rows: T[]; next?: IDBValidKey }>(store, 'readonly', (tx, result) => {
    const request = tx.objectStore(store).openCursor(
      IDBKeyRange.bound(prefix, before ?? [...prefix, []], true, true), 'prev',
    );
    const rows: T[] = [];
    let last: IDBValidKey | undefined;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length === PAGE_SIZE) {
        result({ rows, next: cursor ? last : undefined });
        return;
      }
      rows.push(cursor.value);
      last = cursor.key;
      cursor.continue();
    };
  });
}

export const loadRegretDirectory = (owner?: string, before?: IDBValidKey) =>
  page<RegretCandidate>(CANDIDATES, [key(owner)], before);

export const loadRegretHistory = (owner: string | undefined, id: string, before?: IDBValidKey) =>
  page<ParallelAttempt & { emitted: boolean }>(HISTORY, [key(owner), id], before);
