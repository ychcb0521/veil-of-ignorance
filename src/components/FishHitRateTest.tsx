import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { normalizeSignalQuality, parseSignalText, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import type { FishScanSettings } from '@/lib/fishScanner';
import type { FishHitRateMode, FishHitRateOptions, FishHitRateProgress, FishHitRateRow, FishHitRateWindow } from '@/lib/fish/hitRate';

const statusText = { hit: '命中', miss: '未命中', unverified: '无法判定' };
const inputClass = 'min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-foreground';
const cellClass = 'px-3 py-2 text-left';
const marketLabel = (signal: TradeSignal) => `${EXCHANGE_NAMES[signal.exchange ?? 'binance']}${signal.market === 'us_stock' ? ' · 美股合约' : ''}`;
const offsetText = (delta: number) => {
  const seconds = Math.abs(delta) / 1000;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return delta === 0 ? '同一时间' : `${delta < 0 ? '早' : '晚'} ${minutes} 分${rest ? ` ${rest} 秒` : ''}`;
};

export function FishHitRateTest({ library, buildSettings, run, disabled }: {
  library: readonly TradeSignal[];
  buildSettings: () => FishScanSettings;
  run: (options: FishHitRateOptions) => Promise<void>;
  disabled?: boolean;
}) {
  const sourceName = useId(), modeName = useId();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'library' | 'paste'>('library');
  const [minRating, setMinRating] = useState(3);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<FishHitRateMode>('targets');
  const [windows, setWindows] = useState<FishHitRateWindow[]>([]);
  const [resultMode, setResultMode] = useState<FishHitRateMode>('targets');
  const [filter, setFilter] = useState<'all' | FishHitRateRow['status']>('all');
  const [selectedWindow, setSelectedWindow] = useState<number>();
  const [progress, setProgress] = useState<FishHitRateProgress>();
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);

  const pasted = useMemo(() => source === 'paste' ? parseSignalText(text) : null, [source, text]);
  const samples = useMemo(() => source === 'library'
    ? library.filter(signal => (normalizeSignalQuality(signal.quality) ?? 0) >= minRating).sort((a, b) => b.timeMs - a.timeMs)
    : pasted?.signals ?? [], [source, library, minRating, pasted]);
  const checkedWindows = useMemo(() => new Set(samples.map(sample => sample.timeMs)).size, [samples]);
  const rows = windows.flatMap(window => window.rows.map(row => ({ ...row, window })));
  const hitCount = rows.filter(row => row.status === 'hit').length;
  const missCount = rows.filter(row => row.status === 'miss').length;
  const verified = hitCount + missCount;
  const visible = filter === 'all' ? rows : rows.filter(row => row.status === filter);
  const selected = windows.find(window => window.anchorMs === selectedWindow);

  const start = async () => {
    if (controller.current || !samples.length || pasted?.errors.length) return;
    setError('');
    let settings: FishScanSettings;
    try { settings = buildSettings(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    const task = new AbortController();
    controller.current = task;
    setRunning(true);
    setStopped(false);
    setWindows([]);
    setResultMode(mode);
    setSelectedWindow(undefined);
    setFilter('all');
    setProgress(undefined);
    try {
      await run({
        samples: samples.map(sample => ({ ...sample })), mode, settings, signal: task.signal,
        onWindow: window => { if (!task.signal.aborted) setWindows(previous => [...previous, window]); },
        onProgress: value => { if (!task.signal.aborted) setProgress(value); },
      });
    } catch (cause) {
      if (!task.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === task) {
        controller.current = undefined;
        setRunning(false);
        setStopped(task.signal.aborted);
      }
    }
  };

  return <Dialog open={open} onOpenChange={next => { if (next || !running) setOpen(next); }}>
    <DialogTrigger asChild>
      <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <ScanSearch aria-hidden className="h-3.5 w-3.5"/>命中率测试
      </button>
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto p-4 text-xs sm:p-5">
      <DialogHeader className="pr-7 text-left">
        <DialogTitle>捕捞命中率测试</DialogTitle>
        <DialogDescription>每个样本时间后延 2.5 小时作为扫描截止，向前扫描 5 小时。使用当前勾选的捕捞算法和过滤条件，信号在截止时仍须达标。</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
        <fieldset disabled={running} className="min-w-0 space-y-2">
          <legend className="mb-1.5 font-medium">测试样本</legend>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name={sourceName} checked={source === 'library'} onChange={() => setSource('library')}/>信号库
            {source === 'library' && <select className={inputClass} aria-label="最低评分" value={minRating} onChange={event => setMinRating(Number(event.target.value))}>
              {[1,2,3,4,5].map(rating => <option key={rating} value={rating}>≥ {rating} 星</option>)}
            </select>}
          </label>
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
          <p className="text-muted-foreground">{mode === 'targets' ? '按样本所属交易所和市场取数。' : '按当前捕捞市场范围扫描，列出每个窗口内的全部命中。'}</p>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">{samples.length} 条样本 · {checkedWindows} 个时间窗口</p>
        {running
          ? <button type="button" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted" onClick={() => controller.current?.abort()}>停止测试</button>
          : <button type="button" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40" disabled={disabled || !samples.length || !!pasted?.errors.length} onClick={() => void start()}>开始测试</button>}
      </div>
      {progress && <p role="status" className="text-muted-foreground tabular-nums">
        {stopped ? '已停止' : running ? '测试中' : '测试结束'} · 窗口 {progress.windowsDone} / {progress.windowsTotal}
        {running && <> · 截止 {formatUTC8(progress.anchorMs)}{progress.marketTotal > 0 && <> · 已扫 {progress.marketDone} / {progress.marketTotal} 个标的</>}</>}
      </p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {rows.length > 0 && <section className="min-w-0 space-y-2 border-t border-border/60 pt-3" aria-label="测试结果">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="tabular-nums">
            <strong>{verified ? `命中率 ${(100 * hitCount / verified).toFixed(1)}%` : '暂无可判定样本'}</strong>
            <span className="ml-2 text-muted-foreground">{hitCount} 命中 / {verified} 已判定 · {rows.length - verified} 无法判定</span>
          </p>
          <select className={inputClass} aria-label="筛选测试结果" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
            <option value="all">全部结果</option><option value="hit">命中</option><option value="miss">未命中</option><option value="unverified">无法判定</option>
          </select>
        </div>
        <div className="max-h-80 overflow-auto rounded-md border border-border/60">
          <table className="w-full min-w-[46rem] text-xs">
            <thead className="sticky top-0 bg-muted"><tr>{['标的 / 市场','样本时间','扫描截止','判定','命中起点','相对样本','说明'].map(label => <th scope="col" className={cellClass} key={label}>{label}</th>)}</tr></thead>
            <tbody>
              {visible.map(({ sample, hit, status, reason, window }) => <tr key={sample.id} className="border-t border-border/50">
                <td className={cellClass}><div className="font-medium">{sample.symbol}</div><div className="text-muted-foreground">{marketLabel(sample)}{sample.quality ? ` · ${sample.quality} 星` : ''}</div></td>
                <td className={`${cellClass} whitespace-nowrap font-mono`}>{formatUTC8(sample.timeMs)}</td>
                <td className={`${cellClass} whitespace-nowrap font-mono`}>{formatUTC8(window.anchorMs)}</td>
                <td className={`${cellClass} whitespace-nowrap ${status === 'hit' ? 'text-primary' : 'text-muted-foreground'}`}>{statusText[status]}</td>
                <td className={`${cellClass} whitespace-nowrap font-mono`}>{hit ? formatUTC8(hit.timeMs) : '—'}</td>
                <td className={`${cellClass} whitespace-nowrap`}>{hit ? offsetText(hit.timeMs - sample.timeMs) : '—'}</td>
                <td className={cellClass}>{reason && <div className="min-w-32 text-muted-foreground">{reason}</div>}{resultMode === 'market' && <button type="button" className="whitespace-nowrap text-primary hover:underline" onClick={() => setSelectedWindow(window.anchorMs)}>本窗命中 {window.hits.length} 条</button>}</td>
              </tr>)}
            </tbody>
          </table>
          {!visible.length && <p className="p-3 text-muted-foreground">没有符合筛选的结果。</p>}
        </div>
        {selected && <section className="space-y-2 rounded-md border border-border/60 p-3" aria-label="本窗口全部命中">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">窗口截止 {formatUTC8(selected.anchorMs)} · 命中 {selected.hits.length} 条</h3>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedWindow(undefined)}>收起</button>
          </div>
          {selected.notice && <p className="text-muted-foreground">{selected.notice}</p>}
          {!!selected.hits.length && <ul className="max-h-48 divide-y divide-border/50 overflow-y-auto">
            {selected.hits.map(hit => <li key={hit.id} className="flex flex-wrap items-center gap-x-3 py-1.5"><strong>{hit.symbol}</strong><span className="text-muted-foreground">{marketLabel(hit)}</span><time className="font-mono">起点 {formatUTC8(hit.timeMs)}</time></li>)}
          </ul>}
        </section>}
      </section>}
    </DialogContent>
  </Dialog>;
}
