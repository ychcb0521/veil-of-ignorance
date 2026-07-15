/**
 * 本地镜像：远程库 schema 漂移时的兜底持久层。
 *
 * 痛点：远程 trade_journals 缺列（用户没跑最新 supabase 迁移），
 *      schema fallback 把这些字段从 update/insert payload 里剥掉，
 *      最终错题集汇总看不到对应字段（全是 0/N）。
 *
 * 兜底：每次 finalize/snapshot 保存后，把"被剥掉的字段"原值写进 localStorage；
 *      错题集 reload 时把本地镜像 merge 回 server 拉回来的 journals，
 *      用户单设备上始终能看到自己填的所有内容。
 *
 * 妥协：跨设备/浏览器不同步；只要用户跑了 supabase 迁移，新数据自然走正常通道，
 *      本地镜像就只是历史 backup。
 */

const STORAGE_KEY = 'journal_local_mirror_v1';

/** 形状：{ [userId]: { [journalId]: { columnName: value, ... } } } */
type Store = Record<string, Record<string, Record<string, unknown>>>;

function readStore(): Store {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as Store : {};
  } catch { return {}; }
}

function writeStore(store: Store): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[journalLocalMirror] write failed:', e);
  }
}

/**
 * 把 droppedColumns 在 payload 里的值镜像到本地。
 * - 没被剥的列不写（避免冗余）。
 * - userId 缺失时跳过（无登录时不存）。
 */
export function mirrorDroppedColumns(
  userId: string | null | undefined,
  journalId: string,
  fullPayload: Record<string, unknown>,
  droppedColumns: string[],
): void {
  if (!userId || !journalId || droppedColumns.length === 0) return;
  const store = readStore();
  if (!store[userId]) store[userId] = {};
  if (!store[userId][journalId]) store[userId][journalId] = {};
  for (const col of droppedColumns) {
    if (col in fullPayload) {
      store[userId][journalId][col] = fullPayload[col];
    }
  }
  writeStore(store);
}

/**
 * 一次评价保存后的镜像对账：仍被远程 schema 丢弃的字段更新本地值，已经成功写入
 * 远程库的字段删除旧镜像，避免旧副本在下次读取时覆盖用户刚保存的新答案。
 */
export function reconcileLocalMirror(
  userId: string | null | undefined,
  journalId: string,
  fullPayload: Record<string, unknown>,
  droppedColumns: string[],
): void {
  if (!userId || !journalId) return;
  const store = readStore();
  const userStore = store[userId] ?? {};
  const journalMirror = userStore[journalId] ?? {};
  const dropped = new Set(droppedColumns);

  for (const [column, value] of Object.entries(fullPayload)) {
    if (dropped.has(column)) journalMirror[column] = value;
    else delete journalMirror[column];
  }

  if (Object.keys(journalMirror).length > 0) {
    userStore[journalId] = journalMirror;
    store[userId] = userStore;
  } else {
    delete userStore[journalId];
    if (Object.keys(userStore).length > 0) store[userId] = userStore;
    else delete store[userId];
  }
  writeStore(store);
}

/**
 * 把本地镜像 merge 到从 server 拉回的 journals 上。
 * - 本地有值就覆盖（本地是"用户真的填了"的事实）。
 * - 本地没有的字段保持 server 值。
 * - 未知 journalId 的镜像保留，将来对应 journal 出现时自动 merge。
 */
export function applyLocalMirror<T extends { id: string }>(
  userId: string | null | undefined,
  rows: T[],
): T[] {
  if (!userId) return rows;
  const userMirror = readStore()[userId];
  if (!userMirror) return rows;
  return rows.map(row => {
    const extra = userMirror[row.id];
    if (!extra) return row;
    return { ...row, ...extra };
  });
}

/** 调试：清空当前用户的本地镜像（一般不用）。 */
export function clearLocalMirror(userId: string): void {
  const store = readStore();
  delete store[userId];
  writeStore(store);
}
