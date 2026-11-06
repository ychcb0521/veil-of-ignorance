import { FishPreEntryMonitor } from './FishPreEntryMonitor';
import { prepareQualityRouterDraft } from '@/lib/fish/qualityRouterDraft';
import { isRaceRouter, raceAttackFromRound, routerNextOrdinal, routerOrdinal, routerPrefixText } from '@/lib/fish/qualityPlanRouter';
import type { SellPlansDraftView } from './FishQualitySellPlansEditor';
import { FishQualityMonitorSettingsView } from './FishQualityMonitorSettingsView';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { ADDITION_VETO_LABELS, type AdditionEntryVetoKind } from '@/lib/fish/qualityAdditionVeto';
import { activeQualityPlanTemplates } from '@/lib/fish/qualityPlanTemplates';
import { readQualityTableSheet } from '@/lib/fish/qualityTableExport';
import { qualityPlanDetailSheet, qualityTradeDetailSheet } from '@/lib/fish/qualityExportDetails';
import {validateQualitySellStages} from '@/lib/fish/qualitySellStages';
import type {VetoStagesDraft} from './FishQualityVetoStagesEditor';
import {validateQualityVetoStages} from '@/lib/fish/qualityVetoStages';
import {FishLibraryDataManager} from './FishLibraryDataManager';
import {FishLibraryDataButton} from './FishLibraryTransferContext';
import {qualityOrigins,qualitySourceLabel,QUALITY_SOURCE_NAMES,isSignalLibraryOrigin,type QualityOrigin} from '@/lib/fish/qualitySources';
import { QualitySalePriceChangeCell } from './FishQualityTradeReadings';
import { qualityEntryKey,qualityEntryParts,validEntryReading } from '@/lib/fish/qualityEntry';
import { qualityDetectorLabel } from '@/lib/fish/qualityDetectorLabel';
import { SellErrorHeaders, SellErrorCells, type SellErrorSortKey } from './FishQualitySellError';
import { qualityAlgorithmExit, qualitySellError } from '@/lib/fish/qualitySellError';
import { PostExitHeaders, PostExitCells, type PostExitSortKey } from './FishQualityPostExit';
import { POST_EXIT_HOURS, qualityPostExitKey, postExitValue } from '@/lib/fish/qualityPostExit';
import { FishQualityManual } from '@/components/FishQualityManual';
import { FishPopoverContent as PopoverContent } from '@/components/FishPopoverContent';
import { qualityDetectorReading } from '@/lib/fish/qualityDetectorReading';
import { defaultQualityAddition, qualityAdditionFills } from '@/lib/fish/qualityAddition';
import { FishQualityAdditionEditor, additionDraft, parseAdditionDraft, parseAdditionSellStages } from '@/components/FishQualityAdditionEditor';
import { FishQualitySellPlansEditor } from './FishQualitySellPlansEditor';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { qualitySalePriceChangePct, qualityPeakPct, qualityHalfMirror, qualityAdditionSummary, qualityRelativeGain, qualityRelativeGainText, qualityPayoffRatio, qualityPayoffRatioText, qualityGeometricPosition, qualityGeometricPositionText } from '@/lib/fish/qualityPresentation';
import { FishQualityMirrorEditor, mirrorDraft, parseMirrorDraft } from '@/components/FishQualityMirrorEditor';
import { defaultQualityMirror, validateQualityMirror } from '@/lib/fish/qualityMirror';
import { qualityRunStatusMap, qualityRowRunStatus, qualityRunStatusText, qualityRunStatusDetail, qualitySelectRunState, type QualityRunStage, type QualityRunStateFilter } from '@/lib/fish/qualityRunStatus';
import { FishQualityStatistics, QualityStatisticsButton, type QualityStatisticsRequest } from '@/components/FishQualityStatistics';
import { qualityVariables, qualityVariableKey } from '@/lib/fish/qualityVariables';
import { Fragment,useCallback,createContext,useContext,useId, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { FishQualityHoldingVetoEditor } from '@/components/FishQualityHoldingVetoEditor';
import { activeHoldingVetoes, holdingVetoIdentity } from '@/lib/fish/qualityVeto';
import { qualityCampaignPath } from '@/lib/campaignSections';
import { hasQualityCampaign } from '@/lib/fish/qualityCampaignArchive';
import { Activity, ArrowRightCircle, Check, ChevronDown, CircleHelp, Download, Eraser, Eye, EyeOff, Filter, Gauge, Pause, Plus, RefreshCw, RotateCcw, Settings2, Star, X } from 'lucide-react';
import type {FishQualityStudy} from '@/lib/fish/quality';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { FishMiningApi } from '@/hooks/useFishMining';
import { FishMiningPanel } from '@/components/FishMiningPanel';
import { FishMonitorLibrary } from '@/components/FishMonitorLibrary';
import { FishFilterLibrary } from '@/components/FishFilterLibrary';
import { fishInfoTrigger, fishRail, fishSectionHeading, FishCount } from './FishSection';
import { FishQualityInfo, FishQualityModule, qualityPauseAction, qualityPrimaryAction, qualitySplitPauseAction, qualitySplitPrimaryAction, qualitySplitMenuAction, qualitySettingsAction } from '@/components/FishQualityModule';
import { FishProcessButton } from '@/components/FishProcess';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { normalizeSignalQuality, signalMonthKey, type TradeSignal } from '@/lib/signalLibrary';
import { isTuringCupSymbol, turingCupTicker } from '@/lib/turingCupSymbol';
import { isDelayedTuringReplaySample } from '@/lib/turingReplaySamples';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { hasQualityExit, standaloneBuyFilters, activeStandaloneBuyFilters, activeBuyFilters, anyBuyFilters, qualityDrawdownPct, qualityDisplayRows, qualityDefinition, qualityFilterReadingKey, qualityFilterStatus, type QualityFilterStatus, type QualityGroup, type QualityResult, type QualitySample, qualityRuleText } from '@/lib/fish/quality';
import { holdingVetoDraft, planHoldingVetoDraft, parseHoldingVetoDraft, makeQualityBuyFilter, qualityFilterChoiceKey, qualityFilterChoices } from '@/lib/fish/qualityFilters';
import { qualityResultMap, qualityRowResult, qualitySellSuggestions } from '@/lib/fish/qualityComparison';
import { qualityFilterCell, qualityFilterColumns, qualityFilterValue } from '@/lib/fish/qualityFilterColumns';
import { downloadQualityComparison } from '@/lib/fish/qualityExport';
import { rangeSelect } from '@/lib/listRangeSelect';
import { collapseQualityTableRows, qualityTableMinedAt, qualityTableMembers, qualityTableRange, qualityTableSignalKey, type QualityTableRow } from '@/lib/fish/qualityTableRows';
import { defaultQualityDetectorIds, qualityDetectorChoices, type QualityDetectorChoice } from '@/lib/fish/qualityDetectorSelection';
import { ancestorScrolls, applyAncestorScrolls, finishQualityReturn, FROM_FISH_QUALITY, pendingQualityReturn, saveQualityReturn, type QualityReturnUi } from '@/lib/fish/qualityReturn';

const field = 'h-7 min-w-0 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60';
const button = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const cell = 'px-2 py-1';
const countSignals = (rows: readonly QualitySample[]) => new Set(rows.map(qualityTableSignalKey)).size;
const pct = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const signed = (v?: number | null) => v == null ? '' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '';
const date = (v?: number | null) => v ? formatUTC8(v) : '—';
const ruleText = (plan: QualityGroup) => qualityRuleText(plan);
const isLibrary = (row: QualitySample) => isSignalLibraryOrigin(row.origin);
/** Mirror execution and detector labels always occupy independent columns. */
/** Original seller columns plus an independent post-sale group: folded=1 column, expanded=10. 2026-11-01 删掉半仓镜像后重复的「加仓次数」列（卖出列里已有）；2026-11-02 入场读数挪到「买前过滤」，7 列。 */
const qualitySellSpan = (plans: readonly QualityGroup[],expanded:ReadonlySet<string>,sellError:ReadonlySet<string>) => plans.reduce((n,p)=>n+6+(sellError.has(p.id)?5:1)+(expanded.has(p.id)?10:1),0);
const hasSource = (row: QualitySample,source:QualityOrigin) => qualityOrigins(row).includes(source);
// 【用户反馈】2026-10-26「表头显示 793，但表中完全没这么多」：原来每页 50 条、框只有约 9 行高，要翻 16 页。
// 只渲染可见窗口；数据行统一高度，遇到多行内容时只增高，不用新窗口首行反向缩小估计。
// 否则启动监测 / 结果更新后，33px 与 40px 的首行可能交替出现，形成布局更新死循环。
const ROW_PX = 33, TABLE_PX = 448, OVERSCAN = 12;
// 【用户要求】2026-10-26「鱼质量中的所有表头都要能够排序」：空值（未评估、无评分等）不论升降都排在最后
type SortKey = `addition:${string}` | `entry:${string}` | `price-change:${string}` | SellErrorSortKey | `label:${string}` | PostExitSortKey | 'run' | 'time' | 'mined-at' | 'symbol' | 'market' | 'quality' | 'process' | 'detector' | 'detector-value' | `filter:${string}` | `sell:${string}` | `static:${string}` | `peak:${string}` | `mirror:${string}` | `held:${string}` | `relative:${string}` | `payoff:${string}` | `geometric:${string}`;
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
      <button type="button" disabled={!state.ready} onClick={save} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">保存参数</button>
    </div>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">保存后点击「开始监测」运行。以上数值供比较，未预选为最优。{plan.execution === 'intrabar-1m' ? '逐分钟复原原周期指标，首次达标后按紧接的分钟开盘价卖出；历史精度为 1 分钟。' : '首次满足条件的收盘后，按下一分钟开盘价卖出。'}</p>
    {hasQualityExit(plan) && <div className="flex flex-wrap gap-2 text-[11px]"><button type="button" className="text-primary hover:underline" onClick={() => state.selectSell(plan.id)}>固定此方案，比较探测算法</button>{plan.rule && <button type="button" className="text-muted-foreground hover:underline" onClick={() => state.setRule(plan.id, undefined)}>清除门槛</button>}</div>}
    <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">公式与参数</summary><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{definition.formula}</pre><p className="mt-1">{plan.snapshot.interval} 原周期 · hl {definition.halfLifeHours} 小时 · avgh {definition.avgHours} 小时 · 原值倍率 1</p><p className="mt-1">每次运行前读取当前账号定义，运行结果保存当次公式快照。</p></details>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
/**
 * 【用户要求】2026-10-27「卖出算法组合1」：前段 CDA、价格涨幅超过分水岭（默认 5.1%）后改用状态 S。
 * 三个数一并保存，点击「开始监测」后运行；买入过滤与持仓否决在各自模块的条件设置里，与其他方案一样按这套方案单独设。
 */
function ComboSellEditor({ plan, state }: { plan: QualityGroup; state: FishQualityState }) {
  const combo = plan.combo!, after = combo.after;
  const [before, setBefore] = useState({ direction: plan.rule?.direction ?? '<', threshold: String(plan.rule?.threshold ?? plan.snapshot.threshold) });
  const [later, setLater] = useState({ direction: after.rule.direction, threshold: String(after.rule.threshold) });
  const [pct, setPct] = useState(String(combo.switchPct)), [error, setError] = useState('');
  const save = () => {
    if ([before.threshold, later.threshold].some(v => !v.trim() || !Number.isFinite(Number(v)))) { setError('前段、后段都要填有限数字门槛'); return; }
    const p = Number(pct);
    if (!pct.trim() || !Number.isFinite(p) || p <= 0 || p > 1000) { setError('分水岭须为大于 0 的百分比'); return; }
    setError('');
    state.setCombo(plan.id, { metric: plan.metric, direction: before.direction, threshold: Number(before.threshold) },
      { ...combo, switchPct: p, after: { ...after, rule: { metric: after.metric, direction: later.direction, threshold: Number(later.threshold) } } });
  };
  const row = (label: string, value: { direction: '<' | '>'; threshold: string }, set: (v: { direction: '<' | '>'; threshold: string }) => void, snapshot: QualityGroup['snapshot'], hint: string) =>
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2"><p className="text-[11px] font-medium">{label}</p><span className="text-[10px] text-muted-foreground">{hint}</span></div>
      <div className="flex items-center gap-1.5">
        <select aria-label={`${label}卖出方向`} className={field} value={value.direction} onChange={e => set({ ...value, direction: e.target.value as '<' | '>' })}><option value="<">&lt;</option><option value=">">&gt;</option></select>
        <input aria-label={`${label}卖出门槛`} type="number" step="any" value={value.threshold} onChange={e => set({ ...value, threshold: e.target.value })} className={`${field} w-24`}/>
        <span className="flex items-center gap-1">{qualitySellSuggestions({ snapshot }).map(v => <button type="button" key={v} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted" onClick={() => set({ ...value, threshold: String(v) })}>{v}</button>)}</span>
      </div>
    </div>;
  return <div className="space-y-3" data-testid={`quality-sell-editor-${plan.id}`}>
    <div className="space-y-0.5"><p className="text-xs font-medium">{plan.label}</p><p className="text-[10.5px] leading-relaxed text-muted-foreground">两个算法接力：价格涨幅没过分水岭时按 {combo.beforeLabel} 卖出，过了之后改按 {after.label} 卖出。5m 指标 · 盘中达标 / 1分钟复原 · 使用原始值</p></div>
    {row(`前段 · ${combo.beforeLabel}`, before, setBefore, plan.snapshot, '涨幅未过分水岭时')}
    <div className="flex items-center gap-1.5 border-y border-border/50 py-2 text-[11px]">
      <span className="font-medium">分水岭</span><span className="text-muted-foreground">最高价比买入价高出</span>
      <input aria-label="组合卖出分水岭" type="number" step="any" min="0" value={pct} onChange={e => setPct(e.target.value)} className={`${field} w-16`}/><span>%</span>
    </div>
    {row(`后段 · ${after.label}`, later, setLater, after.snapshot, '过了分水岭之后')}
    <div className="flex justify-end"><button type="button" disabled={!state.ready} onClick={save} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">保存参数</button></div>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">保存后点击「开始监测」运行。以买入价为基准，持仓中盘中最高价首次达到分水岭的那一分钟收盘起改用后段条件；之前只看前段。都是逐分钟复原原周期指标，首次达标后按紧接的分钟开盘价卖出。持仓否决两段全程有效。</p>
    {hasQualityExit(plan) && <div className="text-[11px]"><button type="button" className="text-primary hover:underline" onClick={() => state.selectSell(plan.id)}>固定此方案，比较探测算法</button></div>}
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
type FilterDraft = { choice: string; direction: '<' | '>'; threshold: string; enabled: boolean };
/** Standalone buy-filter configuration, independent of sell algorithms. */
function BuyFilterEditor({ state, done, scan = false }: { state: FishQualityState; done: () => void; scan?: boolean }) {
  const definitions = useFeatureDefinitions();
  const choices = useMemo(() => qualityFilterChoices(definitions), [definitions]), groups = [...new Set(choices.map(c => c.group))];
  const [draft, setDraft] = useState<FilterDraft[]>(() => standaloneBuyFilters(state.study).map(f => ({ choice: qualityFilterChoiceKey(f), direction: f.direction, threshold: String(f.threshold), enabled: f.enabled })));
  const [error, setError] = useState('');
  const patch = (i: number, p: Partial<FilterDraft>) => setDraft(draft.map((d, j) => j === i ? { ...d, ...p } : d));
  const add = () => setDraft([...draft, { choice: choices.find(c => c.key === 'state:state')?.key ?? choices[0]?.key ?? '', direction: '>', threshold: '0.7', enabled: true }]);
  const apply = () => {
    if (draft.some(d => !d.threshold.trim() || !Number.isFinite(Number(d.threshold)))) { setError('每条条件都要填有限数字门槛'); return; }
    try { state.setFilters(draft.map(d => makeQualityBuyFilter(d.choice, d.direction, Number(d.threshold), d.enabled))); setError(''); done(); }
    catch (e) { setError(e instanceof Error ? e.message : '条件无效'); }
  };
  return <div className="space-y-3" data-testid="quality-buy-filter-editor">
    <div className="space-y-0.5"><p className="text-xs font-medium">买前过滤</p><p className="text-[10.5px] leading-relaxed text-muted-foreground">{scan ? '条件独立保存，不绑定卖出算法。按所设周期的已收盘 K 线向后筛选；全部启用条件首次同时满足时，保存该标的的入选时间节点。' : '过滤条件独立保存，不绑定卖出算法。读数取买入时刻之前最后一根已收盘的 5 分钟 K 线，全部启用的条件满足时标记为通过。'}</p><p className="text-[10.5px] leading-relaxed text-muted-foreground">{scan ? '保存后点击「开始筛选」运行。命中节点保存在入选库，可带入组合表进行持仓监测；继续暂停轮次仍沿用该轮条件，要使用新条件请从头重新筛选。' : '保存后点击「开始过滤」对已勾选信号运行；已有读数可复用。过滤不会运行、暂停或隐藏卖出监测结果。持仓一票否决在「持仓监测」中设置。'}</p></div>
    {draft.length ? <div className="space-y-1.5">{draft.map((d, i) => <div key={i} className="flex items-center gap-1.5">
      <input type="checkbox" aria-label={`启用买入条件 ${i + 1}`} checked={d.enabled} onChange={e => patch(i, { enabled: e.target.checked })} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/>
      <select aria-label={`买入条件 ${i + 1} 指标`} className={`${field} min-w-0 flex-1`} value={d.choice} onChange={e => patch(i, { choice: e.target.value })}>{groups.map(g => <optgroup key={g} label={g}>{choices.filter(c => c.group === g).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}</select>
      <select aria-label={`买入条件 ${i + 1} 方向`} className={field} value={d.direction} onChange={e => patch(i, { direction: e.target.value as '<' | '>' })}><option value=">">&gt;</option><option value="<">&lt;</option></select>
      <input aria-label={`买入条件 ${i + 1} 门槛`} type="number" step="any" className={`${field} w-20`} value={d.threshold} onChange={e => patch(i, { threshold: e.target.value })}/>
      <button type="button" aria-label={`删除买入条件 ${i + 1}`} className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground" onClick={() => setDraft(draft.filter((_, j) => j !== i))}><X className="h-3 w-3"/></button>
    </div>)}</div> : <p className="rounded-md border border-dashed border-border/60 px-3 py-3 text-center text-[10.5px] text-muted-foreground">未设置过滤条件</p>}
    <div><button type="button" className={button} onClick={add}><Plus className="h-3 w-3"/>添加条件</button></div>
    {/* 「应用」固定在弹层底部：弹层再长、屏幕再矮也点得到（【用户要求】2026-10-26 改了动态回撤却不生效——按钮被挤出了屏幕） */}
    <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-border/50 bg-popover px-4 py-2.5"><button type="button" disabled={!state.ready} onClick={apply} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">保存过滤条件</button>
    </div>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
/**
 * 【用户要求】2026-10-27「持仓监测中也需要一个条件设置」「持仓一票否决卖出其实隶属于持仓监测」：
 * 这套卖出方案的持仓一票否决在这里设（观察时长已于 0d3dc61c 从界面移除，不放回来）。
 */
type MonitorDraft = { addition: ReturnType<typeof additionDraft>; mirror: ReturnType<typeof mirrorDraft>; vetoes: ReturnType<typeof holdingVetoDraft>;vetoStages:VetoStagesDraft };
const monitorDraftOf = (plan: QualityGroup): MonitorDraft => ({ addition: additionDraft(plan.addition ?? defaultQualityAddition(), plan.sellStages), mirror: mirrorDraft(plan.mirrorTakeProfit ?? defaultQualityMirror()), vetoes: planHoldingVetoDraft(plan.holdingVetoes),vetoStages:{enabled:!!plan.vetoStages?.length,mode:plan.vetoStageMode??'overlay',peakBasis:plan.vetoPeakBasis??'stage',stages:(plan.vetoStages??[]).map(s=>({afterAdditions:String(s.afterAdditions),conditions:holdingVetoDraft(s.conditions)}))} });
const monitorBaseKey = (plan: QualityGroup) => JSON.stringify([plan.holdingVetoes,plan.mirrorTakeProfit,plan.addition,plan.sellStages,plan.vetoStages,plan.vetoStageMode,plan.vetoPeakBasis]);
function parseMonitorDraft(draft: MonitorDraft, definitions: Parameters<typeof parseAdditionDraft>[1]) {
  const holdingVetoes = parseHoldingVetoDraft(draft.vetoes), mirrorTakeProfit = parseMirrorDraft(draft.mirror), addition = parseAdditionDraft(draft.addition,definitions), sellStages = parseAdditionSellStages(draft.addition,definitions);
  const vetoStages=draft.vetoStages.enabled?draft.vetoStages.stages.map(s=>({afterAdditions:s.afterAdditions.trim()?Number(s.afterAdditions):NaN,conditions:parseHoldingVetoDraft(s.conditions)})).sort((a,b)=>a.afterAdditions-b.afterAdditions):undefined;
  if(draft.vetoStages.enabled&&!vetoStages?.length)throw Error('请添加至少一个一票条件切换阶段');
  const staged={vetoStages,vetoStageMode:draft.vetoStages.mode,vetoPeakBasis:draft.vetoStages.peakBasis};validateQualityVetoStages({...staged,addition});
  validateQualitySellStages({sellStages,addition});validateQualityMirror(mirrorTakeProfit); return { holdingVetoes, mirrorTakeProfit, addition, sellStages,...staged };
}
function HoldingMonitorEditor({ ready, plan, draft, setDraft, save, error, allDirty, count, hideSave = false }: {
  ready: boolean; plan: QualityGroup; draft: MonitorDraft; setDraft: (draft: MonitorDraft) => void;
  save: () => void; error: string; allDirty: boolean; count: number; hideSave?: boolean;
}) {
  return <div className="space-y-3" data-testid="quality-monitor-editor" data-plan-id={plan.id}>
    <div className="flex items-center gap-1.5"><p className="text-xs font-medium">持仓监测 · {plan.label}</p><FishQualityInfo label="持仓监测说明"><p>买入之后依次是：① 组合算法（上方卡片）→ ② 半仓镜像 → ③ 加仓细节 → ④ 硬性终止。各项分别保存在对应方案中；切换方案保留本次填写，保存时一起保存。</p></FishQualityInfo></div>
    <FishQualityMirrorEditor draft={draft.mirror} setDraft={mirror => setDraft({...draft,mirror})} additionEnabled={draft.addition.enabled}/>
    <FishQualityAdditionEditor draft={draft.addition} setDraft={addition => setDraft({...draft,addition})} vetoStages={draft.vetoStages} setVetoStages={vetoStages=>setDraft({...draft,vetoStages})}/>
    <section className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/[0.02] p-3" data-testid="quality-hard-stop"><div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">④ 硬性终止</h4><span className="text-[10px] text-muted-foreground">必要充分 · 任一达标即卖出全部持仓</span><FishQualityInfo label="硬性终止说明"><p>与「加仓细节 · 卖出」并列：硬性终止的任一启用条件、或某次加仓的卖出条件，任何一个先达标，都立即卖出全部仓位（含各次加仓买入的部分），不等普通卖出算法。某次加仓后另加或收紧的否决条件，在「③ 加仓细节 · 卖出」里按次设置。</p></FishQualityInfo></div>
      <FishQualityHoldingVetoEditor draft={draft.vetoes} setDraft={vetoes => setDraft({...draft,vetoes})}/>
    </section>
    {!hideSave && <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-border/50 bg-popover px-4 py-2.5"><button type="button" disabled={!ready} onClick={save} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">{allDirty ? `保存全部 ${count} 套方案` : `保存到「${plan.label}」`}</button></div>}
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </div>;
}
/** Editing one section must not rebuild the frozen formulas/settings in the other sections. */
function parseRouterMonitorDraft(plan: QualityGroup, draft: MonitorDraft, definitions: Parameters<typeof parseAdditionDraft>[1]) {
  const original = monitorDraftOf(plan), parsed = parseMonitorDraft(draft, definitions);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (same(draft.mirror, original.mirror)) parsed.mirrorTakeProfit = plan.mirrorTakeProfit;
  if (same(draft.vetoes, original.vetoes)) parsed.holdingVetoes = plan.holdingVetoes;
  if (same(draft.vetoStages, original.vetoStages)) {
    parsed.vetoStages = plan.vetoStages; parsed.vetoStageMode = plan.vetoStageMode; parsed.vetoPeakBasis = plan.vetoPeakBasis;
  }
  if (same(draft.addition, original.addition)) { parsed.addition = plan.addition; parsed.sellStages = plan.sellStages; return parsed; }
  if (plan.addition && parsed.addition) {
    const roundKeys = Object.keys(original.addition.otherRounds[0]).filter(k => k !== 'sellSwitch');
    const roundDraftAt = (d: MonitorDraft, i: number) => { const value = i ? d.addition.otherRounds[i - 1] : d.addition; return value ? Object.fromEntries(roundKeys.map(k => [k, value[k]])) : undefined; };
    const oldFirst = plan.addition.rounds?.[0];
    if (oldFirst && same(roundDraftAt(draft, 0), roundDraftAt(original, 0))) {
      // Preserve the first-round fields duplicated on the root addition rule as well.
      for (const key of ['source','structure','stricterPct','condition','conditions','prerequisites','minGainPct','entryBufferAtr','supportOffsetAtr','entryDistanceAtr','gainBasis','entryVetoes','detectorPrerequisite'] as const) {
        if (plan.addition[key] === undefined) delete parsed.addition[key]; else (parsed.addition as any)[key] = plan.addition[key];
      }
    }
    parsed.addition.rounds = parsed.addition.rounds?.map((r, i) => plan.addition!.rounds?.[i] && same(roundDraftAt(draft, i), roundDraftAt(original, i)) ? plan.addition!.rounds[i] : r);
    for (const key of ['supportReduction','geometricLock','breakevenFloor'] as const) {
      if (same(draft.addition[key], original.addition[key])) (parsed.addition as any)[key] = plan.addition[key];
    }
    parsed.sellStages = parsed.sellStages?.map(stage => {
      const old = plan.sellStages?.find(s => s.afterAdditions === stage.afterAdditions);
      const switchAt = (d: MonitorDraft) => stage.afterAdditions === 1 ? d.addition.sellSwitch : d.addition.otherRounds[stage.afterAdditions - 2]?.sellSwitch;
      return old && same(switchAt(draft), switchAt(original)) ? old : stage;
    });
  }
  return parsed;
}

type RouterDraftHandle = { build: () => import('@/lib/fish/qualityPlanRouter').QualityPlanRouter };
/** Keep both branch forms mounted so raw edits survive tab switches and are saved atomically. */
function EditableQualityRouter({ plan, ready, controller, onDirtyChange }: {
  plan: QualityGroup; ready: boolean; controller: { current: RouterDraftHandle | null }; onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const router = plan.router!, definitions = useFeatureDefinitions();
  const [branch, setBranch] = useState<'structure' | 'attack'>('structure');
  const [visited, setVisited] = useState({ structure: true, attack: false });
  const branchPlans = useMemo(() => ({ structure: [router.structure], attack: [router.attack] }), [router]);
  const branchDirtyCallbacks = useMemo(() => ({
    structure: (value: boolean) => setDirtyBranches(old => old.structure === value ? old : { ...old, structure: value }),
    attack: (value: boolean) => setDirtyBranches(old => old.attack === value ? old : { ...old, attack: value }),
  }), []);
  const [threshold, setThreshold] = useState(String(router.threshold));
  // 【用户要求】2026-11-06 结构开局：每轮分流时进攻分支从第几次加仓起参与竞速（1＝每一次）
  const [attackFrom, setAttackFrom] = useState(String(raceAttackFromRound(router)));
  const [drafts, setDrafts] = useState(() => ({ structure: monitorDraftOf(router.structure), attack: monitorDraftOf(router.attack) }));
  const [dirtyBranches, setDirtyBranches] = useState({ structure: false, attack: false });
  const views = useRef<Partial<Record<'structure' | 'attack', SellPlansDraftView>>>({});
  const dirty = threshold !== String(router.threshold) || isRaceRouter(router) && attackFrom !== String(raceAttackFromRound(router)) || dirtyBranches.structure || dirtyBranches.attack;
  useEffect(() => { onDirtyChange(plan.id, dirty); }, [plan.id, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(plan.id, false), [plan.id, onDirtyChange]);
  controller.current = { build: () => {
    if (!threshold.trim()) throw Error('请填写分支状态 S 门槛');
    if (isRaceRouter(router) && !attackFrom.trim()) throw Error('请填写进攻分支从第几次加仓起参与');
    const buildBranch = (key: 'structure' | 'attack') => {
      const view = views.current[key]; if (!view) return router[key];
      try { return view.build()[0]; } catch (cause) { throw Error(`${key === 'structure' ? '结构' : '进攻'}分支：${cause instanceof Error ? cause.message : '参数无效'}`); }
    };
    return prepareQualityRouterDraft(router, buildBranch('structure'), buildBranch('attack'), Number(threshold), isRaceRouter(router) ? Number(attackFrom) : undefined);
  } };
  return <section className="space-y-3 rounded border border-primary/25 bg-primary/5 p-3 text-[11px]" data-testid="quality-router-editor">
    <p className="font-medium">条件分支 · 编辑工作副本</p>
    {isRaceRouter(router) ? <div className="flex flex-wrap items-center gap-2">每一次加仓前都分流：结构分支与进攻分支这一次的加仓规则同时等候，先满足者成交（同一分钟先结构）。进攻分支各次的状态 S 门槛不低于
      <input aria-label="分支状态 S 门槛" type="number" step="any" min="0" max="1" value={threshold} onChange={e => setThreshold(e.target.value)} className={field + ' w-20'}/>
      ；进攻分支从第
      <input aria-label="进攻分支从第几次加仓起参与" type="number" step="1" min="1" max="100" value={attackFrom} onChange={e => setAttackFrom(e.target.value)} className={field + ' w-16'}/>
      次加仓起参与竞速（1＝每一次；填 3 则前两次只走结构分支）。
    </div> : <label className="flex flex-wrap items-center gap-2">第{routerOrdinal(router)}次结构加仓时，此前已收盘状态 S 大于
      <input aria-label="分支状态 S 门槛" type="number" step="any" min="0" max="1" value={threshold} onChange={e => setThreshold(e.target.value)} className={field + ' w-20'}/>
      则从第{routerNextOrdinal(router)}次起使用进攻分支，否则保持结构分支。只选择一次。
    </label>}
    <p className="text-muted-foreground">{isRaceRouter(router)
      ? '这是独立工作副本，修改后可保存、运行，再存为新模板。初始卖出、镜像、止损、加仓通用设置、卖出切换和否决阶段为公共设置；修改一边后，保存时同步到另一边。两个分支各次加仓条件分别修改，进攻分支的轮数不多于结构分支。'
      : `这是独立工作副本，修改后可保存、运行，再存为新模板。初始卖出、镜像、止损、加仓通用设置和${routerPrefixText(router)}加仓为公共设置；修改一边后，保存时同步到另一边。第${routerNextOrdinal(router)}次及之后的加仓、卖出切换和否决阶段可分别修改。`}</p>
    <div role="tablist" aria-label="编辑条件分支" className="flex gap-2">{(['structure', 'attack'] as const).map(key => <button type="button" role="tab" aria-selected={branch === key} key={key} onClick={() => { setBranch(key); setVisited(old => ({ ...old, [key]: true })); }} className={`rounded px-2 py-1 ${branch === key ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{key === 'structure' ? '结构分支' : '进攻分支'}</button>)}</div>
    {(['structure', 'attack'] as const).map(key => {
      if (!visited[key]) return null;
      const original = router[key], monitorDirty = JSON.stringify(drafts[key]) !== JSON.stringify(monitorDraftOf(original));
      return <div key={key} hidden={branch !== key} data-testid={`router-branch-${key}`}>
        <FishQualitySellPlansEditor plans={branchPlans[key]} ready={ready} embedded onSave={() => {}} extraDirty={monitorDirty}
          onDirtyChange={branchDirtyCallbacks[key]}
          prepare={plans => monitorDirty ? plans.map(p => ({ ...p, ...parseRouterMonitorDraft(original, drafts[key], definitions) })) : plans}
          renderHolding={view => { views.current[key] = view; return <HoldingMonitorEditor ready={ready} plan={view.plans[0]} draft={drafts[key]}
            setDraft={draft => setDrafts(old => ({ ...old, [key]: draft }))} save={() => {}} error="" allDirty={false} count={1} hideSave/>; }}/>
      </div>;
    })}
  </section>;
}

/** The tab list and algorithm cards are projections of the same draft IDs and order. */
function HoldingMonitorSettings({state,activeId,onSelect,done,selectedCount,outsideHint}:{state:FishQualityState;activeId:string|null;onSelect:(id:string)=>void;done:()=>void;selectedCount:number;outsideHint?:ReactNode}) {
  const definitions=useFeatureDefinitions(),plans=state.study.sellPlans??[];
  const [drafts,setDrafts]=useState<Record<string,{base:string;draft:MonitorDraft}>>({});
  const forPlan=(p:QualityGroup)=>drafts[p.id]?.base===monitorBaseKey(p)?drafts[p.id].draft:monitorDraftOf(p);
  const changed=(p:QualityGroup)=>JSON.stringify(forPlan(p))!==JSON.stringify(monitorDraftOf(p));
  const controllers=useRef<Record<string,{current:RouterDraftHandle|null}>>({});
  const [routerDirty,setRouterDirty]=useState<Record<string,boolean>>({});
  const setRouterDirtyFlag=useCallback((id:string,dirty:boolean)=>setRouterDirty(old=>old[id]===dirty?old:{...old,[id]:dirty}),[]);
  const extraDirty=plans.some(changed)||Object.values(routerDirty).some(Boolean);
  const merge=(next:QualityGroup[])=>next.map(p=>{
    // 【用户要求】2026-11-03 旧引擎方案不经过新版监测表单（表单会把加仓改写成箱体），原样保存
    if(p.router){
      const router=controllers.current[p.id]?.current?.build()??p.router;
      return router===p.router?p:{...router.structure,id:p.id,label:p.label,buyFilters:p.buyFilters,frozenVersions:p.frozenVersions,router};
    }
    if(!changed(p)||isLegacyQualityPlan(p))return p;
    try { return {...p,...parseMonitorDraft(forPlan(p),definitions)}; } catch(cause) { throw new Error(`${p.label}：${cause instanceof Error?cause.message:'监测条件无效'}`); }
  });
  return <FishQualitySellPlansEditor plans={plans} ready={state.ready} onSave={state.setSellPlans} onSelectPlan={onSelect} templates={state.savePlanTemplate&&state.deletePlanTemplate?{owner:state.account,restore:state.restorePlanTemplate,templates:activeQualityPlanTemplates(state.study),save:state.savePlanTemplate,remove:state.deletePlanTemplate}:undefined} onCopyPlan={(source,copy)=>{
    if(copy.router){copy.router=structuredClone(controllers.current[source.id]?.current?.build()??copy.router);return;}
    setDrafts(current=>({...current,[copy.id]:{base:monitorBaseKey(copy),draft:structuredClone(forPlan(source))}}));
  }} extraDirty={extraDirty} prepare={merge} renderHolding={view=>{
    const active=view.plans.find(p=>p.id===activeId)??view.plans[0];
    return <>
      <p className="mb-2 text-[10.5px] text-muted-foreground" data-testid="monitor-plan-draft-count">监测方案 {view.plans.length} 套 · 与上方按编号一一对应{view.dirty?' · 有待保存设置':''}</p>
      {view.plans.length>0&&<div role="tablist" aria-label="选择要设置持仓监测的卖出方案" className="mb-3 flex flex-wrap gap-1 rounded-md bg-muted/60 p-1 text-[10.5px]">{view.plans.map((p,i)=>{
        const d=forPlan(p),n=d.vetoes.filter(v=>v.enabled).length+(d.mirror.enabled?1:0)+(d.addition.enabled?1:0)+[d.addition,...d.addition.otherRounds].slice(0,Math.max(1,Number(d.addition.maxRounds)||1)).filter(r=>r.sellSwitch?.enabled).length+(d.vetoStages.enabled?d.vetoStages.stages.length:0);
        return <button type="button" role="tab" key={p.id} data-plan-id={p.id} aria-selected={active?.id===p.id} onClick={()=>onSelect(p.id)} className={`inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 ${active?.id===p.id?'bg-background font-medium shadow-sm':'text-muted-foreground hover:text-foreground'}`}><span className="text-muted-foreground">{i+1}.</span>{p.label}<span title="当前填写中已启用的监测条件数" className="rounded bg-primary/15 px-1 text-[9px] tabular-nums text-primary">{n} 项条件</span></button>;
      })}</div>}
      {view.plans.filter(p=>p.router).map(p=><div key={p.id+':'+JSON.stringify(p.router)} hidden={active?.id!==p.id}>
        <EditableQualityRouter plan={p} ready={state.ready} controller={controllers.current[p.id]??(controllers.current[p.id]={current:null})} onDirtyChange={setRouterDirtyFlag}/>
      </div>)}
      {active&&isLegacyQualityPlan(active)?<div className="space-y-3" data-testid="quality-monitor-legacy" data-plan-id={active.id}>
        <p className="text-xs font-medium">持仓监测 · {active.label}</p>
        <FishQualityMonitorSettingsView plan={active} holdingOnly/>
        <div className="sticky bottom-0 -mx-4 flex justify-end border-t border-border/50 bg-popover px-4 py-2.5"><button type="button" disabled={!state.ready} onClick={()=>{if(view.save())done();}} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">{`保存全部 ${view.plans.length} 套方案`}</button></div>
        {view.error&&<p role="alert" className="text-[11px] text-destructive">{view.error}</p>}
      </div>:active?.router?<div className="contents" data-testid="quality-monitor-router-settings">
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5">
          {view.error&&<p role="alert" className="w-full text-[11px] text-destructive">{view.error}</p>}
          <span className="mr-auto text-[10.5px] text-muted-foreground">{view.dirty?'方案尚未保存':'当前方案已保存'} · 本轮已勾选 {selectedCount} 条{outsideHint&&<> · {outsideHint}</>}</span>
          <button type="button" disabled={!state.ready} onClick={()=>{if(view.save())done();}} className="h-7 rounded-md border border-primary/30 px-2.5 text-[11px] text-primary disabled:opacity-40">保存方案</button>
          <button type="button" disabled={!state.ready||!selectedCount} title={selectedCount?'保存完整方案，然后监测当前筛选下已勾选的信号':'请先在组合表中勾选本轮要监测的信号'} onClick={()=>{if(view.save()){done();void state.start();}}} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">保存并开始监测</button>
        </div>
      </div>:active?<HoldingMonitorEditor key={active.id} ready={state.ready} plan={active} draft={forPlan(active)} setDraft={draft=>setDrafts(current=>({...current,[active.id]:{base:monitorBaseKey(active),draft}}))}
        allDirty={view.algorithmsDirty || view.plans.some(p=>p.id!==active.id&&changed(p))} count={view.plans.length} error={view.error} save={()=>{
          const saved=view.save(next=>next.map(p=>{
            if(p.id!==active.id||isLegacyQualityPlan(p)||p.router)return p;
            try { return {...p,...parseMonitorDraft(forPlan(active),definitions)}; } catch(cause) { throw new Error(`${p.label}：${cause instanceof Error?cause.message:'监测条件无效'}`); }
          }));
          if(saved)done();
        }}/>:<p className="pb-3 text-[11px] text-muted-foreground">暂无监测方案；新增上方算法后即可设置加仓条件。</p>}
    </>;
  }}/>;
}
const FILTER_TEXT: Record<QualityFilterStatus['state'], string> = { none: '', pass: '满足', fail: '未买入', pending: '待判断', error: '缺数据' };
const QualityArchiveContext=createContext(false);
/**
 * 【用户要求】2026-11-01 卖出列分栏、各有名称：加仓次数 · 几何仓位 · 相对涨幅（「进程」一栏用户要求删除）。固定栏宽，行与行上下对齐。
 * 相对涨幅与交易战役同口径（qualityRelativeGain）；收益率只在悬停说明里。
 */
/** 运行状态两位数字（过滤、监测）与表头小字共用同一栅格，上下对齐。 */
const RUN_STATE_GRID = 'grid w-[4.5rem] grid-cols-2 items-center gap-2';
const SELL_PARTS = 'grid w-full grid-cols-[3.25rem_3.5rem_4rem_4rem] items-center gap-2';
function ResultCell({ plan, result, onClick, section, onOpenCampaign }: { plan: QualityGroup; result?: QualityResult; onClick: () => void; section: 'sell' | 'detect'; onOpenCampaign?: () => void }) {
  const archiveView=useContext(QualityArchiveContext);
  const router = useInRouterContext(), className = `${SELL_PARTS} text-left hover:underline`;
  const additions=qualityAdditionFills(result??{}),gain=qualityRelativeGain(plan,result),payoff=qualityPayoffRatio(plan,result),evaluated=result?.status==='open'||result?.status==='closed';
  const stageTitle=result?.activeSellStage?`第 ${result.activeSellStage.afterAdditions} 次加仓后：${result.activeSellStage.label} ${result.activeSellStage.rule.direction} ${result.activeSellStage.rule.threshold}`:'';
  const summary=[`收益率 ${pct(result?.returnPct)}`,`相对涨幅：${gain.value==null?gain.reason:gain.reason}`,`盈亏比：${payoff.reason}`,...(additions.length?[`共加仓 ${additions.reduce((n,a)=>n+a.quantity,0).toPrecision(7)} 枚 · 均价 ${result?.averageEntryPrice?.toPrecision(7)}`]:[]),...(stageTitle?[stageTitle]:[]),...(result?.additionVetoes?.length?[`否决加仓 ${result.additionVetoes.length} 次：${result.additionVetoes.map(v=>`${new Date(v.at+8*3600000).toISOString().slice(5,16).replace('T',' ')} 第 ${v.round} 次 · ${ADDITION_VETO_LABELS[v.kind as AdditionEntryVetoKind]??v.kind}（${v.reading}）`).join('；')}`]:[]),...(result?.additionReductions?.length?[`支撑线下移 ${result.additionReductions.length} 次：${result.additionReductions.map(c=>`${new Date(c.at+8*3600000).toISOString().slice(5,16).replace('T',' ')} 支撑 ${+c.previousSupport.toPrecision(8)}→${+c.newSupport.toPrecision(8)} · K ${+c.previousK.toPrecision(8)}→${+c.newK.toPrecision(8)} · ${c.fraction>0?`减仓 ${+(c.fraction*100).toFixed(2)}% @ ${+c.price.toPrecision(8)}（落袋 ${c.realizedPnl.toFixed(2)}）`:'无需减仓'}`).join('；')}`]:[])].join('\n');
  const content = <><span className={`text-[10px] tabular-nums ${additions.length?'text-primary':'text-muted-foreground/60'}`} data-testid="quality-sell-additions">{additions.length?`${additions.length} 次`:evaluated?'0 次':'—'}</span><span className="font-mono text-[10px] tabular-nums text-muted-foreground" data-testid="quality-sell-geometric">{qualityGeometricPositionText(qualityGeometricPosition(result))}</span><span className={`font-mono tabular-nums ${signed(gain.value)}`} data-testid="quality-sell-relative-gain">{qualityRelativeGainText(gain.value)}</span><span className={`font-mono tabular-nums ${signed(payoff.value)}`} data-testid="quality-sell-payoff">{qualityPayoffRatioText(payoff.value)}</span></>;
  if (!archiveView && result && hasQualityCampaign(result)) {
    const href = qualityCampaignPath(result.key, section), title = `${summary}\n打开交易战役`;
    return router ? <Link to={href} state={FROM_FISH_QUALITY} onClick={onOpenCampaign} className={className} title={title}>{content}</Link> : <a href={href} className={className} title={title}>{content}</a>;
  }
  if (result?.status === 'error') return <button type="button" onClick={onClick} className={className} title={result.reason}>{content}<span className="col-span-4 max-w-80 whitespace-normal text-[10px] text-destructive" data-testid="quality-monitor-error">未完成：{result.reason || '行情读取失败，请重试'}</span></button>;
  return <button type="button" className={className} onClick={onClick} title={result?.reason ? `${result.reason}\n${summary}` : summary}>{content}</button>;
}

export function QualityHalfMirrorCell({plan,result,skipped}:{plan:QualityGroup;result?:QualityResult;skipped?:string}) {
 const mirror=qualityHalfMirror(plan,result);
 return <span title={skipped??mirror.detail} data-mirror-state={skipped?'unbought':mirror.state} className="inline-flex flex-col gap-0.5">{skipped?<span className="text-[9px] text-muted-foreground">未买入</span>:mirror.value!=null?<><span className={`font-mono tabular-nums ${signed(mirror.value)}`}>{pct(mirror.value)}</span><span className="text-[9px] text-muted-foreground">{mirror.label}</span></>:<span className={`text-[9px] ${mirror.state==='error'?'text-destructive':'text-muted-foreground'}`}>{mirror.label}</span>}</span>;
}


/** 组合表结果的显示偏好（只存本机浏览器）。 */
const hiddenKey=(kind:'filter'|'monitor')=>`veil:quality-hide-${kind}`;
const readHidden=(kind:'filter'|'monitor')=>{try{return localStorage.getItem(hiddenKey(kind))==='1';}catch{return false;}};
const writeHidden=(kind:'filter'|'monitor',hidden:boolean)=>{try{if(hidden)localStorage.setItem(hiddenKey(kind),'1');else localStorage.removeItem(hiddenKey(kind));}catch{/* 存不下只影响下次打开 */}};
/**
 * 【用户要求】2026-11-02 「开始过滤 / 开始监测」旁非常隐形的「隐藏」「清除」：只作用于组合表里已产生的结果，组合表要干净。
 * 清除要再点一次确认；交易战役与过滤库、监测库的历史都不受影响。
 */
function QualityResultTools({ kind, hidden, onToggle, count, onClear, disabled }: { kind: 'filter' | 'monitor'; hidden: boolean; onToggle: () => void; count: number; onClear?: () => void; disabled?: boolean }) {
  const [confirm, setConfirm] = useState(false), name = kind === 'filter' ? '过滤' : '监测', ghost = 'flex h-6 w-6 items-center justify-center rounded text-muted-foreground/35 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30';
  return <span className="inline-flex shrink-0 items-center" data-testid={`quality-${kind}-result-tools`}>
    <button type="button" className={ghost} aria-label={hidden ? `显示组合表中的${name}结果` : `隐藏组合表中的${name}结果`} aria-pressed={hidden} title={hidden ? `显示组合表中的${name}结果` : `隐藏组合表中的${name}结果`} onClick={onToggle}>{hidden ? <EyeOff aria-hidden className="h-3 w-3"/> : <Eye aria-hidden className="h-3 w-3"/>}</button>
    <Popover open={confirm} onOpenChange={setConfirm}><PopoverTrigger asChild><button type="button" className={ghost} aria-label={`清除组合表中的${name}结果`} title={count ? `清除组合表中的 ${count} 项${name}结果` : `组合表中没有${name}结果`} disabled={disabled || !count || !onClear}><Eraser aria-hidden className="h-3 w-3"/></button></PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-2 p-3 text-[11px]"><p>清除组合表中的 {count} 项{name}结果？</p><p className="text-[10px] leading-relaxed text-muted-foreground">{kind === 'monitor' ? '先归档，交易战役与监测库保留；之后点「开始监测」会全部重算。' : '过滤库里的历史轮次保留；之后点「开始过滤」重新计算。'}</p>
        <div className="flex justify-end gap-2"><button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-muted" onClick={() => setConfirm(false)}>取消</button><button type="button" className="rounded bg-destructive/10 px-2 py-1 text-destructive hover:bg-destructive/20" onClick={() => { setConfirm(false); onClear?.(); }}>确认清除</button></div>
      </PopoverContent></Popover>
  </span>;
}
function MergedEntryCells({ entries, phase, planId, plan, expand }: { entries: { result?: QualityResult; skipped?: QualityFilterStatus }[]; phase: 'sell' | 'detect'; planId: string; plan: QualityGroup; expand: () => void }) {
  const results = entries.map(e => e.skipped ? undefined : e.result);
  const returns = results.map(r => r && (r.status === 'open' || r.status === 'closed') ? r.returnPct : null);
  const summary = qualityTableRange(returns, pct);
  const title = `合并 ${entries.length} 次买入记录；展开探测算法查看各次买入、过滤与收益明细`;
  return <>
    <td className={`${cell} border-l border-t border-border/40`}><button type="button" className={`${SELL_PARTS} text-left hover:underline`} onClick={expand} title={`${title}\n收益率 ${summary}`}><span className="text-[10px] tabular-nums text-muted-foreground" data-testid="quality-sell-additions">{qualityTableRange(results.map(r=>r&&(r.status==='open'||r.status==='closed')?qualityAdditionFills(r).length:null),n=>`${n}`)==='—'?'—':`${qualityTableRange(results.map(r=>r&&(r.status==='open'||r.status==='closed')?qualityAdditionFills(r).length:null),n=>`${n}`)} 次`}</span><span className="font-mono text-[10px] tabular-nums text-muted-foreground" data-testid="quality-sell-geometric">{qualityTableRange(results.map(r=>qualityGeometricPosition(r)),qualityGeometricPositionText)}</span><span className="font-mono tabular-nums" data-testid="quality-sell-relative-gain">{summary === '—' && entries.every(e => e.skipped?.state === 'fail') ? '未买入' : qualityTableRange(results.map(r=>qualityRelativeGain(plan,r).value),qualityRelativeGainText)}</span><span className="font-mono tabular-nums" data-testid="quality-sell-payoff">{qualityTableRange(results.map(r=>qualityPayoffRatio(plan,r).value),qualityPayoffRatioText)}</span></button></td>
    {phase === 'sell' && <>{(['static','peak'] as const).map(kind => <td key={kind} className={`${cell} border-t border-border/40 font-mono tabular-nums text-muted-foreground`} data-testid={kind==='peak'?'quality-peak-gain':'quality-static-drawdown'} data-sell-plan={planId} title={title}>{qualityTableRange(results.map(r => kind==='peak'?qualityPeakPct(r):qualityDrawdownPct(r,'static')), value => pct(value).replace(/^\+/, ''))}</td>)}<QualitySalePriceChangeCell plan={plan} entries={entries}/><td className={`${cell} border-t border-border/40`} data-testid="quality-half-mirror" data-sell-plan={planId}><button type="button" onClick={expand} className="text-left hover:underline" title={title}>{qualityTableRange(results.map(r=>qualityHalfMirror(plan,r).value),pct)==='—' ? [...new Set(entries.map(e=>e.skipped?'未买入':qualityHalfMirror(plan,e.result).label))].join(' / ') : qualityTableRange(results.map(r=>qualityHalfMirror(plan,r).value),pct)}<span className="ml-2 text-[9px] text-muted-foreground">{entries.length} 次买入 · 展开</span></button></td><td className={`${cell} border-t border-border/40 font-mono tabular-nums text-muted-foreground`} data-testid="quality-held-time" data-sell-plan={planId} title={title}>{qualityTableRange(results.map(r => r && (r.status === 'open' || r.status === 'closed') ? r.heldHours : null), heldText)}</td></>}
  </>;
}

function RowDetail({ row, state, close }: { row?: QualitySample; state: FishQualityState; close: () => void }) {
  const study = state.study;
  return <Dialog open={!!row} onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
    <DialogHeader><DialogTitle className="text-sm">{row?.source.symbol} · 卖出对比</DialogTitle><DialogDescription className="text-xs">信号 {date(row?.source.timeMs)} · 买入 {date(row?.enteredAt)} · 每方案独立模拟 100 USDT / 1 倍</DialogDescription></DialogHeader>
    {row && <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-[11px]"><thead className="bg-muted/40 text-muted-foreground"><tr><th className={cell}>指标</th>{study.sellPlans?.map(p => <th key={p.id} className={`${cell} font-medium`}>{p.label} {ruleText(p)}</th>)}</tr></thead><tbody>{[
      ['状态', (r?: QualityResult) => `${resultText(r)}${r?.reason ? ` · ${r.reason}` : ''}`],
      ['当前一票阶段', (r?:QualityResult)=>r?.activeVetoStage?`第 ${r.activeVetoStage.afterAdditions} 次加仓后`:'原一票条件'],
      ['当前卖出算法', (r?:QualityResult)=>r?.activeSellStage?`第 ${r.activeSellStage.afterAdditions} 次加仓后 · ${r.activeSellStage.label} ${r.activeSellStage.rule.direction} ${r.activeSellStage.rule.threshold}`:'原卖出算法'],
      ['卖出切换记录', (r?:QualityResult)=>r?.sellStageSwitches?.map(stage=>`第 ${stage.afterAdditions} 次 · ${date(stage.at)} · ${stage.label}`).join('；')??'未切换'],
      ['买入时间', (r?: QualityResult) => date(r?.entryTime)], ['买入价', (r?: QualityResult) => r?.entryPrice?.toPrecision(7) ?? '—'],
      ['卖出 / 估值时间', (r?: QualityResult) => date(r?.endTime)], ['卖出 / 估值价', (r?: QualityResult) => r?.endPrice?.toPrecision(7) ?? '—'],
      ['加仓', (r?: QualityResult) => qualityAdditionFills(r??{}).length ? qualityAdditionFills(r??{}).map((a,i)=>`第${i+1}轮 ${date(a.at)} · ${a.quantity.toPrecision(7)} 枚 · T ${a.price.toPrecision(7)}${a.sizing?` · S ${a.sizing.previousSupport.toPrecision(7)} · K ${a.sizing.support.toPrecision(7)} · ATR ${a.sizing.atr.toPrecision(7)}`:''}`).join('；') : r?.additionNote ?? '未触发'],
      ['累计投入 / 持仓均价', (r?: QualityResult) => r?.additionFill ? `${r.totalInvested} USDT · ${r.averageEntryPrice?.toPrecision(8)}` : '—'],
      ['镜像止盈', (r?: QualityResult) => r?.mirrorFill ? `${date(r.mirrorFill.at)} · 价格 ${r.mirrorFill.price.toPrecision(7)} · 卖出初始币数 ${+(r.mirrorFill.fraction*100).toPrecision(8)}%` : '未触发'],
      ['余仓 / 已兑现', (r?: QualityResult) => r?.mirrorFill ? `${+((r.remainingFraction ?? 0)*100).toPrecision(8)}% / ${r.realizedPnl?.toFixed(2)} USDT` : '—'],
      ['收益率', (r?: QualityResult) => pct(r?.returnPct)], ['盈亏 USDT', (r?: QualityResult) => r?.pnl?.toFixed(2) ?? '—'],
      ['镜像已兑现盈亏 USDT', (r?: QualityResult) => r?.mirrorRealizedPnl?.toFixed(2) ?? '—'],
      ['余仓盈亏 USDT', (r?: QualityResult) => r?.remainingPnl?.toFixed(2) ?? '—'],
      ['峰值涨幅', (r?: QualityResult) => pct(r?.peakPct)], ['最大不利涨跌', (r?: QualityResult) => pct(r?.adversePct)],
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
const choiceText = (c: QualityDetectorChoice) => `${c.label} ${c.direction} ${c.threshold}`;
/** 只列默认探测算法（见 qualityDetectorSelection）；同一条默认规则的历史版本合成一项。 */
function DetectorPicker({ choices, signalsOf, selected, onChange, children }: { choices: readonly QualityDetectorChoice[]; signalsOf: (ids: readonly string[]) => number; selected: readonly string[]; onChange: (ids: string[]) => void; children: ReactNode }) {
  const chosen = choices.filter(c => c.ids.some(id => selected.includes(id))).length;
  return <Popover><PopoverTrigger asChild>{children}</PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-72 max-h-[min(70dvh,var(--radix-popover-content-available-height))] overflow-y-auto p-0 text-[11px]" data-testid="quality-detector-picker">
    <div className="sticky top-0 flex items-center justify-between border-b border-border/50 bg-popover px-3 py-2"><span className="font-medium">探测算法<span className="ml-1.5 font-normal text-muted-foreground">{chosen ? `已选 ${chosen} / ${choices.length}` : `默认 ${choices.length} 个`}</span></span><button type="button" className="text-primary hover:underline disabled:text-muted-foreground/50 disabled:no-underline" disabled={!selected.length} onClick={() => onChange([])}>全部</button></div>
    {choices.length ? <ul role="group" aria-label="选择探测算法" className="py-1">{choices.map(c => { const on = c.ids.every(id => selected.includes(id)); return <li key={c.key} className="group/item flex items-center gap-2 px-3 py-1.5 hover:bg-muted/60">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"><input type="checkbox" aria-label={`探测算法 ${choiceText(c)}`} checked={on} onChange={() => onChange(on ? selected.filter(id => !c.ids.includes(id)) : [...new Set([...selected, ...c.ids])])} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/><span className="min-w-0 flex-1 truncate">{c.label}</span><span className="shrink-0 font-mono text-muted-foreground/80">{c.direction} {c.threshold}</span></label>
      <button type="button" className="shrink-0 text-primary opacity-0 hover:underline focus-visible:opacity-100 group-hover/item:opacity-100" aria-label={`只看 ${choiceText(c)}`} onClick={() => onChange([...c.ids])}>仅此</button>
      <span className="w-8 shrink-0 text-right font-mono tabular-nums text-muted-foreground/60" title="条信号">{signalsOf(c.ids)}</span>
    </li>; })}</ul> : <p className="px-3 py-3 text-muted-foreground">当前数据里没有默认探测算法的信号</p>}
  </PopoverContent></Popover>;
}
export function FishQuality({ state, mining, onJump, canJump,archiveView=false }: { archiveView?:boolean;state: FishQualityState; mining?: FishMiningApi; onJump?: (source: TradeSignal) => void; canJump?: (source: TradeSignal) => boolean }) {
  const { study, ready, running, progress } = state;
  // 从交易战役返回：按离开时记下的状态打开（见 lib/fish/qualityReturn）
  const uid=useId(),titleId=archiveView?uid+'-title':'fish-quality-title',contentId=archiveView?uid+'-content':'fish-quality-content';
  const [back] = useState(() => archiveView?undefined:pendingQualityReturn()), ui = back?.ui;
  const [manualOpen, setManualOpen] = useState(false);
  const [open, setOpen] = useState(ui?.open ?? true), [query, setQuery] = useState(ui?.query ?? ''), [month, setMonth] = useState(ui?.month ?? ''), [algorithmChoice, setAlgorithmsState] = useState<string[]>(() => ui?.algorithms ?? (ui?.algorithm ? [ui.algorithm] : [])), [origin, setOrigin] = useState<QualityReturnUi['origin']>(ui?.origin ?? '');
  // 【用户要求】2026-10-26「比较卖出和比较探测没必要分开，合并到一起，统一叫做卖出与探测（控制变量法）」：只有一个视图
  const phase = 'sell' as const;
  const [detectorExpanded, setDetectorExpanded] = useState(ui?.detectorExpanded ?? false);
  const [labelExpanded,setLabelExpanded]=useState<string[]>(ui?.labelExpanded??[]);
  const toggleLabel=(id:string)=>setLabelExpanded(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);
  const [sellErrorExpanded,setSellErrorExpanded]=useState<string[]>(ui?.sellErrorExpanded??[]);
  const sellErrorOpen=useMemo(()=>new Set(sellErrorExpanded),[sellErrorExpanded]);
  const [entryExpanded,setEntryExpanded]=useState<string[]>(ui?.entryExpanded??[]);
  const [postExitExpanded,setPostExitExpanded]=useState<string[]>(ui?.postExitExpanded??[]);
  const postExitOpen=useMemo(()=>new Set(postExitExpanded),[postExitExpanded]);
  const entryReadings=useMemo(()=>new Map((study.entryReadings??[]).map(r=>[r.key,r])),[study.entryReadings]);
  const postExitReadings=useMemo(()=>new Map((study.postExitReadings??[]).map(r=>[r.key,r])),[study.postExitReadings]);
  const [runStage, setRunStage] = useState<QualityRunStage>(ui?.runStage ?? 'monitor'), [runState, setRunState] = useState<QualityRunStateFilter>(ui?.runState ?? '');
  const [filterOpen, setFilterOpen] = useState(false), [monitorOpen, setMonitorOpen] = useState(false), [runMenuOpen, setRunMenuOpen] = useState(false);
  const [hideFilter, setHideFilter] = useState(() => readHidden('filter')), [hideMonitor, setHideMonitor] = useState(() => readHidden('monitor'));
  const toggleHidden = (kind: 'filter' | 'monitor') => (kind === 'filter' ? setHideFilter : setHideMonitor)(hidden => { writeHidden(kind, !hidden); return !hidden; });
  const [sort, setSort] = useState<SortKey>(ui?.sort?.replace(/^dynamic:/,'peak:') as SortKey ?? 'time'), [ascending, setAscending] = useState(ui?.ascending ?? false), [scrollTop, setScrollTop] = useState(ui?.tableTop ?? 0);
  const rootRef = useRef<HTMLElement>(null);
  // 【用户要求】2026-11-01 查「点进战役后持仓监测停了」：没在跑、上一轮是暂停结束时，直接写出暂停原因
  const lastRound = study.monitorLibrary?.rounds.reduce<NonNullable<FishQualityStudy['monitorLibrary']>['rounds'][number] | undefined>((a, r) => !a || r.startedAt > a.startedAt ? r : a, undefined);
  const lastPause = lastRound?.state === 'paused' && lastRound.error ? { reason: lastRound.error, at: lastRound.finishedAt ?? lastRound.updatedAt } : null;
  /** 点进交易战役前记下界面状态与滚动位置，返回时原样恢复。 */
  const rememberReturn = () => saveQualityReturn({
    ui: { open, query, month, algorithms: algorithmChoice, origin, detectorExpanded, labelExpanded, sellErrorExpanded, postExitExpanded, entryExpanded, runStage, runState, sort, ascending, tableTop: tableRef.current?.scrollTop ?? scrollTop },
    scroll: ancestorScrolls(rootRef.current),
  });
  const [error, setError] = useState(''), [detailId, setDetailId] = useState('');
  const [statistics, setStatistics] = useState<QualityStatisticsRequest | null>(null);
  const allRows = useMemo(() => {
    const rows = qualityDisplayRows(study);
    return archiveView ? rows : rows.filter(row => !isDelayedTuringReplaySample(row.source));
  }, [study, archiveView]);
  const detectorMap = useMemo(() => new Map(study.groups.map(g => [g.id, g])), [study.groups]);
  const batch = allRows;
  // 月份条数跟随来源、探测算法、标的筛选；同一信号的多个探测行只计一次。
  // 选中的探测算法里已不在当前批次的不算（否则整表会空掉）
  const batchDetectors = useMemo(() => new Set(batch.map(r => r.detectorId).filter((id): id is string => !!id)), [batch]);
  const defaultIds = useMemo(() => new Set(defaultQualityDetectorIds(study.groups)), [study.groups]);
  // Apply only the explicitly selected presets; the default table includes every historical capture.
  const activeAlgorithms = useMemo(() => algorithmChoice.filter(id => batchDetectors.has(id) && defaultIds.has(id)), [algorithmChoice, batchDetectors, defaultIds]);
  const searched = useMemo(() => batch.filter(r => (!query.trim() || r.source.symbol.toUpperCase().includes(query.trim().toUpperCase())) && (!origin || hasSource(r,origin))), [batch, query, origin]);
  const narrowed = useMemo(() => activeAlgorithms.length ? searched.filter(r => activeAlgorithms.includes(r.detectorId ?? '')) : searched, [searched, activeAlgorithms]);
  /** 各探测算法在当前来源 / 标的筛选下的信号条数（同一信号只计一次）。 */
  const detectorSignals = useMemo(() => { const ids = new Map<string, Set<string>>(); for (const r of searched) if (r.detectorId) { if (!ids.has(r.detectorId)) ids.set(r.detectorId, new Set()); ids.get(r.detectorId)!.add(r.signalId ?? r.id); } return ids; }, [searched]);
  // 一项默认算法可能对应几个历史版本的组：按信号去重计数
  const signalsOf = (ids: readonly string[]) => new Set(ids.flatMap(id => [...(detectorSignals.get(id) ?? [])])).size;
  const resultMap = useMemo(() => qualityResultMap(study), [study]);
  // 旧试验兼容绑定过滤；新工作流的过滤列与卖出结果各自显示。
  const filtersOn = anyBuyFilters(study), filterReadings = study.filterReadings;
  const filterColumns = useMemo(() => { const columns = qualityFilterColumns(study); return qualityVariables(columns.map(c => c.filter)).flatMap(v => v.levels.map(f => columns.find(c => c.filter === f)!)); }, [study.sellPlans, study.buyFilters, study.independentFilters]); // eslint-disable-line react-hooks/exhaustive-deps
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
  }, [narrowed, filterReadings, study.buyFilters, study.sellPlans, study.independentFilters]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 这一行在这套方案下没买入（不满足 / 待判断 / 缺数据）时给出原因；买入了或没开过滤时为 undefined。 */
  const skippedBy = (plan: QualityGroup, row: QualitySample) => { const f = filterStatus.get(plan.id)?.get(row.signalId ?? row.id); return f && f.state !== 'pass' ? f : undefined; };
  const [monitorPlanId, setMonitorPlanId] = useState<string | null>(null);
  const filterCount = activeStandaloneBuyFilters(study).length, vetoCount = (study.sellPlans ?? []).reduce((n, p) => n + activeHoldingVetoes(p.holdingVetoes).length + (p.mirrorTakeProfit?.enabled ? 1 : 0) + (p.addition?.enabled ? 1 : 0)+(p.vetoStages?.length??0), 0);
  const plansForSort = study.sellPlans;
  const runStatuses = useMemo(() => qualityRunStatusMap(study, batch), [batch, study.results, study.filterReadings, study.sellPlans, study.buyFilters, study.observeHours, study.selectedSellId, study.independentFilters]); // eslint-disable-line react-hooks/exhaustive-deps
  const runScopeRows = useMemo(() => narrowed.filter(r => !month || signalMonthKey(r.source.timeMs) === month), [narrowed, month]);
  const runCounts = useMemo(() => {
    const entries = [...new Map(runScopeRows.map(r => [r.signalId ?? r.id, r])).keys()];
    return entries.reduce((counts, id) => { const status = runStatuses.get(id)?.[runStage]; if (status?.total) counts[status.complete ? 'done' : 'pending']++; return counts; }, {done: 0, pending: 0});
  }, [runScopeRows, runStatuses, runStage]);
  const sortedRows = useMemo(() => {
    const map = resultMap;
    const value = (r: QualitySample): number | string | null => {
      if (sort === 'run') { const status = runStatuses.get(r.signalId ?? r.id)?.[runStage]; return status?.total ? Number(status.complete) : null; }
      if (sort === 'time') return r.source.timeMs;
      if (sort === 'mined-at') return qualityTableMinedAt(r);
      if (sort === 'symbol') return r.source.symbol;
      if (sort === 'market') return r.source.market === 'us_stock' ? '美股' : '加密';
      if (sort === 'detector-value') return qualityDetectorReading(r).value;
      if (sort === 'quality') return normalizeSignalQuality(r.source.quality) ?? null;
      if (sort === 'process') return isLibrary(r) ? null : r.source.fish?.cutoffMs ?? null;
      if (sort === 'detector') { const g = detectorMap.get(r.detectorId ?? ''); return g ? `${g.label}\u0000${String(g.snapshot.threshold).padStart(12, '0')}\u0000${g.metric}` : null; }
      if (sort.startsWith('filter:')) { const column = filterColumns.find(c => `filter:${c.id}` === sort); return column ? qualityFilterValue(r, column.filter, filterReadingMap) : null; }
      if(sort.startsWith('entry:')){const p=plansForSort?.find(p=>p.id===sort.slice(6));if(!p)return null;const f=filterStatus.get(p.id)?.get(r.signalId??r.id);if(f&&f.state!=='pass')return null;const result=qualityRowResult(study,r,p,map),key=qualityEntryKey(r.source,result,p,qualityEntryParts(p)[0]),reading=key?entryReadings.get(key):undefined;return validEntryReading(reading)?reading!.value!:null;}
      if(sort.startsWith('price-change:')){const p=plansForSort?.find(p=>p.id===sort.slice(13));if(!p)return null;const f=filterStatus.get(p.id)?.get(r.signalId??r.id);return f&&f.state!=='pass'?null:qualitySalePriceChangePct(qualityRowResult(study,r,p,map));}
      if(sort.startsWith('addition:')){const p=plansForSort?.find(p=>p.id===sort.slice(9));if(!p)return null;const f=filterStatus.get(p.id)?.get(r.signalId??r.id);return f&&f.state!=='pass'?null:qualityAdditionSummary(p,qualityRowResult(study,r,p,map)).count;}
      if(sort.startsWith('label:')){const plan=plansForSort?.find(p=>p.id===sort.slice(6));if(!plan)return null;const f=filterStatus.get(plan.id)?.get(r.signalId??r.id);return qualityDetectorLabel(plan,qualityRowResult(study,r,plan,map),!!f&&f.state!=='pass').rank;}
      if(sort.startsWith('sell-error:')){const [,h,...id]=sort.split(':'),plan=plansForSort?.find(p=>p.id===id.join(':'));if(!plan)return null;const result=qualityRowResult(study,r,plan,map),key=qualityPostExitKey(r.source,result,plan),f=filterStatus.get(plan.id)?.get(r.signalId??r.id),skipped=!!f&&f.state!=='pass';const hours=h==='count'?POST_EXIT_HOURS:POST_EXIT_HOURS.filter(v=>v===Number(h));const values=hours.map(v=>qualitySellError(r.source,plan,result,key?postExitReadings.get(key):undefined,v,skipped).value).filter((v):v is 0|1=>v!=null);return values.length?values.reduce<number>((n,v)=>n+v,0):null;}
      if(sort.startsWith('post-exit:')){const [,h,metric,...id]=sort.split(':');const plan=plansForSort?.find(p=>p.id===id.join(':'));if(!plan||filterStatus.get(plan.id)?.get(r.signalId??r.id)?.state&&filterStatus.get(plan.id)!.get(r.signalId??r.id)!.state!=='pass')return null;const result=qualityRowResult(study,r,plan,map),key=qualityPostExitKey(r.source,result,plan);return key?postExitValue(postExitReadings.get(key),Number(h),metric==='peak'?'peak':'drawdown2'):null;}
      const metric = sort.startsWith('static:') ? 'static' : sort.startsWith('peak:') ? 'peak' : sort.startsWith('mirror:') ? 'mirror' : sort.startsWith('held:') ? 'held' : sort.startsWith('relative:') ? 'relative' : sort.startsWith('payoff:') ? 'payoff' : sort.startsWith('geometric:') ? 'geometric' : 'sell';
      const plan = plansForSort?.find(p => `${metric}:${p.id}` === sort);
      // 这套方案开着买入过滤时，它没买入（不满足 / 待判断 / 缺数据）的行在它的列里算空值，排在最后
      if (!plan || filterStatus.get(plan.id)?.get(r.signalId ?? r.id)?.state !== undefined && filterStatus.get(plan.id)!.get(r.signalId ?? r.id)!.state !== 'pass') return null;
      const res = qualityRowResult(study, r, plan, map);
      if (metric === 'held') return res && (res.status === 'closed' || res.status === 'open') && Number.isFinite(res.heldHours) ? res.heldHours! : null;
      if (metric === 'peak') return qualityPeakPct(res);
      if (metric === 'relative') return qualityRelativeGain(plan, res).value;
      if (metric === 'payoff') return qualityPayoffRatio(plan, res).value;
      if (metric === 'geometric') return qualityGeometricPosition(res);
      if (metric === 'mirror') return qualityHalfMirror(plan,res).value;
      if (metric === 'static') return qualityDrawdownPct(res,'static');
      return res && (res.status === 'closed' || res.status === 'open') && Number.isFinite(res.returnPct) ? res.returnPct! : null;
    };
    const keyed = runScopeRows.filter(r => { const status = runStatuses.get(r.signalId ?? r.id)?.[runStage]; return !runState || !!status?.total && status.complete === (runState === 'done'); }).map(r => ({ r, v: value(r) }));
    return keyed.sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? b.r.source.timeMs - a.r.source.timeMs : a.v == null ? 1 : -1;
      const order = typeof a.v === 'string' ? a.v.localeCompare(String(b.v)) : a.v - (b.v as number);
      return order * (ascending ? 1 : -1) || b.r.source.timeMs - a.r.source.timeMs || a.r.id.localeCompare(b.r.id);
    }).map(x => x.r);
  }, [runScopeRows, runState, runStage, runStatuses, sort, ascending, detectorMap, resultMap, plansForSort, filterStatus, filterColumns, filterReadingMap, postExitReadings, entryReadings]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows: QualityTableRow[] = useMemo(() => detectorExpanded ? sortedRows : collapseQualityTableRows(sortedRows), [sortedRows, detectorExpanded]);
  // 表格为空时表头（探测算法、运行状态两个筛选的入口）不显示：是它们滤空的，就在空状态里写明并给出清除
  const emptyByDetector = !rows.length && activeAlgorithms.length > 0 && searched.length > 0 && narrowed.length === 0;
  const emptyByRunState = !rows.length && !!runState && runScopeRows.length > 0;
  const monthCounts = useMemo(() => {
    const ids = new Map<string, Set<string>>();
    for (const r of narrowed) { const key = signalMonthKey(r.source.timeMs); if (!ids.has(key)) ids.set(key, new Set()); ids.get(key)!.add(qualityTableSignalKey(r)); }
    return new Map([...ids].map(([key, signals]) => [key, signals.size]));
  }, [narrowed]);
  const months = [...new Set(batch.map(r => signalMonthKey(r.source.timeMs)))].sort().reverse();
  const sellVariables = qualityVariables(study.sellPlans ?? []);
  const plans = sellVariables.flatMap(v => v.levels), groups = study.groups.filter(g => batch.some(r => r.detectorId === g.id));
  // 隐藏只作用于组合表里的运行结果：过滤读数与入场读数 / 持仓监测各列；探测相关列照常显示
  // 【用户要求】2026-11-02 入场读数与探测值重复，整列删除；过滤读数清除后（或还没跑过）整列不显示，有读数才出现；
  // 隐藏「买前过滤」时整组（探测值、探测算法、捕捞过程、过滤读数）都不显示
  const shownFilters = hideFilter || !filterReadings?.length ? [] : filterColumns, shownPlans = hideMonitor ? [] : plans;
  const detectorChoices = useMemo(() => qualityDetectorChoices(groups), [groups]), chosenChoices = detectorChoices.filter(c => c.ids.some(id => activeAlgorithms.includes(id)));
  const requestPostExit=state.postExit?.request;
  const postExitPlanIds=postExitExpanded.filter(id=>plans.some(p=>p.id===id));
  const sellErrorPlanIds=sellErrorExpanded.filter(id=>plans.some(p=>p.id===id));
  const observationPlanIds=[...new Set([...postExitPlanIds,...sellErrorPlanIds])];
  const postExitScopeKey=JSON.stringify([postExitPlanIds,sellErrorPlanIds,sortedRows.map(r=>r.signalId??r.id)]);
  const requestSellError=(id:string,retry=false)=>{const plan=plans.find(p=>p.id===id);if(!plan)return;const ids=[...new Set(sortedRows.filter(row=>!qualityAlgorithmExit(plan,qualityRowResult(study,row,plan,resultMap),!!skippedBy(plan,row))).map(row=>row.signalId??row.id))];if(ids.length)requestPostExit?.([id],ids,retry);};
  const requestObservations=(retry=false)=>{if(postExitPlanIds.length)requestPostExit?.(postExitPlanIds,sortedRows.map(r=>r.signalId??r.id),retry);for(const id of sellErrorPlanIds)if(!postExitPlanIds.includes(id))requestSellError(id,retry);};
  useEffect(()=>{if(archiveView||!open||!ready||!observationPlanIds.length)return;requestObservations();const timer=setInterval(()=>requestObservations(),60000);return()=>clearInterval(timer);},[open,ready,postExitScopeKey,study.results,requestPostExit]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSellError=(id:string)=>{const opening=!sellErrorOpen.has(id);setSellErrorExpanded(ids=>opening?[...ids,id]:ids.filter(v=>v!==id));if(opening)requestSellError(id,true);};
  const togglePostExit=(id:string)=>{const opening=!postExitOpen.has(id);setPostExitExpanded(ids=>opening?[...ids,id]:ids.filter(v=>v!==id));if(opening)requestPostExit?.([id],sortedRows.map(r=>r.signalId??r.id),true);};
  const selectedIds = new Set(study.selectedRowIds ?? []);
  const selectedRows = rows.filter(r => qualityTableMembers(r).some(member => selectedIds.has(member.id)));
  // 【用户要求】2026-10-27 买前过滤、持仓监测只处理「当前筛选下可见、且已勾选」的行；筛选外勾着的不动
  const selectedBatch = batch.filter(r => selectedIds.has(r.id)), scopedSelected = sortedRows.filter(r => selectedIds.has(r.id));
  const selectedCount = countSignals(scopedSelected), selectedTotal = countSignals(selectedBatch);
  // 【用户要求】2026-11-04「开始监测点不了」：勾选的信号都在筛选外时，写明在哪几个来源、各多少条，并能一键切过去
  const outsideSelection = useMemo(() => {
    if (selectedTotal <= selectedCount) return null;
    const inside = new Set(scopedSelected.map(qualityTableSignalKey)), rows = selectedBatch.filter(r => !inside.has(qualityTableSignalKey(r)));
    const bySource = (['mined', 'fish', 'library', 'turing', 'pre-entry'] as const).map(o => ({ o, n: countSignals(rows.filter(r => hasSource(r, o))) })).filter(x => x.n);
    const names = QUALITY_SOURCE_NAMES;
    return { count: selectedTotal - selectedCount, text: bySource.map(x => `${names[x.o]} ${x.n}`).join('、') };
  }, [selectedBatch, scopedSelected, selectedTotal, selectedCount]);
  /** 只改挡住已勾选信号的筛选：来源优先换成能包含全部勾选的那一个，否则全部来源；月份、标的、探测算法、运行状态挡住了才清空。 */
  const revealSelected = () => {
    const sel = selectedBatch;
    if (origin && sel.some(r => !hasSource(r, origin))) setOrigin((['mined', 'fish', 'library', 'turing', 'pre-entry'] as const).find(o => sel.every(r => hasSource(r, o))) ?? '');
    if (month && sel.some(r => signalMonthKey(r.source.timeMs) !== month)) setMonth('');
    if (query.trim() && sel.some(r => !r.source.symbol.toUpperCase().includes(query.trim().toUpperCase()))) setQuery('');
    if (activeAlgorithms.length && sel.some(r => !activeAlgorithms.includes(r.detectorId ?? ''))) setAlgorithmsState([]);
    if (runState) setRunState('');
    resetScroll();
  };
  const outsideHint = outsideSelection && <span className="inline-flex flex-wrap items-center gap-1" data-testid="quality-outside-selection">{selectedCount === 0 ? <>勾选的 {outsideSelection.count} 条都在当前筛选外</> : <>筛选外另有 {outsideSelection.count} 条已勾选</>}（{outsideSelection.text}）
    <button type="button" className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20" onClick={revealSelected}>切到包含勾选的筛选</button></span>;
  const { setScope } = state;
  useLayoutEffect(() => { setScope?.(sortedRows.map(r => r.id)); }, [setScope, sortedRows]);
  const selectedEntryCount = new Set(scopedSelected.map(r => r.signalId ?? r.id)).size;
  const rowSelected = (row: QualityTableRow) => qualityTableMembers(row).every(member => selectedIds.has(member.id));
  // 【用户要求】2026-11-02 像 Excel 那样：每行左侧有行号（选中的行号高亮），底部显示已选行数
  const selectedRowCount = rows.filter(rowSelected).length;
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
  // 【用户要求】2026-11-03 批量挖掘的数据显示挖掘时间（真实物理时间，挖到这条信号的那一刻）：表里有挖掘库记录时才多这一列
  const showMinedAt=rows.some(row=>qualityTableMinedAt(row)!=null);
  const columnWidths=[184,144,152,...(showMinedAt?[152]:[]),80,80,...(hideFilter?[]:[128,144,112]),...shownFilters.map(()=>176),...shownPlans.flatMap(p=>[312,128,128,128,128,128,...Array(sellErrorOpen.has(p.id)?5:1).fill(128),...Array(postExitOpen.has(p.id)?10:1).fill(128)]),40];
  const rowLayoutKey=JSON.stringify([entryExpanded,labelExpanded,sellErrorExpanded,postExitExpanded,detectorExpanded,plans.map(p=>p.id)]),priorRowLayout=useRef(rowLayoutKey),pendingTableScroll=useRef<{top:number;left:number}>();
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
    const el=tableRef.current;if(!el)return;
    if(pendingTableScroll.current){const saved=pendingTableScroll.current;pendingTableScroll.current=undefined;el.scrollTop=saved.top;el.scrollLeft=saved.left;}
    const top=el.scrollTop,left=el.scrollLeft,header=el.querySelector('thead')?.getBoundingClientRect().height??0;
    const rendered=[...el.querySelectorAll<HTMLElement>('tbody tr[data-testid="quality-fish-row"]')];
    const changed=priorRowLayout.current!==rowLayoutKey;priorRowLayout.current=rowLayoutKey;
    // Reset natural heights only for an explicit column expansion/collapse. Doing
    // this on every scroll briefly shrinks the document and clamps its scrollTop.
    if(changed)for(const row of rendered)row.style.height=`${ROW_PX}px`;
    const measured=Math.max(changed?ROW_PX:rowPx,...rendered.map(row=>Math.ceil(row.offsetHeight)));
    for(const row of rendered)row.style.height=`${measured}px`;
    if(measured!==rowPx){
      const nextTop=top<=header?top:header+(top-header)/rowPx*measured;
      pendingTableScroll.current={top:nextTop,left};setRowPx(measured);setScrollTop(nextTop);
    }else if(changed){el.scrollTop=top;el.scrollLeft=left;}
    if(el.clientHeight>0&&el.clientHeight!==viewPx)setViewPx(el.clientHeight);
  },[open,rows,rowPx,viewPx,Math.floor(scrollTop/rowPx),rowLayoutKey,study.results,study.entryReadings]);
  const first = Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / rowPx) - OVERSCAN));
  const last = Math.min(rows.length, Math.max(first + 1, Math.ceil((scrollTop + viewPx) / rowPx) + OVERSCAN));
  // 【用户要求】2026-11-03 导出时先把组合表的全部行渲染出来，按页面上的样子读取，读完恢复只渲染可见行
  const [exportAll, setExportAll] = useState(false);
  const visible = exportAll ? rows : rows.slice(first, last), padTop = exportAll ? 0 : first * rowPx, padBottom = exportAll ? 0 : (rows.length - last) * rowPx;

  // 评估先算屏幕上看得见的行，再按表格顺序往下
  const { setPriority } = state;
  useEffect(() => { setPriority?.([...visible.flatMap(qualityTableMembers), ...rows.flatMap(qualityTableMembers)].map(r => r.signalId ?? r.id)); }, [setPriority, rows, first, last]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeSort = (key: SortKey) => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(TEXT_KEYS.has(key)); } resetScroll(); };
  const arrow = (key: SortKey) => sort === key ? ascending ? ' ↑' : ' ↓' : '';
  const ariaSort = (key: SortKey) => sort === key ? ascending ? 'ascending' as const : 'descending' as const : 'none' as const;
  const sortButton = (k: SortKey, label: string) => <button type="button" className="hover:text-foreground" onClick={() => changeSort(k)} aria-label={`按${label}排序`}>{label}{arrow(k)}</button>;
  const selectRunState = (complete: boolean) => {
    // Replace the selection, so hidden previously checked rows cannot join this batch.
    state.setSelectedRows(qualitySelectRunState(runScopeRows, runStatuses, runStage, complete));
    setRunState(complete ? 'done' : 'pending'); selectAnchor.current = null; resetScroll();
  };
  const runPicker = (children: ReactNode) => <Popover><PopoverTrigger asChild>{children}</PopoverTrigger><PopoverContent align="start" className="w-72 space-y-3 p-3 text-[11px]" data-testid="quality-run-state-picker">
    <p className="font-medium">运行状态与批量选取</p>
    <label className="flex items-center justify-between gap-2">工作步骤<select aria-label="运行状态的工作步骤" className={field} value={runStage} onChange={e => {setRunStage(e.target.value as QualityRunStage); resetScroll();}}><option value="filter">买前过滤</option><option value="monitor">持仓监测</option></select></label>
    <label className="flex items-center justify-between gap-2">显示范围<select aria-label="筛选运行状态" className={field} value={runState} onChange={e => {setRunState(e.target.value as QualityRunStateFilter); resetScroll();}}><option value="">全部状态</option><option value="pending">尚未运行（{runCounts.pending}）</option><option value="done">已经运行（{runCounts.done}）</option></select></label>
    <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-3"><button type="button" disabled={!ready || !runCounts.pending} className="rounded-md bg-primary/10 px-2 py-2 text-primary hover:bg-primary/20 disabled:opacity-40" onClick={() => selectRunState(false)}>仅选尚未运行</button><button type="button" disabled={!ready || !runCounts.done} className="rounded-md bg-muted/50 px-2 py-2 hover:bg-muted disabled:opacity-40" onClick={() => selectRunState(true)}>仅选已经运行</button></div>
    <button type="button" disabled={!ready || !selectedEntryCount} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => {state.setSelectedRows([]); selectAnchor.current = null;}}>清空全部勾选</button>
    <p className="text-[10px] leading-relaxed text-muted-foreground">批量选取按当前来源、月份、标的和探测筛选，覆盖全部匹配记录，并替换之前的勾选。已运行指当前条件下有效结果齐全；部分完成或缺数据仍可补算。未配置的步骤单列为“未设置”。</p>
  </PopoverContent></Popover>;
  const exportRows = () => { setError(''); setExportAll(true); };
  useLayoutEffect(() => {
    if (!exportAll) return;
    try {
      const table = tableRef.current?.querySelector('table');
      if (!table) throw new Error('组合表还没显示，无法导出');
      const anySelected = rows.some(rowSelected), picked = anySelected ? rows.filter(rowSelected) : rows;
      const members = [...new Map(picked.flatMap(qualityTableMembers).map(m => [m.id, m])).values()], detailPlans = shownPlans.length ? shownPlans : plans;
      downloadQualityComparison(study, rows.flatMap(qualityTableMembers), Date.now(), [
        readQualityTableSheet(table, { selectedOnly: anySelected }),
        qualityPlanDetailSheet(detailPlans),
        qualityTradeDetailSheet(members, detailPlans, (m, p) => qualityRowResult(study, m, p, resultMap)),
      ]);
    } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setExportAll(false); }
  }, [exportAll]); // eslint-disable-line react-hooks/exhaustive-deps
  const body=<section ref={rootRef} className="min-w-0 border-t border-border/50 px-4 py-3" aria-labelledby={titleId} data-testid={archiveView?"quality-archive-board":"fish-quality"}>
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5"><h3><button id={titleId} type="button" className={fishSectionHeading} aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)}><Gauge aria-hidden className="h-3 w-3 text-muted-foreground"/><span>{archiveView?'归档运行结果':'鱼质量'}</span>{archiveView&&<FishCount n={countSignals(allRows)}/>}<ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button></h3>
        <button type="button" aria-label="鱼质量说明" title="鱼质量说明" className={fishInfoTrigger} onClick={() => setManualOpen(true)}><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button>
      </div>
      <div className="flex flex-wrap items-center gap-1">{!archiveView&&<FishLibraryDataButton/>}<button type="button" className={button} disabled={!rows.length} onClick={exportRows} aria-label="导出鱼质量数据"><Download className="h-3 w-3"/>导出数据</button></div>
    </div>
    <FishQualityManual open={manualOpen} onOpenChange={setManualOpen}><><p>点「开始过滤」独立计算买入条件：在捕捞过程右侧查看各指标读数和是否满足条件。读数取买入时刻之前最后一根已收盘 K 线；修改门槛复用已有读数。</p><p>设置卖出算法后，可比较同一批信号的收益，再固定一套卖出规则，比较各探测算法。</p><p>批量挖掘、买前过滤和持仓监测可同时独立运行，各自暂停。点「开始监测」后在后台运行：按开始时的勾选和参数计算，切换选项或页面不会中断；已算完且条件没变的结果直接沿用，只补算缺的和改过的；要全部重算，点「开始监测」右侧的 ▾ 选「从头重新计算」（先将全部现有运行结果独立归档到监测库，保存完成后再重算；时间目录内按当时条件展示，同条件重复重算也各自保留）。改了买入过滤会复用已有结果，修改卖出参数只保存设置并暂停旧参数任务；全部调整完成后，点击「开始监测」按最新参数运行。</p><p>信号库、图灵杯、鱼舱、挖掘库独立并行，均可进入过滤与监测；同标的、同信号时间和入场时间的记录合并显示，保留全部来源。删除一个来源不影响另两个库；有其他来源的下游结果继续保留。信号库和图灵杯按信号时间买入，图灵杯的研究使用独立的离线 K 线。</p><p>历史鱼按捕捞时刻入场（不用信号时间：那是事后才知道会持续下去的起点），实时新鱼按实际发现时点入场；随后首根 1 分钟 K 线开盘价近似买入。已有历史样本按此口径重新评估，卖出规则保留。</p><p>收益未扣手续费、资金费和滑点。未卖出持仓单独标记；缺数据不计为零收益。探测分组可以重叠，组间盈亏不相加。</p><p>同一标的、同一信号时间默认合并一行；打开「探测值」或「探测算法」表头的展开开关后，每个算法与当次保存的探测值各占一行；探测值位于评分之后。不同买入记录的结果显示范围；合并行勾选覆盖全部明细，展开后可单独勾选。</p><p>原捕获记录与旧版规则保留；本次两套卖出试验独立计算，公式冻结，均使用原始值。</p></></FishQualityManual>
    {open && <div id={contentId} className="mt-2 space-y-2">
      {!archiveView&&<div className={fishRail} aria-label="鱼质量工作模块" data-testid="quality-modules">
        {mining && <FishMiningPanel mining={mining} onJump={onJump} canJump={canJump} onSelectInTable={ready && state.selectMiningRecords ? signals => {
          const result = state.selectMiningRecords!(signals);
          if (!result.selected) return false;
          setOrigin('mined'); setQuery(''); setMonth(''); setAlgorithmsState([]); setRunState('');
          setSort('mined-at'); setAscending(false); selectAnchor.current = null; resetScroll();
          setError(result.selected < result.requested ? `有 ${result.requested - result.selected} 个入场记录暂未在组合表找到。` : '');
          return true;
        } : undefined} sellFixed={!!study.sellPlans?.some(p => p.id === study.selectedSellId && hasQualityExit(p))} campaignHref="/journal/campaigns?section=quality"/>}
        <FishQualityModule title="买前过滤" icon={Filter} testId="quality-filter-controls" trailing={<QualityResultTools kind="filter" hidden={hideFilter} onToggle={() => toggleHidden('filter')} count={study.filterReadings?.length ?? 0} onClear={state.clearFilterResults} disabled={!ready}/>} summary={<FishQualityInfo label="买前过滤说明"><p>{filterCount ? `${filterCount} 条买入条件` : '未设买入条件'}</p><p className="text-muted-foreground">{state.preEntry ? '从已勾选信号起点向后筛选；全部条件首次同时满足时停止并保存到入选库。点击开始筛选可继续暂停的轮次，右侧 ▾ 可从头重新筛选。读数只使用已收盘 K 线，沿用设置的方向和阈值。' : '对已勾选信号独立判断买入条件；读数取买入时刻前最后一根已收盘 K 线。修改门槛复用已有读数。'}</p></FishQualityInfo>} status={!state.preEntry && state.filterProgress && <p role="status" aria-live="polite" className="inline-flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${state.filterRunning ? 'animate-pulse bg-primary' : 'bg-muted-foreground/50'}`}/>{state.filterRunning ? '过滤中' : state.filterError ? '过滤未完成' : state.filterProgress.done === state.filterProgress.total ? '过滤完成' : '上轮已暂停'}</span><span className="font-mono tabular-nums">{state.filterProgress.done} / {state.filterProgress.total}</span></p>}>
          {state.preEntry ? <FishPreEntryMonitor state={state} selectedCount={selectedCount} filtersOn={filtersOn} onJump={onJump}
            renderConditions={done => <BuyFilterEditor key={JSON.stringify(standaloneBuyFilters(study))} state={state} done={done} scan/>}
            legacyActions={<><button type="button" className={button} disabled={!state.filterRunning && (!ready || !selectedCount || !filtersOn)} onClick={() => state.filterRunning ? state.cancelFilter() : void state.startFilter()}>{state.filterRunning ? '暂停原时点过滤' : '仅检查原买入时点'}</button><FishFilterLibrary study={study}/>{state.filterError && <p role="alert" className="text-[10px] text-destructive">{state.filterError}</p>}</>}
            onSelected={() => { setOrigin('pre-entry'); setQuery(''); setMonth(''); setAlgorithmsState([]); setRunState(''); setOpen(true); resetScroll(); }}/>
            : <>
          {state.filterRunning
            ? <button type="button" className={qualityPauseAction} onClick={state.cancelFilter}><Pause aria-hidden className="h-3 w-3"/>暂停过滤</button>
            : <button type="button" className={qualityPrimaryAction} disabled={!ready || !selectedCount || !filtersOn} title={!filtersOn ? '先设置并启用买入过滤条件' : selectedCount ? `对当前筛选下已勾选的 ${selectedCount} 条信号计算买入条件，不运行卖出监测；已完成的有效读数直接复用，只补算缺的` : '当前筛选下没有已勾选的信号'} onClick={() => void state.startFilter()}><Filter aria-hidden className="h-3 w-3"/>{state.filterError?'重试缺数据':state.filterProgress&&state.filterProgress.done<state.filterProgress.total?'继续过滤':'开始过滤'}</button>}
          {/* 【用户要求】2026-10-28 旁边已有「条件设置」，原「未设置过滤条件 · 点此设置」等行内提示纯属重复，已删除；为何不能开始见按钮悬停 */}
          {state.filterError && <p role="alert" className="text-[11px] text-destructive">{state.filterError}</p>}
          <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><button type="button" className={`${button} w-[5.5rem] shrink-0 whitespace-nowrap justify-center ${filtersOn ? 'text-foreground' : ''}`} aria-label="买入过滤条件" title={filtersOn ? activeStandaloneBuyFilters(study).map(f=>`${f.label} ${f.direction} ${f.threshold}`).join(' 且 ') : '设置独立的买前过滤条件'}><Settings2 className="h-3 w-3"/>条件设置</button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-[34rem] max-w-[calc(100vw-2rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain pb-0">
            <BuyFilterEditor key={JSON.stringify(standaloneBuyFilters(study))} state={state} done={() => setFilterOpen(false)}/>
          </PopoverContent></Popover>
          <FishFilterLibrary study={study}/>
          </>}
        </FishQualityModule>
        <FishQualityModule title="持仓监测" icon={Activity} testId="quality-run-controls" trailing={<QualityResultTools kind="monitor" hidden={hideMonitor} onToggle={() => toggleHidden('monitor')} count={study.results.length} onClear={state.clearMonitorResults} disabled={!ready || !!state.archiving}/>} titleTestId="quality-mode" summary={<FishQualityInfo label="持仓监测说明"><p>100 USDT · 1 倍</p>{vetoCount > 0 && <p>{vetoCount} 项监测条件</p>}<p className="text-muted-foreground">按已勾选信号和当前卖出规则独立监测，支持后台运行；已算完且条件没变的结果直接沿用；要全部重算，点「开始监测」右侧的 ▾。归档按时间排列，后续重算不会覆盖本次快照。</p></FishQualityInfo>} status={running ? <p role="status" aria-live="polite" className="inline-flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"/>监测中</span><span className="font-mono tabular-nums">{progress?.done ?? 0} / {progress?.total ?? 0}</span></p> : lastPause && <p className="max-w-[22rem] truncate text-muted-foreground" data-testid="quality-last-pause" title={`上一轮于 ${formatUTC8(lastPause.at)}（UTC+8）暂停：${lastPause.reason}`}>已暂停：{lastPause.reason}</p>}>
          {/* 【用户要求】2026-10-27 把「重新开始」做进「开始监测」：主按钮照常开始 / 暂停，右侧 ▾ 里「从头重新计算」 */}
          <div role="group" aria-label="监测运行" className="inline-flex h-6 shrink-0 items-stretch">
            {running
              ? <button type="button" className={qualitySplitPauseAction} onClick={state.cancel}><Pause aria-hidden className="h-3 w-3"/>暂停监测</button>
              : <button type="button" className={qualitySplitPrimaryAction} disabled={!ready || !!state.archiving || !selectedCount || !plans.length} title={!selectedCount && outsideSelection ? `勾选的 ${outsideSelection.count} 条都在当前筛选外（${outsideSelection.text}）：点筛选栏右侧「切到包含勾选的筛选」` : selectedCount ? `对当前筛选下已勾选的 ${selectedCount} 条信号在后台运行，切换选项或收起模块不会中断；已算完且条件没变的结果直接沿用` : '当前筛选下没有已勾选的信号'} onClick={() => void state.start()}><RefreshCw aria-hidden className="h-3 w-3"/>开始监测</button>}
            <Popover open={runMenuOpen} onOpenChange={setRunMenuOpen}><PopoverTrigger asChild><button type="button" aria-label="开始监测的其他方式" disabled={!ready || !!state.archiving || !selectedCount || !plans.length} className={`${qualitySplitMenuAction} ${running ? 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}><ChevronDown aria-hidden className="h-3 w-3"/></button></PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-1"><button type="button" aria-label="从头重新计算" className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted" disabled={!!state.archiving} onClick={() => { setRunMenuOpen(false); void state.restart(); }}><span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>从头重新计算</span><span className="text-[10px] leading-relaxed text-muted-foreground">先将当前全部结果独立归档到监测库，再按最新勾选和卖出条件全部重算{running ? '；先停止当前批次' : ''}。归档按时间排列，后续重算不会覆盖本次快照</span></button></PopoverContent></Popover>
          </div>
          <Popover open={monitorOpen} onOpenChange={setMonitorOpen}><PopoverTrigger asChild><button type="button" className={`${qualitySettingsAction} ${vetoCount > 0 ? 'text-foreground' : ''}`} aria-label="持仓监测条件" title={vetoCount ? plans.map(p => `${p.label}：${activeHoldingVetoes(p.holdingVetoes).length} 条原始否决${p.vetoStages?.length?` · ${p.vetoStages.length} 个一票次数阶段`:''}${p.sellStages?.length?` · ${p.sellStages.length} 个卖出次数阶段`:''}${p.mirrorTakeProfit?.enabled ? ` · 镜像止盈 ${p.mirrorTakeProfit.gainPct}% / ${p.mirrorTakeProfit.sellPct}%` : ''}`).join('\n') : '选择和编辑卖出算法、条件加仓、镜像止盈与持仓否决'}><Settings2 className="h-3 w-3"/>条件设置</button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-[46rem] max-w-[calc(100vw-2rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain pb-0">
            <HoldingMonitorSettings state={state} activeId={monitorPlanId} onSelect={setMonitorPlanId} done={() => setMonitorOpen(false)} selectedCount={selectedCount} outsideHint={!selectedCount ? outsideHint : null}/>
          </PopoverContent></Popover>
          <FishMonitorLibrary study={study} loadArchive={state.loadMonitorArchive} onSetHidden={state.setMonitorEntryHidden} onCopyStudy={state.restoreMonitorStudy?async(snapshot,sourceRoundId)=>{const copied=await state.restoreMonitorStudy!(snapshot,sourceRoundId);if(copied){setOrigin('');setQuery('');setMonth('');setAlgorithmsState([]);setRunState('');setOpen(true);resetScroll();}return copied;}:undefined} onJump={onJump} canJump={canJump} onOpenCampaign={rememberReturn} renderStudy={snapshot=><ArchivedQualityBoard study={snapshot} onJump={onJump} canJump={canJump}/>}/>
        </FishQualityModule>
      </div>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="relative shrink-0"><select aria-label="鱼质量的来源" title="同一信号可能属于多个来源，各来源计数可能重叠；全部来源按信号去重。" className={`${field} appearance-none pr-6`} value={origin} onChange={e => { setOrigin(e.target.value as QualityReturnUi['origin']); resetScroll(); }}><option value="">全部来源（{countSignals(batch)}）</option><option value="library">信号库（{countSignals(batch.filter(r=>hasSource(r,'library')))}）</option><option value="turing">图灵杯（{countSignals(batch.filter(r=>hasSource(r,'turing')))}）</option><option value="pre-entry">入选库（{countSignals(batch.filter(r=>hasSource(r,'pre-entry')))}）</option><option value="fish">鱼舱（{countSignals(batch.filter(r=>hasSource(r,'fish')))}）</option><option value="mined">挖掘库（{countSignals(batch.filter(r=>hasSource(r,'mined')))}）</option></select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <span className="relative shrink-0"><select aria-label="鱼质量的月份" title="按信号发生月份筛选。可在挖掘库按实际挖掘日期搜索，再带到组合表。" className={`${field} appearance-none pr-6 font-mono`} value={month} onChange={e => { setMonth(e.target.value); resetScroll(); }}><option value="">全部月份（{countSignals(narrowed)}）</option>{months.map(m => <option key={m} value={m}>{m}（{monthCounts.get(m) ?? 0}）</option>)}</select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        {/* 【用户要求】2026-11-02 「探测算法」与「监测 · 状态」筛选在表头（探测算法列、运行状态列）已有，筛选栏不再重复 */}
        <input aria-label="筛选鱼质量信号" placeholder="筛选标的…" value={query} onChange={e => { setQuery(e.target.value); resetScroll(); }} className={`${field} min-w-32 flex-1 placeholder:text-muted-foreground/50`}/>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1 text-[10.5px] text-muted-foreground" data-testid="quality-selection-scope"><span className="tabular-nums" data-testid="quality-run-scope">{selectedCount === selectedTotal ? `本轮处理已勾选 ${selectedCount} 条` : <>本轮处理 <span className="text-foreground">{selectedCount}</span> 条 · </>}</span>{outsideHint}<FishQualityInfo label="处理范围说明"><p>开始筛选、开始监测只处理当前筛选（来源、月份、探测算法、标的）下已勾选的信号，筛选外勾着的这一轮不处理。</p><p className="text-muted-foreground">已勾选 {selectedEntryCount} 次入场。开始时冻结勾选清单，之后调整勾选用于下一轮。</p></FishQualityInfo></div>
      </div>
      {state.archiving&&<p role="status" className="text-[11px] text-primary" data-testid="quality-archive-saving">正在归档全部运行结果到监测库…保存完成后开始重算。</p>}
      {state.entry&&(state.entry.running||state.entry.error)&&<div className="flex items-center gap-3 text-[10px] text-muted-foreground" data-testid="quality-entry-progress"><span>入场读数 {state.entry.progress?.done??0}/{state.entry.progress?.total??0}</span>{state.entry.running?<button type="button" className="text-primary hover:underline" onClick={state.entry.cancel}>暂停入场补算</button>:<button type="button" className="text-primary hover:underline" onClick={()=>state.entry?.request(plans.map(p=>p.id),visible.flatMap(qualityTableMembers).map(r=>r.signalId??r.id),true)}>重试入场读数</button>}{state.entry.error&&<span className="text-destructive">{state.entry.error}</span>}</div>}
      {!archiveView&&observationPlanIds.length>0&&<div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground" data-testid="quality-post-exit-progress"><span>卖后反事实 · 以实际最终卖出价为基准 · 0.5 / 1 / 2 / 4 / 6h</span>{state.postExit?.running?<><span role="status">补算 {state.postExit.progress?.done??0}/{state.postExit.progress?.total??0}</span><button type="button" className="text-primary hover:underline" onClick={state.postExit.cancel}>暂停反事实</button></>:<button type="button" className="text-primary hover:underline" onClick={()=>requestObservations(true)}>补算 / 重试反事实</button>}{state.postExit?.error&&<span className="text-destructive">{state.postExit.error}</span>}</div>}
      {!ready && <p role="status" className="text-[10.5px] text-muted-foreground">恢复本机记录…</p>}
      {(error || state.warning || state.error) && <p role="alert" className="text-[11px] text-destructive">{error || state.error || state.warning}</p>}
      {/* 表格到达上下边界后，滚轮自然交给「渔」面板，避免只能移到表格外才能继续滚动。 */}
      <h4 className="text-xs font-medium text-foreground" data-testid="quality-combination-title">组合表</h4>
      {rows.length ? <div ref={tableRef} onScroll={e => {const next=e.currentTarget.scrollTop;setScrollTop(current=>current===next?current:next);}} className="max-h-[28rem] overflow-auto overscroll-x-contain overscroll-y-auto rounded-lg border border-border/60 [overflow-anchor:none]" aria-label="组合表" data-testid="quality-fish-table"><table className="table-fixed border-separate border-spacing-0 whitespace-nowrap text-left text-[10px]" style={{width:columnWidths.reduce((sum,width)=>sum+width,0),minWidth:'100%'}}><colgroup>{columnWidths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead className="sticky top-0 z-20 bg-background text-[9px] font-medium text-muted-foreground">
          <tr className="bg-muted/35" data-testid="quality-algorithm-categories">
            {/* 【用户要求】2026-11-02 探测值、探测算法、捕捞过程、过滤读数和入场读数都归「买前过滤」；「卖出算法」改名「持仓监测」 */}
            <th colSpan={showMinedAt?6:5} className="px-2 py-1.5 text-[9px] font-normal text-muted-foreground/70">入场信息</th>
            {!hideFilter && <><th colSpan={3+shownFilters.length} className="relative border-l border-border/40 px-2 py-1.5 pr-8 font-medium" aria-label="过滤类别统计" data-testid="quality-filter-group">买前过滤<QualityStatisticsButton label="全部过滤算法" onClick={() => setStatistics({category:'filter'})}/></th></>}
            {shownPlans.length > 0 && <th colSpan={qualitySellSpan(shownPlans,postExitOpen,sellErrorOpen)} className="relative border-l border-border/40 px-2 py-1.5 pr-8 font-medium" aria-label="卖出类别统计" data-testid="quality-monitor-group">持仓监测<QualityStatisticsButton label="全部卖出算法" onClick={() => setStatistics({category:'sell'})}/></th>}
            <th aria-hidden="true"/>
          </tr>
          <tr className="bg-muted/20" data-testid="quality-algorithm-variables">
            <th colSpan={showMinedAt?6:5} className="px-2 py-1 text-[9px] font-normal text-muted-foreground/50">变量 / 水平</th>
            {!hideFilter && <><th aria-hidden="true" className="border-l border-border/40"/>
            <th className="relative px-2 py-1 pr-8 font-normal text-muted-foreground/60" aria-label="探测变量数量">{detectorChoices.length ? `${detectorChoices.length} 个默认算法` : ''}<QualityStatisticsButton label="全部探测算法" onClick={() => setStatistics({category:'detect'})}/></th>
            <th aria-hidden="true"/></>}
            {qualityVariables(shownFilters.map(c => c.filter)).map(v => <th key={v.id} colSpan={v.levels.length} className="relative border-l border-border/40 px-2 py-1.5 pr-8 font-normal" aria-label={`过滤变量 ${v.label}`}>{v.label}{v.levels.length > 1 && <span className="ml-2 text-muted-foreground/50">{v.levels.length} 个水平</span>}<QualityStatisticsButton label={`过滤变量 ${v.label}`} onClick={() => setStatistics({category:'filter',variableId:v.id})}/></th>)}
            {!hideMonitor && sellVariables.map(v => <th key={v.id} colSpan={qualitySellSpan(v.levels,postExitOpen,sellErrorOpen)} className="relative border-l border-border/40 px-2 py-1.5 pr-8 font-normal" aria-label={`卖出变量 ${v.label}`}>{v.label}{v.levels.length > 1 && <span className="ml-2 text-muted-foreground/50">{v.levels.length} 个水平</span>}<QualityStatisticsButton label={`卖出变量 ${v.label}`} onClick={() => setStatistics({category:'sell',variableId:v.id})}/></th>)}
            <th aria-hidden="true"/>
          </tr>
          <tr className="bg-muted/40">
          <th className={`${cell} sticky left-0 z-30 min-w-[184px] bg-muted font-medium`} aria-sort={ariaSort('symbol')}><span className="flex items-center gap-2"><span aria-hidden className="w-6 shrink-0"/><input type="checkbox" aria-label="全选当前筛选信号" title="全选当前筛选下的所有行；按住 Shift 点两行可连续选择" checked={allSelected} ref={el => { if (el) el.indeterminate = selectedRows.length > 0 && !allSelected; }} disabled={!ready} onChange={e => selectVisible(e.target.checked)} className="h-3 w-3 accent-[hsl(var(--primary))]"/>{sortButton('symbol', '标的')}</span></th>
          <th className={`${cell} min-w-[110px] font-medium`} aria-sort={ariaSort('run')} data-testid="quality-run-state-column" title="左为买前过滤、右为持仓监测：1 = 已运行，0 = 未运行（红色为缺数据）；悬停单元格看明细"><span className="flex items-center gap-2">{sortButton('run', '运行状态')}{runPicker(<button type="button" aria-label="在表头筛选运行状态" className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"><Filter className="h-3 w-3"/></button>)}</span><span className={`${RUN_STATE_GRID} mt-0.5 text-[9px] font-normal text-muted-foreground/60`} data-testid="quality-run-state-parts"><span>过滤</span><span>监测</span></span></th>
          <th className={`${cell} min-w-[140px] font-medium`} aria-sort={ariaSort('time')}>{sortButton('time', '信号时间')}</th>
          {showMinedAt && <th className={`${cell} min-w-[140px] font-medium`} data-testid="quality-mined-at-column" aria-sort={ariaSort('mined-at')} title="批量挖掘挖到这条信号时的真实时间（UTC+8）；不是挖掘的历史档位，也不是信号时间。同一入场有多次挖掘时显示最近一次。">{sortButton('mined-at', '挖掘时间')}</th>}
          <th className={`${cell} font-medium`} aria-sort={ariaSort('market')}>{sortButton('market', '市场')}</th>
          <th className={`${cell} font-medium`} aria-sort={ariaSort('quality')}>{sortButton('quality', '评分')}</th>
          {!hideFilter && <><th className={`${cell} border-l border-border/40 font-medium ${detectorExpanded ? 'min-w-[190px]' : 'min-w-[110px]'}`} data-testid="quality-detector-value-column" aria-sort={ariaSort('detector-value')} title="当次探测快照的读数，按捕获时的倍率显示；展开后每个探测算法各占一行"><span className="inline-flex items-center gap-2">{sortButton('detector-value', '探测值')}<button type="button" aria-label="展开探测值明细" aria-expanded={detectorExpanded} onClick={() => expandDetectors(!detectorExpanded)} className="inline-flex items-center gap-1 text-primary hover:underline">{detectorExpanded ? '收起' : '展开'}<ChevronDown className={`h-3 w-3 ${detectorExpanded ? 'rotate-180' : ''}`}/></button></span></th>
          <th className={`${cell} relative min-w-[260px] pr-8 font-medium`} data-testid="quality-detector-column" aria-sort={ariaSort('detector')}><QualityStatisticsButton label="探测算法水平" onClick={() => setStatistics({category:'detect'})}/><span className="inline-flex items-center gap-2">{sortButton('detector', '探测算法')}{groups.length > 0 && <DetectorPicker choices={detectorChoices} signalsOf={signalsOf} selected={activeAlgorithms} onChange={setAlgorithms}><button type="button" aria-label="在表头选择探测算法" title={chosenChoices.length ? chosenChoices.map(choiceText).join('、') : '选择一个或多个探测算法'} className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 ${activeAlgorithms.length ? 'bg-primary/15 text-primary' : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground'}`}><Filter className="h-3 w-3"/>{chosenChoices.length > 0 && <span className="font-mono text-[10px] tabular-nums">{chosenChoices.length}</span>}</button></DetectorPicker>}<button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" aria-label="展开探测算法明细" aria-expanded={detectorExpanded} onClick={() => expandDetectors(!detectorExpanded)}>{detectorExpanded ? '收起' : '展开'}<ChevronDown className={`h-3 w-3 ${detectorExpanded ? 'rotate-180' : ''}`}/></button></span></th>
          <th className={`${cell} min-w-[80px] font-medium`} aria-sort={ariaSort('process')} title="按捕捞时刻排序；信号库在最后">{sortButton('process', '捕捞过程')}</th></>}
          {shownFilters.map(column => <th key={column.id} className={`${cell} relative min-w-[180px] border-l border-border/40 pr-8 font-medium`} data-testid="quality-filter-column" aria-sort={ariaSort(`filter:${column.id}`)} title="买入时刻之前最后一根已收盘 K 线的读数；独立过滤，不限制卖出监测。"><QualityStatisticsButton label={`过滤水平 ${column.filter.label} ${column.filter.direction} ${column.filter.threshold}`} onClick={() => setStatistics({category:'filter',variableId:qualityVariableKey(column.filter.snapshot,column.filter.metric),levelId:column.id})}/><button type="button" className="block text-left hover:text-foreground" aria-label={`按过滤${column.filter.label} ${column.filter.direction} ${column.filter.threshold}读数排序`} onClick={() => changeSort(`filter:${column.id}`)}>过滤 · {column.filter.label}{arrow(`filter:${column.id}`)}</button><span className="mt-0.5 block font-mono text-primary">{column.filter.direction} {column.filter.threshold}</span></th>)}
          {shownPlans.map(p => <Fragment key={p.id}><th className={`${cell} relative min-w-[180px] border-l border-border/40 pr-12 font-medium`} data-testid="quality-sell-column" aria-sort={sort === `sell:${p.id}` ? ascending ? 'ascending' : 'descending' : 'none'}>{/* 【用户要求】2026-11-01 三栏名称与「静态最大回撤」等同一行：方案名在上方变量行已有，规则改到右上角设置图标 */}<QualityStatisticsButton label={`卖出水平 ${p.label} ${ruleText(p)}`} onClick={() => setStatistics({category:'sell',variableId:p.combo ? `combo:${p.id}` : qualityVariableKey(p.snapshot,p.metric),levelId:p.id})}/><Popover><PopoverTrigger asChild><button type="button" className="absolute right-6 top-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40" disabled={archiveView} aria-label={`设置${p.label}卖出算法`} title={`卖出算法：${ruleText(p)}${study.selectedSellId === p.id ? '（已固定，用于比较探测算法）' : ''}`}>{study.selectedSellId === p.id ? <Check aria-hidden className="h-3 w-3 text-primary"/> : <Settings2 aria-hidden className="h-3 w-3"/>}</button></PopoverTrigger><PopoverContent align="start" className="w-80">{p.combo ? <ComboSellEditor key={`${p.id}:${JSON.stringify([p.rule, p.combo])}`} plan={p} state={state}/> : <SellEditor key={`${p.id}:${JSON.stringify(p.rule)}`} plan={p} state={state}/>}</PopoverContent></Popover><span className={`${SELL_PARTS} font-medium`} data-testid="quality-sell-parts"><button type="button" className="text-left hover:text-foreground" aria-label={`按${p.label}加仓次数排序`} onClick={()=>changeSort(`addition:${p.id}`)}>加仓次数{arrow(`addition:${p.id}`)}</button><button type="button" className="text-left hover:text-foreground" title="与交易战役同口径：几何仓位 M＝(1 − αf) × ∏(1 + αₖ)，αf 为首次加仓前已卖出的首仓比例（半仓镜像），αₖ＝第 k 次加仓币数 ÷ 加仓前持币数；没有加仓时已卖出的计入镜像，仍持有的记 1。" aria-label={`按${p.label}几何仓位排序`} onClick={()=>changeSort(`geometric:${p.id}`)}>几何仓位{arrow(`geometric:${p.id}`)}</button><button type="button" className="text-left hover:text-foreground" title="与交易战役同口径：G＝(F − Kₘ) ÷ (E − K初)，F 最终卖出价、Kₘ 最后一次加仓的止损线、E 首次买入价、K初 由硬性终止的静态回撤得出；只算有加仓且已卖出的持仓。" aria-label={`按${p.label}相对涨幅排序`} onClick={()=>changeSort(`relative:${p.id}`)}>相对涨幅{arrow(`relative:${p.id}`)}</button><button type="button" className="text-left hover:text-foreground" title="与交易战役同口径：盈亏比＝已实现净盈亏 ÷ 初始最大预期亏损 L₀，单位 R；L₀＝初始仓位 × 硬性终止的静态回撤%；只算已卖出的持仓。" aria-label={`按${p.label}盈亏比排序`} onClick={()=>changeSort(`payoff:${p.id}`)}>盈亏比{arrow(`payoff:${p.id}`)}</button></span></th>{phase === 'sell' && <><th className={`${cell} min-w-[110px] font-medium`} aria-sort={ariaSort(`static:${p.id}`)} title="相对买入价到持仓最低价的最大跌幅，至少为 0%。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}静态最大回撤排序`} onClick={()=>changeSort(`static:${p.id}`)}>静态最大回撤{arrow(`static:${p.id}`)}</button></th><th className={`${cell} min-w-[110px] font-medium`} aria-sort={ariaSort(`peak:${p.id}`)} title="与交易战役同口径：持仓期间相对买入价的最大有利价格涨幅，读取该轮冻结结果；不等于组合收益。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}峰值涨幅排序`} onClick={()=>changeSort(`peak:${p.id}`)}>峰值涨幅{arrow(`peak:${p.id}`)}</button></th><th className={`${cell} min-w-[120px] font-medium`} data-testid="quality-price-change-header" aria-sort={ariaSort(`price-change:${p.id}`)} title="与交易战役「首仓涨跌幅」同口径：（最终卖出价 ÷ 首次买入价 − 1）×100%，首仓从买入到实际完成卖出的涨跌幅。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}首仓涨幅排序`} onClick={()=>changeSort(`price-change:${p.id}`)}>首仓涨幅{arrow(`price-change:${p.id}`)}</button></th><th className={`${cell} min-w-[135px] font-medium`} aria-sort={ariaSort(`mirror:${p.id}`)} title="开仓至镜像止盈成交时的实际涨幅 =（镜像成交价 ÷ 开仓价 − 1）× 100%；不乘卖出比例，不含余仓后续涨跌。未触发不记作零涨幅。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}半仓镜像实际涨幅排序`} onClick={()=>changeSort(`mirror:${p.id}`)}>半仓镜像{arrow(`mirror:${p.id}`)}</button></th></>}{/* 【用户要求】2026-11-02 持仓监测里的「探测标签」删除（买前过滤已有） */}{phase === 'sell' && <th className={`${cell} min-w-[84px] font-medium`} aria-sort={ariaSort(`held:${p.id}`)} title="买入到卖出的时长；还在持有的算到最近一次估值。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}持仓时间排序`} onClick={() => changeSort(`held:${p.id}`)}>持仓时间{arrow(`held:${p.id}`)}</button></th>}<SellErrorHeaders plan={p} expanded={sellErrorOpen.has(p.id)} toggle={()=>toggleSellError(p.id)} sort={sort} ascending={ascending} onSort={changeSort}/><PostExitHeaders plan={p} expanded={postExitOpen.has(p.id)} toggle={()=>togglePostExit(p.id)} sort={sort} ascending={ascending} onSort={changeSort}/></Fragment>)}
          <th className={`${cell} font-medium`} aria-label="跳转"/>
        </tr></thead><tbody>{padTop > 0 && <tr aria-hidden style={{ height: padTop }}/>}{visible.map((row, vi) => <tr key={row.id} style={{ height: rowPx }} className="group hover:bg-accent/30" data-testid="quality-fish-row">
          <td className={`${cell} sticky left-0 z-10 border-t border-border/40 bg-background font-mono group-hover:bg-accent`} title={`${(isTuringCupSymbol(row.source.symbol) ? '离线行情' : EXCHANGE_NAMES[row.source.exchange ?? 'binance'])} · 来源：${qualitySourceLabel(row)}`}><span className="inline-flex items-center gap-2"><span className={`w-6 shrink-0 select-none text-right text-[9px] tabular-nums ${rowSelected(row) ? 'font-medium text-primary' : 'text-muted-foreground/55'}`} data-testid="quality-row-number">{first + vi + 1}</span><input type="checkbox" aria-label={`选择 ${row.source.symbol} ${date(row.source.timeMs)}${row.detectorId ? ` ${detectorMap.get(row.detectorId)?.label} ${detectorMap.get(row.detectorId)?.snapshot.threshold}` : detectorExpanded ? ' 信号库' : ' 合并信号'}`} title="按住 Shift 点另一行可连续选择" checked={rowSelected(row)} ref={el => { if (el) el.indeterminate = !rowSelected(row) && qualityTableMembers(row).some(member => selectedIds.has(member.id)); }} disabled={!ready} onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }} onChange={e => toggleRow(row.id, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/><button type="button" aria-label={`查看 ${row.source.symbol} 盘面`} title={`查看 ${row.source.symbol} 在 ${date(row.source.timeMs)} 的盘面`} disabled={!onJump || !!canJump && !canJump(row.source)} onClick={() => onJump?.(row.source)} className="rounded-sm text-left transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:no-underline disabled:hover:text-inherit">{turingCupTicker(row.source.symbol)}</button>{row.source.turingReplaySample && <span className="font-sans text-[9px] text-muted-foreground" title="图灵杯行情的模拟入场点">回放样本</span>}</span>{!isTuringCupSymbol(row.source.symbol) && row.source.exchange && row.source.exchange !== 'binance' && <span className="ml-1 font-sans text-[9px] text-muted-foreground">{EXCHANGE_NAMES[row.source.exchange]}</span>}</td>
          <td className={`${cell} border-t border-border/40`} data-testid="quality-run-state-cell"><span className={RUN_STATE_GRID}>{(['filter','monitor'] as const).map(stage => { const status = qualityRowRunStatus(row, runStatuses)[stage], text = qualityRunStatusText(status);
            // 【用户要求】2026-11-01 运行状态只显示 0 和 1（已运行 1、其余 0，缺数据的 0 标红）；「过滤 / 监测」字样挪到表头，进度和完整状态只在悬停说明与读屏标签里
            return <span key={stage} className={`font-mono text-[11px] leading-[14px] tabular-nums ${status.complete ? 'text-emerald-600 dark:text-emerald-400' : text === '缺数据' ? 'text-destructive' : 'text-muted-foreground'}`} title={`${stage === 'filter' ? '买前过滤' : '持仓监测'}：${text}。${qualityRunStatusDetail(status)}`} data-run-stage={stage} data-run-state={!status.total ? 'unset' : status.complete ? 'done' : 'pending'} aria-label={text}>{status.complete ? '1' : '0'}</span>; })}</span></td>
          <td className={`${cell} border-t border-border/40 font-mono text-muted-foreground`} title={`模拟买入：${date(row.enteredAt)}（${row.basis === 'detected' ? '实际发现' : row.basis === 'capture' ? '捕捞时刻' : row.basis === 'missing' ? '时间缺失' : isLibrary(row) ? qualitySourceLabel(row) + '信号时间' : '原始信号'}）`}>{date(row.source.timeMs)}</td>
          {showMinedAt && (() => { const at = qualityTableMinedAt(row); return <td className={`${cell} border-t border-border/40 font-mono text-muted-foreground`} data-testid="quality-mined-at-cell" title={at ? `挖掘档位：${date(row.enteredAt)}` : '不是批量挖掘的记录'}>{at ? date(at) : '—'}</td>; })()}
          <td className={`${cell} border-t border-border/40 text-muted-foreground`}>{row.source.market === 'us_stock' ? '美股' : ''}</td>
          <td className={`${cell} border-t border-border/40`}><span className="flex gap-px" aria-label={`评分 ${normalizeSignalQuality(row.source.quality) ?? 0} 星`}>{[1, 2, 3, 4, 5].map(i => <Star key={i} className={`h-3 w-3 ${i <= (normalizeSignalQuality(row.source.quality) ?? 0) ? 'fill-[#F0B90B] text-[#F0B90B]' : 'text-muted-foreground/35'}`}/>)}</span></td>
          {!hideFilter && <><td className={`${cell} border-l border-t border-border/40`} data-testid="quality-detector-value-cell">{!detectorExpanded ? (() => { const count = qualityTableMembers(row).filter(member => member.detectorId).length; return count ? <button type="button" className="text-primary hover:underline" title="展开每个探测算法在发现此信号时保存的读数" onClick={() => expandDetectors(true)}>{count} 项 · 展开</button> : <span className="text-muted-foreground/60" title="信号库的信号没有探测读数">—</span>; })() : (() => { const reading = qualityDetectorReading(row); return <span className="inline-flex items-center gap-2" title={reading.detail}><span className="font-mono tabular-nums">{reading.text}</span>{row.detectorId && <span className="text-[9px] text-muted-foreground/65">{reading.label}</span>}</span>; })()}</td>
          <td className={`${cell} border-t border-border/40 text-muted-foreground`} data-testid="quality-detector-cell" data-detector-id={row.detectorId ?? ''} title={row.detectorId ? `${detectorMap.get(row.detectorId)?.metric} · ${detectorMap.get(row.detectorId)?.snapshot.interval ?? '5m'} · 公式版本 ${row.detectorId}` : '导入的信号不归属探测算法'}>{!detectorExpanded && row.groups.length > 0 ? <button type="button" className="text-primary hover:underline" onClick={() => expandDetectors(true)} title="展开此列表的探测算法与各次买入记录">{row.groups.length} 个算法 · 展开</button> : row.detectorId ? <span className="inline-flex items-center gap-2"><span>{detectorMap.get(row.detectorId)?.label ?? '探测算法'}</span><span className="font-mono text-muted-foreground/70">{detectorMap.get(row.detectorId)?.snapshot.direction ?? '>'} {detectorMap.get(row.detectorId)?.snapshot.threshold}</span></span> : '—'}</td>
          <td className={`${cell} border-t border-border/40`}>{isLibrary(row) ? <span className="text-muted-foreground/60">—</span> : <FishProcessButton signal={row.source}/>}</td></>}
          {shownFilters.map(column => { const reading = qualityFilterCell(row, column.filter, filterReadingMap); return <td key={column.id} className={`${cell} border-l border-t border-border/40`} data-testid="quality-filter-cell" data-filter-state={reading.state} title={reading.detail}><span className="inline-flex items-center gap-2"><span className="font-mono tabular-nums">{reading.value}</span><span className={`text-[9px] ${reading.state === 'pass' ? 'text-emerald-600 dark:text-emerald-400' : reading.state === 'fail' ? 'text-destructive' : 'text-muted-foreground'}`}>{reading.status}</span></span></td>; })}
          {shownPlans.map(p => { const entries = [...new Map(qualityTableMembers(row).map(member => [member.signalId ?? member.id, member])).values()];
            if(entries.length > 1) return <Fragment key={p.id}><MergedEntryCells entries={entries.map(member => ({result:qualityRowResult(study,member,p,resultMap),skipped:skippedBy(p,member)}))} phase={phase} planId={p.id} plan={p} expand={() => expandDetectors(true)}/><SellErrorCells plan={p} expanded={sellErrorOpen.has(p.id)} entries={entries.map(member=>({row:member,result:qualityRowResult(study,member,p,resultMap),skipped:!!skippedBy(p,member)}))} readings={postExitReadings} onExpand={()=>toggleSellError(p.id)}/><PostExitCells plan={p} expanded={postExitOpen.has(p.id)} entries={entries.map(member=>({row:member,result:qualityRowResult(study,member,p,resultMap),skipped:!!skippedBy(p,member)}))} readings={postExitReadings} onExpand={()=>togglePostExit(p.id)}/></Fragment>;
            const f = skippedBy(p, row), skipped = f && f.state !== 'pass', result = qualityRowResult(study,row,p,resultMap);
            return <Fragment key={p.id}><td className={`${cell} border-l border-t border-border/40`}>{skipped ? <span className="text-[9px] text-muted-foreground/60" title={f.detail}>{f.state === 'fail' ? '未买入' : f.state === 'pending' ? '待判断' : '买入过滤缺数据'}</span> : filtersOn && !hasQualityExit(p) ? <span className="text-[9px] text-muted-foreground/60">待设卖出</span> : <ResultCell plan={p} result={result} section="sell" onClick={() => setDetailId(qualityTableMembers(row)[0].id)} onOpenCampaign={rememberReturn}/>}</td>{phase === 'sell' && <><td className={`${cell} border-t border-border/40 font-mono tabular-nums ${!skipped && (qualityDrawdownPct(result,'static')??0)>0?'text-destructive':'text-muted-foreground'}`} data-testid="quality-static-drawdown" data-sell-plan={p.id}>{pct(skipped?null:qualityDrawdownPct(result,'static')).replace(/^\+/, '')}</td><td className={`${cell} border-t border-border/40 font-mono tabular-nums ${signed(skipped?null:qualityPeakPct(result))}`} data-testid="quality-peak-gain" data-sell-plan={p.id} title={skipped?f.detail:'持仓价格路径的峰值涨幅，与该笔交易战役读取同一份结果'}>{pct(skipped?null:qualityPeakPct(result))}</td><QualitySalePriceChangeCell plan={p} entries={[{result,skipped}]}/><td className={`${cell} border-t border-border/40`} data-testid="quality-half-mirror" data-sell-plan={p.id}><QualityHalfMirrorCell plan={p} result={result} skipped={skipped?f.detail:undefined}/></td></>}{phase === 'sell' && <td className={`${cell} border-t border-border/40 font-mono tabular-nums ${result?.status === 'open' ? 'text-foreground/80' : 'text-muted-foreground'}`} data-testid="quality-held-time" data-sell-plan={p.id} title={skipped ? f.detail : result?.status === 'open' ? '仍在持有：算到最近一次估值' : result?.reason}>{skipped || !(result?.status === 'closed' || result?.status === 'open') ? '—' : heldText(result.heldHours)}</td>}<SellErrorCells plan={p} expanded={sellErrorOpen.has(p.id)} entries={entries.map(member=>({row:member,result:qualityRowResult(study,member,p,resultMap),skipped:!!skippedBy(p,member)}))} readings={postExitReadings} onExpand={()=>toggleSellError(p.id)}/><PostExitCells plan={p} expanded={postExitOpen.has(p.id)} entries={[{row,result,skipped:!!skipped}]} readings={postExitReadings} onExpand={()=>togglePostExit(p.id)}/></Fragment>; })}
          <td className={`${cell} border-t border-border/40`}><button type="button" aria-label={`跳转 ${row.source.symbol}`} disabled={!onJump || !!canJump && !canJump(row.source)} onClick={() => onJump?.(row.source)} className="text-primary disabled:opacity-30"><ArrowRightCircle className="h-3.5 w-3.5"/></button></td>
        </tr>)}{padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}/>}</tbody></table></div> : <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10.5px] text-muted-foreground">{allRows.length ? <>没有匹配的标的。{emptyByDetector && <span className="ml-1" data-testid="quality-empty-detector-filter">表头「探测算法」筛选{chosenChoices.length ? `（${chosenChoices.map(choiceText).join('、')}）` : ''}把它们全滤掉了{isSignalLibraryOrigin(origin) ? '：' + QUALITY_SOURCE_NAMES[origin] + '自己的信号没有探测算法' : ''}。<button type="button" className="ml-1 text-primary hover:underline" onClick={() => setAlgorithms([])}>清除探测算法筛选</button></span>}{!emptyByDetector && emptyByRunState && <span className="ml-1" data-testid="quality-empty-run-state">表头「运行状态」只显示{runState === 'done' ? '已经运行' : '尚未运行'}的信号。<button type="button" className="ml-1 text-primary hover:underline" onClick={() => { setRunState(''); resetScroll(); }}>显示全部状态</button></span>}</> : '暂无可评估的信号。捕捞到的鱼、信号库和图灵杯的信号会自动加入。'}</div>}
      {rows.length > 0 && <p className="text-right text-[10px] tabular-nums text-muted-foreground" data-testid="quality-row-count">{selectedRowCount > 0 && <span className="font-medium text-primary" data-testid="quality-selected-row-count">已选 {selectedRowCount} 行 · </span>}共 {rows.length} 行 · {countSignals(rows)} 条信号{!detectorExpanded ? ' · 已合并探测明细' : ''}{sortedRows.length < batch.length ? `（筛选自 ${countSignals(batch)} 条信号）` : ''}</p>}
    </div>}
    {statistics && <FishQualityStatistics key={`${statistics.category}:${statistics.variableId ?? ''}:${statistics.levelId ?? ''}`} study={study} rows={sortedRows} request={statistics} onClose={() => setStatistics(null)}/>}
    <RowDetail row={allRows.find(r => r.id === detailId)} state={state} close={() => setDetailId('')}/>
  </section>;
  return <QualityArchiveContext.Provider value={archiveView}>{archiveView?body:<FishLibraryDataManager key={state.account??mining?.account??'anonymous'} account={state.account??mining?.account} study={study} ready={ready}>{body}</FishLibraryDataManager>}</QualityArchiveContext.Provider>;
}

/** Reuse the live table's renderer; only selection/filter/expansion state is local to the viewer. */
function ArchivedQualityBoard({study,onJump,canJump}:{study:FishQualityStudy;onJump?:(s:TradeSignal)=>void;canJump?:(s:TradeSignal)=>boolean}){
 const [selection,setSelection]=useState(study.selectedRowIds??[]);
 const state=useMemo(()=>{const noop=()=>{},asyncNoop=async()=>{};return {study:{...study,selectedRowIds:selection},ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:asyncNoop,restart:asyncNoop,cancel:noop,startFilter:asyncNoop,cancelFilter:noop,clearFilterResults:noop,clearMonitorResults:noop,setRule:noop,setCombo:noop,setObserveHours:noop,selectSell:noop,setSelectedRows:(ids:readonly string[])=>setSelection([...ids]),setPriority:noop,setScope:noop,setFilters:noop,setHoldingVetoes:noop,setSellPlans:noop} satisfies FishQualityState;},[study,selection]);
 return <FishQuality archiveView state={state} onJump={onJump} canJump={canJump}/>;
}
