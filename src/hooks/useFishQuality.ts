import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { importQualityFish, newQualityStudy, migrateQualitySignalEntries, qualityResultKey, type FishQualityStudy, type QualityExitRule, type QualityProgress, type QualityRunOptions } from '@/lib/fish/quality';
import { loadQualityStudy, saveQualityStudy } from '@/lib/fish/qualityStore';

export type QualityRunner = (options: QualityRunOptions) => Promise<void>;
/** Mounted above the collapsible fish panel so new catches are recorded while it is closed. */
export function useFishQuality(owner: string | undefined, signals: readonly TradeSignal[], run: QualityRunner) {
  const [study, setStudy] = useState<FishQualityStudy>(newQualityStudy), [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState<QualityProgress | null>(null);
  const [warning, setWarning] = useState(''), [error, setError] = useState('');
  const current = useRef(study), account = useRef(owner), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const readyRef = useRef(false), latestRun = useRef(run); latestRun.current = run;
  const rerun = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Updates to an old account must never appear in or save into the newly selected one.
  if (account.current !== owner) { account.current = owner; readyRef.current = false; generation.current++; controller.current?.abort(); }
  const change = useCallback((apply: (s: FishQualityStudy) => FishQualityStudy) => {
    const next = apply(current.current); if (next !== current.current) { current.current = next; setStudy(next); }
  }, []);
  useEffect(() => {
    let active = true, loaded = false; const epoch = ++generation.current;
    readyRef.current = false; rerun.current = false; setReady(false); setRunning(false); setProgress(null); setError(''); setWarning('');
    current.current = newQualityStudy(); setStudy(current.current);
    void loadQualityStudy(owner).then(value => {
      if (!active || epoch !== generation.current) return;
      const restored = migrateQualitySignalEntries(value.study);
      current.current = restored; setStudy(restored); setWarning(value.warning ?? ''); readyRef.current = true; loaded = true; setReady(true);
    });
    const flush = () => { if (loaded) void saveQualityStudy(owner, current.current); };
    window.addEventListener('pagehide', flush);
    return () => { active = false; readyRef.current = false; controller.current?.abort(); controller.current = null; if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } window.removeEventListener('pagehide', flush); flush(); };
  }, [owner]);
  useEffect(() => { if (ready && readyRef.current) change(s => importQualityFish(s, signals)); }, [signals, ready, study.tracking, change]);
  useEffect(() => {
    if (!ready || !readyRef.current) return;
    if (saveTimer.current) return;
    const epoch = generation.current;
    // Throttle, not debounce: a continuous stream of catches/results must still be saved during the run.
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void saveQualityStudy(owner, current.current).then(ok => {
      if (epoch === generation.current) setWarning(ok ? '' : '鱼质量未能保存到本机；请保留此页面，系统会继续重试。');
    }); }, 400);
  }, [study, ready, owner]);
  const start = useCallback(async () => {
    if (!readyRef.current || !current.current.samples.length) return;
    if (controller.current) { if (controller.current.signal.aborted) rerun.current = true; return; }
    const epoch = generation.current, aborter = new AbortController(); controller.current = aborter;
    const frozen = structuredClone(current.current);
    setRunning(true); setError('');
    try {
      await latestRun.current({ study: frozen, signal: aborter.signal,
        onProgress: p => { if (epoch === generation.current && !aborter.signal.aborted) setProgress(p); },
        onResult: result => {
          if (epoch !== generation.current || aborter.signal.aborted) return;
          change(s => {
            const sample = s.samples.find(v => v.id === result.sampleId), group = s.groups.find(v => v.id === result.groupId);
            if (!sample || !group || qualityResultKey(sample, group, s.observeHours) !== result.key) return s;
            return { ...s, results: [...s.results.filter(r => r.sampleId !== result.sampleId || r.groupId !== result.groupId), result] };
          });
        },
      });
    } catch (e) { if (epoch === generation.current && !aborter.signal.aborted) setError(e instanceof Error ? e.message : '评估失败'); }
    finally { if (controller.current === aborter) { controller.current = null; if (epoch === generation.current) { setRunning(false); if (rerun.current) { rerun.current = false; setTimeout(() => void start(), 0); } } } }
  }, [change]);
  const cancel = useCallback(() => { controller.current?.abort(); }, []);
  // New fish get a position record immediately; all partial progress is retained. Retry on a minute clock.
  useEffect(() => {
    if (!ready || !study.tracking) return;
    const timer = setTimeout(() => void start(), 1000), interval = setInterval(() => void start(), 60_000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [ready, study.tracking, study.samples.length, start]);
  useEffect(() => {
    if (!ready || !warning) return;
    const timer = setInterval(() => { void saveQualityStudy(owner, current.current).then(ok => { if (ok && account.current === owner) setWarning(''); }); }, 15_000);
    return () => clearInterval(timer);
  }, [ready, warning, owner]);
  const setRule = useCallback((id: string, rule?: QualityExitRule) => {
    cancel(); change(s => ({ ...s, groups: s.groups.map(g => g.id === id ? { ...g, rule } : g) }));
    const epoch = generation.current; setTimeout(() => { if (epoch === generation.current) void start(); }, 500);
  }, [change, cancel, start]);
  const setObserveHours = useCallback((hours: number) => { cancel(); change(s => ({ ...s, observeHours: hours })); const epoch = generation.current; setTimeout(() => { if (epoch === generation.current) void start(); }, 500); }, [change, cancel, start]);
  const setTracking = useCallback((tracking: boolean) => { if (!tracking) cancel(); change(s => ({ ...s, tracking })); }, [change, cancel]);
  return { study: readyRef.current ? study : newQualityStudy(), ready: ready && readyRef.current, running, progress, warning, error, start, cancel, setRule, setObserveHours, setTracking };
}
export type FishQualityState = ReturnType<typeof useFishQuality>;
