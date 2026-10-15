/**
 * Deep RSA 第 6 步「特征深挖」的运行状态：与 useDeepRsaRun 同一个做法——放在模块级仓库里，
 * 运行中点进某场战役再返回，运行照常继续；最近一次结果按用户存在本机，下次打开直接显示。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { runFeatureDeepDive, type FeatureDeepDiveResult } from '@/lib/deepRsa/deepDive';
import type { RunProgress } from '@/lib/deepRsa/pipeline';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { RunStatus } from '@/components/journal/DeepRsaRunPanel';

const STORAGE_PREFIX = 'veil.deepRsa.deepDive.v1:';

interface DeepDiveState {
  userId: string | null;
  status: RunStatus;
  progress: RunProgress | null;
  result: FeatureDeepDiveResult | null;
  error: string | null;
}

let state: DeepDiveState = { userId: null, status: 'idle', progress: null, result: null, error: null };
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<DeepDiveState>) {
  state = { ...state, ...next };
  listeners.forEach(l => l());
}

function load(userId: string): FeatureDeepDiveResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as FeatureDeepDiveResult) : null;
  } catch {
    return null;
  }
}

function save(userId: string, result: FeatureDeepDiveResult) {
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(result));
  } catch {
    // 存不了只是下次打开要重跑
  }
}

function ensureUser(userId: string | undefined) {
  const id = userId ?? null;
  if (state.userId === id) return;
  controller?.abort();
  controller = null;
  state = { userId: id, status: 'idle', progress: null, result: id ? load(id) : null, error: null };
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useFeatureDeepDive(userId: string | undefined) {
  ensureUser(userId);
  const snapshot = useSyncExternalStore(subscribe, () => state);

  const run = useCallback(async (report: CampaignGroupReport) => {
    if (!userId || state.status === 'running') return;
    controller = new AbortController();
    const mine = controller;
    set({ status: 'running', progress: { stage: 'events', done: 0, total: 0 }, error: null });
    try {
      const result = await runFeatureDeepDive(report, { signal: mine.signal, onProgress: progress => { if (controller === mine) set({ progress }); } });
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
    a.download = `deep-rsa-features-${new Date(result.finishedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  return { ...snapshot, run, cancel, download };
}
