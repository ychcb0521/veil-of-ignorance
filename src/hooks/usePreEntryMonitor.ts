import { createPreEntryCheckpoint } from '@/lib/fish/preEntryCheckpoint';
import {selectedPreEntryPlan} from '@/lib/fish/preEntryActivePlan';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyPreEntryLibrary, mergePreEntryLibraries, archivePreEntrySettings, preEntryRecordPending, type PreEntryLibrary, type PreEntryRound, type PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import { loadPreEntryLibrary } from '@/lib/fish/preEntryMonitorStore';
import { loadPreEntryLibraryV2 } from '@/lib/fish/preEntryMonitorV2Store';
import { loadPreEntryLibraryV3 } from '@/lib/fish/preEntryMonitorV3Store';
import { loadPreEntryLibraryV4 } from '@/lib/fish/preEntryMonitorV4Store';
import { loadPreEntryLibraryV5 } from '@/lib/fish/preEntryMonitorV5Store';
import { loadPreEntryLibraryV6, savePreEntryLibraryV6 as savePreEntryLibrary, savePreEntryTableClears } from '@/lib/fish/preEntryMonitorV6Store';
import { withPreEntryTableClears } from '@/lib/fish/preEntryTableClears';
import { PRE_ENTRY_THREE_STAGE_VERSION, validatePreEntryThreeStage } from '@/lib/fish/preEntryThreeStage';
import { freezeQualityPlan, freezeSavedPlans, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { preEntryPlanFilters } from '@/lib/fish/preEntryIntrabar';
import { PRE_ENTRY_CONDITIONS_VERSION, validatePreEntryConditions } from '@/lib/fish/preEntryConditions';
import { activeStandaloneBuyFilters, newQualityStudy, qualityRunSamples, type FishQualityStudy, type QualityRunOptions, type QualityProgress, type QualityGroup } from '@/lib/fish/quality';

export function usePreEntryMonitor(owner: string | undefined, enabled: boolean, run: (options: QualityRunOptions) => Promise<void>) {
  const [library, setLibrary] = useState<PreEntryLibrary>(emptyPreEntryLibrary);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false);
  const [error, setError] = useState(''), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [reload, setReload] = useState(0);
  const persistence = useMemo(() => createPreEntryCheckpoint(value => savePreEntryLibrary(owner, value), true), [owner]);
  const current = useRef(library), runner = useRef(run), controller = useRef<AbortController | null>(null);
  const epoch = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>();
  const execution = useRef<Promise<void> | null>(null);
  const tableClearLock=useRef(false);
  const readyRef = useRef(false); runner.current = run;
  const commit = useCallback((value: PreEntryLibrary) => { current.current = value; setLibrary(value); }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    readyRef.current = false; setReady(false); setRunning(false); setProgress(null); setError('');
    tableClearLock.current=false;commit(emptyPreEntryLibrary());
    if (!enabled) return;
    let loaded = false;
    void Promise.all([loadPreEntryLibraryV6(owner), loadPreEntryLibraryV5(owner), loadPreEntryLibraryV4(owner), loadPreEntryLibraryV3(owner).catch(() => undefined), loadPreEntryLibraryV2(owner).catch(() => undefined), loadPreEntryLibrary(owner).catch(() => undefined)]).then(([newLibrary, v5, v4, v3, v2, legacy]) => {
      const old = mergePreEntryLibraries(mergePreEntryLibraries(mergePreEntryLibraries(legacy ?? emptyPreEntryLibrary(), v2 ?? emptyPreEntryLibrary()), v3 ?? emptyPreEntryLibrary()), v4);
      if(v4.settings) old.settings=v4.settings;
      const oldV5=mergePreEntryLibraries(old,v5);if(v5.settings)oldV5.settings=v5.settings;
      const value = mergePreEntryLibraries(oldV5, newLibrary);
      // Once v6 has its own settings, a still-open older page cannot replace
      // them merely by saving its older schema with a later timestamp.
      if (newLibrary.settings) value.settings = newLibrary.settings;
      if (epoch.current !== generation) return;
      persistence.seed(newLibrary);
      // An interrupted page has no live task. Keep its frozen conditions and cursor for explicit resume.
      const at = Date.now();
      const recovered = { ...value, rounds: value.rounds.map(r => {
        const records = value.records.filter(record => record.roundId === r.id);
        if (r.state !== 'complete' && records.length && !records.some(preEntryRecordPending)) {
          return { ...r, state: 'complete' as const, updatedAt: at };
        }
        return r.state === 'running' ? { ...r, state: 'paused' as const, updatedAt: at } : r;
      }),
        records: value.records.map(r => r.status === 'scanning' ? { ...r, status: 'paused' as const, updatedAt: at } : r) };
      commit(recovered); loaded = true; readyRef.current = true; setReady(true);
    }).catch(reason => { if (epoch.current === generation) setError(reason instanceof Error ? reason.message : '读取买前监测库失败'); });
    const flush = () => { if (loaded) void persistence.save(current.current).catch(() => undefined); };
    window.addEventListener('pagehide', flush);
    return () => {
      controller.current?.abort(); controller.current = null; flush(); epoch.current = generation + 1;
      if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
      window.removeEventListener('pagehide', flush);
    };
  }, [owner, enabled, reload, commit, persistence]);

  const execute = useCallback(async (round: PreEntryRound, study: FishQualityStudy) => {
    if (!readyRef.current || controller.current||tableClearLock.current) return;
    const generation = epoch.current, aborter = new AbortController(); controller.current = aborter;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; }); execution.current = finished;
    let lastRecordPaint = 0, lastProgressPaint = 0;
    const live = () => epoch.current === generation;
    const save = async () => {
      try { await persistence.save(current.current); }
      catch (reason) { if (live()) setError(reason instanceof Error ? reason.message : '保存失败，请保留页面并重试'); }
    };
    const scheduleSave = () => {
      if (timer.current) return;
      const handle = setTimeout(() => {
        const snapshot = current.current;
        if (!live()) { if (timer.current === handle) timer.current = undefined; return; }
        // Keep the timer occupied until storage settles. Slow disks cannot
        // accumulate a queue of copies; the next checkpoint uses the latest data.
        void save().finally(() => {
          if (timer.current !== handle) return;
          timer.current = undefined;
          if (live() && controller.current === aborter && current.current !== snapshot) scheduleSave();
        });
      }, 1500);
      timer.current = handle;
    };
    const accept = (record: PreEntryRecord) => {
      if (!live()) return;
      const next = { ...current.current, records: current.current.records.map(r => r.id === record.id ? record : r) };
      current.current = next;
      // Fast local archives must not redraw the whole combination table every scanned minute.
      if (record.status !== 'scanning' || performance.now() - lastRecordPaint >= 150) {
        lastRecordPaint = performance.now(); setLibrary(next);
      }
      scheduleSave();
    };
    setRunning(true); setProgress(null); setError('');
    commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === round.id ? { ...r, state: 'running', updatedAt: Date.now() } : r) });
    try {
      // Save the frozen batch before executing it. Storage failure must not create an unrecorded run.
      await persistence.save(current.current);
      if (!live() || aborter.signal.aborted) return;
      await runner.current({ study, signal: aborter.signal, task: 'pre-entry',
        preEntry: { round, records: current.current.records.filter(r => r.roundId === round.id), onRecord: accept },
        onProgress: p => { if (live() && (p.done === p.total || performance.now() - lastProgressPaint >= 150)) {
          lastProgressPaint = performance.now(); setProgress(p);
        } }, onResult: () => undefined });
    } catch (reason) { if (live() && !aborter.signal.aborted) setError(reason instanceof Error ? reason.message : '买前监测失败'); }
    finally {
      if (live()) {
        if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
        const records = current.current.records.filter(r => r.roundId === round.id);
        const pending = records.some(preEntryRecordPending);
        commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === round.id
          ? { ...r, state: aborter.signal.aborted || pending ? 'paused' : 'complete', updatedAt: Date.now() } : r) });
        setProgress({ done: records.filter(r => !preEntryRecordPending(r)).length, total: records.length, current: '' });
        await save(); setRunning(false);
      }
      if (controller.current === aborter) controller.current = null;
      if (execution.current === finished) execution.current = null;
      finish();
    }
  }, [commit, persistence]);
  const start = useCallback(async (study: FishQualityStudy, hours: number) => {
    if (!readyRef.current || controller.current||tableClearLock.current) return;
    const legacyFilters = activeStandaloneBuyFilters(study), samples = qualityRunSamples(study);
    let plans = current.current.settings?.plans ?? (legacyFilters.length ? [{id:'entry-original',label:'买入方案 1',metric:legacyFilters[0].metric,snapshot:legacyFilters[0].snapshot,rule:{metric:legacyFilters[0].metric,direction:legacyFilters[0].direction,threshold:legacyFilters[0].threshold},execution:'intrabar-1m' as const,buyFilters:legacyFilters.slice(1)}] : []);
    const chosen=selectedPreEntryPlan(plans);
    if(plans.length>1&&plans.some(p=>!!p.preEntryThreeStage)){if(!chosen){setError('请在条件设置中选择并保存唯一的三阶筛选方案');return;}plans=[chosen];}
    let filters;
    const threeStage=plans.some(p=>!!p.preEntryThreeStage);
    try {
      if(threeStage&&plans.some(p=>!p.preEntryThreeStage))throw Error('三阶方案与旧版方案须分别运行，不能混用版本');
      plans.forEach(p=>{if(p.preEntryThreeStage)validatePreEntryThreeStage(p.preEntryThreeStage);else validatePreEntryConditions(p.preEntryConditions);if(planVersionChanges(p).length)throw Error(`「${p.label}」的冻结版本已变化，请保留旧方案并另存新副本`);});
      filters = threeStage ? [] : plans.flatMap(preEntryPlanFilters);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '筛选条件无效'); return; }
    if (!plans.length || !threeStage&&!filters.length || !samples.length) { setError('请设置筛选条件，并勾选要监测的信号'); return; }
    if (!Number.isFinite(hours) || hours < 0 || hours > 8784) { setError('监测时长须为 0～8784 小时'); return; }
    const at = Date.now(), id = `pre-entry-${crypto.randomUUID()}`;
    const round: PreEntryRound = { id, startedAt: at, updatedAt: at, filters: structuredClone(filters), hours, state: 'running', engine: threeStage?(plans.some(p=>p.preEntryThreeStage?.version===PRE_ENTRY_THREE_STAGE_VERSION)?PRE_ENTRY_THREE_STAGE_VERSION:plans[0].preEntryThreeStage!.version):PRE_ENTRY_CONDITIONS_VERSION, plans: structuredClone(plans.map(freezeQualityPlan)) };
    const records: PreEntryRecord[] = samples.flatMap((sample, i) => plans.map(plan => ({ id: `${id}:${i}:${plan.id}`, roundId: id, planId: plan.id, sample: structuredClone(sample),
      status: 'queued' as const, startTime: sample.enteredAt ?? sample.source.timeMs, cursor: sample.enteredAt ?? sample.source.timeMs, readings: [], updatedAt: at })));
    const base=current.current.settings&&current.current.settings.plans.length>plans.length?archivePreEntrySettings(current.current,{...current.current.settings,plans:structuredClone(plans),updatedAt:at}):current.current;
    commit({...mergePreEntryLibraries(base, { version: 1, rounds: [round], records }), settings: base.settings ?? {updatedAt:at,plans:structuredClone(plans.map(freezeQualityPlan)),hours}});
    // The screening engine reads its frozen round and records, never the research history.
    // Do not duplicate hundreds of MB of unrelated results when starting a task.
    await execute(round, newQualityStudy(study.startedAt));
  }, [execute, commit]);
  const resume = useCallback(async (roundId: string, study: FishQualityStudy) => {
    const round = current.current.rounds.find(r => r.id === roundId);
    if (round) await execute(round, newQualityStudy(study.startedAt));
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
    if(plans.some(p=>!!p.preEntryThreeStage)&&plans.some(p=>!p.preEntryThreeStage))throw Error('三阶方案与旧版方案须分别保存');
    plans.forEach(p=>{if(p.preEntryThreeStage)validatePreEntryThreeStage(p.preEntryThreeStage);else{preEntryPlanFilters(p);validatePreEntryConditions(p.preEntryConditions);}});
    const settings={plans: structuredClone(freezeSavedPlans(current.current.settings?.plans,plans)), hours, updatedAt:Date.now()};
    const versions=(plans:QualityGroup[]|undefined)=>[...new Set(plans?.map(p=>p.preEntryThreeStage?.version??'legacy'))].sort().join(',');
    const changedVersion=versions(current.current.settings?.plans)!==versions(plans);
    const removedPlans=current.current.settings?.plans.some(old=>!plans.some(p=>p.id===old.id));
    const next = changedVersion||removedPlans?archivePreEntrySettings(current.current,settings):{...current.current,settings};
    commit(next);
    void persistence.save(next).catch(reason=>setError(reason instanceof Error?reason.message:'保存买入方案失败'));
  }, [commit,persistence]);
  const useSavedSettings=useCallback((id:string)=>{
    if(!readyRef.current)throw Error('入选库尚未恢复完成');
    const saved=current.current.settingsHistory?.find(s=>s.id===id);
    if(!saved)throw Error('未找到已存筛选方案集');
    const next=archivePreEntrySettings(current.current,{plans:structuredClone(saved.plans),hours:saved.hours,updatedAt:Date.now()});
    commit(next);void persistence.save(next).catch(reason=>setError(reason instanceof Error?reason.message:'保存方案集选择失败'));
  },[commit,persistence]);
  const clearTableResults=useCallback(async(extraRecords:readonly Pick<PreEntryRecord,'id'|'updatedAt'>[]=[])=>{
    if(!readyRef.current||tableClearLock.current)return false;
    const generation=epoch.current;tableClearLock.current=true;
    controller.current?.abort();await execution.current;
    if(epoch.current!==generation)return false;
    const records=[...current.current.records,...extraRecords];
    const at=records.reduce((at,r)=>Math.max(at,r.updatedAt+1,current.current.tableClears?.[r.id]??0),Date.now());
    const marks=Object.fromEntries(records.map(r=>[r.id,at]));
    try{await savePreEntryTableClears(owner,marks);if(epoch.current!==generation)return false;commit(withPreEntryTableClears(current.current,marks));setProgress(null);setError('');return true;}
    catch(reason){if(epoch.current===generation)setError(reason instanceof Error?reason.message:'清除动态筛选结果未保存');return false;}
    finally{if(epoch.current===generation)tableClearLock.current=false;}
  },[commit,owner]);
  const importLibrary=useCallback(async(value:PreEntryLibrary)=>{
    if(!readyRef.current||controller.current)return false;
    const generation=epoch.current;
    // Imported process records are historical; no task is started or resumed.
    const historical={...value,settings:undefined,rounds:value.rounds.map(r=>r.state==='running'?{...r,state:'paused' as const}:r),records:value.records.map(r=>r.status==='scanning'?{...r,status:'paused' as const}:r)};
    const next={...mergePreEntryLibraries(current.current,historical),settings:current.current.settings};
    try{await persistence.save(next);if(epoch.current!==generation)return false;commit({...mergePreEntryLibraries(current.current,next),settings:current.current.settings});return true;}catch{return false;}
  },[commit,persistence]);
  return { library, ready, running, error, progress, start, resume, restart, configure, useSavedSettings,importLibrary,clearTableResults,
    pause: () => controller.current?.abort(), retry: () => setReload(n => n + 1) };
}
