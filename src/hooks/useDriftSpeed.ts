/**
 * Deep dig「多空博弈均衡点漂移速度 V」的运行状态：放在模块级仓库里，运行中点进某场战役再返回，运行照常继续；
 * 最近一次结果按用户存在本机，下次打开直接显示（可随时重跑，不需要跨设备同步）。
 * 【用户要求】2026-10-16 Deep RSA 改为 Deep dig 并删减：旧页面三项运行的本机缓存顺手清掉。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { runDriftSpeed, type DriftSpeedResult } from '@/lib/deepDig/driftSpeed';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { RunProgress } from '@/lib/deepRsa/pipeline';

export type RunStatus = 'idle' | 'running' | 'cancelled' | 'error';

const STORAGE_PREFIX = 'veil.deepDig.driftSpeed.v1:';
const LEGACY_PREFIXES = ['veil.deepRsa.lastRun.v1:', 'veil.deepRsa.deepDive.v1:', 'veil.deepRsa.dspStudy.v1:'];

interface DriftState {
  userId: string | null;
  status: RunStatus;
  progress: RunProgress | null;
  result: DriftSpeedResult | null;
  error: string | null;
}

const store: { state: DriftState; controller: AbortController | null; listeners: Set<() => void> } = {
  state: { userId: null, status: 'idle', progress: null, result: null, error: null },
  controller: null,
  listeners: new Set(),
};

function set(next: Partial<DriftState>) {
  store.state = { ...store.state, ...next };
  store.listeners.forEach(l => l());
}

function load(userId: string): DriftSpeedResult | null {
  try {
    for (const prefix of LEGACY_PREFIXES) localStorage.removeItem(prefix + userId);
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    const parsed = raw ? (JSON.parse(raw) as DriftSpeedResult) : null;
    return parsed && Array.isArray(parsed.rows) && Array.isArray(parsed.groups) ? parsed : null;
  } catch {
    return null;
  }
}

function save(userId: string, result: DriftSpeedResult) {
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(result));
  } catch {
    // 存不了只是下次打开要重跑
  }
}

function ensureUser(userId: string | undefined) {
  const id = userId ?? null;
  if (store.state.userId === id) return;
  store.controller?.abort();
  store.controller = null;
  store.state = { userId: id, status: 'idle', progress: null, result: id ? load(id) : null, error: null };
}

const subscribe = (l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; };
const snapshot = () => store.state;

export function useDriftSpeed(userId: string | undefined) {
  ensureUser(userId);
  const state = useSyncExternalStore(subscribe, snapshot);

  const run = useCallback(async (report: CampaignGroupReport) => {
    if (!userId || store.state.status === 'running') return;
    const mine = new AbortController();
    store.controller = mine;
    set({ status: 'running', progress: { stage: 'events', done: 0, total: 0 }, error: null });
    try {
      const result = await runDriftSpeed(report, { signal: mine.signal, onProgress: progress => { if (store.controller === mine) set({ progress }); } });
      if (store.controller !== mine) return;
      save(userId, result);
      set({ status: 'idle', progress: null, result });
    } catch (error) {
      if (store.controller !== mine) return;
      if (mine.signal.aborted) set({ status: 'cancelled', progress: null });
      else set({ status: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (store.controller === mine) store.controller = null;
    }
  }, [userId]);

  const cancel = useCallback(() => { store.controller?.abort(); }, []);

  const download = useCallback(() => {
    const result = store.state.result;
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deep-dig-drift-speed-${new Date(result.finishedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  return { ...state, run, cancel, download };
}
