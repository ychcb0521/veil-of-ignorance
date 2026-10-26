import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { importQualityFish, selectMinedRows, importQualityLibrary, newQualityStudy, migrateQualityCaptureEntries, qualityResultKey, qualityRunGroups, qualityRunSamples, qualityComparisonRows, qualityDisplayRows, type FishQualityStudy, type QualityBuyFilter, type QualityExitRule, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { enableQualityComparison, syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { loadQualityStudy, saveQualityStudy } from '@/lib/fish/qualityStore';
import { archiveQualityResult, archiveQualityStudy, markQualityDetection } from '@/lib/fish/qualityCampaignArchive';
import type { QualityHoldingVeto } from '@/lib/fish/qualityVeto';
import { beginHistoryOnlyNotifications } from '@/lib/notificationCenter';

export type QualityRunner = (options: QualityRunOptions) => Promise<void>;
/** Mounted above the collapsible fish panel so new catches are recorded while it is closed. */
const NO_SIGNALS: readonly TradeSignal[] = [];
export function useFishQuality(owner: string | undefined, signals: readonly TradeSignal[], run: QualityRunner, library: readonly TradeSignal[] = NO_SIGNALS) {
  const [study, setStudy] = useState<FishQualityStudy>(newQualityStudy), [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [warning, setWarning] = useState(''), [error, setError] = useState('');
  const [definitionNotice, setDefinitionNotice] = useState('');
  const current = useRef(study), account = useRef(owner), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const readyRef = useRef(false), latestRun = useRef(run); latestRun.current = run;
  const rerun = useRef(false);
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
    current.current = newQualityStudy(); setStudy(current.current); setDefinitionNotice('');
    void loadQualityStudy(owner).then(value => {
      if (!active || epoch !== generation.current) return;
      const archived = archiveQualityStudy(enableQualityComparison(migrateQualityCaptureEntries(value.study)));
      const migrated = syncQualitySellDefinitions(archived);
      if (migrated.sellPlans?.some((plan, i) => plan.snapshot.definitionKey !== archived.sellPlans?.[i].snapshot.definitionKey || plan.execution !== archived.sellPlans?.[i].execution)) {
        setDefinitionNotice('卖出方案已同步当前账号公式与盘中达标规则（1 分钟复原）。已有战役可在交易战役页一键纠错；原结果保留追溯。');
      }
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
    if (!owner) return;
    const epoch = generation.current;
    const refreshed = async (changedOwner?: string) => {
      if (changedOwner !== owner || !readyRef.current) return;
      const value = await loadQualityStudy(owner);
      if (epoch !== generation.current || !readyRef.current) return;
      const next = value.study.campaignRepair, prior = current.current.campaignRepair;
      if (!next || next.id === prior?.id && next.revision <= prior.revision) return;
      // Checkpoints remain durable without rerendering the full comparison matrix
      // for every trade. Refresh on the initial checkpoint, pause and completion.
      if (next.state === 'running' && prior?.id === next.id && prior.state === 'running') return;
      controller.current?.abort(); selectionApproved.current = false;
      change(() => syncQualitySellDefinitions(value.study));
    };
    const saved = (event: Event) => { void refreshed((event as CustomEvent).detail?.owner); };
    const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel('veil-quality-repair') : undefined;
    if (channel) channel.onmessage = event => { void refreshed(event.data?.owner); };
    window.addEventListener('fish-quality-repaired',saved);
    return () => { window.removeEventListener('fish-quality-repaired',saved); channel?.close(); };
  },[owner,change]);
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    if (saveTimer.current) return;
    const epoch = generation.current;
    // Throttle, not debounce: a continuous stream of catches/results must still be saved during the run.
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void saveQualityStudy(owner, current.current).then(ok => {
      if (epoch === generation.current) setWarning(ok ? '' : '鱼质量未能保存到本机；请保留此页面，系统会继续重试。');
    }); }, 400);
  }, [study, ready, owner]);
  const start = useCallback(async (automatic = false) => {
    if (current.current.campaignRepair?.state === 'running') { if (!automatic) setError('已有战役正在纠错，请先完成或暂停纠错。'); return; }
    if (!readyRef.current || !qualityRunSamples(current.current).length || automatic && !selectionApproved.current) return;
    if (!automatic) selectionApproved.current = true;
    if (controller.current) { if (controller.current.signal.aborted) rerun.current = true; return; }
    // Deep dig edits must affect the next run, including a previously complete cached trade.
    // Archive first so refreshing the active formula never rewrites an older trial's provenance.
    change(s => syncQualitySellDefinitions(archiveQualityStudy(s)));
    setDefinitionNotice('');
    const epoch = generation.current, aborter = new AbortController(); controller.current = aborter;
    const frozen = structuredClone(current.current);
    const releaseNotifications = beginHistoryOnlyNotifications();
    aborter.signal.addEventListener('abort', releaseNotifications, { once: true });
    setRunning(true); setError('');
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal, priority: () => priorityRef.current,
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
      if (controller.current === aborter) { controller.current = null; if (epoch === generation.current) { setRunning(false); if (rerun.current) { rerun.current = false; setTimeout(() => void start(true), 0); } } }
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
    if (controller.current) { rerun.current = true; return; }
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
  // 买入过滤：改条件后重算；读数按「行 + 指标」缓存，改门槛不重新取数
  const setBuyFilters = useCallback((filters: QualityBuyFilter[]) => {
    cancel(); change(s => ({ ...s, buyFilters: filters }));
    const epoch = generation.current; setTimeout(() => { if (epoch === generation.current) void start(true); }, 500);
  }, [change, cancel, start]);
  const setFilters=useCallback((filters:QualityBuyFilter[],vetoes:QualityHoldingVeto[])=>{
    cancel();change(s=>{const archived=archiveQualityStudy(s);return {...archived,buyFilters:filters,sellPlans:archived.sellPlans?.map(p=>({...p,holdingVetoes:structuredClone(vetoes)}))};});
    const epoch=generation.current;setTimeout(()=>{if(epoch===generation.current)void start();},500);
  },[cancel,change,start]);
  return { study: readyRef.current ? study : newQualityStudy(), ready: ready && readyRef.current, running, progress, warning, error, definitionNotice, start, cancel, setRule, setObserveHours, setTracking, selectSell, setCohort, setSelectedRows, setPriority, setBuyFilters, setFilters };
}
export type FishQualityState = ReturnType<typeof useFishQuality>;
