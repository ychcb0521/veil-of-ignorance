/**
 * Critical state must remain readable even when browser storage is full.
 * Only derived campaign chart caches may be reclaimed; never trade/order history,
 * journals, auth, settings or cloud mirrors. Cloud synchronization stays in callers.
 */
// 不带版本号：换了版本留下的旧缓存同样可重建，同样该清
const REBUILDABLE_CACHE_PREFIXES = ['campaign-price-path-', 'campaign-unrealized-chart-'];
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
 * 给登录令牌与交易数据留位置。
 *
 * 事故：本地存储写满后，登录成功却进不去——Supabase 自己直接写 localStorage 存令牌，不经过上面那条
 * 「写不进就回收图表缓存」的路径；新令牌存不进去，启动时永远停在「加载中」，登录页点了没有反应。
 *
 * 【用户要求】「要始终能够有内存可用」。三道保证，都只动可重建的东西：
 *   1. 行情 / 图表缓存让出余量：总量有上限，并且不占用最后 STORAGE_RESERVE_CHARS——启动时与缓存写入后都核对，不够就清缓存；
 *   2. 一块只留给登录令牌的预留（AUTH_RESERVE_KEY）：平时占着位置，交易数据再怎么长也挤不进来，令牌要写时才放出来；
 *   3. 令牌真的写不进去的那一刻（installAuthTokenWriteGuard）：当场腾位置再写一次，覆盖启动、登录与每小时一次的刷新。
 * 能清的依次是：图表缓存 → 消息记录与行情价缓存（界面日志，写不进去本来也不影响交易）→ 令牌预留。
 * 持仓、成交、委托、日志、信号库、画线一律不动。
 */
export const STORAGE_RESERVE_CHARS = 128 * 1024;
/** 可重建缓存合计最多占这么多：超过就从最大的清起（涨幅未兑现的上次读数最大，先清它）。 */
export const REBUILDABLE_CACHE_BUDGET_CHARS = 1024 * 1024;
/** 登录令牌连同附属键约 3 KB；预留给足余量。 */
export const AUTH_TOKEN_ROOM_CHARS = 8 * 1024;
/** @deprecated 旧名字：给登录令牌腾出的位置。 */
export const CRITICAL_STORAGE_HEADROOM_CHARS = AUTH_TOKEN_ROOM_CHARS;
export const AUTH_RESERVE_KEY = 'veil.storage.auth-reserve';
const HEADROOM_PROBE_KEY = 'veil.storage.headroom-probe';
/** 缓存写入后核对余量的最短间隔：一批几百条缓存连着写时不必每条都探一次。 */
const RESERVE_CHECK_INTERVAL_MS = 2_000;
const AUTH_TOKEN_KEY = /^sb-.+-auth-token(-code-verifier|-user)?$/;
/** 界面日志与行情价缓存：消息记录（封顶 300 条）、上一段回放留下的行情价、未登录时写下的键。 */
const DISPOSABLE_LOG_KEY = /^sim_.+_(notification_history|price_map)$|^sim_anon_/;
export type StorageHeadroom = 'ok' | 'reclaimed' | 'full' | 'unavailable';

const padding = new Map<number, string>();
function pad(chars: number): string {
  let value = padding.get(chars);
  if (value === undefined) {
    value = 'x'.repeat(chars);
    padding.set(chars, value);
  }
  return value;
}

/** 还写不写得下这么多字符：写一枚探针再删掉，不留痕迹。 */
function probeRoom(chars: number): Exclude<StorageHeadroom, 'reclaimed'> {
  try {
    localStorage.setItem(HEADROOM_PROBE_KEY, pad(Math.max(0, chars - HEADROOM_PROBE_KEY.length)));
    return 'ok';
  } catch (error) {
    return isQuotaError(error) ? 'full' : 'unavailable';
  } finally {
    try { localStorage.removeItem(HEADROOM_PROBE_KEY); } catch { /* Nothing was written. */ }
  }
}

function sizedKeys(match: (key: string) => boolean): { key: string; chars: number }[] {
  const keys: { key: string; chars: number }[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && match(key)) keys.push({ key, chars: key.length + (localStorage.getItem(key)?.length ?? 0) });
  }
  // 从最大的清起：少清几条就够，小而多的峰值涨幅读数尽量留着
  return keys.sort((a, b) => b.chars - a.chars);
}

const isRebuildableCache = (key: string) => REBUILDABLE_CACHE_PREFIXES.some(prefix => key.startsWith(prefix));
const isDisposableLog = (key: string) => DISPOSABLE_LOG_KEY.test(key);

/** Characters held by derived chart caches: what a reclaim could release. */
export function measureRebuildableCaches(): { entries: number; chars: number } {
  try {
    const keys = sizedKeys(isRebuildableCache);
    return { entries: keys.length, chars: keys.reduce((sum, item) => sum + item.chars, 0) };
  } catch { return { entries: 0, chars: 0 }; }
}

/** 现在还写得下多少（不超过 chars）：二分探几次，精确到半 KB。只在确知不够时才量。 */
function freeRoomUpTo(chars: number): number {
  let low = 0;
  let high = chars;
  while (high - low > 512) {
    const middle = Math.floor((low + high) / 2);
    if (probeRoom(middle) === 'ok') low = middle; else high = middle;
  }
  return low;
}

/** 从最大的清起，清到写得下 chars 为止：先量出还差多少，放出够数才探一次，够用就停。 */
function evictUntilRoom(chars: number, match: (key: string) => boolean): boolean {
  let shortfall = chars - freeRoomUpTo(chars);
  for (const { key, chars: size } of sizedKeys(match)) {
    localStorage.removeItem(key);
    shortfall -= size;
    if (shortfall > 0) continue;
    if (probeRoom(chars) === 'ok') return true;
    shortfall = chars - freeRoomUpTo(chars);
  }
  return probeRoom(chars) === 'ok';
}

/**
 * 腾出 chars 的位置。tiers：只清图表缓存（'caches'），或再清界面日志与令牌预留（'auth'，只在令牌要写时用）。
 * 'full' = 能清的都清了仍然不够，剩下的全是交易数据。
 */
function makeRoom(chars: number, tiers: 'caches' | 'auth'): StorageHeadroom {
  const before = probeRoom(chars);
  if (before !== 'full') return before;
  try {
    if (tiers === 'auth') {
      // 预留本来就是为这一刻占的位置：先放它，够用就不必动缓存
      localStorage.removeItem(AUTH_RESERVE_KEY);
      if (probeRoom(chars) === 'ok') return 'reclaimed';
    }
    if (evictUntilRoom(chars, isRebuildableCache)) return 'reclaimed';
    if (tiers === 'auth' && evictUntilRoom(chars, isDisposableLog)) return 'reclaimed';
  } catch { return 'unavailable'; }
  return 'full';
}

/** 令牌要写之前（启动、登录）调用：保证写得下一枚登录令牌。 */
export function ensureCriticalStorageHeadroom(): StorageHeadroom {
  return makeRoom(AUTH_TOKEN_ROOM_CHARS, 'auth');
}

/** 把令牌预留占回去；放不下时先让缓存让位，仍放不下就算了（下次启动再试）。 */
export function restoreAuthStorageReserve(): boolean {
  const write = () => localStorage.setItem(AUTH_RESERVE_KEY, pad(AUTH_TOKEN_ROOM_CHARS - AUTH_RESERVE_KEY.length));
  try {
    if (localStorage.getItem(AUTH_RESERVE_KEY) !== null) return true;
    write();
    return true;
  } catch (error) {
    if (!isQuotaError(error)) return false;
  }
  try {
    if (!evictUntilRoom(AUTH_TOKEN_ROOM_CHARS, isRebuildableCache)) return false;
    write();
    return true;
  } catch { return false; }
}

let lastReserveCheckAt = Number.NEGATIVE_INFINITY;

/**
 * 缓存让出余量：合计超过上限的从最大的清起；剩余空间不足 STORAGE_RESERVE_CHARS 时继续清，直到够或缓存清完。
 * 启动时调一次，缓存写入后按间隔再核对。只动图表缓存。
 */
export function ensureStorageReserve(): StorageHeadroom {
  lastReserveCheckAt = Date.now();
  try {
    let total = 0;
    const caches = sizedKeys(isRebuildableCache);
    for (const item of caches) total += item.chars;
    for (const item of caches) {
      if (total <= REBUILDABLE_CACHE_BUDGET_CHARS) break;
      localStorage.removeItem(item.key);
      total -= item.chars;
    }
  } catch { return 'unavailable'; }
  return makeRoom(STORAGE_RESERVE_CHARS, 'caches');
}

/**
 * 图表缓存的写入：写得进就留；写完按间隔核对一次余量，不够时由 ensureStorageReserve 从最大的缓存清起。
 * 返回这一条最后有没有留在本地存储里。
 */
export function writeRebuildableCache(fullKey: string, raw: string): boolean {
  try { localStorage.setItem(fullKey, raw); } catch { return false; }
  if (Date.now() - lastReserveCheckAt < RESERVE_CHECK_INTERVAL_MS) return true;
  if (ensureStorageReserve() === 'ok') return true;
  try { return localStorage.getItem(fullKey) !== null; } catch { return false; }
}

/**
 * 令牌写不进去的那一刻当场腾位置再写一次。
 * 只接管「登录令牌键 + 配额错误」这一种情况，其余写入与原来逐字相同；仍写不进时把原来的错误交回登录库。
 * 返回卸载函数（测试用）。
 */
export function installAuthTokenWriteGuard(): () => void {
  const original = Storage.prototype.setItem;
  const guarded = function setItem(this: Storage, key: string, value: string): void {
    try {
      original.call(this, key, value);
      return;
    } catch (error) {
      if (!isQuotaError(error) || !AUTH_TOKEN_KEY.test(String(key)) || this !== globalThis.localStorage) throw error;
      makeRoom(String(key).length + String(value).length + 1024, 'auth');
      original.call(this, key, value);
    }
  };
  Storage.prototype.setItem = guarded;
  return () => { if (Storage.prototype.setItem === guarded) Storage.prototype.setItem = original; };
}

/** 本地存储里占用最大的几类（只读长度）：登录失败与恢复界面用它说明是什么把存储占满的。 */
const STORAGE_CATEGORIES: readonly [label: string, match: RegExp][] = [
  ['成交历史', /_trade_history$/],
  ['已成交委托', /_filled_orders$/],
  ['撤单快照', /_cancelled_orders$/],
  ['持仓与挂单', /_(positions_map|orders_map)$/],
  ['回放时间线', /_(coin_timelines_v2|replay_timelines_v1)$/],
  ['资金流水', /_transfer_history$/],
  ['画线与指标', /_(drawings|indicators)$/],
  ['日志本机镜像', /^journal_local_mirror_v1$/],
  ['信号库', /^veil\.signalLibrary/],
  ['情绪日记', /^decision_emotion_diaries/],
  ['消息记录', /_notification_history$/],
  ['图表缓存', /^campaign-(price-path|unrealized-chart)-/],
  ['登录令牌', /^sb-.+-auth-token/],
];

export function describeStorageUsage(top = 4): { totalChars: number; categories: { label: string; chars: number }[] } {
  const totals = new Map<string, number>();
  let totalChars = 0;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || key === AUTH_RESERVE_KEY) continue;
      const chars = key.length + (localStorage.getItem(key)?.length ?? 0);
      totalChars += chars;
      const label = STORAGE_CATEGORIES.find(([, match]) => match.test(key))?.[0] ?? '其它';
      totals.set(label, (totals.get(label) ?? 0) + chars);
    }
  } catch { /* 读不到时如实报空。 */ }
  const categories = [...totals].map(([label, chars]) => ({ label, chars })).sort((a, b) => b.chars - a.chars).slice(0, top);
  return { totalChars, categories };
}

export function resetStorageReserveClockForTests(): void {
  lastReserveCheckAt = Number.NEGATIVE_INFINITY;
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
