/**
 * 模拟交易引擎状态的云端同步层。
 *
 * 引擎状态（持仓、成交历史、挂单、余额、各币时间线、杠杆设置……）一直存在
 * localStorage 的 `sim_<userId>_<key>` 键下——换浏览器即全部丢失。这一层把
 * 同一份数据镜像到 Supabase 的 user_sim_state 表：
 *
 *   写路径：usePersistedState 每次落盘后调用 queueSimStatePush，按 key 防抖
 *           推送 upsert；高频键（时间线心跳）用更长的节流窗口，行情缓存类
 *           键不推送。页面隐藏/关闭时强制冲刷，不丢最后一笔。
 *   读路径：登录后、交易组件树挂载前调用 hydrateSimState 一次。远端行
 *           updated_at 晚于本地影子时间戳（或本地根本没有该键）才覆盖本地——
 *           新浏览器因此拿到全量数据，旧浏览器里更新的本地操作不会被回滚。
 *
 * 降级：表未建（PGRST205/42P01）即静默停用推送，行为退回纯 localStorage；
 * 网络错误只记日志不打扰交易。同步永远不能成为下单路径上的故障点。
 */
import { supabase } from '@/integrations/supabase/client';

/** 行情缓存等可重建数据：没有同步价值，白耗带宽。 */
const EXCLUDED_KEYS = new Set(['price_map']);

/**
 * 不带用户前缀的全局键 → 实际 localStorage 键的映射。
 * 信号库存在 veil.signalLibrary.v1（无 sim_ 前缀），但用户粘贴的信号是
 * 跟账号走的资产，同样要跨浏览器保留。
 */
const GLOBAL_KEY_STORAGE: Record<string, string> = {
  signal_library_v1: 'veil.signalLibrary.v1',
};

/** 时间线心跳类键每 500ms 就变一次，用长节流窗口，其余键短防抖即可。 */
const SLOW_SYNC_KEYS = new Set(['synced_origin_time', 'coin_timelines_v2', 'reverse_cap_time_v1']);
const FAST_DEBOUNCE_MS = 1_500;
const SLOW_DEBOUNCE_MS = 20_000;

/** 影子时间戳键：记录该键最后一次本地写入的毫秒时刻，用于水化时比较新旧。 */
function shadowKey(fullKey: string): string {
  return `${fullKey}__syncts`;
}

function readShadowTs(fullKey: string): number {
  try {
    const raw = localStorage.getItem(shadowKey(fullKey));
    const ts = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeShadowTs(fullKey: string, ts: number): void {
  try {
    localStorage.setItem(shadowKey(fullKey), String(ts));
  } catch {
    /* quota 满时影子丢失只影响下次比较，不影响数据本身 */
  }
}

function isMissingSimStateTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/user_sim_state/i.test(message) && /schema cache|could not find|does not exist/i.test(message));
}

type PendingPush = { value: unknown; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, PendingPush>();
let tableMissing = false;
let flushHooksInstalled = false;

/** 从完整 localStorage 键（sim_<uid>_foo）还原出逻辑键 foo；不匹配则返回 null。 */
export function logicalKeyOf(fullKey: string, userId: string): string | null {
  const prefix = `sim_${userId}_`;
  if (!fullKey.startsWith(prefix)) return null;
  const key = fullKey.slice(prefix.length);
  return key.endsWith('__syncts') ? null : key;
}

async function pushNow(userId: string, key: string, value: unknown): Promise<void> {
  if (tableMissing) return;
  try {
    const { error } = await supabase
      .from('user_sim_state' as never)
      .upsert(
        {
          user_id: userId,
          key,
          value: value as never,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'user_id,key' },
      );
    if (error) {
      if (isMissingSimStateTableError(error)) {
        tableMissing = true;
        console.warn('[simStateSync] user_sim_state 表不存在，云端同步停用（退回纯本地存储）');
      } else {
        console.warn('[simStateSync] 推送失败：', error.message);
      }
    }
  } catch (e) {
    console.warn('[simStateSync] 推送异常：', e);
  }
}

function flushAllPending(userId: string): void {
  for (const [key, entry] of pending) {
    clearTimeout(entry.timer);
    void pushNow(userId, key, entry.value);
  }
  pending.clear();
}

function installFlushHooks(userId: string): void {
  if (flushHooksInstalled || typeof window === 'undefined') return;
  flushHooksInstalled = true;
  // 页面隐藏（切标签/最小化/关闭前）时冲刷积压的推送——不丢最后一笔操作
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllPending(userId);
  });
  window.addEventListener('pagehide', () => flushAllPending(userId));
}

/**
 * usePersistedState 每次写 localStorage 后调用。按逻辑键防抖合并，
 * 同一键连续写只推最后一版。
 */
export function queueSimStatePush(userId: string, key: string, value: unknown): void {
  if (!userId || EXCLUDED_KEYS.has(key) || tableMissing) return;
  installFlushHooks(userId);
  writeShadowTs(GLOBAL_KEY_STORAGE[key] ?? `sim_${userId}_${key}`, Date.now());

  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const delay = SLOW_SYNC_KEYS.has(key) ? SLOW_DEBOUNCE_MS : FAST_DEBOUNCE_MS;
  pending.set(key, {
    value,
    timer: setTimeout(() => {
      pending.delete(key);
      void pushNow(userId, key, value);
    }, delay),
  });
}

export interface HydrateResult {
  status: 'hydrated' | 'empty' | 'table-missing' | 'error';
  applied: number;
}

/**
 * 登录后调用一次：把云端镜像水化回 localStorage。
 * 仅当远端行比本地影子时间戳更新（或本地没有该键）时才覆盖——
 * 新浏览器拿到全量，旧浏览器更新的本地值不被回滚。
 */
export async function hydrateSimState(userId: string): Promise<HydrateResult> {
  if (!userId) return { status: 'error', applied: 0 };
  try {
    const { data, error } = await supabase
      .from('user_sim_state' as never)
      .select('key, value, updated_at')
      .eq('user_id', userId);
    if (error) {
      if (isMissingSimStateTableError(error)) {
        tableMissing = true;
        return { status: 'table-missing', applied: 0 };
      }
      console.warn('[simStateSync] 水化失败：', error.message);
      return { status: 'error', applied: 0 };
    }
    const rows = (data ?? []) as unknown as Array<{ key: string; value: unknown; updated_at: string }>;
    let applied = 0;
    for (const row of rows) {
      if (EXCLUDED_KEYS.has(row.key)) continue;
      const fullKey = GLOBAL_KEY_STORAGE[row.key] ?? `sim_${userId}_${row.key}`;
      const remoteTs = new Date(row.updated_at).getTime();
      const localTs = readShadowTs(fullKey);
      const hasLocal = localStorage.getItem(fullKey) != null;
      if (hasLocal && localTs >= remoteTs) continue; // 本地不比远端旧，保留本地
      try {
        localStorage.setItem(fullKey, JSON.stringify(row.value));
        writeShadowTs(fullKey, remoteTs);
        applied += 1;
      } catch (e) {
        console.warn(`[simStateSync] 写回 ${row.key} 失败：`, e);
      }
    }
    // 存量回填：推送只在「写入时」触发，老浏览器里早已存在、此后不再变动的
    // 数据（历史成交、旧持仓……）永远等不到一次 setState。这里把「本地有、
    // 云端没有」的键补推一次，让迁移方案上线前的数据也上云。
    backfillLocalOnlyKeys(userId, new Set(rows.map(row => row.key)));
    return { status: rows.length === 0 ? 'empty' : 'hydrated', applied };
  } catch (e) {
    console.warn('[simStateSync] 水化异常：', e);
    return { status: 'error', applied: 0 };
  }
}

function backfillLocalOnlyKeys(userId: string, remoteKeys: Set<string>): void {
  try {
    const prefix = `sim_${userId}_`;
    const candidates: Array<[string, string]> = []; // [逻辑键, 实际存储键]
    for (let i = 0; i < localStorage.length; i += 1) {
      const fullKey = localStorage.key(i);
      if (!fullKey) continue;
      const logical = logicalKeyOf(fullKey, userId);
      if (logical) candidates.push([logical, fullKey]);
    }
    for (const [logical, storageKeyName] of Object.entries(GLOBAL_KEY_STORAGE)) {
      candidates.push([logical, storageKeyName]);
    }
    for (const [logical, storageKeyName] of candidates) {
      if (remoteKeys.has(logical) || EXCLUDED_KEYS.has(logical)) continue;
      const raw = localStorage.getItem(storageKeyName);
      if (raw == null) continue;
      try {
        queueSimStatePush(userId, logical, JSON.parse(raw));
      } catch {
        /* 非 JSON 的旧值跳过 */
      }
    }
    void prefix;
  } catch (e) {
    console.warn('[simStateSync] 存量回填异常：', e);
  }
}

/** 测试用：重置模块级状态。 */
export function __resetSimStateSyncForTests(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  tableMissing = false;
  flushHooksInstalled = false;
}
