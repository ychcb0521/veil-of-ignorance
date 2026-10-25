import { useMemo, useState } from 'react';
import { ArrowRightCircle, Check, ChevronDown, CircleHelp, Download, Gauge, RefreshCw, Settings2, Star } from 'lucide-react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { FishProcessButton } from '@/components/FishProcess';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { normalizeSignalQuality, signalMonthKey, type TradeSignal } from '@/lib/signalLibrary';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { qualityComparisonRows, qualityDefinition, type QualityGroup, type QualityResult, type QualitySample } from '@/lib/fish/quality';
import { QUALITY_BINS, qualityComparisonStats, qualityResultMap, qualityRowResult, qualitySellSuggestions, type qualityDistribution } from '@/lib/fish/qualityComparison';
import { downloadQualityComparison } from '@/lib/fish/qualityExport';

const field = 'h-7 min-w-0 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60';
const button = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const heading = '-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted';
const cell = 'px-2 py-1.5';
const pct = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const signed = (v?: number | null) => v == null ? '' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '';
const date = (v?: number | null) => v ? formatUTC8(v) : '—';
const ruleText = (plan: QualityGroup) => plan.rule ? `${plan.rule.direction} ${plan.rule.threshold}` : '设置门槛';
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
function ResultCell({ result, onClick }: { result?: QualityResult; onClick: () => void }) {
  return <button type="button" className="flex w-full items-center justify-between gap-2 text-left hover:underline" onClick={onClick} title={result?.reason ?? '点开查看买卖价格与收益指标'}>
    <span className={`font-mono tabular-nums ${signed(result?.returnPct)}`}>{pct(result?.returnPct)}</span><span className={`text-[9px] ${result?.status === 'error' ? 'text-destructive' : 'text-muted-foreground/70'}`}>{resultText(result)}</span>
  </button>;
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
  const [open, setOpen] = useState(true), [query, setQuery] = useState(''), [month, setMonth] = useState(''), [algorithm, setAlgorithm] = useState('');
  const [phase, setPhase] = useState<'sell' | 'detect'>('sell'), [showStats, setShowStats] = useState(false), [closedOnly, setClosedOnly] = useState(true);
  const [sort, setSort] = useState<'time' | 'symbol'>('time'), [ascending, setAscending] = useState(false), [page, setPage] = useState(0);
  const [hours, setHours] = useState<string | null>(null), [error, setError] = useState(''), [detailId, setDetailId] = useState('');
  const allRows = useMemo(() => qualityComparisonRows(study), [study]);
  const batch = useMemo(() => allRows.filter(r => !study.cohortIds || study.cohortIds.includes(r.id)), [allRows, study.cohortIds]);
  const rows = useMemo(() => batch.filter(r => (!query.trim() || r.source.symbol.toUpperCase().includes(query.trim().toUpperCase())) && (!month || signalMonthKey(r.source.timeMs) === month) && (!algorithm || r.groups.includes(algorithm))).sort((a, b) => (sort === 'time' ? a.source.timeMs - b.source.timeMs : a.source.symbol.localeCompare(b.source.symbol)) * (ascending ? 1 : -1)), [batch, query, month, algorithm, sort, ascending]);
  const months = [...new Set(batch.map(r => signalMonthKey(r.source.timeMs)))].sort().reverse();
  const plans = study.sellPlans ?? [], groups = study.groups.filter(g => batch.some(r => r.groups.includes(g.id)));
  const stats = qualityComparisonStats(study, rows, closedOnly), resultMap = qualityResultMap(study);
  const pageCount = Math.max(1, Math.ceil(rows.length / 50)), currentPage = Math.min(page, pageCount - 1);
  const changeSort = (key: 'time' | 'symbol') => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(key === 'symbol'); } setPage(0); };
  const applyHours = () => { const n = Number(hours ?? study.observeHours); if (!Number.isFinite(n) || n < 0 || n > 8784) { setError('观察时长须在 0～8784 小时之间'); return; } setError(''); setHours(null); if (n !== study.observeHours) state.setObserveHours(n); };
  const exportRows = () => { try { downloadQualityComparison(study, rows); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); } };
  return <section className="min-w-0 border-t border-border/50 px-4 py-3" aria-labelledby="fish-quality-title" data-testid="fish-quality">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5"><button id="fish-quality-title" type="button" className={heading} aria-expanded={open} aria-controls="fish-quality-content" onClick={() => setOpen(!open)}><Gauge aria-hidden className="h-3 w-3 text-muted-foreground"/><span>鱼质量</span><span className={`min-w-[1.25rem] rounded px-1 text-center font-mono text-[10px] tabular-nums ${allRows.length ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{allRows.length}</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button>
        <Popover><PopoverTrigger asChild><button type="button" aria-label="鱼质量说明" className="p-1 text-muted-foreground/40 hover:text-muted-foreground"><CircleHelp className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="w-80 space-y-2 text-[11px] leading-relaxed"><p>先用同一批信号比较卖出算法和门槛的盈亏分布，再固定一套卖出规则，比较各探测算法。</p><p>历史鱼按捕捞时刻入场（不用信号时间：那是事后才知道会持续下去的起点），实时新鱼按实际发现时点入场；随后首根 1 分钟 K 线开盘价近似买入。已有历史样本按此口径重新评估，卖出规则保留。</p><p>收益未扣手续费、资金费和滑点。未卖出持仓单独标记；缺数据不计为零收益。探测分组可以重叠，组间盈亏不相加。固定批次可防止新鱼改变比较样本。</p><p>原捕获记录与旧版规则保留；本次两套卖出试验独立计算，公式冻结，均使用原始值。</p></PopoverContent></Popover>
      </div>
      <button type="button" className={button} disabled={!rows.length} onClick={exportRows} aria-label="导出鱼质量数据"><Download className="h-3 w-3"/>导出数据</button>
    </div>
    {open && <div id="fish-quality-content" className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex h-7 items-center rounded-md bg-muted/60 p-0.5 text-[10.5px]" role="tablist" aria-label="鱼质量比较阶段">{(['sell', 'detect'] as const).map((v, i) => <button type="button" role="tab" aria-selected={phase === v} key={v} className={`h-6 rounded px-2.5 ${phase === v ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => { setPhase(v); setShowStats(true); }}>{i + 1} · {v === 'sell' ? '比较卖出' : '比较探测'}</button>)}</div>
          {phase === 'detect' && <select aria-label="固定卖出方案" value={study.selectedSellId ?? ''} className={`${field} max-w-64`} onChange={e => state.selectSell(e.target.value)}><option value="">选择一套卖出规则</option>{plans.filter(p => p.rule).map(p => <option key={p.id} value={p.id}>{p.label} {ruleText(p)}</option>)}</select>}
          <button type="button" className={button} aria-expanded={showStats} onClick={() => setShowStats(!showStats)}>盈亏分布<ChevronDown className={`h-3 w-3 transition-transform ${showStats ? 'rotate-180' : ''}`}/></button>
          <button type="button" className={button} disabled={!ready || !rows.length} onClick={() => state.setCohort(study.cohortIds ? undefined : rows.map(r => r.id))}>{study.cohortIds ? `已固定 ${batch.length} 条 · 换用全部` : '固定当前批次'}</button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">100 USDT · 1 倍</span>
          <button type="button" className={button} disabled={!ready || running || !rows.length} onClick={() => void state.start()}><RefreshCw className={`h-3 w-3 ${running ? 'animate-spin' : ''}`}/>{running ? `${progress?.done ?? 0}/${progress?.total ?? 0}` : '更新收益'}</button>
          {running && <button type="button" className={button} onClick={state.cancel}>暂停</button>}
          <Popover><PopoverTrigger asChild><button type="button" className={button} aria-label="鱼质量跟踪设置"><Settings2 className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="end" className="w-72 space-y-3 text-[11px]"><label className="flex items-center gap-2"><input type="checkbox" checked={study.tracking} disabled={!ready} onChange={e => state.setTracking(e.target.checked)}/>自动跟踪新鱼及更新收益</label><label className="flex items-center gap-2">观察时长<input aria-label="鱼质量观察小时" type="number" min="0" max="8784" step="any" className={`${field} w-20`} value={hours ?? study.observeHours} onChange={e => setHours(e.target.value)} onBlur={applyHours} onKeyDown={e => { if (e.key === 'Enter') applyHours(); }}/>小时</label><p className="text-[10px] text-muted-foreground">0 = 持续至卖出；每分钟更新，重新打开补算。观察期结束仍持有，不强平。</p></PopoverContent></Popover>
        </div>
      </div>
      {showStats && <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/10 p-2" data-testid="quality-distribution">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px]"><span className="text-muted-foreground">{phase === 'sell' ? `同批对照 · ${stats.paired.length} / ${rows.length} 条${closedOnly ? '共同已卖出' : '共同已评估'}` : stats.selected ? `统一卖出：${stats.selected.label} ${ruleText(stats.selected)}` : '先在第一步设置门槛并固定一套卖出方案'}</span><label className="inline-flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={closedOnly} onChange={e => setClosedOnly(e.target.checked)}/>仅比较已卖出</label></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-[10px]"><thead className="text-[9px] text-muted-foreground"><tr>{[phase === 'sell' ? '卖出方案' : '探测算法 / 捕获门槛', '样本', '平均收益', '中位数', '盈利占比', 'P10', '最差收益', ...QUALITY_BINS].map(t => <th key={t} className={`${cell} font-medium`}>{t}</th>)}</tr></thead><tbody>{phase === 'sell' ? stats.sells.map(s => <tr key={s.plan.id} className="border-t border-border/40"><td className={cell}><button type="button" disabled={!s.plan.rule} className="inline-flex items-center gap-2 text-left disabled:opacity-50" title="固定此方案用于探测算法比较" onClick={() => { state.selectSell(s.plan.id); setPhase('detect'); }}><span>{s.plan.label} <span className="font-mono text-muted-foreground">{ruleText(s.plan)}</span></span><span className="text-primary">{study.selectedSellId === s.plan.id ? '已固定' : '选用 →'}</span></button></td><StatsCells data={s}/></tr>) : stats.detectors.filter(s => s.total > 0).map(s => <tr key={s.group.id} className="border-t border-border/40"><td className={cell}>{s.group.label} <span className="font-mono text-muted-foreground">{s.group.snapshot.direction ?? '>'} {s.group.snapshot.threshold}</span><span className="ml-2 text-muted-foreground">共 {s.total}</span></td><StatsCells data={s}/></tr>)}</tbody></table></div>
        <p className="text-[9.5px] leading-relaxed text-muted-foreground">{phase === 'sell' ? '两方案使用相同买入与共同有效样本；缺数据、等待及未完成的对照不混入分母。' : '每组使用同一卖出规则；未评估、缺数据和未卖出数量不算亏损。分组可重叠。'}{!closedOnly && ' 当前包含持仓浮盈，并非全部已实现收益。'} 样本内比较不自动认定最优，建议固定批次后另用新信号验证。</p>
      </div>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="relative shrink-0"><select aria-label="鱼质量的月份" className={`${field} appearance-none pr-6 font-mono`} value={month} onChange={e => { setMonth(e.target.value); setPage(0); }}><option value="">全部月份（{batch.length}）</option>{months.map(m => <option key={m} value={m}>{m}（{batch.filter(r => signalMonthKey(r.source.timeMs) === m).length}）</option>)}</select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <span className="relative max-w-60 shrink-0"><select aria-label="鱼质量的算法" className={`${field} w-full appearance-none pr-6`} value={algorithm} onChange={e => { setAlgorithm(e.target.value); setPage(0); }}><option value="">全部算法类型</option>{groups.map(g => <option key={g.id} value={g.id}>{g.label} {g.snapshot.direction ?? '>'} {g.snapshot.threshold}</option>)}</select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <input aria-label="筛选鱼质量信号" placeholder="筛选标的…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} className={`${field} min-w-32 flex-1 placeholder:text-muted-foreground/50`}/>
      </div>
      {!ready && <p role="status" className="text-[10.5px] text-muted-foreground">恢复本机记录…</p>}
      {(error || state.warning || state.error) && <p role="alert" className="text-[11px] text-destructive">{error || state.error || state.warning}</p>}
      {rows.length ? <div className="max-h-80 overflow-auto rounded-lg border border-border/60" data-testid="quality-fish-table"><table className="w-full border-separate border-spacing-0 whitespace-nowrap text-left text-[10px]">
        <thead className="sticky top-0 z-20 bg-background text-[9px] font-medium text-muted-foreground"><tr className="bg-muted/40">
          <th className={`${cell} sticky left-0 z-30 min-w-[128px] bg-muted font-medium`}><button type="button" onClick={() => changeSort('symbol')}>标的{sort === 'symbol' ? ascending ? ' ↑' : ' ↓' : ''}</button></th>
          <th className={`${cell} min-w-[140px] font-medium`}><button type="button" onClick={() => changeSort('time')}>信号时间{sort === 'time' ? ascending ? ' ↑' : ' ↓' : ''}</button></th>
          <th className={`${cell} min-w-[150px] font-medium`}>算法类型</th><th className={`${cell} font-medium`}>市场</th><th className={`${cell} font-medium`}>评分</th><th className={`${cell} min-w-[80px] font-medium`}>捕捞过程</th>
          {plans.map(p => <th key={p.id} className={`${cell} min-w-[155px] border-l border-border/40 font-medium`} data-testid="quality-sell-column"><Popover><PopoverTrigger asChild><button type="button" className="space-y-0.5 text-left hover:text-foreground" aria-label={`设置${p.label}卖出算法`}><span className="block">卖出 · {p.label}</span><span className="flex items-center gap-1 font-mono text-primary">{ruleText(p)}<ChevronDown className="h-2.5 w-2.5"/>{study.selectedSellId === p.id && <Check className="h-2.5 w-2.5"/>}</span></button></PopoverTrigger><PopoverContent align="start" className="w-80"><SellEditor key={`${p.id}:${JSON.stringify(p.rule)}`} plan={p} state={state}/></PopoverContent></Popover></th>)}
          {groups.map(g => <th key={g.id} className={`${cell} min-w-[140px] border-l border-border/40 font-medium`} data-testid="quality-detector-column" title={`${g.metric} · ${g.snapshot.interval ?? '5m'} · 公式版本 ${g.id}`}><span className="block">探测 · {g.label}</span><span className="block font-mono text-muted-foreground/70">{g.snapshot.direction ?? '>'} {g.snapshot.threshold}</span></th>)}<th className={`${cell} font-medium`} aria-label="跳转"/>
        </tr></thead><tbody>{rows.slice(currentPage * 50, (currentPage + 1) * 50).map(row => <tr key={row.id} className="group hover:bg-accent/30" data-testid="quality-fish-row">
          <td className={`${cell} sticky left-0 z-10 border-t border-border/40 bg-background font-mono group-hover:bg-accent`} title={EXCHANGE_NAMES[row.source.exchange ?? 'binance']}>{row.source.symbol}{row.source.exchange && row.source.exchange !== 'binance' && <span className="ml-1 font-sans text-[9px] text-muted-foreground">{EXCHANGE_NAMES[row.source.exchange]}</span>}</td>
          <td className={`${cell} border-t border-border/40 font-mono text-muted-foreground`} title={`模拟买入：${date(row.enteredAt)}（${row.basis === 'detected' ? '实际发现' : row.basis === 'capture' ? '捕捞时刻' : row.basis === 'missing' ? '时间缺失' : '原始信号'}）`}>{date(row.source.timeMs)}</td>
          <td className={`${cell} max-w-60 truncate border-t border-border/40 font-mono text-muted-foreground`} title={row.groups.map(id => study.groups.find(g => g.id === id)?.label).join(' · ')}>{[...new Set(row.groups.map(id => study.groups.find(g => g.id === id)?.label))].join(' · ')}</td>
          <td className={`${cell} border-t border-border/40 text-muted-foreground`}>{row.source.market === 'us_stock' ? '美股' : ''}</td>
          <td className={`${cell} border-t border-border/40`}><span className="flex gap-px" aria-label={`评分 ${normalizeSignalQuality(row.source.quality) ?? 0} 星`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} className={`h-3 w-3 ${i <= (normalizeSignalQuality(row.source.quality) ?? 0) ? 'fill-[#F0B90B] text-[#F0B90B]' : 'text-muted-foreground/35'}`}/>)}</span></td>
          <td className={`${cell} border-t border-border/40`}><FishProcessButton signal={row.source}/></td>
          {plans.map(p => <td key={p.id} className={`${cell} border-l border-t border-border/40`}><ResultCell result={qualityRowResult(study, row, p, resultMap)} onClick={() => setDetailId(row.id)}/></td>)}
          {groups.map(g => <td key={g.id} className={`${cell} border-l border-t border-border/40 text-muted-foreground`} title={row.groups.includes(g.id) ? `${g.metric} · 捕获时读数 ${row.readings?.[g.id]?.average ?? '未记录'}` : '该探测算法未捕获此信号'}>{row.groups.includes(g.id) ? <span className="inline-flex items-center gap-1 text-primary/80"><Check className="h-3 w-3"/>命中</span> : '—'}</td>)}
          <td className={`${cell} border-t border-border/40`}><button type="button" aria-label={`跳转 ${row.source.symbol}`} disabled={!onJump || !!canJump && !canJump(row.source)} onClick={() => onJump?.(row.source)} className="text-primary disabled:opacity-30"><ArrowRightCircle className="h-3.5 w-3.5"/></button></td>
        </tr>)}</tbody></table></div> : <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10.5px] text-muted-foreground">{allRows.length ? '没有匹配的标的。' : '暂无可评估的鱼：捕捞到鱼后会自动加入。'}</div>}
      {pageCount > 1 && <div className="flex items-center justify-end gap-3 text-[10px] text-muted-foreground"><span>{rows.length} 条</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    </div>}
    <RowDetail row={allRows.find(r => r.id === detailId)} state={state} close={() => setDetailId('')}/>
  </section>;
}
