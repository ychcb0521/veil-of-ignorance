/**
 * 「比较探测」的持续挖掘：按默认探测算法与阈值（开始时冻结），从 2026-04-01 00:00（UTC+8）起每半天扫一档，
 * 挖到的鱼直接入「鱼舱」并进「鱼质量」。先挖到目标条数（默认 1000）为止；追上现在之后，每过半天自动再扫一档。
 * 【用户要求】2026-10-26「先用当前默认算法和对应阈值挖掘信号（先挖掘1000个）……设置成能够动态持续挖掘的流程。
 * 时间就从2026年4月1号0点开始，半天挖掘一次。挖掘出的信号同时归入鱼舱和鱼质量中。」
 * 状态按账号存本机，并推一份到云端（进度只进不退：两边合并取挖得更远的那份，见 mergeMiningStates）。
 * 【用户要求】2026-10-26「自动挖掘可以记住上次挖掘到那个时间点了。下次点开时，能够按照时间顺序接上」——
 * 以前只存本机，登录时云端补推的旧快照会在下次打开时把本机进度盖回去；现在每次保存都推云，
 * 并且鱼舱里已挖到的鱼（带 mined.anchorMs）也能反推进度，状态丢了也从最后挖到的那一档往后接。
 */
import type { FishCard } from '@/components/FishAlgorithmCard';
import type { TradeSignal } from '@/lib/signalLibrary';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { queueSimStatePush } from '@/lib/simStateSync';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { LEGACY_FISH_DEFAULT_RULES } from './cards';
import { fishCatchKey } from './records';
import { MINING_LEASE_LOGICAL_KEY, MINING_LOGICAL_KEY, normalizeMiningState, newMiningState, type FishMiningRule, type FishMiningState } from './miningState';
export * from './miningState';

export const miningKey = () => `${getUserPrefix()}${MINING_LOGICAL_KEY}`;
const leaseKey = () => `${getUserPrefix()}${MINING_LEASE_LOGICAL_KEY}`;
export const currentDefaultRules = (): FishMiningRule[] => LEGACY_FISH_DEFAULT_RULES.map(r => ({ id: r.id, featureId: r.featureId, statistic: r.statistic, threshold: r.threshold }));

export function readMiningState(): FishMiningState {
  try { return normalizeMiningState(JSON.parse(readPersistedStateRaw(miningKey()) ?? 'null')) ?? newMiningState(); } catch { return newMiningState(); }
}
export function saveMiningState(state: FishMiningState, now = Date.now()): void {
  const value = { ...state, savedAt: now };
  try { writePersistedStateRaw(miningKey(), JSON.stringify(value)); } catch { /* 本机写不进时云端那份仍会更新 */ }
  try { const uid = getUserId(); if (uid) queueSimStatePush(uid, MINING_LOGICAL_KEY, value); } catch { /* 同步失败只是换设备时接不上，本机照常 */ }
}
/**
 * 用鱼舱里已挖到的鱼校正进度：状态丢了、或被旧快照盖回去时，从最后挖到鱼的那一档往后接（按时间顺序，不重挖前面的档）。
 * 没有更远的鱼就原样返回同一个对象。
 */
export function reconcileMiningWithFish(state: FishMiningState, signals: readonly TradeSignal[]): FishMiningState {
  const mined = signals.filter(s => s.mined && Number.isFinite(s.mined.anchorMs));
  if (!mined.length) return state;
  const lastAnchor = Math.max(...mined.map(s => s.mined!.anchorMs));
  const seen = new Set(state.minedKeys), fresh = mined.map(fishCatchKey).filter(k => !seen.has(k) && (seen.add(k), true));
  if (lastAnchor + state.stepMs <= state.cursorMs && !fresh.length) return state;
  const cursorMs = Math.max(state.cursorMs, lastAnchor + state.stepMs);
  const minedKeys = [...state.minedKeys, ...fresh];
  return { ...state, cursorMs, minedKeys, mined: Math.max(state.mined, minedKeys.length),
    anchorsDone: Math.max(state.anchorsDone, Math.round((cursorMs - state.startMs) / state.stepMs)),
    lastAnchorMs: Math.max(state.lastAnchorMs ?? -Infinity, lastAnchor) };
}
/** 现在该扫的锚点：开着、没到目标、锚点已经过去；否则 null。 */
export function miningDueAnchor(s: FishMiningState, now: number): number | null {
  return s.enabled && s.mined < s.target && s.cursorMs <= now ? s.cursorMs : null;
}
/** 冻结的规则拼成捕捞卡（全部启用、方向 >、与默认卡同一套编号）。 */
export function miningCards(rules: readonly FishMiningRule[]): FishCard[] {
  return rules.map(r => ({ id: r.id, featureId: r.featureId, enabled: true, pref: { statistic: r.statistic, direction: '>', threshold: r.threshold, constraints: [] } }));
}
/**
 * 一档扫完：去掉挖过的信号，其余作为鱼舱记录（不是新鱼、不发邮件），标上锚点；游标前进一档。
 * 超过目标的部分也收下（同一档的结果不拆开）。
 */
export function acceptMinedAnchor(state: FishMiningState, found: readonly TradeSignal[], anchorMs: number, now: number): { state: FishMiningState; added: TradeSignal[] } {
  const seen = new Set(state.minedKeys), added: TradeSignal[] = [];
  for (const raw of found) {
    const key = fishCatchKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    const { freshCatch: _fresh, ...signal } = raw;
    added.push({ ...signal, id: `${raw.id}|mine:${anchorMs}`, fishArchive: { id: `mine-${anchorMs}`, at: now }, caughtAt: now, mined: { anchorMs } });
  }
  return { added, state: { ...state, cursorMs: anchorMs + state.stepMs, mined: state.mined + added.length, anchorsDone: state.anchorsDone + 1,
    minedKeys: [...state.minedKeys, ...added.map(fishCatchKey)], lastAnchorMs: anchorMs, lastRunAt: now, lastError: '' } };
}
/** 同一台电脑开着多个标签页时只让一个去挖。 */
export function takeMiningLease(owner: string, now: number, ttlMs = 180_000): boolean {
  try {
    const current = JSON.parse(readPersistedStateRaw(leaseKey()) ?? 'null') as { owner?: string; until?: number } | null;
    if (current && current.owner !== owner && (current.until ?? 0) > now) return false;
    writePersistedStateRaw(leaseKey(), JSON.stringify({ owner, until: now + ttlMs }));
    return (JSON.parse(readPersistedStateRaw(leaseKey()) ?? 'null') as { owner?: string } | null)?.owner === owner;
  } catch { return true; }
}
export function releaseMiningLease(owner: string): void {
  try { const current = JSON.parse(readPersistedStateRaw(leaseKey()) ?? 'null') as { owner?: string } | null; if (current?.owner === owner) writePersistedStateRaw(leaseKey(), JSON.stringify({ owner, until: 0 })); } catch { /* 到期自然失效 */ }
}
