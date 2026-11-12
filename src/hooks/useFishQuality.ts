import type { FishCdaTracking } from './useFishCdaTracking';
import type { PreEntrySettings } from '@/lib/fish/preEntryMonitor';
import { editWorkspaceMonitor, importQualityWorkspaceRows, pickQualityWorkspaceRows, saveWorkspaceMonitorRounds } from '@/lib/fish/qualityWorkspace';
import {qualityExecutionSnapshot} from '@/lib/fish/qualityExecutionSnapshot';
import { signalReadingKey, type QualitySignalMetric } from '@/lib/fish/qualitySignalReadings';
import {preserveQualitySourceRatings,rateQualitySource} from '@/lib/fish/qualitySourceRatings';
import {mergeLibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
import {editLibraryDirectory,renameLibraryDirectory} from '@/lib/fish/qualityMonitorArchive';
import type {QualityPlanTemplate} from '@/lib/fish/qualityPlanTemplates';
import { useQualityPlanCatalog } from './useQualityPlanCatalog';
import {useQualitySavedPlans} from './useQualitySavedPlans';
import {applySavedQualityPlans,editSavedQualityPlans,seedSavedQualityPlans,readSavedQualityPlans} from '@/lib/fish/qualitySavedPlans';
import { usePreEntryMonitor, type AutomaticScreeningMatch } from './usePreEntryMonitor';
import { preEntrySignal } from '@/lib/fish/preEntryMonitor';
import {withQualityScreeningEntries,type QualityScreeningScope} from '@/lib/fish/qualityScreeningResults';
import { readQualityBatchLock, saveQualityBatchLock, sameQualityBatch, type QualityBatchLock } from '@/lib/fish/qualityBatchScope';
import { qualityMonitorEntryAt, qualityRowMonitorTimeBasis, type QualityMonitorTimeBasis } from '@/lib/fish/qualityAdmissionTime';
import { backfillPlanVersions, freezeQualityPlan, refreezeSyncedFormulas } from '@/lib/fish/qualityPlanVersions';
import { validatePayoffStops } from '@/lib/fish/qualityVeto';
import { restoreQualityPlanTemplate, mergeQualityPlanTemplates, sameQualityPlanTemplates, campaignPlanForTemplate, deleteQualityPlanTemplate, renameQualityPlanTemplate, saveQualityPlanTemplate } from '@/lib/fish/qualityPlanTemplates';
import {copyMonitorStudy,editMonitorDirectory} from '@/lib/fish/qualityMonitorArchive';
import {preserveQualityMonitorLibrary} from '@/lib/fish/qualityMonitorLibrary';
import { qualityOrigins } from '@/lib/fish/qualitySources';
import {preserveSourceDeletions,markSourceDeletions,type DeleteTarget} from '@/lib/fish/libraryDeletion';
import { useQualityPostExit } from './useQualityPostExit';
import { useQualityEntryReadings } from './useQualityEntryReadings';
import { additionIdentity, validateQualityAddition, type QualityAdditionRule } from '@/lib/fish/qualityAddition';
import { replaceQualitySellPlans } from '@/lib/fish/qualitySellPlans';
import { useFeatureDefinitions } from './useFeatureDefinitions';
import { mirrorIdentity, validateQualityMirror, type QualityMirrorTakeProfit } from '@/lib/fish/qualityMirror';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { activeStandaloneBuyFilters, separateQualityFilters, activeBuyFilters, qualityFilterReadingKey, anyBuyFilters, importQualityFish, materializePlanBuyFilters, qualityFilterNeedsData, selectMinedRows, importQualityLibrary, newQualityStudy, migrateQualityCaptureEntries, qualityResultKey, qualityRunGroups, qualityRunSamples, qualityMonitorRunSamples, qualityComparisonRows, qualityDisplayRows, qualityEntryIdentity, qualityMiningEntryKey, type QualityGroup, type FishQualityStudy, type QualityBuyFilter, type QualityFilterReading, type QualityExitRule, type QualitySellCombo, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { enableQualityComparison, ensureQualitySellCombo, syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { loadQualityStudy, saveQualityStudy } from '@/lib/fish/qualityStore';
import { loadQualityMonitorArchive, stripStoredQualityArchiveBodies } from '@/lib/fish/qualityArchiveStore';
import type { QualityMonitorArchive } from '@/lib/fish/qualityMonitorLibrary';
import { archiveQualityResult, archiveQualityStudy, markQualityDetection } from '@/lib/fish/qualityCampaignArchive';
import { holdingVetoIdentity, type QualityHoldingVeto } from '@/lib/fish/qualityVeto';
import { beginHistoryOnlyNotifications } from '@/lib/notificationCenter';
import { resumeLibraryRound } from '@/lib/fish/libraryRounds';
import { beginQualityFilterRound, finishQualityFilterRound, recoverQualityFilterRounds, type QualityFilterCapture } from '@/lib/fish/qualityFilterLibrary';
import { archiveQualityMonitorStudy, adoptQualityMonitorHistory, beginQualityMonitorRound, captureQualityMonitorResult, finishQualityMonitorRound, recoverQualityMonitorRounds, type QualityMonitorCapture } from '@/lib/fish/qualityMonitorLibrary';
import {migrateQualitySourceRows,type QualityRunTiming} from '@/lib/fish/quality';

interface PausableQualityRun<Capture> {
  frozen: FishQualityStudy;
  capture: Capture;
  paused: boolean;
}

function checkMonitorTimes(study: FishQualityStudy, timeBasis: QualityMonitorTimeBasis) {
  const rows = qualityRunSamples(study);
  const missing = rows.filter(row => qualityMonitorEntryAt(row, timeBasis) == null);
  const detail = timeBasis === 'screening' && missing.some(row => row.monitorEntry?.error)
    ? '请在筛选库核对入选记录及其时点。' : '';
  const reason = timeBasis === 'screening' ? '没有唯一的筛选入选时点' : '缺少有效信号时间';
  return {
    eligible: rows.length - missing.length,
    message: missing.length ? `${missing.length} 条${reason}${missing.length === rows.length ? '，无法开始监测。' : '，本轮已跳过。'}${detail}` : '',
  };
}

export type QualityRunner = (options: QualityRunOptions) => Promise<void>;
/** Mounted above the collapsible fish panel so new catches are recorded while it is closed. */
const NO_SIGNALS: readonly TradeSignal[] = [];
export function useFishQuality(owner: string | undefined, signals: readonly TradeSignal[], run: QualityRunner, library: readonly TradeSignal[] = NO_SIGNALS,mined:readonly TradeSignal[]=NO_SIGNALS, enabled = true, turing: readonly TradeSignal[] = NO_SIGNALS, workspaceMode = false) {
  const definitions = useFeatureDefinitions();
  const preEntry = usePreEntryMonitor(owner, enabled, run, workspaceMode);
  const workspaceSources = useMemo(() => {
    if (!workspaceMode || !enabled) return undefined;
    return {
      fish:importQualityFish(newQualityStudy(),signals),
      mined:importQualityFish(newQualityStudy(),mined,Date.now(),'mined'),
      library:importQualityLibrary(newQualityStudy(),library),
      turing:importQualityLibrary(newQualityStudy(),turing,Date.now(),'turing'),
    };
  },[workspaceMode,enabled,signals,mined,library,turing]);
  const screeningLibrary = useRef(preEntry.library); screeningLibrary.current = preEntry.library;
  const screeningReady = useRef(preEntry.ready); screeningReady.current = preEntry.ready;
  const [lockedBatch, setLockedBatchState] = useState(() => workspaceMode ? null : readQualityBatchLock(owner));
  const screeningScope = useRef<QualityScreeningScope>(lockedBatch ?? {});
  const [templateCatalog,setTemplateCatalog] = useQualityPlanCatalog(owner);
  const [savedPlans,setSavedPlans]=useQualitySavedPlans(owner);
  const savedPlansWriter=useRef(setSavedPlans);savedPlansWriter.current=setSavedPlans;
  const [study, setStudy] = useState<FishQualityStudy>(newQualityStudy), [ready, setReady] = useState(false);
  const [archiving,setArchiving]=useState(false),archiveLock=useRef(false);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [filterRunning, setFilterRunning] = useState(false), [filterProgress, setFilterProgress] = useState<QualityProgress | null>(null), [filterError, setFilterError] = useState('');
  const [signalValues, setSignalValues] = useState<{running:boolean;progress:QualityProgress;error:string} | null>(null);
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
  const rerun = useRef<false | { mode?: QualityRunOptions['mode']; timeBasis?: QualityMonitorTimeBasis }>(false);
  const selectionApproved = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentRevision = useRef(0);
  const filterController = useRef<AbortController | null>(null), filterRevision = useRef(0);
  // Keep only the current session's executable batches. Historical rounds and saved
  // templates remain in their original formats.
  const monitorBatch = useRef<PausableQualityRun<QualityMonitorCapture> | null>(null);
  const filterBatch = useRef<PausableQualityRun<QualityFilterCapture> | null>(null);
  const filterRecalculationPending = useRef(new Set<string>());
  const priorityRef = useRef<readonly string[]>([]);
  /**
   * 【用户要求】2026-10-27「买前过滤、持仓监测都只针对被选中的数据」：运行范围 = 已勾选 ∩ 当前筛选下可见的行
   * （来源、月份、探测算法、标的搜索）。界面经 setScope 告知可见行；null = 不限（尚未告知时按勾选）。
   */
  const scopeRef = useRef<ReadonlySet<string> | null>(null);
  const lockedBatchRef = useRef(lockedBatch);
  const setLockedBatch = useCallback((batch: QualityBatchLock | null) => {
    lockedBatchRef.current = batch;
    saveQualityBatchLock(account.current, batch);
    setLockedBatchState(batch);
    selectionApproved.current = false;
    rerun.current = false;
  }, []);
  const canResumeBatch = (frozen: FishQualityStudy) =>
    !lockedBatchRef.current || sameQualityBatch(lockedBatchRef.current.rowIds, frozen.selectedRowIds ?? []);
  const scoped = (s: FishQualityStudy): FishQualityStudy => lockedBatchRef.current ? { ...s, selectedRowIds: lockedBatchRef.current.rowIds } : scopeRef.current ? { ...s, selectedRowIds: (s.selectedRowIds ?? []).filter(id => scopeRef.current!.has(id)) } : s;
  const monitorFinalizer = useRef<((state: 'complete' | 'paused' | 'failed', render?: boolean, reason?: string) => Promise<void>) | null>(null);
  // Updates to an old account must never appear in or save into the newly selected one.
  if (account.current !== owner) { markPause('切换了账号'); void monitorFinalizer.current?.('paused', false, takePause()); account.current = owner; scopeRef.current = null; const nextBatch = workspaceMode ? null : readQualityBatchLock(owner); lockedBatchRef.current = nextBatch; setLockedBatchState(nextBatch); screeningScope.current = nextBatch ?? {}; readyRef.current = false; generation.current++; controller.current?.abort(); filterController.current?.abort(); }
  const change = useCallback((apply: (s: FishQualityStudy) => FishQualityStudy,persistPlans=true) => {
    const previous=current.current;
    let next = preserveQualitySourceRatings(previous,preserveSourceDeletions(previous,apply(previous)));
    if(next!==previous&&persistPlans&&readyRef.current&&next.sellPlansConfigured&&next.sellPlans!==previous.sellPlans&&JSON.stringify(next.sellPlans)!==JSON.stringify(previous.sellPlans)){
      const entries=editSavedQualityPlans(readSavedQualityPlans(account.current),previous.sellPlans??[],next.sellPlans??[]);
      next=applySavedQualityPlans(next,savedPlansWriter.current(entries));
    }
    if (previous.workspaceUpdatedAt && (next.samples !== previous.samples || next.selectedRowIds !== previous.selectedRowIds || next.workspaceMonitorDraft !== previous.workspaceMonitorDraft)) {
      next = {...next,workspaceUpdatedAt:Math.max(Date.now(),previous.workspaceUpdatedAt+1)};
    }
    if (next !== current.current) { current.current = next; setStudy(next); }
  }, []);
  useEffect(()=>{
    if(typeof BroadcastChannel==='undefined')return;const channel=new BroadcastChannel('veil-fish-quality-deletions');
    channel.onmessage=({data})=>{if(data?.owner!==account.current||!data.deletedSources)return;selectionApproved.current=false;intentRevision.current++;filterRevision.current++;rerun.current=false;markPause('另一个标签页删除了信号来源');controller.current?.abort();filterController.current?.abort();change(s=>preserveSourceDeletions({...s,deletedSources:data.deletedSources,deletedReadings:data.deletedReadings},s));};
    return()=>channel.close();
  },[owner,change]);
  // Backfill legacy study templates into the independent catalog. The server archives every revision.
  useEffect(() => {
    if (!readyRef.current || account.current !== owner) return;
    const previous = current.current;
    if (previous.planTemplates === templateCatalog) return;
    const merged = mergeQualityPlanTemplates(previous.planTemplates, templateCatalog) ?? [];
    if (!sameQualityPlanTemplates(previous.planTemplates, merged)) {
      const next = { ...previous, planTemplates: merged };
      current.current = next;
      setStudy(next);
    }
    if (!sameQualityPlanTemplates(templateCatalog, merged)) setTemplateCatalog(merged);
  }, [templateCatalog, owner, ready, setTemplateCatalog]);
  const changeTemplates = useCallback((apply: (s: FishQualityStudy) => FishQualityStudy) => {
    const previous = current.current;
    const next = apply(previous);
    if (next === previous) return;
    // Template edits leave samples, ratings and source deletion marks intact.
    setTemplateCatalog(next.planTemplates ?? []);
    current.current = next;
    setStudy(next);
  }, [setTemplateCatalog]);
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
    setFilterRunning(false); setFilterProgress(null); setFilterError(''); setSignalValues(null); filterController.current = null;
    monitorBatch.current = null; filterBatch.current = null; filterRecalculationPending.current.clear();
    current.current = newQualityStudy(); setStudy(current.current);
    void loadQualityStudy(owner).then(value => {
      if (!active || epoch !== generation.current) return;
      const archived = recoverQualityFilterRounds(recoverQualityMonitorRounds(adoptQualityMonitorHistory(archiveQualityStudy(ensureQualitySellCombo(enableQualityComparison(migrateQualityCaptureEntries(value.study)))))));
      // 【用户要求】2026-10-26 盘面保持干净：卖出方案静默同步当前账号公式，不再显示同步提示
      // 【用户要求】2026-11-02 版本保护：没冻结过的方案与模板按当前代码补记版本；只因跟随账号公式而变的指纹重新冻结
      const migrated = backfillPlanVersions(refreezeSyncedFormulas(migrateQualitySourceRows(separateQualityFilters(syncQualitySellDefinitions(archived)))));
      const savedSelection = new Set(Array.isArray(migrated.selectedRowIds) ? migrated.selectedRowIds : []);
      let restored = { ...migrated, selectedRowIds: qualityDisplayRows(migrated).filter(r => savedSelection.has(r.id) || savedSelection.has(r.signalId!)).map(r => r.id) };
      if (workspaceMode && !restored.workspaceUpdatedAt) {
        const oldLock = readQualityBatchLock(owner);
        const ids = oldLock?.rowIds ?? restored.selectedRowIds;
        restored = {...restored,workspaceUpdatedAt:Date.now(),samples:pickQualityWorkspaceRows(restored,ids),selectedRowIds:[...ids]};
      }
      if (workspaceMode && restored.workspaceMonitorDraft) {
        const recovered = recoverQualityMonitorRounds({...restored,monitorLibrary:restored.workspaceMonitorDraft});
        if (recovered.monitorLibrary !== restored.workspaceMonitorDraft) restored = {...restored,workspaceUpdatedAt:Math.max(Date.now(),(restored.workspaceUpdatedAt??0)+1),workspaceMonitorDraft:recovered.monitorLibrary};
      }
      // Preserve the existing startup formula/version migration in the small catalog too.
      // Later background writes must not revert that already-authorized account formula sync.
      if(restored.sellPlansConfigured){
        const entries=readSavedQualityPlans(owner),updated=editSavedQualityPlans(entries,value.study.sellPlans??[],restored.sellPlans??[]);
        if(JSON.stringify(updated)!==JSON.stringify(entries))savedPlansWriter.current(updated);
      }
      current.current = restored; setStudy(restored); setWarning(value.warning ?? ''); readyRef.current = true; loaded = true; setReady(true);
    }).catch(cause => {
      if (!active || epoch !== generation.current) return;
      setError(cause instanceof Error ? cause.message : '账号研究暂未恢复，请重试。');
      setWarning('账号原数据仍保留，恢复完成前不会保存空白研究。');
    });
    const flush = () => { if (loaded) void saveQualityStudy(owner, current.current); };
    window.addEventListener('pagehide', flush);
    return () => { markPause('页面关闭、刷新，或鱼质量模块被卸载'); void monitorFinalizer.current?.('paused', false, takePause()); active = false; readyRef.current = false; controller.current?.abort(); controller.current = null; filterController.current?.abort(); filterController.current = null; if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } window.removeEventListener('pagehide', flush); flush(); };
  }, [owner, enabled, workspaceMode]);
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    const next = syncQualitySellDefinitions(current.current, definitions);
    if (next !== current.current) change(s => syncQualitySellDefinitions(archiveQualityStudy(s), definitions));
  }, [definitions, ready, change]);
  useEffect(() => { if (!workspaceMode && ready && readyRef.current) change(s => importQualityFish(s, signals)); }, [signals, ready, change, workspaceMode]);
  useEffect(() => { if (!workspaceMode && ready && readyRef.current) change(s => importQualityLibrary(s, library)); }, [library, ready, change, workspaceMode]);
  useEffect(() => { if (!workspaceMode && ready && readyRef.current && turing.length) change(s => importQualityLibrary(s, turing, Date.now(), 'turing')); }, [turing, ready, change, workspaceMode]);
  useEffect(() => { if (!workspaceMode && ready && readyRef.current) change(s => importQualityFish(s,mined,Date.now(),'mined')); }, [mined, ready, change, workspaceMode]);
  useEffect(() => {
    if (workspaceMode || !ready || !readyRef.current || !preEntry.ready) return;
    const signals = preEntry.library.records.map(preEntrySignal).filter((s): s is TradeSignal => !!s);
    if (signals.length) change(s => importQualityLibrary(s, signals, Date.now(), 'pre-entry'));
  }, [preEntry.library.records, preEntry.ready, ready, change, workspaceMode]);
  useEffect(() => {
    if (ready && readyRef.current && preEntry.ready) change(s => withQualityScreeningEntries(s, preEntry.library, screeningScope.current));
  }, [ready, preEntry.ready, preEntry.library, study.samples, study.screeningResults, study.screeningRounds, change]);
  // Imported entry backups may own names too. Keep them in the shared map,
  // so saves from already-open older entry runners cannot discard those names.
  useEffect(()=>{
    if(!ready||!readyRef.current||!preEntry.ready||!preEntry.library.directoryEdits)return;
    const old=current.current.monitorLibrary?.directoryEdits,merged=mergeLibraryDirectoryEdits(old,preEntry.library.directoryEdits);
    if(JSON.stringify(old??{})===JSON.stringify(merged))return;
    change(s=>({...s,monitorLibrary:{version:1,importedLegacy:false,settings:[],records:[],rounds:[],...s.monitorLibrary,directoryEdits:mergeLibraryDirectoryEdits(s.monitorLibrary?.directoryEdits,merged)}}));
  },[preEntry.library.directoryEdits,preEntry.ready,ready,change]);
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    if (saveTimer.current) return;
    const epoch = generation.current;
    const schedule=()=>{
      const handle=setTimeout(()=>{
        if(epoch!==generation.current)return;
        const snapshot=current.current;
        void saveQualityStudy(owner,snapshot).then(ok=>{
          if(epoch===generation.current)setWarning(ok?'':'鱼质量未能保存到本机；请保留此页面，系统会继续重试。');
        }).catch(()=>{if(epoch===generation.current)setWarning('鱼质量未能保存到本机；请保留此页面，系统会继续重试。');}).finally(()=>{
          if(saveTimer.current!==handle)return;
          saveTimer.current=null;
          // One save in flight, then the latest immutable state. Slow storage
          // cannot accumulate deep copies while both engines publish results.
          if(epoch===generation.current&&readyRef.current&&current.current!==snapshot)schedule();
        });
      },400);
      saveTimer.current=handle;
    };
    schedule();
  }, [study, ready, owner]);
  const start = useCallback(async (automatic = false, mode?: QualityRunOptions['mode'], resume = false, requestedBasis?: QualityMonitorTimeBasis) => {
    if (!readyRef.current || archiveLock.current && mode !== 'restart') return;
    const paused = resume && monitorBatch.current?.paused ? monitorBatch.current : null;
    if (resume && (!paused || !canResumeBatch(paused.frozen) || controller.current || !(workspaceMode ? current.current.workspaceMonitorDraft : current.current.monitorLibrary)?.rounds.some(round => round.id === paused.capture.roundId && round.state === 'paused'))) return;
    const timeBasis = paused ? paused.frozen.monitorTimeBasis : requestedBasis ?? current.current.monitorTimeBasis;
    if (!paused && timeBasis !== 'signal' && !screeningReady.current) {
      if (!automatic) setError('筛选记录尚未恢复，暂不能确定买入时间，请稍后开始监测。');
      return;
    }
    if (!paused) {
      if (timeBasis !== 'signal') change(s => withQualityScreeningEntries(s, screeningLibrary.current, screeningScope.current));
      if (!qualityRunSamples(scoped(current.current)).length || automatic && !selectionApproved.current && !mode) return;
      if (current.current.sellPlans && !current.current.sellPlans.length) return;
    }
    const runInput = { ...scoped(current.current), monitorTimeBasis: timeBasis, monitorTimeBasisByRow: undefined };
    const timeCheck = !paused && timeBasis ? checkMonitorTimes(runInput, timeBasis) : undefined;
    if (timeCheck && !timeCheck.eligible) { if (!automatic) setError(timeCheck.message); return; }
    if (!automatic && !paused) selectionApproved.current = true;
    if (controller.current) {
      // A manual start can queue one follow-up; periodic ticks never prolong an active batch.
      if (!automatic || mode || controller.current.signal.aborted) {
        const queued = rerun.current;
        rerun.current = { mode: queued && !queued.mode ? undefined : mode, timeBasis: requestedBasis ?? (queued ? queued.timeBasis : undefined) };
      }
      return;
    }
    if (mode && mode !== 'restart' && !qualityFilterNeedsData(runInput, mode)) { setProgress(null); setError(''); return; }
    // Deep dig edits must affect the next run, including a previously complete cached trade.
    // Archive first so refreshing the active formula never rewrites an older trial's provenance.
    if (!paused) change(s => syncQualitySellDefinitions(archiveQualityStudy(s)));
    const epoch = generation.current, revision = intentRevision.current, aborter = new AbortController(); controller.current = aborter;
    const frozen = paused
      ? { ...paused.frozen, results: [...paused.capture.results.values()], filterReadings: [...paused.capture.readings.values()] }
      : qualityExecutionSnapshot({ ...scoped(current.current), monitorTimeBasis: timeBasis, monitorTimeBasisByRow: undefined });
    const frozenSamples = new Map(qualityMonitorRunSamples(frozen).map(s => [s.id, s]));
    const frozenGroups = new Map(qualityRunGroups(frozen).map(g => [g.id, g]));
    const readingKeys = new Set([...frozenSamples.values()].flatMap(row => [...frozenGroups.values()].flatMap(plan => activeBuyFilters(frozen, plan).map(f => qualityFilterReadingKey(row, f)))));
    const liveStudy = current.current;
    const begun = paused ? null : beginQualityMonitorRound(workspaceMode ? {...liveStudy,monitorLibrary:liveStudy.workspaceMonitorDraft} : liveStudy, frozen, Date.now(), mode === 'restart', workspaceMode);
    const capture = paused?.capture ?? begun!.capture;
    const batch = { frozen, capture, paused: false };
    monitorBatch.current = batch;
    if (begun) change(s => {
      const next = workspaceMode ? { ...s, workspaceMonitorDraft: begun.study.monitorLibrary } : begun.study;
      if (!timeBasis) return next;
      const byRow = { ...s.monitorTimeBasisByRow };
      for (const row of frozenSamples.values()) byRow[row.signalId ?? row.id] = timeBasis;
      return { ...next, monitorTimeBasis: timeBasis, monitorTimeBasisByRow: byRow };
    });
    else change(s => editWorkspaceMonitor(s,draft => draft.monitorLibrary ? {...draft,monitorLibrary:{...draft.monitorLibrary,rounds:resumeLibraryRound(draft.monitorLibrary.rounds,capture.roundId,Date.now())}} : draft));
    const savedOwner = account.current; let finalized = false,finishTask:Promise<void>|undefined;
    const finish = (state: 'complete' | 'paused' | 'failed', render = true, reason?: string) => {
      if(finishTask)return finishTask;finalized=true;
      if (state !== 'paused' && monitorBatch.current === batch) monitorBatch.current = null;
      finishTask=(async()=>{
      if (monitorFinalizer.current === finish) monitorFinalizer.current = null;
      if (epoch !== generation.current || account.current !== savedOwner) return;
      const live = current.current;
      const finished = editWorkspaceMonitor(live,draft => finishQualityMonitorRound(draft,capture,state,Date.now(),reason));
      const next = preserveSourceDeletions(live,workspaceMode ? {...finished,workspaceUpdatedAt:Math.max(Date.now(),(live.workspaceUpdatedAt??0)+1)} : finished);
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
    setRunning(true);
    if (!paused) setError(timeCheck?.message ?? '');
    const timings: QualityRunTiming[] = [], startedAt = performance.now();
    const total = frozen.sellPlans ? frozenSamples.size * frozenGroups.size : (timeBasis ? [...frozenSamples.values()] : frozen.samples).reduce((sum, s) => sum + s.groups.length, 0);
    setProgress(previous => paused && previous ? previous : { done: 0, total, current: '' });
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal, mode, task: 'monitor', priority: () => priorityRef.current, onTiming: t => { timings.push(t); },
        onProgress: p => { if (epoch === generation.current && revision === intentRevision.current && !aborter.signal.aborted) setProgress(previous => paused && previous && p.done < previous.done ? { ...p, done: previous.done } : p); },
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
            const matches = liveSample && liveGroup && qualityResultKey(liveSample, liveGroup, s.observeHours, qualityRowMonitorTimeBasis(s, liveSample)) === result.key;
            if (!matches && controller.current !== aborter) return s;
            const archived = archiveQualityResult({ ...frozen, campaignRuns: s.campaignRuns }, result);
            const next = { ...s, campaignRuns: archived.campaignRuns, results: matches ? [...s.results.filter(r => r.sampleId !== result.sampleId || r.groupId !== result.groupId), result] : s.results };
            return finalized ? next : editWorkspaceMonitor(next,draft => captureQualityMonitorResult(draft,capture,result,Date.now()));
          });
        },
      });
      await finish('complete');
    } catch (e) { if (epoch === generation.current && revision === intentRevision.current && !aborter.signal.aborted) setError(e instanceof Error ? e.message : '评估失败'); await finish(aborter.signal.aborted ? 'paused' : 'failed', true, e instanceof Error ? e.message : '评估失败'); }
    finally {
      reportQualityRunTimings(timings, performance.now() - startedAt);
      aborter.signal.removeEventListener('abort', savePartial);
      aborter.signal.removeEventListener('abort', releaseNotifications); releaseNotifications();
      if (controller.current === aborter) { controller.current = null; if (epoch === generation.current) { setRunning(false); if (rerun.current) { const queued = rerun.current; rerun.current = false; defer(() => void start(true, queued.mode, false, queued.timeBasis), 0); } } }
    }
  }, [change, defer, acceptReading, workspaceMode]);
  /** Separate lifetime and cancellation: filtering never submits sell outcomes or controls monitoring. */
  const startFilter = useCallback(async (resume = false, rowIds?: FishQualityStudy['selectedRowIds'], force = false) => {
    if (!readyRef.current || filterController.current) return;
    const scopeForRun = (study: FishQualityStudy) => rowIds ? {...study, selectedRowIds: rowIds} : scoped(study);
    const paused = resume && filterBatch.current?.paused ? filterBatch.current : null;
    if (resume && (!paused || !canResumeBatch(paused.frozen) || !current.current.filterLibrary?.rounds.some(round => round.id === paused.capture.roundId && round.state === 'paused'))) return;
    if (!paused) {
      if (!anyBuyFilters(current.current) || !qualityRunSamples(scopeForRun(current.current)).length) return;
      change(s => syncQualitySellDefinitions(archiveQualityStudy(s)));
    }
    const revision = ++filterRevision.current;
    const frozen = paused
      ? { ...paused.frozen, filterReadings: [...paused.capture.readings.values()] }
      : qualityExecutionSnapshot(scopeForRun(current.current));
    const total = qualityRunSamples(frozen).length;
    const readingKeys = new Set(qualityRunSamples(frozen).flatMap(row => activeStandaloneBuyFilters(frozen).map(f => qualityFilterReadingKey(row, f))));
    const pending = filterRecalculationPending.current;
    if (force) for (const key of readingKeys) pending.add(key);
    const requiresFreshReadings = [...readingKeys].some(key => pending.has(key));
    frozen.filterReadings = frozen.filterReadings?.filter(r => !pending.has(r.key) && !r.error && Number.isFinite(r.value));
    setFilterError('');
    // 【用户要求】2026-10-27 过滤有自己的库：每一轮冻结当时的条件与判断（只改门槛、读数可复用的也算一轮）
    const epoch = generation.current, savedOwner = account.current;
    const begun = paused ? null : beginQualityFilterRound(current.current, frozen, Date.now());
    const capture = paused?.capture ?? begun?.capture;
    const batch = capture ? { frozen, capture, paused: false } : null;
    filterBatch.current = batch;
    if (begun) change(() => begun.study);
    else if (capture) change(s => s.filterLibrary ? { ...s, filterLibrary: { ...s.filterLibrary, rounds: resumeLibraryRound(s.filterLibrary.rounds, capture.roundId, Date.now()) } } : s);
    let finished = false;
    const finishRound = (state: 'complete' | 'paused' | 'failed', reason?: string) => {
      if (!capture || finished) return; finished = true;
      if (state !== 'paused' && filterBatch.current === batch) filterBatch.current = null;
      if (epoch !== generation.current || account.current !== savedOwner) return;
      change(s => finishQualityFilterRound(s, capture, state, Date.now(), reason));
    };
    if (!qualityFilterNeedsData(frozen, 'filter-only')) { finishRound('complete'); setFilterProgress({ done: total, total, current: '' }); return; }
    const aborter = new AbortController(); filterController.current = aborter;
    aborter.signal.addEventListener('abort', () => finishRound('paused'), { once: true });
    const active = () => epoch === generation.current && revision === filterRevision.current && filterController.current === aborter && !aborter.signal.aborted;
    setFilterRunning(true); setFilterProgress(previous => paused && previous ? previous : { done: 0, total, current: '', ...(frozen.independentFilters ? {matched:0} : {}) });
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal, task: 'filter', mode: 'filter-only', priority: () => priorityRef.current,
        onProgress: p => {
          if (!active()) return;
          setFilterProgress(previous => {
            const matched = paused ? previous?.matched : undefined;
            return {
              ...p,
              done: paused ? Math.max(p.done, previous?.done ?? 0) : p.done,
              ...(matched != null ? {matched:Math.max(p.matched ?? 0, matched)} : {}),
            };
          });
        },
        onFilterReading: reading => {
          if (!active() || !readingKeys.has(reading.key)) return;
          // 有效读数覆盖；缺数据只在这一轮还没有读数时记下（不拿失败盖掉成功）
          const valid = !reading.error && Number.isFinite(reading.value);
          if (valid) pending.delete(reading.key);
          if (capture && !finished && (valid || !capture.readings.has(reading.key))) capture.readings.set(reading.key, structuredClone(reading));
          acceptReading(reading);
        },
        onResult: () => {},
      });
      if (active()) {
        const readings = requiresFreshReadings ? capture?.readings : new Map((current.current.filterReadings ?? []).map(r => [r.key, r]));
        const missing = [...readingKeys].filter(key => {
          const reading = readings?.get(key);
          return !reading || reading.error || !Number.isFinite(reading.value);
        }).length;
        if (missing) {
          const message = `本轮 ${missing} 项过滤读数仍缺数据；已完成的读数已保存，可点击「重试缺数据」补算`;
          setFilterError(message);
          finishRound('failed', message);
        }
        else finishRound('complete');
        setFilterProgress({ done: total, total, current: '' });
      }
    } catch (e) { if (active()) { setFilterError(e instanceof Error ? e.message : '过滤失败'); finishRound('failed', e instanceof Error ? e.message : '过滤失败'); } }
    finally { if (filterController.current === aborter) { filterController.current = null; if (epoch === generation.current) setFilterRunning(false); } }
  }, [acceptReading, change]);
  const stopFilter = useCallback((manual = false, signalOnly = false) => {
    if (!manual) {
      filterBatch.current = null;
      filterRecalculationPending.current.clear();
    }
    else if (!signalOnly && filterController.current && filterBatch.current) filterBatch.current.paused = true;
    filterRevision.current++;
    filterController.current?.abort();
    filterController.current = null;
    setFilterRunning(false);
    setSignalValues(previous => previous?.running ? {...previous,running:false} : previous);
  }, []);
  /** Filters have their own catalog and run button; editing never changes or restarts monitoring. */
  const setFilters = useCallback((filters: QualityBuyFilter[]) => {
    stopFilter(); setFilterProgress(null); setFilterError('');
    change(s => ({...s,buyFilters:structuredClone(filters)}));
  }, [change,stopFilter]);
  const generateSignalValues = useCallback(async (selectedMetrics: readonly QualitySignalMetric[], rowIds: FishQualityStudy['selectedRowIds'], force: boolean) => {
    if (!readyRef.current || filterController.current || !selectedMetrics.length) return;
    const rows = qualityRunSamples({...current.current, selectedRowIds: rowIds});
    if (!rows.length) return;
    const metrics = [...new Map(selectedMetrics.map(metric => [metric.id, metric])).values()];
    const saved = new Set((current.current.signalReadings ?? []).filter(reading => !reading.error && Number.isFinite(reading.value)).map(reading => reading.key));
    const pendingKeys = new Set<string>();
    let total = 0;
    const batches = metrics.map(metric => {
      const unique = new Map(rows.map(row => [signalReadingKey(row, metric), row]));
      total += unique.size;
      const missing = [...unique].filter(([key]) => force || !saved.has(key));
      missing.forEach(([key]) => pendingKeys.add(key));
      return {metric, rows: missing.map(([, row]) => row)};
    }).filter(batch => batch.rows.length);
    const offset = total - pendingKeys.size;
    setSignalValues({running: batches.length > 0, progress: {done: offset, total, current: ''}, error: ''});
    if (!batches.length) return;
    const aborter = new AbortController(), epoch = generation.current, revision = ++filterRevision.current;
    filterController.current = aborter;
    const active = () => epoch===generation.current && revision===filterRevision.current && filterController.current===aborter && !aborter.signal.aborted;
    let missing = 0;
    try {
      await latestRun.current({
        study:newQualityStudy(current.current.startedAt),task:'signal-values',signalReadingBatches:batches,
        signal:aborter.signal,onResult:()=>{},
        onProgress:progress=>{if(active())setSignalValues({running:true,progress:{...progress,done:offset+progress.done,total},error:''});},
        onSignalReading:reading=>{
          if (!active() || !pendingKeys.delete(reading.key)) return;
          if (reading.error || !Number.isFinite(reading.value)) {
            missing++;
            if (saved.has(reading.key)) return;
          }
          change(study=>({...study,signalReadings:[...(study.signalReadings??[]).filter(prior=>prior.key!==reading.key),reading]}));
        },
      });
      if (active() && !await saveQualityStudy(account.current, current.current)) throw Error('读数尚未保存，请保留页面并重试');
      if (active() && (missing || pendingKeys.size)) {
        const count = missing + pendingKeys.size;
        const retry = force ? '可通过「重新开始」再算一轮' : '可再次生成补算';
        setSignalValues(previous => previous && {...previous, error: `${count} 项读数缺数据，${retry}`});
      }
    } catch (error) {
      if (active()) setSignalValues(previous=>previous && {...previous,error:error instanceof Error ? error.message : '信号读数失败'});
    } finally {
      if (filterController.current===aborter) {
        filterController.current=null;
        if(epoch===generation.current)setSignalValues(previous=>previous && {...previous,running:false});
      }
    }
  }, [change]);
  const saveStaticSettings = useCallback(async (metrics: readonly QualitySignalMetric[], filters?: QualityBuyFilter[]) => {
    const epoch = generation.current;
    if (!readyRef.current || filterController.current) return false;
    if (filters) setFilters(filters);
    change(study => {
      const saved = study.signalMetrics ?? [];
      if (saved.length === metrics.length && saved.every((metric, index) => metric.id === metrics[index].id)) return study;
      return {...study, signalMetrics: structuredClone([...metrics]),
        signalMetricsUpdatedAt: Math.max(Date.now(), (study.signalMetricsUpdatedAt ?? 0) + 1)};
    });
    const saved = await saveQualityStudy(account.current, current.current);
    return saved && epoch === generation.current;
  }, [change, setFilters]);
  const runStaticSettings = useCallback(async (force = false) => {
    if (!readyRef.current || (!force && filterController.current)) return;
    const snapshot = scoped(current.current);
    const rowIds = snapshot.selectedRowIds ?? [];
    const metrics = snapshot.signalMetrics ?? [];
    const filtersOn = anyBuyFilters(snapshot);
    if (!qualityRunSamples(snapshot).length || (!metrics.length && !filtersOn)) return;
    if (force) {
      stopFilter();
      setSignalValues(null);
    }
    setFilterProgress(null);
    setFilterError('');
    const ownerEpoch = generation.current;
    const readings = generateSignalValues(metrics, rowIds, force);
    const revision = filterRevision.current;
    await readings;
    if (ownerEpoch === generation.current && revision === filterRevision.current && filtersOn) {
      await startFilter(false, rowIds, force);
    }
  }, [generateSignalValues, startFilter, stopFilter]);
  const cancelSignalValues = useCallback(() => stopFilter(true, true), [stopFilter]);
  const cancelFilter = useCallback(() => stopFilter(true), [stopFilter]);
  // 「暂停监测」按钮直接把 cancel 当点击处理函数：收到的是事件对象，不是原因
  const cancel = useCallback((reason?: unknown) => {
    const manual = typeof reason !== 'string';
    if (!manual) monitorBatch.current = null;
    else if (controller.current && monitorBatch.current) monitorBatch.current.paused = true;
    markPause(manual ? '手动点了「暂停监测」' : reason);
    intentRevision.current++;
    rerun.current = false;
    selectionApproved.current = false;
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
  }, []);
  /** Parameter saves pause the obsolete batch; only an explicit Start approves another run. */
  const pauseForSettings = useCallback(() => {
    cancel('保存了监测设置（保存设置会先暂停当前一轮）'); setProgress(null);
  },[cancel]);
  const restart = useCallback(async (requestedBasis?: QualityMonitorTimeBasis) => {
    if(!readyRef.current||archiveLock.current)return;
    const timeBasis = requestedBasis ?? current.current.monitorTimeBasis;
    if (timeBasis) {
      if (timeBasis === 'screening' && !screeningReady.current) {
        setError('筛选记录尚未恢复，暂不能确定买入时间，请稍后开始监测。');
        return;
      }
      const study = scoped(current.current);
      const input = timeBasis === 'screening' ? withQualityScreeningEntries(study, screeningLibrary.current, screeningScope.current) : study;
      const check = checkMonitorTimes(input, timeBasis);
      if (!check.eligible) { setError(check.message || '请先勾选要监测的信号。'); return; }
    }
    archiveLock.current=true;setArchiving(true);setError('');const savedOwner=account.current,epoch=generation.current;
    try{
      intentRevision.current++;rerun.current=false;selectionApproved.current=false;
      const finalize=monitorFinalizer.current;markPause('从头重新计算');controller.current?.abort();await finalize?.('paused');controller.current=null;
      if(account.current!==savedOwner||generation.current!==epoch)return;
      const archived=workspaceMode ? current.current : archiveQualityMonitorStudy(current.current);
      if(archived!==current.current){
        if(!await saveQualityStudy(savedOwner,archived))throw Error('监测结果归档失败，未开始重算；原结果仍保留，请重试');
        if(account.current!==savedOwner||generation.current!==epoch)return;
        // 正文已存进归档库，内存里只留目录（不然每 15 秒的保存都要多复制 40 MB）。
        change(s=>({...s,monitorLibrary:stripStoredQualityArchiveBodies(savedOwner,archived).monitorLibrary}));
      }
      if(account.current===savedOwner&&generation.current===epoch){setArchiving(false);void start(false, 'restart', false, timeBasis);}
    }catch(e){if(account.current===savedOwner&&generation.current===epoch)setError(e instanceof Error?e.message:'归档失败，未开始重算');}
    finally{if(account.current===savedOwner&&generation.current===epoch){archiveLock.current=false;setArchiving(false);}}
  }, [start,change,workspaceMode]);
  const setMonitorEntryHidden=useCallback(async(id:string,hidden:boolean)=>{
    if(!readyRef.current||archiveLock.current)return false;
    const savedOwner=account.current,epoch=generation.current,next=editMonitorDirectory(current.current,id,hidden);
    if(next===current.current)return false;
    try{if(!await saveQualityStudy(savedOwner,next))throw Error('目录修改未保存，请重试');
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      change(s=>preserveQualityMonitorLibrary(next,s));return true;
    }catch(e){if(account.current===savedOwner&&generation.current===epoch)setError(e instanceof Error?e.message:'目录修改失败');return false;}
  },[change]);
  const setLibraryEntryHidden=useCallback(async(id:string,hidden:boolean)=>{
    if(!readyRef.current||archiveLock.current)return false;
    const savedOwner=account.current,epoch=generation.current,next=editLibraryDirectory(current.current,id,hidden);
    if(next===current.current)return false;
    try{if(!await saveQualityStudy(savedOwner,next))return false;
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      change(s=>preserveQualityMonitorLibrary(next,s));return true;
    }catch{return false;}
  },[change]);
  const renameLibraryEntry=useCallback(async(id:string,name:string)=>{
    if(!readyRef.current||archiveLock.current)return false;
    const savedOwner=account.current,epoch=generation.current,next=renameLibraryDirectory(current.current,id,name);
    if(next===current.current)return false;
    try{if(!await saveQualityStudy(savedOwner,next))return false;
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      change(s=>preserveQualityMonitorLibrary(next,s));return true;
    }catch{return false;}
  },[change]);
  const restoreMonitorStudy=useCallback(async(snapshot:FishQualityStudy,sourceRoundId?:string,keepActivePlans=false)=>{
    if(!readyRef.current||archiveLock.current)return false;
    archiveLock.current=true;setArchiving(true);setError('');const savedOwner=account.current,epoch=generation.current;
    try{
      cancel('打开归档副本作为当前总表');stopFilter();entry.cancel();postExit.cancel();
      const finalize=monitorFinalizer.current;await finalize?.('paused');
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      controller.current=null;setRunning(false);setProgress(null);setFilterProgress(null);setFilterError('');
      const next=copyMonitorStudy(current.current,keepActivePlans?{...snapshot,sellPlans:structuredClone(current.current.sellPlans),selectedSellId:current.current.selectedSellId,sellPlansConfigured:current.current.sellPlansConfigured,observeHours:current.current.observeHours,results:structuredClone(current.current.results),entryReadings:structuredClone(current.current.entryReadings),postExitReadings:structuredClone(current.current.postExitReadings)}:snapshot,Date.now(),sourceRoundId);
      if(!await saveQualityStudy(savedOwner,next))throw Error('副本未保存，当前总表仍保留，请重试');
      if(account.current!==savedOwner||generation.current!==epoch)return false;
      change(s=>stripStoredQualityArchiveBodies(savedOwner,{...preserveQualityMonitorLibrary(s,next),filterLibrary:s.filterLibrary}));return true;
    }catch(e){if(account.current===savedOwner&&generation.current===epoch)setError(e instanceof Error?e.message:'复制归档失败');return false;}
    finally{if(account.current===savedOwner&&generation.current===epoch){archiveLock.current=false;setArchiving(false);}}
  },[cancel,stopFilter,entry.cancel,postExit.cancel,change]);
  /** 打开一份完整归档：正文按需从本机归档库（或账号云端）读出。 */
  const loadMonitorArchive=useCallback((archive:QualityMonitorArchive)=>loadQualityMonitorArchive(account.current,archive,current.current),[]);
  // 挖到的鱼自动导入和勾选；只有已经主动开始监测，才把新鱼接到监测任务中。
  useEffect(() => {
    if (workspaceMode || !ready || !readyRef.current) return;
    let picked = false;
    change(s => { const next = selectMinedRows(s); picked = next !== s; return next; });
    if (!picked) return;
    if (!selectionApproved.current) return;
    if (controller.current) { const queued = rerun.current; rerun.current = { timeBasis: queued ? queued.timeBasis : undefined }; return; }
    defer(() => void start(true));
  }, [study.samples, ready, change, start, defer, workspaceMode]);
  // 界面告诉评估先算哪些行（看得见的在前）；只存引用，不触发重渲染
  const setPriority = useCallback((ids: readonly string[]) => { priorityRef.current = ids; }, []);
  /** 可见行限定下次任务；筛选目录同步持仓入场依据，不改变正在运行的冻结批次。 */
  const setScope = useCallback((ids: readonly string[] | null, screening: QualityScreeningScope = {}) => {
    scopeRef.current = ids ? new Set(ids) : null;
    const changed = screeningScope.current.roundId !== screening.roundId || screeningScope.current.workingRoundId !== screening.workingRoundId;
    screeningScope.current = screening;
    const batch = lockedBatchRef.current;
    if (batch && batch.workingRoundId !== screening.workingRoundId) {
      const next = { ...batch, workingRoundId: screening.workingRoundId };
      lockedBatchRef.current = next;
      setLockedBatchState(next);
      saveQualityBatchLock(account.current, next);
    }
    if (readyRef.current && changed) change(s => withQualityScreeningEntries(s, screeningLibrary.current, screening));
  }, [change]);
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
  const selectMiningRecords = useCallback((signals: readonly TradeSignal[]) => {
    const requested = new Set(signals.map(qualityMiningEntryKey));
    let selected = 0;
    if (!readyRef.current || !requested.size) return { selected, requested: requested.size };
    change(s => {
      const next = preserveSourceDeletions(s, importQualityFish(s, signals, Date.now(), 'mined'));
      const rows = qualityDisplayRows(next).filter(row =>
        qualityOrigins(row).includes('mined') && requested.has(qualityEntryIdentity(row.source, row.enteredAt)));
      selected = new Set(rows.map(row => row.signalId)).size;
      if (!selected) return next;
      selectionApproved.current = false;
      rerun.current = false;
      return { ...selectMinedRows(next), selectedRowIds: rows.map(row => row.id) };
    });
    return { selected, requested: requested.size };
  }, [change]);
  /**
   * 【用户要求】2026-11-02 清除组合表里已产生的结果，两边互不影响：过滤只清当前读数；监测先归档（交易战役保留）再清当前结果。
   * 过滤库 / 监测库的历史轮次都不动。
   */
  const clearFilterResults = useCallback(() => {
    stopFilter(); setFilterProgress(null); setFilterError(''); setSignalValues(null);
    change(s => s.filterReadings?.length ? { ...s, filterReadings: [] } : s);
  }, [change,stopFilter]);
  const clearPreEntryTable=preEntry.clearTableResults;
  const clearScreeningResults=useCallback(async()=>{
    if(!readyRef.current||archiveLock.current)return false;const savedOwner=account.current,epoch=generation.current;
    // Frozen copied-table snapshots use the same small tombstones. Do not clone
    // or save the unrelated holding study just to hide its screening cells.
    return await clearPreEntryTable(current.current.screeningResults??[])&&account.current===savedOwner&&generation.current===epoch;
  },[clearPreEntryTable]);
  const clearMonitorResults = useCallback(() => {
    cancel('清除了组合表中的监测结果');
    setProgress(null);
    change(s => s.results.length ? { ...archiveQualityStudy(s), results: [] } : s);
  }, [change,cancel]);
  /** 【用户要求】2026-11-02 方案模板：只改模板，不暂停、不重算监测。 */
  const savePlanTemplate = useCallback((planId: string, name: string) => {
    const settings=preEntry.library.settings,entryPlan=settings?.plans.find(p=>p.id===planId),plan=current.current.sellPlans?.find(p=>p.id===planId)??entryPlan;
    if (!plan) throw new Error('请先保存这套方案，再存为模板');
    const scope=entryPlan&&plan===entryPlan?{entryHours:settings!.hours}:undefined,at=Date.now();
    saveQualityPlanTemplate(current.current,plan,name,at,scope);
    changeTemplates(s=>{const p=s.sellPlans?.find(x=>x.id===planId)??entryPlan;return p?saveQualityPlanTemplate(s,p,name,at,scope):s;});
  }, [changeTemplates,preEntry.library.settings]);
  /** 保存战役冻结快照，不按方案 id 查当前设置，也不触发重算。 */
  const savePlanSnapshot = useCallback(async (plan: QualityGroup, name: string) => {
    if (!readyRef.current) throw new Error('账号持仓监测记录尚在恢复，请稍候');
    const savedOwner = account.current, epoch = generation.current;
    const next = saveQualityPlanTemplate(current.current, campaignPlanForTemplate(plan), name);
    changeTemplates(() => next);
    if (!await saveQualityStudy(savedOwner, next)) throw new Error('模板尚未保存成功，请保留页面并重试');
    if (epoch !== generation.current || savedOwner !== account.current) throw new Error('账号已切换，请回到原账号查看模板');
  }, [changeTemplates]);
  const restorePlanTemplate=useCallback((template:QualityPlanTemplate)=>changeTemplates(s=>restoreQualityPlanTemplate(s,template)),[changeTemplates]);
  const deletePlanTemplate = useCallback((id: string) => changeTemplates(s => deleteQualityPlanTemplate(s, id)), [changeTemplates]);
  const renamePlanTemplate = useCallback((id: string, name: string) => { renameQualityPlanTemplate(current.current, id, name); changeTemplates(s => renameQualityPlanTemplate(s, id, name)); }, [changeTemplates]);
  /** Save this plan’s holding settings without starting or restarting monitoring. */
  const setHoldingVetoes = useCallback((planId: string, vetoes: QualityHoldingVeto[], mirror?: QualityMirrorTakeProfit, addition?: QualityAdditionRule) => {
    const plan = current.current.sellPlans?.find(p => p.id === planId);
    validateQualityMirror(mirror); validateQualityAddition(addition); validatePayoffStops(vetoes);
    const additionChanged = JSON.stringify(additionIdentity(addition ?? plan?.addition)) !== JSON.stringify(additionIdentity(plan?.addition));
    if (!plan || !additionChanged && JSON.stringify([holdingVetoIdentity(plan.holdingVetoes),mirrorIdentity(plan.mirrorTakeProfit)]) === JSON.stringify([holdingVetoIdentity(vetoes),mirrorIdentity(mirror ?? plan.mirrorTakeProfit)])) return;
    pauseForSettings();
    change(s => {
      const saved = materializePlanBuyFilters(archiveQualityStudy(s));
      return { ...saved, sellPlans: saved.sellPlans?.map(p => p.id === planId ? freezeQualityPlan({ ...p, holdingVetoes: structuredClone(vetoes), ...(mirror ? {mirrorTakeProfit:structuredClone(mirror)} : {}), ...(addition ? {addition:structuredClone(addition)} : {}) }) : p) };
    });
  }, [change,pauseForSettings]);
  const setSellPlans = useCallback((plans: import('@/lib/fish/quality').QualityGroup[]) => {
    if (!readyRef.current) throw Error('账号方案尚未恢复完成，请稍后保存');
    // Validate first, then finalize the old round before replacing its active configuration.
    const checked = replaceQualitySellPlans(current.current, plans);
    if (checked === current.current) return;
    pauseForSettings();
    change(s => replaceQualitySellPlans(s, plans));
  }, [change,pauseForSettings]);
  useEffect(()=>{
    if(!readyRef.current||account.current!==owner)return;
    const restored=applySavedQualityPlans(current.current,savedPlans);
    if(restored!==current.current){pauseForSettings();change(()=>restored,false);}
    if(!current.current.sellPlansConfigured)return;
    const seeded=seedSavedQualityPlans(savedPlans,current.current.sellPlans);
    if(JSON.stringify(seeded)!==JSON.stringify(savedPlans))setSavedPlans(seeded);
  },[owner,ready,savedPlans,setSavedPlans,change,pauseForSettings]);
  const deleteSources=useCallback(async(targets:readonly DeleteTarget[])=>{
    if(!readyRef.current)throw Error('鱼质量尚未加载完成');const savedOwner=account.current;
    monitorBatch.current=null;filterBatch.current=null;
    selectionApproved.current=false;intentRevision.current++;filterRevision.current++;rerun.current=false;markPause('删除了信号来源');controller.current?.abort();filterController.current?.abort();
    await monitorFinalizer.current?.('paused',false,takePause());if(account.current!==savedOwner)throw Error('账号已切换，请重新选择');
    const next=markSourceDeletions(current.current,targets);if(!await saveQualityStudy(savedOwner,next))throw Error('过滤库、监测库的删除未能保存，请重试');
    if(account.current!==savedOwner)throw Error('账号已切换，原账号的关联删除已保存；请返回原账号继续删除来源记录');
    change(()=>next);
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('veil-fish-quality-deletions');channel.postMessage({owner:savedOwner,deletedSources:next.deletedSources,deletedReadings:next.deletedReadings});channel.close();}
  },[change]);
  const setSourceQuality=useCallback((source:TradeSignal,quality:number|undefined)=>{
    if(!readyRef.current)throw Error('鱼质量尚未恢复完成，请稍后评分');
    change(study=>rateQualitySource(study,source,quality));
  },[change]);
  const selectPreEntryRecords = useCallback((ids: readonly string[]) => {
    const chosen = new Set(ids);
    const signals = preEntry.library.records.filter(r => chosen.has(r.id)).map(preEntrySignal).filter((s): s is TradeSignal => !!s);
    if (!signals.length || !readyRef.current) return 0;
    const entries = new Set(signals.map(s => qualityEntryIdentity(s, s.timeMs)));
    change(s => {
      const next = importQualityLibrary(s, signals, Date.now(), 'pre-entry');
      return { ...next, selectedRowIds: qualityDisplayRows(next).filter(r => entries.has(qualityEntryIdentity(r.source, r.enteredAt))).map(r => r.id) };
    });
    return signals.length;
  }, [preEntry.library.records, change]);
  const importWorkspaceRows = useCallback((snapshot: FishQualityStudy, ids: readonly string[]) => {
    if (!readyRef.current) return false;
    const previous = current.current;
    change(s => importQualityWorkspaceRows(s,snapshot,ids));
    return current.current !== previous;
  },[change]);
  const removeWorkspaceRows = useCallback((ids: readonly string[]) => {
    if (!readyRef.current || !ids.length) return;
    const removed = new Set(ids);
    change(s => {
      const samples = pickQualityWorkspaceRows(s,ids,true);
      const active = new Set(qualityComparisonRows({...s,samples}).map(row=>row.id));
      return {...s,samples,results:s.results.filter(result=>active.has(result.sampleId)),selectedRowIds:s.selectedRowIds?.filter(id=>!removed.has(id))};
    });
  },[change]);
  const saveWorkspaceMonitoring = useCallback(async () => {
    if (!readyRef.current || controller.current || archiveLock.current) return false;
    const before = current.current;
    const completed = saveWorkspaceMonitorRounds(before);
    if (completed === before) return false;
    const owner = account.current, epoch = generation.current;
    const updatedAt = Math.max(Date.now(),(before.workspaceUpdatedAt??0)+1);
    archiveLock.current = true;setArchiving(true);setError('');
    try {
      if (!await saveQualityStudy(owner,{...completed,workspaceUpdatedAt:updatedAt})) throw Error('监测结果保存失败，请重试');
      if (epoch !== generation.current) return false;
      change(s => ({...s,monitorLibrary:preserveQualityMonitorLibrary(s,completed).monitorLibrary,workspaceMonitorDraft:completed.workspaceMonitorDraft}));
      return true;
    } catch (cause) {
      if (epoch === generation.current) setError(cause instanceof Error ? cause.message : '监测结果保存失败');
      return false;
    } finally {
      if (epoch === generation.current) {archiveLock.current=false;setArchiving(false);}
    }
  },[change]);
  const canResumeScreening = (roundId: string) => {
    if (!lockedBatchRef.current) return true;
    const samples = qualityRunSamples(scoped(current.current)).map(sample => sample.id);
    const prior = screeningLibrary.current.records.filter(record => record.roundId === roundId).map(record => record.sample.id);
    return samples.length > 0 && sameQualityBatch(samples, prior);
  };
  const preEntryState = { ...preEntry,
    startAutomatic: (id: string, signal: TradeSignal, recover: boolean, onMatch?: (match: AutomaticScreeningMatch) => void, settings?: PreEntrySettings) => preEntry.startAutomatic(id, importQualityFish({
      ...newQualityStudy(current.current.startedAt), entryMode: current.current.entryMode,
    }, [signal]), recover, onMatch, settings),
    start: (hours: number) => preEntry.start(scoped(current.current), hours),
    restart: (hours: number) => preEntry.restart(scoped(current.current), hours),
    resume: async (roundId: string) => { if (canResumeScreening(roundId)) await preEntry.resume(roundId, current.current); } };
  return {workspace: workspaceMode ? {sources:workspaceSources,importRows:importWorkspaceRows,removeRows:removeWorkspaceRows,saveMonitoring:saveWorkspaceMonitoring} : undefined,signalValues,saveStaticSettings,runStaticSettings,cancelSignalValues,lockedBatch,setLockedBatch,canResumeScreening,setSourceQuality, preEntry: preEntryState, selectPreEntryRecords, account:owner,archiving,loadMonitorArchive,restoreMonitorStudy,setLibraryEntryHidden,setMonitorEntryHidden,renameLibraryEntry,deleteSources,entry, postExit, study: readyRef.current ? study : newQualityStudy(), ready: ready && readyRef.current, running, progress, filterRunning, filterProgress, filterError, warning, error, start, restart, cancel, startFilter, cancelFilter, resumeMonitoring: monitorBatch.current?.paused && canResumeBatch(monitorBatch.current.frozen) ? () => start(false, undefined, true) : undefined, resumeFiltering: filterBatch.current?.paused && canResumeBatch(filterBatch.current.frozen) ? () => startFilter(true) : undefined, clearFilterResults, clearScreeningResults, clearMonitorResults, savePlanSnapshot, savePlanTemplate, restorePlanTemplate, deletePlanTemplate, renamePlanTemplate, setRule, setCombo, setObserveHours, selectSell, setSelectedRows, setPriority, setScope, setFilters, setHoldingVetoes, setSellPlans, selectMiningRecords };
}
type CompleteFishQualityState=Omit<ReturnType<typeof useFishQuality>,'setSourceQuality'>&Partial<Pick<ReturnType<typeof useFishQuality>,'setSourceQuality'>>;
type AutomationMonitorFields = 'startAutomatic' | 'pauseAutomatic' | 'automaticRunning' | 'savedLibrary' | 'saveWorkspaceScreening' | 'savingWorkspaceDraft';
type QualityPreEntryView = Omit<CompleteFishQualityState['preEntry'], AutomationMonitorFields> & Partial<Pick<CompleteFishQualityState['preEntry'], AutomationMonitorFields>>;
export type FishQualityState=Omit<CompleteFishQualityState,'workspace'|'signalValues'|'saveStaticSettings'|'runStaticSettings'|'cancelSignalValues'|'preEntry'|'selectPreEntryRecords'|'postExit'|'entry'|'account'|'deleteSources'|'archiving'|'loadMonitorArchive'|'restoreMonitorStudy'|'setMonitorEntryHidden'|'setLibraryEntryHidden'|'renameLibraryEntry'|'clearFilterResults'|'clearScreeningResults'|'clearMonitorResults'|'savePlanSnapshot'|'restorePlanTemplate'|'savePlanTemplate'|'deletePlanTemplate'|'renamePlanTemplate'|'selectMiningRecords'|'resumeMonitoring'|'resumeFiltering'|'lockedBatch'|'setLockedBatch'|'canResumeScreening'> & Partial<Pick<CompleteFishQualityState,'workspace'|'signalValues'|'saveStaticSettings'|'runStaticSettings'|'cancelSignalValues'|'selectPreEntryRecords'|'postExit'|'entry'|'account'|'deleteSources'|'archiving'|'loadMonitorArchive'|'restoreMonitorStudy'|'setMonitorEntryHidden'|'setLibraryEntryHidden'|'renameLibraryEntry'|'clearFilterResults'|'clearScreeningResults'|'clearMonitorResults'|'savePlanSnapshot'|'restorePlanTemplate'|'savePlanTemplate'|'deletePlanTemplate'|'renamePlanTemplate'|'selectMiningRecords'|'resumeMonitoring'|'resumeFiltering'|'lockedBatch'|'setLockedBatch'|'canResumeScreening'>> & { preEntry?: QualityPreEntryView; cdaTracking?: FishCdaTracking; automaticScreening?: { paused: boolean; pending: number; awaitingMail: number; storageIssue: boolean; settings?: PreEntrySettings; saveSettings?: (plans: QualityGroup[], hours: number) => Promise<void>; setAutoPaused: (paused: boolean) => void } };

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
