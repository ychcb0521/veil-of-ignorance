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
 * 不走 `sim_<uid>_` 前缀的存储 → 实际 localStorage 键的映射。
 * 这些同样是跟账号走的资产，不能因为键名格式不同就漏掉：
 *   signal_library_v1  用户粘贴的信号库（全局键）
 *   blind_spots_v1     认知盲区清单（veil:blindspots:<uid>）
 *   journal_mirror_v1  远程 schema 缺列时的字段兜底镜像（全局键，内部按 uid 分区）
 *   emotion_diary_v1   情绪日记本地镜像（<version>:<uid>）
 * 值为函数时按当前 userId 拼装实际键。
 */
const ALT_KEY_STORAGE: Record<string, (userId: string) => string> = {
  signal_library_v1: () => 'veil.signalLibrary.v1',
  blind_spots_v1: (uid) => `veil:blindspots:${uid}`,
  journal_mirror_v1: () => 'journal_local_mirror_v1',
  emotion_diary_v1: (uid) => `decision_emotion_diaries_v1:${uid}`,
};

function storageKeyFor(logicalKey: string, userId: string): string {
  const alt = ALT_KEY_STORAGE[logicalKey];
  return alt ? alt(userId) : `sim_${userId}_${logicalKey}`;
}

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

/**
 * 影子戳只许前进，不许后退。
 * 它表达的是「本地这份内容至少和某个时刻的远端一样新」，而推送完成的顺序
 * 与入队顺序未必一致（防抖 + 重试 + flush 三条路都能乱序），取 max 才不会
 * 因为一次迟到的回调把已经更新的判断打回去。
 */
function writeShadowTs(fullKey: string, ts: number): void {
  try {
    const current = readShadowTs(fullKey);
    if (ts <= current) return;
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

type PendingPush = { value: unknown; gen: number; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, PendingPush>();
/**
 * 每个键的版本号。入队即 +1，推送带着自己的版本出发。
 * 出发前若发现已经不是最新版本，就整笔作废——**尤其是失败后的那次重试**：
 * 它手里攥的是 3 秒前的旧值，却会盖上一个新的 updated_at，
 * 于是云端内容倒退回旧版本，下一次 hydrate 再用这个「更新的」旧值把本地
 * 那笔新成交抹掉。用户看到的就是「删过历史成交、又交易了一笔，那笔没了」。
 */
const generation = new Map<string, number>();
let tableMissing = false;
let flushHooksInstalled = false;

/** 从完整 localStorage 键（sim_<uid>_foo）还原出逻辑键 foo；不匹配则返回 null。 */
export function logicalKeyOf(fullKey: string, userId: string): string | null {
  const prefix = `sim_${userId}_`;
  if (!fullKey.startsWith(prefix)) return null;
  const key = fullKey.slice(prefix.length);
  return key.endsWith('__syncts') ? null : key;
}

/** 单键负载超过这个大小就告警：成交历史累积到一定量后可能触到请求体上限。 */
const LARGE_PAYLOAD_WARN_BYTES = 4 * 1024 * 1024;

async function pushNow(userId: string, key: string, value: unknown, gen: number, retry = true): Promise<void> {
  if (tableMissing) return;
  // 已经被更新的版本取代 → 这一笔（含它的重试）整个作废，绝不把旧值写上云。
  if ((generation.get(key) ?? 0) !== gen) return;
  try {
    const approxBytes = JSON.stringify(value)?.length ?? 0;
    if (approxBytes > LARGE_PAYLOAD_WARN_BYTES) {
      console.warn(
        `[simStateSync] ${key} 体积已达 ${(approxBytes / 1024 / 1024).toFixed(1)}MB，`
        + '接近单次请求上限，若推送开始失败需要改为分片存储',
      );
    }
    // 与影子戳同源：这一行的 updated_at 必须是我们**自己**记下来的那个时刻，
    // 否则本地永远比远端「旧」1.5 秒（入队时刻 vs 推送时刻），
    // 「本地更新的操作不会被回滚」那道护栏就从来不会生效。
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('user_sim_state' as never)
      .upsert(
        {
          user_id: userId,
          key,
          value: value as never,
          updated_at: updatedAt,
        } as never,
        { onConflict: 'user_id,key' },
      );
    if (!error) {
      // 推送成功：本地内容至少和这一行一样新。注意即使期间又有更新的本地写入
      // （gen 已经变了）也要写——那时本地只会更新，不会更旧。
      writeShadowTs(storageKeyFor(key, userId), Date.parse(updatedAt));
    }
    if (error) {
      if (isMissingSimStateTableError(error)) {
        tableMissing = true;
        console.warn('[simStateSync] user_sim_state 表不存在，云端同步停用（退回纯本地存储）');
      } else if (retry) {
        // 瞬时网络抖动不该让这一笔永远上不了云：隔 3 秒重试一次
        console.warn('[simStateSync] 推送失败，3 秒后重试：', error.message);
        setTimeout(() => { void pushNow(userId, key, value, gen, false); }, 3_000);
      } else {
        console.warn('[simStateSync] 推送重试仍失败：', error.message);
      }
    }
  } catch (e) {
    if (retry) {
      setTimeout(() => { void pushNow(userId, key, value, gen, false); }, 3_000);
    } else {
      console.warn('[simStateSync] 推送异常：', e);
    }
  }
}

function flushAllPending(userId: string): void {
  for (const [key, entry] of pending) {
    clearTimeout(entry.timer);
    void pushNow(userId, key, entry.value, entry.gen);
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
  // 入队即占一个新版本号：在此之前出发的推送与重试全部作废。
  const gen = (generation.get(key) ?? 0) + 1;
  generation.set(key, gen);
  // 先按入队时刻记一次，保证「写了但还没推上去」的本地值也受护栏保护；
  // 推送成功后会再对齐到那一行真正的 updated_at（writeShadowTs 只进不退）。
  writeShadowTs(storageKeyFor(key, userId), Date.now());

  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const delay = SLOW_SYNC_KEYS.has(key) ? SLOW_DEBOUNCE_MS : FAST_DEBOUNCE_MS;
  pending.set(key, {
    value,
    gen,
    timer: setTimeout(() => {
      pending.delete(key);
      void pushNow(userId, key, value, gen);
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
      const fullKey = storageKeyFor(row.key, userId);
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
    for (const logical of Object.keys(ALT_KEY_STORAGE)) {
      candidates.push([logical, storageKeyFor(logical, userId)]);
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
  generation.clear();
  tableMissing = false;
  flushHooksInstalled = false;
}
