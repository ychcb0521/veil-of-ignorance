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
