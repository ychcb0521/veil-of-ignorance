import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FishWickEvidence } from '@/components/FishWickDetails';
import { FishTurnoverEvidence } from '@/components/FishTurnoverDetails';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { fishCaughtBy } from '@/lib/fish/records';
import { normalizeSignalQuality, parseSignalText, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import type { FishScanSettings } from '@/lib/fishScanner';
import { FISH_HIT_RATE_HOURS, type FishHitRateMode, type FishHitRateOptions, type FishHitRateProgress, type FishHitRateRow, type FishHitRateThresholdDetail, type FishHitRateWindow } from '@/lib/fish/hitRate';

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

function ThresholdDetails({ rows, anchorMs }: { rows: FishHitRateThresholdDetail[]; anchorMs: number }) {
  return <>
    <p className="text-muted-foreground">测试窗口（北京时间） {formatUTC8(anchorMs - FISH_HIT_RATE_HOURS * 3_600_000)} ～ {formatUTC8(anchorMs)} · 按已收盘 K 线取值</p>
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

export function FishHitRateTest({ library, buildSettings, run, disabled, onRunningChange }: {
  library: readonly TradeSignal[];
  buildSettings: () => FishScanSettings;
  run: (options: FishHitRateOptions) => Promise<void>;
  disabled?: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const sourceName = useId(), modeName = useId(), detailId = useId();
  const [source, setSource] = useState<'library' | 'paste'>('library');
  const [minRating, setMinRating] = useState(3);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<FishHitRateMode>('targets');
  const [windows, setWindows] = useState<FishHitRateWindow[]>([]);
  const [resultMode, setResultMode] = useState<FishHitRateMode>('targets');
  const [filter, setFilter] = useState<'all' | FishHitRateRow['status']>('all');
  const [sort, setSort] = useState<{ key: ResultSortKey; dir: SortDirection }>({ key: 'sample', dir: 'desc' });
  const [selectedWindow, setSelectedWindow] = useState<number>();
  const [detail, setDetail] = useState<{ sampleId: string; kind: 'wick' | 'below' | 'thin' }>();
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
  const samples = useMemo(() => source === 'library'
    ? library.filter(signal => (normalizeSignalQuality(signal.quality) ?? 0) >= minRating).sort((a, b) => b.timeMs - a.timeMs)
    : pasted?.signals ?? [], [source, library, minRating, pasted]);
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
  const selected = windows.find(window => window.anchorMs === selectedWindow);
  const detailRow = visible.find(row => row.sample.id === detail?.sampleId);
  const activeWick = detail?.kind === 'wick' ? detailRow?.wick : undefined;
  const activeThresholds = detail?.kind === 'below' ? detailRow?.thresholds : undefined;
  const activeTurnover = detail?.kind === 'thin' ? detailRow?.turnover : undefined;
  const detailTitle = activeWick ? '插针过滤详情' : activeThresholds?.length ? '算法门槛详情' : activeTurnover?.length ? '成交额门槛详情' : undefined;

  const start = async () => {
    if (controller.current || !samples.length || pasted?.errors.length) return;
    setError('');
    let settings: FishScanSettings;
    try { settings = buildSettings(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    const task = new AbortController();
    controller.current = task;
    setRunning(true);
    onRunningChange(true);
    setStopped(false);
    setWindows([]);
    setResultMode(mode);
    setSelectedWindow(undefined);
    setDetail(undefined);
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
        onRunningChange(false);
        setStopped(task.signal.aborted);
      }
    }
  };

  return <div className="min-w-0 space-y-2 text-[11px]">
      <p className="text-muted-foreground">每个样本前后各 2.5 小时。使用当前勾选的捕捞算法和过滤条件，信号在截止时仍须达标。</p>
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
              {visible.map(({ sample, hit, status, reason, rejections, wick, thresholds, turnover, window, algorithmTypes }) => <tr key={sample.id} className="border-t border-border/50 hover:bg-muted/25">
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
                      : kind === 'thin' && turnover?.length ? 'thin' : undefined;
                    if (!detailKind) return <div key={kind} className="text-muted-foreground">{label}</div>;
                    const expanded = detail?.sampleId === sample.id && detail.kind === detailKind;
                    return <div key={kind}><button type="button" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
                      className="inline-flex items-center gap-1 text-left text-primary underline-offset-2 hover:underline"
                      onClick={() => { setSelectedWindow(undefined); setDetail(expanded ? undefined : { sampleId: sample.id, kind: detailKind }); }}>
                      {label}<ChevronDown aria-hidden className={`h-3 w-3 shrink-0 ${expanded ? 'rotate-180' : ''}`}/>
                    </button></div>;
                  })}
                  {resultMode === 'market' && <button type="button" className="whitespace-nowrap text-primary hover:underline" onClick={() => { setDetail(undefined); setSelectedWindow(window.anchorMs); }}>本窗命中 {window.hits.length} 条</button>}
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
          {activeThresholds && <ThresholdDetails rows={activeThresholds} anchorMs={detailRow.window.anchorMs}/>}
          {activeTurnover && <FishTurnoverEvidence rows={activeTurnover}/>}
        </section>}
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
  </div>;
}
