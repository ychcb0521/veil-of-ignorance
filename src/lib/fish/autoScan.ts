import { readFishAccountSettings } from './accountSettings';
/**
 * 「渔」的定时自动捕捞：手动 / 自动两种模式，自动时每隔 N 小时捕一次。
 * 【用户要求】2026-10-21「渔这里增设一个定时自动（& 手动）捕捉的功能，自动模式下可以设置多长时间（0.5h / 1h / 2h / 4h / 8h / 16h / 32h / 64h）
 * 自动捕捉一次；只要电脑联着网，就进行自动捕捉。手动模式下，与现在的保持一致。」
 * 模式与间隔优先使用已保存的账号配置；上次运行时间和租约留在本机。
 */
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';

const SHORT_INTERVAL_MINUTES = [5, 15] as const;
const HOURLY_INTERVALS = [0.5, 1, 2, 4, 8, 16, 32, 64] as const;
export const FISH_AUTO_INTERVALS = [...SHORT_INTERVAL_MINUTES.map(minutes => minutes / 60), ...HOURLY_INTERVALS];
export const fishAutoIntervalLabel = (hours: number) => hours < 1 ? `每 ${Math.round(hours * 60)} 分钟` : `每 ${hours} 小时`;
export type FishAutoMode = 'manual' | 'auto';
export interface FishAutoState {
  mode: FishAutoMode;
  hours: number;
  lastRunAt: number | null;
  retry?: { anchorMs: number; until: number };
}
export type FishAutoSchedule = Pick<FishAutoState, 'mode' | 'hours'>;
export type FishAccountAutoSchedule = FishAutoSchedule & { intervalMinutes?: typeof SHORT_INTERVAL_MINUTES[number] };

export function fishAutoAccountSchedule(schedule: FishAutoSchedule, previous?: FishAccountAutoSchedule): FishAccountAutoSchedule {
  const intervalMinutes = SHORT_INTERVAL_MINUTES.find(minutes => minutes / 60 === schedule.hours);
  // Keep the hours field readable by open pages that predate minute intervals.
  return intervalMinutes ? { mode: schedule.mode, hours: previous?.hours ?? 0.5, intervalMinutes } : schedule;
}
const HOUR = 3_600_000;
export const fishAutoKey = () => `${getUserPrefix()}fish-auto.v1`;
export const fishAutoScheduleKey = () => `${getUserPrefix()}fish-auto-schedule.v1`;
const leaseKey = () => `${getUserPrefix()}fish-auto-lease.v1`;
export const DEFAULT_FISH_AUTO: FishAutoState = { mode: 'auto', hours: 1, lastRunAt: null };

export function readFishAuto(): FishAutoState {
  try {
    const x = JSON.parse(readPersistedStateRaw(fishAutoKey()) ?? 'null');
    if (!x) return DEFAULT_FISH_AUTO;
    const state: FishAutoState = { mode: x.mode === 'manual' ? 'manual' : 'auto', hours: (FISH_AUTO_INTERVALS as readonly number[]).includes(x.hours) ? x.hours : 1, lastRunAt: Number.isFinite(x.lastRunAt) ? x.lastRunAt : null };
    if (Number.isFinite(x.retry?.anchorMs) && x.retry.anchorMs > 0 && Number.isFinite(x.retry.until) && x.retry.until > 0) {
      state.retry = { anchorMs: x.retry.anchorMs, until: x.retry.until };
    }
    return state;
  } catch { return DEFAULT_FISH_AUTO; }
}
export function saveFishAuto(state: FishAutoState): void {
  try { writePersistedStateRaw(fishAutoKey(), JSON.stringify({ ...state, defaultsVersion: 1 })); } catch { /* 记不住只是下次要重新设 */ }
}
export function saveFishAutoSchedule(schedule: FishAutoSchedule): boolean {
  const revision = readFishAccountSettings()?.captureScheduleRevision;
  return writePersistedStateRaw(fishAutoScheduleKey(), JSON.stringify({ ...schedule, revision }));
}

function readFishAutoSchedule(account?: FishAccountAutoSchedule, revision?: string): FishAutoSchedule | undefined {
  try {
    const value = JSON.parse(readPersistedStateRaw(fishAutoScheduleKey()) ?? 'null');
    // A late account hydration must not replace an explicit choice in this browser.
    if ((value?.mode === 'manual' || value?.mode === 'auto')
      && (FISH_AUTO_INTERVALS as readonly number[]).includes(value.hours) && (!revision || value.revision === revision)) {
      return { mode: value.mode, hours: value.hours };
    }
  } catch { /* Fall back to the saved account schedule. */ }
  if (!account) return undefined;
  const interval = SHORT_INTERVAL_MINUTES.find(minutes => minutes === account.intervalMinutes);
  return { mode: account.mode, hours: interval ? interval / 60 : account.hours };
}

/** Restore an explicit local schedule or the latest account schedule when reopening. */
export function resetFishAuto(): FishAutoState {
  const { lastRunAt, retry } = readFishAuto();
  const account = readFishAccountSettings();
  const state = { ...DEFAULT_FISH_AUTO, ...readFishAutoSchedule(account?.auto, account?.captureScheduleRevision), lastRunAt, retry };
  saveFishAuto(state);
  return state;
}
/** 下次自动捕捞的时刻：手动模式没有；自动模式从没捕过就是现在。 */
export const fishAutoNextAt = (s: FishAutoState): number | null => s.mode !== 'auto' ? null : s.retry ? s.retry.until : s.lastRunAt === null ? 0 : s.lastRunAt + s.hours * HOUR;

/**
 * 同一台电脑开着好几个标签页时，只让一个去捕：谁先拿到「租约」谁捕，租约到期没续就让别人接手。
 * 返回是否拿到（或续上）租约。
 */
export function takeFishAutoLease(owner: string, now: number, ttlMs = 120_000): boolean {
  try {
    const current = JSON.parse(readPersistedStateRaw(leaseKey()) ?? 'null') as { owner?: string; until?: number } | null;
    if (current && current.owner !== owner && (current.until ?? 0) > now) return false;
    writePersistedStateRaw(leaseKey(), JSON.stringify({ owner, until: now + ttlMs }));
    const after = JSON.parse(readPersistedStateRaw(leaseKey()) ?? 'null') as { owner?: string } | null;
    return after?.owner === owner;
  } catch { return true; }
}
export function releaseFishAutoLease(owner: string): void {
  try { const current = JSON.parse(readPersistedStateRaw(leaseKey()) ?? 'null') as { owner?: string } | null; if (current?.owner === owner) writePersistedStateRaw(leaseKey(), JSON.stringify({ owner, until: 0 })); } catch { /* 到期自然失效 */ }
}
