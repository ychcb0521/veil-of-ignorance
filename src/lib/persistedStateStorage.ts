/**
 * Critical state must remain readable even when browser storage is full.
 * Only derived campaign chart caches may be reclaimed; never trade/order history,
 * journals, auth, settings or cloud mirrors. Cloud synchronization stays in callers.
 */
const REBUILDABLE_CACHE_PREFIXES = ['campaign-price-path-v3:', 'campaign-unrealized-chart-v1:'];
type StateOrigin = { source: 'local' | 'remote'; updatedAt?: number };
const unpersisted = new Map<string, StateOrigin & { raw: string | null }>();
const hydrationListeners = new Map<string, Set<() => void>>();
const hydrationRevisions = new Map<string, number>();
let hydrationRevision = 0;

/** Detect an adopted restore that arrived while an async page was still loading. */
export function getPersistedStateHydrationRevision(fullKey?: string): number {
  return fullKey === undefined ? hydrationRevision : hydrationRevisions.get(fullKey) ?? 0;
}

export function getUnpersistedStateRaw(fullKey: string): string | null | undefined {
  return unpersisted.get(fullKey)?.raw;
}

export function getUnpersistedStateMetadata(fullKey: string): StateOrigin | undefined {
  return unpersisted.get(fullKey);
}

/** A cloud acknowledgement changes provenance, not the still-unavailable durable storage. */
export function markPersistedStateSynced(fullKey: string, raw: string, updatedAt: number): void {
  const current = unpersisted.get(fullKey);
  if (!current || current.raw !== raw || !Number.isFinite(updatedAt)) return;
  unpersisted.set(fullKey, {
    raw,
    source: 'remote',
    updatedAt: Math.max(updatedAt, current.source === 'remote' ? current.updatedAt ?? 0 : 0),
  });
}

export function readPersistedStateRaw(fullKey: string): string | null {
  const latest = unpersisted.get(fullKey);
  if (latest !== undefined) return latest.raw;
  try { return localStorage.getItem(fullKey); } catch { return null; }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export function writePersistedStateRaw(fullKey: string, raw: string, origin: StateOrigin = { source: 'local' }): boolean {
  // Remember first: even a security exception must not leave readers on the old value.
  unpersisted.set(fullKey, { ...origin, raw });
  const write = () => {
    localStorage.setItem(fullKey, raw);
    unpersisted.delete(fullKey);
  };
  try {
    write();
    return true;
  } catch (error) {
    if (!isQuotaError(error)) return false;
  }
  // Capture exact cache keys before removal; never enumerate and mutate by index together.
  try {
    const disposable: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && REBUILDABLE_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) disposable.push(key);
    }
    for (const key of disposable) {
      localStorage.removeItem(key);
      try {
        write();
        return true;
      } catch (error) {
        if (!isQuotaError(error)) return false;
      }
    }
  } catch { /* Blocked storage: the current session and cloud push still have the new value. */ }
  return false;
}

/**
 * Supabase stores its auth token with a plain localStorage write, so it never reaches the
 * eviction path above. A token that cannot be stored leaves the app on its loading screen
 * (boot) or failing every request (hourly refresh), so derived caches must leave it room.
 */
export const CRITICAL_STORAGE_HEADROOM_CHARS = 16 * 1024;
const HEADROOM_PROBE_KEY = 'veil.storage.headroom-probe';
const HEADROOM_PROBE = 'x'.repeat(CRITICAL_STORAGE_HEADROOM_CHARS);
export type StorageHeadroom = 'ok' | 'reclaimed' | 'full' | 'unavailable';

function probeCriticalHeadroom(): Exclude<StorageHeadroom, 'reclaimed'> {
  try {
    localStorage.setItem(HEADROOM_PROBE_KEY, HEADROOM_PROBE);
    return 'ok';
  } catch (error) {
    return isQuotaError(error) ? 'full' : 'unavailable';
  } finally {
    try { localStorage.removeItem(HEADROOM_PROBE_KEY); } catch { /* Nothing was written. */ }
  }
}

function rebuildableCacheKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && REBUILDABLE_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) keys.push(key);
  }
  return keys;
}

/** Characters held by derived chart caches: what a reclaim could release. */
export function measureRebuildableCaches(): { entries: number; chars: number } {
  try {
    const keys = rebuildableCacheKeys();
    return { entries: keys.length, chars: keys.reduce((sum, key) => sum + key.length + (localStorage.getItem(key)?.length ?? 0), 0) };
  } catch { return { entries: 0, chars: 0 }; }
}

/** Free room for the auth token before it is written; only derived chart caches are removed. */
export function ensureCriticalStorageHeadroom(): StorageHeadroom {
  const before = probeCriticalHeadroom();
  if (before !== 'full') return before;
  try {
    let released = 0;
    for (const key of rebuildableCacheKeys()) {
      released += key.length + (localStorage.getItem(key)?.length ?? 0);
      localStorage.removeItem(key);
      // Probe only once enough was released: each probe writes the whole reserve.
      if (released < CRITICAL_STORAGE_HEADROOM_CHARS) continue;
      if (probeCriticalHeadroom() === 'ok') return 'reclaimed';
      released = 0;
    }
  } catch { return 'unavailable'; }
  return probeCriticalHeadroom() === 'ok' ? 'reclaimed' : 'full';
}

/** Derived caches yield the last stretch of storage: an entry that would use it is not kept. */
export function writeRebuildableCache(fullKey: string, raw: string): boolean {
  try { localStorage.setItem(fullKey, raw); } catch { return false; }
  if (probeCriticalHeadroom() !== 'full') return true;
  try { localStorage.removeItem(fullKey); } catch { /* The next boot reclaims it. */ }
  return false;
}

/** Deletion must also remove a failed-write overlay, even if storage is blocked. */
export function removePersistedStateRaw(fullKey: string): void {
  unpersisted.set(fullKey, { source: 'local', raw: null });
  try {
    localStorage.removeItem(fullKey);
    unpersisted.delete(fullKey);
  } catch { /* A session tombstone keeps stale disk data from reappearing. */ }
}

/** Adopted cloud values may arrive after the app's non-blocking startup timeout. */
export function notifyPersistedStateHydrated(fullKey: string): void {
  hydrationRevisions.set(fullKey, ++hydrationRevision);
  hydrationListeners.get(fullKey)?.forEach(listener => listener());
}

export function subscribePersistedStateHydration(fullKey: string, listener: () => void): () => void {
  const listeners = hydrationListeners.get(fullKey) ?? new Set<() => void>();
  listeners.add(listener);
  hydrationListeners.set(fullKey, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) hydrationListeners.delete(fullKey);
  };
}

export function clearPersistedStateMemoryForTests(): void {
  unpersisted.clear();
  hydrationRevisions.clear();
  hydrationRevision = 0;
}
