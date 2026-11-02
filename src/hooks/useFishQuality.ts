import { backfillPlanVersions, freezeQualityPlan, refreezeSyncedFormulas } from '@/lib/fish/qualityPlanVersions';
import { deleteQualityPlanTemplate, renameQualityPlanTemplate, saveQualityPlanTemplate } from '@/lib/fish/qualityPlanTemplates';
import {copyMonitorStudy,editMonitorDirectory} from '@/lib/fish/qualityMonitorArchive';
import {preserveQualityMonitorLibrary} from '@/lib/fish/qualityMonitorLibrary';
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
import { loadQualityMonitorArchive, stripStoredQualityArchiveBodies } from '@/lib/fish/qualityArchiveStore';
import type { QualityMonitorArchive } from '@/lib/fish/qualityMonitorLibrary';
import { archiveQualityResult, archiveQualityStudy, markQualityDetection } from '@/lib/fish/qualityCampaignArchive';
import { holdingVetoIdentity, type QualityHoldingVeto } from '@/lib/fish/qualityVeto';
import { beginHistoryOnlyNotifications } from '@/lib/notificationCenter';
import { beginQualityFilterRound, finishQualityFilterRound, recoverQualityFilterRounds } from '@/lib/fish/qualityFilterLibrary';
import { archiveQualityMonitorStudy, adoptQualityMonitorHistory, beginQualityMonitorRound, captureQualityMonitorResult, finishQualityMonitorRound, recoverQualityMonitorRounds } from '@/lib/fish/qualityMonitorLibrary';
import {migrateQualitySourceRows,type QualityRunTiming} from '@/lib/fish/quality';

export type QualityRunner = (options: QualityRunOptions) => Promise<void>;
/** Mounted above the collapsible fish panel so new catches are recorded while it is closed. */
const NO_SIGNALS: readonly TradeSignal[] = [];
export function useFishQuality(owner: string | undefined, signals: readonly TradeSignal[], run: QualityRunner, library: readonly TradeSignal[] = NO_SIGNALS,mined:readonly TradeSignal[]=NO_SIGNALS, enabled = true) {
  const definitions = useFeatureDefinitions();
  const [study, setStudy] = useState<FishQualityStudy>(newQualityStudy), [ready, setReady] = useState(false);
  const [archiving,setArchiving]=useState(false),archiveLock=useRef(false);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [filterRunning, setFilterRunning] = useState(false), [filterProgress, setFilterProgress] = useState<QualityProgress | null>(null), [filterError, setFilterError] = useState('');
  const [warning, setWarning] = useState(''), [error, setError] = useState('');
  const current = useRef(study), account = useRef(owner), generation = useRef(0), controller = useRef<AbortController | null>(null);
  /**
   * 【用户要求】2026-11-01「点进战役后持仓监测停了」：每次暂停都记下原因（写进那一轮监测记录的 error，并打到控制台），
   * 便于查清是谁中断了监测。只记正在跑的那一轮；同一轮只记第一个原因。
   */
  const pauseCause = useRef<{ reason: string; stack: string } | null>(null);
  const markPause = (reason: string) => { if (controller.current && !controller.current.signal.aborted && !pauseCause.current) pauseCause.current = { reason, stack: new Error().stack ?? '' }; };
  const takePause = () => {
    const cause = pauseCause.current; pauseCause.current = null;
    const reason = cause?.reason ?? '未记录的原因（请把浏览器控制台截图发给开发）';
    console.info(`[持仓监测] 已暂停：${reason}`, cause?.stack ?? new Error().stack ?? '');
    try { const w = window as unknown as { __veilQualityPauses?: unknown[] }; w.__veilQualityPauses = [...(w.__veilQualityPauses ?? []).slice(-19), { at: new Date().toISOString(), reason, stack: cause?.stack }]; } catch { /* 只读环境忽略 */ }
    return reason;
  };
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
  if (account.current !== owner) { markPause('切换了账号'); void monitorFinalizer.current?.('paused', false, takePause()); account.current = owner; readyRef.current = false; generation.current++; controller.current?.abort(); filterController.current?.abort(); }
  const change = useCallback((apply: (s: FishQualityStudy) => FishQualityStudy) => {
    const next = preserveSourceDeletions(current.current,apply(current.current)); if (next !== current.current) { current.current = next; setStudy(next); }
  }, []);
  useEffect(()=>{
    if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel('veil-fish-quality-deletions');
    channel.onmessage=({data})=>{if(data?.owner!==account.current||!data.deletedSources)return;selectionApproved.current=false;intentRevision.current++;filterRevision.current++;rerun.current=false;markPause('另一个标签页删除了信号来源');controller.current?.abort();filterController.current?.abort();change(s=>preserveSourceDeletions({...s,deletedSources:data.deletedSources,deletedReadings:data.deletedReadings},s));};
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
    if (!enabled) return;
    let active = true, loaded = false; const epoch = ++generation.current;
    archiveLock.current=false;setArchiving(false);
    readyRef.current = false; rerun.current = false; selectionApproved.current = false; setReady(false); setRunning(false); setProgress(null); setError(''); setWarning('');
    setFilterRunning(false); setFilterProgress(null); setFilterError(''); filterController.current = null;
    current.current = newQualityStudy(); setStudy(current.current);
    void loadQualityStudy(owner).then(value => {
      if (!active || epoch !== generation.current) return;
      const archived = recoverQualityFilterRounds(recoverQualityMonitorRounds(adoptQualityMonitorHistory(archiveQualityStudy(ensureQualitySellCombo(enableQualityComparison(migrateQualityCaptureEntries(value.study)))))));
      // 【用户要求】2026-10-26 盘面保持干净：卖出方案静默同步当前账号公式，不再显示同步提示
      // 【用户要求】2026-11-02 版本保护：没冻结过的方案与模板按当前代码补记版本；只因跟随账号公式而变的指纹重新冻结
      const migrated = backfillPlanVersions(refreezeSyncedFormulas(migrateQualitySourceRows(separateQualityFilters(syncQualitySellDefinitions(archived)))));
      const savedSelection = new Set(Array.isArray(migrated.selectedRowIds) ? migrated.selectedRowIds : []);
      const restored = { ...migrated, selectedRowIds: qualityDisplayRows(migrated).filter(r => savedSelection.has(r.id) || savedSelection.has(r.signalId!)).map(r => r.id) };
      current.current = restored; setStudy(restored); setWarning(value.warning ?? ''); readyRef.current = true; loaded = true; setReady(true);
    }).catch(cause => {
      if (!active || epoch !== generation.current) return;
      setError(cause instanceof Error ? cause.message : '账号研究暂未恢复，请重试。');
      setWarning('账号原数据仍保留，恢复完成前不会保存空白研究。');
    });
    const flush = () => { if (loaded) void saveQualityStudy(owner, current.current); };
    window.addEventListener('pagehide', flush);
    return () => { markPause('页面关闭、刷新，或鱼质量模块被卸载'); void monitorFinalizer.current?.('paused', false, takePause()); active = false; readyRef.current = false; controller.current?.abort(); controller.current = null; filterController.current?.abort(); filterController.current = null; if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } window.removeEventListener('pagehide', flush); flush(); };
  }, [owner, enabled]);
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    const next = syncQualitySellDefinitions(current.current, definitions);
    if (next !== current.current) change(s => syncQualitySellDefinitions(archiveQualityStudy(s), definitions));
  }, [definitions, ready, change]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityFish(s, signals)); }, [signals, ready, change]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityLibrary(s, library)); }, [library, ready, change]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityFish(s,mined,Date.now(),'mined')); }, [mined, ready, change]);
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
    if(archiveLock.current&&mode!=='restart')return;
    if (!readyRef.current || !qualityRunSamples(scoped(current.current)).length || automatic && !selectionApproved.current && !mode) return;
    if (current.current.sellPlans && !current.current.sellPlans.length) return;
    if (!automatic) selectionApproved.current = true;
    if (controller.current) {
      // A manual start can queue one follow-up; periodic ticks never prolong an active batch.
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
    const savedOwner = account.current; let finalized = false,finishTask:Promise<void>|undefined;
    const finish = (state: 'complete' | 'paused' | 'failed', render = true, reason?: string) => {
      if(finishTask)return finishTask;finalized=true;
      finishTask=(async()=>{
      if (monitorFinalizer.current === finish) monitorFinalizer.current = null;
      if (epoch !== generation.current || account.current !== savedOwner) return;
      const next = preserveSourceDeletions(current.current,finishQualityMonitorRound(current.current, capture, state, Date.now(), reason));
      current.current = next; if (render && readyRef.current) setStudy(next);
      let ok = false; try { ok = await saveQualityStudy(savedOwner, next); } catch { /* retain in memory and retry with the existing save loop */ }
      if (!ok && epoch === generation.current && readyRef.current) setWarning('监测库未能保存到本机；请保留此页面，系统会继续重试。');
      })();return finishTask;
    };
    monitorFinalizer.current = finish;
    const savePartial = () => { if (!finalized) void finish('paused', true, takePause()); };
    aborter.signal.addEventListener('abort', savePartial, { once: true });
    const releaseNotifications = beginHistoryOnlyNotifications();
    aborter.signal.addEventListener('abort', releaseNotifications, { once: true });
    setRunning(true); setError('');
    const timings: QualityRunTiming[] = [], startedAt = performance.now();
    setProgress({ done: 0, total: frozen.sellPlans ? frozenSamples.size * qualityRunGroups(frozen).length : frozen.samples.reduce((total, s) => total + s.groups.length, 0), current: '' });
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal, mode, task: 'monitor', priority: () => priorityRef.current, onTiming: t => { timings.push(t); },
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
      reportQualityRunTimings(timings, performance.now() - startedAt);
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
  // 「暂停监测」按钮直接把 cancel 当点击处理函数：收到的是事件对象，不是原因
  const cancel = useCallback((reason?: unknown) => { markPause(typeof reason === 'string' ? reason : '手动点了「暂停监测」'); intentRevision.current++; rerun.current = false; selectionApproved.current = false; controller.current?.abort(); }, []);
  /** Parameter saves pause the obsolete batch; only an explicit Start approves another run. */
  const pauseForSettings = useCallback(() => {
    cancel('保存了监测设置（保存设置会先暂停当前一轮）'); controller.current=null; setRunning(false); setProgress(null);
  },[cancel]);
  const restart = useCallback(async () => {
    if(!readyRef.current||archiveLock.current)return;
    archiveLock.current=true;setArchiving(true);setError('');const savedOwner=account.current,epoch=generation.current;
    try{
      intentRevision.current++;rerun.current=false;selectionApproved.current=false;
      const finalize=monitorFinalizer.current;markPause('从头重算：先归档当前一轮');controller.current?.abort();await finalize?.('paused');controller.current=null;
      if(account.current!==savedOwner||generation.current!==epoch)return;
      const archived=archiveQualityMonitorStudy(current.current);
      if(archived!==current.current){
        if(!await saveQualityStudy(savedOwner,archived))throw Error('监测结果归档失败，未开始重算；原结果仍保留，请重试');
        if(account.current!==savedOwner||generation.current!==epoch)return;
        // 正文已存进归档库，内存里只留目录（不然每 15 秒的保存都要多复制 40 MB）。
        change(s=>({...s,monitorLibrary:stripStoredQualityArchiveBodies(savedOwner,archived).monitorLibrary}));
      }
      if(account.current===savedOwner&&generation.current===epoch){setArchiving(false);void start(false,'restart');}
    }catch(e){if(account.current===savedOwner&&generation.current===epoch)setError(e instanceof Error?e.message:'归档失败，未开始重算');}
    finally{if(account.current===savedOwner&&generation.current===epoch){archiveLock.current=false;setArchiving(false);}}
  }, [start,change]);
  const setMonitorEntryHidden=useCallback(async(id:string,hidden:boolean)=>{
    if(!readyRef.current||archiveLock.current)return false;
    const savedOwner=account.current,epoch=generation.current,next=editMonitorDirectory(current.current,id,hidden);
    if(next===current.current)return false;
    try{if(!await saveQualityStudy(savedOwner,next))throw Error('目录修改未保存，请重试');
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      change(s=>preserveQualityMonitorLibrary(next,s));return true;
    }catch(e){if(account.current===savedOwner&&generation.current===epoch)setError(e instanceof Error?e.message:'目录修改失败');return false;}
  },[change]);
  const restoreMonitorStudy=useCallback(async(snapshot:FishQualityStudy,sourceRoundId?:string)=>{
    if(!readyRef.current||archiveLock.current)return false;
    archiveLock.current=true;setArchiving(true);setError('');const savedOwner=account.current,epoch=generation.current;
    try{
      cancel('打开归档副本作为当前总表');cancelFilter();entry.cancel();postExit.cancel();
      const finalize=monitorFinalizer.current;await finalize?.('paused');
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      controller.current=null;setRunning(false);setProgress(null);setFilterProgress(null);setFilterError('');
      const next=copyMonitorStudy(current.current,snapshot,Date.now(),sourceRoundId);
      if(!await saveQualityStudy(savedOwner,next))throw Error('副本未保存，当前总表仍保留，请重试');
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      change(s=>stripStoredQualityArchiveBodies(savedOwner,{...preserveQualityMonitorLibrary(s,next),filterLibrary:s.filterLibrary}));return true;
    }catch(e){if(account.current===savedOwner&&generation.current===epoch)setError(e instanceof Error?e.message:'复制归档失败');return false;}
    finally{if(account.current===savedOwner&&generation.current===epoch){archiveLock.current=false;setArchiving(false);}}
  },[cancel,cancelFilter,entry.cancel,postExit.cancel,change]);
  /** 打开一份完整归档：正文按需从本机归档库（或账号云端）读出。 */
  const loadMonitorArchive=useCallback((archive:QualityMonitorArchive)=>loadQualityMonitorArchive(account.current,archive,current.current),[]);
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
    const plan=current.current.sellPlans?.find(p=>p.id===id)??current.current.groups.find(p=>p.id===id);
    if(!plan||JSON.stringify(plan.rule)===JSON.stringify(rule))return;
    pauseForSettings();
    change(s => ({ ...archiveQualityStudy(s), groups: s.groups.map(g => g.id === id ? { ...g, rule } : g), sellPlans: s.sellPlans?.map(g => g.id === id ? freezeQualityPlan({ ...g, rule }) : g), selectedSellId: s.selectedSellId === id ? undefined : s.selectedSellId }));
  }, [change,pauseForSettings]);
  /** Save the full segmented rule together; monitoring starts from the explicit button. */
  const setCombo = useCallback((id: string, rule: QualityExitRule, combo: QualitySellCombo) => {
    const plan=current.current.sellPlans?.find(p=>p.id===id&&p.combo);
    if(!plan||JSON.stringify([plan.rule,plan.combo])===JSON.stringify([rule,combo]))return;
    pauseForSettings();
    change(s => ({ ...archiveQualityStudy(s), sellPlans: s.sellPlans?.map(g => g.id === id && g.combo ? freezeQualityPlan({ ...g, rule, combo }) : g), selectedSellId: s.selectedSellId === id ? undefined : s.selectedSellId }));
  }, [change,pauseForSettings]);
  const setObserveHours = useCallback((hours: number) => {
    if(current.current.observeHours===hours)return;
    pauseForSettings();change(s => ({ ...archiveQualityStudy(s), observeHours: hours }));
  }, [change,pauseForSettings]);
  const selectSell = useCallback((id: string) => change(s => markQualityDetection(s, id)), [change]);
  const setSelectedRows = useCallback((ids: string[]) => {
    selectionApproved.current = false; rerun.current = false;
    const selected = new Set(ids);
    change(s => ({ ...s, selectedRowIds: qualityDisplayRows(s).filter(r => selected.has(r.id) || selected.has(r.signalId!)).map(r => r.id) }));
  }, [change]);
  /**
   * 【用户要求】2026-11-02 清除组合表里已产生的结果，两边互不影响：过滤只清当前读数；监测先归档（交易战役保留）再清当前结果。
   * 过滤库 / 监测库的历史轮次都不动。
   */
  const clearFilterResults = useCallback(() => {
    cancelFilter(); setFilterProgress(null); setFilterError('');
    change(s => s.filterReadings?.length ? { ...s, filterReadings: [] } : s);
  }, [change,cancelFilter]);
  const clearMonitorResults = useCallback(() => {
    if (controller.current) cancel('清除了组合表中的监测结果');
    setProgress(null);
    change(s => s.results.length ? { ...archiveQualityStudy(s), results: [] } : s);
  }, [change,cancel]);
  /** 【用户要求】2026-11-02 方案模板：只改模板，不暂停、不重算监测。 */
  const savePlanTemplate = useCallback((planId: string, name: string) => {
    const plan = current.current.sellPlans?.find(p => p.id === planId);
    if (!plan) throw new Error('请先保存这套方案，再存为模板');
    saveQualityPlanTemplate(current.current, plan, name); // 先校验名称，出错直接抛给界面
    change(s => { const p = s.sellPlans?.find(x => x.id === planId); return p ? saveQualityPlanTemplate(s, p, name) : s; });
  }, [change]);
  const deletePlanTemplate = useCallback((id: string) => change(s => deleteQualityPlanTemplate(s, id)), [change]);
  const renamePlanTemplate = useCallback((id: string, name: string) => { renameQualityPlanTemplate(current.current, id, name); change(s => renameQualityPlanTemplate(s, id, name)); }, [change]);
  /** Filters have their own catalog and run button; editing never changes or restarts monitoring. */
  const setFilters = useCallback((filters: QualityBuyFilter[]) => {
    cancelFilter(); setFilterProgress(null); setFilterError('');
    change(s => ({...s,buyFilters:structuredClone(filters)}));
  }, [change,cancelFilter]);
  /** Save this plan’s holding settings without starting or restarting monitoring. */
  const setHoldingVetoes = useCallback((planId: string, vetoes: QualityHoldingVeto[], mirror?: QualityMirrorTakeProfit, addition?: QualityAdditionRule) => {
    const plan = current.current.sellPlans?.find(p => p.id === planId);
    validateQualityMirror(mirror); validateQualityAddition(addition);
    const additionChanged = JSON.stringify(additionIdentity(addition ?? plan?.addition)) !== JSON.stringify(additionIdentity(plan?.addition));
    if (!plan || !additionChanged && JSON.stringify([holdingVetoIdentity(plan.holdingVetoes),mirrorIdentity(plan.mirrorTakeProfit)]) === JSON.stringify([holdingVetoIdentity(vetoes),mirrorIdentity(mirror ?? plan.mirrorTakeProfit)])) return;
    pauseForSettings();
    change(s => {
      const saved = materializePlanBuyFilters(archiveQualityStudy(s));
      return { ...saved, sellPlans: saved.sellPlans?.map(p => p.id === planId ? freezeQualityPlan({ ...p, holdingVetoes: structuredClone(vetoes), ...(mirror ? {mirrorTakeProfit:structuredClone(mirror)} : {}), ...(addition ? {addition:structuredClone(addition)} : {}) }) : p) };
    });
  }, [change,pauseForSettings]);
  const setSellPlans = useCallback((plans: import('@/lib/fish/quality').QualityGroup[]) => {
    if (!readyRef.current) return;
    // Validate first, then finalize the old round before replacing its active configuration.
    const checked = replaceQualitySellPlans(current.current, plans);
    if (checked === current.current) return;
    pauseForSettings();
    change(s => replaceQualitySellPlans(s, plans));
  }, [change,pauseForSettings]);
  const deleteSources=useCallback(async(targets:readonly DeleteTarget[])=>{
    if(!readyRef.current)throw Error('鱼质量尚未加载完成');const savedOwner=account.current;
    selectionApproved.current=false;intentRevision.current++;filterRevision.current++;rerun.current=false;markPause('删除了信号来源');controller.current?.abort();filterController.current?.abort();
    await monitorFinalizer.current?.('paused',false,takePause());if(account.current!==savedOwner)throw Error('账号已切换，请重新选择');
    const next=markSourceDeletions(current.current,targets);if(!await saveQualityStudy(savedOwner,next))throw Error('过滤库、监测库的删除未能保存，请重试');
    if(account.current!==savedOwner)throw Error('账号已切换，原账号的关联删除已保存；请返回原账号继续删除来源记录');
    change(()=>next);
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('veil-fish-quality-deletions');channel.postMessage({owner:savedOwner,deletedSources:next.deletedSources,deletedReadings:next.deletedReadings});channel.close();}
  },[change]);
  return { account:owner,archiving,loadMonitorArchive,restoreMonitorStudy,setMonitorEntryHidden,deleteSources,entry, postExit, study: readyRef.current ? study : newQualityStudy(), ready: ready && readyRef.current, running, progress, filterRunning, filterProgress, filterError, warning, error, start, restart, cancel, startFilter, cancelFilter, clearFilterResults, clearMonitorResults, savePlanTemplate, deletePlanTemplate, renamePlanTemplate, setRule, setCombo, setObserveHours, selectSell, setSelectedRows, setPriority, setScope, setFilters, setHoldingVetoes, setSellPlans };
}
type CompleteFishQualityState=ReturnType<typeof useFishQuality>;
export type FishQualityState=Omit<CompleteFishQualityState,'postExit'|'entry'|'account'|'deleteSources'|'archiving'|'loadMonitorArchive'|'restoreMonitorStudy'|'setMonitorEntryHidden'|'clearFilterResults'|'clearMonitorResults'|'savePlanTemplate'|'deletePlanTemplate'|'renamePlanTemplate'> & Partial<Pick<CompleteFishQualityState,'postExit'|'entry'|'account'|'deleteSources'|'archiving'|'loadMonitorArchive'|'restoreMonitorStudy'|'setMonitorEntryHidden'|'clearFilterResults'|'clearMonitorResults'|'savePlanTemplate'|'deletePlanTemplate'|'renamePlanTemplate'>>;

/**
 * 持仓监测耗时（调试用）：每轮结束在控制台打一行汇总，并把明细放在 window.__veilQualityTimings，
 * 慢的时候打开浏览器控制台就能看到是哪几笔拖慢。2026-11-01 用户要求「增加一些调试信息」。
 */
function reportQualityRunTimings(timings: readonly QualityRunTiming[], wallMs: number) {
  if (!timings.length) return;
  const total = timings.reduce((n, t) => n + t.ms, 0), slow = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5);
  try { (window as unknown as { __veilQualityTimings?: unknown }).__veilQualityTimings = { wallMs, timings: [...timings] }; } catch { /* 只读环境忽略 */ }
  console.info(`[持仓监测] ${timings.length} 笔 · 用时 ${(wallMs / 1000).toFixed(1)}s（各笔累计 ${(total / 1000).toFixed(1)}s，平均 ${(total / timings.length / 1000).toFixed(1)}s）· 最慢：${slow.map(t => `${t.symbol} ${(t.ms / 1000).toFixed(1)}s`).join('，')}`);
}
