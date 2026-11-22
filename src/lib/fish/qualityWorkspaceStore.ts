import { newQualityStudy, type FishQualityStudy } from './quality';
import { qualityWorkspaceData, preserveQualityWorkspace } from './qualitySignalReadingsStore';
import { importQualityWorkspaceRows } from './qualityWorkspace';

/** Only the small workspace sibling is accessed. Never read or write the historical study. */
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('veil-fish-quality-v1', 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(Error('组合表存储超时，请重试')); }, 8000);
    request.onupgradeneeded = () => request.result.createObjectStore('studies');
    request.onerror = request.onblocked = () => { expired = true; clearTimeout(timer); reject(Error('组合表存储不可用，请重试')); };
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
  });
}
const keyOf = (owner?: string) => `fish-quality:${owner ?? 'anonymous'}:workspace`;
export async function readQualityWorkspace(owner?: string): Promise<FishQualityStudy | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('studies', 'readonly'), request = tx.objectStore('studies').get(keyOf(owner));
      tx.oncomplete = () => resolve(request.result?.workspaceUpdatedAt ? preserveQualityWorkspace(request.result, newQualityStudy()) : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('组合表读取失败，请重试'));
    });
  } finally { db.close(); }
}
export async function updateQualityWorkspace(owner: string | undefined, apply: (study: FishQualityStudy) => FishQualityStudy, fallback?: FishQualityStudy) {
  const db = await open();
  try {
    return await new Promise<FishQualityStudy>((resolve, reject) => {
      const tx = db.transaction('studies', 'readwrite'), store = tx.objectStore('studies');
      const request = store.get(keyOf(owner));
      let next: FishQualityStudy;
      request.onsuccess = () => {
        try {
          const base = preserveQualityWorkspace(request.result, fallback ?? newQualityStudy());
          next = apply(base);
          next = {...next,workspaceUpdatedAt:Math.max(Date.now(),(base.workspaceUpdatedAt ?? 0)+1)};
          store.put(qualityWorkspaceData(next),keyOf(owner));
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('组合表保存失败，原内容已保留，请重试'));
    });
  } finally { db.close(); }
}
export const importQualityWorkspaceInformation = (owner: string | undefined, snapshot: FishQualityStudy, ids: readonly string[], fallback?: FishQualityStudy) =>
  updateQualityWorkspace(owner, study => importQualityWorkspaceRows(study,snapshot,ids), fallback);
