/**
 * Deep dig 每个特征值的运行状态：放在模块级仓库里（按特征值各一个），运行中点进某场战役再返回，运行照常继续；
 * 最近一次结果按用户、按特征值存在本机，下次打开直接显示（可随时重跑，不需要跨设备同步）。
 * 【用户要求】2026-10-16「描述统计和推断统计的运行要分开」：
 *   描述统计 = 取行情、按公式算特征值、按分组标准分组（联网，1–3 分钟）；
 *   推断统计 = 在最近一份描述统计数据上做检验（不联网，几秒），各存各的。
 * 旧页面的本机缓存顺手清掉；上一版「漂移速度 V」的结果（同一套默认公式与分组）迁过来。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { collectDeepDigData, type DeepDigData } from '@/lib/deepDig/analysis';
import { runInference, type DeepDigInference } from '@/lib/deepDig/commands';
import { DRIFT_SPEED_DEF, upgradeGroupVars, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { RunProgress } from '@/lib/deepRsa/pipeline';

export type RunStatus = 'idle' | 'running' | 'cancelled' | 'error';

const DATA_PREFIX = 'veil.deepDig.data.v2:';
const INFER_PREFIX = 'veil.deepDig.infer.v2:';
const LEGACY_PREFIXES = ['veil.deepRsa.lastRun.v1:', 'veil.deepRsa.deepDive.v1:', 'veil.deepRsa.dspStudy.v1:'];
/** 上一版只有「漂移速度 V」一项、描述与推断存在一起，公式与分组就是现在的默认值。 */
const DRIFT_V1_PREFIX = 'veil.deepDig.driftSpeed.v1:';

interface RunState {
  data: DeepDigData | null;
  inference: DeepDigInference | null;
  describeStatus: RunStatus;
  describeProgress: RunProgress | null;
  describeError: string | null;
  inferStatus: RunStatus;
  inferError: string | null;
}

interface Store {
  userId: string | null;
  state: RunState;
  controller: AbortController | null;
  listeners: Set<() => void>;
}

const stores = new Map<string, Store>();
const dataKey = (userId: string, featureId: string) => `${DATA_PREFIX}${userId}:${featureId}`;
const inferKey = (userId: string, featureId: string) => `${INFER_PREFIX}${userId}:${featureId}`;

function migrate(userId: string) {
  try {
    for (const prefix of LEGACY_PREFIXES) localStorage.removeItem(prefix + userId);
    const old = localStorage.getItem(DRIFT_V1_PREFIX + userId);
    if (old == null) return;
    localStorage.removeItem(DRIFT_V1_PREFIX + userId);
    const p = JSON.parse(old);
    if (!Array.isArray(p?.rows) || localStorage.getItem(dataKey(userId, DRIFT_SPEED_DEF.id)) != null) return;
    const { id, name, short, formula, scale, unit, positive, control } = DRIFT_SPEED_DEF;
    const data: DeepDigData = {
      definition: { id, name, short, formula, scale, unit, positive, control },
      codeVersion: p.codeVersion, startedAt: p.startedAt, finishedAt: p.finishedAt, coverage: p.coverage, rows: p.rows, groups: p.groups,
    };
    localStorage.setItem(dataKey(userId, DRIFT_SPEED_DEF.id), JSON.stringify(data));
  } catch {
    // 迁不过来只是要重跑一次
  }
}

function read<T>(key: string, ok: (v: T) => boolean): T | null {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as T) : null;
    return parsed && ok(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存不了只是下次打开要重跑 */ }
}

/** 旧数据里的分组标准是旧变量名（b 理论 b、r 盈亏比……）：换成指标字母，意思不变，不会误报「定义改过了」。 */
const upgradeData = (d: DeepDigData | null) => (d ? { ...d, definition: upgradeGroupVars(d.definition) } : null);

/** 读本机存的最近一次结果（目录页的摘要也用它）。 */
export function loadDeepDigResults(userId: string | undefined, featureId: string): { data: DeepDigData | null; inference: DeepDigInference | null } {
  if (!userId) return { data: null, inference: null };
  const live = stores.get(featureId);
  if (live && live.userId === userId) return { data: live.state.data, inference: live.state.inference };
  migrate(userId);
  return {
    data: upgradeData(read<DeepDigData>(dataKey(userId, featureId), d => Array.isArray(d.rows) && Array.isArray(d.groups) && !!d.definition)),
    // 旧版推断结果没有 blocks（还不是按命令算的）：不读，提示重跑
    inference: read<DeepDigInference>(inferKey(userId, featureId), r => typeof r.dataFinishedAt === 'number' && Array.isArray(r.blocks)),
  };
}

/** 删除特征值时一起清掉它的结果。 */
export function forgetDeepDigResult(userId: string | undefined, featureId: string) {
  stores.get(featureId)?.controller?.abort();
  stores.delete(featureId);
  if (!userId) return;
  try {
    localStorage.removeItem(dataKey(userId, featureId));
    localStorage.removeItem(inferKey(userId, featureId));
  } catch { /* 清不掉不影响 */ }
}

const IDLE = { describeStatus: 'idle', describeProgress: null, describeError: null, inferStatus: 'idle', inferError: null } as const;

function storeOf(featureId: string, userId: string | undefined): Store {
  const id = userId ?? null;
  let store = stores.get(featureId);
  if (!store) {
    store = { userId: null, state: { data: null, inference: null, ...IDLE }, controller: null, listeners: new Set() };
    stores.set(featureId, store);
  }
  if (store.userId !== id) {
    store.controller?.abort();
    store.controller = null;
    store.userId = null;
    const loaded = loadDeepDigResults(userId, featureId);
    store.userId = id;
    store.state = { ...loaded, ...IDLE };
  }
  return store;
}

function set(store: Store, next: Partial<RunState>) {
  store.state = { ...store.state, ...next };
  store.listeners.forEach(l => l());
}

export function useDeepDigRun(userId: string | undefined, def: DeepDigFeatureDef) {
  const store = storeOf(def.id, userId);
  const subscribe = useCallback((l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; }, [store]);
  const state = useSyncExternalStore(subscribe, () => store.state);

  const describe = useCallback(async (report: CampaignGroupReport, signals: readonly TradeSignal[] = []) => {
    if (!userId || store.state.describeStatus === 'running') return;
    const mine = new AbortController();
    store.controller = mine;
    set(store, { describeStatus: 'running', describeProgress: { stage: 'events', done: 0, total: 0 }, describeError: null });
    try {
      const data = await collectDeepDigData(report, def, { signals, signal: mine.signal, onProgress: p => { if (store.controller === mine) set(store, { describeProgress: p }); } });
      if (store.controller !== mine) return;
      write(dataKey(userId, def.id), data);
      set(store, { describeStatus: 'idle', describeProgress: null, data });
    } catch (error) {
      if (store.controller !== mine) return;
      if (mine.signal.aborted) set(store, { describeStatus: 'cancelled', describeProgress: null });
      else set(store, { describeStatus: 'error', describeProgress: null, describeError: error instanceof Error ? error.message : String(error) });
    } finally {
      if (store.controller === mine) store.controller = null;
    }
  }, [userId, def, store]);

  const cancel = useCallback(() => { store.controller?.abort(); }, [store]);

  /** data 是删减后的数据；excludedKey 记下这次用了哪些删减；commands 是推断统计的命令原文。 */
  const infer = useCallback(async (data: DeepDigData, excludedKey: string, commands: string) => {
    if (!userId || store.state.inferStatus === 'running') return;
    set(store, { inferStatus: 'running', inferError: null });
    // 让「运行中」先画出来：置换检验要算几秒
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    try {
      const inference = runInference(data, commands, { excludedKey });
      write(inferKey(userId, def.id), inference);
      set(store, { inferStatus: 'idle', inference });
    } catch (error) {
      set(store, { inferStatus: 'error', inferError: error instanceof Error ? error.message : String(error) });
    }
  }, [userId, def.id, store]);

  const download = useCallback(() => {
    const { data, inference } = store.state;
    if (!data) return;
    const blob = new Blob([JSON.stringify({ data, inference }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deep-dig-${def.id}-${new Date(data.finishedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [store, def.id]);

  return { ...state, describe, cancel, infer, download };
}
