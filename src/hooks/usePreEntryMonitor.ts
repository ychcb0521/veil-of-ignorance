import { signalDedupKey } from '@/lib/signalLibrary';
import {readFishLibrary} from '@/lib/fish/libraryLoadQueue';
import { reserveInstantAdmission } from '@/lib/fish/instantAdmission';
import { freezeLivePositionBudget, readInstantPositionSettings } from '@/lib/fish/instantPositionSettings';
import { readInstantMonitorSettings } from '@/lib/fish/instantMonitorSettings';
import { createPreEntryCheckpoint } from '@/lib/fish/preEntryCheckpoint';
import {newPreEntryHours, selectedPreEntryPlan} from '@/lib/fish/preEntryActivePlan';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyPreEntryLibrary, isAutomaticPreEntryRound, mergePreEntryLibraries, archivePreEntrySettings, preEntryRecordPending, type PreEntryLibrary, type PreEntryRound, type PreEntryRecord, type PreEntrySettings } from '@/lib/fish/preEntryMonitor';
import { loadPreEntryLibrary } from '@/lib/fish/preEntryMonitorStore';
import { loadPreEntryLibraryV2 } from '@/lib/fish/preEntryMonitorV2Store';
import { loadPreEntryLibraryV3 } from '@/lib/fish/preEntryMonitorV3Store';
import { loadPreEntryLibraryV4 } from '@/lib/fish/preEntryMonitorV4Store';
import { loadPreEntryLibraryV5 } from '@/lib/fish/preEntryMonitorV5Store';
import { loadPreEntryLibraryV6, loadPreEntryWorkspaceDraft, savePreEntryWorkspaceDraft, discardPublishedWorkspaceDraft, savePreEntryLibraryV6 as savePreEntryLibrary, savePreEntryTableClears } from '@/lib/fish/preEntryMonitorV6Store';
import { withPreEntryTableClears } from '@/lib/fish/preEntryTableClears';
import { readActiveInstantRecordIds } from '@/lib/fish/instantCampaignStore';
import { readAutomaticPreEntryCheckpoint, readOpenAdmissionCheckpoints } from '@/lib/fish/preEntryPersistence';
import {projectPreEntryBatch} from '@/lib/fish/preEntryArchiveClient';
import { usesSignalTimeGate, PRE_ENTRY_THREE_STAGE_VERSION, validatePreEntryThreeStage } from '@/lib/fish/preEntryThreeStage';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import { freezeQualityPlan, freezeSavedPlans, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { preEntryPlanFilters } from '@/lib/fish/preEntryIntrabar';
import { PRE_ENTRY_CONDITIONS_VERSION, validatePreEntryConditions } from '@/lib/fish/preEntryConditions';
import { activeStandaloneBuyFilters, newQualityStudy, qualityRunSamples, type FishQualityStudy, type QualityRunOptions, type QualityProgress, type QualityGroup } from '@/lib/fish/quality';

export type AutomaticScreeningMatch = { record: PreEntryRecord; round: PreEntryRound };
type ScreeningLane = { controller?: AbortController; execution?: Promise<void>; timer?: ReturnType<typeof setTimeout> };

export function usePreEntryMonitor(owner: string | undefined, enabled: boolean, run: (options: QualityRunOptions) => Promise<void>, workspaceMode = false, isolatedWorkspace = false) {
  const [library, setLibrary] = useState<PreEntryLibrary>(emptyPreEntryLibrary);
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false);
  const [automaticRunning, setAutomaticRunning] = useState(false);
  const [automaticError, setAutomaticError] = useState('');
  const [error, setError] = useState(''), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<PreEntryLibrary>();
  const [instantReady, setInstantReady] = useState(false);
  const [instantLoadError, setInstantLoadError] = useState('');
  const [missingCheckpoint, setMissingCheckpoint] = useState<string>();
  const [libraryOwner, setLibraryOwner] = useState(owner);
  const instantReadyRef = useRef(false);
  const current = useRef(library), runner = useRef(run);
  const unconfirmedAdmissions = useRef(new Map<string, PreEntryRound>());
  const lanes = useRef<{ manual: ScreeningLane; automatic: ScreeningLane }>({ manual: {}, automatic: {} });
  const epoch = useRef(0);
  const persistence = useMemo(() => createPreEntryCheckpoint(async value => {
    if(isolatedWorkspace)return savePreEntryWorkspaceDraft(owner,value);
    if (!workspaceMode) return savePreEntryLibrary(owner,value);
    const draftIds = new Set(current.current.rounds.filter(round => round.workspaceDraft).map(round => round.id));
    const drafts = {version:1 as const,rounds:value.rounds.filter(round => draftIds.has(round.id)),records:value.records.filter(record => draftIds.has(record.roundId))};
    if (drafts.rounds.length || drafts.records.length) await savePreEntryWorkspaceDraft(owner,drafts);
    const saved = {...value,rounds:value.rounds.filter(round => !draftIds.has(round.id)),records:value.records.filter(record => !draftIds.has(record.roundId))};
    if (saved.rounds.length || saved.records.length || saved.settings || saved.settingsHistory || saved.directoryEdits || saved.tableClears) await savePreEntryLibrary(owner,saved);
  },true), [owner,workspaceMode,isolatedWorkspace]);
  const savingDraft = useRef(false);
  const [savingWorkspaceDraft,setSavingWorkspaceDraft] = useState(false);
  const tableClearLock=useRef(false);
  const readyRef = useRef(false); runner.current = run;
  const commit = useCallback((value: PreEntryLibrary) => { current.current = value; setLibrary(value); }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    unconfirmedAdmissions.current.clear(); setMissingCheckpoint(undefined); setLibraryOwner(owner);
    readyRef.current = false; setReady(false); setRunning(false); setAutomaticRunning(false); setAutomaticError(''); setProgress(null); setError('');
    tableClearLock.current=false;savingDraft.current=false;setSavingWorkspaceDraft(false);commit(emptyPreEntryLibrary());
    setPreview(undefined); setInstantReady(false); setInstantLoadError(''); instantReadyRef.current = false;
    let reading = false, retryPositions: ReturnType<typeof setTimeout>;
    const restorePositions = async () => {
      if (isolatedWorkspace || !owner || !workspaceMode || typeof indexedDB === 'undefined' || reading || instantReadyRef.current || readyRef.current) return;
      reading = true; clearTimeout(retryPositions);
      try {
        const ids = await readActiveInstantRecordIds(owner);
        const active = await readOpenAdmissionCheckpoints(owner, ids);
        if (epoch.current !== generation || readyRef.current) return;
        if (active.records.length) commit(mergePreEntryLibraries(current.current, active));
        instantReadyRef.current = true; setInstantReady(true); setInstantLoadError('');
      } catch (cause) {
        if (epoch.current === generation && !readyRef.current) {
          setInstantLoadError(cause instanceof Error ? cause.message : '即时持仓记录读取失败');
          retryPositions = setTimeout(restorePositions, 30_000);
        }
      } finally { reading = false; }
    };
    void restorePositions();
    window.addEventListener('focus', restorePositions);
    window.addEventListener('online', restorePositions);
    const flush = () => { if (readyRef.current) void persistence.save(current.current).catch(() => undefined); };
    window.addEventListener('pagehide', flush);
    return () => {
      for (const lane of Object.values(lanes.current)) {
        lane.controller?.abort();
        clearTimeout(lane.timer);
      }
      lanes.current = { manual: {}, automatic: {} };
      flush(); epoch.current = generation + 1; clearTimeout(retryPositions);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('focus', restorePositions);
      window.removeEventListener('online', restorePositions);
    };
  }, [owner, commit, persistence, workspaceMode,isolatedWorkspace]);

  useEffect(() => {
    if (!enabled) return;
    const generation = epoch.current;
    let active = true;
    const valid = () => active && epoch.current === generation;
    readyRef.current = false; setReady(false); setError('');
    const read=isolatedWorkspace?(task:()=>Promise<void>)=>task():(task:()=>Promise<void>)=>readFishLibrary(owner,'screening',task);
    void read(async () => {
      if (!valid()) return;
      if(isolatedWorkspace){
        const draft=await loadPreEntryWorkspaceDraft(owner)??emptyPreEntryLibrary();
        if(valid()){commit(draft);readyRef.current=true;setReady(true);}
        return;
      }
      const newLibrary = await loadPreEntryLibraryV6(owner, preview => {
        if (valid()) setPreview(preview);
      }, reload > 0);
      const v5 = await loadPreEntryLibraryV5(owner);
      const v4 = await loadPreEntryLibraryV4(owner);
      const v3 = await loadPreEntryLibraryV3(owner);
      const v2 = await loadPreEntryLibraryV2(owner);
      const legacy = await loadPreEntryLibrary(owner);
      const draft = workspaceMode ? await loadPreEntryWorkspaceDraft(owner) : undefined;
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
      if (!valid()) return;
      persistence.seed(drafts ? mergePreEntryLibraries(newLibrary,drafts) : newLibrary);
      // An interrupted page has no live task. Keep its frozen conditions and cursor for explicit resume.
      const at = Date.now();
      const recordedRounds = new Set<string>(), pendingRounds = new Set<string>();
      for (const record of value.records) {
        recordedRounds.add(record.roundId);
        if (preEntryRecordPending(record)) pendingRounds.add(record.roundId);
      }
      // Only interrupted history needs a synthetic pause. A live task owns its cursor.
      const live = current.current;
      const hotRounds = live.rounds.filter(isAutomaticPreEntryRound);
      const hotIds = new Set(hotRounds.map(round => round.id));
      const recovered = { ...value, rounds: value.rounds.map(r => {
        if (hotIds.has(r.id)) return r;
        if (r.state !== 'complete' && recordedRounds.has(r.id) && !pendingRounds.has(r.id)) {
          return { ...r, state: 'complete' as const, updatedAt: at };
        }
        return r.state === 'running' ? { ...r, state: 'paused' as const, updatedAt: at } : r;
      }),
        records: value.records.map(r => r.status === 'scanning' && !hotIds.has(r.roundId) ? { ...r, status: 'paused' as const, updatedAt: at } : r) };
      const combined = hotIds.size ? mergePreEntryLibraries(recovered, {
        version: 1, rounds: hotRounds, records: live.records.filter(record => hotIds.has(record.roundId)),
      }) : recovered;
      commit(combined); setMissingCheckpoint(undefined); setPreview(undefined); setInstantLoadError(''); readyRef.current = true; setReady(true);
      if (draft?.rounds.length) {
        const savedInV6 = new Set(newLibrary.rounds.filter(round => round.workspaceSaved).map(round => round.id));
        const duplicates = draft.rounds.filter(round => round.workspaceDraft && round.state === 'complete' && savedInV6.has(round.id)).map(round => round.id);
        if (duplicates.length) void discardPublishedWorkspaceDraft(owner,duplicates).catch(()=>undefined);
      }
    }).catch(reason => { if (valid()) setError(reason instanceof Error ? reason.message : '读取买前监测库失败'); });
    return () => { active = false; };
  }, [owner, enabled, reload, commit, persistence, workspaceMode,isolatedWorkspace]);

  const persistAdmission = useCallback(async (record: PreEntryRecord, completed: PreEntryRound, reserve: boolean) => {
    const occupied = reserve && completed.instantTrading && owner && !await reserveInstantAdmission(owner, record, completed);
    const result = occupied
      ? { ...record, status: 'unmatched' as const, matchedAt: undefined, detail: '该标的已有持仓，本次信号跳过开仓' } : record;
    await savePreEntryLibrary(owner, { version: 1, rounds: [completed], records: [result] }, true);
    return result;
  }, [owner]);

  const execute = useCallback(async (round: PreEntryRound, study: FishQualityStudy, onMatch?: (match: AutomaticScreeningMatch) => void) => {
    const automatic = isAutomaticPreEntryRound(round);
    const lane = automatic ? lanes.current.automatic : lanes.current.manual;
    const reportError = automatic ? setAutomaticError : setError;
    if (!(readyRef.current || round.instantTrading && instantReadyRef.current) || lane.controller || !automatic && (tableClearLock.current || savingDraft.current)) return;
    const generation = epoch.current, aborter = new AbortController(); lane.controller = aborter;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; }); lane.execution = finished;
    let lastRecordPaint = 0, lastProgressPaint = 0;
    const live = () => epoch.current === generation;
    const saveSnapshot = (snapshot: PreEntryLibrary) => automatic
      ? savePreEntryLibrary(owner, { version: 1, rounds: snapshot.rounds.filter(r => r.id === round.id), records: snapshot.records.filter(r => r.roundId === round.id) }, true)
      : persistence.save(snapshot);
    // Release completed histories after durability without making the email wait for archive projection.
    const projectCompleted = async (records: PreEntryRecord[]) => {
      if (!live()) return;
      const currentRows = new Map(current.current.records.map(record => [record.id, record]));
      const cold = records.filter(record => !preEntryRecordPending(record) && !record.processRef
        && (record.exclusionProcess?.entries.length ?? 0) > 16 && currentRows.get(record.id) === record);
      if (!cold.length) return;
      const projected = await projectPreEntryBatch(owner, cold);
      const byId = new Map(cold.map((record, index) => [record.id, { before: record, after: projected[index] }]));
      if (live()) {
        persistence.project(cold, projected);
        commit({ ...current.current, records: current.current.records.map(record => {
          const projection = byId.get(record.id);
          return projection?.before === record ? projection.after : record;
        }) });
      }
    };
    let matchCheckpoint: Promise<boolean> | undefined, admittedRound: PreEntryRound | undefined;
    const checkpointMatch = (record: PreEntryRecord, completed: PreEntryRound): Promise<boolean> => (async () => {
      completed = unconfirmedAdmissions.current.get(completed.id) ?? completed;
      if (completed.instantPosition && completed.liveCapturedAt && owner) {
        const instantPosition = await freezeLivePositionBudget(owner, completed.instantPosition, aborter.signal);
        if (!live() || aborter.signal.aborted) return false;
        completed = { ...completed, instantPosition };
        admittedRound = completed;
        unconfirmedAdmissions.current.set(completed.id, completed);
      }
      const saved = await persistAdmission(record, completed, true);
      if (live()) {
        commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === completed.id ? completed : r),
          records: current.current.records.map(r => r.id === record.id ? saved : r) });
        unconfirmedAdmissions.current.delete(completed.id);
        setAutomaticError('');
        if (saved.status === 'matched') onMatch?.({ record: saved, round: completed });
      }
      void projectCompleted([saved]).catch(() => undefined);
      return true;
    })().catch(() => false);
    const save = async () => {
      try {
        const snapshot = current.current;
        await saveSnapshot(snapshot);
        if (automatic) {
          void projectCompleted(snapshot.records.filter(record => record.roundId === round.id)).catch(() => undefined);
        } else await projectCompleted(snapshot.records);
      } catch (reason) {
        if (live()) reportError(reason instanceof Error ? reason.message : '保存失败，请保留页面并重试');
      }
    };
    const scheduleSave = () => {
      if (lane.timer) return;
      const handle = setTimeout(() => {
        const snapshot = current.current;
        if (!live()) { if (lane.timer === handle) lane.timer = undefined; return; }
        // Keep the timer occupied until storage settles. Slow disks cannot
        // accumulate a queue of copies; the next checkpoint uses the latest data.
        void save().finally(() => {
          if (lane.timer !== handle) return;
          lane.timer = undefined;
          if (live() && lane.controller === aborter && current.current !== snapshot && !matchCheckpoint) scheduleSave();
        });
      }, 1500);
      lane.timer = handle;
    };
    const accept = (record: PreEntryRecord) => {
      if (!live()) return;
      let instantPosition = round.instantPosition;
      if (round.instantTrading && owner && record.status === 'matched' && !matchCheckpoint) {
        try { instantPosition ??= readInstantPositionSettings(owner); } catch { /* Invalid settings cannot size a new trade. */ }
        if (!instantPosition) record = { ...record, status: 'unmatched', matchedAt: undefined, detail: '入选时仓位设置不可用，本次未开仓' };
      }
      const previous = automatic ? current.current.records.find(r => r.id === record.id) : undefined;
      if (previous && record.updatedAt <= previous.updatedAt) record = { ...record, updatedAt: previous.updatedAt + 1 };
      const next = { ...current.current, records: current.current.records.map(r => r.id === record.id ? record : r) };
      current.current = next;
      // Fast local archives must not redraw the whole combination table every scanned minute.
      if (record.status !== 'scanning' || performance.now() - lastRecordPaint >= 150) {
        lastRecordPaint = performance.now(); setLibrary(next);
      }
      if (automatic && record.status === 'matched' && !matchCheckpoint) {
        clearTimeout(lane.timer); lane.timer = undefined;
        const instantMonitor = round.instantMonitor ?? (round.instantTrading && owner ? readInstantMonitorSettings(owner) : undefined);
        admittedRound = { ...round, ...(instantPosition ? { instantPosition } : {}), ...(instantMonitor ? { instantMonitor: structuredClone(instantMonitor) } : {}),
          state: 'complete', updatedAt: record.updatedAt };
        unconfirmedAdmissions.current.set(round.id, admittedRound);
        matchCheckpoint = checkpointMatch(record, admittedRound);
      } else if (!matchCheckpoint) scheduleSave();
    };
    if (automatic) { setAutomaticRunning(true); setAutomaticError(''); }
    else { setRunning(true); setProgress(null); setError(''); }
    commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === round.id ? { ...r, state: 'running', updatedAt: Date.now() } : r) });
    try {
      // Save the frozen batch before executing it. Storage failure must not create an unrecorded run.
      await saveSnapshot(current.current);
      if (!live() || aborter.signal.aborted) return;
      await runner.current({ study, signal: aborter.signal, task: 'pre-entry',
        preEntry: { round, records: current.current.records.filter(r => r.roundId === round.id), onRecord: accept },
        onProgress: p => { if (!automatic && live() && (p.done === p.total || performance.now() - lastProgressPaint >= 150)) {
          lastProgressPaint = performance.now(); setProgress(p);
        } }, onResult: () => undefined });
    } catch (reason) { if (live() && !aborter.signal.aborted) reportError(reason instanceof Error ? reason.message : '买前监测失败'); }
    finally {
      if (live()) {
        clearTimeout(lane.timer); lane.timer = undefined;
        const records = current.current.records.filter(r => r.roundId === round.id);
        const matched = automatic ? records.find(record => record.status === 'matched') : undefined;
        const pending = records.some(preEntryRecordPending);
        const ended: PreEntryRound = admittedRound ?? { ...round, state: matched ? 'complete' : aborter.signal.aborted || pending ? 'paused' : 'complete',
          updatedAt: matched?.updatedAt ?? Date.now() };
        if (!matched) {
          commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === round.id ? ended : r) });
          if (!automatic) setProgress({ done: records.filter(r => !preEntryRecordPending(r)).length, total: records.length, current: '' });
          await save();
        } else if (!(await matchCheckpoint) && !await checkpointMatch(matched, ended) && live()) {
          setAutomaticError('入选结果尚未保存，将自动重试');
        }
        if (live()) {
          if (automatic) setAutomaticRunning(false);
          else setRunning(false);
        }
      }
      if (lane.controller === aborter) lane.controller = undefined;
      if (lane.execution === finished) lane.execution = undefined;
      finish();
    }
  }, [commit, persistence, owner, persistAdmission]);
  const start = useCallback(async (study: FishQualityStudy, hours: number, automaticId?: string, recover = false, onMatch?: (match: AutomaticScreeningMatch) => void, automaticSettings?: PreEntrySettings, instantTrading?: true, liveCapturedAt?: number) => {
    const settings = automaticSettings ?? current.current.settings;
    const lane = automaticId ? lanes.current.automatic : lanes.current.manual;
    const reportError = automaticId ? setAutomaticError : setError;
    const canStart = () => readyRef.current || !!(automaticId && instantTrading && instantReadyRef.current);
    if (!canStart() || lane.controller || !automaticId && (tableClearLock.current || savingDraft.current)) return;
    if (automaticId) {
      if (owner && (recover || !readyRef.current)) {
        const generation = epoch.current;
        let saved: PreEntryLibrary | undefined;
        try { saved = await readAutomaticPreEntryCheckpoint(owner, automaticId, !readyRef.current); }
        catch (cause) {
          if (epoch.current === generation) {
            setMissingCheckpoint(automaticId);
            setAutomaticError(cause instanceof Error ? cause.message : '自动筛选进度读取失败');
          }
          return;
        }
        if (generation !== epoch.current || !canStart() || lane.controller) return;
        if (saved && !readyRef.current) {
          const original = saved.records[0]?.sample?.source, queued = qualityRunSamples(study)[0]?.source;
          if (!saved.rounds[0]?.instantTrading || !original || !queued || signalDedupKey(original) !== signalDedupKey(queued)) {
            setMissingCheckpoint(automaticId); return;
          }
        }
        if (saved) {
          commit(mergePreEntryLibraries(current.current, saved));
          setMissingCheckpoint(previous => previous === automaticId ? undefined : previous);
        }
        if (!saved && recover && !readyRef.current && !current.current.rounds.some(round => round.id === automaticId)) {
          setMissingCheckpoint(automaticId); return;
        }
      }
      const existing = current.current.rounds.find(round => round.id === automaticId);
      if (existing) {
        const record = current.current.records.find(record => record.roundId === automaticId);
        if (record && (preEntryRecordPending(record) || record.status === 'error')) {
          await execute(existing, newQualityStudy(study.startedAt), onMatch);
        } else if (record?.status === 'matched' && onMatch) {
          const generation = epoch.current;
          try {
            const frozen = unconfirmedAdmissions.current.get(existing.id) ?? existing;
            const pendingAdmission = existing.state !== 'complete' || unconfirmedAdmissions.current.has(existing.id);
            let completed: PreEntryRound = { ...frozen,
              state: 'complete', updatedAt: Math.max(existing.updatedAt, record.updatedAt) };
            if (pendingAdmission && owner && completed.instantTrading) {
              const position = completed.instantPosition ?? readInstantPositionSettings(owner);
              if (!position) throw Error('仓位设置不可用，等待恢复后核对入选');
              const instantPosition = completed.liveCapturedAt
                ? await freezeLivePositionBudget(owner, position, new AbortController().signal) : position;
              if (generation !== epoch.current) return;
              completed = { ...completed, instantPosition };
              unconfirmedAdmissions.current.set(existing.id, completed);
            }
            const saved = await persistAdmission(record, completed, pendingAdmission);
            if (generation === epoch.current) {
              commit({ ...current.current, rounds: current.current.rounds.map(r => r.id === completed.id ? completed : r),
                records: current.current.records.map(r => r.id === record.id ? saved : r) });
              unconfirmedAdmissions.current.delete(completed.id);
              setAutomaticError('');
              if (saved.status === 'matched') onMatch({ record: saved, round: completed });
            }
          } catch (reason) {
            if (generation === epoch.current) setAutomaticError(reason instanceof Error ? reason.message : '入选结果尚未保存');
          }
        }
        return;
      }
      if (!settings?.plans.length) return;
    }
    // Only legacy research may fall back to a static filter. An independently
    // configured workspace always starts from its own saved screening plan.
    const legacyFilters = !settings && !workspaceMode ? activeStandaloneBuyFilters({ ...study, turingStaticSettings: undefined }) : [];
    const samples = qualityRunSamples(study);
    let plans = settings?.plans ?? (legacyFilters.length ? [{id:'entry-original',label:'买入方案 1',metric:legacyFilters[0].metric,snapshot:legacyFilters[0].snapshot,rule:{metric:legacyFilters[0].metric,direction:legacyFilters[0].direction,threshold:legacyFilters[0].threshold},execution:'intrabar-1m' as const,buyFilters:legacyFilters.slice(1)}] : []);
    const chosen=selectedPreEntryPlan(plans);
    if(plans.length>1&&(automaticId||plans.some(p=>!!p.preEntryThreeStage))){if(!chosen){reportError('请在条件设置中选择并保存唯一的筛选方案');return;}plans=[chosen];}
    let filters;
    const threeStage=plans.some(p=>!!p.preEntryThreeStage);
    try {
      if(threeStage&&plans.some(p=>!p.preEntryThreeStage))throw Error('三阶方案与旧版方案须分别运行，不能混用版本');
      plans.forEach(p=>{if(p.preEntryThreeStage)validatePreEntryThreeStage(p.preEntryThreeStage);else validatePreEntryConditions(p.preEntryConditions);if(planVersionChanges(p).length)throw Error(`「${p.label}」的冻结版本已变化，请保留旧方案并另存新副本`);});
      filters = threeStage ? [] : plans.flatMap(preEntryPlanFilters);
    } catch (cause) { reportError(cause instanceof Error ? cause.message : '筛选条件无效'); return; }
    if (!plans.length || !threeStage&&!filters.length || !samples.length) { reportError('请设置筛选条件，并勾选要监测的信号'); return; }
    if (!Number.isFinite(hours) || hours < 0 || hours > 8784) { reportError('监测时长须为 0～8784 小时'); return; }
    const at = Date.now(), id = automaticId ?? `pre-entry-${crypto.randomUUID()}`;
    const round: PreEntryRound = { id, startedAt: at, updatedAt: at, filters: structuredClone(filters), hours, state: 'running', engine: threeStage?(plans.some(p=>p.preEntryThreeStage?.version===PRE_ENTRY_THREE_STAGE_VERSION)?PRE_ENTRY_THREE_STAGE_VERSION:plans[0].preEntryThreeStage!.version):PRE_ENTRY_CONDITIONS_VERSION, plans: structuredClone(plans.map(freezeQualityPlan)), ...(automaticId ? instantTrading ? { instantTrading, liveCapturedAt } : { automatic: true } : workspaceMode ? {workspaceDraft:true as const} : {}) };
    const records: PreEntryRecord[] = samples.flatMap((sample, i) => plans.map(plan => {
      const startTime = usesSignalTimeGate(round.engine) ? qualitySignalTime(sample.source) : sample.enteredAt ?? sample.source.timeMs;
      return { id: `${id}:${i}:${plan.id}`, roundId: id, planId: plan.id, sample: structuredClone(sample),
        status: 'queued' as const, startTime, cursor: startTime, readings: [], updatedAt: at };
    }));
    const base=!automaticId&&current.current.settings&&current.current.settings.plans.length>plans.length?archivePreEntrySettings(current.current,{...current.current.settings,plans:structuredClone(plans),updatedAt:at}):current.current;
    commit({...mergePreEntryLibraries(base, { version: 1, rounds: [round], records }), settings: automaticId ? base.settings : base.settings ?? {updatedAt:at,plans:structuredClone(plans.map(freezeQualityPlan)),hours}});
    // The screening engine reads its frozen round and records, never the research history.
    // Do not duplicate hundreds of MB of unrelated results when starting a task.
    await execute(round, newQualityStudy(study.startedAt), onMatch);
  }, [execute, commit, owner, workspaceMode, persistAdmission]);
  const resume = useCallback(async (roundId: string, study: FishQualityStudy) => {
    const round = current.current.rounds.find(r => r.id === roundId);
    if (round) await execute(round, newQualityStudy(study.startedAt));
  }, [execute]);
  const restart = useCallback(async (study: FishQualityStudy, hours: number) => {
    const generation = epoch.current, pending = lanes.current.manual.execution;
    lanes.current.manual.controller?.abort();
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
    const manual = lanes.current.manual;
    manual.controller?.abort();
    await manual.execution;
    if(epoch.current!==generation)return false;
    const automaticIds = new Set(current.current.rounds.filter(isAutomaticPreEntryRound).map(round => round.id));
    const records=[...current.current.records.filter(record => !automaticIds.has(record.roundId)),...extraRecords];
    const at=records.reduce((at,r)=>Math.max(at,r.updatedAt+1,current.current.tableClears?.[r.id]??0),Date.now());
    const marks=Object.fromEntries(records.map(r=>[r.id,at]));
    try{await savePreEntryTableClears(owner,marks);if(epoch.current!==generation)return false;commit(withPreEntryTableClears(current.current,marks));setProgress(null);setError('');return true;}
    catch(reason){if(epoch.current===generation)setError(reason instanceof Error?reason.message:'清除动态筛选结果未保存');return false;}
    finally{if(epoch.current===generation)tableClearLock.current=false;}
  },[commit,owner]);
  const importLibrary=useCallback(async(value:PreEntryLibrary)=>{
    if (!readyRef.current || Object.values(lanes.current).some(lane => lane.controller)) return false;
    const generation=epoch.current;
    // Imported process records are historical; no task is started or resumed.
    const historical={...value,settings:undefined,rounds:value.rounds.map(r=>r.state==='running'?{...r,state:'paused' as const}:r),records:value.records.map(r=>r.status==='scanning'?{...r,status:'paused' as const}:r)};
    const next={...mergePreEntryLibraries(current.current,historical),settings:current.current.settings};
    try{await persistence.save(next);if(epoch.current!==generation)return false;commit({...mergePreEntryLibraries(current.current,next),settings:current.current.settings});return true;}catch{return false;}
  },[commit,persistence]);
  const displayLibrary = useMemo(() => preview ? mergePreEntryLibraries(preview, library) : library, [preview, library]);
  const savedLibrary = useMemo(() => {
    const draftIds = new Set(displayLibrary.rounds.filter(round => round.workspaceDraft).map(round => round.id));
    return !draftIds.size ? displayLibrary : {...displayLibrary,rounds:displayLibrary.rounds.filter(round => !draftIds.has(round.id)),records:displayLibrary.records.filter(record => !draftIds.has(record.roundId))};
  },[displayLibrary]);
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
      void discardPublishedWorkspaceDraft(owner,[...ids]).catch(()=>undefined);
      if (generation !== epoch.current) return false;
      commit({...current.current,rounds:current.current.rounds.map(round => rounds.find(saved => saved.id === round.id) ?? round)});
      return true;
    } catch (cause) {
      if (generation === epoch.current) setError(cause instanceof Error ? cause.message : '保存筛选结果失败');
      return false;
    } finally {
      if (generation === epoch.current) {savingDraft.current=false;setSavingWorkspaceDraft(false);}
    }
  },[commit,owner]);
  const sameOwner = libraryOwner === owner;
  return { library: sameOwner ? displayLibrary : emptyPreEntryLibrary(), automaticLibrary: sameOwner ? library : emptyPreEntryLibrary(),
    instantReady: sameOwner && (instantReady || ready), instantLoadError, missingCheckpoint,
    savedLibrary: sameOwner ? savedLibrary : emptyPreEntryLibrary(), saveWorkspaceScreening, savingWorkspaceDraft, ready: sameOwner && ready, running, automaticRunning, automaticError, error, progress, start, resume, restart, configure, useSavedSettings,importLibrary,clearTableResults,
    startAutomatic: (id: string, study: FishQualityStudy, recover: boolean, onMatch?: (match: AutomaticScreeningMatch) => void, settings?: PreEntrySettings, instantTrading?: true, liveCapturedAt?: number) =>
      start(study, newPreEntryHours((settings ?? current.current.settings)?.hours), id, recover, onMatch, settings, instantTrading, liveCapturedAt),
    pauseAutomatic: () => lanes.current.automatic.controller?.abort(),
    pause: () => lanes.current.manual.controller?.abort(), retry: () => setReload(n => n + 1) };
}
