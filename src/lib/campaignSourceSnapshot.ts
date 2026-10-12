import type { CampaignSourceRows } from '@/lib/journalApi';

/** Read-only startup acceleration, never a source for database writes or account sync. */
export interface CampaignSourceSnapshotStore {
  read(userId: string): Promise<CampaignSourceRows | null>;
  write(userId: string, rows: CampaignSourceRows): Promise<void>;
}

const DATABASE = 'veil-campaign-read-cache';
const STORE = 'sources';
const VERSION = 1;
export const CAMPAIGN_SOURCE_SNAPSHOT_READ_MS = 300;
const IO_TIMEOUT_MS = 2_000;

export function validateCampaignSourceSnapshot(value: unknown, owner: string): CampaignSourceRows | null {
  if (!owner || value == null || typeof value !== 'object') return null;
  const saved = value as { version?: unknown; owner?: unknown; rows?: CampaignSourceRows };
  const rows = saved.rows;
  if (saved.version !== VERSION || saved.owner !== owner || !rows
    || !Array.isArray(rows.campaigns) || !Array.isArray(rows.journals)) return null;
  // A corrupt/mis-keyed cache must never show another account's financial data.
  if (![...rows.campaigns, ...rows.journals].every(row => row != null && typeof row === 'object'
    && typeof (row as { id?: unknown }).id === 'string' && (row as { user_id?: unknown }).user_id === owner)) return null;
  return rows;
}

function transact<T>(userId: string, mode: IDBTransactionMode, rows?: CampaignSourceRows): Promise<T | null> {
  if (!userId || typeof indexedDB === 'undefined') return Promise.resolve(null);
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
    const timer = setTimeout(() => finish(null), mode === 'readonly' ? CAMPAIGN_SOURCE_SNAPSHOT_READ_MS : IO_TIMEOUT_MS);
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
          const store = transaction.objectStore(STORE);
          let result: T | null = null;
          if (mode === 'readonly') {
            const read = store.get(userId);
            read.onsuccess = () => { result = validateCampaignSourceSnapshot(read.result, userId) as T | null; };
          } else {
            store.put({ version: VERSION, owner: userId, savedAt: Date.now(), rows }, userId);
          }
          transaction.oncomplete = () => finish(result);
          transaction.onabort = () => finish(null);
          transaction.onerror = () => finish(null);
        } catch { finish(null); }
      };
    } catch { finish(null); }
  });
}

/** IndexedDB avoids synchronous JSON serialization and the auth-token localStorage quota. */
export const campaignSourceSnapshotStore: CampaignSourceSnapshotStore = {
  read: userId => transact<CampaignSourceRows>(userId, 'readonly'),
  write: async (userId, rows) => { await transact(userId, 'readwrite', rows); },
};
