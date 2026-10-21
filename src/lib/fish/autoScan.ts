/**
 * 「渔」的定时自动捕捞：手动 / 自动两种模式，自动时每隔 N 小时捕一次。
 * 【用户要求】2026-10-21「渔这里增设一个定时自动（& 手动）捕捉的功能，自动模式下可以设置多长时间（0.5h / 1h / 2h / 4h / 8h / 16h / 32h / 64h）
 * 自动捕捉一次；只要电脑联着网，就进行自动捕捉。手动模式下，与现在的保持一致。」
 * 设置只存本机（按账号分区）：每台电脑各自定时，不跨设备同步，免得两台同时捕。
 */
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';

export const FISH_AUTO_INTERVALS = [0.5, 1, 2, 4, 8, 16, 32, 64] as const;
export type FishAutoMode = 'manual' | 'auto';
export interface FishAutoState { mode: FishAutoMode; hours: number; lastRunAt: number | null }
const HOUR = 3_600_000;
export const fishAutoKey = () => `${getUserPrefix()}fish-auto.v1`;
const leaseKey = () => `${getUserPrefix()}fish-auto-lease.v1`;
export const DEFAULT_FISH_AUTO: FishAutoState = { mode: 'auto', hours: 1, lastRunAt: null };

export function readFishAuto(): FishAutoState {
  try {
    const x = JSON.parse(readPersistedStateRaw(fishAutoKey()) ?? 'null');
    if (!x) return DEFAULT_FISH_AUTO;
    const state: FishAutoState = { mode: x.defaultsVersion === 1 && x.mode === 'manual' ? 'manual' : 'auto', hours: (FISH_AUTO_INTERVALS as readonly number[]).includes(x.hours) ? x.hours : 1, lastRunAt: Number.isFinite(x.lastRunAt) ? x.lastRunAt : null };
    // 旧版默认手动升级一次；此后用户选择手动仍然保留，间隔和上次捕捞时间不变。
    if (x.defaultsVersion !== 1) saveFishAuto(state);
    return state;
  } catch { return DEFAULT_FISH_AUTO; }
}
export function saveFishAuto(state: FishAutoState): void {
  try { writePersistedStateRaw(fishAutoKey(), JSON.stringify({ ...state, defaultsVersion: 1 })); } catch { /* 记不住只是下次要重新设 */ }
}
/** 下次自动捕捞的时刻：手动模式没有；自动模式从没捕过就是现在。 */
export const fishAutoNextAt = (s: FishAutoState): number | null => s.mode !== 'auto' ? null : s.lastRunAt === null ? 0 : s.lastRunAt + s.hours * HOUR;

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
