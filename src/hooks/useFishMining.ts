/**
 * 「比较探测」持续挖掘的调度（见 lib/fish/mining.ts）。网站开着就在后台一档一档往前挖：
 * - 取数器空闲才挖；手动 / 定时捕捞一开始就打断这一档（之后原地重扫），挖掘永远让路；
 * - 补历史时一档接一档连着挖；追上现在后，每到下一个半天整点再挖一档；
 * - 出错原地重试（间隔 2 分钟）；多个标签页只有拿到租约的那个挖。
 * - 每次读进度都用鱼舱里已挖到的鱼校正一遍：进度被旧快照盖回去或丢了，也从最后挖到的那一档往后接。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishProgress, FishScanSettings } from '@/lib/fishScanner';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { buildFishScanSettings, type FishScanSelection } from '@/lib/fish/scanPlan';
import { fishCatchKey, mergeFishSignals } from '@/lib/fish/records';
import { adoptMinedFish, recordMinedAnchor, recordMiningError } from '@/lib/fish/miningLibrary';
import { updateMiningLibrary } from '@/lib/fish/miningLibraryStore';
import { acceptMinedAnchor, currentDefaultRules, miningCards, miningDueAnchor, readMiningState, reconcileMiningWithFish, releaseMiningLease, saveMiningState, takeMiningLease, type FishMiningState } from '@/lib/fish/mining';

const TICK_MS = 30_000, RETRY_MS = 2 * 60_000;
export interface FishMiningApi {
  state: FishMiningState; running: boolean; anchorMs: number | null; progress: { done: number; total: number } | null; waiting: string;
  start: () => void; pause: () => void; setTarget: (target: number) => void;
  /** 挖掘库按账号存；holdKeys = 鱼舱里现有挖掘鱼的键（不在其中的，挖掘库里标「已从鱼舱删除」）。 */
  account?: string; holdKeys?: () => ReadonlySet<string>;
}
export function useFishMining(o: {
  account?: string; selection: FishScanSelection; defs: readonly DeepDigFeatureDef[];
  mine: (settings: FishScanSettings, onProgress?: (p: FishProgress) => void) => Promise<TradeSignal[]>;
  busy: () => boolean; stop: () => void; signalsRef: { current: TradeSignal[] }; commit: (list: TradeSignal[]) => void;
  /** 每档入舱后通知（鱼质量据此把挖到的鱼加进评估）。 */
  onMined?: (added: TradeSignal[]) => void;
}): FishMiningApi {
  /** 读本机进度，并用鱼舱里挖到的鱼校正（校正过就存回去、推云）。 */
  const load = (signals: readonly TradeSignal[]): FishMiningState => {
    const s = readMiningState(), fixed = reconcileMiningWithFish(s, signals);
    if (fixed !== s) saveMiningState(fixed);
    return fixed;
  };
  const [state, setStateRaw] = useState<FishMiningState>(() => load(o.signalsRef.current));
  const [running, setRunning] = useState(false), [anchorMs, setAnchorMs] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null), [waiting, setWaiting] = useState('');
  const stateRef = useRef(state), latest = useRef(o); latest.current = o;
  const runningRef = useRef(false), retryAt = useRef(0), account = useRef(o.account);
  const owner = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const setState = useCallback((next: FishMiningState) => { stateRef.current = next; setStateRaw(next); saveMiningState(next); }, []);
  useEffect(() => {
    account.current = o.account; const s = load(latest.current.signalsRef.current); stateRef.current = s; setStateRaw(s); retryAt.current = 0; setWaiting('');
    // 挖掘库上线前挖到的鱼：从鱼舱补进挖掘库（只补一次）
    void updateMiningLibrary(o.account, library => adoptMinedFish(library, s, latest.current.signalsRef.current, Date.now()));
  }, [o.account]);

  const tick = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    const now = Date.now(), s = load(latest.current.signalsRef.current);
    stateRef.current = s; setStateRaw(s);
    const anchor = miningDueAnchor(s, now);
    if (anchor == null) { setWaiting(''); return; }
    if (now < retryAt.current) return;
    if (latest.current.busy()) { setWaiting('取数器正忙（捕捞 / 复原中），空闲后接着挖'); return; }
    if (!takeMiningLease(owner.current, now)) { setWaiting('另一个标签页正在挖掘'); return; }
    const built = buildFishScanSettings({ cards: miningCards(s.rules), defs: latest.current.defs, combination: 'or', selection: (s.selection as FishScanSelection | undefined) ?? latest.current.selection, time: '' });
    if (built.error !== undefined) { setState({ ...s, lastError: built.error }); retryAt.current = now + RETRY_MS; releaseMiningLease(owner.current); return; }
    runningRef.current = true; setRunning(true); setAnchorMs(anchor); setProgress(null); setWaiting('');
    const who = account.current, renew = setInterval(() => takeMiningLease(owner.current, Date.now()), TICK_MS);
    let advanced = false;
    try {
      const found = await latest.current.mine({ ...built.settings, anchorMs: anchor }, p => setProgress({ done: p.done, total: p.total }));
      if (account.current !== who) return;
      const fresh = readMiningState();
      // 期间被暂停 / 换了档位（别的标签页挖过）就不收这一档
      if (!fresh.enabled || fresh.cursorMs !== anchor) return;
      const { state: next, added } = acceptMinedAnchor(fresh, found, anchor, Date.now());
      if (added.length) latest.current.commit(mergeFishSignals(latest.current.signalsRef.current, added));
      setState(next); advanced = true;
      // 挖掘库：记下这一档扫到几条、新增哪些（独立于鱼舱，删了鱼也还在）
      const scanned = found.length, at = Date.now();
      void updateMiningLibrary(who, library => recordMinedAnchor(library, next, anchor, scanned, added, at));
      if (added.length) latest.current.onMined?.(added);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // 让路给捕捞，空闲后原地重扫
      if (e instanceof Error && e.message === '取数器正忙') return;
      const failed = { ...readMiningState(), lastError: e instanceof Error ? e.message : String(e) }, at = Date.now();
      setState(failed); retryAt.current = at + RETRY_MS;
      void updateMiningLibrary(who, library => recordMiningError(library, { ...failed, rules: failed.rules.length ? failed.rules : s.rules }, anchor, failed.lastError, at));
    } finally {
      clearInterval(renew); releaseMiningLease(owner.current);
      runningRef.current = false; setRunning(false); setAnchorMs(null); setProgress(null);
      // 补历史时一档接一档连着挖
      if (advanced) setTimeout(() => void tickRef.current(), 0);
    }
  }, [setState]);
  const tickRef = useRef(tick); tickRef.current = tick;
  useEffect(() => {
    const run = () => { void tickRef.current(); };
    const timer = setInterval(run, TICK_MS);
    window.addEventListener('online', run); window.addEventListener('focus', run);
    run();
    return () => { clearInterval(timer); window.removeEventListener('online', run); window.removeEventListener('focus', run); releaseMiningLease(owner.current); };
  }, [o.account]);

  const start = useCallback(() => {
    const s = load(latest.current.signalsRef.current);
    // 第一次开始时冻结当前默认算法与阈值
    setState({ ...s, enabled: true, rules: s.rules.length ? s.rules : currentDefaultRules(), selection: s.selection ?? { ...latest.current.selection, exchanges: [...latest.current.selection.exchanges] }, lastError: '' });
    retryAt.current = 0; setTimeout(() => void tickRef.current(), 0);
  }, [setState]);
  const pause = useCallback(() => { setState({ ...readMiningState(), enabled: false }); latest.current.stop(); }, [setState]);
  const setTarget = useCallback((target: number) => {
    if (!Number.isInteger(target) || target <= 0) return;
    setState({ ...readMiningState(), target }); retryAt.current = 0; setTimeout(() => void tickRef.current(), 0);
  }, [setState]);
  const holdKeys = useCallback(() => new Set(latest.current.signalsRef.current.filter(s => s.mined).map(fishCatchKey)), []);
  return { state, running, anchorMs, progress, waiting, start, pause, setTarget, account: o.account, holdKeys };
}
