/**
 * 进场时的谢林偏离：按需拉 t₀ 前 48h 的币安 5m K 线并算出 EntrySnapshot，全站共用一份缓存。
 *
 * - 历史 K 线不会变：算出来的结果持久化到 localStorage（可重建缓存，存储紧张时可被清掉），下次打开直接读，不再请求。
 * - 有限并发（3 路）排队；还没开始的请求，调用方离开视野 / 卸载后就丢掉（列表快速滚动不会排起长队）。
 * - 「币安没有这个合约」「窗口里一根 K 线都没有」是确定结果，也缓存；网络 / 限流错误只记在内存里，可重试。
 * - 测试环境默认不发请求（jsdom 里有真实的 fetch），测试用 __setEntrySnapshotFetchForTests 注入。
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { computeEntrySnapshot, type EntrySnapshot } from '@/lib/deepRsa/entrySnapshot';
import { normalizeResearchSymbol, WINDOW_MS } from '@/lib/deepRsa/grouping';
import { fetchResearchKlines, MarketDataError, type FetchFn } from '@/lib/deepRsa/marketData';
import { writeRebuildableCache } from '@/lib/persistedStateStorage';

/** 登记在可重建缓存里（REBUILDABLE_CACHE_PREFIXES）：存储紧张时会被清掉，清掉的重取即可。 */
const STORAGE_KEY = 'campaign-entry-schelling-v1';
/** 每条约 150 字符，1500 条约 220 KB，在可重建缓存 1 MB 的总预算之内。 */
const MAX_ENTRIES = 1500;
const CONCURRENCY = 3;

type Settled = { kind: 'ready'; snapshot: EntrySnapshot } | { kind: 'unavailable'; reason: string };
export type EntrySnapshotState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; snapshot: EntrySnapshot }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string };

const IDLE: EntrySnapshotState = { status: 'idle' };
const LOADING: EntrySnapshotState = { status: 'loading' };

let persisted: Map<string, Settled> | null = null;
const states = new Map<string, EntrySnapshotState>();
const listeners = new Map<string, Set<() => void>>();
const queue: { key: string; symbol: string; anchorMs: number }[] = [];
const wanted = new Map<string, number>();
let running = 0;
let fetchOverride: FetchFn | null | undefined;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const autoFetchEnabled = () => fetchOverride !== undefined ? fetchOverride !== null : import.meta.env.MODE !== 'test';

export const entrySnapshotKey = (symbol: string, anchorMs: number) => `${normalizeResearchSymbol(symbol)}@${anchorMs}`;

function loadPersisted(): Map<string, Settled> {
  if (persisted) return persisted;
  persisted = new Map();
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, Settled> : {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value && (value.kind === 'ready' || value.kind === 'unavailable')) persisted.set(key, value);
    }
  } catch { /* 读不到就当没有缓存 */ }
  return persisted;
}

function schedulePersist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const map = loadPersisted();
    while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
    writeRebuildableCache(STORAGE_KEY, JSON.stringify(Object.fromEntries(map), (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(7)) : v)));
  }, 500);
}

function stateOf(key: string): EntrySnapshotState {
  const live = states.get(key);
  if (live) return live;
  const saved = loadPersisted().get(key);
  if (!saved) return IDLE;
  const state: EntrySnapshotState = saved.kind === 'ready' ? { status: 'ready', snapshot: saved.snapshot } : { status: 'unavailable', reason: saved.reason };
  states.set(key, state);
  return state;
}

function setState(key: string, state: EntrySnapshotState) {
  states.set(key, state);
  listeners.get(key)?.forEach(fn => fn());
}

function settle(key: string, value: Settled) {
  loadPersisted().set(key, value);
  schedulePersist();
  setState(key, value.kind === 'ready' ? { status: 'ready', snapshot: value.snapshot } : { status: 'unavailable', reason: value.reason });
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    if ((wanted.get(job.key) ?? 0) <= 0) { setState(job.key, IDLE); continue; }
    running++;
    void run(job).finally(() => { running--; pump(); });
  }
}

async function run({ key, symbol, anchorMs }: { key: string; symbol: string; anchorMs: number }) {
  try {
    const bars = await fetchResearchKlines(symbol, anchorMs - WINDOW_MS, anchorMs, fetchOverride ?? undefined);
    const snapshot = computeEntrySnapshot(bars, anchorMs);
    settle(key, snapshot ? { kind: 'ready', snapshot } : { kind: 'unavailable', reason: '进场前 48 小时没有 K 线' });
  } catch (error) {
    if (error instanceof MarketDataError && error.kind === 'no_symbol') settle(key, { kind: 'unavailable', reason: error.message });
    else setState(key, { status: 'error', reason: error instanceof Error ? error.message : String(error) });
  }
}

function request(symbol: string, anchorMs: number): () => void {
  const key = entrySnapshotKey(symbol, anchorMs);
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
  const status = stateOf(key).status;
  if ((status === 'idle' || status === 'error') && autoFetchEnabled()) {
    if (anchorMs > Date.now()) {
      setState(key, { status: 'unavailable', reason: '进场时间还没到' });
    } else {
      setState(key, LOADING);
      queue.push({ key, symbol: normalizeResearchSymbol(symbol), anchorMs });
      pump();
    }
  }
  return () => wanted.set(key, Math.max(0, (wanted.get(key) ?? 0) - 1));
}

function subscribe(key: string, fn: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(fn);
  listeners.set(key, set);
  return () => { set.delete(fn); if (set.size === 0) listeners.delete(key); };
}

/**
 * 某个标的在 anchorMs 进场时的谢林偏离。symbol / anchorMs 缺失时恒为 idle；enabled = false 时只读缓存、不发请求
 * （列表卡片离开视野时传 false）。
 */
export function useEntrySnapshot(symbol: string | null | undefined, anchorMs: number | null | undefined, enabled = true): EntrySnapshotState & { retry: () => void } {
  const key = symbol && anchorMs != null && Number.isFinite(anchorMs) ? entrySnapshotKey(symbol, anchorMs) : null;
  const state = useSyncExternalStore(
    useCallback(fn => (key ? subscribe(key, fn) : () => {}), [key]),
    () => (key ? stateOf(key) : IDLE),
    () => IDLE,
  );
  useEffect(() => {
    if (!key || !enabled || !symbol || anchorMs == null) return undefined;
    return request(symbol, anchorMs);
  }, [key, enabled, symbol, anchorMs]);
  const retry = useCallback(() => {
    if (!key || !symbol || anchorMs == null) return;
    if (stateOf(key).status === 'error') setState(key, IDLE);
    const release = request(symbol, anchorMs);
    // 重试是一次性的：排上队就放手，结果照样进缓存
    setTimeout(release, 60_000);
  }, [key, symbol, anchorMs]);
  return { ...state, retry };
}

/** 测试用：注入 fetch（null = 不发请求）并清空内存缓存（下次从 localStorage 重新读，相当于重新打开页面）。 */
export function __setEntrySnapshotFetchForTests(fn: FetchFn | null | undefined) {
  fetchOverride = fn;
  persisted = null;
  states.clear();
  queue.length = 0;
  wanted.clear();
}
