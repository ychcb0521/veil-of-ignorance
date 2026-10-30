import {preserveSourceDeletions,markSourceDeletions,type DeleteTarget} from '@/lib/fish/libraryDeletion';
import { useQualityPostExit } from './useQualityPostExit';
import { useQualityEntryReadings } from './useQualityEntryReadings';
import { additionIdentity, validateQualityAddition, type QualityAdditionRule } from '@/lib/fish/qualityAddition';
import { replaceQualitySellPlans } from '@/lib/fish/qualitySellPlans';
import { useFeatureDefinitions } from './useFeatureDefinitions';
import { mirrorIdentity, validateQualityMirror, type QualityMirrorTakeProfit } from '@/lib/fish/qualityMirror';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { activeStandaloneBuyFilters, separateQualityFilters, activeBuyFilters, qualityFilterReadingKey, anyBuyFilters, importQualityFish, materializePlanBuyFilters, qualityFilterNeedsData, selectMinedRows, importQualityLibrary, newQualityStudy, migrateQualityCaptureEntries, qualityResultKey, qualityRunGroups, qualityRunSamples, qualityComparisonRows, qualityDisplayRows, type FishQualityStudy, type QualityBuyFilter, type QualityFilterReading, type QualityExitRule, type QualitySellCombo, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { enableQualityComparison, ensureQualitySellCombo, syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { loadQualityStudy, saveQualityStudy } from '@/lib/fish/qualityStore';
import { archiveQualityResult, archiveQualityStudy, markQualityDetection } from '@/lib/fish/qualityCampaignArchive';
import { holdingVetoIdentity, type QualityHoldingVeto } from '@/lib/fish/qualityVeto';
import { beginHistoryOnlyNotifications } from '@/lib/notificationCenter';
import { beginQualityFilterRound, finishQualityFilterRound, recoverQualityFilterRounds } from '@/lib/fish/qualityFilterLibrary';
import { adoptQualityMonitorHistory, beginQualityMonitorRound, captureQualityMonitorResult, finishQualityMonitorRound, recoverQualityMonitorRounds } from '@/lib/fish/qualityMonitorLibrary';

export type QualityRunner = (options: QualityRunOptions) => Promise<void>;
/** Mounted above the collapsible fish panel so new catches are recorded while it is closed. */
const NO_SIGNALS: readonly TradeSignal[] = [];
export function useFishQuality(owner: string | undefined, signals: readonly TradeSignal[], run: QualityRunner, library: readonly TradeSignal[] = NO_SIGNALS) {
  const definitions = useFeatureDefinitions();
  const [study, setStudy] = useState<FishQualityStudy>(newQualityStudy), [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [filterRunning, setFilterRunning] = useState(false), [filterProgress, setFilterProgress] = useState<QualityProgress | null>(null), [filterError, setFilterError] = useState('');
  const [warning, setWarning] = useState(''), [error, setError] = useState('');
  const current = useRef(study), account = useRef(owner), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const readyRef = useRef(false), latestRun = useRef(run); latestRun.current = run;
  const rerun = useRef<false | 'refresh' | NonNullable<QualityRunOptions['mode']>>(false);
  const selectionApproved = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentRevision = useRef(0);
  const filterController = useRef<AbortController | null>(null), filterRevision = useRef(0);
  const priorityRef = useRef<readonly string[]>([]);
  /**
   * 【用户要求】2026-10-27「买前过滤、持仓监测都只针对被选中的数据」：运行范围 = 已勾选 ∩ 当前筛选下可见的行
   * （来源、月份、探测算法、标的搜索）。界面经 setScope 告知可见行；null = 不限（尚未告知时按勾选）。
   */
  const scopeRef = useRef<ReadonlySet<string> | null>(null);
  const scoped = (s: FishQualityStudy): FishQualityStudy => scopeRef.current ? { ...s, selectedRowIds: (s.selectedRowIds ?? []).filter(id => scopeRef.current!.has(id)) } : s;
  const monitorFinalizer = useRef<((state: 'complete' | 'paused' | 'failed', render?: boolean, reason?: string) => Promise<void>) | null>(null);
  // Updates to an old account must never appear in or save into the newly selected one.
  if (account.current !== owner) { void monitorFinalizer.current?.('paused', false); account.current = owner; readyRef.current = false; generation.current++; controller.current?.abort(); filterController.current?.abort(); }
  const change = useCallback((apply: (s: FishQualityStudy) => FishQualityStudy) => {
    const next = preserveSourceDeletions(current.current,apply(current.current)); if (next !== current.current) { current.current = next; setStudy(next); }
  }, []);
  useEffect(()=>{
    if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel('veil-fish-quality-deletions');
    channel.onmessage=({data})=>{if(data?.owner!==account.current||!data.deletedSources)return;selectionApproved.current=false;intentRevision.current++;filterRevision.current++;rerun.current=false;controller.current?.abort();filterController.current?.abort();change(s=>preserveSourceDeletions({...s,deletedSources:data.deletedSources,deletedReadings:data.deletedReadings},s));};
    return()=>channel.close();
  },[owner,change]);
  const postExit=useQualityPostExit(owner,ready && readyRef.current,study,run,change);
  const entry=useQualityEntryReadings(owner,ready && readyRef.current,study,run,change);
  const acceptReading = useCallback((reading: QualityFilterReading) => change(s => {
    const prior = s.filterReadings?.find(r => r.key === reading.key);
    if (reading.error && prior && !prior.error && Number.isFinite(prior.value)) return s;
    return { ...s, filterReadings: [...(s.filterReadings ?? []).filter(r => r.key !== reading.key), reading] };
  }), [change]);
  const defer = useCallback((action: () => void, delay = 500) => {
    const epoch = generation.current, revision = intentRevision.current;
    setTimeout(() => { if (readyRef.current && epoch === generation.current && revision === intentRevision.current) action(); }, delay);
  }, []);
  useEffect(() => {
    let active = true, loaded = false; const epoch = ++generation.current;
    readyRef.current = false; rerun.current = false; selectionApproved.current = false; setReady(false); setRunning(false); setProgress(null); setError(''); setWarning('');
    setFilterRunning(false); setFilterProgress(null); setFilterError(''); filterController.current = null;
    current.current = newQualityStudy(); setStudy(current.current);
    void loadQualityStudy(owner).then(value => {
      if (!active || epoch !== generation.current) return;
      const archived = recoverQualityFilterRounds(recoverQualityMonitorRounds(adoptQualityMonitorHistory(archiveQualityStudy(ensureQualitySellCombo(enableQualityComparison(migrateQualityCaptureEntries(value.study)))))));
      // 【用户要求】2026-10-26 盘面保持干净：卖出方案静默同步当前账号公式，不再显示同步提示
      const migrated = separateQualityFilters(syncQualitySellDefinitions(archived));
      const savedSelection = new Set(Array.isArray(migrated.selectedRowIds) ? migrated.selectedRowIds : []);
      const restored = { ...migrated, selectedRowIds: qualityDisplayRows(migrated).filter(r => savedSelection.has(r.id) || savedSelection.has(r.signalId!)).map(r => r.id) };
      current.current = restored; setStudy(restored); setWarning(value.warning ?? ''); readyRef.current = true; loaded = true; setReady(true);
    });
    const flush = () => { if (loaded) void saveQualityStudy(owner, current.current); };
    window.addEventListener('pagehide', flush);
    return () => { void monitorFinalizer.current?.('paused', false); active = false; readyRef.current = false; controller.current?.abort(); controller.current = null; filterController.current?.abort(); filterController.current = null; if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } window.removeEventListener('pagehide', flush); flush(); };
  }, [owner]);
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    const next = syncQualitySellDefinitions(current.current, definitions);
    if (next !== current.current) change(s => syncQualitySellDefinitions(archiveQualityStudy(s), definitions));
  }, [definitions, ready, change]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityFish(s, signals)); }, [signals, ready, change]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityLibrary(s, library)); }, [library, ready, change]);
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    if (saveTimer.current) return;
    const epoch = generation.current;
    // Throttle, not debounce: a continuous stream of catches/results must still be saved during the run.
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void saveQualityStudy(owner, current.current).then(ok => {
      if (epoch === generation.current) setWarning(ok ? '' : '鱼质量未能保存到本机；请保留此页面，系统会继续重试。');
    }); }, 400);
  }, [study, ready, owner]);
  const start = useCallback(async (automatic = false, mode?: QualityRunOptions['mode']) => {
    if (!readyRef.current || !qualityRunSamples(scoped(current.current)).length || automatic && !selectionApproved.current && !mode) return;
    if (current.current.sellPlans && !current.current.sellPlans.length) return;
    if (!automatic) selectionApproved.current = true;
    if (controller.current) {
      // Settings can queue a follow-up; periodic ticks never prolong an active batch.
      if (!automatic || mode || controller.current.signal.aborted) rerun.current = rerun.current === 'refresh' ? 'refresh' : mode ?? 'refresh';
      return;
    }
    if (mode && mode !== 'restart' && !qualityFilterNeedsData(scoped(current.current), mode)) { setProgress(null); setError(''); return; }
    // Deep dig edits must affect the next run, including a previously complete cached trade.
    // Archive first so refreshing the active formula never rewrites an older trial's provenance.
    change(s => syncQualitySellDefinitions(archiveQualityStudy(s)));
    const epoch = generation.current, revision = intentRevision.current, aborter = new AbortController(); controller.current = aborter;
    const frozen = structuredClone(scoped(current.current));
    const frozenSamples = new Map(qualityRunSamples(frozen).map(s => [s.id, s]));
    const frozenGroups = new Map(qualityRunGroups(frozen).map(g => [g.id, g]));
    const readingKeys = new Set([...frozenSamples.values()].flatMap(row => [...frozenGroups.values()].flatMap(plan => activeBuyFilters(frozen, plan).map(f => qualityFilterReadingKey(row, f)))));
    const begun = beginQualityMonitorRound(current.current, frozen, Date.now(), mode === 'restart'), capture = begun.capture;
    change(() => begun.study);
    const savedOwner = account.current; let finalized = false;
    const finish = async (state: 'complete' | 'paused' | 'failed', render = true, reason?: string) => {
      if (finalized) return; finalized = true;
      if (monitorFinalizer.current === finish) monitorFinalizer.current = null;
      if (epoch !== generation.current || account.current !== savedOwner) return;
      const next = preserveSourceDeletions(current.current,finishQualityMonitorRound(current.current, capture, state, Date.now(), reason));
      current.current = next; if (render && readyRef.current) setStudy(next);
      let ok = false; try { ok = await saveQualityStudy(savedOwner, next); } catch { /* retain in memory and retry with the existing save loop */ }
      if (!ok && epoch === generation.current && readyRef.current) setWarning('监测库未能保存到本机；请保留此页面，系统会继续重试。');
    };
    monitorFinalizer.current = finish;
    const savePartial = () => { void finish('paused'); };
    aborter.signal.addEventListener('abort', savePartial, { once: true });
    const releaseNotifications = beginHistoryOnlyNotifications();
    aborter.signal.addEventListener('abort', releaseNotifications, { once: true });
    setRunning(true); setError('');
    setProgress({ done: 0, total: frozen.sellPlans ? frozenSamples.size * qualityRunGroups(frozen).length : frozen.samples.reduce((total, s) => total + s.groups.length, 0), current: '' });
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal, mode, task: 'monitor', priority: () => priorityRef.current,
        onProgress: p => { if (epoch === generation.current && revision === intentRevision.current && !aborter.signal.aborted) setProgress(p); },
        onFilterReading: reading => {
          if (epoch !== generation.current || revision !== intentRevision.current || aborter.signal.aborted || !readingKeys.has(reading.key)) return;
          if (!finalized) capture.readings.set(reading.key, structuredClone(reading));
          acceptReading(reading);
        },
        onResult: result => {
          if (epoch !== generation.current || revision !== intentRevision.current || aborter.signal.aborted) return;
          change(s => {
            const sample = frozenSamples.get(result.sampleId), group = frozenGroups.get(result.groupId);
            if (!sample || !group || qualityResultKey(sample, group, frozen.observeHours) !== result.key) return s;
            const liveSample = qualityComparisonRows(s).find(v => v.id === result.sampleId), liveGroup = qualityRunGroups(s).find(v => v.id === result.groupId);
            const matches = liveSample && liveGroup && qualityResultKey(liveSample, liveGroup, s.observeHours) === result.key;
            if (!matches && controller.current !== aborter) return s;
            const archived = archiveQualityResult({ ...frozen, campaignRuns: s.campaignRuns }, result);
            const next = { ...s, campaignRuns: archived.campaignRuns, results: matches ? [...s.results.filter(r => r.sampleId !== result.sampleId || r.groupId !== result.groupId), result] : s.results };
            return finalized ? next : captureQualityMonitorResult(next, capture, result, Date.now());
          });
        },
      });
      await finish('complete');
    } catch (e) { if (epoch === generation.current && revision === intentRevision.current && !aborter.signal.aborted) setError(e instanceof Error ? e.message : '评估失败'); await finish(aborter.signal.aborted ? 'paused' : 'failed', true, e instanceof Error ? e.message : '评估失败'); }
    finally {
      aborter.signal.removeEventListener('abort', savePartial);
      aborter.signal.removeEventListener('abort', releaseNotifications); releaseNotifications();
      if (controller.current === aborter) { controller.current = null; if (epoch === generation.current) { setRunning(false); if (rerun.current) { const queued = rerun.current; rerun.current = false; defer(() => void start(true, queued === 'refresh' ? undefined : queued), 0); } } }
    }
  }, [change, defer, acceptReading]);
  /** Separate lifetime and cancellation: filtering never submits sell outcomes or controls monitoring. */
  const startFilter = useCallback(async () => {
    if (!readyRef.current || filterController.current || !anyBuyFilters(current.current) || !qualityRunSamples(scoped(current.current)).length) return;
    change(s => syncQualitySellDefinitions(archiveQualityStudy(s)));
    const revision = ++filterRevision.current;
    const frozen = structuredClone(scoped(current.current)), total = qualityRunSamples(frozen).length;
    const readingKeys = new Set(qualityRunSamples(frozen).flatMap(row => activeStandaloneBuyFilters(frozen).map(f => qualityFilterReadingKey(row, f))));
    frozen.filterReadings = frozen.filterReadings?.filter(r => !r.error && Number.isFinite(r.value));
    setFilterError('');
    // 【用户要求】2026-10-27 过滤有自己的库：每一轮冻结当时的条件与判断（只改门槛、读数可复用的也算一轮）
    const epoch = generation.current, savedOwner = account.current;
    const begun = beginQualityFilterRound(current.current, frozen, Date.now());
    if (begun) change(() => begun.study);
    let finished = false;
    const finishRound = (state: 'complete' | 'paused' | 'failed', reason?: string) => {
      if (!begun || finished) return; finished = true;
      if (epoch !== generation.current || account.current !== savedOwner) return;
      change(s => finishQualityFilterRound(s, begun.capture, state, Date.now(), reason));
    };
    if (!qualityFilterNeedsData(frozen, 'filter-only')) { finishRound('complete'); setFilterProgress({ done: total, total, current: '' }); return; }
    const aborter = new AbortController(); filterController.current = aborter;
    aborter.signal.addEventListener('abort', () => finishRound('paused'), { once: true });
    const active = () => epoch === generation.current && revision === filterRevision.current && filterController.current === aborter && !aborter.signal.aborted;
    setFilterRunning(true); setFilterProgress({ done: 0, total, current: '' });
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal, task: 'filter', mode: 'filter-only', priority: () => priorityRef.current,
        onProgress: p => { if (active()) setFilterProgress(p); },
        onFilterReading: reading => {
          if (!active() || !readingKeys.has(reading.key)) return;
          // 有效读数覆盖；缺数据只在这一轮还没有读数时记下（不拿失败盖掉成功）
          if (begun && !finished && (!reading.error && Number.isFinite(reading.value) || !begun.capture.readings.has(reading.key))) begun.capture.readings.set(reading.key, structuredClone(reading));
          acceptReading(reading);
        },
        onResult: () => {},
      });
      if (active()) {
        const readings=new Map((current.current.filterReadings??[]).map(r=>[r.key,r]));
        const missing=[...readingKeys].filter(key=>{const r=readings.get(key);return !r||r.error||!Number.isFinite(r.value);}).length;
        if(missing){const message=`本轮 ${missing} 项过滤读数仍缺数据；已完成的读数已保存，可点击「重试缺数据」补算`;setFilterError(message);finishRound('failed',message);}
        else finishRound('complete');
        setFilterProgress({ done: total, total, current: '' });
      }
    } catch (e) { if (active()) { setFilterError(e instanceof Error ? e.message : '过滤失败'); finishRound('failed', e instanceof Error ? e.message : '过滤失败'); } }
    finally { if (filterController.current === aborter) { filterController.current = null; if (epoch === generation.current) setFilterRunning(false); } }
  }, [acceptReading, change]);
  const cancelFilter = useCallback(() => { filterRevision.current++; filterController.current?.abort(); filterController.current = null; setFilterRunning(false); }, []);
  const cancel = useCallback(() => { intentRevision.current++; rerun.current = false; selectionApproved.current = false; controller.current?.abort(); }, []);
  const restart = useCallback(async () => {
    if (!readyRef.current || !qualityRunSamples(scoped(current.current)).length) return;
    intentRevision.current++; rerun.current = false;
    controller.current?.abort(); controller.current = null;
    await start(false, 'restart');
  }, [start]);
  // 挖到的鱼自动导入和勾选；只有已经主动开始监测，才把新鱼接到监测任务中。
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    let picked = false;
    change(s => { const next = selectMinedRows(s); picked = next !== s; return next; });
    if (!picked) return;
    if (!selectionApproved.current) return;
    if (controller.current) { rerun.current = 'refresh'; return; }
    defer(() => void start(true));
  }, [study.samples, ready, change, start, defer]);
  // 界面告诉评估先算哪些行（看得见的在前）；只存引用，不触发重渲染
  const setPriority = useCallback((ids: readonly string[]) => { priorityRef.current = ids; }, []);
  /** 当前筛选下可见的行（显示行编号）；只存引用，下一次开始过滤 / 监测时生效，不打断正在跑的批次。 */
  const setScope = useCallback((ids: readonly string[] | null) => { scopeRef.current = ids ? new Set(ids) : null; }, []);
  useEffect(() => {
    if (!ready || !warning) return;
    const timer = setInterval(() => { void saveQualityStudy(owner, current.current).then(ok => { if (ok && account.current === owner) setWarning(''); }); }, 15_000);
    return () => clearInterval(timer);
  }, [ready, warning, owner]);
  const setRule = useCallback((id: string, rule?: QualityExitRule) => {
    change(s => ({ ...s, groups: s.groups.map(g => g.id === id ? { ...g, rule } : g), sellPlans: s.sellPlans?.map(g => g.id === id ? { ...g, rule } : g), selectedSellId: s.selectedSellId === id ? undefined : s.selectedSellId }));
    defer(() => void start());
  }, [change, start, defer]);
  /** 组合卖出：前段门槛、分水岭与后段门槛一起改，改完重算（旧结果按编号自动区分，存档保留）。 */
  const setCombo = useCallback((id: string, rule: QualityExitRule, combo: QualitySellCombo) => {
    change(s => ({ ...s, sellPlans: s.sellPlans?.map(g => g.id === id && g.combo ? { ...g, rule, combo } : g), selectedSellId: s.selectedSellId === id ? undefined : s.selectedSellId }));
    defer(() => void start());
  }, [change, start, defer]);
  const setObserveHours = useCallback((hours: number) => {
    change(s => ({ ...s, observeHours: hours }));
    defer(() => { if (controller.current) rerun.current = 'refresh'; else void start(true); });
  }, [change, start, defer]);
  const selectSell = useCallback((id: string) => change(s => markQualityDetection(s, id)), [change]);
  const setSelectedRows = useCallback((ids: string[]) => {
    selectionApproved.current = false; rerun.current = false;
    const selected = new Set(ids);
    change(s => ({ ...s, selectedRowIds: qualityDisplayRows(s).filter(r => selected.has(r.id) || selected.has(r.signalId!)).map(r => r.id) }));
  }, [change]);
  /** Filters have their own catalog and run button; editing never changes or restarts monitoring. */
  const setFilters = useCallback((filters: QualityBuyFilter[]) => {
    cancelFilter(); setFilterProgress(null); setFilterError('');
    change(s => ({...s,buyFilters:structuredClone(filters)}));
  }, [change,cancelFilter]);
  /** 只改某套卖出方案的持仓一票否决：买入条件和过滤读数不动；变了就立刻按新设置重算卖出（正在跑的旧批次直接作废）。 */
  const setHoldingVetoes = useCallback((planId: string, vetoes: QualityHoldingVeto[], mirror?: QualityMirrorTakeProfit, addition?: QualityAdditionRule) => {
    const plan = current.current.sellPlans?.find(p => p.id === planId);
    validateQualityMirror(mirror); validateQualityAddition(addition);
    const additionChanged = JSON.stringify(additionIdentity(addition ?? plan?.addition)) !== JSON.stringify(additionIdentity(plan?.addition));
    if (!plan || !additionChanged && JSON.stringify([holdingVetoIdentity(plan.holdingVetoes),mirrorIdentity(plan.mirrorTakeProfit)]) === JSON.stringify([holdingVetoIdentity(vetoes),mirrorIdentity(mirror ?? plan.mirrorTakeProfit)])) return;
    if (additionChanged) { intentRevision.current++; rerun.current = false; controller.current?.abort(); controller.current = null; }
    change(s => {
      const saved = materializePlanBuyFilters(archiveQualityStudy(s));
      return { ...saved, sellPlans: saved.sellPlans?.map(p => p.id === planId ? { ...p, holdingVetoes: structuredClone(vetoes), ...(mirror ? {mirrorTakeProfit:structuredClone(mirror)} : {}), ...(addition ? {addition:structuredClone(addition)} : {}) } : p) };
    });
    defer(() => { if (additionChanged) void start(false, 'restart'); else if (controller.current) void restart(); else void start(); });
  }, [change, start, restart, defer]);
  const setSellPlans = useCallback((plans: import('@/lib/fish/quality').QualityGroup[]) => {
    if (!readyRef.current) return;
    // Validate first, then finalize the old round before replacing its active configuration.
    const checked = replaceQualitySellPlans(current.current, plans);
    if (checked === current.current) return;
    intentRevision.current++; rerun.current = false;
    controller.current?.abort(); controller.current = null;
    change(s => replaceQualitySellPlans(s, plans));
    defer(() => void start(false, 'restart'));
  }, [change, defer, start]);
  const deleteSources=useCallback(async(targets:readonly DeleteTarget[])=>{
    if(!readyRef.current)throw Error('鱼质量尚未加载完成');const savedOwner=account.current;
    selectionApproved.current=false;intentRevision.current++;filterRevision.current++;rerun.current=false;controller.current?.abort();filterController.current?.abort();
    await monitorFinalizer.current?.('paused',false);if(account.current!==savedOwner)throw Error('账号已切换，请重新选择');
    const next=markSourceDeletions(current.current,targets);if(!await saveQualityStudy(savedOwner,next))throw Error('过滤库、监测库的删除未能保存，请重试');
    if(account.current!==savedOwner)throw Error('账号已切换，原账号的关联删除已保存；请返回原账号继续删除来源记录');
    change(()=>next);
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('veil-fish-quality-deletions');channel.postMessage({owner:savedOwner,deletedSources:next.deletedSources,deletedReadings:next.deletedReadings});channel.close();}
  },[change]);
  return { account:owner,deleteSources,entry, postExit, study: readyRef.current ? study : newQualityStudy(), ready: ready && readyRef.current, running, progress, filterRunning, filterProgress, filterError, warning, error, start, restart, cancel, startFilter, cancelFilter, setRule, setCombo, setObserveHours, selectSell, setSelectedRows, setPriority, setScope, setFilters, setHoldingVetoes, setSellPlans };
}
type CompleteFishQualityState=ReturnType<typeof useFishQuality>;
export type FishQualityState=Omit<CompleteFishQualityState,'postExit'|'entry'|'account'|'deleteSources'> & Partial<Pick<CompleteFishQualityState,'postExit'|'entry'|'account'|'deleteSources'>>;
