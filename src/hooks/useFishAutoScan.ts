import { readFishLookback } from '@/lib/fish/lookback';
/**
 * 定时自动捕捞的调度：网站开着（哪怕在后台标签页）就按设定的间隔自动捕一次。
 * 【用户要求】2026-10-21「自动模式下可以设置多长时间自动捕捉一次，只要电脑联着网，就进行自动捕捉。手动模式下，与现在的保持一致。」
 *
 * - 每 30 秒看一眼，另外在联网恢复、切回标签页时立刻看：到点、联着网、取数器空闲，就用和「开始捕捞」同一套设置捕一次（时间 = 现在）；
 * - 电脑睡眠 / 断网 / 浏览器关着时错过的那次，恢复后马上补上（只补一次，不会连补好几轮）；
 * - 同一台电脑开了多个标签页，只有拿到租约的那个去捕；
 * - 在自动模式下手动点「开始捕捞」也算一次，下次自动捕捞从这次往后数。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFishFeatures } from './useFishFeatures';
import { loadFishCardsForScan, readFishCombination } from '@/lib/fish/cards';
import { buildFishScanSettings, type FishScanSelection } from '@/lib/fish/scanPlan';
import { fishAutoNextAt, readFishAuto, releaseFishAutoLease, saveFishAuto, takeFishAutoLease, type FishAutoMode, type FishAutoState } from '@/lib/fish/autoScan';
import type { FishScanSettings } from '@/lib/fishScanner';

const TICK_MS = 30_000, RETRY_MS = 5 * 60_000;
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
export interface FishAutoScan {
  mode: FishAutoMode; hours: number; nextAt: number | null; lastRunAt: number | null; error: string; online: boolean; waiting: boolean;
  setMode: (mode: FishAutoMode) => void; setHours: (hours: number) => void; noteManualRun: () => void;
}
export function useFishAutoScan(o: { account?: string; selection: FishScanSelection; start: (settings: FishScanSettings) => Promise<unknown> | void; busy: () => boolean }): FishAutoScan {
  const defs = useFishFeatures();
  const [state, setStateRaw] = useState<FishAutoState>(readFishAuto);
  const [error, setError] = useState('');
  const [isOnline, setOnline] = useState(online);
  const [waiting, setWaiting] = useState(false);
  const stateRef = useRef(state); stateRef.current = state;
  const latest = useRef(o); latest.current = o;
  const defsRef = useRef(defs); defsRef.current = defs;
  const owner = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const runningRef = useRef(false), retryAt = useRef(0);
  const setState = useCallback((next: FishAutoState) => { stateRef.current = next; setStateRaw(next); saveFishAuto(next); }, []);
  useEffect(() => { const s = readFishAuto(); stateRef.current = s; setStateRaw(s); setError(''); retryAt.current = 0; }, [o.account]);

  const tick = useCallback(async () => {
    const s = stateRef.current, now = Date.now();
    setOnline(online());
    if (s.mode !== 'auto' || runningRef.current) return;
    const nextAt = fishAutoNextAt(s)!;
    if (now < nextAt || now < retryAt.current) { setWaiting(false); return; }
    if (!online()) { setWaiting(true); return; }
    if (latest.current.busy()) { setWaiting(true); return; }
    if (!takeFishAutoLease(owner.current, now)) { setWaiting(true); return; }
    // 另一个标签页刚捕过（租约交接期间）：以本机保存的最新时刻为准
    const fresh = readFishAuto();
    if (fresh.mode !== 'auto' || (fishAutoNextAt(fresh) ?? Infinity) > now) { stateRef.current = fresh; setStateRaw(fresh); releaseFishAutoLease(owner.current); return; }
    const cards = loadFishCardsForScan(defsRef.current.map(d => d.id));
    const built = buildFishScanSettings({ cards, defs: defsRef.current, combination: readFishCombination(), selection: latest.current.selection, time: '', lookbackHours:readFishLookback() });
    if (built.error !== undefined) { setError(`自动捕捞没开始：${built.error}`); retryAt.current = now + RETRY_MS; releaseFishAutoLease(owner.current); return; }
    setError(''); setWaiting(false); runningRef.current = true;
    setState({ ...fresh, lastRunAt: now });
    const renew = setInterval(() => takeFishAutoLease(owner.current, Date.now()), TICK_MS);
    try { await latest.current.start(built.settings); }
    catch (e) { setError(`自动捕捞出错：${e instanceof Error ? e.message : String(e)}`); }
    finally { clearInterval(renew); runningRef.current = false; releaseFishAutoLease(owner.current); }
  }, [setState]);
  const tickRef = useRef(tick); tickRef.current = tick;

  useEffect(() => {
    const run = () => { void tickRef.current(); };
    const timer = setInterval(run, TICK_MS);
    const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) run(); };
    window.addEventListener('online', run); window.addEventListener('offline', run); window.addEventListener('focus', run); document.addEventListener('visibilitychange', onVisible);
    run();
    return () => { clearInterval(timer); window.removeEventListener('online', run); window.removeEventListener('offline', run); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', onVisible); releaseFishAutoLease(owner.current); };
  }, [o.account]);
  // 打开自动模式 / 改间隔后马上看一眼（刚打开自动就会立刻捕第一次）
  useEffect(() => { void tickRef.current(); }, [state.mode, state.hours]);

  const setMode = useCallback((mode: FishAutoMode) => { retryAt.current = 0; setError(''); setState({ ...stateRef.current, mode, ...(mode === 'auto' && stateRef.current.mode !== 'auto' ? { lastRunAt: null } : {}) }); }, [setState]);
  const setHours = useCallback((hours: number) => setState({ ...stateRef.current, hours }), [setState]);
  const noteManualRun = useCallback(() => { if (stateRef.current.mode === 'auto') setState({ ...stateRef.current, lastRunAt: Date.now() }); }, [setState]);
  return { mode: state.mode, hours: state.hours, nextAt: fishAutoNextAt(state), lastRunAt: state.lastRunAt, error, online: isOnline, waiting, setMode, setHours, noteManualRun };
}
