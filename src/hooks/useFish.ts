import {loadFishSession,saveFishSession} from '@/lib/fish/session';
import { mergeFishSignals, fishDedupKey } from '@/lib/fish/records';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FishScanner, initialFishProgress, combineFishRound, selectFishRound, fishSelectionKey, saveFishCombinationRound, type FishCombinationRound, type FishProgress, type FishScanSettings } from '@/lib/fishScanner';
import { fishRuleText } from '@/lib/fishRule';
import type { FishCombination } from '@/lib/fish/intersection';
import { loadFishSignals, saveFishSignals, FISH_STORAGE_KEY } from '@/lib/fishSignals';
import { type TradeSignal } from '@/lib/signalLibrary';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';

/** 去掉「新鱼」标记（归入「鱼」）。 */
export function withoutFresh(signal: TradeSignal): TradeSignal {
  if (!signal.freshCatch) return signal;
  const { freshCatch: _drop, ...rest } = signal;
  return rest;
}

/** 这一轮写进鱼列表的改动：新加的记录、以及被这一轮改成「新鱼」的原有记录（改之前的样子）。切换交集 / 并集时据此撤销重做。 */
interface RoundWrites { added: Set<string>; refreshed: Map<string, TradeSignal> }
const emptyWrites = (): RoundWrites => ({ added: new Set(), refreshed: new Map() });
/** 把一条捕到的鱼记进列表（标「新鱼」）；没有变化返回 null。同时记下这一轮的改动。 */
function applyCatch(list: TradeSignal[], signal: TradeSignal, writes: RoundWrites): TradeSignal[] | null {
  const key = fishDedupKey(signal);
  const merged = mergeFishSignals(list, [{ ...signal, freshCatch: true }]);
  if (merged.length !== list.length) { writes.added.add(key); return merged; }
  // 已经在列表里（同一标的@时间）：标成新鱼、读数换成这一轮的，评分保留
  const previous = list.find(s => fishDedupKey(s) === key);
  if (!previous || (previous.freshCatch && JSON.stringify(previous.fish) === JSON.stringify(signal.fish) && previous.binanceSymbol === signal.binanceSymbol)) return null;
  if (!writes.added.has(key) && !writes.refreshed.has(key)) writes.refreshed.set(key, previous);
  return list.map(s => s === previous ? { ...s, fish: signal.fish, binanceSymbol: signal.binanceSymbol, freshCatch: true } : s);
}

// Shared across TimeControl instances and panel remounts in this browser page.
let pageScanner: FishScanner | null = null;

export function useFish(userId: string | undefined) {
  const [signals, setSignals] = useState(loadFishSignals);
  const signalsRef = useRef(signals); signalsRef.current = signals;
  const ownerRef = useRef(userId); ownerRef.current = userId;
  const scanner = useRef<FishScanner | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<FishProgress | null>(null);
  const writesRef = useRef<RoundWrites>(emptyWrites());
  const roundRef = useRef<{ data: FishCombinationRound; mode: FishCombination; keys:string[] } | null>(null);
  const [hasRound,setHasRound]=useState(false);
  const generation=useRef(0);
  const edits=useRef(new Map<string,{signal?:TradeSignal;deleted?:boolean}>());
  const progressRef=useRef(progress);progressRef.current=progress;
  const persist=useCallback(()=>{const r=roundRef.current,owner=ownerRef.current,version=generation.current;if(r)void saveFishSession(owner,{...r,added:[...writesRef.current.added],refreshed:[...writesRef.current.refreshed],edits:[...edits.current],progress:progressRef.current}).catch(()=>{if(owner===ownerRef.current&&version===generation.current)setProgress(p=>p?{...p,notice:'本机结果保存失败，刷新后需要重新捕捞'}:p);});},[]);
  const commit = useCallback((next: TradeSignal[]) => {
    if(roundRef.current&&!controller.current){
      const before=new Map(signalsRef.current.map(s=>[fishDedupKey(s),s]));
      const after=new Map(next.map(s=>[fishDedupKey(s),s]));
      for(const key of new Set([...writesRef.current.added,...writesRef.current.refreshed.keys()])){
        if(before.has(key)&&!after.has(key))edits.current.set(key,{deleted:true});
        else if(before.get(key)!==after.get(key)&&after.has(key))edits.current.set(key,{signal:after.get(key)});
      }
    }
    signalsRef.current = next; setSignals(next); saveFishSignals(next, ownerRef.current ?? null);
    persist();
  }, [persist]);
  useEffect(() => {
    const refresh = () => { const next = loadFishSignals(); signalsRef.current = next; setSignals(next); };
    refresh(); setProgress(null);roundRef.current=null;writesRef.current=emptyWrites();edits.current.clear();setHasRound(false);
    const version=++generation.current;
    void loadFishSession(userId).then(saved=>{if(!saved||version!==generation.current)return;roundRef.current={data:saved.data,mode:saved.mode,keys:['pending']};writesRef.current={added:new Set(saved.added),refreshed:new Map(saved.refreshed)};edits.current=new Map(saved.edits);progressRef.current=saved.progress;setProgress(saved.progress);recombineRef.current?.(saved.mode,saved.keys);setHasRound(true);}).catch(()=>{});
    const unsubscribe = subscribePersistedStateHydration(FISH_STORAGE_KEY, refresh);
    const storage = (e: StorageEvent) => { if (e.key === FISH_STORAGE_KEY || e.key === null) refresh(); };
    window.addEventListener('storage', storage);
    return () => { ++generation.current; controller.current?.abort(); controller.current = null; scanner.current = null; unsubscribe(); window.removeEventListener('storage', storage); };
  }, [userId]);
  const recombineRef=useRef<((mode:FishCombination,keys:readonly string[])=>boolean)|null>(null);
  const start = useCallback(async (settings: FishScanSettings = {}) => {
    if (controller.current) return;
    ++generation.current;roundRef.current=null;setHasRound(false);edits.current.clear();void saveFishSession(ownerRef.current,null).catch(()=>{});
    // 上一轮的新鱼归入「鱼」，这一轮捕到的（含以前捕到过、这轮又命中的）放进「新鱼」
    if (signalsRef.current.some(s => s.freshCatch)) commit(signalsRef.current.map(withoutFresh));
    writesRef.current = emptyWrites(); roundRef.current = null;
    scanner.current ??= pageScanner ??= new FishScanner();
    const mine = new AbortController(); controller.current = mine;
    const owner = ownerRef.current;
    const valid = () => controller.current === mine && ownerRef.current === owner;
    try {
      await scanner.current.scan({ ...settings, signal: mine.signal,
        onProgress: value => { if (valid()) {progressRef.current=value;setProgress(value);} },
        onSignal: signal => {
          if (valid() && !mine.signal.aborted) { const next = applyCatch(signalsRef.current, signal, writesRef.current); if (next) commit(next); }
        },
        onRound: round => { if (valid()) {roundRef.current = { data: round, mode: settings.combination ?? 'and',keys:settings.retainMembers?['pending']:round.plans.map(fishSelectionKey) };setHasRound(true);} },
      });
    } catch (error) {
      if (valid()) setProgress({ ...initialFishProgress(), status: 'aborted', error: error instanceof Error ? error.message : String(error) });
    } finally { if (controller.current === mine) {controller.current = null;const r=roundRef.current;if(r&&settings.retainMembers)recombineRef.current?.(settings.combination??'and',settings.displayAlgorithmKeys??r.data.plans.map(fishSelectionKey));persist();} }
  }, [commit,persist]);
  const estimate=useCallback(async(settings:FishScanSettings,signal:AbortSignal)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return typeof scanner.current.estimateMarkets==='function'?scanner.current.estimateMarkets(settings,signal):null;
  },[]);
  const suggest=useCallback(async(options:import('@/lib/fish/suggestions').FishSuggestionOptions)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.suggest(options);
  },[]);
  const reconstruct=useCallback(async(options:import('@/lib/fish/reconstruction').FishReconstructionOptions)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.reconstruct(options);
  },[]);
  const cancel = useCallback(() => controller.current?.abort(), []);
  /**
   * 任选本轮算法子集与交集 / 并集：用保存的逐币结论直接重新合并，「新鱼」换成另一种结果，不用重扫。
   * 先撤掉这一轮写进列表的改动（新加的删掉、被改成新鱼的恢复原样），再按新方式写入。算法设置变了（键对不上）就不切换。
   * 【用户要求】2026-10-20「并集这里捕捉完之后，我希望当我点击交集的时候，可以灵活切换到交集的结果」。
   */
  const recombine = useCallback((mode: FishCombination, algorithmKeys: readonly string[]): boolean => {
    const round = roundRef.current;
    if (!round || controller.current) return false;
    const selected=selectFishRound(round.data,algorithmKeys);if(!selected)return false;
    const same=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
    if(round.mode===mode&&same(round.keys,algorithmKeys))return true;
    const undo = writesRef.current;
    let list = signalsRef.current.filter(s => !undo.added.has(fishDedupKey(s))).map(s => {const old=undo.refreshed.get(fishDedupKey(s));return old?{...old,quality:s.quality}:s;});
    const writes = emptyWrites(), { signals: combined, counts } = combineFishRound(selected, mode);
    for (const raw of combined) { const edit=edits.current.get(fishDedupKey(raw));if(edit?.deleted)continue;const signal=edit?.signal?{...raw,quality:edit.signal.quality}:raw; const next = applyCatch(list, signal, writes); if (next) list = next; }
    writesRef.current = writes; roundRef.current = { ...round, mode,keys:[...algorithmKeys] };
    signalsRef.current=list;setSignals(list);saveFishSignals(list,ownerRef.current??null);
    saveFishCombinationRound(selected, mode);
    const rule = selected.plans.map(p => fishRuleText(p.def, p.settings.direction, p.settings.threshold, p.texts.length, p.settings.statistic)).join(mode === 'or' ? ' 或 ' : ' 且 ');
    const previous=progressRef.current;
    if(previous){const next={...previous,rule,algorithmHits:selected.memberHits,cutoffMs:selected.plans[0]?Math.floor(selected.anchorMs/selected.plans[0].step)*selected.plans[0].step:previous.cutoffMs,counts:{...previous.counts,hit:combined.length,unknown:counts.unknown??0}};progressRef.current=next;setProgress(next);}
    persist();return true;
  }, [persist]);
  recombineRef.current=recombine;
  /** 查单个币（不入库）：与捕捞同一套取数与判定。 */
  const diagnose = useCallback((options: Parameters<FishScanner['diagnose']>[0]) => {
    scanner.current ??= pageScanner ??= new FishScanner();
    return scanner.current.diagnose(options);
  }, []);
  return { signals, signalsRef, commit, progress, start, cancel, estimate, diagnose, suggest, reconstruct, recombine, hasRound };
}
