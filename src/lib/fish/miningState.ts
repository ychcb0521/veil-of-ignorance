/**
 * 持续挖掘的状态类型、默认值与合并规则。单独成文件、不引任何重模块：
 * 云端同步层（simStateSync）水化时要用 mergeMiningStates，不能因此把捕捞 / 特征计算整串拉进启动路径。
 */
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
  /** 最后一次保存的时刻：合并两份时，开关、目标等设置取较新的那份。 */
  savedAt?: number;
}
/** 云端同步用的逻辑键（实际存储键是 sim_<uid>_fish-mining.v1）。 */
export const MINING_LOGICAL_KEY = 'fish-mining.v1';
export const MINING_LEASE_LOGICAL_KEY = 'fish-mining-lease.v1';
export const newMiningState = (): FishMiningState => ({ version: 1, enabled: false, startMs: MINING_START_MS, stepMs: MINING_STEP_MS, cursorMs: MINING_START_MS,
  target: MINING_DEFAULT_TARGET, mined: 0, anchorsDone: 0, minedKeys: [], rules: [], lastAnchorMs: null, lastRunAt: null, lastError: '' });
/** 读进来的值不可信（旧版本、云端、坏数据）：不像挖掘状态就返回 null。 */
export function normalizeMiningState(x: unknown): FishMiningState | null {
  const v = x as Partial<FishMiningState> | null;
  if (!v || typeof v !== 'object' || v.version !== 1 || !Number.isFinite(v.cursorMs) || !Array.isArray(v.minedKeys)) return null;
  const base = newMiningState();
  return { ...base, ...v, version: 1, enabled: !!v.enabled, target: Number.isInteger(v.target) && v.target! > 0 ? v.target! : base.target,
    minedKeys: v.minedKeys.filter((k): k is string => typeof k === 'string'),
    rules: Array.isArray(v.rules) ? v.rules : [], lastError: typeof v.lastError === 'string' ? v.lastError : '' } as FishMiningState;
}
/**
 * 两份挖掘状态合并（本机与云端、两台设备）：进度只进不退。
 * 游标、已扫档数、最后一档取挖得更远的那份；挖过的信号取并集；开关、目标、冻结的算法取较新保存的那份。
 */
export function mergeMiningStates(localRaw: unknown, remoteRaw: unknown): FishMiningState | unknown {
  const a = normalizeMiningState(localRaw), b = normalizeMiningState(remoteRaw);
  if (!a || !b) return a ?? b ?? localRaw ?? remoteRaw;
  const settings = (b.savedAt ?? 0) > (a.savedAt ?? 0) ? b : a;
  const far = b.cursorMs > a.cursorMs ? b : a;
  const minedKeys = [...new Set([...a.minedKeys, ...b.minedKeys])];
  return { ...settings, cursorMs: far.cursorMs, anchorsDone: Math.max(a.anchorsDone, b.anchorsDone), lastAnchorMs: far.lastAnchorMs,
    lastRunAt: Math.max(a.lastRunAt ?? 0, b.lastRunAt ?? 0) || null, lastError: far.lastError,
    rules: settings.rules.length ? settings.rules : far.rules, selection: settings.selection ?? far.selection,
    minedKeys, mined: Math.max(a.mined, b.mined, minedKeys.length), savedAt: Math.max(a.savedAt ?? 0, b.savedAt ?? 0) || undefined };
}
