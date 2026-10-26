import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { importQualityFish, materializePlanBuyFilters, qualityFilterNeedsData, selectMinedRows, importQualityLibrary, newQualityStudy, migrateQualityCaptureEntries, qualityResultKey, qualityRunGroups, qualityRunSamples, qualityComparisonRows, qualityDisplayRows, type FishQualityStudy, type QualityBuyFilter, type QualityExitRule, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { enableQualityComparison, syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { loadQualityStudy, saveQualityStudy } from '@/lib/fish/qualityStore';
import { archiveQualityResult, archiveQualityStudy, markQualityDetection } from '@/lib/fish/qualityCampaignArchive';
import { holdingVetoIdentity, type QualityHoldingVeto } from '@/lib/fish/qualityVeto';
import { beginHistoryOnlyNotifications } from '@/lib/notificationCenter';

export type QualityRunner = (options: QualityRunOptions) => Promise<void>;
/** Mounted above the collapsible fish panel so new catches are recorded while it is closed. */
const NO_SIGNALS: readonly TradeSignal[] = [];
export function useFishQuality(owner: string | undefined, signals: readonly TradeSignal[], run: QualityRunner, library: readonly TradeSignal[] = NO_SIGNALS) {
  const [study, setStudy] = useState<FishQualityStudy>(newQualityStudy), [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [warning, setWarning] = useState(''), [error, setError] = useState('');
  const current = useRef(study), account = useRef(owner), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const readyRef = useRef(false), latestRun = useRef(run); latestRun.current = run;
  const rerun = useRef<false | 'refresh' | NonNullable<QualityRunOptions['mode']>>(false);
  const selectionApproved = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Updates to an old account must never appear in or save into the newly selected one.
  if (account.current !== owner) { account.current = owner; readyRef.current = false; generation.current++; controller.current?.abort(); }
  const change = useCallback((apply: (s: FishQualityStudy) => FishQualityStudy) => {
    const next = apply(current.current); if (next !== current.current) { current.current = next; setStudy(next); }
  }, []);
  useEffect(() => {
    let active = true, loaded = false; const epoch = ++generation.current;
    readyRef.current = false; rerun.current = false; selectionApproved.current = false; setReady(false); setRunning(false); setProgress(null); setError(''); setWarning('');
    current.current = newQualityStudy(); setStudy(current.current);
    void loadQualityStudy(owner).then(value => {
      if (!active || epoch !== generation.current) return;
      const archived = archiveQualityStudy(enableQualityComparison(migrateQualityCaptureEntries(value.study)));
      // 【用户要求】2026-10-26 盘面保持干净：卖出方案静默同步当前账号公式，不再显示同步提示
      const migrated = syncQualitySellDefinitions(archived);
      const savedSelection = new Set(Array.isArray(migrated.selectedRowIds) ? migrated.selectedRowIds : []);
      const restored = { ...migrated, selectedRowIds: qualityDisplayRows(migrated).filter(r => savedSelection.has(r.id) || savedSelection.has(r.signalId!)).map(r => r.id) };
      current.current = restored; setStudy(restored); setWarning(value.warning ?? ''); readyRef.current = true; loaded = true; setReady(true);
    });
    const flush = () => { if (loaded) void saveQualityStudy(owner, current.current); };
    window.addEventListener('pagehide', flush);
    return () => { active = false; readyRef.current = false; controller.current?.abort(); controller.current = null; if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } window.removeEventListener('pagehide', flush); flush(); };
  }, [owner]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityFish(s, signals)); }, [signals, ready, study.tracking, change]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityLibrary(s, library)); }, [library, ready, study.tracking, change]);
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
    if (!readyRef.current || !qualityRunSamples(current.current).length || automatic && !selectionApproved.current && !mode) return;
    if (!automatic) selectionApproved.current = true;
    if (controller.current) { if (controller.current.signal.aborted) rerun.current = mode ?? 'refresh'; return; }
    if (mode && !qualityFilterNeedsData(current.current, mode)) { setProgress(null); setError(''); return; }
    // Deep dig edits must affect the next run, including a previously complete cached trade.
    // Archive first so refreshing the active formula never rewrites an older trial's provenance.
    if (!mode) change(s => syncQualitySellDefinitions(archiveQualityStudy(s)));
    const epoch = generation.current, aborter = new AbortController(); controller.current = aborter;
    const frozen = structuredClone(current.current);
    const releaseNotifications = beginHistoryOnlyNotifications();
    aborter.signal.addEventListener('abort', releaseNotifications, { once: true });
    setRunning(true); setError('');
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal, mode, priority: () => priorityRef.current,
        onProgress: p => { if (epoch === generation.current && !aborter.signal.aborted) setProgress(p); },
        onFilterReading: reading => {
          if (epoch !== generation.current || aborter.signal.aborted) return;
          change(s => ({ ...s, filterReadings: [...(s.filterReadings ?? []).filter(r => r.key !== reading.key), reading] }));
        },
        onResult: result => {
          if (epoch !== generation.current || aborter.signal.aborted) return;
          change(s => {
            const sample = qualityRunSamples(s).find(v => v.id === result.sampleId), group = qualityRunGroups(s).find(v => v.id === result.groupId);
            if (!sample || !group || qualityResultKey(sample, group, s.observeHours) !== result.key) return s;
            return archiveQualityResult({ ...s, results: [...s.results.filter(r => r.sampleId !== result.sampleId || r.groupId !== result.groupId), result] }, result);
          });
        },
      });
    } catch (e) { if (epoch === generation.current && !aborter.signal.aborted) setError(e instanceof Error ? e.message : '评估失败'); }
    finally {
      aborter.signal.removeEventListener('abort', releaseNotifications); releaseNotifications();
      if (controller.current === aborter) { controller.current = null; if (epoch === generation.current) { setRunning(false); if (rerun.current) { const queued = rerun.current; rerun.current = false; setTimeout(() => void start(true, queued === 'refresh' ? undefined : queued), 0); } } }
    }
  }, [change]);
  const cancel = useCallback(() => { controller.current?.abort(); }, []);
  // 挖掘到的鱼：导入后自动勾选并评估（挖掘是用户主动开始的，算作已确认运行）
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    let picked = false;
    change(s => { const next = selectMinedRows(s); picked = next !== s; return next; });
    if (!picked) return;
    selectionApproved.current = true;
    if (controller.current) { rerun.current = 'refresh'; return; }
    const epoch = generation.current; setTimeout(() => { if (epoch === generation.current) void start(true); }, 500);
  }, [study.samples, ready, change, start]);
  // 界面告诉评估先算哪些行（看得见的在前）；只存引用，不触发重渲染
  const priorityRef = useRef<readonly string[]>([]);
  const setPriority = useCallback((ids: readonly string[]) => { priorityRef.current = ids; }, []);
  // Importing remains automatic; periodic evaluation requires an explicitly started selection.
  useEffect(() => {
    if (!ready || !study.tracking) return;
    const interval = setInterval(() => void start(true), 60_000);
    return () => clearInterval(interval);
  }, [ready, study.tracking, start]);
  useEffect(() => {
    if (!ready || !warning) return;
    const timer = setInterval(() => { void saveQualityStudy(owner, current.current).then(ok => { if (ok && account.current === owner) setWarning(''); }); }, 15_000);
    return () => clearInterval(timer);
  }, [ready, warning, owner]);
  const setRule = useCallback((id: string, rule?: QualityExitRule) => {
    cancel(); change(s => ({ ...s, groups: s.groups.map(g => g.id === id ? { ...g, rule } : g), sellPlans: s.sellPlans?.map(g => g.id === id ? { ...g, rule } : g), selectedSellId: s.selectedSellId === id ? undefined : s.selectedSellId }));
    const epoch = generation.current; setTimeout(() => { if (epoch === generation.current) void start(); }, 500);
  }, [change, cancel, start]);
  const setObserveHours = useCallback((hours: number) => { cancel(); change(s => ({ ...s, observeHours: hours })); const epoch = generation.current; setTimeout(() => { if (epoch === generation.current) void start(true); }, 500); }, [change, cancel, start]);
  const setTracking = useCallback((tracking: boolean) => { if (!tracking) cancel(); change(s => ({ ...s, tracking })); }, [change, cancel]);
  const selectSell = useCallback((id: string) => change(s => markQualityDetection(s, id)), [change]);
  const setCohort = useCallback((ids?: string[]) => {
    cancel(); change(s => ({ ...s, cohortIds: ids ? qualityComparisonRows(s).filter(r => ids.includes(r.id)).map(r => r.id) : undefined }));
    const epoch = generation.current; setTimeout(() => { if (epoch === generation.current) void start(true); }, 500);
  }, [change, cancel, start]);
  const setSelectedRows = useCallback((ids: string[]) => {
    selectionApproved.current = false; rerun.current = false; cancel();
    const selected = new Set(ids);
    change(s => ({ ...s, selectedRowIds: qualityDisplayRows(s).filter(r => selected.has(r.id) || selected.has(r.signalId!)).map(r => r.id) }));
  }, [change, cancel]);
  // 各方案独立过滤，买入条件只筛选已有结果；持仓否决变化才重新评估卖出。
  const setFilters = useCallback((planId: string, filters: QualityBuyFilter[], vetoes: QualityHoldingVeto[]) => {
    const plan = current.current.sellPlans?.find(p => p.id === planId);
    if (!plan) return;
    const sellChanged = JSON.stringify(holdingVetoIdentity(plan.holdingVetoes)) !== JSON.stringify(holdingVetoIdentity(vetoes));
    cancel();
    change(s => {
      const saved = materializePlanBuyFilters(sellChanged ? archiveQualityStudy(s) : s);
      return { ...saved, sellPlans: saved.sellPlans?.map(p => p.id === planId ? { ...p, buyFilters: structuredClone(filters), holdingVetoes: structuredClone(vetoes) } : p) };
    });
    const epoch = generation.current;
    setTimeout(() => { if (epoch === generation.current) void start(!sellChanged, sellChanged ? undefined : selectionApproved.current ? 'filter' : 'filter-only'); }, 500);
  }, [cancel, change, start]);
  return { study: readyRef.current ? study : newQualityStudy(), ready: ready && readyRef.current, running, progress, warning, error, start, cancel, setRule, setObserveHours, setTracking, selectSell, setCohort, setSelectedRows, setPriority, setFilters };
}
export type FishQualityState = ReturnType<typeof useFishQuality>;
