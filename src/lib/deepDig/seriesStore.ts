/**
 * Deep dig 时间序列曲线的本机存储（IndexedDB）：每个事件 × 每个变量 × 每个点，约几 MB，localStorage 放不下。
 * 只是可重建的缓存：存不了 / 读不到，就提示重跑描述统计。按用户、按特征值各一份，只留最近一次。
 */
import type { DeepDigSeries } from '@/lib/deepDig/series';

const DATABASE = 'veil-deep-dig';
const STORE = 'series';
const VERSION = 1;
const IO_TIMEOUT_MS = 8000;

function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | null, pick: (result: unknown) => T | null): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    let database: IDBDatabase | undefined;
    let finished = false;
    const finish = (value: T | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      database?.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), IO_TIMEOUT_MS);
    try {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = () => {
        database = request.result;
        if (finished) { database.close(); return; }
        database.onversionchange = () => database?.close();
        try {
          const transaction = database.transaction(STORE, mode);
          const req = work(transaction.objectStore(STORE));
          let result: T | null = null;
          if (req) req.onsuccess = () => { result = pick(req.result); };
          transaction.oncomplete = () => finish(result);
          transaction.onabort = () => finish(null);
          transaction.onerror = () => finish(null);
        } catch { finish(null); }
      };
    } catch { finish(null); }
  });
}

const keyOf = (userId: string, featureId: string) => `${userId}:${featureId}`;

const valid = (v: unknown): v is DeepDigSeries => {
  const s = v as DeepDigSeries | null;
  return !!s && typeof s.finishedAt === 'number' && Array.isArray(s.offsets) && Array.isArray(s.names) && typeof s.byEvent === 'object' && s.byEvent != null;
};

export function saveDeepDigSeries(userId: string, featureId: string, series: DeepDigSeries): Promise<true | null> {
  return withStore('readwrite', store => { store.put(series, keyOf(userId, featureId)); return null; }, () => true).then(() => true);
}

/** 读最近一次；finishedAt 对不上（描述统计重跑过、没存上）返回 null。 */
export function loadDeepDigSeries(userId: string, featureId: string, finishedAt: number): Promise<DeepDigSeries | null> {
  return withStore('readonly', store => store.get(keyOf(userId, featureId)), r => (valid(r) && r.finishedAt === finishedAt ? r : null));
}

export function forgetDeepDigSeries(userId: string, featureId: string): Promise<unknown> {
  return withStore('readwrite', store => { store.delete(keyOf(userId, featureId)); return null; }, () => true);
}
