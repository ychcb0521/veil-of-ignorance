import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFishFeatures } from './useFishFeatures';
import { compileFishProgram } from '@/lib/fish/algorithm';
import { readFishPreference } from '@/lib/fish/preferences';
import { readPersistedStateRaw, subscribePersistedStateHydration } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishReconstructionOptions, FishReconstructionProgress, FishReconstructionResult } from '@/lib/fish/reconstruction';
import { readReconstructionCache, saveReconstructionCache, loadReconstructionCacheDb, saveReconstructionCacheDb, reconstructionCacheKey, type ReconstructionCard, type ReconstructionCache } from '@/lib/fish/reconstructionCache';

const readCards = (): ReconstructionCard[] => {
  try {
    const cards = JSON.parse(readPersistedStateRaw(`${getUserPrefix()}fish-cards.v1`) ?? '[]');
    if (Array.isArray(cards) && cards.length) return cards.filter(c => c?.featureId && c.pref).slice(0, 6);
  } catch { /* use the first card's normal preference */ }
  return [{ id: 'first', featureId: 'cbi2', enabled: true, pref: readFishPreference('cbi2') }];
};
export type ReconstructionRunner = (options: FishReconstructionOptions) => Promise<FishReconstructionResult>;
export function useFishReconstruction(account: string | undefined, signals: readonly TradeSignal[], execute?: ReconstructionRunner) {
  const defs = useFishFeatures();
  const [cards, setCards] = useState(readCards);
  const [saved, setSaved] = useState<{ account: string | undefined; cache: ReconstructionCache | null }>(() => ({ account, cache: readReconstructionCache(account) }));
  const savedRef = useRef(saved); savedRef.current = saved;
  const [progress, setProgress] = useState<FishReconstructionProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [mode, setMode] = useState<'best' | 'current'>('best');
  const run = useRef<AbortController | null>(null);
  const key = useMemo(() => reconstructionCacheKey(account, cards, defs, signals), [account, cards, defs, signals]);
  const current = useRef({ account, key }); current.current = { account, key };
  const config = useMemo(() => {
    try {
      const plans = cards.map((c, i) => {
        const def = defs.find(d => d.id === c.featureId);
        if (!def) throw Error(`算法 ${i + 1} 的定义已不存在`);
        if (!c.pref.threshold.trim() || !Number.isFinite(Number(c.pref.threshold))) throw Error(`请先填写算法 ${i + 1} 的当前阈值`);
        const plan = compileFishProgram(def, { statistic: '结果', direction: '>', threshold: Number(c.pref.threshold), constraints: [] });
        if (plan.unavailable) throw Error(`算法 ${i + 1}：${plan.unavailable}`);
        return plan;
      });
      return { plans, error: plans.length ? '' : '请添加算法' };
    } catch (e) { return { plans: [], error: e instanceof Error ? e.message : String(e) }; }
  }, [cards, defs]);
  const onCardsChange = useCallback((next: ReconstructionCard[]) => setCards(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next), []);
  useEffect(() => {
    const storageKey = `${getUserPrefix()}fish-cards.v1`;
    const refresh = () => setCards(readCards());
    refresh();
    const unsubscribe = subscribePersistedStateHydration(storageKey, refresh);
    const storage = (e: StorageEvent) => { if (e.key === storageKey || e.key === null) refresh(); };
    window.addEventListener('storage', storage);
    return () => { unsubscribe(); window.removeEventListener('storage', storage); };
  }, [account]);
  useEffect(() => {
    run.current?.abort(); run.current = null; setRunning(false); setProgress(null); setError(''); setWarning('');
    const cache = readReconstructionCache(account, key);
    setSaved(previous => ({ account, cache: cache ?? (previous.account === account ? previous.cache : readReconstructionCache(account)) }));
    // IndexedDB 里的结果（大结果存在那里）异步补上：同一套设置的优先，其次最新一份（显示为已过期）
    let alive = true;
    void (async () => {
      const exact = await loadReconstructionCacheDb(account, key), latest = exact ?? await loadReconstructionCacheDb(account);
      if (!alive || !latest) return;
      setSaved(previous => previous.account !== account ? previous : previous.cache?.key === key && !exact ? previous : !exact && previous.cache && previous.cache.result.createdAt >= latest.result.createdAt ? previous : { account, cache: latest });
    })();
    return () => { alive = false; };
  }, [account, key]);
  useEffect(() => () => { run.current?.abort(); }, []);
  const cancel = useCallback(() => { run.current?.abort(); setProgress(p => ({ status: 'cancelled', phase: p?.phase ?? 'loading', done: p?.done ?? 0, total: p?.total ?? 0, current: '' })); }, []);
  const start = useCallback(async () => {
    if (run.current || !execute) return;
    setError(''); setWarning('');
    if (config.error || !signals.length) { setError(config.error || '信号库为空'); return; }
    // 打开时已从 IndexedDB 补读过；这里同步判断，不在开始前等数据库（避免重复点开始时并发两次）
    const cached = readReconstructionCache(account, key) ?? (savedRef.current.account === account && savedRef.current.cache?.key === key ? savedRef.current.cache : null);
    if (cached) { setSaved({ account, cache: cached }); return; }
    const controller = new AbortController(); run.current = controller; setRunning(true); setProgress(null);
    const valid = () => run.current === controller && !controller.signal.aborted && current.current.account === account && current.current.key === key;
    try {
      const result = await execute({ plans: config.plans, signals: [...signals], signal: controller.signal, onProgress: p => { if (valid()) setProgress(p); } });
      if (!valid()) return;
      setSaved({ account, cache: { version: 1, key, result } });
      if (!(await saveReconstructionCacheDb(account, key, result)) && !saveReconstructionCache(account, key, result)) setWarning('本机存储空间不足；本次结果可查看，刷新后需重新评估。');
    } catch (e) {
      if (run.current === controller) {
        if (controller.signal.aborted) setProgress(p => p ? { ...p, status: 'cancelled' } : null);
        else setError(e instanceof Error ? e.message : String(e));
      }
    } finally { if (run.current === controller) { run.current = null; setRunning(false); } }
  }, [account, key, config, signals, execute]);
  const cache = saved.account === account ? saved.cache : null;
  return { result: cache?.result ?? null, stale: !!cache && cache.key !== key, running, progress, error, warning,
    settingsError: config.error, available: !!execute && !!signals.length, mode, setMode, start, cancel, onCardsChange };
}
export type FishReconstructionState = ReturnType<typeof useFishReconstruction>;
