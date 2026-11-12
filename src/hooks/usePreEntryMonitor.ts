import { createPreEntryCheckpoint } from '@/lib/fish/preEntryCheckpoint';
import {newPreEntryHours, selectedPreEntryPlan} from '@/lib/fish/preEntryActivePlan';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyPreEntryLibrary, mergePreEntryLibraries, archivePreEntrySettings, preEntryRecordPending, type PreEntryLibrary, type PreEntryRound, type PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import { loadPreEntryLibrary } from '@/lib/fish/preEntryMonitorStore';
import { loadPreEntryLibraryV2 } from '@/lib/fish/preEntryMonitorV2Store';
import { loadPreEntryLibraryV3 } from '@/lib/fish/preEntryMonitorV3Store';
import { loadPreEntryLibraryV4 } from '@/lib/fish/preEntryMonitorV4Store';
import { loadPreEntryLibraryV5 } from '@/lib/fish/preEntryMonitorV5Store';
import { loadPreEntryLibraryV6, loadPreEntryWorkspaceDraft, savePreEntryWorkspaceDraft, discardPublishedWorkspaceDraft, savePreEntryLibraryV6 as savePreEntryLibrary, savePreEntryTableClears } from '@/lib/fish/preEntryMonitorV6Store';
import { withPreEntryTableClears } from '@/lib/fish/preEntryTableClears';
import { readAutomaticPreEntryCheckpoint } from '@/lib/fish/preEntryPersistence';
import {projectPreEntryBatch} from '@/lib/fish/preEntryArchiveClient';
import { usesSignalTimeGate, PRE_ENTRY_THREE_STAGE_VERSION, validatePreEntryThreeStage } from '@/lib/fish/preEntryThreeStage';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import { freezeQualityPlan, freezeSavedPlans, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { preEntryPlanFilters } from '@/lib/fish/preEntryIntrabar';
import { PRE_ENTRY_CONDITIONS_VERSION, validatePreEntryConditions } from '@/lib/fish/preEntryConditions';
import { activeStandaloneBuyFilters, newQualityStudy, qualityRunSamples, type FishQualityStudy, type QualityRunOptions, type QualityProgress, type QualityGroup } from '@/lib/fish/quality';

export function usePreEntryMonitor(owner: string | undefined, enabled: boolean, run: (options: QualityRunOptions) => Promise<void>, workspaceMode = false) {
  const [library, setLibrary] = useState<PreEntryLibrary>(emptyPreEntryLibrary);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false);
  const [automaticRunning, setAutomaticRunning] = useState(false);
  const [error, setError] = useState(''), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [reload, setReload] = useState(0);
  const current = useRef(library), runner = useRef(run), controller = useRef<AbortController | null>(null);
  const epoch = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>();
  const persistence = useMemo(() => createPreEntryCheckpoint(async value => {
    if (!workspaceMode) return savePreEntryLibrary(owner,value);
    const draftIds = new Set(current.current.rounds.filter(round => round.workspaceDraft).map(round => round.id));
    const drafts = {version:1 as const,rounds:value.rounds.filter(round => draftIds.has(round.id)),records:value.records.filter(record => draftIds.has(record.roundId))};
    if (drafts.rounds.length || drafts.records.length) await savePreEntryWorkspaceDraft(owner,drafts);
    const saved = {...value,rounds:value.rounds.filter(round => !draftIds.has(round.id)),records:value.records.filter(record => !draftIds.has(record.roundId))};
    if (saved.rounds.length || saved.records.length || saved.settings || saved.settingsHistory || saved.directoryEdits || saved.tableClears) await savePreEntryLibrary(owner,saved);
  },true), [owner,workspaceMode]);
  const execution = useRef<Promise<void> | null>(null);
  const savingDraft = useRef(false);
  const [savingWorkspaceDraft,setSavingWorkspaceDraft] = useState(false);
  const tableClearLock=useRef(false);
  const readyRef = useRef(false); runner.current = run;
  const commit = useCallback((value: PreEntryLibrary) => { current.current = value; setLibrary(value); }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    readyRef.current = false; setReady(false); setRunning(false); setAutomaticRunning(false); setProgress(null); setError('');
    tableClearLock.current=false;savingDraft.current=false;setSavingWorkspaceDraft(false);commit(emptyPreEntryLibrary());
    if (!enabled) return;
    let loaded = false;
    void Promise.all([loadPreEntryLibraryV6(owner,preview=>{if(epoch.current===generation)commit(preview);},reload>0), loadPreEntryLibraryV5(owner), loadPreEntryLibraryV4(owner), loadPreEntryLibraryV3(owner).catch(() => undefined), loadPreEntryLibraryV2(owner).catch(() => undefined), loadPreEntryLibrary(owner).catch(() => undefined),workspaceMode ? loadPreEntryWorkspaceDraft(owner) : undefined]).then(async([newLibrary, v5, v4, v3, v2, legacy, draft]) => {
      const old = mergePreEntryLibraries(mergePreEntryLibraries(mergePreEntryLibraries(legacy ?? emptyPreEntryLibrary(), v2 ?? emptyPreEntryLibrary()), v3 ?? emptyPreEntryLibrary()), v4);
      if(v4.settings) old.settings=v4.settings;
      const oldV5=mergePreEntryLibraries(old,v5);if(v5.settings)oldV5.settings=v5.settings;
      const saved = mergePreEntryLibraries(oldV5,newLibrary);
      const published = new Set(saved.rounds.map(round => round.id));
      const drafts = draft && {...draft,rounds:draft.rounds.filter(round => !published.has(round.id)),records:draft.records.filter(record => !published.has(record.roundId))};
      const value = drafts ? mergePreEntryLibraries(saved,drafts) : saved;
      const cold=value.records.filter(r=>!r.processRef&&(r.exclusionProcess?.entries.length??0)>16);
      if(cold.length){const projected=await projectPreEntryBatch(owner,cold),byId=new Map(projected.map(r=>[r.id,r]));value.records=value.records.map(r=>byId.get(r.id)??r);}
      // Once v6 has its own settings, a still-open older page cannot replace
      // them merely by saving its older schema with a later timestamp.
      if (newLibrary.settings) value.settings = newLibrary.settings;
      if (epoch.current !== generation) return;
      persistence.seed(drafts ? mergePreEntryLibraries(newLibrary,drafts) : newLibrary);
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
  }, [owner, enabled, reload, commit, persistence, workspaceMode]);

  const execute = useCallback(async (round: PreEntryRound, study: FishQualityStudy) => {
    if (!readyRef.current || controller.current||tableClearLock.current||savingDraft.current) return;
    const generation = epoch.current, aborter = new AbortController(); controller.current = aborter;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; }); execution.current = finished;
    let lastRecordPaint = 0, lastProgressPaint = 0;
    const live = () => epoch.current === generation;
    const save = async () => {
      try {
        const snapshot=current.current;
        await persistence.save(snapshot);
        if(!live())return;
        // Release finished histories throughout a long batch, after durability
        // is acknowledged. A late callback must never replace a newer row.
        const currentRows=new Map(current.current.records.map(r=>[r.id,r]));
        const cold=snapshot.records.filter(r=>!preEntryRecordPending(r)&&!r.processRef&&(r.exclusionProcess?.entries.length??0)>16&&currentRows.get(r.id)===r);
        if(cold.length){
          const projected=await projectPreEntryBatch(owner,cold),byId=new Map(cold.map((r,i)=>[r.id,{before:r,after:projected[i]}]));
          if(live()){persistence.project(cold,projected);commit({...current.current,records:current.current.records.map(r=>byId.get(r.id)?.before===r?byId.get(r.id)!.after:r)});}
        }
      }
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
    setRunning(true); setAutomaticRunning(!!round.automatic); setProgress(null); setError('');
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
        await save();
        setRunning(false); setAutomaticRunning(false);
      }
      if (controller.current === aborter) controller.current = null;
      if (execution.current === finished) execution.current = null;
      finish();
    }
  }, [commit, persistence, owner]);
  const start = useCallback(async (study: FishQualityStudy, hours: number, automaticId?: string, recover = false) => {
    if (!readyRef.current || controller.current||tableClearLock.current||savingDraft.current) return;
    if (automaticId) {
      if (owner && recover) {
        const generation = epoch.current;
        const saved = await readAutomaticPreEntryCheckpoint(owner, automaticId);
        if (generation !== epoch.current || !readyRef.current || controller.current || tableClearLock.current) return;
        if (saved) commit(mergePreEntryLibraries(current.current, saved));
      }
      const existing = current.current.rounds.find(round => round.id === automaticId);
      if (existing) {
        if (current.current.records.some(record => record.roundId === automaticId && (preEntryRecordPending(record) || record.status === 'error'))) {
          await execute(existing, newQualityStudy(study.startedAt));
        }
        return;
      }
      if (!current.current.settings?.plans.length) return;
    }
    const legacyFilters = activeStandaloneBuyFilters(study), samples = qualityRunSamples(study);
    let plans = current.current.settings?.plans ?? (legacyFilters.length ? [{id:'entry-original',label:'买入方案 1',metric:legacyFilters[0].metric,snapshot:legacyFilters[0].snapshot,rule:{metric:legacyFilters[0].metric,direction:legacyFilters[0].direction,threshold:legacyFilters[0].threshold},execution:'intrabar-1m' as const,buyFilters:legacyFilters.slice(1)}] : []);
    const chosen=selectedPreEntryPlan(plans);
    if(plans.length>1&&(automaticId||plans.some(p=>!!p.preEntryThreeStage))){if(!chosen){setError('请在条件设置中选择并保存唯一的筛选方案');return;}plans=[chosen];}
    let filters;
    const threeStage=plans.some(p=>!!p.preEntryThreeStage);
    try {
      if(threeStage&&plans.some(p=>!p.preEntryThreeStage))throw Error('三阶方案与旧版方案须分别运行，不能混用版本');
      plans.forEach(p=>{if(p.preEntryThreeStage)validatePreEntryThreeStage(p.preEntryThreeStage);else validatePreEntryConditions(p.preEntryConditions);if(planVersionChanges(p).length)throw Error(`「${p.label}」的冻结版本已变化，请保留旧方案并另存新副本`);});
      filters = threeStage ? [] : plans.flatMap(preEntryPlanFilters);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '筛选条件无效'); return; }
    if (!plans.length || !threeStage&&!filters.length || !samples.length) { setError('请设置筛选条件，并勾选要监测的信号'); return; }
    if (!Number.isFinite(hours) || hours < 0 || hours > 8784) { setError('监测时长须为 0～8784 小时'); return; }
    const at = Date.now(), id = automaticId ?? `pre-entry-${crypto.randomUUID()}`;
    const round: PreEntryRound = { id, startedAt: at, updatedAt: at, filters: structuredClone(filters), hours, state: 'running', engine: threeStage?(plans.some(p=>p.preEntryThreeStage?.version===PRE_ENTRY_THREE_STAGE_VERSION)?PRE_ENTRY_THREE_STAGE_VERSION:plans[0].preEntryThreeStage!.version):PRE_ENTRY_CONDITIONS_VERSION, plans: structuredClone(plans.map(freezeQualityPlan)), ...(automaticId ? { automatic: true } : workspaceMode ? {workspaceDraft:true as const} : {}) };
    const records: PreEntryRecord[] = samples.flatMap((sample, i) => plans.map(plan => {
      const startTime = usesSignalTimeGate(round.engine) ? qualitySignalTime(sample.source) : sample.enteredAt ?? sample.source.timeMs;
      return { id: `${id}:${i}:${plan.id}`, roundId: id, planId: plan.id, sample: structuredClone(sample),
        status: 'queued' as const, startTime, cursor: startTime, readings: [], updatedAt: at };
    }));
    const base=!automaticId&&current.current.settings&&current.current.settings.plans.length>plans.length?archivePreEntrySettings(current.current,{...current.current.settings,plans:structuredClone(plans),updatedAt:at}):current.current;
    commit({...mergePreEntryLibraries(base, { version: 1, rounds: [round], records }), settings: base.settings ?? {updatedAt:at,plans:structuredClone(plans.map(freezeQualityPlan)),hours}});
    // The screening engine reads its frozen round and records, never the research history.
    // Do not duplicate hundreds of MB of unrelated results when starting a task.
    await execute(round, newQualityStudy(study.startedAt));
  }, [execute, commit, owner, workspaceMode]);
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
  const savedLibrary = useMemo(() => {
    const draftIds = new Set(library.rounds.filter(round => round.workspaceDraft).map(round => round.id));
    return !draftIds.size ? library : {...library,rounds:library.rounds.filter(round => !draftIds.has(round.id)),records:library.records.filter(record => !draftIds.has(record.roundId))};
  },[library]);
  const saveWorkspaceScreening = useCallback(async () => {
    if (!readyRef.current || savingDraft.current) return false;
    const completed = current.current.rounds.filter(round => round.workspaceDraft && round.state === 'complete');
    if (!completed.length) return false;
    const generation = epoch.current;
    const rounds = completed.map(({workspaceDraft,...round}) => ({...round,workspaceSaved:true as const,updatedAt:Math.max(Date.now(),round.updatedAt+1)}));
    const ids = new Set(rounds.map(round => round.id));
    const records = current.current.records.filter(record => ids.has(record.roundId));
    savingDraft.current = true;setSavingWorkspaceDraft(true);setError('');
    try {
      await savePreEntryLibrary(owner,{version:1,rounds,records});
      if (generation !== epoch.current) return false;
      commit({...current.current,rounds:current.current.rounds.map(round => rounds.find(saved => saved.id === round.id) ?? round)});
      void discardPublishedWorkspaceDraft(owner,ids,records.map(record=>record.id)).catch(()=>undefined);
      return true;
    } catch (cause) {
      if (generation === epoch.current) setError(cause instanceof Error ? cause.message : '保存筛选结果失败');
      return false;
    } finally {
      if (generation === epoch.current) {savingDraft.current=false;setSavingWorkspaceDraft(false);}
    }
  },[commit,owner]);
  return { library, savedLibrary, saveWorkspaceScreening, savingWorkspaceDraft, ready, running, automaticRunning, error, progress, start, resume, restart, configure, useSavedSettings,importLibrary,clearTableResults,
    startAutomatic: (id: string, study: FishQualityStudy, recover: boolean) => start(study, newPreEntryHours(current.current.settings?.hours), id, recover),
    pause: () => controller.current?.abort(), retry: () => setReload(n => n + 1) };
}
