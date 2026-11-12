import {loadFishSession,saveFishSession} from '@/lib/fish/session';
import { archiveFishForNextRound, collapseVisibleFish, mergeFishSignals, fishCatchKey, fishDedupKey, fishVisibleCatchKey } from '@/lib/fish/records';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FishScanner, initialFishProgress, combineFishRound, selectFishRound, deriveFishRound, saveFishMemberRound, fishSelectionKey, saveFishCombinationRound, type FishCombinationRound, type FishProgress, type FishScanSettings } from '@/lib/fishScanner';
import type { OnScreenedCdaRead, ScreenedCdaTask } from '@/lib/fish/screenedCda';
import type { FishProgram, FishSnapshot } from '@/lib/fish/algorithm';
import { runFishHitRate, type FishHitRateOptions } from '@/lib/fish/hitRate';
import { fishDelay } from '@/lib/fish/shared';
import { fishRuleText } from '@/lib/fishRule';
import type { FishCombination } from '@/lib/fish/intersection';
import { backupFishSignals, restoreFishSignals, loadFishSignals, loadFishTombstones, saveFishSignals, recordFishDeletion, FISH_STORAGE_KEY, FISH_DELETED_KEY } from '@/lib/fishSignals';
import { loadFishLibraryBackup } from '@/lib/fish/libraryStore';
import { applyFishTombstones } from '@/lib/fish/tombstones';
import {mergeFishLists} from '@/lib/fish/tombstones';
import {fishSignalInRoundWindow,reconcileFreshFish,type FishRoundWindow} from '@/lib/fish/roundWindow';
import { signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
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
/** Survive control remounts; keys include the account, anchor and frozen rules. */
const pageMiningCheckpoint: { current: { key: string; results: import('@/lib/fishScanner').FishScanCheckpoint } | null } = { current: null };
/** Independent of TimeControl's lifetime so a quality batch can finish on other routes. */
export async function runPageFishQuality(options: import('@/lib/fish/quality').QualityRunOptions): Promise<void> {
  pageScanner ??= new FishScanner();
  await pageScanner.quality(options);
}

export async function readPageScreenedCda(tasks: readonly ScreenedCdaTask[], snapshot: FishSnapshot, target: number,
  signal: AbortSignal, onRead: OnScreenedCdaRead): Promise<void> {
  pageScanner ??= new FishScanner();
  await pageScanner.trackScreenedCda(tasks, snapshot, target, signal, onRead);
}

export function useFish(userId: string | undefined, options: { onNewFish?: (fish: TradeSignal) => void } = {}) {
  const onNewFish = useRef(options.onNewFish); onNewFish.current = options.onNewFish;
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
  const captureWindow=useRef<FishRoundWindow|null>(null);
  const reconcile=useCallback((list:TradeSignal[])=>reconcileFreshFish(list,captureWindow.current?new Set([...writesRef.current.added,...writesRef.current.refreshed.keys()]):null,captureWindow.current??undefined),[]);
  const persist=useCallback(()=>{const r=roundRef.current,owner=ownerRef.current,version=generation.current;if(r)void saveFishSession(owner,{...r,added:[...writesRef.current.added],refreshed:[...writesRef.current.refreshed],edits:[...edits.current],progress:progressRef.current}).catch(()=>{if(owner===ownerRef.current&&version===generation.current)setProgress(p=>p?{...p,notice:'本机结果保存失败，刷新后需要重新捕捞'}:p);});},[]);
  const commit = useCallback((input: TradeSignal[]) => {
    // 整行显示相同的（同一信号、不同算法键）只留一条
    const next = collapseVisibleFish(reconcile(input));
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
  }, [persist,reconcile]);
  useEffect(() => {
    let cancelled = false;
    recoveryArchiveBefore.current = undefined;captureWindow.current=null;progressRef.current=null;
    const refresh = (merge=true) => {const loaded=loadFishSignals(),next=reconcile(merge?mergeFishLists(signalsRef.current,loaded,loadFishTombstones()):loaded);signalsRef.current=next;setSignals(next);};
    const hydrated = () => { refresh(); backupFishSignals(signalsRef.current, userId ?? null); };
    // Read the durable library before mirroring a possibly stale localStorage cache into it.
    refresh(false); setProgress(null);roundRef.current=null;writesRef.current=emptyWrites();edits.current.clear();setHasRound(false);setRoundPlans(null);
    const version=++generation.current;
    void loadFishLibraryBackup(userId).then(backup => {
      if (cancelled || ownerRef.current !== userId) return;
      const next = restoreFishSignals(backup, signalsRef.current, userId ?? null, recoveryArchiveBefore.current);
      const recovered=reconcile(next);signalsRef.current = recovered; setSignals(recovered);
      return loadFishSession(userId);
    }).then(saved=>{if(!saved||cancelled||version!==generation.current)return;captureWindow.current={anchorMs:saved.data?.anchorMs,lookbackHours:saved.data?.lookbackHours};if(saved.needsRescan){const next={...(saved.progress??initialFishProgress()),status:'complete' as const,notice:saved.needsRescan};progressRef.current=next;setProgress(next);signalsRef.current=reconcile(signalsRef.current);setSignals(signalsRef.current);return;}roundRef.current={data:saved.data,mode:saved.mode,keys:['pending']};writesRef.current={added:new Set(saved.added),refreshed:new Map(saved.refreshed)};edits.current=new Map(saved.edits);progressRef.current=saved.progress;setProgress(saved.progress);signalsRef.current=reconcile(signalsRef.current);setSignals(signalsRef.current);recombineRef.current?.(saved.mode,saved.keys);setHasRound(true);setRoundPlans(saved.data.plans);}).catch(()=>{});
    const unsubscribe = subscribePersistedStateHydration(FISH_STORAGE_KEY, hydrated), unsubscribeDeleted = subscribePersistedStateHydration(FISH_DELETED_KEY, hydrated);
    const storage = (e: StorageEvent) => { if (e.key === FISH_STORAGE_KEY || e.key === FISH_DELETED_KEY || e.key === null) hydrated(); };
    window.addEventListener('storage', storage);
    return () => { cancelled = true; ++generation.current; controller.current?.abort(); controller.current = null; mineController.current?.abort(); scanner.current = null; unsubscribe(); unsubscribeDeleted(); window.removeEventListener('storage', storage); };
  }, [userId,reconcile]);
  const recombineRef=useRef<((mode:FishCombination,keys:readonly string[],plans?:readonly FishProgram[])=>boolean)|null>(null);
  const hitRateBusy = useRef(false);
  const start = useCallback(async (settings: FishScanSettings = {}) => {
    if (controller.current || hitRateBusy.current) return;
    // 持续挖掘让路：先打断这一档，等取数器空出来（这一档之后原地重扫）
    if (mineController.current) { mineController.current.abort(); await minePromise.current?.catch(() => undefined); if (controller.current || hitRateBusy.current) return; }
    // Move the previous round immediately. Background persistence must never gate market scanning.
    const at = Date.now();
    recoveryArchiveBefore.current ??= at;
    const archived = collapseVisibleFish(archiveFishForNextRound(signalsRef.current, at));
    if (archived !== signalsRef.current) {
      signalsRef.current = archived; setSignals(archived);
      saveFishSignals(archived, ownerRef.current ?? null);
    }
    ++generation.current;roundRef.current=null;setHasRound(false);setRoundPlans(null);edits.current.clear();void saveFishSession(ownerRef.current,null).catch(()=>{});
    writesRef.current = emptyWrites(); roundRef.current = null;
    captureWindow.current={anchorMs:settings.anchorMs,lookbackHours:settings.lookbackHours};
    const starting={...initialFishProgress(),anchorMs:settings.anchorMs??null,lookbackHours:settings.lookbackHours};progressRef.current=starting;setProgress(starting);
    scanner.current ??= pageScanner ??= new FishScanner();
    combinationRef.current = settings.combination ?? 'and'; liveRef.current = null;
    const mine = new AbortController(); controller.current = mine;
    const owner = ownerRef.current;
    const knownSignals = new Set(signalsRef.current.map(signalDedupKey));
    const valid = () => controller.current === mine && ownerRef.current === owner;
    try {
      await scanner.current.scan({ ...settings, signal: mine.signal, combinationRef,
        onLiveRound: round => { if (valid()) liveRef.current = { round, keys: settings.displayAlgorithmKeys }; },
        onProgress: value => { if (valid()) {captureWindow.current={anchorMs:value.anchorMs??settings.anchorMs,lookbackHours:settings.lookbackHours};progressRef.current=value;setProgress(value);} },
        onSignal: signal => {
          if (valid() && !mine.signal.aborted && fishSignalInRoundWindow(signal, captureWindow.current ?? undefined)) {
            const key = fishDedupKey(signal);
            const next = applyCatch(signalsRef.current, signal, writesRef.current);
            if (!next) return;
            commit(next);
            const identity = signalDedupKey(signal);
            if (!knownSignals.has(identity) && writesRef.current.added.has(key)) {
              const caught = next.find(source => fishDedupKey(source) === key);
              if (caught) {
                knownSignals.add(identity);
                onNewFish.current?.(caught);
              }
            }
          }
        },
        onRound: round => { if (valid()) {roundRef.current = { data: round, mode: combinationRef.current,keys:settings.retainMembers?['pending']:round.plans.map(fishSelectionKey) };setHasRound(true);setRoundPlans(round.plans);} },
      });
    } catch (error) {
      if (valid()){const next={...initialFishProgress(),status:'aborted' as const,error:error instanceof Error?error.message:String(error)};progressRef.current=next;setProgress(next);}
    } finally { if (controller.current === mine) {controller.current = null;liveRef.current=null;const r=roundRef.current;if(r&&settings.retainMembers)recombineRef.current?.(combinationRef.current,settings.displayAlgorithmKeys??r.data.plans.map(fishSelectionKey));persist();
    } }
  }, [commit,persist]);
  const estimate=useCallback(async(settings:FishScanSettings,signal:AbortSignal)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return typeof scanner.current.estimateMarkets==='function'?scanner.current.estimateMarkets(settings,signal):null;
  },[]);
  const suggest=useCallback(async(options:import('@/lib/fish/suggestions').FishSuggestionOptions)=>{
    if (hitRateBusy.current) throw new Error('漏报测试进行中，请在测试结束后再试');
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.suggest(options);
  },[]);
  /** 信号库成交额统计（不入库）：与建议区间同一个取数器，捕捞时不能同时跑。 */
  const turnover=useCallback(async(options:import('@/lib/signalTurnover').SignalTurnoverOptions)=>{
    if (hitRateBusy.current) throw new Error('漏报测试进行中，请在测试结束后再试');
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.turnover(options);
  },[]);
  const reconstruct=useCallback(async(options:import('@/lib/fish/reconstruction').FishReconstructionOptions)=>{
    if (hitRateBusy.current) throw new Error('漏报测试进行中，请在测试结束后再试');
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.reconstruct(options);
  },[]);
  const quality=useCallback(async(options:import('@/lib/fish/quality').QualityRunOptions)=>{
    scanner.current??=pageScanner??=new FishScanner();
    return scanner.current.quality(options);
  },[]);
  const cancel = useCallback(() => controller.current?.abort(), []);
  /** 是否有捕捞 / 建议 / 复原等在用取数器（定时自动捕捞据此等待）。持续挖掘不算：捕捞一开始就会打断它。 */
  const busy = useCallback(() => hitRateBusy.current || !!controller.current || (!mineController.current && !!(scanner.current ?? pageScanner)?.isBusy()), []);
  /**
   * 持续挖掘扫一档：不动「新鱼」、不发邮件、不留本轮摘要，只把命中的鱼交回去（由挖掘决定怎么入舱）。
   * 取数器正被别的任务占着时抛错；被捕捞打断时抛 AbortError。
   */
  const mineController = useRef<AbortController | null>(null), minePromise = useRef<Promise<unknown> | null>(null);
  const miningCheckpoint = pageMiningCheckpoint;
  const mine = useCallback(async (settings: FishScanSettings, onProgress?: (p: FishProgress) => void, roundId?: string): Promise<TradeSignal[]> => {
    const sc = (scanner.current ??= pageScanner ??= new FishScanner());
    if (controller.current || mineController.current || hitRateBusy.current || sc.isBusy()) throw new Error('取数器正忙');
    const mine = new AbortController(); mineController.current = mine;
    const checkpointKey = JSON.stringify([ownerRef.current, roundId, settings]);
    if (miningCheckpoint.current?.key !== checkpointKey) miningCheckpoint.current = { key: checkpointKey, results: new Map() };
    const checkpoint = miningCheckpoint.current;
    const found: TradeSignal[] = [];
    const run = sc.scan({ ...settings, checkpoint: checkpoint.results, signal: mine.signal, onProgress: p => onProgress?.(p), onSignal: s => { found.push(s); } });
    minePromise.current = run;
    try { const result = await run; if (mine.signal.aborted) throw new DOMException('已让路给捕捞', 'AbortError'); if (result.status === 'aborted' || Object.values(result.venues??{}).some(v=>v.status==='aborted')) throw new Error(result.error || Object.values(result.venues??{}).map(v=>v.error).filter(Boolean).join('；') || '这一档没扫完'); if (miningCheckpoint.current === checkpoint) miningCheckpoint.current = null; return found; }
    finally { if (mineController.current === mine) { mineController.current = null; minePromise.current = null; } }
  }, []);
  const stopMining = useCallback(() => mineController.current?.abort(), []);
  const testHitRate = useCallback(async (options: FishHitRateOptions) => {
    const sc = scanner.current ??= pageScanner ??= new FishScanner();
    if (hitRateBusy.current) throw new Error('已有一轮漏报测试进行中');
    if (options.signal.aborted) return;
    const owner = ownerRef.current;
    hitRateBusy.current = true;
    try {
      const mining = mineController.current;
      if (mining) {
        options.onWaiting?.('等待批量捕捞结束当前档…');
        mining.abort();
      } else if (controller.current || sc.isBusy()) {
        options.onWaiting?.(controller.current ? '等待当前捕捞结束…' : '等待当前行情任务结束…');
      }
      while (controller.current || mineController.current || sc.isBusy()) {
        await fishDelay(150,options.signal);
        if (ownerRef.current !== owner) return;
      }
      if (options.signal.aborted || ownerRef.current !== owner) return;
      options.onWaiting?.(null);
      await runFishHitRate(sc, options);
    } finally {
      hitRateBusy.current = false;
      options.onWaiting?.(null);
    }
  }, []);
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
    list=collapseVisibleFish(reconcile(list));
    signalsRef.current=list;setSignals(list);saveFishSignals(list,ownerRef.current??null);
    saveFishCombinationRound(selected, mode);
    selected.plans.forEach((p,j)=>{if(!round.data.plans.includes(p))saveFishMemberRound(selected,j);});
    const rule = selected.plans.map(p => fishRuleText(p.def, p.settings.direction, p.settings.threshold, p.texts.length, p.settings.statistic)).join(mode === 'or' ? ' 或 ' : ' 且 ');
    const previous=progressRef.current;
    if(previous){const next={...previous,anchorMs:selected.anchorMs,lookbackHours:selected.lookbackHours,rule,algorithmHits:selected.memberHits,cutoffMs:selected.plans[0]?Math.floor(selected.anchorMs/selected.plans[0].step)*selected.plans[0].step:previous.cutoffMs,counts:{...previous.counts,hit:combined.length,unknown:counts.unknown??0,outside:counts.outside??0}};progressRef.current=next;setProgress(next);}
    persist();return true;
  }, [persist,reconcile]);
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
    list = collapseVisibleFish(reconcile(list));
    signalsRef.current = list; setSignals(list); saveFishSignals(list, ownerRef.current ?? null);
    // 规则文字与命中数当场换过来（扫描下一次报进度时也会按新组合算）
    const prev = progressRef.current;
    if (prev) { const next = { ...prev, rule: prev.rule?.split(mode === 'or' ? ' 且 ' : ' 或 ').join(mode === 'or' ? ' 或 ' : ' 且 '), counts: { ...prev.counts, hit: combined.length } }; progressRef.current = next; setProgress(next); }
    return true;
  }, [reconcile]);
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
  const removeMany=useCallback((ids:readonly string[])=>{const selected=new Set(ids),gone=signalsRef.current.filter(s=>selected.has(s.id));if(!gone.length)return;recordFishDeletion(gone,ownerRef.current??null);commit(signalsRef.current.filter(s=>!selected.has(s.id)));},[commit]);
  return { switchLive, unionFish, signals, signalsRef, commit, progress, start, cancel, mine, stopMining, testHitRate, estimate, suggest, reconstruct, quality, recombine, hasRound, roundPlans, turnover, remove, removeMany, busy };
}
