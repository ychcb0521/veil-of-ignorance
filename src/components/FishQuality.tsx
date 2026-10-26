import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { FishQualityDistribution } from '@/components/FishQualityDistribution';
import { qualityDistributionSeries, type QualityDistributionMetric } from '@/lib/fish/qualityDistribution';
import { qualityCampaignPath } from '@/lib/campaignSections';
import { hasQualityEntry } from '@/lib/fish/qualityCampaignArchive';
import { ArrowRightCircle, Check, ChevronDown, CircleHelp, Download, Gauge, RefreshCw, Settings2, Star } from 'lucide-react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { FishProcessButton } from '@/components/FishProcess';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { normalizeSignalQuality, signalMonthKey, type TradeSignal } from '@/lib/signalLibrary';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { qualityDisplayRows, qualityDefinition, type QualityGroup, type QualityResult, type QualitySample } from '@/lib/fish/quality';
import { QUALITY_BINS, qualityComparisonStats, qualityResultMap, qualityRowResult, qualitySellSuggestions, type qualityDistribution } from '@/lib/fish/qualityComparison';
import { downloadQualityComparison } from '@/lib/fish/qualityExport';

const field = 'h-7 min-w-0 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60';
const button = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const heading = '-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted';
const cell = 'px-2 py-1.5';
const countSignals = (rows: readonly QualitySample[]) => new Set(rows.map(r => r.signalId ?? r.id)).size;
const pct = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const signed = (v?: number | null) => v == null ? '' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '';
const date = (v?: number | null) => v ? formatUTC8(v) : '—';
const ruleText = (plan: QualityGroup) => plan.rule ? `${plan.rule.direction} ${plan.rule.threshold}` : '设置门槛';
const isLibrary = (row: QualitySample) => row.origin === 'library';
const LibraryBadge = () => <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1 font-sans text-[9px] text-sky-700 dark:text-sky-300">信号库</span>;
// 【用户反馈】2026-10-26「表头显示 793，但表中完全没这么多」：原来每页 50 条、框只有约 9 行高，要翻 16 页。
// 改为所有行在同一个滚动框里，只渲染可见的几十行（行高按首行实测，量不到时用名义值）。
const ROW_PX = 33, TABLE_PX = 448, OVERSCAN = 12;
const resultText = (r?: QualityResult) => r?.status === 'closed' ? '已卖出' : r?.status === 'open' ? '持有' : r?.status === 'error' ? '缺数据' : r?.status === 'waiting' && r.entryPrice ? '待设门槛' : '待评估';

function SellEditor({ plan, state }: { plan: QualityGroup; state: FishQualityState }) {
  const [threshold, setThreshold] = useState(String(plan.rule?.threshold ?? plan.snapshot.threshold));
  const [direction, setDirection] = useState<'<' | '>'>(plan.rule?.direction ?? '<'), [error, setError] = useState('');
  const save = () => {
    if (!threshold.trim() || !Number.isFinite(Number(threshold))) { setError('请填写有限数字门槛'); return; }
    setError(''); state.setRule(plan.id, { metric: plan.metric, direction, threshold: Number(threshold) });
  };
  return <div className="space-y-3" data-testid={`quality-sell-editor-${plan.id}`}>
    <div className="space-y-0.5"><p className="text-xs font-medium">{plan.label}</p><p className="text-[10.5px] text-muted-foreground">5 分钟收盘确认 · 使用原始值</p></div>
    <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><span>试验门槛</span>{qualitySellSuggestions(plan).map(v => <button type="button" key={v} className="rounded border border-border/60 px-2 py-1 hover:bg-muted" onClick={() => setThreshold(String(v))}>{v}</button>)}</div>
    <div className="flex items-center gap-1.5">
      <select aria-label={`${plan.label}卖出方向`} className={field} value={direction} onChange={e => setDirection(e.target.value as '<' | '>')}><option value="<">&lt;</option><option value=">">&gt;</option></select>
      <input aria-label={`${plan.label}卖出门槛`} type="number" step="any" value={threshold} onChange={e => setThreshold(e.target.value)} className={`${field} w-24`}/>
      <button type="button" disabled={!state.ready} onClick={save} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">应用并重算</button>
    </div>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">以上数值供比较，未预选为最优。首次满足条件的收盘后，按下一分钟开盘价卖出。</p>
    {plan.rule && <div className="flex flex-wrap gap-2 text-[11px]"><button type="button" className="text-primary hover:underline" onClick={() => state.selectSell(plan.id)}>固定此方案，比较探测算法</button><button type="button" className="text-muted-foreground hover:underline" onClick={() => state.setRule(plan.id, undefined)}>清除门槛</button></div>}
    <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">公式与参数</summary><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{qualityDefinition(plan.snapshot).formula}</pre><p className="mt-1">hl 6 小时 · avgh 24 小时 · 原值倍率 1</p></details>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
function ResultCell({ result, onClick, section }: { result?: QualityResult; onClick: () => void; section: 'sell' | 'detect' }) {
  const router = useInRouterContext(), className = 'flex w-full items-center justify-between gap-2 text-left hover:underline';
  const content = <><span className={`font-mono tabular-nums ${signed(result?.returnPct)}`}>{pct(result?.returnPct)}</span><span className={`text-[9px] ${result?.status === 'error' ? 'text-destructive' : 'text-muted-foreground/70'}`}>{resultText(result)}</span></>;
  if (result && hasQualityEntry(result)) {
    const href = qualityCampaignPath(result.key, section);
    return router ? <Link to={href} className={className} title="打开该标的的交易战役">{content}</Link> : <a href={href} className={className} title="打开该标的的交易战役">{content}</a>;
  }
  return <button type="button" className={className} onClick={onClick} title={result?.reason ?? '点开查看买卖价格与收益指标'}>{content}</button>;
}

type Distribution = ReturnType<typeof qualityDistribution>;
function StatsCells({ data }: { data: Distribution }) {
  return <><td className={cell}>{data.n}</td><td className={`${cell} font-mono ${signed(data.mean)}`}>{pct(data.mean)}</td><td className={`${cell} font-mono`}>{pct(data.median)}</td><td className={`${cell} font-mono`}>{pct(data.winRate).replace(/^\+/, '')}</td><td className={`${cell} font-mono`}>{pct(data.p10)}</td><td className={`${cell} font-mono`}>{pct(data.worst)}</td>{data.bins.map((n, i) => <td key={i} className={`${cell} tabular-nums text-muted-foreground`} title={data.n ? `${(n / data.n * 100).toFixed(1)}%` : '暂无有效样本'}>{data.n ? `${n} · ${(n / data.n * 100).toFixed(0)}%` : '—'}</td>)}</>;
}
function RowDetail({ row, state, close }: { row?: QualitySample; state: FishQualityState; close: () => void }) {
  const study = state.study;
  return <Dialog open={!!row} onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
    <DialogHeader><DialogTitle className="text-sm">{row?.source.symbol} · 卖出对比</DialogTitle><DialogDescription className="text-xs">信号 {date(row?.source.timeMs)} · 买入 {date(row?.enteredAt)} · 每方案独立模拟 100 USDT / 1 倍</DialogDescription></DialogHeader>
    {row && <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-[11px]"><thead className="bg-muted/40 text-muted-foreground"><tr><th className={cell}>指标</th>{study.sellPlans?.map(p => <th key={p.id} className={`${cell} font-medium`}>{p.label} {ruleText(p)}</th>)}</tr></thead><tbody>{[
      ['状态', (r?: QualityResult) => `${resultText(r)}${r?.reason ? ` · ${r.reason}` : ''}`],
      ['买入时间', (r?: QualityResult) => date(r?.entryTime)], ['买入价', (r?: QualityResult) => r?.entryPrice?.toPrecision(7) ?? '—'],
      ['卖出 / 估值时间', (r?: QualityResult) => date(r?.endTime)], ['卖出 / 估值价', (r?: QualityResult) => r?.endPrice?.toPrecision(7) ?? '—'],
      ['收益率', (r?: QualityResult) => pct(r?.returnPct)], ['盈亏 USDT', (r?: QualityResult) => r?.pnl?.toFixed(2) ?? '—'],
      ['最大涨幅', (r?: QualityResult) => pct(r?.peakPct)], ['最大不利涨跌', (r?: QualityResult) => pct(r?.adversePct)],
      ['最大回撤', (r?: QualityResult) => pct(r?.drawdownPct).replace(/^\+/, '')], ['涨幅未兑现', (r?: QualityResult) => pct(r?.uncapturedPct).replace(/^\+/, '')],
      ['持仓小时', (r?: QualityResult) => r?.heldHours?.toFixed(2) ?? '—'],
    ].map(([label, format]) => <tr key={label as string} className="border-t border-border/40"><td className={`${cell} text-muted-foreground`}>{label as string}</td>{study.sellPlans?.map(p => <td key={p.id} className={`${cell} max-w-80 whitespace-normal font-mono`}>{(format as (r?: QualityResult) => string)(qualityRowResult(study, row, p))}</td>)}</tr>)}</tbody></table></div>}
  </DialogContent></Dialog>;
}

export function FishQuality({ state, onJump, canJump }: { state: FishQualityState; onJump?: (source: TradeSignal) => void; canJump?: (source: TradeSignal) => boolean }) {
  const { study, ready, running, progress } = state;
  const [open, setOpen] = useState(true), [query, setQuery] = useState(''), [month, setMonth] = useState(''), [algorithm, setAlgorithm] = useState(''), [origin, setOrigin] = useState<'' | 'fish' | 'library'>('');
  const [phase, setPhase] = useState<'sell' | 'detect'>('sell'), [showStats, setShowStats] = useState(false), [closedOnly, setClosedOnly] = useState(true);
  const [sort, setSort] = useState<'time' | 'symbol' | 'detector' | `sell:${string}`>('time'), [ascending, setAscending] = useState(false), [scrollTop, setScrollTop] = useState(0);
  const [distributionMetric, setDistributionMetric] = useState<QualityDistributionMetric>('returnPct');
  const wasRunning = useRef(false);
  useEffect(() => { if (wasRunning.current && !running && study.results.length) setShowStats(true); wasRunning.current = running; }, [running, study.results.length]);
  const [hours, setHours] = useState<string | null>(null), [error, setError] = useState(''), [detailId, setDetailId] = useState('');
  const allRows = useMemo(() => qualityDisplayRows(study), [study]);
  const detectorMap = useMemo(() => new Map(study.groups.map(g => [g.id, g])), [study.groups]);
  const batch = useMemo(() => allRows.filter(r => !study.cohortIds || study.cohortIds.includes(r.signalId!)), [allRows, study.cohortIds]);
  // 月份条数跟随来源、探测算法、标的筛选；同一信号的多个探测行只计一次。
  const narrowed = useMemo(() => batch.filter(r => (!query.trim() || r.source.symbol.toUpperCase().includes(query.trim().toUpperCase())) && (!algorithm || r.detectorId === algorithm) && (!origin || (origin === 'library') === isLibrary(r))), [batch, query, algorithm, origin]);
  const resultMap = useMemo(() => qualityResultMap(study), [study]);
  const rows = useMemo(() => narrowed.filter(r => !month || signalMonthKey(r.source.timeMs) === month).sort((a, b) => {
    const x = detectorMap.get(a.detectorId ?? ''), y = detectorMap.get(b.detectorId ?? '');
    if (sort.startsWith('sell:')) {
      const plan = study.sellPlans?.find(p => p.id === sort.slice(5));
      const rx = plan ? qualityRowResult(study, a, plan, resultMap) : undefined, ry = plan ? qualityRowResult(study, b, plan, resultMap) : undefined;
      const vx = rx && ['closed', 'open'].includes(rx.status) && Number.isFinite(rx.returnPct) ? rx.returnPct! : null;
      const vy = ry && ['closed', 'open'].includes(ry.status) && Number.isFinite(ry.returnPct) ? ry.returnPct! : null;
      if ((vx == null) !== (vy == null)) return vx == null ? 1 : -1;
      return (vx != null && vy != null ? (vx - vy) * (ascending ? 1 : -1) : 0) || b.source.timeMs - a.source.timeMs || a.id.localeCompare(b.id);
    }
    const order = sort === 'time' ? a.source.timeMs - b.source.timeMs : sort === 'symbol' ? a.source.symbol.localeCompare(b.source.symbol)
      : (x?.label ?? '').localeCompare(y?.label ?? '') || (x?.snapshot.threshold ?? 0) - (y?.snapshot.threshold ?? 0) || (x?.metric ?? '').localeCompare(y?.metric ?? '');
    return order * (ascending ? 1 : -1) || b.source.timeMs - a.source.timeMs || a.id.localeCompare(b.id);
  }), [narrowed, month, sort, ascending, detectorMap, study, resultMap]);
  const monthCounts = useMemo(() => {
    const ids = new Map<string, Set<string>>();
    for (const r of narrowed) { const key = signalMonthKey(r.source.timeMs); if (!ids.has(key)) ids.set(key, new Set()); ids.get(key)!.add(r.signalId ?? r.id); }
    return new Map([...ids].map(([key, signals]) => [key, signals.size]));
  }, [narrowed]);
  const months = [...new Set(batch.map(r => signalMonthKey(r.source.timeMs)))].sort().reverse();
  const plans = study.sellPlans ?? [], groups = study.groups.filter(g => batch.some(r => r.detectorId === g.id));
  const selectedIds = new Set(study.selectedRowIds ?? []);
  const selectedRows = rows.filter(r => selectedIds.has(r.id)), selectedCount = batch.filter(r => selectedIds.has(r.id)).length;
  const selectedSignals = new Set(batch.filter(r => selectedIds.has(r.id)).map(r => r.signalId)).size;
  const visibleSelectedSignals = new Set(selectedRows.map(r => r.signalId)).size;
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const selectVisible = (checked: boolean) => {
    const ids = new Set(selectedIds); rows.forEach(row => { if (checked) ids.add(row.id); else ids.delete(row.id); });
    state.setSelectedRows([...ids]);
  };
  const stats = qualityComparisonStats(study, selectedRows, closedOnly);
  const distributionSeries = useMemo(() => qualityDistributionSeries(study, selectedRows, phase, closedOnly, distributionMetric), [study, selectedRows, phase, closedOnly, distributionMetric]);
  const tableRef = useRef<HTMLDivElement>(null), [rowPx, setRowPx] = useState(ROW_PX), [viewPx, setViewPx] = useState(TABLE_PX);
  const resetScroll = () => { setScrollTop(0); if (tableRef.current) tableRef.current.scrollTop = 0; };
  useLayoutEffect(() => {
    const el = tableRef.current; if (!el) return;
    const row = el.querySelector<HTMLElement>('tbody tr[data-testid="quality-fish-row"]');
    if (row && row.offsetHeight > 0 && Math.abs(row.offsetHeight - rowPx) > .5) setRowPx(row.offsetHeight);
    if (el.clientHeight > 0 && el.clientHeight !== viewPx) setViewPx(el.clientHeight);
  }, [open, rows, rowPx, viewPx]);
  const first = Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / rowPx) - OVERSCAN));
  const last = Math.min(rows.length, Math.max(first + 1, Math.ceil((scrollTop + viewPx) / rowPx) + OVERSCAN));
  const visible = rows.slice(first, last), padTop = first * rowPx, padBottom = (rows.length - last) * rowPx;
  const changeSort = (key: typeof sort) => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(key === 'symbol' || key === 'detector'); } resetScroll(); };
  const applyHours = () => { const n = Number(hours ?? study.observeHours); if (!Number.isFinite(n) || n < 0 || n > 8784) { setError('观察时长须在 0～8784 小时之间'); return; } setError(''); setHours(null); if (n !== study.observeHours) state.setObserveHours(n); };
  const exportRows = () => { try { downloadQualityComparison(study, rows); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); } };
  return <section className="min-w-0 border-t border-border/50 px-4 py-3" aria-labelledby="fish-quality-title" data-testid="fish-quality">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5"><button id="fish-quality-title" type="button" className={heading} aria-expanded={open} aria-controls="fish-quality-content" onClick={() => setOpen(!open)}><Gauge aria-hidden className="h-3 w-3 text-muted-foreground"/><span>鱼质量</span><span className={`min-w-[1.25rem] rounded px-1 text-center font-mono text-[10px] tabular-nums ${allRows.length ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{countSignals(allRows)}</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button>
        <Popover><PopoverTrigger asChild><button type="button" aria-label="鱼质量说明" className="p-1 text-muted-foreground/40 hover:text-muted-foreground"><CircleHelp className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="w-80 space-y-2 text-[11px] leading-relaxed"><p>先用同一批信号比较卖出算法和门槛的盈亏分布，再固定一套卖出规则，比较各探测算法。</p><p>信号库的信号也会加入，标「信号库」、按信号时间买入；它们只参加第一步比较卖出，不属于任何探测算法，也不与鱼舱的鱼合并。</p><p>历史鱼按捕捞时刻入场（不用信号时间：那是事后才知道会持续下去的起点），实时新鱼按实际发现时点入场；随后首根 1 分钟 K 线开盘价近似买入。已有历史样本按此口径重新评估，卖出规则保留。</p><p>收益未扣手续费、资金费和滑点。未卖出持仓单独标记；缺数据不计为零收益。探测分组可以重叠，组间盈亏不相加。固定批次可防止新鱼改变比较样本。</p><p>同一信号按探测算法展开为多行；比较卖出按信号去重，探测统计只看已勾选的算法行。</p><p>原捕获记录与旧版规则保留；本次两套卖出试验独立计算，公式冻结，均使用原始值。</p></PopoverContent></Popover>
      </div>
      <button type="button" className={button} disabled={!rows.length} onClick={exportRows} aria-label="导出鱼质量数据"><Download className="h-3 w-3"/>导出数据</button>
    </div>
    {open && <div id="fish-quality-content" className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex h-7 items-center rounded-md bg-muted/60 p-0.5 text-[10.5px]" role="tablist" aria-label="鱼质量比较阶段">{(['sell', 'detect'] as const).map((v, i) => <button type="button" role="tab" aria-selected={phase === v} key={v} className={`h-6 rounded px-2.5 ${phase === v ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => { setPhase(v); setShowStats(true); }}>{i + 1} · {v === 'sell' ? '比较卖出' : '比较探测'}</button>)}</div>
          {phase === 'detect' && <select aria-label="固定卖出方案" value={study.selectedSellId ?? ''} className={`${field} max-w-64`} onChange={e => state.selectSell(e.target.value)}><option value="">选择一套卖出规则</option>{plans.filter(p => p.rule).map(p => <option key={p.id} value={p.id}>{p.label} {ruleText(p)}</option>)}</select>}
          <button type="button" className={button} aria-expanded={showStats} onClick={() => setShowStats(!showStats)}>盈亏分布<ChevronDown className={`h-3 w-3 transition-transform ${showStats ? 'rotate-180' : ''}`}/></button>
          <button type="button" className={button} disabled={!ready || !study.cohortIds && !selectedRows.length} onClick={() => state.setCohort(study.cohortIds ? undefined : [...new Set(selectedRows.map(r => r.signalId!))])}>{study.cohortIds ? `已固定 ${new Set(batch.map(r => r.signalId)).size} 条信号 · 换用全部` : '固定当前批次'}</button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">100 USDT · 1 倍</span>
          <button type="button" className={button} disabled={!ready || running || !selectedCount} title="只评估已勾选的信号" onClick={() => void state.start()}><RefreshCw className={`h-3 w-3 ${running ? 'animate-spin' : ''}`}/>{running ? `${progress?.done ?? 0}/${progress?.total ?? 0}` : '更新收益'}</button>
          {running && <button type="button" className={button} onClick={state.cancel}>暂停</button>}
          <Popover><PopoverTrigger asChild><button type="button" className={button} aria-label="鱼质量跟踪设置"><Settings2 className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="end" className="w-72 space-y-3 text-[11px]"><label className="flex items-center gap-2"><input type="checkbox" checked={study.tracking} disabled={!ready} onChange={e => state.setTracking(e.target.checked)}/>自动跟踪新鱼及更新收益</label><label className="flex items-center gap-2">观察时长<input aria-label="鱼质量观察小时" type="number" min="0" max="8784" step="any" className={`${field} w-20`} value={hours ?? study.observeHours} onChange={e => setHours(e.target.value)} onBlur={applyHours} onKeyDown={e => { if (e.key === 'Enter') applyHours(); }}/>小时</label><p className="text-[10px] text-muted-foreground">0 = 持续至卖出；手动运行后每分钟更新已选信号；重新打开或更改勾选后，先点「更新收益」。观察期结束仍持有，不强平。</p></PopoverContent></Popover>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
        <button type="button" className={button} disabled={!ready || !rows.length} title={`全选当前筛选下的 ${rows.length} 行，包含未滚动到的行`} onClick={() => selectVisible(true)}>全部选中</button>
        <button type="button" className={button} disabled={!ready || !selectedIds.size} onClick={() => state.setSelectedRows([])}>清空选择</button>
        <span className="ml-1 text-muted-foreground" aria-live="polite">已选 {selectedCount} 行 · {selectedSignals} 条信号{selectedCount ? ' · 只运行勾选行' : ' · 运行前请先勾选'}</span>
      </div>
      {showStats && <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/10 p-2" data-testid="quality-distribution">
        <FishQualityDistribution series={distributionSeries} metric={distributionMetric} onMetricChange={setDistributionMetric}/>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px]"><span className="text-muted-foreground">{phase === 'sell' ? `同批对照 · ${stats.paired.length} / ${visibleSelectedSignals} 条${closedOnly ? '共同已卖出' : '共同已评估'}（鱼 ${stats.paired.filter(r => !isLibrary(r)).length} · 信号库 ${stats.paired.filter(isLibrary).length}）` : stats.selected ? `统一卖出：${stats.selected.label} ${ruleText(stats.selected)}` : '先在第一步设置门槛并固定一套卖出方案'}</span><label className="inline-flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={closedOnly} onChange={e => setClosedOnly(e.target.checked)}/>仅比较已卖出</label></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-[10px]"><thead className="text-[9px] text-muted-foreground"><tr>{[phase === 'sell' ? '卖出方案' : '探测算法 / 捕获门槛', '样本', '平均收益', '中位数', '盈利占比', 'P10', '最差收益', ...QUALITY_BINS].map(t => <th key={t} className={`${cell} font-medium`}>{t}</th>)}</tr></thead><tbody>{phase === 'sell' ? stats.sells.map(s => <tr key={s.plan.id} className="border-t border-border/40"><td className={cell}><button type="button" disabled={!s.plan.rule} className="inline-flex items-center gap-2 text-left disabled:opacity-50" title="固定此方案用于探测算法比较" onClick={() => { state.selectSell(s.plan.id); setPhase('detect'); }}><span>{s.plan.label} <span className="font-mono text-muted-foreground">{ruleText(s.plan)}</span></span><span className="text-primary">{study.selectedSellId === s.plan.id ? '已固定' : '选用 →'}</span></button></td><StatsCells data={s}/></tr>) : stats.detectors.filter(s => s.total > 0).map(s => <tr key={s.group.id} className="border-t border-border/40"><td className={cell}>{s.group.label} <span className="font-mono text-muted-foreground">{s.group.snapshot.direction ?? '>'} {s.group.snapshot.threshold}</span><span className="ml-2 text-muted-foreground">共 {s.total}</span></td><StatsCells data={s}/></tr>)}</tbody></table></div>
        <p className="text-[9.5px] leading-relaxed text-muted-foreground">{phase === 'sell' ? '两方案使用相同买入与共同有效样本；缺数据、等待及未完成的对照不混入分母。' : '每组使用同一卖出规则；未评估、缺数据和未卖出数量不算亏损。分组可重叠。'}{!closedOnly && ' 当前包含持仓浮盈，并非全部已实现收益。'} 样本内比较不自动认定最优，建议固定批次后另用新信号验证。</p>
      </div>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="relative shrink-0"><select aria-label="鱼质量的来源" className={`${field} appearance-none pr-6`} value={origin} onChange={e => { setOrigin(e.target.value as '' | 'fish' | 'library'); resetScroll(); }}><option value="">全部来源（{countSignals(batch)}）</option><option value="fish">鱼（{countSignals(batch.filter(r => !isLibrary(r)))}）</option><option value="library">信号库（{countSignals(batch.filter(isLibrary))}）</option></select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <span className="relative shrink-0"><select aria-label="鱼质量的月份" className={`${field} appearance-none pr-6 font-mono`} value={month} onChange={e => { setMonth(e.target.value); resetScroll(); }}><option value="">全部月份（{countSignals(narrowed)}）</option>{months.map(m => <option key={m} value={m}>{m}（{monthCounts.get(m) ?? 0}）</option>)}</select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <span className="relative max-w-60 shrink-0"><select aria-label="鱼质量的探测算法" className={`${field} w-full appearance-none pr-6`} value={algorithm} onChange={e => { setAlgorithm(e.target.value); resetScroll(); }}><option value="">全部探测算法</option>{groups.map(g => <option key={g.id} value={g.id}>{g.label} {g.snapshot.direction ?? '>'} {g.snapshot.threshold}</option>)}</select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <input aria-label="筛选鱼质量信号" placeholder="筛选标的…" value={query} onChange={e => { setQuery(e.target.value); resetScroll(); }} className={`${field} min-w-32 flex-1 placeholder:text-muted-foreground/50`}/>
      </div>
      {!ready && <p role="status" className="text-[10.5px] text-muted-foreground">恢复本机记录…</p>}
      {(error || state.warning || state.error) && <p role="alert" className="text-[11px] text-destructive">{error || state.error || state.warning}</p>}
      {rows.length ? <div ref={tableRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} className="max-h-[28rem] overflow-auto overscroll-contain rounded-lg border border-border/60 [overflow-anchor:none]" data-testid="quality-fish-table"><table className="w-full border-separate border-spacing-0 whitespace-nowrap text-left text-[10px]">
        <thead className="sticky top-0 z-20 bg-background text-[9px] font-medium text-muted-foreground"><tr className="bg-muted/40">
          <th className={`${cell} sticky left-0 z-30 min-w-[160px] bg-muted font-medium`}><span className="flex items-center gap-2"><input type="checkbox" aria-label="全选当前筛选信号" title="全选当前筛选下的所有行" checked={allSelected} ref={el => { if (el) el.indeterminate = selectedRows.length > 0 && !allSelected; }} disabled={!ready} onChange={e => selectVisible(e.target.checked)} className="h-3 w-3 accent-[hsl(var(--primary))]"/><button type="button" onClick={() => changeSort('symbol')}>标的{sort === 'symbol' ? ascending ? ' ↑' : ' ↓' : ''}</button></span></th>
          <th className={`${cell} min-w-[140px] font-medium`}><button type="button" onClick={() => changeSort('time')}>信号时间{sort === 'time' ? ascending ? ' ↑' : ' ↓' : ''}</button></th>
          <th className={`${cell} font-medium`}>市场</th><th className={`${cell} font-medium`}>评分</th><th className={`${cell} min-w-[80px] font-medium`}>捕捞过程</th>
          {plans.map(p => <th key={p.id} className={`${cell} min-w-[155px] border-l border-border/40 font-medium`} data-testid="quality-sell-column" aria-sort={sort === `sell:${p.id}` ? ascending ? 'ascending' : 'descending' : 'none'}><button type="button" className="block text-left hover:text-foreground" aria-label={`按${p.label}收益率排序`} onClick={() => changeSort(`sell:${p.id}`)}>卖出 · {p.label}{sort === `sell:${p.id}` ? ascending ? ' ↑' : ' ↓' : ''}</button><Popover><PopoverTrigger asChild><button type="button" className="mt-0.5 flex items-center gap-1 font-mono text-primary hover:underline" aria-label={`设置${p.label}卖出算法`}>{ruleText(p)}<ChevronDown className="h-2.5 w-2.5"/>{study.selectedSellId === p.id && <Check className="h-2.5 w-2.5"/>}</button></PopoverTrigger><PopoverContent align="start" className="w-80"><SellEditor key={`${p.id}:${JSON.stringify(p.rule)}`} plan={p} state={state}/></PopoverContent></Popover></th>)}
          <th className={`${cell} min-w-[240px] border-l border-border/40 font-medium`} data-testid="quality-detector-column" aria-sort={sort === 'detector' ? ascending ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort('detector')} aria-label="按探测算法排序">探测算法{sort === 'detector' ? ascending ? ' ↑' : ' ↓' : ''}</button></th><th className={`${cell} font-medium`} aria-label="跳转"/>
        </tr></thead><tbody>{padTop > 0 && <tr aria-hidden style={{ height: padTop }}/>}{visible.map(row => <tr key={row.id} className="group hover:bg-accent/30" data-testid="quality-fish-row">
          <td className={`${cell} sticky left-0 z-10 border-t border-border/40 bg-background font-mono group-hover:bg-accent`} title={EXCHANGE_NAMES[row.source.exchange ?? 'binance']}><span className="inline-flex items-center gap-2"><input type="checkbox" aria-label={`选择 ${row.source.symbol} ${date(row.source.timeMs)}${row.detectorId ? ` ${detectorMap.get(row.detectorId)?.label} ${detectorMap.get(row.detectorId)?.snapshot.threshold}` : ' 信号库'}`} checked={selectedIds.has(row.id)} disabled={!ready} onChange={e => state.setSelectedRows(e.target.checked ? [...selectedIds, row.id] : [...selectedIds].filter(id => id !== row.id))} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/>{row.source.symbol}</span>{row.source.exchange && row.source.exchange !== 'binance' && <span className="ml-1 font-sans text-[9px] text-muted-foreground">{EXCHANGE_NAMES[row.source.exchange]}</span>}{isLibrary(row) && <span className="ml-1"><LibraryBadge/></span>}</td>
          <td className={`${cell} border-t border-border/40 font-mono text-muted-foreground`} title={`模拟买入：${date(row.enteredAt)}（${row.basis === 'detected' ? '实际发现' : row.basis === 'capture' ? '捕捞时刻' : row.basis === 'missing' ? '时间缺失' : isLibrary(row) ? '信号库信号时间' : '原始信号'}）`}>{date(row.source.timeMs)}</td>
          <td className={`${cell} border-t border-border/40 text-muted-foreground`}>{row.source.market === 'us_stock' ? '美股' : ''}</td>
          <td className={`${cell} border-t border-border/40`}><span className="flex gap-px" aria-label={`评分 ${normalizeSignalQuality(row.source.quality) ?? 0} 星`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} className={`h-3 w-3 ${i <= (normalizeSignalQuality(row.source.quality) ?? 0) ? 'fill-[#F0B90B] text-[#F0B90B]' : 'text-muted-foreground/35'}`}/>)}</span></td>
          <td className={`${cell} border-t border-border/40`}>{isLibrary(row) ? <span className="text-muted-foreground/60">—</span> : <FishProcessButton signal={row.source}/>}</td>
          {plans.map(p => <td key={p.id} className={`${cell} border-l border-t border-border/40`}><ResultCell result={qualityRowResult(study, row, p, resultMap)} section={phase === 'detect' && study.selectedSellId === p.id && !isLibrary(row) ? 'detect' : 'sell'} onClick={() => setDetailId(row.id)}/></td>)}
          <td className={`${cell} border-l border-t border-border/40 text-muted-foreground`} data-testid="quality-detector-cell" data-detector-id={row.detectorId ?? ''} title={row.detectorId ? `${detectorMap.get(row.detectorId)?.metric} · ${detectorMap.get(row.detectorId)?.snapshot.interval ?? '5m'} · 公式版本 ${row.detectorId}` : '信号库的信号不归属探测算法'}>{row.detectorId ? <span className="inline-flex items-center gap-2"><span>{detectorMap.get(row.detectorId)?.label ?? '探测算法'}</span><span className="font-mono text-muted-foreground/70">{detectorMap.get(row.detectorId)?.snapshot.direction ?? '>'} {detectorMap.get(row.detectorId)?.snapshot.threshold}</span></span> : '—'}</td>
          <td className={`${cell} border-t border-border/40`}><button type="button" aria-label={`跳转 ${row.source.symbol}`} disabled={!onJump || !!canJump && !canJump(row.source)} onClick={() => onJump?.(row.source)} className="text-primary disabled:opacity-30"><ArrowRightCircle className="h-3.5 w-3.5"/></button></td>
        </tr>)}{padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}/>}</tbody></table></div> : <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10.5px] text-muted-foreground">{allRows.length ? '没有匹配的标的。' : '暂无可评估的信号：捕捞到的鱼和信号库里的信号会自动加入。'}</div>}
      {rows.length > 0 && <p className="text-right text-[10px] tabular-nums text-muted-foreground" data-testid="quality-row-count">共 {rows.length} 行 · {countSignals(rows)} 条信号{rows.length < batch.length ? `（筛选自 ${batch.length} 行）` : ''}</p>}
    </div>}
    <RowDetail row={allRows.find(r => r.id === detailId)} state={state} close={() => setDetailId('')}/>
  </section>;
}
