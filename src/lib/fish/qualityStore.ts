import { newQualityStudy, type FishQualityStudy } from './quality';

const DATABASE = 'veil-fish-quality-v1', STORE = 'studies';
const keyOf = (owner?: string) => `fish-quality:${owner ?? 'anonymous'}`;
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('鱼质量存储超时')); }, 8_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('鱼质量存储不可用')); };
  });
}
function valid(value: unknown): value is FishQualityStudy {
  const v = value as FishQualityStudy;
  return v?.version === 1 && Number.isFinite(v.startedAt) && ['capture', 'signal'].includes(v.entryMode)
    && Number.isFinite(v.observeHours) && v.observeHours >= 0 && v.observeHours <= 8784 && typeof v.tracking === 'boolean'
    && Array.isArray(v.samples) && Array.isArray(v.groups) && Array.isArray(v.results);
}
export async function loadQualityStudy(owner?: string): Promise<{ study: FishQualityStudy; warning?: string }> {
  let fallback: unknown;
  try { fallback = JSON.parse(localStorage.getItem(keyOf(owner)) ?? 'null'); } catch { /* durable copy still works */ }
  try {
    const db = await open();
    try {
      const stored = await new Promise<unknown>((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).get(keyOf(owner));
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      // A fallback can be newer if a previous durable write failed.
      if (valid(fallback)) return { study: fallback };
      if (stored != null && !valid(stored)) throw new Error('invalid saved study');
      return { study: valid(stored) ? stored : newQualityStudy() };
    } finally { db.close(); }
  } catch {
    return { study: valid(fallback) ? fallback : newQualityStudy(), warning: '鱼质量的本机存储暂不可用；当前结果可能无法在刷新后恢复，请保留此页面。' };
  }
}
// Serialize writes per account. A slow earlier write must never overwrite a later result/rule edit.
const writes = new Map<string, Promise<boolean>>();
export function saveQualityStudy(owner: string | undefined, study: FishQualityStudy): Promise<boolean> {
  const key = keyOf(owner), copy = structuredClone(study);
  const task = (writes.get(key) ?? Promise.resolve(true)).then(async () => {
    try {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(copy, key);
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
      try { localStorage.removeItem(key); } catch { /* optional cache cleanup */ }
      return true;
    } catch {
      try { localStorage.setItem(key, JSON.stringify(copy)); return true; } catch { return false; }
    }
  });
  writes.set(key, task);
  void task.finally(() => { if (writes.get(key) === task) writes.delete(key); });
  return task;
}
