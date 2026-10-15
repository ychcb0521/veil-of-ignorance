/**
 * Deep RSA 运行状态：放在模块级仓库里，而不是页面 state——
 * 运行中点进某场战役再返回，运行照常继续、进度和结果都还在（【用户要求】操作流畅第一）。
 * 最近一次结果按用户存在本机（localStorage），下次打开直接显示；存不了也不影响运行。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { runDeepRsa, type DeepRsaRunResult, type RunProgress } from '@/lib/deepRsa/pipeline';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { RunStatus } from '@/components/journal/DeepRsaRunPanel';

const STORAGE_PREFIX = 'veil.deepRsa.lastRun.v1:';

interface RunState {
  userId: string | null;
  status: RunStatus;
  progress: RunProgress | null;
  result: DeepRsaRunResult | null;
  error: string | null;
}

let state: RunState = { userId: null, status: 'idle', progress: null, result: null, error: null };
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<RunState>) {
  state = { ...state, ...next };
  listeners.forEach(l => l());
}

function load(userId: string): DeepRsaRunResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as DeepRsaRunResult) : null;
  } catch {
    return null;
  }
}

function save(userId: string, result: DeepRsaRunResult) {
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(result));
  } catch {
    // 存不了只是下次打开要重跑
  }
}

/** 换了用户就换一份状态（不把别人的结果显示出来）。 */
function ensureUser(userId: string | undefined) {
  const id = userId ?? null;
  if (state.userId === id) return;
  controller?.abort();
  controller = null;
  state = { userId: id, status: 'idle', progress: null, result: id ? load(id) : null, error: null };
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useDeepRsaRun(userId: string | undefined) {
  ensureUser(userId);
  const snapshot = useSyncExternalStore(subscribe, () => state);

  const run = useCallback(async (report: CampaignGroupReport) => {
    if (!userId || state.status === 'running') return;
    controller = new AbortController();
    const mine = controller;
    set({ status: 'running', progress: { stage: 'events', done: 0, total: 0 }, error: null });
    try {
      const result = await runDeepRsa(report, { signal: mine.signal, onProgress: progress => { if (controller === mine) set({ progress }); } });
      if (controller !== mine) return;
      save(userId, result);
      set({ status: 'idle', progress: null, result });
    } catch (error) {
      if (controller !== mine) return;
      if (mine.signal.aborted) set({ status: 'cancelled', progress: null });
      else set({ status: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (controller === mine) controller = null;
    }
  }, [userId]);

  const cancel = useCallback(() => { controller?.abort(); }, []);

  const download = useCallback(() => {
    const result = state.result;
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deep-rsa-${new Date(result.finishedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  return { ...snapshot, run, cancel, download };
}
