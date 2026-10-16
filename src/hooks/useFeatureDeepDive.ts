/**
 * Deep RSA 第 6 步「特征深挖」与第 7 步「动态谢林点检验」的运行状态：与 useDeepRsaRun 同一个做法——放在模块级仓库里，
 * 运行中点进某场战役再返回，运行照常继续；最近一次结果按用户存在本机，下次打开直接显示。两项研究各存各的。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { DEEP_DIVE_STUDIES, runFeatureDeepDive, type DeepDiveStudyId, type FeatureDeepDiveResult } from '@/lib/deepRsa/deepDive';
import type { RunProgress } from '@/lib/deepRsa/pipeline';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import type { RunStatus } from '@/components/journal/DeepRsaRunPanel';

const STORAGE_PREFIX: Record<DeepDiveStudyId, string> = { features: 'veil.deepRsa.deepDive.v1:', dsp: 'veil.deepRsa.dspStudy.v1:' };
const DOWNLOAD_PREFIX: Record<DeepDiveStudyId, string> = { features: 'deep-rsa-features-', dsp: 'deep-rsa-dsp-' };

interface DeepDiveState {
  userId: string | null;
  status: RunStatus;
  progress: RunProgress | null;
  result: FeatureDeepDiveResult | null;
  error: string | null;
}

interface Store {
  state: DeepDiveState;
  controller: AbortController | null;
  listeners: Set<() => void>;
}

const stores = {} as Record<DeepDiveStudyId, Store>;
function storeOf(study: DeepDiveStudyId): Store {
  stores[study] ??= { state: { userId: null, status: 'idle', progress: null, result: null, error: null }, controller: null, listeners: new Set() };
  return stores[study];
}

function set(store: Store, next: Partial<DeepDiveState>) {
  store.state = { ...store.state, ...next };
  store.listeners.forEach(l => l());
}

function load(study: DeepDiveStudyId, userId: string): FeatureDeepDiveResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX[study] + userId);
    return raw ? (JSON.parse(raw) as FeatureDeepDiveResult) : null;
  } catch {
    return null;
  }
}

function save(study: DeepDiveStudyId, userId: string, result: FeatureDeepDiveResult) {
  try {
    localStorage.setItem(STORAGE_PREFIX[study] + userId, JSON.stringify(result));
  } catch {
    // 存不了只是下次打开要重跑
  }
}

function ensureUser(study: DeepDiveStudyId, userId: string | undefined) {
  const store = storeOf(study);
  const id = userId ?? null;
  if (store.state.userId === id) return;
  store.controller?.abort();
  store.controller = null;
  store.state = { userId: id, status: 'idle', progress: null, result: id ? load(study, id) : null, error: null };
}

export function useFeatureDeepDive(userId: string | undefined, study: DeepDiveStudyId = 'features') {
  ensureUser(study, userId);
  const store = storeOf(study);
  const subscribe = useCallback((l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; }, [store]);
  const snapshot = useSyncExternalStore(subscribe, () => store.state);

  const run = useCallback(async (report: CampaignGroupReport) => {
    if (!userId || store.state.status === 'running') return;
    const mine = new AbortController();
    store.controller = mine;
    set(store, { status: 'running', progress: { stage: 'events', done: 0, total: 0 }, error: null });
    try {
      const result = await runFeatureDeepDive(report, {
        study: DEEP_DIVE_STUDIES[study], signal: mine.signal, onProgress: progress => { if (store.controller === mine) set(store, { progress }); },
      });
      if (store.controller !== mine) return;
      save(study, userId, result);
      set(store, { status: 'idle', progress: null, result });
    } catch (error) {
      if (store.controller !== mine) return;
      if (mine.signal.aborted) set(store, { status: 'cancelled', progress: null });
      else set(store, { status: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (store.controller === mine) store.controller = null;
    }
  }, [userId, study, store]);

  const cancel = useCallback(() => { store.controller?.abort(); }, [store]);

  const download = useCallback(() => {
    const result = store.state.result;
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${DOWNLOAD_PREFIX[study]}${new Date(result.finishedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [store, study]);

  return { ...snapshot, run, cancel, download };
}
