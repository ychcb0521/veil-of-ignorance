/**
 * Local-only reconstruction cache. Never use sim_* keys or persisted-state/cloud writers here.
 * 【用户要求】2026-10-20「复原扫描的这个结果能保存吗？」——结果约 1 MB，localStorage（整站共用约 5 MB）满了就存不下，刷新即丢。
 * 现在先存浏览器的 IndexedDB（容量大得多，与渔的本轮结果同一种存法），存不进再退回 localStorage；读取两边都看，旧结果照常可读。
 */
import { definitionKey, isSellerFeature, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';
import { shortFishHash } from './algorithm';
import type { FishReconstructionResult } from './reconstruction';
import type { FishPreference } from './preferences';

export interface ReconstructionCard { id: string; featureId: string; enabled: boolean; pref: FishPreference }
export interface ReconstructionCache { version: 1; key: string; result: FishReconstructionResult }
export const reconstructionStorageKey = (account: string | undefined) => `veil:fish-reconstruction:v1:${encodeURIComponent(account ?? 'anonymous')}`;
export function reconstructionCacheKey(account: string | undefined, cards: readonly ReconstructionCard[], defs: readonly DeepDigFeatureDef[], signals: readonly TradeSignal[]): string {
  const algorithms = cards.map(c => {
    const d = defs.find(d => d.id === c.featureId);
    return [c.featureId, c.enabled, c.pref.statistic ?? '结果', c.pref.direction, c.pref.threshold,
      d ? definitionKey(d) : null, d?.scale, d?.unit, '结果', isSellerFeature(c.featureId)?'<':'>'];
  });
  // Include identity/source fields used by adapters, not ratings or UI-only notes.
  const samples = signals.map(s => [s.id, s.exchange ?? 'binance', s.market ?? 'crypto', s.symbol, s.underlying ?? '', s.timeMs])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return shortFishHash(JSON.stringify([1, account ?? 'anonymous', algorithms, samples]));
}
export function readReconstructionCache(account: string | undefined, key?: string): ReconstructionCache | null {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(reconstructionStorageKey(account)) ?? '[]');
    if (!Array.isArray(entries)) return null;
    return entries.find(v => v?.version === 1 && typeof v.key === 'string' && (!key || v.key === key)
      && Number.isFinite(v.result?.createdAt) && Array.isArray(v.result?.algorithms)) ?? null;
  } catch { return null; }
}
export function saveReconstructionCache(account: string | undefined, key: string, result: FishReconstructionResult): boolean {
  const entry: ReconstructionCache = { version: 1, key, result };
  // Keep the latest result plus one previous setting for an explicit, useful stale state.
  const previous = readReconstructionCache(account);
  const entries = previous && previous.key !== key ? [entry, previous] : [entry];
  try { localStorage.setItem(reconstructionStorageKey(account), JSON.stringify(entries)); return true; }
  catch {
    try { localStorage.setItem(reconstructionStorageKey(account), JSON.stringify([entry])); return true; }
    catch { return false; }
  }
}

const DB_NAME = 'veil-fish-reconstruction-v1', STORE = 'caches';
function openReconstructionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器不支持 IndexedDB')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本机结果库被其它标签页占用'));
  });
}
const validEntry = (v: unknown, key?: string): v is ReconstructionCache => {
  const x = v as ReconstructionCache | null;
  return !!x && x.version === 1 && typeof x.key === 'string' && (!key || x.key === key) && Number.isFinite(x.result?.createdAt) && Array.isArray(x.result?.algorithms);
};
async function readDbEntries(account: string | undefined): Promise<ReconstructionCache[]> {
  const db = await openReconstructionDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(reconstructionStorageKey(account));
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result.filter(v => validEntry(v)) : []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
/** 从 IndexedDB 读（给了 key 只认同一套设置的那份）；读不了返回 null。 */
export async function loadReconstructionCacheDb(account: string | undefined, key?: string): Promise<ReconstructionCache | null> {
  try { return (await readDbEntries(account)).find(v => validEntry(v, key)) ?? null; } catch { return null; }
}
/** 存进 IndexedDB（最新一份 + 上一套设置的一份）；成功后删掉 localStorage 里的旧副本，腾出整站共用的空间。 */
export async function saveReconstructionCacheDb(account: string | undefined, key: string, result: FishReconstructionResult): Promise<boolean> {
  try {
    const entry: ReconstructionCache = { version: 1, key, result };
    const previous = (await readDbEntries(account))[0] ?? readReconstructionCache(account);
    const entries = previous && previous.key !== key ? [entry, previous] : [entry];
    const db = await openReconstructionDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(entries, reconstructionStorageKey(account));
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    try { localStorage.removeItem(reconstructionStorageKey(account)); } catch { /* 删不掉只是多占点空间 */ }
    return true;
  } catch { return false; }
}
