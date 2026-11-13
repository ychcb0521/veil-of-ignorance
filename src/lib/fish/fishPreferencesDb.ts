const DATABASE = 'veil-fish-preferences-v1';
const STORE = 'records';

function openPreferences(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openPreferences();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? Error('浏览器存储事务已取消'));
      run(tx.objectStore(STORE), next => { value = next; });
    });
  } finally { db.close(); }
}

export function readFishPreferences<T>(keys: readonly string[]): Promise<(T | undefined)[]> {
  return transact('readonly', (store, complete) => {
    const values: (T | undefined)[] = Array(keys.length);
    complete(values);
    keys.forEach((key, index) => {
      const request = store.get(key);
      request.onsuccess = () => { values[index] = request.result; };
    });
  });
}

export function readFishPreferencesWithPrefix<T>(prefix: string): Promise<T[]> {
  return transact('readonly', (store, complete) => {
    const request = store.getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'));
    request.onsuccess = () => complete(request.result);
  });
}

export function writeFishPreference<T>(key: string, value: T): Promise<void> {
  return transact('readwrite', store => { store.put(value, key); });
}

/** Merge a durable preference within the same transaction that writes it. */
export function updateFishPreference<T>(key: string, merge: (previous?: T) => T): Promise<T> {
  return transact('readwrite', (store, complete) => {
    const request = store.get(key);
    request.onsuccess = () => {
      const previous: T | undefined = request.result;
      const value = merge(previous);
      if (value !== previous) store.put(value, key);
      complete(value);
    };
  });
}
