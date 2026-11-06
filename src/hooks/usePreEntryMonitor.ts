import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyPreEntryLibrary, mergePreEntryLibraries, type PreEntryLibrary, type PreEntryRound, type PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import { loadPreEntryLibrary } from '@/lib/fish/preEntryMonitorStore';
import { loadPreEntryLibraryV2 } from '@/lib/fish/preEntryMonitorV2Store';
import { loadPreEntryLibraryV3, savePreEntryLibraryV3 as savePreEntryLibrary } from '@/lib/fish/preEntryMonitorV3Store';
import { freezeQualityPlan } from '@/lib/fish/qualityPlanVersions';
import { preEntryPlanFilters } from '@/lib/fish/preEntryIntrabar';
import { PRE_ENTRY_ZERO_TRADE_VERSION } from '@/lib/fish/preEntryMonitor';
import { activeStandaloneBuyFilters, qualityRunSamples, type FishQualityStudy, type QualityRunOptions, type QualityProgress, type QualityGroup } from '@/lib/fish/quality';

export function usePreEntryMonitor(owner: string | undefined, enabled: boolean, run: (options: QualityRunOptions) => Promise<void>) {
  const [library, setLibrary] = useState<PreEntryLibrary>(emptyPreEntryLibrary);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false);
  const [error, setError] = useState(''), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [reload, setReload] = useState(0);
  const current = useRef(library), runner = useRef(run), controller = useRef<AbortController | null>(null);
  const epoch = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>();
  const execution = useRef<Promise<void> | null>(null);
  const readyRef = useRef(false); runner.current = run;
  const commit = useCallback((value: PreEntryLibrary) => { current.current = value; setLibrary(value); }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    readyRef.current = false; setReady(false); setRunning(false); setProgress(null); setError('');
    commit(emptyPreEntryLibrary());
    if (!enabled) return;
    let loaded = false;
    void Promise.all([loadPreEntryLibraryV3(owner), loadPreEntryLibraryV2(owner).catch(() => undefined), loadPreEntryLibrary(owner).catch(() => undefined)]).then(([newLibrary, v2, legacy]) => {
      const old = mergePreEntryLibraries(legacy ?? emptyPreEntryLibrary(), v2 ?? emptyPreEntryLibrary());
      const value = mergePreEntryLibraries(old, newLibrary);
      if (epoch.current !== generation) return;
      // An interrupted page has no live task. Keep its frozen conditions and cursor for explicit resume.
      const at = Date.now();
      const recovered = { ...value, rounds: value.rounds.map(r => r.state === 'running' ? { ...r, state: 'paused' as const, updatedAt: at } : r),
        records: value.records.map(r => r.status === 'scanning' ? { ...r, status: 'paused' as const, updatedAt: at } : r) };
      commit(recovered); loaded = true; readyRef.current = true; setReady(true);
    }).catch(reason => { if (epoch.current === generation) setError(reason instanceof Error ? reason.message : '读取买前监测库失败'); });
    const flush = () => { if (loaded) void savePreEntryLibrary(owner, current.current).catch(() => undefined); };
    window.addEventListener('pagehide', flush);
    return () => {
      controller.current?.abort(); controller.current = null; flush(); epoch.current = generation + 1;
      if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
      window.removeEventListener('pagehide', flush);
    };
  }, [owner, enabled, reload, commit]);

  const execute = useCallback(async (round: PreEntryRound, study: FishQualityStudy) => {
    if (!readyRef.current || controller.current) return;
    const generation = epoch.current, aborter = new AbortController(); controller.current = aborter;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; }); execution.current = finished;
    let lastRecordPaint = 0, lastProgressPaint = 0;
    const live = () => epoch.current === generation;
    const save = async () => {
      try { await savePreEntryLibrary(owner, current.current); }
      catch (reason) { if (live()) setError(reason instanceof Error ? reason.message : '保存失败，请保留页面并重试'); }
    };
    const accept = (record: PreEntryRecord) => {
      if (!live()) return;
      const next = { ...current.current, records: current.current.records.map(r => r.id === record.id ? record : r) };
      current.current = next;
      // Fast local archives must not redraw the whole combination table every scanned minute.
      if (record.status !== 'scanning' || performance.now() - lastRecordPaint >= 150) {
        lastRecordPaint = performance.now(); setLibrary(next);
      }
      if (!timer.current) timer.current = setTimeout(() => { timer.current = undefined; if (live()) void save(); }, 400);
    };
    setRunning(true); setProgress(null); setError('');
    commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === round.id ? { ...r, state: 'running', updatedAt: Date.now() } : r) });
    try {
      // Save the frozen batch before executing it. Storage failure must not create an unrecorded run.
      await savePreEntryLibrary(owner, current.current);
      if (!live() || aborter.signal.aborted) return;
      await runner.current({ study, signal: aborter.signal, task: 'pre-entry',
        preEntry: { round, records: current.current.records.filter(r => r.roundId === round.id), onRecord: accept },
        onProgress: p => { if (live() && (p.done === p.total || performance.now() - lastProgressPaint >= 150)) {
          lastProgressPaint = performance.now(); setProgress(p);
        } }, onResult: () => undefined });
    } catch (reason) { if (live() && !aborter.signal.aborted) setError(reason instanceof Error ? reason.message : '买前监测失败'); }
    finally {
      if (live()) {
        const pending = current.current.records.some(r => r.roundId === round.id && ['queued', 'paused', 'scanning', 'error'].includes(r.status));
        commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === round.id
          ? { ...r, state: aborter.signal.aborted || pending ? 'paused' : 'complete', updatedAt: Date.now() } : r) });
        await save(); setRunning(false);
      }
      if (controller.current === aborter) controller.current = null;
      if (execution.current === finished) execution.current = null;
      finish();
    }
  }, [owner, commit]);
  const start = useCallback(async (study: FishQualityStudy, hours: number) => {
    if (!readyRef.current || controller.current) return;
    const legacyFilters = activeStandaloneBuyFilters(study), samples = qualityRunSamples(study);
    const plans = current.current.settings?.plans ?? (legacyFilters.length ? [{id:'entry-original',label:'买入方案 1',metric:legacyFilters[0].metric,snapshot:legacyFilters[0].snapshot,rule:{metric:legacyFilters[0].metric,direction:legacyFilters[0].direction,threshold:legacyFilters[0].threshold},execution:'intrabar-1m' as const,buyFilters:legacyFilters.slice(1)}] : []);
    let filters;
    try { filters = plans.flatMap(preEntryPlanFilters); } catch (cause) { setError(cause instanceof Error ? cause.message : '买入条件无效'); return; }
    if (!filters.length || !samples.length) { setError('请启用买前过滤条件，并勾选要监测的信号'); return; }
    if (!Number.isFinite(hours) || hours < 0 || hours > 8784) { setError('监测时长须为 0～8784 小时'); return; }
    const at = Date.now(), id = `pre-entry-${crypto.randomUUID()}`;
    const round: PreEntryRound = { id, startedAt: at, updatedAt: at, filters: structuredClone(filters), hours, state: 'running', engine: PRE_ENTRY_ZERO_TRADE_VERSION, plans: structuredClone(plans.map(freezeQualityPlan)) };
    const records: PreEntryRecord[] = samples.flatMap((sample, i) => plans.map(plan => ({ id: `${id}:${i}:${plan.id}`, roundId: id, planId: plan.id, sample: structuredClone(sample),
      status: 'queued' as const, startTime: sample.enteredAt ?? sample.source.timeMs, cursor: sample.enteredAt ?? sample.source.timeMs, readings: [], updatedAt: at })));
    commit({...mergePreEntryLibraries(current.current, { version: 1, rounds: [round], records }), settings: current.current.settings ?? {updatedAt:at,plans:structuredClone(plans.map(freezeQualityPlan)),hours}});
    await execute(round, structuredClone(study));
  }, [execute, commit]);
  const resume = useCallback(async (roundId: string, study: FishQualityStudy) => {
    const round = current.current.rounds.find(r => r.id === roundId);
    if (round) await execute(round, structuredClone(study));
  }, [execute]);
  const restart = useCallback(async (study: FishQualityStudy, hours: number) => {
    const generation = epoch.current, pending = execution.current;
    controller.current?.abort();
    await pending;
    if (epoch.current === generation) await start(study, hours);
  }, [start]);
  const configure = useCallback((plans: QualityGroup[], hours: number) => {
    if (!readyRef.current) throw Error('入选库尚未恢复完成');
    if (!Number.isFinite(hours) || hours < 0 || hours > 8784) throw Error('筛选时长须为 0～8784 小时');
    plans.forEach(preEntryPlanFilters);
    const next = {...current.current, settings: {plans: structuredClone(plans.map(freezeQualityPlan)), hours, updatedAt:Date.now()}};
    commit(next);
    void savePreEntryLibrary(owner,next).catch(reason=>setError(reason instanceof Error?reason.message:'保存买入方案失败'));
  }, [commit,owner]);
  return { library, ready, running, error, progress, start, resume, restart, configure,
    pause: () => controller.current?.abort(), retry: () => setReload(n => n + 1) };
}
