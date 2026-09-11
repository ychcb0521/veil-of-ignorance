/**
 * 消息中心：全站提示的唯一出口。
 *
 * 原来 211 处 `toast.xxx()` 直接调 sonner，一律弹在屏幕右上角——那里正好是
 * 时间机器的倍速条与模拟时钟，每一次成交、触发、资金费结算都会盖住它。
 * 用户的要求是：提示不再弹出，而是汇总成「历史消息」，放在交易偏好抽屉的
 * 最下方，点开才看。
 *
 * 做法是给 sonner 的 toast 包一层同签名的外壳：调用点只改 import 路径，
 * 每条提示先记入历史，再看「弹出通知」开关决定要不要交给 sonner 渲染。
 * 开关默认关闭；未读条数显示在交易偏好按钮上，有未读报错时为红色，
 * 所以不弹出并不等于悄悄吞掉。爆仓另有独立的弹窗（LiquidationModal），不受影响。
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { toast as sonnerToast, type ExternalToast } from 'sonner';
import { getUserPrefix } from '@/lib/userStoragePrefix';

export type NotificationLevel = 'success' | 'error' | 'warning' | 'info' | 'message';

export interface NotificationEntry {
  id: string;
  /** 单调递增序号，用来判定已读/未读（同一毫秒内的两条也分得开）。 */
  seq: number;
  level: NotificationLevel;
  title: string;
  description: string | null;
  /** 真实时间（毫秒）。 */
  at: number;
}

export interface NotificationSnapshot {
  /** 新的在前。 */
  entries: readonly NotificationEntry[];
  lastReadSeq: number;
  popupsEnabled: boolean;
  unreadCount: number;
  unreadErrorCount: number;
}

/** 只留最近这么多条：localStorage 配额有限，历史消息是尽力而为的记录。 */
export const NOTIFICATION_HISTORY_LIMIT = 300;

const HISTORY_KEY = 'notification_history';
const LAST_READ_KEY = 'notification_last_read_seq';
const POPUPS_KEY = 'notification_popups';

const LEVELS: readonly NotificationLevel[] = ['success', 'error', 'warning', 'info', 'message'];

function computeSnapshot(
  entries: readonly NotificationEntry[],
  lastReadSeq: number,
  popupsEnabled: boolean,
): NotificationSnapshot {
  let unreadCount = 0;
  let unreadErrorCount = 0;
  for (const entry of entries) {
    if (entry.seq <= lastReadSeq) continue;
    unreadCount += 1;
    if (entry.level === 'error') unreadErrorCount += 1;
  }
  return { entries, lastReadSeq, popupsEnabled, unreadCount, unreadErrorCount };
}

let loadedPrefix: string | null = null;
let snapshot: NotificationSnapshot = computeSnapshot([], 0, false);
const listeners = new Set<() => void>();
let emitQueued = false;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额满或隐私模式：历史只是记录，写不进去不影响交易本身。
  }
}

function isEntry(value: unknown): value is NotificationEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<NotificationEntry>;
  return typeof e.id === 'string'
    && typeof e.seq === 'number' && Number.isFinite(e.seq)
    && typeof e.title === 'string'
    && typeof e.at === 'number' && Number.isFinite(e.at)
    && LEVELS.includes(e.level as NotificationLevel);
}

/** 按当前登录用户载入；同一标签页里切换账号后，下一次读写会换到新账号的历史。 */
function ensureLoaded(): boolean {
  const prefix = getUserPrefix();
  if (prefix === loadedPrefix) return false;
  loadedPrefix = prefix;
  const raw = readJson<unknown>(prefix + HISTORY_KEY, []);
  const entries = Array.isArray(raw) ? raw.filter(isEntry).slice(0, NOTIFICATION_HISTORY_LIMIT) : [];
  const lastReadSeq = Number(readJson<number>(prefix + LAST_READ_KEY, 0)) || 0;
  const popupsEnabled = readJson<boolean>(prefix + POPUPS_KEY, false) === true;
  snapshot = computeSnapshot(entries, lastReadSeq, popupsEnabled);
  return true;
}

/**
 * 通知订阅者放到微任务里：提示可能在别的组件渲染途中被调用，同步触发
 * setState 会引出「渲染中更新另一个组件」的告警；顺带把连发的几条合成一次重渲染。
 * snapshot 本身是同步更新的，读取方随时拿到的都是最新值。
 */
function emit(): void {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    for (const listener of listeners) listener();
  });
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'bigint') return String(node);
  return '';
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function record(level: NotificationLevel, message: ReactNode, data?: ExternalToast): string {
  ensureLoaded();
  const title = textOf(message).trim() || '（无标题提示）';
  const descriptionText = data?.description != null ? textOf(data.description as ReactNode).trim() : '';
  const entry: NotificationEntry = {
    id: newId(),
    seq: (snapshot.entries[0]?.seq ?? snapshot.lastReadSeq) + 1,
    level,
    title,
    description: descriptionText || null,
    at: Date.now(),
  };
  const entries = [entry, ...snapshot.entries].slice(0, NOTIFICATION_HISTORY_LIMIT);
  writeJson(`${loadedPrefix}${HISTORY_KEY}`, entries);
  snapshot = computeSnapshot(entries, snapshot.lastReadSeq, snapshot.popupsEnabled);
  emit();
  return entry.id;
}

type ToastFn = (message: ReactNode, data?: ExternalToast) => string | number;

function makeLevel(level: Exclude<NotificationLevel, 'message'> | 'message'): ToastFn {
  return (message, data) => {
    const id = record(level, message, data);
    if (!snapshot.popupsEnabled) return id;
    return sonnerToast[level](message, data);
  };
}

const baseToast: ToastFn = (message, data) => {
  const id = record('message', message, data);
  return snapshot.popupsEnabled ? sonnerToast(message, data) : id;
};

/** 与 sonner 的 toast 同签名：调用点只需把 import 从 'sonner' 改到这里。 */
export const toast = Object.assign(baseToast, {
  success: makeLevel('success'),
  error: makeLevel('error'),
  warning: makeLevel('warning'),
  info: makeLevel('info'),
  message: makeLevel('message'),
  dismiss: sonnerToast.dismiss,
});

export function getNotificationSnapshot(): NotificationSnapshot {
  return snapshot;
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  if (ensureLoaded()) emit();
  return () => {
    listeners.delete(listener);
  };
}

/** 重新核对当前用户（打开历史消息时调用，切换账号后不会看到上一个人的消息）。 */
export function refreshNotifications(): void {
  if (ensureLoaded()) emit();
}

export function markAllNotificationsRead(): void {
  ensureLoaded();
  const seq = snapshot.entries[0]?.seq ?? snapshot.lastReadSeq;
  if (seq === snapshot.lastReadSeq && snapshot.unreadCount === 0) return;
  writeJson(`${loadedPrefix}${LAST_READ_KEY}`, seq);
  snapshot = computeSnapshot(snapshot.entries, seq, snapshot.popupsEnabled);
  emit();
}

export function clearNotificationHistory(): void {
  ensureLoaded();
  writeJson(`${loadedPrefix}${HISTORY_KEY}`, []);
  // 已读水位保留：清空后新来的消息序号接着往上走，仍能正确判定未读。
  const seq = Math.max(snapshot.lastReadSeq, snapshot.entries[0]?.seq ?? 0);
  writeJson(`${loadedPrefix}${LAST_READ_KEY}`, seq);
  snapshot = computeSnapshot([], seq, snapshot.popupsEnabled);
  emit();
}

export function setNotificationPopupsEnabled(enabled: boolean): void {
  ensureLoaded();
  writeJson(`${loadedPrefix}${POPUPS_KEY}`, enabled);
  snapshot = computeSnapshot(snapshot.entries, snapshot.lastReadSeq, enabled);
  emit();
}

export function useNotificationCenter(): NotificationSnapshot {
  return useSyncExternalStore(subscribeNotifications, getNotificationSnapshot, getNotificationSnapshot);
}

/** 仅供测试：把模块状态复位到「尚未载入」。 */
export function __resetNotificationCenterForTests(): void {
  loadedPrefix = null;
  snapshot = computeSnapshot([], 0, false);
  listeners.clear();
  emitQueued = false;
}
