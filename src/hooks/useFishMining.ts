/**
 * 「比较探测」持续挖掘的调度（见 lib/fish/mining.ts）。网站开着就在后台一档一档往前挖：
 * - 取数器空闲才挖；手动 / 定时捕捞一开始就打断这一档（之后原地重扫），挖掘永远让路；
 * - 补历史时一档接一档连着挖；追上现在后，每到下一个半天整点再挖一档；
 * - 出错原地重试（间隔 2 分钟）；多个标签页只有拿到租约的那个挖。
 * - 每次读进度都用鱼舱里已挖到的鱼校正一遍：进度被旧快照盖回去或丢了，也从最后挖到的那一档往后接。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishProgress, FishScanSettings } from '@/lib/fishScanner';
import { fishStatistics } from '@/lib/fish/algorithm';
import { AUDITED_EXCHANGES } from '@/lib/fish/exchanges';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { buildFishScanSettings, type FishScanSelection } from '@/lib/fish/scanPlan';
import { fishCatchKey, fishVisibleCatchKey, mergeFishSignals } from '@/lib/fish/records';
import { adoptMinedFish, recordMinedAnchor, recordMiningError } from '@/lib/fish/miningLibrary';
import { updateMiningLibrary } from '@/lib/fish/miningLibraryStore';
import { acceptMinedAnchor, resolveMiningRuleAliases, currentDefaultRules, miningCards, miningDueAnchor, readMiningState, reconcileMiningWithFish, releaseMiningLease, saveMiningState, takeMiningLease, miningFailureState, MINING_STALL_MS, type FishMiningState } from '@/lib/fish/mining';

const TICK_MS = 30_000;
export interface FishMiningApi {
  state: FishMiningState; running: boolean; anchorMs: number | null; progress: { done: number; total: number } | null; waiting: string;
  start: () => void; pause: () => void; setTarget: (target: number) => void;
  /** 挖掘库按账号存；holdKeys = 鱼舱里现有挖掘鱼的键（不在其中的，挖掘库里标「已从鱼舱删除」）。 */
  ruleChoices?: {featureId:string;label:string;statistics:{name:string;label:string}[]}[];
  configure?: (rules:FishMiningState['rules'])=>void;
  retry?: () => void; useCurrentScope?: () => void; resetConfiguration?: () => void;
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
  const runningRef = useRef(false), generation = useRef(0), runId = useRef(0), account = useRef(o.account);
  const runningStop=useRef<(()=>void)|null>(null),cancelTask=useRef<(()=>void)|null>(null);
  if(account.current!==o.account){generation.current++;runId.current++;cancelTask.current?.();runningStop.current?.();runningStop.current=null;runningRef.current=false;account.current=o.account;}
  const owner = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const setState = useCallback((next: FishMiningState) => { stateRef.current = next; setStateRaw(next); saveMiningState(next); }, []);
  useEffect(() => {
    generation.current++; account.current = o.account; runningRef.current=false; setRunning(false); setAnchorMs(null); setProgress(null);
    const s = load(latest.current.signalsRef.current); stateRef.current = s; setStateRaw(s); setWaiting('');
    // 挖掘库上线前挖到的鱼：从鱼舱补进挖掘库（只补一次）
    void updateMiningLibrary(o.account, library => adoptMinedFish(library, s, latest.current.signalsRef.current, Date.now()));
    return ()=>{generation.current++;if(runningRef.current){cancelTask.current?.();latest.current.stop();}runningRef.current=false;releaseMiningLease(owner.current);};
  }, [o.account]);

  const tick = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    const now = Date.now();let s = load(latest.current.signalsRef.current);
    const resolved=resolveMiningRuleAliases(s.rules,latest.current.defs);
    if(resolved.repairs.length){s={...s,rules:resolved.rules,ruleRepairs:[...(s.ruleRepairs??[]),...resolved.repairs],lastError:'',retryAt:null,errorKind:undefined};setState(s);}
    stateRef.current = s; setStateRaw(s);
    const anchor = miningDueAnchor(s, now);
    if (anchor == null) { setWaiting(''); return; }
    if (navigator.onLine === false) {setWaiting('网络已断开，联网后从当前档自动继续');return;}
    if (s.errorKind==='configuration' && s.lastError) {setWaiting('配置需修正，修正后点「重新检查」');return;}
    if (now < (s.retryAt ?? 0)) return;
    if (latest.current.busy()) { setWaiting('取数器正忙（捕捞 / 复原中），空闲后接着挖'); return; }
    if (!takeMiningLease(owner.current, now)) { setWaiting('另一个标签页正在挖掘'); return; }
    const scope=(s.selection as FishScanSelection|undefined)??latest.current.selection;
    const unsupported=scope.exchanges.find(exchange=>!AUDITED_EXCHANGES.includes(exchange));
    const missing=s.rules.find(rule=>!latest.current.defs.some(def=>def.id===rule.featureId));
    const built = unsupported ? {error:`挖掘范围包含尚未核实的交易所 ${unsupported}，请更新捕捞范围后重新检查`} : missing ? {error:`挖掘算法 ${missing.featureId} 已不存在，请在 Deep Dig 恢复该定义后重新检查`} : buildFishScanSettings({ cards: miningCards(s.rules), defs: latest.current.defs, combination: 'and', selection: scope, time: '', lookbackHours:null });
    if (built.error !== undefined) {
      const failed=miningFailureState(s,built.error,now,'configuration');setState(failed);setWaiting('配置需修正，修正后点「重新检查」');
      void updateMiningLibrary(account.current,library=>recordMiningError(library,failed,anchor,built.error,now));
      releaseMiningLease(owner.current);return;
    }
    runningRef.current = true; runningStop.current=latest.current.stop; setRunning(true); setAnchorMs(anchor); setProgress(null); setWaiting('');
    const who = account.current, epoch=generation.current, token=++runId.current;
    const active=()=>epoch===generation.current&&token===runId.current&&account.current===who;
    const renew = setInterval(() => takeMiningLease(owner.current, Date.now()), TICK_MS);
    let cancelThis:(()=>void)|undefined;
    let advanced = false, lastActivity=Date.now(), watchdog:ReturnType<typeof setInterval> | undefined;
    try {
      const cancelled=new Promise<never>((_,reject)=>{cancelThis=()=>reject(new DOMException('挖掘已暂停','AbortError'));cancelTask.current=cancelThis;});
      const stalled=new Promise<never>((_,reject)=>{watchdog=setInterval(()=>{
        if(active()&&Date.now()-lastActivity>=MINING_STALL_MS){reject(new Error('本档连续 5 分钟没有进度更新，已停止并保留进度；将原地重试'));latest.current.stop();}
      },TICK_MS);});
      const found = await Promise.race([latest.current.mine({ ...built.settings, anchorMs: anchor }, p => {
        if(!active())return;lastActivity=Date.now();setProgress({done:p.done,total:p.total});
      }),stalled,cancelled]);
      if (!active()) return;
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
      if(!active())return;
      if (e instanceof DOMException && e.name === 'AbortError') return; // 让路给捕捞，空闲后原地重扫
      if (e instanceof Error && e.message === '取数器正忙') return;
      const at=Date.now(),failed=miningFailureState(readMiningState(),e instanceof Error?e.message:String(e),at,'transient');
      setState(failed);
      void updateMiningLibrary(who, library => recordMiningError(library, { ...failed, rules: failed.rules.length ? failed.rules : s.rules }, anchor, failed.lastError, at));
    } finally {
      clearInterval(renew);if(watchdog)clearInterval(watchdog);if(cancelTask.current===cancelThis)cancelTask.current=null;
      if(active()){
        runId.current++;runningStop.current=null;releaseMiningLease(owner.current);runningRef.current = false; setRunning(false); setAnchorMs(null); setProgress(null);
        // 补历史时一档接一档连着挖
        if (advanced) setTimeout(() => {if(epoch===generation.current)void tickRef.current();}, 0);
      }
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
    setState({ ...s, enabled: true, rules: s.rules.length ? s.rules : currentDefaultRules(), selection: s.selection ?? { ...latest.current.selection, exchanges: [...latest.current.selection.exchanges] }, retryAt:null,errorKind:undefined }); setTimeout(() => void tickRef.current(), 0);
  }, [setState]);
  const pause = useCallback(() => { setState({ ...readMiningState(), enabled: false }); cancelTask.current?.();latest.current.stop(); }, [setState]);
  const setTarget = useCallback((target: number) => {
    if (!Number.isInteger(target) || target <= 0) return;
    setState({ ...readMiningState(), target }); setTimeout(() => void tickRef.current(), 0);
  }, [setState]);
  const retry=useCallback(()=>{if(runningRef.current)return;start();},[start]);
  const useCurrentScope=useCallback(()=>{
    if(runningRef.current)return;const s=load(latest.current.signalsRef.current);
    setState({...s,selection:structuredClone(latest.current.selection),enabled:true,retryAt:null,errorKind:undefined});
    setTimeout(()=>void tickRef.current(),0);
  },[setState]);
  const resetConfiguration=useCallback(()=>{
    if(runningRef.current)return;const s=load(latest.current.signalsRef.current);
    const rules=currentDefaultRules();
    setState({...s,rules,selection:structuredClone(latest.current.selection),enabled:true,retryAt:null,errorKind:undefined});
    setTimeout(()=>void tickRef.current(),0);
  },[setState]);
  const configure=useCallback((rules:FishMiningState['rules'])=>{
    if(runningRef.current)return;const s=load(latest.current.signalsRef.current);
    setState({...s,rules:structuredClone(rules),enabled:true,retryAt:null,errorKind:undefined});
    setTimeout(()=>void tickRef.current(),0);
  },[setState]);
  const ruleChoices=useMemo(()=>o.defs.map(def=>{try{return {featureId:def.id,label:def.short,statistics:fishStatistics(def)};}catch{return {featureId:def.id,label:def.short,statistics:[]};}}),[o.defs]);
  // 算法编号修过别名后同一条鱼的键会变：再按整行内容（标的、时间、命中算法）认一次
  const holdKeys = useCallback(() => new Set(latest.current.signalsRef.current.filter(s => s.mined).flatMap(s => [fishCatchKey(s), fishVisibleCatchKey(s)])), []);
  return { state, running, anchorMs, progress, waiting, start, pause, retry, useCurrentScope, resetConfiguration, configure, ruleChoices, setTarget, account: o.account, holdKeys };
}
