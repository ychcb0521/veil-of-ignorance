/**
 * 「比较探测」的持续挖掘：按默认探测算法与阈值（开始时冻结），从 2026-04-01 00:00（UTC+8）起每半天扫一档，
 * 挖到的鱼直接入「鱼舱」并进「鱼质量」。先挖到目标条数（默认 1000）为止；追上现在之后，每过半天自动再扫一档。
 * 【用户要求】2026-10-26「先用当前默认算法和对应阈值挖掘信号（先挖掘1000个）……设置成能够动态持续挖掘的流程。
 * 时间就从2026年4月1号0点开始，半天挖掘一次。挖掘出的信号同时归入鱼舱和鱼质量中。」
 * 状态只存本机（按账号分区）。
 */
import type { FishCard } from '@/components/FishAlgorithmCard';
import type { TradeSignal } from '@/lib/signalLibrary';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { FISH_DEFAULT_RULES } from './cards';
import { fishCatchKey } from './records';

export const MINING_START_MS = Date.parse('2026-04-01T00:00:00+08:00');
export const MINING_STEP_MS = 12 * 3_600_000;
export const MINING_DEFAULT_TARGET = 1000;
export interface FishMiningRule { id: string; featureId: string; statistic: string; threshold: string }
export interface FishMiningState {
  version: 1; enabled: boolean; startMs: number; stepMs: number;
  /** 下一档要扫的锚点（扫完才前进；被打断或出错就原地重试）。 */
  cursorMs: number;
  target: number; mined: number; anchorsDone: number;
  /** 挖过的信号（同一段持续的信号只记第一次能发现的那档）；删掉的鱼不会被后面的档位再挖回来。 */
  minedKeys: string[];
  /** 开始挖掘时冻结的默认算法与阈值；之后改默认不影响这一轮实验。 */
  rules: FishMiningRule[];
  /** 开始时冻结的捕捞范围（交易所等）；没冻结过就用当前的。 */
  selection?: { exchanges: string[]; includeDuplicates: boolean; includeUsStocks?: boolean };
  lastAnchorMs: number | null; lastRunAt: number | null; lastError: string;
}
export const miningKey = () => `${getUserPrefix()}fish-mining.v1`;
const leaseKey = () => `${getUserPrefix()}fish-mining-lease.v1`;
export const currentDefaultRules = (): FishMiningRule[] => FISH_DEFAULT_RULES.map(r => ({ id: r.id, featureId: r.featureId, statistic: r.statistic, threshold: r.threshold }));
export const newMiningState = (): FishMiningState => ({ version: 1, enabled: false, startMs: MINING_START_MS, stepMs: MINING_STEP_MS, cursorMs: MINING_START_MS,
  target: MINING_DEFAULT_TARGET, mined: 0, anchorsDone: 0, minedKeys: [], rules: [], lastAnchorMs: null, lastRunAt: null, lastError: '' });

export function readMiningState(): FishMiningState {
  try {
    const x = JSON.parse(readPersistedStateRaw(miningKey()) ?? 'null');
    if (!x || x.version !== 1 || !Number.isFinite(x.cursorMs) || !Array.isArray(x.minedKeys)) return newMiningState();
    const base = newMiningState();
    return { ...base, ...x, enabled: !!x.enabled, target: Number.isInteger(x.target) && x.target > 0 ? x.target : base.target,
      rules: Array.isArray(x.rules) ? x.rules : [], lastError: typeof x.lastError === 'string' ? x.lastError : '' };
  } catch { return newMiningState(); }
}
export function saveMiningState(state: FishMiningState): void {
  try { writePersistedStateRaw(miningKey(), JSON.stringify(state)); } catch { /* 记不住只是下次从上次保存处接着挖 */ }
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
