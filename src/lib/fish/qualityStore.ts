import { newQualityStudy, type FishQualityStudy } from './quality';
import { preserveQualityRepairs, stopQualityRepair } from './qualityRepair';

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
/** 纠错已停用：读出来的记录一律先结束纠错（已核验的保留，其余恢复原样），见 stopQualityRepair。 */
export async function loadQualityStudy(owner?: string): Promise<{ study: FishQualityStudy; warning?: string }> {
  const loaded = await loadQualityStudyRaw(owner);
  return { ...loaded, study: stopQualityRepair(loaded.study, Date.now()) };
}
async function loadQualityStudyRaw(owner?: string): Promise<{ study: FishQualityStudy; warning?: string }> {
  // A detail link can open immediately after the evaluator unmounts and flushes.
  await writes.get(keyOf(owner));
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
      if (valid(fallback)) return { study: preserveQualityRepairs(valid(stored) ? stored : undefined,fallback) };
      if (stored != null && !valid(stored)) throw new Error('invalid saved study');
      return { study: valid(stored) ? stored : newQualityStudy() };
    } finally { db.close(); }
  } catch {
    return { study: valid(fallback) ? fallback : newQualityStudy(), warning: '鱼质量的本机存储暂不可用；当前结果可能无法在刷新后恢复，请保留此页面。' };
  }
}
// Serialize writes per account. A slow earlier write must never overwrite a later result/rule edit.
const writes = new Map<string, Promise<boolean>>();
export function saveQualityStudy(owner: string | undefined, study: FishQualityStudy, options?: { repairOnly: boolean }): Promise<boolean> {
  const key = keyOf(owner), copy = structuredClone(study);
  const merge = (previous: unknown) => options?.repairOnly && valid(previous) ? preserveQualityRepairs(copy,previous) : preserveQualityRepairs(valid(previous) ? previous : undefined,copy);
  const task = (writes.get(key) ?? Promise.resolve(true)).then(async () => {
    let durablePrevious: FishQualityStudy | undefined;
    try {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), read = store.get(key);
          read.onsuccess = () => { durablePrevious = valid(read.result) ? read.result : undefined; store.put(merge(read.result), key); };
          tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
      try { localStorage.removeItem(key); } catch { /* optional cache cleanup */ }
      return true;
    } catch {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
        localStorage.setItem(key, JSON.stringify(merge(valid(saved) ? preserveQualityRepairs(durablePrevious,saved) : durablePrevious))); return true;
      } catch { return false; }
    }
  });
  writes.set(key, task);
  void task.then(ok => { if (ok && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner, repair: copy.campaignRepair && { id: copy.campaignRepair.id, state: copy.campaignRepair.state } } })); });
  void task.finally(() => { if (writes.get(key) === task) writes.delete(key); });
  return task;
}
