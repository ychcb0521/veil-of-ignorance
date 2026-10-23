/** A dedicated IndexedDB; never competes with auth/trade state in localStorage. */
let database: Promise<IDBDatabase> | undefined;
async function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('veil-avg-highlight-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cache');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export async function readAvgCache<T>(key: string): Promise<T | undefined> {
  const request = (await db()).transaction('cache').objectStore('cache').get(key);
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function writeAvgCache(key: string, value: unknown): Promise<void> {
  const transaction = (await db()).transaction('cache', 'readwrite');
  transaction.objectStore('cache').put(value, key);
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
}
