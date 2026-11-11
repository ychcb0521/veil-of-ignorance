import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FishWickEvidence } from './FishWickDetails';
import { FishTurnoverEvidence } from './FishTurnoverDetails';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { fishCaughtBy } from '@/lib/fish/records';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import type { FishHitRateOutsideDetail, FishHitRateRow, FishHitRateThresholdDetail, FishHitRateWindow } from '@/lib/fish/hitRate';

const statusText = { hit: '命中', miss: '未命中', unverified: '无法判定' };
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

export function FishHitRateResults({ windows, onShowMarketWindow, selection }: {
  windows: readonly FishHitRateWindow[];
  onShowMarketWindow?: (anchorMs: number) => void;
  selection?: { disabled?: boolean; checked: (sample: TradeSignal) => boolean; toggle: (samples: readonly TradeSignal[], checked: boolean) => void };
}) {
  const detailId = useId();
  const detailRef = useRef<HTMLElement>(null);
  const resultScroll = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | FishHitRateRow['status']>('all');
  const [sort, setSort] = useState<{ key: ResultSortKey; dir: SortDirection }>({ key: 'sample', dir: 'desc' });
  const [detail, setDetail] = useState<{ sampleId: string; kind: 'wick' | 'below' | 'thin' | 'outside' }>();
  const [query, setQuery] = useState('');
  useEffect(() => { if (!windows.length) { setFilter('all'); setDetail(undefined); } }, [windows.length]);
  useEffect(() => { if (resultScroll.current) resultScroll.current.scrollTop = 0; }, [filter, sort, query]);
  useEffect(() => { if (detail) detailRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [detail]);
  const rows = useMemo<ResultRow[]>(() => windows.flatMap(window => window.rows.map(row => ({
    ...row, window, algorithmTypes: row.hit ? fishCaughtBy(row.hit) : undefined,
  }))), [windows]);
  const hitCount = rows.filter(row => row.status === 'hit').length;
  const missCount = rows.filter(row => row.status === 'miss').length;
  const verified = hitCount + missCount;
  const visible = useMemo(() => {
    const value = resultColumns.find(column => column.key === sort.key)!.value;
    const direction = sort.dir === 'asc' ? 1 : -1;
    const needle = query.trim().toUpperCase();
    return rows.filter(row => (filter === 'all' || row.status === filter) && (!needle || row.sample.symbol.toUpperCase().includes(needle))).map(row => ({ row, value: value(row) }))
      .sort((a, b) => {
        const tie = b.row.sample.timeMs - a.row.sample.timeMs;
        if (a.value === undefined || b.value === undefined) return Number(a.value === undefined) - Number(b.value === undefined) || tie;
        const comparison = typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value : String(a.value).localeCompare(String(b.value), 'zh-CN', { numeric: true });
        return comparison * direction || tie;
      }).map(item => item.row);
  }, [rows, filter, sort, query]);
  const detailRow = visible.find(row => row.sample.id === detail?.sampleId);
  const activeWick = detail?.kind === 'wick' ? detailRow?.wick : undefined;
  const activeThresholds = detail?.kind === 'below' ? detailRow?.thresholds : undefined;
  const activeTurnover = detail?.kind === 'thin' ? detailRow?.turnover : undefined;
  const activeOutside = detail?.kind === 'outside' ? detailRow?.outside : undefined;
  const detailTitle = activeWick ? '插针过滤详情' : activeThresholds?.length ? '算法门槛详情'
    : activeTurnover?.length ? '成交额门槛详情' : activeOutside?.length ? '信号起点超窗详情' : undefined;

  if (!rows.length) return null;
  return <section className="min-w-0 space-y-2 border-t border-border/60 pt-3 text-[11px]" aria-label={selection ? '未命中归档' : '测试结果'}>
    {onShowMarketWindow && <h3 className="font-medium">样本判定</h3>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      {selection ? <>
        <input aria-label="筛选未命中标的" placeholder="筛选标的…" value={query} onChange={event=>setQuery(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-muted/40 px-2"/>
        <span className="tabular-nums text-muted-foreground">{visible.length} / {rows.length} 条未命中</span>
      </> : <><p className="tabular-nums">
        <strong>{verified ? `命中率 ${(100 * hitCount / verified).toFixed(1)}%` : '暂无可判定样本'}</strong>
        <span className="ml-2 text-muted-foreground">{hitCount} 命中 · {missCount} 未命中 · {rows.length - verified} 无法判定</span>
      </p>
      <select className="min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-foreground" aria-label="筛选测试结果" value={filter} onChange={event => { setDetail(undefined); setFilter(event.target.value as typeof filter); }}>
        <option value="all">全部结果</option><option value="hit">命中</option><option value="miss">未命中</option><option value="unverified">无法判定</option>
      </select></>}
    </div>
    <div ref={resultScroll} className="isolate max-h-80 min-w-0 overflow-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[46rem] text-[11px]" aria-label={selection ? '未命中归档结果' : '漏报测试结果'}>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-muted"><tr>{selection && <th scope="col" className={cellClass}>
          <input type="checkbox" aria-label="全选当前未命中记录" disabled={selection.disabled || !visible.length}
            checked={!!visible.length && visible.every(row => selection.checked(row.sample))}
            ref={node => { if (node) node.indeterminate = visible.some(row => selection.checked(row.sample)) && !visible.every(row => selection.checked(row.sample)); }}
            onChange={event => selection.toggle(visible.map(row => row.sample), event.target.checked)}/>
        </th>}{resultColumns.map(({ key, label, initial }) => {
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
            {selection && <td className={cellClass}><input type="checkbox" aria-label={`选择 ${sample.symbol} ${formatUTC8(sample.timeMs)}`}
              disabled={selection.disabled} checked={selection.checked(sample)} onChange={event => selection.toggle([sample], event.target.checked)}/></td>}
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
              {onShowMarketWindow && <button type="button" className="whitespace-nowrap text-primary hover:underline" onClick={() => onShowMarketWindow(window.anchorMs)}>本窗命中 {window.hits.length} 条</button>}
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
  </section>;
}
