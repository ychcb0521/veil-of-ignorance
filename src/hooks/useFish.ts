import {loadFishSession,saveFishSession} from '@/lib/fish/session';
import { archiveFishForNextRound, collapseVisibleFish, mergeFishSignals, fishCatchKey, fishDedupKey, fishVisibleCatchKey } from '@/lib/fish/records';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FishScanner, initialFishProgress, combineFishRound, selectFishRound, deriveFishRound, saveFishMemberRound, fishSelectionKey, saveFishCombinationRound, type FishCombinationRound, type FishProgress, type FishScanSettings } from '@/lib/fishScanner';
import type { FishProgram } from '@/lib/fish/algorithm';
import { fishRuleText } from '@/lib/fishRule';
import type { FishCombination } from '@/lib/fish/intersection';
import { backupFishSignals, restoreFishSignals, loadFishSignals, loadFishTombstones, saveFishSignals, recordFishDeletion, FISH_STORAGE_KEY, FISH_DELETED_KEY } from '@/lib/fishSignals';
import { loadFishLibraryBackup } from '@/lib/fish/libraryStore';
import { applyFishTombstones } from '@/lib/fish/tombstones';
import { type TradeSignal } from '@/lib/signalLibrary';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';

/** 去掉「新鱼」标记（归入「鱼舱」）。 */
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
  // 记下捕到的时刻：之前的删除记号压不住这次新捕到的（见 fish/tombstones.ts）
  const past = list.filter(s => fishCatchKey(s) === fishCatchKey(signal));
  const archivedAt = Math.max(0, ...past.map(s => s.fishArchive?.at ?? 0));
  const caughtAt = Math.max(Date.now(), archivedAt + 1);
  const rated = list.filter(s=>fishVisibleCatchKey(s)===fishVisibleCatchKey(signal)).sort((a,b)=>(b.caughtAt??0)-(a.caughtAt??0)).find(s=>s.quality!==undefined);
  const merged = mergeFishSignals(list, [{ ...signal, quality: signal.quality ?? rated?.quality, freshCatch: true, caughtAt }]);
  if (merged.length !== list.length) { writes.added.add(key); return merged; }
  // 已经在列表里（同一标的@时间）：标成新鱼、读数换成这一轮的，评分保留
  const previous = list.find(s => fishDedupKey(s) === key);
  if (!previous || (previous.freshCatch && JSON.stringify(previous.fish) === JSON.stringify(signal.fish) && previous.binanceSymbol === signal.binanceSymbol)) return null;
  if (!writes.added.has(key) && !writes.refreshed.has(key)) writes.refreshed.set(key, previous);
  return list.map(s => s === previous ? { ...s, fish: signal.fish, binanceSymbol: signal.binanceSymbol, freshCatch: true, caughtAt } : s);
}

// Shared across TimeControl instances and panel remounts in this browser page.
let pageScanner: FishScanner | null = null;

/** onCaught：每轮捕捞结束（手动或自动）时，这一轮第一次捕到的鱼，以及邮件要发的那张表（本轮所选算法的并集，见 unionFish）。 */
export function useFish(userId: string | undefined, options: { onCaught?: (fish: TradeSignal[], mail: TradeSignal[]) => void } = {}) {
  const onCaughtRef = useRef(options.onCaught); onCaughtRef.current = options.onCaught;
  const [signals, setSignals] = useState(loadFishSignals);
  const signalsRef = useRef(signals); signalsRef.current = signals;
  const ownerRef = useRef(userId); ownerRef.current = userId;
  const scanner = useRef<FishScanner | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<FishProgress | null>(null);
  const writesRef = useRef<RoundWrites>(emptyWrites());
  const roundRef = useRef<{ data: FishCombinationRound; mode: FishCombination; keys:string[] } | null>(null);
  const [hasRound,setHasRound]=useState(false);
  /** 本轮实际扫过的算法（含当时的阈值）：面板据此说明哪些改动能当场重判、哪些要重新捕捞。 */
  const [roundPlans,setRoundPlans]=useState<FishProgram[]|null>(null);
  const generation=useRef(0);
  const recoveryArchiveBefore=useRef<number>();
  const edits=useRef(new Map<string,{signal?:TradeSignal;deleted?:boolean}>());
  // 捕捞中可改的交集 / 并集，以及本轮逐币结论（扫描时逐步填满）
  const combinationRef=useRef<FishCombination>('and');
  const liveRef=useRef<{round:FishCombinationRound;keys?:readonly string[]}|null>(null);
  const progressRef=useRef(progress);progressRef.current=progress;
  const persist=useCallback(()=>{const r=roundRef.current,owner=ownerRef.current,version=generation.current;if(r)void saveFishSession(owner,{...r,added:[...writesRef.current.added],refreshed:[...writesRef.current.refreshed],edits:[...edits.current],progress:progressRef.current}).catch(()=>{if(owner===ownerRef.current&&version===generation.current)setProgress(p=>p?{...p,notice:'本机结果保存失败，刷新后需要重新捕捞'}:p);});},[]);
  const commit = useCallback((input: TradeSignal[]) => {
    // 整行显示相同的（同一信号、不同算法键）只留一条
    const next = collapseVisibleFish(input);
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
    let cancelled = false;
    recoveryArchiveBefore.current = undefined;
    const refresh = () => { const next = loadFishSignals(); signalsRef.current = next; setSignals(next); backupFishSignals(next, userId ?? null); };
    refresh(); setProgress(null);roundRef.current=null;writesRef.current=emptyWrites();edits.current.clear();setHasRound(false);setRoundPlans(null);
    const version=++generation.current;
    void loadFishLibraryBackup(userId).then(backup => {
      if (cancelled || ownerRef.current !== userId) return;
      const next = restoreFishSignals(backup, signalsRef.current, userId ?? null, recoveryArchiveBefore.current);
      signalsRef.current = next; setSignals(next);
      return loadFishSession(userId);
    }).then(saved=>{if(!saved||cancelled||version!==generation.current)return;if(saved.needsRescan){setProgress({...(saved.progress??initialFishProgress()),status:'complete',notice:saved.needsRescan});return;}roundRef.current={data:saved.data,mode:saved.mode,keys:['pending']};writesRef.current={added:new Set(saved.added),refreshed:new Map(saved.refreshed)};edits.current=new Map(saved.edits);progressRef.current=saved.progress;setProgress(saved.progress);recombineRef.current?.(saved.mode,saved.keys);setHasRound(true);setRoundPlans(saved.data.plans);}).catch(()=>{});
    const unsubscribe = subscribePersistedStateHydration(FISH_STORAGE_KEY, refresh), unsubscribeDeleted = subscribePersistedStateHydration(FISH_DELETED_KEY, refresh);
    const storage = (e: StorageEvent) => { if (e.key === FISH_STORAGE_KEY || e.key === FISH_DELETED_KEY || e.key === null) refresh(); };
    window.addEventListener('storage', storage);
    return () => { cancelled = true; ++generation.current; controller.current?.abort(); controller.current = null; scanner.current = null; unsubscribe(); unsubscribeDeleted(); window.removeEventListener('storage', storage); };
  }, [userId]);
  const recombineRef=useRef<((mode:FishCombination,keys:readonly string[],plans?:readonly FishProgram[])=>boolean)|null>(null);
  const start = useCallback(async (settings: FishScanSettings = {}) => {
    if (controller.current) return;
    // Move the previous round immediately. Background persistence must never gate market scanning.
    const at = Date.now();
    recoveryArchiveBefore.current ??= at;
    const archived = archiveFishForNextRound(signalsRef.current, at);
    if (archived !== signalsRef.current) {
      signalsRef.current = archived; setSignals(archived);
      saveFishSignals(archived, ownerRef.current ?? null);
    }
    ++generation.current;roundRef.current=null;setHasRound(false);setRoundPlans(null);edits.current.clear();void saveFishSession(ownerRef.current,null).catch(()=>{});
    writesRef.current = emptyWrites(); roundRef.current = null;
    scanner.current ??= pageScanner ??= new FishScanner();
    combinationRef.current = settings.combination ?? 'and'; liveRef.current = null;
    const mine = new AbortController(); controller.current = mine;
    const owner = ownerRef.current;
    const valid = () => controller.current === mine && ownerRef.current === owner;
    try {
      await scanner.current.scan({ ...settings, signal: mine.signal, combinationRef,
        onLiveRound: round => { if (valid()) liveRef.current = { round, keys: settings.displayAlgorithmKeys }; },
        onProgress: value => { if (valid()) {progressRef.current=value;setProgress(value);} },
        onSignal: signal => {
          if (valid() && !mine.signal.aborted) { const next = applyCatch(signalsRef.current, signal, writesRef.current); if (next) commit(next); }
        },
        onRound: round => { if (valid()) {roundRef.current = { data: round, mode: combinationRef.current,keys:settings.retainMembers?['pending']:round.plans.map(fishSelectionKey) };setHasRound(true);setRoundPlans(round.plans);} },
      });
    } catch (error) {
      if (valid()) setProgress({ ...initialFishProgress(), status: 'aborted', error: error instanceof Error ? error.message : String(error) });
    } finally { if (controller.current === mine) {controller.current = null;liveRef.current=null;const r=roundRef.current;if(r&&settings.retainMembers)recombineRef.current?.(combinationRef.current,settings.displayAlgorithmKeys??r.data.plans.map(fishSelectionKey));persist();
      // 每轮结束把新鱼列表交给邮件提醒（有没有变化由提醒那边比对上一封）；切换交集 / 并集、调严阈值不会走到这里
      if(ownerRef.current===owner){const added=writesRef.current.added,caught=signalsRef.current.filter(s=>added.has(fishDedupKey(s))),mail=unionRef.current();if(caught.length||mail.length)onCaughtRef.current?.(caught,mail);}
    } }
  }, [commit,persist]);
  const estimate=useCallback(async(settings:FishScanSettings,signal:AbortSignal)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return typeof scanner.current.estimateMarkets==='function'?scanner.current.estimateMarkets(settings,signal):null;
  },[]);
  const suggest=useCallback(async(options:import('@/lib/fish/suggestions').FishSuggestionOptions)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.suggest(options);
  },[]);
  /** 信号库成交额统计（不入库）：与建议区间同一个取数器，捕捞时不能同时跑。 */
  const turnover=useCallback(async(options:import('@/lib/signalTurnover').SignalTurnoverOptions)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.turnover(options);
  },[]);
  const reconstruct=useCallback(async(options:import('@/lib/fish/reconstruction').FishReconstructionOptions)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.reconstruct(options);
  },[]);
  const cancel = useCallback(() => controller.current?.abort(), []);
  /** 是否有捕捞 / 建议 / 复原等在用取数器（定时自动捕捞据此等待）。 */
  const busy = useCallback(() => !!controller.current || !!(scanner.current ?? pageScanner)?.isBusy(), []);
  /**
   * 任选本轮算法子集与交集 / 并集：用保存的逐币结论直接重新合并，「新鱼」换成另一种结果，不用重扫。
   * 先撤掉这一轮写进列表的改动（新加的删掉、被改成新鱼的恢复原样），再按新方式写入。
   * 传了 plans（当前卡片编译好的算法）时，阈值只往严里调了的卡用本轮留下的读数当场重判（deriveFishRound）；其余设置变了就不切换。
   * 【用户要求】2026-10-20「并集这里捕捉完之后，我希望当我点击交集的时候，可以灵活切换到交集的结果」。
   */
  const recombine = useCallback((mode: FishCombination, algorithmKeys: readonly string[], plans?: readonly FishProgram[]): boolean => {
    const round = roundRef.current;
    if (!round || controller.current) return false;
    const selected=selectFishRound(round.data,algorithmKeys)??(plans?deriveFishRound(round.data,plans):null);if(!selected)return false;
    const same=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
    if(round.mode===mode&&same(round.keys,algorithmKeys))return true;
    const undo = writesRef.current;
    // 【用户要求】2026-10-21「鱼那里的数据只要没删除，就一直要保存，不能轻易删除」：换口径时这一轮捕到、新口径不要的鱼不再丢掉，
    // 移进「鱼」留着（以前是直接从列表拿掉）；只有用户手动删除才会删
    let list = signalsRef.current.map(s => {const k=fishDedupKey(s);if(undo.added.has(k))return withoutFresh(s);const old=undo.refreshed.get(k);return old?{...old,quality:s.quality}:s;});
    const writes = emptyWrites(), { signals: combined, counts } = combineFishRound(selected, mode);
    for (const raw of combined) { const edit=edits.current.get(fishDedupKey(raw));if(edit?.deleted)continue;const signal=edit?.signal?{...raw,quality:edit.signal.quality}:raw; const next = applyCatch(list, signal, writes); if (next) list = next; }
    writesRef.current = writes; roundRef.current = { ...round, mode,keys:[...algorithmKeys] };
    list=collapseVisibleFish(list);
    signalsRef.current=list;setSignals(list);saveFishSignals(list,ownerRef.current??null);
    saveFishCombinationRound(selected, mode);
    selected.plans.forEach((p,j)=>{if(!round.data.plans.includes(p))saveFishMemberRound(selected,j);});
    const rule = selected.plans.map(p => fishRuleText(p.def, p.settings.direction, p.settings.threshold, p.texts.length, p.settings.statistic)).join(mode === 'or' ? ' 或 ' : ' 且 ');
    const previous=progressRef.current;
    if(previous){const next={...previous,rule,algorithmHits:selected.memberHits,cutoffMs:selected.plans[0]?Math.floor(selected.anchorMs/selected.plans[0].step)*selected.plans[0].step:previous.cutoffMs,counts:{...previous.counts,hit:combined.length,unknown:counts.unknown??0}};progressRef.current=next;setProgress(next);}
    persist();return true;
  }, [persist]);
  recombineRef.current=recombine;
  /**
   * 捕捞中切换交集 / 并集：之后判完的币按新组合出；已判完的当场按新组合重排「新鱼」（本轮刚进来、新组合不要的移进「鱼」，不丢）。
   * 【用户要求】2026-10-21「我希望捕捞运行的过程中，我也可以灵活切换到并集」。没在捕捞时返回 false（由 recombine 处理）。
   */
  const switchLive = useCallback((mode: FishCombination): boolean => {
    if (!controller.current) return false;
    combinationRef.current = mode;
    const live = liveRef.current;
    if (!live) return true;
    const picked = (live.keys && selectFishRound(live.round, live.keys)) || live.round;
    const undo = writesRef.current;
    let list = signalsRef.current.map(s => {const k=fishDedupKey(s);if(undo.added.has(k))return withoutFresh(s);const old=undo.refreshed.get(k);return old?{...old,quality:s.quality}:s;});
    const writes = emptyWrites();
    const combined = combineFishRound(picked, mode).signals;
    for (const raw of combined) { if (edits.current.get(fishDedupKey(raw))?.deleted) continue; const next = applyCatch(list, raw, writes); if (next) list = next; }
    writesRef.current = writes;
    list = collapseVisibleFish(list);
    signalsRef.current = list; setSignals(list); saveFishSignals(list, ownerRef.current ?? null);
    // 规则文字与命中数当场换过来（扫描下一次报进度时也会按新组合算）
    const prev = progressRef.current;
    if (prev) { const next = { ...prev, rule: prev.rule?.split(mode === 'or' ? ' 且 ' : ' 或 ').join(mode === 'or' ? ' 或 ' : ' 且 '), counts: { ...prev.counts, hit: combined.length } }; progressRef.current = next; setProgress(next); }
    return true;
  }, []);
  /**
   * 邮件用的鱼：本轮所选算法的并集（任一算法命中就算），不管面板上选的是交集还是并集；没有本轮结果时用「新鱼」列表。
   * 【用户要求】2026-10-21「我希望发邮件时，默认为并集里的鱼」。用户删过的不发；整行显示相同的只留一条。
   */
  const unionFish = useCallback((): TradeSignal[] => {
    const r = roundRef.current;
    if (!r) return signalsRef.current.filter(s => s.freshCatch);
    const picked = (r.keys[0] !== 'pending' && selectFishRound(r.data, r.keys)) || r.data;
    const list = combineFishRound(picked, 'or').signals.filter(s => !edits.current.get(fishDedupKey(s))?.deleted);
    return collapseVisibleFish(applyFishTombstones(list, loadFishTombstones()));
  }, []);
  const unionRef = useRef(unionFish); unionRef.current = unionFish;
  /**
   * 用户手动删除一条鱼：记删除记号（跨设备同步，别处的旧副本带不回来），再从列表里去掉。
   * 【用户要求】2026-10-20「渔部分的鱼只要没删除，就一直保留」——只有这里算删除。
   */
  const remove = useCallback((id: string) => {
    const gone = signalsRef.current.filter(s => s.id === id);
    if (!gone.length) return;
    recordFishDeletion(gone, ownerRef.current ?? null);
    commit(signalsRef.current.filter(s => s.id !== id));
  }, [commit]);
  /** 查单个币（不入库）：与捕捞同一套取数与判定。 */
  const diagnose = useCallback((options: Parameters<FishScanner['diagnose']>[0]) => {
    scanner.current ??= pageScanner ??= new FishScanner();
    return scanner.current.diagnose(options);
  }, []);
  return { switchLive, unionFish, signals, signalsRef, commit, progress, start, cancel, estimate, diagnose, suggest, reconstruct, recombine, hasRound, roundPlans, turnover, remove, busy };
}
