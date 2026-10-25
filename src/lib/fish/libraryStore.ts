/** Full catch history lives independently of the small localStorage cache and derived scan sessions. */
import type { TradeSignal } from '@/lib/signalLibrary';
import { mergeFishLists, mergeFishTombstones, type FishTombstones } from './tombstones';
import { fishDedupKey } from './records';

export interface FishLibraryBackup { signals: TradeSignal[]; tombstones: FishTombstones; updatedAt?: number }
const pending = new Map<string, FishLibraryBackup>();
const running = new Map<string, Promise<boolean>>();
let retry: ReturnType<typeof setTimeout> | undefined;
let listening = false;
const ownerKey = (owner: string | null | undefined) => owner ? `user:${owner}` : 'anonymous';
export const mergeFishLibraryBackups = (latest: FishLibraryBackup, previous?: FishLibraryBackup): FishLibraryBackup => {
  const tombstones = mergeFishTombstones(latest.tombstones, previous?.tombstones);
  const current = new Map(latest.signals.map(s => [fishDedupKey(s), s]));
  const signals = mergeFishLists(latest.signals, previous?.signals, tombstones).map(s => {
    const now = current.get(fishDedupKey(s));
    // Clearing the fresh flag or cancelling a rating is a real local change too.
    return now && (now.caughtAt ?? 0) === (s.caughtAt ?? 0) ? { ...s, freshCatch: now.freshCatch, quality: now.quality } : s;
  });
  return { signals, tombstones, updatedAt: latest.updatedAt ?? previous?.updatedAt };
};
const mergeByRecency = (latest: FishLibraryBackup, previous?: FishLibraryBackup) =>
  (previous?.updatedAt ?? 0) > (latest.updatedAt ?? 0)
    ? mergeFishLibraryBackups(previous!, latest) : mergeFishLibraryBackups(latest, previous);

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('veil-fish-library-v1', 1);
    let expired = false;
    const fail = () => { expired = true; clearTimeout(timer); reject(new Error('鱼舱存储暂不可用')); };
    const timer = setTimeout(fail, 10_000);
    request.onupgradeneeded = () => request.result.createObjectStore('libraries');
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = fail;
  });
}

function scheduleRetry(): void {
  if (!pending.size || retry) return;
  retry = setTimeout(() => { retry = undefined; for (const key of pending.keys()) void flush(key); }, 5_000);
}

function flush(key: string): Promise<boolean> {
  const active = running.get(key);
  if (active) return active;
  const task = (async () => {
    try {
      while (pending.has(key)) {
        const snapshot = pending.get(key)!;
        const database = await open();
        try {
          // Read + union + write in one transaction: another tab cannot erase our earlier rounds.
          await new Promise<void>((resolve, reject) => {
            const tx = database.transaction('libraries', 'readwrite'), store = tx.objectStore('libraries');
            const request = store.get(key);
            request.onsuccess = () => {
              try { store.put(mergeByRecency(snapshot, request.result), key); }
              catch { tx.abort(); }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(tx.error);
          });
        } finally { database.close(); }
        if (pending.get(key) === snapshot) pending.delete(key);
      }
      return true;
    } catch {
      // Keep the complete pending value. Saving is retried independently of market scanning.
      scheduleRetry(); return false;
    } finally { running.delete(key); }
  })();
  running.set(key, task);
  return task;
}

/** Coalesce rapid catches without dropping earlier rounds; never block or reject a scan. */
export function saveFishLibraryBackup(owner: string | null | undefined, value: FishLibraryBackup): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(false);
  const key = ownerKey(owner);
  pending.set(key, mergeByRecency(value, pending.get(key)));
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    const resume = () => { for (const owner of pending.keys()) void flush(owner); };
    window.addEventListener('online', resume);
    window.addEventListener('pagehide', resume);
  }
  return flush(key);
}

export async function loadFishLibraryBackup(owner: string | null | undefined): Promise<FishLibraryBackup | null> {
  if (typeof indexedDB === 'undefined') return null;
  const key = ownerKey(owner);
  // Finish local writes before reading; recover the in-memory queue too if the database is unavailable.
  await running.get(key);
  try {
    const database = await open();
    try {
      const stored = await new Promise<FishLibraryBackup | undefined>((resolve, reject) => {
        const request = database.transaction('libraries').objectStore('libraries').get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return stored || pending.has(key) ? mergeByRecency(pending.get(key) ?? { signals: [], tombstones: {} }, stored) : null;
    } finally { database.close(); }
  } catch { return pending.get(key) ?? null; }
}
