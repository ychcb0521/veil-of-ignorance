import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { FishQualityHoldingVetoEditor } from '@/components/FishQualityHoldingVetoEditor';
import { activeHoldingVetoes, holdingVetoIdentity } from '@/lib/fish/qualityVeto';
import { qualityCampaignPath } from '@/lib/campaignSections';
import { hasQualityCampaign } from '@/lib/fish/qualityCampaignArchive';
import { Activity, ArrowRightCircle, Check, ChevronDown, CircleHelp, Download, Filter, Gauge, Pause, Plus, RefreshCw, RotateCcw, Settings2, Star, X } from 'lucide-react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { FishMiningApi } from '@/hooks/useFishMining';
import { FishMiningPanel } from '@/components/FishMiningPanel';
import { FishMonitorLibrary } from '@/components/FishMonitorLibrary';
import { FishQualityInfo, FishQualityModule, qualityPauseAction, qualityPrimaryAction, qualitySplitPauseAction, qualitySplitPrimaryAction } from '@/components/FishQualityModule';
import { FishProcessButton } from '@/components/FishProcess';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { normalizeSignalQuality, signalMonthKey, type TradeSignal } from '@/lib/signalLibrary';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { hasQualityExit, activeBuyFilters, anyBuyFilters, planBuyFilters, qualityDrawdownPct, qualityDisplayRows, qualityDefinition, qualityFilterReadingKey, qualityFilterStatus, type QualityFilterStatus, type QualityGroup, type QualityResult, type QualitySample } from '@/lib/fish/quality';
import { holdingVetoDraft, parseHoldingVetoDraft, makeQualityBuyFilter, qualityFilterChoiceKey, qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { qualityResultMap, qualityRowResult, qualitySellSuggestions } from '@/lib/fish/qualityComparison';
import { qualityFilterCell, qualityFilterColumns, qualityFilterValue } from '@/lib/fish/qualityFilterColumns';
import { downloadQualityComparison } from '@/lib/fish/qualityExport';
import { rangeSelect } from '@/lib/listRangeSelect';
import { collapseQualityTableRows, qualityTableMembers, qualityTableRange, qualityTableSignalKey, type QualityTableRow } from '@/lib/fish/qualityTableRows';
import { ancestorScrolls, applyAncestorScrolls, finishQualityReturn, FROM_FISH_QUALITY, pendingQualityReturn, saveQualityReturn, type QualityReturnUi } from '@/lib/fish/qualityReturn';

const field = 'h-7 min-w-0 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60';
const button = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const heading = '-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted';
const cell = 'px-2 py-1.5';
const countSignals = (rows: readonly QualitySample[]) => new Set(rows.map(qualityTableSignalKey)).size;
const pct = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const signed = (v?: number | null) => v == null ? '' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '';
const date = (v?: number | null) => v ? formatUTC8(v) : '—';
const ruleText = (plan: QualityGroup) => plan.rule ? `${plan.rule.direction} ${plan.rule.threshold}` : hasQualityExit(plan) ? '仅一票否决' : '设置门槛';
const isLibrary = (row: QualitySample) => row.origin === 'library';
const sourceOf = (row: QualitySample) => isLibrary(row) ? 'library' : row.source.mined ? 'mined' : 'fish';
// 【用户反馈】2026-10-26「表头显示 793，但表中完全没这么多」：原来每页 50 条、框只有约 9 行高，要翻 16 页。
// 改为所有行在同一个滚动框里，只渲染可见的几十行（行高按首行实测，量不到时用名义值）。
const ROW_PX = 33, TABLE_PX = 448, OVERSCAN = 12;
// 【用户要求】2026-10-26「鱼质量中的所有表头都要能够排序」：空值（未评估、无评分等）不论升降都排在最后
type SortKey = 'time' | 'symbol' | 'market' | 'quality' | 'process' | 'detector' | `filter:${string}` | `sell:${string}` | `static:${string}` | `dynamic:${string}` | `held:${string}`;
const TEXT_KEYS = new Set(['symbol', 'market', 'detector']);
/** 持仓时间：不到 1 小时写分钟，两天内写小时，再长写天。 */
export function heldText(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} 分钟`;
  if (hours < 48) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}
const resultText = (r?: QualityResult) => r?.status === 'closed' ? '已卖出' : r?.status === 'open' ? '持有' : r?.status === 'error' ? '缺数据' : r?.status === 'waiting' && r.entryPrice ? '待设卖出' : '待评估';

function SellEditor({ plan, state }: { plan: QualityGroup; state: FishQualityState }) {
  const definition = qualityDefinition(plan.snapshot);
  const [threshold, setThreshold] = useState(String(plan.rule?.threshold ?? plan.snapshot.threshold));
  const [direction, setDirection] = useState<'<' | '>'>(plan.rule?.direction ?? '<'), [error, setError] = useState('');
  const save = () => {
    if (!threshold.trim() || !Number.isFinite(Number(threshold))) { setError('请填写有限数字门槛'); return; }
    setError(''); state.setRule(plan.id, { metric: plan.metric, direction, threshold: Number(threshold) });
  };
  return <div className="space-y-3" data-testid={`quality-sell-editor-${plan.id}`}>
    <div className="space-y-0.5"><p className="text-xs font-medium">{plan.label}</p><p className="text-[10.5px] text-muted-foreground">{plan.snapshot.interval} 指标 · {plan.execution === 'intrabar-1m' ? '盘中达标 / 1分钟复原' : '收盘确认'} · 使用原始值</p></div>
    <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><span>试验门槛</span>{qualitySellSuggestions(plan).map(v => <button type="button" key={v} className="rounded border border-border/60 px-2 py-1 hover:bg-muted" onClick={() => setThreshold(String(v))}>{v}</button>)}</div>
    <div className="flex items-center gap-1.5">
      <select aria-label={`${plan.label}卖出方向`} className={field} value={direction} onChange={e => setDirection(e.target.value as '<' | '>')}><option value="<">&lt;</option><option value=">">&gt;</option></select>
      <input aria-label={`${plan.label}卖出门槛`} type="number" step="any" value={threshold} onChange={e => setThreshold(e.target.value)} className={`${field} w-24`}/>
      <button type="button" disabled={!state.ready} onClick={save} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">应用并重算</button>
    </div>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">以上数值供比较，未预选为最优。{plan.execution === 'intrabar-1m' ? '逐分钟复原原周期指标，首次达标后按紧接的分钟开盘价卖出；历史精度为 1 分钟。' : '首次满足条件的收盘后，按下一分钟开盘价卖出。'}</p>
    {hasQualityExit(plan) && <div className="flex flex-wrap gap-2 text-[11px]"><button type="button" className="text-primary hover:underline" onClick={() => state.selectSell(plan.id)}>固定此方案，比较探测算法</button>{plan.rule && <button type="button" className="text-muted-foreground hover:underline" onClick={() => state.setRule(plan.id, undefined)}>清除门槛</button>}</div>}
    <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">公式与参数</summary><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{definition.formula}</pre><p className="mt-1">{plan.snapshot.interval} 原周期 · hl {definition.halfLifeHours} 小时 · avgh {definition.avgHours} 小时 · 原值倍率 1</p><p className="mt-1">每次运行前读取当前账号定义，运行结果保存当次公式快照。</p></details>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
type FilterDraft = { choice: string; direction: '<' | '>'; threshold: string; enabled: boolean };
/** 【用户要求】2026-10-26 比较卖出时的买入过滤，条件由用户自己设。 */
function BuyFilterEditor({ state, plan, done }: { state: FishQualityState; plan: QualityGroup; done: () => void }) {
  const choices = useMemo(() => qualityFilterChoices(), []), groups = [...new Set(choices.map(c => c.group))];
  const [draft, setDraft] = useState<FilterDraft[]>(() => planBuyFilters(state.study, plan).map(f => ({ choice: qualityFilterChoiceKey(f), direction: f.direction, threshold: String(f.threshold), enabled: f.enabled })));
  const [error, setError] = useState('');
  const patch = (i: number, p: Partial<FilterDraft>) => setDraft(draft.map((d, j) => j === i ? { ...d, ...p } : d));
  const add = () => setDraft([...draft, { choice: choices.find(c => c.key === 'state:state')?.key ?? choices[0]?.key ?? '', direction: '>', threshold: '0.7', enabled: true }]);
  const apply = () => {
    if (draft.some(d => !d.threshold.trim() || !Number.isFinite(Number(d.threshold)))) { setError('每条条件都要填有限数字门槛'); return; }
    try { state.setFilters(plan.id, draft.map(d => makeQualityBuyFilter(d.choice, d.direction, Number(d.threshold), d.enabled))); setError(''); done(); }
    catch (e) { setError(e instanceof Error ? e.message : '条件无效'); }
  };
  return <div className="space-y-3" data-testid="quality-buy-filter-editor">
    <div className="space-y-0.5"><p className="text-xs font-medium">买入过滤 · {plan.label}</p><p className="text-[10.5px] leading-relaxed text-muted-foreground">只作用于这套卖出方案，其他方案各有各的条件，运行前后设置效果相同。读数取买入时刻之前最后一根已收盘的 5 分钟 K 线，全部启用的条件都满足才买入。</p><p className="text-[10.5px] leading-relaxed text-muted-foreground">修改买入条件会复用已有结果，只重新筛选；新增指标时补取买入读数，放宽条件后仅补算尚无结果的标的。持仓一票否决在「持仓监测」的条件设置里。</p></div>
    {draft.length ? <div className="space-y-1.5">{draft.map((d, i) => <div key={i} className="flex items-center gap-1.5">
      <input type="checkbox" aria-label={`启用买入条件 ${i + 1}`} checked={d.enabled} onChange={e => patch(i, { enabled: e.target.checked })} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/>
      <select aria-label={`买入条件 ${i + 1} 指标`} className={`${field} min-w-0 flex-1`} value={d.choice} onChange={e => patch(i, { choice: e.target.value })}>{groups.map(g => <optgroup key={g} label={g}>{choices.filter(c => c.group === g).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}</select>
      <select aria-label={`买入条件 ${i + 1} 方向`} className={field} value={d.direction} onChange={e => patch(i, { direction: e.target.value as '<' | '>' })}><option value=">">&gt;</option><option value="<">&lt;</option></select>
      <input aria-label={`买入条件 ${i + 1} 门槛`} type="number" step="any" className={`${field} w-20`} value={d.threshold} onChange={e => patch(i, { threshold: e.target.value })}/>
      <button type="button" aria-label={`删除买入条件 ${i + 1}`} className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground" onClick={() => setDraft(draft.filter((_, j) => j !== i))}><X className="h-3 w-3"/></button>
    </div>)}</div> : <p className="rounded-md border border-dashed border-border/60 px-3 py-3 text-center text-[10.5px] text-muted-foreground">未设置条件：全部信号都买入</p>}
    <div><button type="button" className={button} onClick={add}><Plus className="h-3 w-3"/>添加条件</button></div>
    {/* 「应用」固定在弹层底部：弹层再长、屏幕再矮也点得到（【用户要求】2026-10-26 改了动态回撤却不生效——按钮被挤出了屏幕） */}
    <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-border/50 bg-popover px-4 py-2.5"><button type="button" disabled={!state.ready} onClick={apply} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">应用到「{plan.label}」筛选</button>
    </div>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
/**
 * 【用户要求】2026-10-27「持仓监测中也需要一个条件设置」「持仓一票否决卖出其实隶属于持仓监测」：
 * 这套卖出方案的持仓一票否决在这里设（观察时长已于 0d3dc61c 从界面移除，不放回来）。
 */
function HoldingMonitorEditor({ state, plan, done }: { state: FishQualityState; plan: QualityGroup; done: () => void }) {
  const [vetoDraft, setVetoDraft] = useState(() => holdingVetoDraft(plan.holdingVetoes)), [error, setError] = useState('');
  let vetoChanged = false;
  try { vetoChanged = JSON.stringify(holdingVetoIdentity(parseHoldingVetoDraft(vetoDraft))) !== JSON.stringify(holdingVetoIdentity(plan.holdingVetoes)); }
  catch { vetoChanged = true; }
  const apply = () => {
    try { const vetoes = parseHoldingVetoDraft(vetoDraft); if (vetoChanged) state.setHoldingVetoes(plan.id, vetoes); setError(''); done(); }
    catch (e) { setError(e instanceof Error ? e.message : '条件无效'); }
  };
  return <div className="space-y-3" data-testid="quality-monitor-editor">
    <div className="space-y-0.5"><p className="text-xs font-medium">持仓监测 · {plan.label}</p><p className="text-[10.5px] leading-relaxed text-muted-foreground">买入之后何时提前卖出。持仓一票否决只作用于这套卖出方案；改动后立刻按新设置重新计算卖出，正在跑的旧批次直接作废。</p></div>
    <FishQualityHoldingVetoEditor draft={vetoDraft} setDraft={setVetoDraft}/>
    <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-border/50 bg-popover px-4 py-2.5"><button type="button" disabled={!state.ready} onClick={apply} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">应用到「{plan.label}」{vetoChanged ? '并重算' : ''}</button></div>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
/** 选卖出方案的分页条：买前过滤和持仓监测共用，角标是该方案已启用的条件数。 */
function PlanTabs({ plans, active, count, label, onSelect }: { plans: QualityGroup[]; active?: string; count: (plan: QualityGroup) => number; label: string; onSelect: (id: string) => void }) {
  if (plans.length < 2) return null;
  return <div role="tablist" aria-label={label} className="mb-3 inline-flex h-7 items-center rounded-md bg-muted/60 p-0.5 text-[10.5px]">{plans.map(p => { const n = count(p); return <button type="button" role="tab" key={p.id} aria-selected={active === p.id} onClick={() => onSelect(p.id)} className={`inline-flex h-6 items-center gap-1 rounded px-2.5 ${active === p.id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{p.label}{n > 0 && <span className="rounded bg-primary/15 px-1 font-mono text-[9.5px] tabular-nums text-primary">{n}</span>}</button>; })}</div>;
}
const FILTER_TEXT: Record<QualityFilterStatus['state'], string> = { none: '', pass: '满足', fail: '未买入', pending: '待判断', error: '缺数据' };
function ResultCell({ result, onClick, section, onOpenCampaign }: { result?: QualityResult; onClick: () => void; section: 'sell' | 'detect'; onOpenCampaign?: () => void }) {
  const router = useInRouterContext(), className = 'flex w-full items-center justify-between gap-2 text-left hover:underline';
  const content = <><span className={`font-mono tabular-nums ${signed(result?.returnPct)}`}>{pct(result?.returnPct)}</span><span className={`text-[9px] ${result?.status === 'error' ? 'text-destructive' : 'text-muted-foreground/70'}`}>{resultText(result)}</span></>;
  if (result && hasQualityCampaign(result)) {
    const href = qualityCampaignPath(result.key, section);
    return router ? <Link to={href} state={FROM_FISH_QUALITY} onClick={onOpenCampaign} className={className} title="打开该标的的交易战役">{content}</Link> : <a href={href} className={className} title="打开该标的的交易战役">{content}</a>;
  }
  return <button type="button" className={className} onClick={onClick} title={result?.reason ?? '点开查看买卖价格与收益指标'}>{content}</button>;
}

function MergedEntryCells({ entries, phase, planId, expand }: { entries: { result?: QualityResult; skipped?: QualityFilterStatus }[]; phase: 'sell' | 'detect'; planId: string; expand: () => void }) {
  const results = entries.map(e => e.skipped ? undefined : e.result);
  const returns = results.map(r => r && (r.status === 'open' || r.status === 'closed') ? r.returnPct : null);
  const summary = qualityTableRange(returns, pct);
  const title = `合并 ${entries.length} 次买入记录；展开探测算法查看各次买入、过滤与收益明细`;
  return <>
    <td className={`${cell} border-l border-t border-border/40`}><button type="button" className="flex w-full items-center justify-between gap-2 text-left hover:underline" onClick={expand} title={title}><span className="font-mono tabular-nums">{summary === '—' ? entries.every(e => e.skipped?.state === 'fail') ? '未买入' : `${returns.filter(v => v != null).length}/${entries.length} 有结果` : summary}</span><span className="text-[9px] text-muted-foreground">{entries.length} 次买入 · 展开</span></button></td>
    {phase === 'sell' && <>{(['static','dynamic'] as const).map(kind => <td key={kind} className={`${cell} border-t border-border/40 font-mono tabular-nums text-muted-foreground`} data-testid={`quality-${kind}-drawdown`} data-sell-plan={planId} title={title}>{qualityTableRange(results.map(r => qualityDrawdownPct(r,kind)), value => pct(value).replace(/^\+/, ''))}</td>)}<td className={`${cell} border-t border-border/40 font-mono tabular-nums text-muted-foreground`} data-testid="quality-held-time" data-sell-plan={planId} title={title}>{qualityTableRange(results.map(r => r && (r.status === 'open' || r.status === 'closed') ? r.heldHours : null), heldText)}</td></>}
  </>;
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
      ['静态最大回撤', (r?: QualityResult) => pct(qualityDrawdownPct(r,'static')).replace(/^\+/, '')], ['动态最大回撤', (r?: QualityResult) => pct(qualityDrawdownPct(r,'dynamic')).replace(/^\+/, '')], ['涨幅未兑现', (r?: QualityResult) => pct(r?.uncapturedPct).replace(/^\+/, '')],
      ['持仓小时', (r?: QualityResult) => r?.heldHours?.toFixed(2) ?? '—'],
    ].map(([label, format]) => <tr key={label as string} className="border-t border-border/40"><td className={`${cell} text-muted-foreground`}>{label as string}</td>{study.sellPlans?.map(p => <td key={p.id} className={`${cell} max-w-80 whitespace-normal font-mono`}>{(format as (r?: QualityResult) => string)(qualityRowResult(study, row, p))}</td>)}</tr>)}</tbody></table></div>}
  </DialogContent></Dialog>;
}

const detectorText = (g: QualityGroup) => `${g.label} ${g.snapshot.direction ?? '>'} ${g.snapshot.threshold}`;
/**
 * 选探测算法：可以选一个，也可以选多个；不选 = 全部。表头和筛选栏共用。
 * 【用户要求】2026-10-26「比较探测中，我希望可以在列表中的表头直接选中对应的算法（可以选中一个，也可以选中多个）」
 */
function DetectorPicker({ groups, counts, selected, onChange, children }: { groups: QualityGroup[]; counts: ReadonlyMap<string, number>; selected: readonly string[]; onChange: (ids: string[]) => void; children: ReactNode }) {
  return <Popover><PopoverTrigger asChild>{children}</PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-80 max-h-[min(70vh,var(--radix-popover-content-available-height))] overflow-y-auto p-0 text-[11px]" data-testid="quality-detector-picker">
    <div className="sticky top-0 flex items-center justify-between border-b border-border/50 bg-popover px-3 py-2"><span className="font-medium">探测算法<span className="ml-1.5 font-normal text-muted-foreground">{selected.length ? `已选 ${selected.length} / ${groups.length}` : `全部 ${groups.length} 个`}</span></span><button type="button" className="text-primary hover:underline disabled:text-muted-foreground/50 disabled:no-underline" disabled={!selected.length} onClick={() => onChange([])}>全部</button></div>
    <ul role="group" aria-label="选择探测算法" className="py-1">{groups.map(g => { const on = selected.includes(g.id); return <li key={g.id} className="group/item flex items-center gap-2 px-3 py-1.5 hover:bg-muted/60">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"><input type="checkbox" aria-label={`探测算法 ${detectorText(g)}`} checked={on} onChange={() => onChange(on ? selected.filter(id => id !== g.id) : [...selected, g.id])} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/><span className="min-w-0 flex-1 truncate">{g.label}</span><span className="shrink-0 font-mono text-muted-foreground/80">{g.snapshot.direction ?? '>'} {g.snapshot.threshold}</span></label>
      <button type="button" className="shrink-0 text-primary opacity-0 hover:underline focus-visible:opacity-100 group-hover/item:opacity-100" aria-label={`只看 ${detectorText(g)}`} onClick={() => onChange([g.id])}>仅此</button>
      <span className="w-8 shrink-0 text-right font-mono tabular-nums text-muted-foreground/60" title="条信号">{counts.get(g.id) ?? 0}</span>
    </li>; })}</ul>
  </PopoverContent></Popover>;
}
export function FishQuality({ state, mining, onJump, canJump }: { state: FishQualityState; mining?: FishMiningApi; onJump?: (source: TradeSignal) => void; canJump?: (source: TradeSignal) => boolean }) {
  const { study, ready, running, progress } = state;
  // 从交易战役返回：按离开时记下的状态打开（见 lib/fish/qualityReturn）
  const [back] = useState(() => pendingQualityReturn()), ui = back?.ui;
  const [open, setOpen] = useState(ui?.open ?? true), [query, setQuery] = useState(ui?.query ?? ''), [month, setMonth] = useState(ui?.month ?? ''), [algorithms, setAlgorithmsState] = useState<string[]>(() => ui?.algorithms ?? (ui?.algorithm ? [ui.algorithm] : [])), [origin, setOrigin] = useState<QualityReturnUi['origin']>(ui?.origin ?? '');
  // 【用户要求】2026-10-26「比较卖出和比较探测没必要分开，合并到一起，统一叫做卖出与探测（控制变量法）」：只有一个视图
  const phase = 'sell' as const;
  const [detectorExpanded, setDetectorExpanded] = useState(ui?.detectorExpanded ?? false);
  const [filterOpen, setFilterOpen] = useState(false), [monitorOpen, setMonitorOpen] = useState(false), [runMenuOpen, setRunMenuOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>((ui?.sort as SortKey | undefined) ?? 'time'), [ascending, setAscending] = useState(ui?.ascending ?? false), [scrollTop, setScrollTop] = useState(ui?.tableTop ?? 0);
  const rootRef = useRef<HTMLElement>(null);
  /** 点进交易战役前记下界面状态与滚动位置，返回时原样恢复。 */
  const rememberReturn = () => saveQualityReturn({
    ui: { open, query, month, algorithms, origin, detectorExpanded, sort, ascending, tableTop: tableRef.current?.scrollTop ?? scrollTop },
    scroll: ancestorScrolls(rootRef.current),
  });
  const [error, setError] = useState(''), [detailId, setDetailId] = useState('');
  const allRows = useMemo(() => qualityDisplayRows(study), [study]);
  const detectorMap = useMemo(() => new Map(study.groups.map(g => [g.id, g])), [study.groups]);
  const batch = allRows;
  // 月份条数跟随来源、探测算法、标的筛选；同一信号的多个探测行只计一次。
  // 选中的探测算法里已不在当前批次的不算（否则整表会空掉）
  const batchDetectors = useMemo(() => new Set(batch.map(r => r.detectorId).filter((id): id is string => !!id)), [batch]);
  const activeAlgorithms = useMemo(() => algorithms.filter(id => batchDetectors.has(id)), [algorithms, batchDetectors]);
  const searched = useMemo(() => batch.filter(r => (!query.trim() || r.source.symbol.toUpperCase().includes(query.trim().toUpperCase())) && (!origin || sourceOf(r) === origin)), [batch, query, origin]);
  const narrowed = useMemo(() => activeAlgorithms.length ? searched.filter(r => activeAlgorithms.includes(r.detectorId ?? '')) : searched, [searched, activeAlgorithms]);
  /** 各探测算法在当前来源 / 标的筛选下的信号条数（同一信号只计一次）。 */
  const detectorCounts = useMemo(() => { const ids = new Map<string, Set<string>>(); for (const r of searched) if (r.detectorId) { if (!ids.has(r.detectorId)) ids.set(r.detectorId, new Set()); ids.get(r.detectorId)!.add(r.signalId ?? r.id); } return new Map([...ids].map(([id, set]) => [id, set.size])); }, [searched]);
  const resultMap = useMemo(() => qualityResultMap(study), [study]);
  // 买入过滤按卖出方案各自一套：planId → 信号 → 这套方案下买没买
  const filtersOn = anyBuyFilters(study), filterReadings = study.filterReadings;
  const filterColumns = useMemo(() => qualityFilterColumns(study), [study.sellPlans, study.buyFilters]); // eslint-disable-line react-hooks/exhaustive-deps
  const filterReadingMap = useMemo(() => new Map((filterReadings ?? []).map(r => [r.key, r])), [filterReadings]);
  const filterStatus = useMemo(() => {
    const byPlan = new Map<string, Map<string, QualityFilterStatus>>(), readings = new Map((filterReadings ?? []).map(r => [r.key, r]));
    for (const plan of study.sellPlans ?? []) {
      if (!activeBuyFilters(study, plan).length) continue;
      const map = new Map<string, QualityFilterStatus>();
      for (const r of narrowed) { const id = r.signalId ?? r.id; if (!map.has(id)) map.set(id, qualityFilterStatus(study, r, plan, readings)); }
      byPlan.set(plan.id, map);
    }
    return byPlan;
  }, [narrowed, filterReadings, study.buyFilters, study.sellPlans]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 这一行在这套方案下没买入（不满足 / 待判断 / 缺数据）时给出原因；买入了或没开过滤时为 undefined。 */
  const skippedBy = (plan: QualityGroup, row: QualitySample) => { const f = filterStatus.get(plan.id)?.get(row.signalId ?? row.id); return f && f.state !== 'pass' ? f : undefined; };
  const [filterPlanId, setFilterPlanId] = useState<string | null>(null);
  const filterPlan = study.sellPlans?.find(p => p.id === filterPlanId) ?? study.sellPlans?.[0];
  const [monitorPlanId, setMonitorPlanId] = useState<string | null>(null);
  const monitorPlan = study.sellPlans?.find(p => p.id === monitorPlanId) ?? study.sellPlans?.[0];
  const filterCount = (study.sellPlans ?? []).reduce((n, p) => n + activeBuyFilters(study, p).length, 0), vetoCount = (study.sellPlans ?? []).reduce((n, p) => n + activeHoldingVetoes(p.holdingVetoes).length, 0);
  const openFilterFor = (planId: string) => { setFilterPlanId(planId); setFilterOpen(true); };
  const plansForSort = study.sellPlans;
  const sortedRows = useMemo(() => {
    const map = resultMap;
    const value = (r: QualitySample): number | string | null => {
      if (sort === 'time') return r.source.timeMs;
      if (sort === 'symbol') return r.source.symbol;
      if (sort === 'market') return r.source.market === 'us_stock' ? '美股' : '加密';
      if (sort === 'quality') return normalizeSignalQuality(r.source.quality) ?? null;
      if (sort === 'process') return isLibrary(r) ? null : r.source.fish?.cutoffMs ?? null;
      if (sort === 'detector') { const g = detectorMap.get(r.detectorId ?? ''); return g ? `${g.label}\u0000${String(g.snapshot.threshold).padStart(12, '0')}\u0000${g.metric}` : null; }
      if (sort.startsWith('filter:')) { const column = filterColumns.find(c => `filter:${c.id}` === sort); return column ? qualityFilterValue(r, column.filter, filterReadingMap) : null; }
      const metric = sort.startsWith('static:') ? 'static' : sort.startsWith('dynamic:') ? 'dynamic' : sort.startsWith('held:') ? 'held' : 'sell';
      const plan = plansForSort?.find(p => `${metric}:${p.id}` === sort);
      // 这套方案开着买入过滤时，它没买入（不满足 / 待判断 / 缺数据）的行在它的列里算空值，排在最后
      if (!plan || filterStatus.get(plan.id)?.get(r.signalId ?? r.id)?.state !== undefined && filterStatus.get(plan.id)!.get(r.signalId ?? r.id)!.state !== 'pass') return null;
      const res = qualityRowResult(study, r, plan, map);
      if (metric === 'held') return res && (res.status === 'closed' || res.status === 'open') && Number.isFinite(res.heldHours) ? res.heldHours! : null;
      if (metric !== 'sell') return qualityDrawdownPct(res,metric);
      return res && (res.status === 'closed' || res.status === 'open') && Number.isFinite(res.returnPct) ? res.returnPct! : null;
    };
    const keyed = narrowed.filter(r => !month || signalMonthKey(r.source.timeMs) === month).map(r => ({ r, v: value(r) }));
    return keyed.sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? b.r.source.timeMs - a.r.source.timeMs : a.v == null ? 1 : -1;
      const order = typeof a.v === 'string' ? a.v.localeCompare(String(b.v)) : a.v - (b.v as number);
      return order * (ascending ? 1 : -1) || b.r.source.timeMs - a.r.source.timeMs || a.r.id.localeCompare(b.r.id);
    }).map(x => x.r);
  }, [narrowed, month, sort, ascending, detectorMap, resultMap, plansForSort, filterStatus, filterColumns, filterReadingMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows: QualityTableRow[] = useMemo(() => detectorExpanded ? sortedRows : collapseQualityTableRows(sortedRows), [sortedRows, detectorExpanded]);
  const monthCounts = useMemo(() => {
    const ids = new Map<string, Set<string>>();
    for (const r of narrowed) { const key = signalMonthKey(r.source.timeMs); if (!ids.has(key)) ids.set(key, new Set()); ids.get(key)!.add(qualityTableSignalKey(r)); }
    return new Map([...ids].map(([key, signals]) => [key, signals.size]));
  }, [narrowed]);
  const months = [...new Set(batch.map(r => signalMonthKey(r.source.timeMs)))].sort().reverse();
  const plans = study.sellPlans ?? [], groups = study.groups.filter(g => batch.some(r => r.detectorId === g.id));
  const selectedIds = new Set(study.selectedRowIds ?? []);
  const selectedRows = rows.filter(r => qualityTableMembers(r).some(member => selectedIds.has(member.id)));
  const selectedBatch = batch.filter(r => selectedIds.has(r.id));
  const selectedCount = detectorExpanded ? selectedBatch.length : collapseQualityTableRows(selectedBatch).length;
  const rowSelected = (row: QualityTableRow) => qualityTableMembers(row).every(member => selectedIds.has(member.id));
  const allSelected = rows.length > 0 && rows.every(rowSelected);
  // Shift 连选的起点：最后一次单击（或连选）的那一行
  const selectAnchor = useRef<string | null>(null);
  const toggleRow = (id: string, checked: boolean, shift: boolean) => {
    const affected = new Set(rangeSelect(rows.map(r => r.id), new Set<string>(), selectAnchor.current, id, true, shift));
    const ids = new Set(selectedIds);
    rows.filter(row => affected.has(row.id)).flatMap(qualityTableMembers).forEach(member => { if (checked) ids.add(member.id); else ids.delete(member.id); });
    state.setSelectedRows([...ids]);
    selectAnchor.current = id;
  };
  const selectVisible = (checked: boolean) => {
    const ids = new Set(selectedIds); rows.flatMap(qualityTableMembers).forEach(row => { if (checked) ids.add(row.id); else ids.delete(row.id); });
    state.setSelectedRows([...ids]);
  };
  const tableRef = useRef<HTMLDivElement>(null), [rowPx, setRowPx] = useState(ROW_PX), [viewPx, setViewPx] = useState(TABLE_PX);
  const resetScroll = () => { setScrollTop(0); if (tableRef.current) tableRef.current.scrollTop = 0; };
  const setAlgorithms = (ids: string[]) => { setAlgorithmsState(ids); resetScroll(); };
  const expandDetectors = (expanded: boolean) => { setDetectorExpanded(expanded); selectAnchor.current = null; resetScroll(); };
  // 返回时把表格与外面各层滚回原处：数据是陆续载入的，逐帧重试到位置稳住（最多 8 秒）；用户一动滚轮 / 触屏 / 按键就停手
  const readyRef = useRef(ready); readyRef.current = ready;
  useLayoutEffect(() => {
    if (!back) return;
    let frame = 0, stable = 0, stopped = false;
    const started = performance.now();
    const stop = () => { stopped = true; cancelAnimationFrame(frame); finishQualityReturn(); for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.removeEventListener(type, stop, true); };
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(type, stop, true);
    const step = () => {
      if (stopped) return;
      const table = tableRef.current;
      let ok = true;
      if (table && Math.abs(table.scrollTop - back.ui.tableTop) > 1) { table.scrollTop = back.ui.tableTop; setScrollTop(table.scrollTop); ok = Math.abs(table.scrollTop - back.ui.tableTop) <= 1; }
      if (!table && back.ui.tableTop > 0) ok = false;
      ok = applyAncestorScrolls(rootRef.current, back.scroll) && ok;
      stable = ok && readyRef.current ? stable + 1 : 0;
      if (stable >= 15 || performance.now() - started > 8000) { stop(); return; }
      frame = requestAnimationFrame(step);
    };
    step();
    return stop;
  }, [back]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = tableRef.current; if (!el) return;
    const row = el.querySelector<HTMLElement>('tbody tr[data-testid="quality-fish-row"]');
    if (row && row.offsetHeight > 0 && Math.abs(row.offsetHeight - rowPx) > .5) setRowPx(row.offsetHeight);
    if (el.clientHeight > 0 && el.clientHeight !== viewPx) setViewPx(el.clientHeight);
  }, [open, rows, rowPx, viewPx]);
  const first = Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / rowPx) - OVERSCAN));
  const last = Math.min(rows.length, Math.max(first + 1, Math.ceil((scrollTop + viewPx) / rowPx) + OVERSCAN));
  const visible = rows.slice(first, last), padTop = first * rowPx, padBottom = (rows.length - last) * rowPx;
  // 评估先算屏幕上看得见的行，再按表格顺序往下
  const { setPriority } = state;
  useEffect(() => { setPriority?.([...visible.flatMap(qualityTableMembers), ...rows.flatMap(qualityTableMembers)].map(r => r.signalId ?? r.id)); }, [setPriority, rows, first, last]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeSort = (key: SortKey) => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(TEXT_KEYS.has(key)); } resetScroll(); };
  const arrow = (key: SortKey) => sort === key ? ascending ? ' ↑' : ' ↓' : '';
  const ariaSort = (key: SortKey) => sort === key ? ascending ? 'ascending' as const : 'descending' as const : 'none' as const;
  const sortButton = (k: SortKey, label: string) => <button type="button" className="hover:text-foreground" onClick={() => changeSort(k)} aria-label={`按${label}排序`}>{label}{arrow(k)}</button>;
  const exportRows = () => { try { downloadQualityComparison(study, rows.flatMap(qualityTableMembers)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); } };
  return <section ref={rootRef} className="min-w-0 border-t border-border/50 px-4 py-3" aria-labelledby="fish-quality-title" data-testid="fish-quality">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5"><button id="fish-quality-title" type="button" className={heading} aria-expanded={open} aria-controls="fish-quality-content" onClick={() => setOpen(!open)}><Gauge aria-hidden className="h-3 w-3 text-muted-foreground"/><span>鱼质量</span><span className={`min-w-[1.25rem] rounded px-1 text-center font-mono text-[10px] tabular-nums ${allRows.length ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{countSignals(allRows)}</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button>
        <Popover><PopoverTrigger asChild><button type="button" aria-label="鱼质量说明" className="p-1 text-muted-foreground/40 hover:text-muted-foreground"><CircleHelp className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" className="w-80 space-y-2 text-[11px] leading-relaxed"><p>点「开始过滤」独立计算买入条件：在捕捞过程右侧查看各指标读数和是否满足条件。读数取买入时刻之前最后一根已收盘 K 线；修改门槛复用已有读数。</p><p>设置卖出算法后，可比较同一批信号的收益，再固定一套卖出规则，比较各探测算法。</p><p>批量挖掘、买前过滤和持仓监测可同时独立运行，各自暂停。点「开始监测」后在后台运行：按开始时的勾选和参数计算，切换选项或页面不会中断；已算完且条件没变的结果直接沿用，只补算缺的和改过的；要全部重算，点「开始监测」右侧的 ▾ 选「从头重新计算」（各轮不同算法和门槛下的结果都保留，同币种、同时间、同算法同门槛的合并为一条）。改了买入过滤会复用已有结果，改了持仓否决会立刻按新设置重新开始，其他参数改动在本批完成后补算。</p><p>信号库的信号也会加入，可通过来源筛选区分，按信号时间买入；它们只参加卖出方案的比较，不属于任何探测算法，也不与鱼舱的鱼合并。</p><p>历史鱼按捕捞时刻入场（不用信号时间：那是事后才知道会持续下去的起点），实时新鱼按实际发现时点入场；随后首根 1 分钟 K 线开盘价近似买入。已有历史样本按此口径重新评估，卖出规则保留。</p><p>收益未扣手续费、资金费和滑点。未卖出持仓单独标记；缺数据不计为零收益。探测分组可以重叠，组间盈亏不相加。</p><p>同一标的、同一信号时间默认合并一行；打开「探测算法」的展开开关后显示明细。不同买入记录的结果显示范围；合并行勾选覆盖全部明细，展开后可单独勾选。</p><p>原捕获记录与旧版规则保留；本次两套卖出试验独立计算，公式冻结，均使用原始值。</p></PopoverContent></Popover>
      </div>
      <button type="button" className={button} disabled={!rows.length} onClick={exportRows} aria-label="导出鱼质量数据"><Download className="h-3 w-3"/>导出数据</button>
    </div>
    {open && <div id="fish-quality-content" className="mt-2 space-y-2">
      <div className="min-w-0" data-testid="quality-modules">
        {mining && <FishMiningPanel mining={mining} sellFixed={!!study.sellPlans?.some(p => p.id === study.selectedSellId && hasQualityExit(p))} campaignHref="/journal/campaigns?section=quality"/>}
        <FishQualityModule title="买前过滤" icon={Filter} testId="quality-filter-controls" summary={<FishQualityInfo label="买前过滤说明"><p>{filterCount ? `${filterCount} 条买入条件` : '未设买入条件'}</p><p className="text-muted-foreground">对已勾选信号独立判断买入条件；读数取买入时刻前最后一根已收盘 K 线。修改门槛复用已有读数。</p></FishQualityInfo>} status={state.filterProgress && <p role="status" aria-live="polite" className="inline-flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${state.filterRunning ? 'animate-pulse bg-primary' : 'bg-muted-foreground/50'}`}/>{state.filterRunning ? '过滤中' : state.filterError ? '过滤失败' : state.filterProgress.done === state.filterProgress.total ? '过滤完成' : '已暂停'}</span><span className="font-mono tabular-nums">{state.filterProgress.done} / {state.filterProgress.total}</span></p>}>
          {state.filterRunning
            ? <button type="button" className={qualityPauseAction} onClick={state.cancelFilter}><Pause aria-hidden className="h-3 w-3"/>暂停过滤</button>
            : <button type="button" className={qualityPrimaryAction} disabled={!ready || !selectedCount || !filtersOn} title={filtersOn ? '独立计算已勾选信号的过滤条件，不运行卖出监测' : '先设置并启用买入过滤条件'} onClick={() => void state.startFilter()}><Filter aria-hidden className="h-3 w-3"/>开始过滤</button>}
          {state.filterError && <p role="alert" className="text-[11px] text-destructive">{state.filterError}</p>}
          <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><button type="button" className={`${button} ${filtersOn ? 'text-foreground' : ''}`} aria-label="买入过滤条件" title={filtersOn ? plans.map(p => `${p.label}：${activeBuyFilters(study, p).map(f => `${f.label} ${f.direction} ${f.threshold}`).join(' 且 ') || '不过滤'}`).join('\n') : '给每套卖出方案分别设置买入条件'}><Settings2 className="h-3 w-3"/>条件设置</button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-[34rem] max-w-[calc(100vw-2rem)] max-h-[min(85vh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain pb-0">
            <PlanTabs plans={plans} active={filterPlan?.id} count={p => activeBuyFilters(study, p).length} label="选择要设置过滤的卖出方案" onSelect={setFilterPlanId}/>
            {filterPlan && <BuyFilterEditor key={JSON.stringify([filterPlan.id, planBuyFilters(study, filterPlan)])} state={state} plan={filterPlan} done={() => setFilterOpen(false)}/>}
          </PopoverContent></Popover>
        </FishQualityModule>
        <FishQualityModule title="持仓监测" icon={Activity} testId="quality-run-controls" titleTestId="quality-mode" summary={<FishQualityInfo label="持仓监测说明"><p>100 USDT · 1 倍</p>{vetoCount > 0 && <p>{vetoCount} 条持仓否决</p>}<p className="text-muted-foreground">按已勾选信号和当前卖出规则独立监测，支持后台运行；已算完且条件没变的结果直接沿用；要全部重算，点「开始监测」右侧的 ▾。各轮不同算法和门槛下的结果都保留，同币种、同时间、同算法同门槛的合并为一条。</p></FishQualityInfo>} status={running && <p role="status" aria-live="polite" className="inline-flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"/>监测中</span><span className="font-mono tabular-nums">{progress?.done ?? 0} / {progress?.total ?? 0}</span></p>}>
          {/* 【用户要求】2026-10-27 把「重新开始」做进「开始监测」：主按钮照常开始 / 暂停，右侧 ▾ 里「从头重新计算」 */}
          <div role="group" aria-label="监测运行" className="inline-flex h-7 items-stretch">
            {running
              ? <button type="button" className={qualitySplitPauseAction} onClick={state.cancel}><Pause aria-hidden className="h-3 w-3"/>暂停监测</button>
              : <button type="button" className={qualitySplitPrimaryAction} disabled={!ready || !selectedCount} title="按当前勾选和条件在后台运行，切换选项或收起模块不会中断；已算完且条件没变的结果直接沿用" onClick={() => void state.start()}><RefreshCw aria-hidden className="h-3 w-3"/>开始监测</button>}
            <Popover open={runMenuOpen} onOpenChange={setRunMenuOpen}><PopoverTrigger asChild><button type="button" aria-label="开始监测的其他方式" disabled={!ready || !selectedCount} className={`inline-flex w-5 items-center justify-center rounded-r-md transition-colors disabled:opacity-40 ${running ? 'border border-l-0 border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-l border-primary-foreground/25 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:shadow-none'}`}><ChevronDown aria-hidden className="h-3 w-3"/></button></PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-1"><button type="button" aria-label="从头重新计算" className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => { setRunMenuOpen(false); void state.restart(); }}><span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>从头重新计算</span><span className="text-[10px] leading-relaxed text-muted-foreground">这一轮不沿用已算好的结果，按最新勾选、买入过滤和卖出条件全部重算{running ? '；先停止当前批次' : ''}。各轮不同算法和门槛下的结果都保留，同币种、同时间、同算法同门槛的合并为一条</span></button></PopoverContent></Popover>
          </div>
          <Popover open={monitorOpen} onOpenChange={setMonitorOpen}><PopoverTrigger asChild><button type="button" className={`${button} ${vetoCount > 0 ? 'text-foreground' : ''}`} aria-label="持仓监测条件" title={vetoCount ? plans.map(p => `${p.label}：${activeHoldingVetoes(p.holdingVetoes).length} 条否决`).join('\n') : '给每套卖出方案分别设置持仓一票否决条件'}><Settings2 className="h-3 w-3"/>条件设置</button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-[34rem] max-w-[calc(100vw-2rem)] max-h-[min(85vh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain pb-0">
            <PlanTabs plans={plans} active={monitorPlan?.id} count={p => activeHoldingVetoes(p.holdingVetoes).length} label="选择要设置持仓监测的卖出方案" onSelect={setMonitorPlanId}/>
            {monitorPlan && <HoldingMonitorEditor key={JSON.stringify([monitorPlan.id, monitorPlan.holdingVetoes ?? []])} state={state} plan={monitorPlan} done={() => setMonitorOpen(false)}/>}
          </PopoverContent></Popover>
          <FishMonitorLibrary study={study} onJump={onJump} canJump={canJump}/>
        </FishQualityModule>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="relative shrink-0"><select aria-label="鱼质量的来源" className={`${field} appearance-none pr-6`} value={origin} onChange={e => { setOrigin(e.target.value as QualityReturnUi['origin']); resetScroll(); }}><option value="">全部来源（{countSignals(batch)}）</option><option value="fish">鱼（{countSignals(batch.filter(r => sourceOf(r) === 'fish'))}）</option><option value="library">信号库（{countSignals(batch.filter(isLibrary))}）</option><option value="mined">默认值（{countSignals(batch.filter(r => sourceOf(r) === 'mined'))}）</option></select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <span className="relative shrink-0"><select aria-label="鱼质量的月份" className={`${field} appearance-none pr-6 font-mono`} value={month} onChange={e => { setMonth(e.target.value); resetScroll(); }}><option value="">全部月份（{countSignals(narrowed)}）</option>{months.map(m => <option key={m} value={m}>{m}（{monthCounts.get(m) ?? 0}）</option>)}</select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <DetectorPicker groups={groups} counts={detectorCounts} selected={activeAlgorithms} onChange={setAlgorithms}><button type="button" aria-label="鱼质量的探测算法" className={`${field} relative max-w-60 shrink-0 truncate pr-6 text-left ${activeAlgorithms.length ? 'text-foreground' : ''}`}>{!activeAlgorithms.length ? '全部探测算法' : activeAlgorithms.length === 1 ? detectorText(detectorMap.get(activeAlgorithms[0])!) : `探测算法 · 已选 ${activeAlgorithms.length} 个`}<ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></button></DetectorPicker>
        <input aria-label="筛选鱼质量信号" placeholder="筛选标的…" value={query} onChange={e => { setQuery(e.target.value); resetScroll(); }} className={`${field} min-w-32 flex-1 placeholder:text-muted-foreground/50`}/>
      </div>
      {!ready && <p role="status" className="text-[10.5px] text-muted-foreground">恢复本机记录…</p>}
      {(error || state.warning || state.error) && <p role="alert" className="text-[11px] text-destructive">{error || state.error || state.warning}</p>}
      {/* 表格到达上下边界后，滚轮自然交给「渔」面板，避免只能移到表格外才能继续滚动。 */}
      {rows.length ? <div ref={tableRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} className="max-h-[28rem] overflow-auto overscroll-x-contain overscroll-y-auto rounded-lg border border-border/60 [overflow-anchor:none]" data-testid="quality-fish-table"><table className="w-full border-separate border-spacing-0 whitespace-nowrap text-left text-[10px]">
        <thead className="sticky top-0 z-20 bg-background text-[9px] font-medium text-muted-foreground"><tr className="bg-muted/40">
          <th className={`${cell} sticky left-0 z-30 min-w-[160px] bg-muted font-medium`} aria-sort={ariaSort('symbol')}><span className="flex items-center gap-2"><input type="checkbox" aria-label="全选当前筛选信号" title="全选当前筛选下的所有行；按住 Shift 点两行可连续选择" checked={allSelected} ref={el => { if (el) el.indeterminate = selectedRows.length > 0 && !allSelected; }} disabled={!ready} onChange={e => selectVisible(e.target.checked)} className="h-3 w-3 accent-[hsl(var(--primary))]"/>{sortButton('symbol', '标的')}</span></th>
          <th className={`${cell} min-w-[140px] font-medium`} aria-sort={ariaSort('time')}>{sortButton('time', '信号时间')}</th>
          <th className={`${cell} font-medium`} aria-sort={ariaSort('market')}>{sortButton('market', '市场')}</th><th className={`${cell} font-medium`} aria-sort={ariaSort('quality')}>{sortButton('quality', '评分')}</th><th className={`${cell} min-w-[80px] font-medium`} aria-sort={ariaSort('process')} title="按捕捞时刻排序；信号库在最后">{sortButton('process', '捕捞过程')}</th>
          {filterColumns.map(column => <th key={column.id} className={`${cell} min-w-[155px] border-l border-border/40 font-medium`} data-testid="quality-filter-column" aria-sort={ariaSort(`filter:${column.id}`)} title={`买入时刻之前最后一根已收盘 K 线的读数；用于：${column.plans.join('、')}。无需设置卖出算法即可计算。`}><button type="button" className="block text-left hover:text-foreground" aria-label={`按过滤${column.filter.label} ${column.filter.direction} ${column.filter.threshold}读数排序`} onClick={() => changeSort(`filter:${column.id}`)}>过滤 · {column.filter.label}{arrow(`filter:${column.id}`)}</button><span className="mt-0.5 block font-mono text-primary">{column.filter.direction} {column.filter.threshold}</span>{plans.length > 1 && <span className="mt-0.5 block max-w-[150px] truncate font-normal text-muted-foreground/70" data-testid="quality-filter-owner">用于卖出 · {column.plans.join("、")}</span>}</th>)}
          {plans.map(p => <Fragment key={p.id}><th className={`${cell} min-w-[155px] border-l border-border/40 font-medium`} data-testid="quality-sell-column" aria-sort={sort === `sell:${p.id}` ? ascending ? 'ascending' : 'descending' : 'none'}><button type="button" className="block text-left hover:text-foreground" aria-label={`按${p.label}收益率排序`} onClick={() => changeSort(`sell:${p.id}`)}>卖出 · {p.label}{sort === `sell:${p.id}` ? ascending ? ' ↑' : ' ↓' : ''}</button><Popover><PopoverTrigger asChild><button type="button" className="mt-0.5 flex items-center gap-1 font-mono text-primary hover:underline" aria-label={`设置${p.label}卖出算法`}>{ruleText(p)}<ChevronDown className="h-2.5 w-2.5"/>{study.selectedSellId === p.id && <Check className="h-2.5 w-2.5"/>}</button></PopoverTrigger><PopoverContent align="start" className="w-80"><SellEditor key={`${p.id}:${JSON.stringify(p.rule)}`} plan={p} state={state}/></PopoverContent></Popover>{phase === 'sell' && (() => { const n = activeBuyFilters(study, p).length; return <button type="button" className={`mt-0.5 block text-left text-[9px] hover:underline ${n ? 'text-primary' : 'text-muted-foreground/60'}`} aria-label={`设置${p.label}的买入过滤`} title={n ? activeBuyFilters(study, p).map(f => `${f.label} ${f.direction} ${f.threshold}`).join(' 且 ') : '这套方案买入全部信号'} onClick={() => openFilterFor(p.id)}>{n ? `买入过滤 ${n} 条` : '不过滤'}</button>; })()}</th>{phase === 'sell' && (['static','dynamic'] as const).map(kind => <th key={kind} className={`${cell} min-w-[110px] font-medium`} aria-sort={ariaSort(`${kind}:${p.id}`)} title={kind === 'static' ? '以买入价为基准，到持仓最低价的最大跌幅，至少为 0%。' : '持仓期间此前峰值到随后谷值的最大跌幅；不假定同一分钟内最高价、最低价的先后顺序。'}><button type="button" className="hover:text-foreground" aria-label={`按${p.label}${kind === 'static' ? '静态' : '动态'}最大回撤排序`} onClick={() => changeSort(`${kind}:${p.id}`)}>{kind === 'static' ? '静态' : '动态'}最大回撤{arrow(`${kind}:${p.id}`)}</button></th>)}{phase === 'sell' && <th className={`${cell} min-w-[84px] font-medium`} aria-sort={ariaSort(`held:${p.id}`)} title="买入到卖出的时长；还在持有的算到最近一次估值。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}持仓时间排序`} onClick={() => changeSort(`held:${p.id}`)}>持仓时间{arrow(`held:${p.id}`)}</button></th>}</Fragment>)}
          <th className={`${cell} min-w-[240px] border-l border-border/40 font-medium`} data-testid="quality-detector-column" aria-sort={ariaSort('detector')}><span className="inline-flex items-center gap-2">{sortButton('detector', '探测算法')}{groups.length > 0 && <DetectorPicker groups={groups} counts={detectorCounts} selected={activeAlgorithms} onChange={setAlgorithms}><button type="button" aria-label="在表头选择探测算法" title={activeAlgorithms.length ? activeAlgorithms.map(id => detectorText(detectorMap.get(id)!)).join('、') : '选择一个或多个探测算法'} className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 ${activeAlgorithms.length ? 'bg-primary/15 text-primary' : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground'}`}><Filter className="h-3 w-3"/>{activeAlgorithms.length > 0 && <span className="font-mono text-[10px] tabular-nums">{activeAlgorithms.length}</span>}</button></DetectorPicker>}<button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" aria-label="展开探测算法明细" aria-expanded={detectorExpanded} onClick={() => expandDetectors(!detectorExpanded)}>{detectorExpanded ? '收起' : '展开'}<ChevronDown className={`h-3 w-3 ${detectorExpanded ? 'rotate-180' : ''}`}/></button></span></th><th className={`${cell} font-medium`} aria-label="跳转"/>
        </tr></thead><tbody>{padTop > 0 && <tr aria-hidden style={{ height: padTop }}/>}{visible.map(row => <tr key={row.id} className="group hover:bg-accent/30" data-testid="quality-fish-row">
          <td className={`${cell} sticky left-0 z-10 border-t border-border/40 bg-background font-mono group-hover:bg-accent`} title={EXCHANGE_NAMES[row.source.exchange ?? 'binance']}><span className="inline-flex items-center gap-2"><input type="checkbox" aria-label={`选择 ${row.source.symbol} ${date(row.source.timeMs)}${row.detectorId ? ` ${detectorMap.get(row.detectorId)?.label} ${detectorMap.get(row.detectorId)?.snapshot.threshold}` : detectorExpanded ? ' 信号库' : ' 合并信号'}`} title="按住 Shift 点另一行可连续选择" checked={rowSelected(row)} ref={el => { if (el) el.indeterminate = !rowSelected(row) && qualityTableMembers(row).some(member => selectedIds.has(member.id)); }} disabled={!ready} onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }} onChange={e => toggleRow(row.id, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/><button type="button" aria-label={`查看 ${row.source.symbol} 盘面`} title={`查看 ${row.source.symbol} 在 ${date(row.source.timeMs)} 的盘面`} disabled={!onJump || !!canJump && !canJump(row.source)} onClick={() => onJump?.(row.source)} className="rounded-sm text-left transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:no-underline disabled:hover:text-inherit">{row.source.symbol}</button></span>{row.source.exchange && row.source.exchange !== 'binance' && <span className="ml-1 font-sans text-[9px] text-muted-foreground">{EXCHANGE_NAMES[row.source.exchange]}</span>}</td>
          <td className={`${cell} border-t border-border/40 font-mono text-muted-foreground`} title={`模拟买入：${date(row.enteredAt)}（${row.basis === 'detected' ? '实际发现' : row.basis === 'capture' ? '捕捞时刻' : row.basis === 'missing' ? '时间缺失' : isLibrary(row) ? '信号库信号时间' : '原始信号'}）`}>{date(row.source.timeMs)}</td>
          <td className={`${cell} border-t border-border/40 text-muted-foreground`}>{row.source.market === 'us_stock' ? '美股' : ''}</td>
          <td className={`${cell} border-t border-border/40`}><span className="flex gap-px" aria-label={`评分 ${normalizeSignalQuality(row.source.quality) ?? 0} 星`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} className={`h-3 w-3 ${i <= (normalizeSignalQuality(row.source.quality) ?? 0) ? 'fill-[#F0B90B] text-[#F0B90B]' : 'text-muted-foreground/35'}`}/>)}</span></td>
          <td className={`${cell} border-t border-border/40`}>{isLibrary(row) ? <span className="text-muted-foreground/60">—</span> : <FishProcessButton signal={row.source}/>}</td>
          {filterColumns.map(column => { const reading = qualityFilterCell(row, column.filter, filterReadingMap); return <td key={column.id} className={`${cell} border-l border-t border-border/40`} data-testid="quality-filter-cell" data-filter-state={reading.state} title={reading.detail}><span className="inline-flex items-center gap-2"><span className="font-mono tabular-nums">{reading.value}</span><span className={`text-[9px] ${reading.state === 'pass' ? 'text-emerald-600 dark:text-emerald-400' : reading.state === 'fail' ? 'text-destructive' : 'text-muted-foreground'}`}>{reading.status}</span></span></td>; })}
          {plans.map(p => { const entries = [...new Map(qualityTableMembers(row).map(member => [member.signalId ?? member.id, member])).values()];
            if(entries.length > 1) return <MergedEntryCells key={p.id} entries={entries.map(member => ({result:qualityRowResult(study,member,p,resultMap),skipped:skippedBy(p,member)}))} phase={phase} planId={p.id} expand={() => expandDetectors(true)}/>;
            const f = skippedBy(p, row), skipped = f && f.state !== 'pass', result = qualityRowResult(study,row,p,resultMap);
            return <Fragment key={p.id}><td className={`${cell} border-l border-t border-border/40`}>{skipped ? <span className="text-[9px] text-muted-foreground/60" title={f.detail}>{f.state === 'fail' ? '未买入' : f.state === 'pending' ? '待判断' : '买入过滤缺数据'}</span> : filtersOn && !hasQualityExit(p) ? <span className="text-[9px] text-muted-foreground/60">待设卖出</span> : <ResultCell result={result} section="sell" onClick={() => setDetailId(qualityTableMembers(row)[0].id)} onOpenCampaign={rememberReturn}/>}</td>{phase === 'sell' && (['static','dynamic'] as const).map(kind => { const value = skipped ? null : qualityDrawdownPct(result,kind); return <td key={kind} className={`${cell} border-t border-border/40 font-mono tabular-nums ${value != null && value > 0 ? 'text-destructive' : 'text-muted-foreground'}`} data-testid={`quality-${kind}-drawdown`} data-sell-plan={p.id} title={skipped ? f.detail : result?.reason}>{pct(value).replace(/^\+/, '')}</td>; })}{phase === 'sell' && <td className={`${cell} border-t border-border/40 font-mono tabular-nums ${result?.status === 'open' ? 'text-foreground/80' : 'text-muted-foreground'}`} data-testid="quality-held-time" data-sell-plan={p.id} title={skipped ? f.detail : result?.status === 'open' ? '仍在持有：算到最近一次估值' : result?.reason}>{skipped || !(result?.status === 'closed' || result?.status === 'open') ? '—' : heldText(result.heldHours)}</td>}</Fragment>; })}
          <td className={`${cell} border-l border-t border-border/40 text-muted-foreground`} data-testid="quality-detector-cell" data-detector-id={row.detectorId ?? ''} title={row.detectorId ? `${detectorMap.get(row.detectorId)?.metric} · ${detectorMap.get(row.detectorId)?.snapshot.interval ?? '5m'} · 公式版本 ${row.detectorId}` : '信号库的信号不归属探测算法'}>{!detectorExpanded && row.groups.length > 0 ? <button type="button" className="text-primary hover:underline" onClick={() => expandDetectors(true)} title="展开此列表的探测算法与各次买入记录">{row.groups.length} 种算法 · 展开</button> : row.detectorId ? <span className="inline-flex items-center gap-2"><span>{detectorMap.get(row.detectorId)?.label ?? '探测算法'}</span><span className="font-mono text-muted-foreground/70">{detectorMap.get(row.detectorId)?.snapshot.direction ?? '>'} {detectorMap.get(row.detectorId)?.snapshot.threshold}</span></span> : '—'}</td>
          <td className={`${cell} border-t border-border/40`}><button type="button" aria-label={`跳转 ${row.source.symbol}`} disabled={!onJump || !!canJump && !canJump(row.source)} onClick={() => onJump?.(row.source)} className="text-primary disabled:opacity-30"><ArrowRightCircle className="h-3.5 w-3.5"/></button></td>
        </tr>)}{padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}/>}</tbody></table></div> : <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10.5px] text-muted-foreground">{allRows.length ? '没有匹配的标的。' : '暂无可评估的信号：捕捞到的鱼和信号库里的信号会自动加入。'}</div>}
      {rows.length > 0 && <p className="text-right text-[10px] tabular-nums text-muted-foreground" data-testid="quality-row-count">共 {rows.length} 行 · {countSignals(rows)} 条信号{!detectorExpanded ? ' · 已合并探测明细' : ''}{sortedRows.length < batch.length ? `（筛选自 ${countSignals(batch)} 条信号）` : ''}</p>}
    </div>}
    <RowDetail row={allRows.find(r => r.id === detailId)} state={state} close={() => setDetailId('')}/>
  </section>;
}
