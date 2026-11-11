import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FishScreeningSamplePicker, type FishScreeningSampleSource } from './FishScreeningSamplePicker';
import { mergeLibraryDirectoryEdits, type LibraryDirectoryEdits } from '@/lib/fish/libraryDirectoryEdits';
import { FishMarketHitResults } from './FishMarketHitResults';
import { FishHitRateSettingsForm } from '@/components/FishHitRateSettingsForm';
import { usePersistedState } from '@/hooks/usePersistedState';
import { buildFishHitRateSettings, FISH_HIT_RATE_SETTINGS_KEY, readFishHitRateSettings, type FishHitRateSettings } from '@/lib/fish/hitRateSettings';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { FishWickEvidence } from '@/components/FishWickDetails';
import { FishTurnoverEvidence } from '@/components/FishTurnoverDetails';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { fishCaughtBy } from '@/lib/fish/records';
import { parseSignalText, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import type { FishScanSettings } from '@/lib/fishScanner';
import { DEFAULT_FISH_HIT_RATE_WINDOW, fishMarketHits, screeningHitRateSamples, type FishHitRateMode, type FishHitRateOptions, type FishHitRateOutsideDetail, type FishHitRateProgress, type FishHitRateRow, type FishHitRateThresholdDetail, type FishHitRateWindow } from '@/lib/fish/hitRate';

const statusText = { hit: '命中', miss: '未命中', unverified: '无法判定' };
const inputClass = 'min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-foreground';
const cellClass = 'px-2.5 py-1.5 text-left';
const thresholdValue = (value: number, unit: string) => `${value}${unit && unit !== '原值' ? ` ${unit}` : ''}`;
const marketLabel = (signal: TradeSignal) => `${EXCHANGE_NAMES[signal.exchange ?? 'binance']}${signal.market === 'us_stock' ? ' · 美股合约' : ''}`;
type ResultRow = FishHitRateRow & { window: FishHitRateWindow; algorithmTypes?: string[] };
const statusRank = { hit: 0, miss: 1, unverified: 2 };
const resultColumns = [
  { key: 'symbol', label: '标的 / 市场', initial: 'asc', value: (row: ResultRow) => `${row.sample.symbol} ${marketLabel(row.sample)}` },
  { key: 'sample', label: '样本时间', initial: 'desc', value: (row: ResultRow) => row.sample.timeMs },
  { key: 'cutoff', label: '扫描截止', initial: 'desc', value: (row: ResultRow) => row.window.anchorMs },
  { key: 'status', label: '判定', initial: 'asc', value: (row: ResultRow) => statusRank[row.status] },
  { key: 'algorithmCount', label: '算法数量', initial: 'desc', value: (row: ResultRow) => row.algorithmTypes?.length },
  { key: 'algorithmTypes', label: '算法类型', initial: 'asc', value: (row: ResultRow) => row.algorithmTypes?.join(' · ') },
  { key: 'hit', label: '命中起点', initial: 'desc', value: (row: ResultRow) => row.hit?.timeMs },
  { key: 'offset', label: '相对样本', initial: 'asc', value: (row: ResultRow) => row.hit ? row.hit.timeMs - row.sample.timeMs : undefined },
  { key: 'reason', label: '说明', initial: 'asc', value: (row: ResultRow) => row.reason ?? row.rejections?.map(item => item.label).join('、') },
] as const;
type ResultSortKey = (typeof resultColumns)[number]['key'];
type SortDirection = 'asc' | 'desc';

const offsetText = (delta: number) => {
  const seconds = Math.abs(delta) / 1000;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return delta === 0 ? '同一时间' : `${delta < 0 ? '早' : '晚'} ${minutes} 分${rest ? ` ${rest} 秒` : ''}`;
};

function ThresholdDetails({ rows, window }: { rows: FishHitRateThresholdDetail[]; window: FishHitRateWindow }) {
  return <>
    <p className="text-muted-foreground">测试窗口（北京时间） {formatUTC8(window.startMs)} ～ {formatUTC8(window.anchorMs)} · 按已收盘 K 线取值</p>
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-xs" aria-label="未达门槛算法的窗口读数">
        <thead className="bg-muted"><tr>{['算法', '结果序列', '窗口内最大值', '最大值时间', '截止读数', '门槛'].map(label =>
          <th key={label} scope="col" className={`${cellClass} whitespace-nowrap`}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-border/50">
          <td className={`${cellClass} font-medium`}>{row.algorithm}</td>
          <td className={`${cellClass} font-mono`}>{row.statistic}</td>
          <td className={`${cellClass} whitespace-nowrap font-mono font-medium`}>{row.maximum ? thresholdValue(row.maximum.value, row.unit) : '窗内无可用读数'}</td>
          <td className={`${cellClass} whitespace-nowrap font-mono`}>{row.maximum ? formatUTC8(row.maximum.timeMs) : '—'}</td>
          <td className={`${cellClass} whitespace-nowrap font-mono`}>{thresholdValue(row.cutoffReading, row.unit)}<div className="text-[10px] text-muted-foreground">{formatUTC8(row.cutoffMs)}</div></td>
          <td className={`${cellClass} whitespace-nowrap font-mono`}>{row.direction} {thresholdValue(row.threshold, row.unit)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </>;
}

function OutsideDetails({ rows, window }: { rows: FishHitRateOutsideDetail[]; window: FishHitRateWindow }) {
  return <>
    <p className="text-muted-foreground">测试窗口（北京时间） {formatUTC8(window.startMs)} ～ {formatUTC8(window.anchorMs)} · 按已收盘 K 线取值</p>
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-xs" aria-label="起点超窗算法的读数">
        <thead className="bg-muted"><tr>{['算法', '连续达标起点', '相对窗口边界', '截止读数', '门槛'].map(label =>
          <th key={label} scope="col" className={`${cellClass} whitespace-nowrap`}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => {
          const early = row.startMs < window.startMs;
          const edgeMs = early ? window.startMs : window.anchorMs;
          return <tr key={index} className="border-t border-border/50">
            <td className={`${cellClass} font-medium`}>{row.algorithm}<div className="font-mono text-[10px] text-muted-foreground">{row.statistic}</div></td>
            <td className={`${cellClass} whitespace-nowrap font-mono`}>{formatUTC8(row.startMs)}</td>
            <td className={`${cellClass} whitespace-nowrap`}>比窗口{early ? '起点' : '截止'}{offsetText(row.startMs - edgeMs)}</td>
            <td className={`${cellClass} whitespace-nowrap font-mono`}>{thresholdValue(row.cutoffReading, row.unit)}<div className="text-[10px] text-muted-foreground">{formatUTC8(row.cutoffMs)}</div></td>
            <td className={`${cellClass} whitespace-nowrap font-mono`}>{row.direction} {thresholdValue(row.threshold, row.unit)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </>;
}

export function FishHitRateTest({ screening, directoryEdits, captureSettings, defs, run, disabled, onRunningChange }: {
  screening?: FishScreeningSampleSource;
  directoryEdits?: LibraryDirectoryEdits;
  captureSettings: () => FishHitRateSettings;
  defs: DeepDigFeatureDef[];
  run: (options: FishHitRateOptions) => Promise<void>;
  disabled?: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const sourceName = useId(), modeName = useId(), detailId = useId();
  const [storedSettings, setStoredSettings] = usePersistedState<FishHitRateSettings | null>(FISH_HIT_RATE_SETTINGS_KEY, null);
  const savedSettings = useMemo(() => readFishHitRateSettings(storedSettings), [storedSettings]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentWindow = savedSettings?.window ?? DEFAULT_FISH_HIT_RATE_WINDOW;
  const [source, setSource] = useState<'screening' | 'paste'>('screening');
  const [selectedRecords, setSelectedRecords] = useState<readonly string[]>([]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<FishHitRateMode>('targets');
  const [windows, setWindows] = useState<FishHitRateWindow[]>([]);
  const [testedSamples, setTestedSamples] = useState<TradeSignal[]>([]);
  const [resultMode, setResultMode] = useState<FishHitRateMode>('targets');
  const [filter, setFilter] = useState<'all' | FishHitRateRow['status']>('all');
  const [sort, setSort] = useState<{ key: ResultSortKey; dir: SortDirection }>({ key: 'sample', dir: 'desc' });
  const [selectedWindow, setSelectedWindow] = useState<number>();
  const marketResults = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<{ sampleId: string; kind: 'wick' | 'below' | 'thin' | 'outside' }>();
  const [progress, setProgress] = useState<FishHitRateProgress>();
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();
  const detailRef = useRef<HTMLElement>(null);
  const resultScroll = useRef<HTMLDivElement>(null);
  useEffect(() => () => {
    if (!controller.current) return;
    controller.current.abort();
    controller.current = undefined;
    onRunningChange(false);
  }, [onRunningChange]);
  useEffect(() => { if (resultScroll.current) resultScroll.current.scrollTop = 0; }, [filter, sort]);
  useEffect(() => { if (detail) detailRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [detail]);

  const pasted = useMemo(() => source === 'paste' ? parseSignalText(text) : null, [source, text]);
  const screeningEdits = useMemo(() => mergeLibraryDirectoryEdits(directoryEdits, screening?.library.directoryEdits),
    [directoryEdits, screening?.library.directoryEdits]);
  const screeningSamples = useMemo(() => screening?.ready
    ? screeningHitRateSamples(screening.library.records, selectedRecords, screeningEdits)
    : [], [screening?.ready, screening?.library.records, selectedRecords, screeningEdits]);
  const samples = source === 'screening' ? screeningSamples : pasted?.signals ?? [];
  const checkedWindows = useMemo(() => new Set(samples.map(sample => sample.timeMs)).size, [samples]);
  const rows = useMemo<ResultRow[]>(() => windows.flatMap(window => window.rows.map(row => ({
    ...row, window, algorithmTypes: row.hit ? fishCaughtBy(row.hit) : undefined,
  }))), [windows]);
  const hitCount = rows.filter(row => row.status === 'hit').length;
  const missCount = rows.filter(row => row.status === 'miss').length;
  const verified = hitCount + missCount;
  const visible = useMemo(() => {
    const value = resultColumns.find(column => column.key === sort.key)!.value;
    const direction = sort.dir === 'asc' ? 1 : -1;
    return rows.filter(row => filter === 'all' || row.status === filter).map(row => ({ row, value: value(row) }))
      .sort((a, b) => {
        const tie = b.row.sample.timeMs - a.row.sample.timeMs;
        if (a.value === undefined || b.value === undefined) return Number(a.value === undefined) - Number(b.value === undefined) || tie;
        const comparison = typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value : String(a.value).localeCompare(String(b.value), 'zh-CN', { numeric: true });
        return comparison * direction || tie;
      }).map(item => item.row);
  }, [rows, filter, sort]);
  const marketHits = useMemo(() => resultMode === 'market' ? fishMarketHits(windows, testedSamples) : [], [resultMode, testedSamples, windows]);
  const detailRow = visible.find(row => row.sample.id === detail?.sampleId);
  const activeWick = detail?.kind === 'wick' ? detailRow?.wick : undefined;
  const activeThresholds = detail?.kind === 'below' ? detailRow?.thresholds : undefined;
  const activeTurnover = detail?.kind === 'thin' ? detailRow?.turnover : undefined;
  const activeOutside = detail?.kind === 'outside' ? detailRow?.outside : undefined;
  const detailTitle = activeWick ? '插针过滤详情' : activeThresholds?.length ? '算法门槛详情'
    : activeTurnover?.length ? '成交额门槛详情' : activeOutside?.length ? '信号起点超窗详情' : undefined;

  const start = async () => {
    if (controller.current || !samples.length || pasted?.errors.length) return;
    setError('');
    let settings: FishScanSettings;
    const selectedSettings = savedSettings ?? captureSettings();
    try { settings = buildFishHitRateSettings(selectedSettings, defs); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    const task = new AbortController();
    controller.current = task;
    setRunning(true);
    onRunningChange(true);
    setStopped(false);
    setWindows([]);
    setResultMode(mode);
    const samplesForRun = samples.map(sample => ({ ...sample }));
    setTestedSamples(samplesForRun);
    setSelectedWindow(undefined);
    setDetail(undefined);
    setFilter('all');
    setProgress(undefined);
    try {
      await run({
        samples: samplesForRun, mode, settings, window: selectedSettings.window, signal: task.signal,
        onWindow: window => { if (!task.signal.aborted) setWindows(previous => [...previous, window]); },
        onProgress: value => { if (!task.signal.aborted) setProgress(value); },
      });
    } catch (cause) {
      if (!task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === task) {
        controller.current = undefined;
        setRunning(false);
        onRunningChange(false);
        setStopped(task.signal.aborted);
      }
    }
  };

  return <div className="min-w-0 space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">{savedSettings ? '下次测试使用独立设置' : '当前沿用捕捞条件'} · 样本前 {currentWindow.beforeHours} 小时，后 {currentWindow.afterHours} 小时</p>
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
      <div className="grid gap-4 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
        <fieldset disabled={running} className="min-w-0 space-y-2">
          <legend className="mb-1.5 font-medium">测试样本</legend>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={sourceName} checked={source === 'screening'} onChange={() => setSource('screening')}/>筛选库
            </label>
            {source === 'screening' && screening && <FishScreeningSamplePicker screening={screening} edits={screeningEdits}
              selectedIds={selectedRecords} onSelect={setSelectedRecords}/>}
          </div>
          {source === 'screening' && <p className="text-muted-foreground">
            {screening ? '按所选标的的信号时间建立测试窗口。' : '筛选库暂不可用。'}
          </p>}
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
        <p className="text-muted-foreground">{samples.length} 条样本 · {checkedWindows} 个不同时间窗口</p>
        {running
          ? <button type="button" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted" onClick={() => controller.current?.abort()}>停止测试</button>
          : <button type="button" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40" disabled={disabled || !samples.length || !!pasted?.errors.length} onClick={() => void start()}>开始测试</button>}
      </div>
      {progress && <p role="status" className="text-muted-foreground tabular-nums">
        {stopped ? '已停止' : running ? '测试中' : '测试结束'} · 窗口 {progress.windowsDone} / {progress.windowsTotal}
        {running && <> · 截止 {formatUTC8(progress.anchorMs)}{progress.marketTotal > 0 && <> · 已扫 {progress.marketDone} / {progress.marketTotal} 个标的</>}</>}
      </p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {resultMode === 'market' && windows.length > 0 && <section ref={marketResults} aria-label="全市场命中" className="scroll-mt-20">
        <FishMarketHitResults key={selectedWindow ?? 'all-windows'} rows={marketHits} anchorMs={selectedWindow}
          windows={windows} clearWindow={() => setSelectedWindow(undefined)}/>
      </section>}
      {rows.length > 0 && <section className="min-w-0 space-y-2 border-t border-border/60 pt-3" aria-label="测试结果">
        {resultMode === 'market' && <h3 className="font-medium">样本判定</h3>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="tabular-nums">
            <strong>{verified ? `命中率 ${(100 * hitCount / verified).toFixed(1)}%` : '暂无可判定样本'}</strong>
            <span className="ml-2 text-muted-foreground">{hitCount} 命中 · {missCount} 未命中 · {rows.length - verified} 无法判定</span>
          </p>
          <select className={inputClass} aria-label="筛选测试结果" value={filter} onChange={event => { setDetail(undefined); setFilter(event.target.value as typeof filter); }}>
            <option value="all">全部结果</option><option value="hit">命中</option><option value="miss">未命中</option><option value="unverified">无法判定</option>
          </select>
        </div>
        <div ref={resultScroll} className="isolate max-h-80 min-w-0 overflow-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[46rem] text-[11px]" aria-label="漏报测试结果">
            <thead className="sticky top-0 z-10 border-b border-border/60 bg-muted"><tr>{resultColumns.map(({ key, label, initial }) => {
              const active = sort.key === key;
              return <th scope="col" className={cellClass} key={key} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button type="button" title={`按${label}排序`} className={`flex items-center gap-0.5 whitespace-nowrap font-medium hover:text-foreground ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                  onClick={() => setSort(current => ({ key, dir: current.key === key ? (current.dir === 'asc' ? 'desc' : 'asc') : initial }))}>
                  {label}<span aria-hidden className="w-2">{active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
                </button>
              </th>;
            })}</tr></thead>
            <tbody>
              {visible.map(({ sample, hit, status, reason, rejections, wick, thresholds, turnover, outside, window, algorithmTypes }) => <tr key={sample.id} className="border-t border-border/50 hover:bg-muted/25">
                <td className={cellClass}><div className="font-medium">{sample.symbol}</div><div className="text-muted-foreground">{marketLabel(sample)}{sample.quality ? ` · ${sample.quality} 星` : ''}</div></td>
                <td className={`${cellClass} whitespace-nowrap font-mono`}>{formatUTC8(sample.timeMs)}</td>
                <td className={`${cellClass} whitespace-nowrap font-mono`}>{formatUTC8(window.anchorMs)}</td>
                <td className={`${cellClass} whitespace-nowrap ${status === 'hit' ? 'text-primary' : 'text-muted-foreground'}`}>{statusText[status]}</td>
                <td className={`${cellClass} whitespace-nowrap font-mono tabular-nums text-muted-foreground`}>{algorithmTypes?.length ?? '—'}</td>
                <td className={`${cellClass} min-w-28 break-words font-mono text-muted-foreground`}>{algorithmTypes?.join(' · ') || '—'}</td>
                <td className={`${cellClass} whitespace-nowrap font-mono`}>{hit ? formatUTC8(hit.timeMs) : '—'}</td>
                <td className={`${cellClass} whitespace-nowrap`}>{hit ? offsetText(hit.timeMs - sample.timeMs) : '—'}</td>
                <td className={`${cellClass} min-w-32`}>
                  {reason && <div className="text-muted-foreground">{reason}</div>}
                  {rejections?.map(({ kind, label }) => {
                    const detailKind = kind === 'wick' && wick ? 'wick'
                      : kind === 'below' && thresholds?.length ? 'below'
                      : kind === 'thin' && turnover?.length ? 'thin'
                      : kind === 'outside' && outside?.length ? 'outside' : undefined;
                    if (!detailKind) return <div key={kind} className="text-muted-foreground">{label}</div>;
                    const expanded = detail?.sampleId === sample.id && detail.kind === detailKind;
                    return <div key={kind}><button type="button" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
                      className="inline-flex items-center gap-1 text-left text-primary underline-offset-2 hover:underline"
                      onClick={() => { setDetail(expanded ? undefined : { sampleId: sample.id, kind: detailKind }); }}>
                      {label}<ChevronDown aria-hidden className={`h-3 w-3 shrink-0 ${expanded ? 'rotate-180' : ''}`}/>
                    </button></div>;
                  })}
                  {resultMode === 'market' && <button type="button" className="whitespace-nowrap text-primary hover:underline" onClick={() => { setSelectedWindow(window.anchorMs); marketResults.current?.scrollIntoView?.({ block: 'nearest' }); }}>本窗命中 {window.hits.length} 条</button>}
                </td>
              </tr>)}
            </tbody>
          </table>
          {!visible.length && <p className="p-3 text-muted-foreground">没有符合筛选的结果。</p>}
        </div>
        {detailRow && detailTitle && <section ref={detailRef} id={detailId} className="space-y-2 rounded-md border border-border/60 p-3" aria-label={detailTitle}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{detailRow.sample.symbol} · {marketLabel(detailRow.sample)} · {activeWick ? '5 分钟 K 线' : detailTitle}</h3>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setDetail(undefined)}>收起</button>
          </div>
          {activeWick && <FishWickEvidence row={activeWick}/>}
          {activeThresholds && <ThresholdDetails rows={activeThresholds} window={detailRow.window}/>}
          {activeTurnover && <FishTurnoverEvidence rows={activeTurnover}/>}
          {activeOutside && <OutsideDetails rows={activeOutside} window={detailRow.window}/>}
        </section>}
      </section>}
  </div>;
}
