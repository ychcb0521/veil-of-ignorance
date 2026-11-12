import type { FishHitRateExportRun } from '@/lib/fish/hitRateExport';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FishMonitorSamplePicker, FishScreeningSamplePicker } from './FishLibrarySamplePickers';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { mergeLibraryDirectoryEdits } from '@/lib/fish/libraryDirectoryEdits';
import { FishHitRateMissLibrary } from './FishHitRateMissLibrary';
import { fishMissUpdates, makeFishMissRound, missSampleKey, type FishMissRound, type FishMissUpdate } from '@/lib/fish/hitRateMissLibrary';
import { saveFishMissRound, saveFishMissUpdates } from '@/lib/fish/hitRateMissLibraryStore';
import { getUserId } from '@/lib/userStoragePrefix';
import { FishHitRateResults } from './FishHitRateResults';
import { FishMarketHitResults } from './FishMarketHitResults';
import { FishHitRateSettingsForm } from '@/components/FishHitRateSettingsForm';
import { usePersistedState } from '@/hooks/usePersistedState';
import { buildFishHitRateSettings, FISH_HIT_RATE_SETTINGS_KEY, readFishHitRateSettings, type FishHitRateSettings } from '@/lib/fish/hitRateSettings';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { parseSignalText, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import type { FishScanSettings } from '@/lib/fishScanner';
import { DEFAULT_FISH_HIT_RATE_WINDOW, fishMarketHits, screeningHitRateSamples, type FishHitRateMode, type FishHitRateOptions, type FishHitRateProgress, type FishHitRateWindow } from '@/lib/fish/hitRate';

const inputClass = 'min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-foreground';

interface MissLibraryWrite {
  owner: string | null;
  updates: FishMissUpdate[];
  indexedRounds?: string[];
}

export function FishHitRateTest({ quality, captureSettings, defs, run, disabled, onRunningChange, onJump, canJump }: {
  quality?: FishQualityState;
  onJump?: (signal: TradeSignal) => void;
  canJump?: (signal: TradeSignal) => boolean;
  captureSettings: () => FishHitRateSettings;
  defs: DeepDigFeatureDef[];
  run: (options: FishHitRateOptions) => Promise<void>;
  disabled?: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const screening = quality?.preEntry;
  const directoryEdits = quality?.study.monitorLibrary?.directoryEdits;
  const sourceName = useId(), modeName = useId();
  const [storedSettings, setStoredSettings] = usePersistedState<FishHitRateSettings | null>(FISH_HIT_RATE_SETTINGS_KEY, null);
  const savedSettings = useMemo(() => readFishHitRateSettings(storedSettings), [storedSettings]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentWindow = savedSettings?.window ?? DEFAULT_FISH_HIT_RATE_WINDOW;
  const [source, setSource] = useState<'screening' | 'monitor' | 'misses' | 'paste'>('screening');
  const [selectedRecords, setSelectedRecords] = useState<readonly string[]>([]);
  const [monitorSamples, setMonitorSamples] = useState<TradeSignal[]>([]);
  const [missSamples, setMissSamples] = useState<TradeSignal[]>([]);
  const [activeRevision, setActiveRevision] = useState(0);
  const [failedUpdates, setFailedUpdates] = useState<MissLibraryWrite[]>([]);
  const pendingWrites = useRef(Promise.resolve());
  const [archiveRevision, setArchiveRevision] = useState(0);
  const [archivedCount, setArchivedCount] = useState<number>();
  const [failedArchives, setFailedArchives] = useState<{ owner: string | null; round: FishMissRound }[]>([]);
  const [savingArchives, setSavingArchives] = useState(0);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<FishHitRateMode>('targets');
  const [windows, setWindows] = useState<FishHitRateWindow[]>([]);
  const [testedSamples, setTestedSamples] = useState<TradeSignal[]>([]);
  const [resultMode, setResultMode] = useState<FishHitRateMode>('targets');
  const [exportContext, setExportContext] = useState<Pick<FishHitRateExportRun,'window'|'startedAt'>>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [selectedWindow, setSelectedWindow] = useState<number>();
  const marketResults = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState<FishHitRateProgress>();
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();
  useEffect(() => () => {
    if (!controller.current) return;
    controller.current.abort();
    controller.current = undefined;
    onRunningChange(false);
  }, [onRunningChange]);

  const pasted = useMemo(() => source === 'paste' ? parseSignalText(text) : null, [source, text]);
  const screeningEdits = useMemo(() => mergeLibraryDirectoryEdits(directoryEdits, screening?.library.directoryEdits),
    [directoryEdits, screening?.library.directoryEdits]);
  const screeningSamples = useMemo(() => screening?.ready
    ? screeningHitRateSamples((screening.savedLibrary??screening.library).records, selectedRecords, screeningEdits)
    : [], [screening?.ready, screening?.library.records, screening?.savedLibrary?.records, selectedRecords, screeningEdits]);
  const samples = { screening: screeningSamples, monitor: monitorSamples, misses: missSamples, paste: pasted?.signals ?? [] }[source];
  const checkedWindows = useMemo(() => new Set(samples.map(sample => sample.timeMs)).size, [samples]);
  const runningWindowCount = useMemo(() => new Set(testedSamples.map(sample => sample.timeMs)).size, [testedSamples]);
  const marketHits = useMemo(() => resultMode === 'market' ? fishMarketHits(windows, testedSamples) : [], [resultMode, testedSamples, windows]);
  const archive = async (owner: string | null, round: FishMissRound) => {
    setSavingArchives(count => count + 1);
    try {
      await saveFishMissRound(owner, round);
      setArchivedCount(round.count);
      setArchiveRevision(value => value + 1);
      setFailedArchives(items => items.filter(item => item.round.id !== round.id));
    } catch {
      setFailedArchives(items => items.some(item => item.round.id === round.id) ? items : [...items, { owner, round }]);
    } finally {
      setSavingArchives(count => count - 1);
    }
  };

  const updateLibrary = (write: MissLibraryWrite) => {
    pendingWrites.current = pendingWrites.current.then(async () => {
      try {
        const merged = await saveFishMissUpdates(write.owner, write.updates, write.indexedRounds);
        setActiveRevision(value => value + 1);
        const completedRun = write.indexedRounds?.[0];
        setFailedUpdates(items => items.filter(item => item !== write
          && !(completedRun && item.owner === write.owner && item.updates.every(update => update.runId === completedRun))));
        if (getUserId() === write.owner) {
          const resolved = new Set(write.updates.filter(update => !update.miss).map(update => update.key));
          const confirmed = new Set(merged.updates.filter(update => !update.miss && resolved.has(update.key)).map(update => update.key));
          if (confirmed.size) setMissSamples(items => items.filter(item => !confirmed.has(missSampleKey(item))));
        }
      } catch {
        setFailedUpdates(items => items.includes(write) ? items : [...items, write]);
      }
    });
    return pendingWrites.current;
  };

  const start = async () => {
    if (controller.current || !samples.length || pasted?.errors.length) return;
    setError('');
    let settings: FishScanSettings;
    const selectedSettings = savedSettings ?? captureSettings();
    try { settings = buildFishHitRateSettings(selectedSettings, defs); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    const task = new AbortController();
    const owner = getUserId();
    const startedAt = Date.now();
    const runId = crypto.randomUUID();
    const finishedWindows: FishHitRateWindow[] = [];
    const windowConfig = { ...selectedSettings.window };
    controller.current = task;
    setRunning(true);
    setWaiting(null);
    onRunningChange(true);
    setStopped(false);
    setArchivedCount(undefined);
    setWindows([]);
    setExportContext({window:windowConfig,startedAt});
    setExportError('');
    setResultMode(mode);
    const samplesForRun = samples.map(sample => ({ ...sample }));
    setTestedSamples(samplesForRun);
    setSelectedWindow(undefined);
    setProgress(undefined);
    try {
      await run({
        samples: samplesForRun, mode, settings, window: windowConfig, signal: task.signal,
        onWindow: window => {
          if (task.signal.aborted) return;
          finishedWindows.push(window);
          setWindows(previous => [...previous, window]);
          const updates = fishMissUpdates(runId, startedAt, [window]);
          if (updates.length) void updateLibrary({ owner, updates });
        },
        onProgress: value => { if (!task.signal.aborted) setProgress(value); },
        onWaiting: reason => { if (!task.signal.aborted) setWaiting(reason); },
      });
      if (!task.signal.aborted && finishedWindows.length === checkedWindows) {
        const round = makeFishMissRound({ id: runId, startedAt, completedAt: Date.now(), mode, window: windowConfig }, finishedWindows);
        if (round) {
          await updateLibrary({ owner, updates: fishMissUpdates(runId, startedAt, finishedWindows), indexedRounds: [runId] });
          void archive(owner, round);
        }
      }
    } catch (cause) {
      if (!task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await pendingWrites.current;
      if (controller.current === task) {
        controller.current = undefined;
        setRunning(false);
        setWaiting(null);
        onRunningChange(false);
        setStopped(task.signal.aborted);
      }
    }
  };

  const exportResults = async () => {
    if (exporting || running || !windows.length || !exportContext) return;
    setExporting(true);
    setExportError('');
    try {
      const {downloadFishHitRate}=await import('@/lib/fish/hitRateExport');
      downloadFishHitRate({...exportContext,mode:resultMode,windows,samples:testedSamples,outcome:stopped?'已停止':error?'测试异常':'测试结束'});
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : '导出测试结果失败');
    } finally { setExporting(false); }
  };

  return <div className="min-w-0 space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">{savedSettings ? '下次测试使用独立设置' : '当前沿用捕捞条件'} · 样本前 {currentWindow.beforeHours} 小时，后 {currentWindow.afterHours} 小时</p>
        <div className="flex flex-wrap items-center gap-2">
          <FishHitRateMissLibrary key={getUserId() ?? 'local'} owner={getUserId()} revision={archiveRevision} activeRevision={activeRevision} selected={missSamples} readOnly={running}
            onSelect={samples => { setMissSamples(samples); setSource('misses'); }}/>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild><button type="button" disabled={running} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
              <Settings2 aria-hidden className="h-3 w-3"/>测试设置
            </button></DialogTrigger>
            {settingsOpen && <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto p-4 text-[11px] sm:p-5">
              <DialogHeader className="pr-7 text-left">
                <DialogTitle>漏报测试设置</DialogTitle>
                <DialogDescription>这些设置用于下一次漏报测试。全市场测试按这里的交易所扫描，定向测试按样本所属市场取数。</DialogDescription>
              </DialogHeader>
              <FishHitRateSettingsForm initial={savedSettings ?? captureSettings()} defs={defs} copyCapture={captureSettings}
                onSave={value => { setStoredSettings(value); setSettingsOpen(false); }} onCancel={() => setSettingsOpen(false)}/>
            </DialogContent>}
          </Dialog>
        </div>
      </div>
      <div className="grid gap-4 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
        <fieldset disabled={running} className="min-w-0 space-y-2">
          <legend className="mb-1.5 font-medium">测试样本</legend>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={sourceName} checked={source === 'screening'} onChange={() => setSource('screening')}/>筛选库
            </label>
            {source === 'screening' && quality && screening && <FishScreeningSamplePicker state={quality} edits={screeningEdits}
              selectedIds={selectedRecords} onSelect={setSelectedRecords} onJump={onJump} canJump={canJump}/>}
          </div>
          {source === 'screening' && <p className="text-muted-foreground">
            {screening ? '按所选标的的信号时间建立测试窗口。' : '筛选库暂不可用。'}
          </p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={sourceName} checked={source === 'monitor'} onChange={() => setSource('monitor')}/>监测库
            </label>
            {source === 'monitor' && quality?.ready && <FishMonitorSamplePicker state={quality} selected={monitorSamples}
              onSelect={setMonitorSamples} onJump={onJump} canJump={canJump}/>}
          </div>
          {source === 'monitor' && <p className="text-muted-foreground">
            {quality?.ready ? '按所选标的的信号时间建立测试窗口。' : '监测库暂不可用。'}
          </p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={sourceName} checked={source === 'misses'} onChange={() => setSource('misses')}/>未命中库
            </label>
            {source === 'misses' && <span className="text-muted-foreground">已选 {missSamples.length} 条待复测样本</span>}
          </div>
          <label className="flex items-center gap-2"><input type="radio" name={sourceName} checked={source === 'paste'} onChange={() => setSource('paste')}/>粘贴标的和时间</label>
          {source === 'paste' && <>
            <textarea aria-label="样本清单（北京时间）" value={text} onChange={event => setText(event.target.value)} rows={3}
              placeholder="BTCUSDT 2026-10-18 14:30:00" className={`${inputClass} w-full font-mono`}/>
            <p className="text-muted-foreground">每行一条，时间按北京时间。</p>
            {pasted?.errors.length ? <ul role="alert" className="max-h-24 overflow-y-auto text-destructive">{pasted.errors.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
          </>}
        </fieldset>
        <fieldset disabled={running} className="min-w-0 space-y-2">
          <legend className="mb-1.5 font-medium">扫描范围</legend>
          <label className="flex items-center gap-2"><input type="radio" name={modeName} checked={mode === 'targets'} onChange={() => setMode('targets')}/>只扫描给定标的</label>
          <label className="flex items-center gap-2"><input type="radio" name={modeName} checked={mode === 'market'} onChange={() => setMode('market')}/>扫描本窗口内所有标的</label>
          <p className="text-muted-foreground">{mode === 'targets' ? '按样本所属交易所和市场取数。' : '按测试设置的市场范围扫描，统计样本外命中与算法来源。'}</p>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">{running ? testedSamples.length : samples.length} 条样本 · {running ? runningWindowCount : checkedWindows} 个不同时间窗口</p>
        {running
          ? <button type="button" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted" onClick={() => controller.current?.abort()}>停止测试</button>
          : <button type="button" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40" disabled={disabled || !samples.length || !!pasted?.errors.length} onClick={() => void start()}>开始测试</button>}
      </div>
      {running && waiting && <p role="status" className="text-muted-foreground">{waiting}</p>}
      {progress && <p role="status" className="text-muted-foreground tabular-nums">
        {stopped ? '已停止' : running ? '测试中' : '测试结束'} · 窗口 {progress.windowsDone} / {progress.windowsTotal}
        {running && <> · 截止 {formatUTC8(progress.anchorMs)}{progress.marketTotal > 0 && <> · 已扫 {progress.marketDone} / {progress.marketTotal} 个标的</>}</>}
      </p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {failedUpdates.length > 0 && <p role="alert" className="text-destructive">有窗口的待复测记录更新失败。
        <button type="button" className="ml-2 underline" onClick={() => failedUpdates.forEach(write => { void updateLibrary(write); })}>重试更新</button>
      </p>}
      {savingArchives > 0 && <p role="status" className="text-muted-foreground">正在保存未命中归档…</p>}
      {archivedCount !== undefined && <p className="text-muted-foreground">已归档 {archivedCount} 条未命中</p>}
      {failedArchives.length > 0 && <p role="alert" className="text-destructive">有 {failedArchives.length} 轮未命中结果保存失败。
        <button type="button" disabled={savingArchives > 0} className="ml-2 underline disabled:opacity-50"
          onClick={() => failedArchives.forEach(({ owner, round }) => { void archive(owner, round); })}>重试保存</button>
      </p>}
      {resultMode === 'market' && windows.length > 0 && <section ref={marketResults} aria-label="全市场命中" className="scroll-mt-20">
        <FishMarketHitResults key={selectedWindow ?? 'all-windows'} rows={marketHits} anchorMs={selectedWindow}
          windows={windows} clearWindow={() => setSelectedWindow(undefined)}/>
      </section>}
      {exportError && <p role="alert" className="text-destructive">{exportError}</p>}
      <FishHitRateResults windows={windows} onExport={!running && exportContext ? () => void exportResults() : undefined} exporting={exporting} onShowMarketWindow={resultMode === 'market' ? anchorMs => {
        setSelectedWindow(anchorMs);
        marketResults.current?.scrollIntoView?.({ block: 'nearest' });
      } : undefined}/>
  </div>;
}
