import { isAutomaticPreEntryRound } from '@/lib/fish/preEntryMonitor';
import { FishWorkspaceRows, FishWorkspaceSource, fishSourceButton } from './FishWorkspaceSource';
import { Database, Save, Trash2 } from 'lucide-react';
import {FishCombinationHelp} from './FishCombinationHelp';
import {HOLDING_LEDGER_ADDITION_VERSION} from '@/lib/fish/qualityHoldingLedger';
import {FishConditionSettings} from './FishConditionSettings';
import {SettingsImageButton,useSettingsImageCapture} from './SettingsImageExport';
import {mergeLibraryDirectoryEdits} from '@/lib/fish/libraryDirectoryEdits';
import { qualityMonitorEntryAt, qualityMonitorTimeLabels, qualityRowMonitorTimeBasis, qualitySignalTime, type QualityMonitorTimeBasis } from '@/lib/fish/qualityAdmissionTime';
import {ScreeningHeaders,ScreeningCells,type ScreeningSortKey} from './FishQualityScreeningResults';
import {qualityScreeningResults,screeningResultIndex,screeningRowResults,screeningCell} from '@/lib/fish/qualityScreeningResults';
import {FishQualitySourcePicker} from './FishQualitySourcePicker';
import {latestEntryDirectory,sourceDirectoryKeys,sourceDirectoryIds,matchesMiningDirectory,type QualitySourceDirectory} from '@/lib/fish/qualitySourceDirectories';
import type {FishDirectoryRequest} from './FishLibraryTimeDirectory';
import { FishPreEntryMonitor } from './FishPreEntryMonitor';
import { FishInstantTrading } from './FishInstantTrading';
import { FishScreened } from './FishScreened';
import { prepareQualityRouterDraft } from '@/lib/fish/qualityRouterDraft';
import { isRaceRouter, raceAttackFromRound, routerNextOrdinal, routerOrdinal, routerPrefixText } from '@/lib/fish/qualityPlanRouter';
import type { SellPlansDraftView } from './FishQualitySellPlansEditor';
import { FishQualityMonitorSettingsView } from './FishQualityMonitorSettingsView';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { ADDITION_VETO_LABELS, type AdditionEntryVetoKind } from '@/lib/fish/qualityAdditionVeto';
import { activeQualityPlanTemplates } from '@/lib/fish/qualityPlanTemplates';
import { readQualityTableSheet,downloadQualityTableSheet } from '@/lib/fish/qualityTableExport';
import {validateQualitySellStages} from '@/lib/fish/qualitySellStages';
import type {VetoStagesDraft} from './FishQualityVetoStagesEditor';
import {validateQualityVetoStages} from '@/lib/fish/qualityVetoStages';
import {qualityOrigins,qualitySourceLabel,QUALITY_SOURCE_NAMES,isSignalLibraryOrigin,type QualityOrigin} from '@/lib/fish/qualitySources';
import { QualitySalePriceChangeCell } from './FishQualityTradeReadings';
import { qualityEntryKey,qualityEntryParts,validEntryReading } from '@/lib/fish/qualityEntry';
import { qualityDetectorLabel } from '@/lib/fish/qualityDetectorLabel';
import { PostExitHeaders, PostExitCells, type PostExitSortKey } from './FishQualityPostExit';
import { qualityPostExitKey, postExitValue } from '@/lib/fish/qualityPostExit';
import { FishQualityManual } from '@/components/FishQualityManual';
import { FishPopoverContent as PopoverContent } from '@/components/FishPopoverContent';
import { qualityDetectorReading } from '@/lib/fish/qualityDetectorReading';
import { defaultQualityAddition, qualityAdditionFills } from '@/lib/fish/qualityAddition';
import { FishQualityAdditionEditor, additionDraft, parseAdditionDraft, parseAdditionSellStages } from '@/components/FishQualityAdditionEditor';
import { FishQualitySellPlansEditor } from './FishQualitySellPlansEditor';
import {recoverableQualityPlans,readSavedQualityPlans} from '@/lib/fish/qualitySavedPlans';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { qualitySalePriceChangePct, qualityPeakPct, qualityHalfMirror, qualityAdditionSummary, qualityRelativeGain, qualityRelativeGainText, qualityPayoffRatio, qualityPayoffRatioText, qualityGeometricPosition, qualityGeometricPositionText } from '@/lib/fish/qualityPresentation';
import { FishQualityMirrorEditor, mirrorDraft, parseMirrorDraft } from '@/components/FishQualityMirrorEditor';
import { defaultQualityMirror, validateQualityMirror } from '@/lib/fish/qualityMirror';
import { qualityVariables } from '@/lib/fish/qualityVariables';
import { Fragment,useCallback,createContext,useContext,useId, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { FishQualityHoldingVetoEditor } from '@/components/FishQualityHoldingVetoEditor';
import { qualityExitAlgorithmLabel, qualityStaticDrawdownReason } from '@/lib/fish/qualityStaticDrawdownSell';
import { activeHoldingVetoes, holdingVetoIdentity } from '@/lib/fish/qualityVeto';
import { qualityCampaignPath } from '@/lib/campaignSections';
import { hasQualityCampaign } from '@/lib/fish/qualityCampaignArchive';
import { Activity, ArrowRightCircle, ChevronDown, CircleHelp, Download, Eraser, Eye, EyeOff, Filter, Gauge, Lock, Pause, Plus, RefreshCw, RotateCcw, Settings2, Star, X } from 'lucide-react';
import type {FishQualityStudy} from '@/lib/fish/quality';
import type { FishQualityState } from '@/hooks/useFishQuality';
import type { FishMiningApi } from '@/hooks/useFishMining';
import { FishMiningPanel } from '@/components/FishMiningPanel';
import { FishMonitorLibrary } from '@/components/FishMonitorLibrary';
import { FishFilterLibrary } from '@/components/FishFilterLibrary';
import { FishQualityProgress } from '@/components/FishQualityProgress';
import { fishInfoTrigger, fishRail, fishSectionHeading, FishCount } from './FishSection';
import { FishQualityInfo, FishQualityModule, FishQualityModuleGroup, qualitySplitPauseAction, qualitySplitPrimaryAction, qualitySplitMenuAction, qualitySettingsAction } from '@/components/FishQualityModule';
import { FishProcessButton } from '@/components/FishProcess';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { normalizeSignalQuality, signalMonthKey, type TradeSignal } from '@/lib/signalLibrary';
import {SignalQualityStars} from './SignalQualityStars';
import {toast} from '@/lib/notificationCenter';
import { isTuringCupSymbol, turingCupTicker } from '@/lib/turingCupSymbol';
import { isDelayedTuringReplaySample } from '@/lib/turingReplaySamples';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { hasQualityExit, qualityEntryIdentity, standaloneBuyFilters, activeStandaloneBuyFilters, activeBuyFilters, anyBuyFilters, qualityDrawdownPct, qualityDisplayRows, qualityFilterReadingKey, qualityFilterStatus, type QualityBuyFilter, type QualityFilterStatus, type QualityGroup, type QualityResult, type QualitySample, qualityRuleText } from '@/lib/fish/quality';
import { holdingVetoDraft, planHoldingVetoDraft, parseHoldingVetoDraft, makeQualityBuyFilter, makeQualitySignalMetrics, qualityFilterChoiceKey, qualityFilterDefinitions, qualityFilterMenuChoices } from '@/lib/fish/qualityFilters';
import { additionMetricTime, withAdditionMetricTime, withMetricSnapshotTime, type AdditionMetricTime } from '@/lib/fish/qualityAdditionMetric';
import { FishMetricTimeFields } from './FishMetricTimeFields';
import { shortFishHash } from '@/lib/fish/algorithm';
import { qualityResultMap, qualityRowResult } from '@/lib/fish/qualityComparison';
import { qualityFilterCell, qualityFilterColumns, qualityFilterValue } from '@/lib/fish/qualityFilterColumns';
import { signalReadingCell, signalReadingKey, type QualitySignalMetric } from '@/lib/fish/qualitySignalReadings';
import { rangeSelect } from '@/lib/listRangeSelect';
import { collapseQualityTableRows, qualityTableCaptureTime, qualityTableMembers, qualityTableRange, qualityTableSignalKey, type QualityTableRow } from '@/lib/fish/qualityTableRows';
import { defaultQualityDetectorIds, qualityDetectorChoices, type QualityDetectorChoice } from '@/lib/fish/qualityDetectorSelection';
import { ancestorScrolls, applyAncestorScrolls, currentHistoryEntry, finishQualityReturn, FROM_FISH_QUALITY, pendingQualityReturn, saveQualityReturn, type QualityReturnUi } from '@/lib/fish/qualityReturn';

const field = 'h-7 min-w-0 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60';
const button = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
const cell = 'px-1.5 py-1';
const wrapCell = 'whitespace-normal [overflow-wrap:anywhere]';
const countSignals = (rows: readonly QualitySample[]) => new Set(rows.map(qualityTableSignalKey)).size;
const pct = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const signed = (v?: number | null) => v == null ? '' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '';
const date = (v?: number | null) => v ? formatUTC8(v) : '—';
const ruleText = (plan: QualityGroup) => qualityRuleText(plan);
const isLibrary = (row: QualitySample) => isSignalLibraryOrigin(row.origin);
/** Mirror execution and detector labels always occupy independent columns. */
/** Original seller columns plus an independent post-sale group: folded=1 column, expanded=10. 2026-11-01 删掉镜像平衡减仓后重复的「加仓次数」列（卖出列里已有）；2026-11-02 入场读数挪到「买前过滤」，7 列。 */
const qualitySellSpan = (plans: readonly QualityGroup[],expanded:ReadonlySet<string>) => plans.reduce((n,p)=>n+6+(expanded.has(p.id)?10:1),0);
const hasSource = (row: QualitySample,source:QualityOrigin) => qualityOrigins(row).includes(source);
// 【用户反馈】2026-10-26「表头显示 793，但表中完全没这么多」：原来每页 50 条、框只有约 9 行高，要翻 16 页。
// 只渲染可见窗口；数据行统一高度，遇到多行内容时只增高，不用新窗口首行反向缩小估计。
// 否则启动监测 / 结果更新后，33px 与 40px 的首行可能交替出现，形成布局更新死循环。
const ROW_PX = 33, TABLE_PX = 448, OVERSCAN = 12;
// 【用户要求】2026-10-26「鱼质量中的所有表头都要能够排序」：空值（未评估、无评分等）不论升降都排在最后
type SortKey = `signal-value:${string}` | `addition:${string}` | `entry:${string}` | `price-change:${string}` | `label:${string}` | PostExitSortKey | ScreeningSortKey | 'time' | 'mined-at' | 'symbol' | 'market' | 'quality' | 'process' | 'detector' | 'detector-value' | `filter:${string}` | `sell:${string}` | `static:${string}` | `peak:${string}` | `mirror:${string}` | `held:${string}` | `relative:${string}` | `payoff:${string}` | `geometric:${string}`;
const TEXT_KEYS = new Set(['symbol', 'market', 'detector']);
/** 持仓时间：不到 1 小时写分钟，两天内写小时，再长写天。 */
export function heldText(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} 分钟`;
  if (hours < 48) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}
const resultText = (r?: QualityResult) => r?.status === 'closed' ? '已卖出' : r?.status === 'open' ? '持有' : r?.status === 'error' ? '缺数据' : r?.status === 'waiting' && r.entryPrice ? '待设卖出' : '待评估';

type FilterDraft = { choice: string; direction: '<' | '>'; threshold: string; enabled: boolean; saved?: QualityBuyFilter; time?: AdditionMetricTime };
type SignalMetricDraft = { key: string; saved?: QualitySignalMetric; time?: AdditionMetricTime };

function BuyFilterEditor({ state, done, selectedCount }: { state: FishQualityState; done: () => void; selectedCount: number }) {
  const definitions = useFeatureDefinitions();
  const choices = useMemo(() => qualityFilterMenuChoices(definitions), [definitions]);
  const filterDefinitions = useMemo(() => qualityFilterDefinitions(definitions), [definitions]);
  const readingDefinitions = useMemo(() => qualityFilterDefinitions(definitions, true), [definitions]);
  const groups = [...new Set(choices.map(choice => choice.group))];
  const signalChoices = useMemo(() => qualityFilterMenuChoices(definitions, true), [definitions]);
  const signalGroups = [...new Set(signalChoices.map(choice => choice.group))];
  const savedFilters = standaloneBuyFilters(state.study);
  const [draft, setDraft] = useState<FilterDraft[]>(() => savedFilters.map(saved => ({
    choice: qualityFilterChoiceKey(saved), direction: saved.direction, threshold: String(saved.threshold), enabled: saved.enabled, saved, time:additionMetricTime(saved.snapshot),
  })));
  const [readingDraft, setReadingDraft] = useState<SignalMetricDraft[]>(() => (state.study.signalMetrics ?? []).map(saved => ({
    key: qualityFilterChoiceKey(saved), saved, time:additionMetricTime(saved.snapshot),
  })));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const configured = readingDraft.length > 0 || draft.some(row => row.enabled);
  const canSave = state.ready && !!(readingDraft.length || draft.length || state.study.signalMetrics?.length || savedFilters.length);
  const busy = saving || state.filterRunning || state.signalValues?.running;
  const patch = (index: number, updates: Partial<FilterDraft>) =>
    setDraft(previous => previous.map((row, i) => i === index ? {...row, ...updates} : row));
  const add = () => setDraft(previous => [...previous, {
    choice: choices.find(choice => choice.key === 'state:state')?.key ?? choices[0]?.key ?? '',
    direction: '>', threshold: '0.7', enabled: true,
  }]);
  const apply = async (run: boolean) => {
    setSaving(true);
    try {
      const filters = draft.map(row => {
        const {saved} = row;
        if (!row.threshold.trim() || !Number.isFinite(Number(row.threshold))) throw Error('每条条件都要填有限数字门槛');
        if (saved && qualityFilterChoiceKey(saved) === row.choice) {
          const threshold=Number(row.threshold);
          const timed=withAdditionMetricTime(saved,row.time);
          if (timed===saved && saved.direction===row.direction && saved.threshold===threshold && saved.enabled===row.enabled) return saved;
          return { ...timed, enabled:row.enabled, direction:row.direction, threshold,
            id:'buy-'+shortFishHash(JSON.stringify([row.choice,row.direction,threshold,timed.snapshot.definitionKey,timed.snapshot.interval])),
            snapshot:{...timed.snapshot,direction:row.direction,threshold} };
        }
        return withAdditionMetricTime(makeQualityBuyFilter(row.choice, row.direction, Number(row.threshold), row.enabled, definitions),row.time);
      });
      const newMetrics = makeQualitySignalMetrics(readingDraft.filter(row => !row.saved).map(row => row.key), definitions);
      const resolved = new Map(newMetrics.map(metric => [qualityFilterChoiceKey(metric), metric]));
      const metrics = readingDraft.map(row => {
        const original=row.saved ?? resolved.get(row.key)!;
        const timed=withMetricSnapshotTime(original,row.time);
        return timed===original ? original : {...timed,id:shortFishHash(JSON.stringify([row.key,timed.snapshot.definitionKey,timed.snapshot.interval]))};
      });
      const updatedFilters = filters.length !== savedFilters.length || filters.some((filter, i) => filter !== savedFilters[i]) ? filters : undefined;
      if (state.saveStaticSettings) {
        if (!await state.saveStaticSettings(metrics, updatedFilters)) throw Error('设置尚未保存，请重试');
      } else if (updatedFilters) state.setFilters(updatedFilters);
      done();
      if (run) void (state.runStaticSettings ?? state.startFilter)();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设置无效');
    } finally {
      setSaving(false);
    }
  };
  const moduleClass = 'space-y-3 rounded-lg border border-border/70 bg-background/45 p-3.5';
  return <div className="space-y-3" data-testid="quality-buy-filter-editor">
    {state.saveStaticSettings && <section className={moduleClass} aria-label="信号时点读数">
      <header className="flex items-start gap-2.5">
        <Activity aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"/>
        <div><h4>信号时点读数</h4><p className="text-muted-foreground">按原信号时间读取算法数值，每个算法在组合表中占一列。</p></div>
      </header>
      <select aria-label="添加信号读数算法" className={field + ' w-full'} value="" onChange={event => {
        const key = event.target.value;
        if (key) setReadingDraft(previous => [...previous, {key}]);
      }}>
        <option value="">添加算法（可多选）</option>
        {signalGroups.map(group => <optgroup key={group} label={group}>
          {signalChoices.filter(choice => choice.group === group).map(choice => <option key={choice.key} value={choice.key}
            disabled={readingDraft.some(row => row.key === choice.key)}>{choice.label}</option>)}
        </optgroup>)}
      </select>
      {!!readingDraft.length && <ul aria-label="已选读数算法" className="flex flex-wrap gap-2">
        {readingDraft.map((row, index) => {
          const label = row.saved?.label ?? signalChoices.find(choice => choice.key === row.key)?.label ?? row.key;
          return <li key={row.saved?.id ?? row.key} className="flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border/65 bg-muted/50 py-1 pl-2 pr-1">
            <span className="min-w-0 break-words">{label}</span><button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={'移除信号读数列 ' + label} onClick={() => setReadingDraft(previous => previous.filter((_, i) => i !== index))}><X aria-hidden className="h-3.5 w-3.5"/></button>
            {row.key.includes(':guard-distance-atr-') ? <span className="text-muted-foreground">K 线周期 5m</span> :
              <FishMetricTimeFields label={`信号读数 ${index+1}`} metric={row.saved?.metric ?? signalChoices.find(choice=>choice.key===row.key)?.metric}
                definition={readingDefinitions.get(row.key.split(':')[0])} snapshot={row.saved?.snapshot} time={row.time}
                onChange={time=>setReadingDraft(previous=>previous.map((item,i)=>i===index?{...item,time}:item))}/>}
          </li>;
        })}
      </ul>}
    </section>}
    <section className={moduleClass} aria-label="买前过滤">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <Filter aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"/>
          <div><h4>买前过滤</h4><p className="text-muted-foreground">每条条件按所选周期读取买入前最后一根已收盘的 K 线，全部启用条件满足即通过。</p></div>
        </div>
        <button type="button" className={button + ' shrink-0 border border-border/70 bg-background'} disabled={!choices.length} onClick={add}><Plus aria-hidden className="h-3.5 w-3.5"/>添加条件</button>
      </header>
      {!draft.length && <p className="pl-[26px] text-muted-foreground">未设置过滤条件</p>}
      {draft.length > 0 && <div className="space-y-2">{draft.map((row, i) => <div key={i} className="fish-static-condition items-center gap-2">
        <input type="checkbox" aria-label={'启用买入条件 ' + (i + 1)} checked={row.enabled} onChange={event => patch(i, {enabled: event.target.checked})}/>
        <select aria-label={'买入条件 ' + (i + 1) + ' 指标'} className={field} value={row.choice} onChange={event => patch(i, {choice: event.target.value,saved:undefined,time:undefined})}>
          {!choices.some(choice => choice.key === row.choice) && <option hidden disabled value={row.choice}>{row.saved?.label ?? row.choice}</option>}
          {groups.map(group => <optgroup key={group} label={group}>{choices.filter(choice => choice.group === group).map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</optgroup>)}
        </select>
        <select aria-label={'买入条件 ' + (i + 1) + ' 方向'} className={field} value={row.direction} onChange={event => patch(i, {direction: event.target.value as '<' | '>'})}><option value=">">&gt;</option><option value="<">&lt;</option></select>
        <input aria-label={'买入条件 ' + (i + 1) + ' 门槛'} type="number" step="any" className={field} value={row.threshold} onChange={event => patch(i, {threshold: event.target.value})}/>
        <button type="button" aria-label={'删除买入条件 ' + (i + 1)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setDraft(previous => previous.filter((_, index) => index !== i))}><X aria-hidden className="h-3.5 w-3.5"/></button>
        <FishMetricTimeFields label={`买入条件 ${i+1}`} className="col-span-full" metric={row.saved?.metric ?? choices.find(choice=>choice.key===row.choice)?.metric}
          definition={filterDefinitions.get(row.choice.split(':')[0])} snapshot={row.saved?.snapshot} time={row.time} onChange={time=>patch(i,{time})}/>
      </div>)}</div>}
    </section>
    <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-popover px-4 py-2.5">
      <div className="min-w-0 text-muted-foreground">
        <p>{selectedCount ? '已勾选 ' + selectedCount + ' 条信号' : '运行前请在组合表勾选信号'}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" disabled={!canSave || busy} onClick={() => apply(false)} className={button + ' border border-border bg-background text-foreground'}>保存设置</button>
        <button type="button" disabled={!canSave || !configured || !selectedCount || busy} onClick={() => apply(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">保存并运行</button>
      </div>
    </div>
  </div>;
}
/**
 * 【用户要求】2026-10-27「持仓监测中也需要一个条件设置」「持仓一票否决卖出其实隶属于持仓监测」：
 * 这套卖出方案的持仓一票否决在这里设（观察时长已于 0d3dc61c 从界面移除，不放回来）。
 */
type MonitorDraft = { addition: ReturnType<typeof additionDraft>; mirror: ReturnType<typeof mirrorDraft>; vetoes: ReturnType<typeof holdingVetoDraft>;vetoStages:VetoStagesDraft };
const monitorDraftOf = (plan: QualityGroup): MonitorDraft => ({ addition: additionDraft(plan.addition, plan.sellStages), mirror: mirrorDraft(plan.mirrorTakeProfit ?? defaultQualityMirror()), vetoes: planHoldingVetoDraft(plan.holdingVetoes),vetoStages:{enabled:!!plan.vetoStages?.length,mode:plan.vetoStageMode??'overlay',peakBasis:plan.vetoPeakBasis??'stage',stages:(plan.vetoStages??[]).map(s=>({afterAdditions:String(s.afterAdditions),conditions:holdingVetoDraft(s.conditions)}))} });
const monitorBaseKey = (plan: QualityGroup) => JSON.stringify([plan.holdingVetoes,plan.mirrorTakeProfit,plan.addition,plan.sellStages,plan.vetoStages,plan.vetoStageMode,plan.vetoPeakBasis]);
function parseMonitorDraft(draft: MonitorDraft, definitions: Parameters<typeof parseAdditionDraft>[1]) {
  const holdingVetoes = parseHoldingVetoDraft(draft.vetoes,definitions), mirrorTakeProfit = parseMirrorDraft(draft.mirror), addition = parseAdditionDraft(draft.addition,definitions), sellStages = parseAdditionSellStages(draft.addition,definitions);
  const vetoStages=draft.vetoStages.enabled?draft.vetoStages.stages.map(s=>({afterAdditions:s.afterAdditions.trim()?Number(s.afterAdditions):NaN,conditions:parseHoldingVetoDraft(s.conditions,definitions)})).sort((a,b)=>a.afterAdditions-b.afterAdditions):undefined;
  if(draft.vetoStages.enabled&&!vetoStages?.length)throw Error('请添加至少一个一票条件切换阶段');
  const staged={vetoStages,vetoStageMode:draft.vetoStages.mode,vetoPeakBasis:draft.vetoStages.peakBasis};validateQualityVetoStages({...staged,addition});
  validateQualitySellStages({sellStages,addition});validateQualityMirror(mirrorTakeProfit); return { holdingVetoes, mirrorTakeProfit, addition, sellStages,...staged };
}
function HoldingMonitorEditor({ ready, plan, draft, setDraft, save, error, allDirty, count, hideSave = false }: {
  ready: boolean; plan: QualityGroup; draft: MonitorDraft; setDraft: (draft: MonitorDraft) => void;
  save: () => void; error: string; allDirty: boolean; count: number; hideSave?: boolean;
}) {
  return <div className="space-y-3" data-testid="quality-monitor-editor" data-plan-id={plan.id}>
    <div className="flex items-center gap-1.5"><p className="text-xs font-medium">持仓监测 · {plan.label}</p><FishQualityInfo label="持仓监测说明"><p>买入之后依次是：① 组合算法（上方卡片）→ ② 镜像平衡减仓 → ③ 加仓细节 → ④ 硬性终止。各项分别保存在对应方案中；切换方案保留本次填写，保存时一起保存。</p></FishQualityInfo></div>
    <FishQualityMirrorEditor draft={draft.mirror} setDraft={mirror => setDraft({...draft,mirror})} additionEnabled={draft.addition.enabled} holdingLedger={draft.addition.positionVersion===HOLDING_LEDGER_ADDITION_VERSION}/>
    <FishQualityAdditionEditor stickyRounds draft={draft.addition} setDraft={addition => setDraft({...draft,addition})} vetoStages={draft.vetoStages} setVetoStages={vetoStages=>setDraft({...draft,vetoStages})}/>
    <section className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/[0.02] p-3" data-testid="quality-hard-stop"><div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">④ 硬性终止</h4><span className="text-[10px] text-muted-foreground">必要充分 · 任一达标即卖出全部持仓</span><FishQualityInfo label="硬性终止说明"><p>与「加仓细节 · 卖出」并列：硬性终止的任一启用条件、或某次加仓的卖出条件，任何一个先达标，都立即卖出全部仓位（含各次加仓买入的部分），不等普通卖出算法。某次加仓后另加或收紧的否决条件，在「③ 加仓细节 · 卖出」里按次设置。</p></FishQualityInfo></div>
      <FishQualityHoldingVetoEditor draft={draft.vetoes} setDraft={vetoes => setDraft({...draft,vetoes})}/>
    </section>
    {!hideSave && <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5"><SettingsImageButton/><button type="button" disabled={!ready} onClick={save} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">{allDirty ? `保存全部 ${count} 套方案` : `保存到「${plan.label}」`}</button></div>}
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
    const restoreAdditionField=<K extends keyof NonNullable<QualityGroup['addition']>>(key:K)=>{parsed.addition![key]=plan.addition![key];};
    const roundKeys = Object.keys({ ...additionDraft().otherRounds[0], time: undefined, savedCondition: undefined }).filter(k => k !== 'sellSwitch');
    const roundDraftAt = (d: MonitorDraft, i: number) => { const value = i ? d.addition.otherRounds[i - 1] : d.addition; return value ? Object.fromEntries(roundKeys.map(k => [k, value[k]])) : undefined; };
    const oldFirst = plan.addition.rounds?.[0];
    if (oldFirst && same(roundDraftAt(draft, 0), roundDraftAt(original, 0))) {
      // Preserve the first-round fields duplicated on the root addition rule as well.
      for (const key of ['source','structure','stricterPct','condition','conditions','prerequisites','indicatorIncrease','minGainPct','entryBufferAtr','supportOffsetAtr','entryDistanceAtr','gainBasis','entryVetoes','detectorPrerequisite'] as const) {
        if (plan.addition[key] === undefined) delete parsed.addition[key]; else restoreAdditionField(key);
      }
    }
    parsed.addition.rounds = parsed.addition.rounds?.map((r, i) => plan.addition!.rounds?.[i] && same(roundDraftAt(draft, i), roundDraftAt(original, i)) ? plan.addition!.rounds[i] : r);
    for (const key of ['supportReduction','geometricLock','breakevenFloor'] as const) {
      if (same(draft.addition[key], original.addition[key])) restoreAdditionField(key);
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
  const imageCapture=useSettingsImageCapture();
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
      if (!visited[key] && !imageCapture) return null;
      const original = router[key], monitorDirty = JSON.stringify(drafts[key]) !== JSON.stringify(monitorDraftOf(original));
      return <div key={key} hidden={branch !== key} data-settings-image-include="" data-testid={`router-branch-${key}`}>
        {imageCapture&&<h3 hidden data-settings-image-include="">{key==='structure'?'结构分支':'进攻分支'}</h3>}
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
function MonitorTimePicker({ trigger, onChoose, restart = false, running = false }: {
  trigger: ReactElement;
  onChoose: (basis: QualityMonitorTimeBasis) => void;
  restart?: boolean;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const choose = (basis: QualityMonitorTimeBasis) => {
    setOpen(false);
    onChoose(basis);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align="start" className="w-64 p-1" aria-label={restart ? '选择重新计算起点' : '选择监测起点'}>
      {restart && <div className="px-2 py-1 text-[11px]">
        <p className="font-medium">从头重新计算</p>
        {running && <p className="text-[10px] text-muted-foreground">选定起点后，先停止当前批次。</p>}
      </div>}
      <button type="button" aria-label="基于信号时间" className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => choose('signal')}>
        <span className="block text-[11px] font-medium">基于信号时间</span>
        <span className="block text-[10px] text-muted-foreground">从组合表的原信号时点开始</span>
      </button>
      <button type="button" aria-label="基于筛选时间" className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => choose('screening')}>
        <span className="block text-[11px] font-medium">基于筛选时间</span>
        <span className="block text-[10px] text-muted-foreground">从动态筛选首次满足的时点开始，跳过无入选时点的记录</span>
      </button>
    </PopoverContent>
  </Popover>;
}

function HoldingMonitorSettings({state,activeId,onSelect,done,selectedCount,outsideHint}:{state:FishQualityState;activeId:string|null;onSelect:(id:string)=>void;done:()=>void;selectedCount:number;outsideHint?:ReactNode}) {
  const imageCapture=useSettingsImageCapture();
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
  return <FishQualitySellPlansEditor plans={plans} ready={state.ready} onSave={state.setSellPlans} onSelectPlan={onSelect} recoverablePlans={recoverableQualityPlans(state.study,readSavedQualityPlans(state.account))} templates={state.savePlanTemplate&&state.deletePlanTemplate?{owner:state.account,restore:state.restorePlanTemplate,templates:activeQualityPlanTemplates(state.study),save:state.savePlanTemplate,remove:state.deletePlanTemplate}:undefined} onCopyPlan={(source,copy)=>{
    if(copy.router){copy.router=structuredClone(controllers.current[source.id]?.current?.build()??copy.router);return;}
    setDrafts(current=>({...current,[copy.id]:{base:monitorBaseKey(copy),draft:structuredClone(forPlan(source))}}));
  }} extraDirty={extraDirty} prepare={merge} renderHolding={view=>{
    const active=view.plans.find(p=>p.id===activeId)??view.plans[0];
    const savedPlan=plans.find(p=>p.id===active?.id);
    return <>
      <p className="mb-2 text-[10.5px] text-muted-foreground" data-testid="monitor-plan-draft-count">监测方案 {view.plans.length} 套 · 与上方按编号一一对应{view.dirty?' · 有待保存设置':''}</p>
      {view.plans.length>0&&<div role="tablist" aria-label="选择要设置持仓监测的卖出方案" className="mb-3 flex flex-wrap gap-1 rounded-md bg-muted/60 p-1 text-[10.5px]">{view.plans.map((p,i)=>{
        const d=forPlan(p),n=d.vetoes.filter(v=>v.enabled).length+(d.mirror.enabled?1:0)+(d.addition.enabled?1:0)+[d.addition,...d.addition.otherRounds].slice(0,Math.max(1,Number(d.addition.maxRounds)||1)).filter(r=>r.sellSwitch?.enabled).length+(d.vetoStages.enabled?d.vetoStages.stages.length:0);
        return <button type="button" role="tab" key={p.id} data-plan-id={p.id} aria-selected={active?.id===p.id} onClick={()=>onSelect(p.id)} className={`inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 ${active?.id===p.id?'bg-background font-medium shadow-sm':'text-muted-foreground hover:text-foreground'}`}><span className="text-muted-foreground">{i+1}.</span>{p.label}<span title="当前填写中已启用的监测条件数" className="rounded bg-primary/15 px-1 text-[9px] tabular-nums text-primary">{n} 项条件</span></button>;
      })}</div>}
      {savedPlan&&hasQualityExit(savedPlan)&&<button type="button" className={button+' mb-2'} disabled={!state.ready} aria-pressed={state.study.selectedSellId===savedPlan.id} onClick={()=>state.selectSell(savedPlan.id)}>固定此方案，比较探测算法</button>}
      {view.plans.filter(p=>p.router).map(p=><div key={p.id+':'+JSON.stringify(p.router)} hidden={active?.id!==p.id} data-settings-image-include="">
        <EditableQualityRouter plan={p} ready={state.ready} controller={controllers.current[p.id]??(controllers.current[p.id]={current:null})} onDirtyChange={setRouterDirtyFlag}/>
      </div>)}
      {active&&isLegacyQualityPlan(active)?<div className="space-y-3" data-testid="quality-monitor-legacy" data-plan-id={active.id}>
        <p className="text-xs font-medium">持仓监测 · {active.label}</p>
        <FishQualityMonitorSettingsView plan={active} holdingOnly/>
        <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5"><SettingsImageButton/><button type="button" disabled={!state.ready} onClick={()=>{if(view.save())done();}} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">{`保存全部 ${view.plans.length} 套方案`}</button></div>
        {view.error&&<p role="alert" className="text-[11px] text-destructive">{view.error}</p>}
      </div>:active?.router?<div className="contents" data-testid="quality-monitor-router-settings">
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-popover px-4 py-2.5">
          {view.error&&<p role="alert" className="w-full text-[11px] text-destructive">{view.error}</p>}
          <span className="mr-auto text-[10.5px] text-muted-foreground">{view.dirty?'方案尚未保存':'当前方案已保存'} · 本轮已勾选 {selectedCount} 条{outsideHint&&<> · {outsideHint}</>}</span>
          <SettingsImageButton/>
          <button type="button" disabled={!state.ready} onClick={()=>{if(view.save())done();}} className="h-7 rounded-md border border-primary/30 px-2.5 text-[11px] text-primary disabled:opacity-40">保存方案</button>
          <MonitorTimePicker onChoose={basis => { if (view.save()) { done(); void state.start(false, undefined, false, basis); } }}
            trigger={<button type="button" disabled={!state.ready || !selectedCount} title={selectedCount ? '选择起点后保存方案并开始监测' : '请先在组合表中勾选本轮要监测的信号'} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-40">保存并开始监测</button>}/>
        </div>
      </div>:active?<HoldingMonitorEditor key={active.id} ready={state.ready} plan={active} draft={forPlan(active)} setDraft={draft=>setDrafts(current=>({...current,[active.id]:{base:monitorBaseKey(active),draft}}))}
        allDirty={view.algorithmsDirty || view.plans.some(p=>p.id!==active.id&&changed(p))} count={view.plans.length} error={view.error} save={()=>{
          const saved=view.save(next=>next.map(p=>{
            // Untouched saved/copied settings must not be rebuilt from form defaults on Save.
            if(p.id!==active.id||isLegacyQualityPlan(p)||p.router||!changed(active))return p;
            try { return {...p,...parseMonitorDraft(forPlan(active),definitions)}; } catch(cause) { throw new Error(`${p.label}：${cause instanceof Error?cause.message:'监测条件无效'}`); }
          }));
          if(saved)done();
        }}/>:<p className="pb-3 text-[11px] text-muted-foreground">暂无监测方案；新增上方算法后即可设置加仓条件。<SettingsImageButton className="ml-2"/></p>}
      {imageCapture&&<div hidden data-settings-image-include="">{view.plans.filter(p=>p.id!==active?.id&&!p.router).map(p=><div key={p.id}><h3>持仓监测 · {p.label}</h3>{isLegacyQualityPlan(p)?<FishQualityMonitorSettingsView plan={p} holdingOnly/>:<HoldingMonitorEditor ready={false} plan={p} draft={forPlan(p)} setDraft={()=>{}} save={()=>{}} error="" allDirty={false} count={view.plans.length} hideSave/>}</div>)}</div>}
    </>;
  }}/>;
}
const FILTER_TEXT: Record<QualityFilterStatus['state'], string> = { none: '', pass: '满足', fail: '未买入', pending: '待判断', error: '缺数据' };
const QualityArchiveContext=createContext(false);
/**
 * 【用户要求】2026-11-01 卖出列分栏、各有名称：加仓次数 · 几何仓位 · 相对涨幅（「进程」一栏用户要求删除）。固定栏宽，行与行上下对齐。
 * 相对涨幅与交易战役同口径（qualityRelativeGain）；收益率只在悬停说明里。
 */
const SELL_PARTS = 'grid w-full grid-cols-4 items-center gap-x-2 [&>*]:min-w-0 [&>:nth-child(-n+4)]:text-right';
function ResultCell({ plan, result, onClick, section, onOpenCampaign }: { plan: QualityGroup; result?: QualityResult; onClick: () => void; section: 'sell' | 'detect'; onOpenCampaign?: () => void }) {
  const archiveView=useContext(QualityArchiveContext);
  const router = useInRouterContext(), className = `${SELL_PARTS} ${wrapCell} text-left hover:underline`;
  const additions=qualityAdditionFills(result??{}),gain=qualityRelativeGain(plan,result),payoff=qualityPayoffRatio(plan,result),evaluated=result?.status==='open'||result?.status==='closed';
  const stageTitle=result?.activeSellStage?`第 ${result.activeSellStage.afterAdditions} 次加仓后：${result.activeSellStage.label} ${result.activeSellStage.rule.direction} ${result.activeSellStage.rule.threshold}`:'';
  const summary=[`收益率 ${pct(result?.returnPct)}`,`相对涨幅：${gain.value==null?gain.reason:gain.reason}`,`盈亏比：${payoff.reason}`,...(additions.length?[`共加仓 ${additions.reduce((n,a)=>n+a.quantity,0).toPrecision(7)} 枚 · 均价 ${result?.averageEntryPrice?.toPrecision(7)}`]:[]),...(stageTitle?[stageTitle]:[]),...(result?.additionVetoes?.length?[`否决加仓 ${result.additionVetoes.length} 次：${result.additionVetoes.map(v=>`${new Date(v.at+8*3600000).toISOString().slice(5,16).replace('T',' ')} 第 ${v.round} 次 · ${ADDITION_VETO_LABELS[v.kind as AdditionEntryVetoKind]??v.kind}（${v.reading}）`).join('；')}`]:[]),...(result?.additionReductions?.length?[`支撑线下移 ${result.additionReductions.length} 次：${result.additionReductions.map(c=>`${new Date(c.at+8*3600000).toISOString().slice(5,16).replace('T',' ')} 支撑 ${+c.previousSupport.toPrecision(8)}→${+c.newSupport.toPrecision(8)} · K ${+c.previousK.toPrecision(8)}→${+c.newK.toPrecision(8)} · ${c.fraction>0?`减仓 ${+(c.fraction*100).toFixed(2)}% @ ${+c.price.toPrecision(8)}（落袋 ${c.realizedPnl.toFixed(2)}）`:'无需减仓'}`).join('；')}`]:[])].join('\n');
  const content = <><span className={`text-[10px] tabular-nums ${additions.length?'text-primary':'text-muted-foreground/60'}`} data-testid="quality-sell-additions">{additions.length?`${additions.length} 次`:evaluated?'0 次':'—'}</span><span className="font-mono text-[10px] tabular-nums text-muted-foreground" data-testid="quality-sell-geometric">{qualityGeometricPositionText(qualityGeometricPosition(result))}</span><span className={`font-mono tabular-nums ${signed(gain.value)}`} data-testid="quality-sell-relative-gain">{qualityRelativeGainText(gain.value)}</span><span className={`font-mono tabular-nums ${signed(payoff.value)}`} data-testid="quality-sell-payoff">{qualityPayoffRatioText(payoff.value)}</span></>;
  if (!archiveView && result && hasQualityCampaign(result)) {
    const href = qualityCampaignPath(result.key, section), title = `${summary}\n打开交易战役`;
    return router ? <Link to={href} state={FROM_FISH_QUALITY} onClick={onOpenCampaign} className={className} title={title}>{content}</Link> : <a href={href} className={className} title={title}>{content}</a>;
  }
  if (result?.status === 'error') {
    const limited=/(?:HTTP|API)\s*(?:429|418)\b/.test(result.reason??'');
    return <button type="button" onClick={onClick} className={className} title={result.reason}>{content}<span className={'col-span-4 max-w-80 whitespace-normal text-[10px] '+(limited?'text-muted-foreground':'text-destructive')} data-testid={limited?'quality-monitor-rate-wait':'quality-monitor-error'}>{limited?'行情限流 · 待续跑；点击监测按钮继续未完成项':'未完成：'+(result.reason||'行情读取失败，请重试')}</span></button>;
  }
  return <button type="button" className={className} onClick={onClick} title={result?.reason ? `${qualityStaticDrawdownReason(result)}\n${summary}` : summary}>{content}</button>;
}

export function QualityHalfMirrorCell({plan,result,skipped}:{plan:QualityGroup;result?:QualityResult;skipped?:string}) {
 const mirror=qualityHalfMirror(plan,result);
 return <span title={skipped??mirror.detail} data-mirror-state={skipped?'unbought':mirror.state} className="inline-flex flex-col gap-0.5">{skipped?<span className="text-[9px] text-muted-foreground">未买入</span>:mirror.value!=null?<><span className={`font-mono tabular-nums ${signed(mirror.value)}`}>{pct(mirror.value)}</span><span className="text-[9px] text-muted-foreground">{mirror.label}</span></>:<span className={`text-[9px] ${mirror.state==='error'?'text-destructive':'text-muted-foreground'}`}>{mirror.label}</span>}</span>;
}


/** 组合表结果的显示偏好（只存本机浏览器）。 */
const hiddenKey=(kind:'filter'|'screening'|'monitor')=>`veil:quality-hide-${kind}`;
const readHidden=(kind:'filter'|'screening'|'monitor')=>{try{return localStorage.getItem(hiddenKey(kind))==='1';}catch{return false;}};
const writeHidden=(kind:'filter'|'screening'|'monitor',hidden:boolean)=>{try{if(hidden)localStorage.setItem(hiddenKey(kind),'1');else localStorage.removeItem(hiddenKey(kind));}catch{/* 存不下只影响下次打开 */}};
/**
 * 【用户要求】2026-11-02 「开始过滤 / 开始监测」旁非常隐形的「隐藏」「清除」：只作用于组合表里已产生的结果，组合表要干净。
 * 清除要再点一次确认；交易战役与过滤库、监测库的历史都不受影响。
 */
function QualityResultTools({ kind, hidden, onToggle, count, onClear, disabled }: { kind: 'filter' | 'screening' | 'monitor'; hidden: boolean; onToggle: () => void; count: number; onClear?: () => void|boolean|Promise<void|boolean>; disabled?: boolean }) {
  const [confirm, setConfirm] = useState(false),[busy,setBusy]=useState(false),[clearError,setClearError]=useState(''),name = kind === 'filter' ? '静态过滤' : kind==='screening'?'动态筛选':'监测', ghost = 'flex h-6 w-6 items-center justify-center rounded text-muted-foreground/35 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30';
  return <span className="inline-flex shrink-0 items-center" data-testid={`quality-${kind}-result-tools`}>
    <button type="button" className={ghost} aria-label={hidden ? `显示组合表中的${name}结果` : `隐藏组合表中的${name}结果`} aria-pressed={hidden} title={hidden ? `显示组合表中的${name}结果` : `隐藏组合表中的${name}结果`} onClick={onToggle}>{hidden ? <EyeOff aria-hidden className="h-3 w-3"/> : <Eye aria-hidden className="h-3 w-3"/>}</button>
    <Popover open={confirm} onOpenChange={setConfirm}><PopoverTrigger asChild><button type="button" className={ghost} aria-label={`清除组合表中的${name}结果`} title={count ? `清除组合表中的 ${count} 项${name}结果` : `组合表中没有${name}结果`} disabled={disabled || busy || !count || !onClear}><Eraser aria-hidden className="h-3 w-3"/></button></PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-2 p-3 text-[11px]">{clearError&&<p role="alert" className="text-destructive">{clearError}</p>}<p>清除组合表中的 {count} 项{name}结果？</p><p className="text-[10px] leading-relaxed text-muted-foreground">{kind === 'monitor' ? '先归档，交易战役与监测库保留；之后点「开始监测」会全部重算。' : kind==='screening'?'筛选库的历史、入选信号和持仓监测结果保留；停止当前筛选，只清组合表的动态结果，重新筛选后显示新结果。':'过滤库里的历史轮次保留；之后点「开始过滤」重新计算。'}</p>
        <div className="flex justify-end gap-2"><button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-muted" onClick={() => setConfirm(false)}>取消</button><button type="button" className="rounded bg-destructive/10 px-2 py-1 text-destructive hover:bg-destructive/20" disabled={busy} onClick={async() => {setBusy(true);setClearError('');try{if(await onClear?.()===false)throw Error('清除未保存，请重试');setConfirm(false);}catch(e){setClearError(e instanceof Error?e.message:'清除失败');}finally{setBusy(false);}}}>{busy?'正在清除…':'确认清除'}</button></div>
      </PopoverContent></Popover>
  </span>;
}
function MergedEntryCells({ entries, phase, planId, plan, expand }: { entries: { result?: QualityResult; skipped?: QualityFilterStatus }[]; phase: 'sell' | 'detect'; planId: string; plan: QualityGroup; expand: () => void }) {
  const results = entries.map(e => e.skipped ? undefined : e.result);
  const returns = results.map(r => r && (r.status === 'open' || r.status === 'closed') ? r.returnPct : null);
  const summary = qualityTableRange(returns, pct);
  const title = `合并 ${entries.length} 次买入记录，点击查看各次买入、过滤与收益明细`;
  return <>
    <td className={`${cell} border-l border-t border-border/40`}><button type="button" className={`${SELL_PARTS} ${wrapCell} text-left hover:underline`} onClick={expand} title={`${title}\n收益率 ${summary}`}><span className="text-[10px] tabular-nums text-muted-foreground" data-testid="quality-sell-additions">{qualityTableRange(results.map(r=>r&&(r.status==='open'||r.status==='closed')?qualityAdditionFills(r).length:null),n=>`${n}`)==='—'?'—':`${qualityTableRange(results.map(r=>r&&(r.status==='open'||r.status==='closed')?qualityAdditionFills(r).length:null),n=>`${n}`)} 次`}</span><span className="font-mono text-[10px] tabular-nums text-muted-foreground" data-testid="quality-sell-geometric">{qualityTableRange(results.map(r=>qualityGeometricPosition(r)),qualityGeometricPositionText)}</span><span className="font-mono tabular-nums" data-testid="quality-sell-relative-gain">{summary === '—' && entries.every(e => e.skipped?.state === 'fail') ? '未买入' : qualityTableRange(results.map(r=>qualityRelativeGain(plan,r).value),qualityRelativeGainText)}</span><span className="font-mono tabular-nums" data-testid="quality-sell-payoff">{qualityTableRange(results.map(r=>qualityPayoffRatio(plan,r).value),qualityPayoffRatioText)}</span></button></td>
    {phase === 'sell' && <>{(['static','peak'] as const).map(kind => <td key={kind} className={`${cell} ${wrapCell} text-right border-t border-border/40 font-mono tabular-nums text-muted-foreground`} data-testid={kind==='peak'?'quality-peak-gain':'quality-static-drawdown'} data-sell-plan={planId} title={title}>{qualityTableRange(results.map(r => kind==='peak'?qualityPeakPct(r):qualityDrawdownPct(r,'static')), value => pct(value).replace(/^\+/, ''))}</td>)}<QualitySalePriceChangeCell plan={plan} entries={entries}/><td className={`${cell} ${wrapCell} text-right border-t border-border/40`} data-testid="quality-half-mirror" data-sell-plan={planId}><button type="button" onClick={expand} className="text-right hover:underline" title={title}>{qualityTableRange(results.map(r=>qualityHalfMirror(plan,r).value),pct)==='—' ? [...new Set(entries.map(e=>e.skipped?'未买入':qualityHalfMirror(plan,e.result).label))].join(' / ') : qualityTableRange(results.map(r=>qualityHalfMirror(plan,r).value),pct)}<span className="block text-[9px] text-muted-foreground">{entries.length} 次买入 · 展开</span></button></td><td className={`${cell} ${wrapCell} text-right border-t border-border/40 font-mono tabular-nums text-muted-foreground`} data-testid="quality-held-time" data-sell-plan={planId} title={title}>{qualityTableRange(results.map(r => r && (r.status === 'open' || r.status === 'closed') ? r.heldHours : null), heldText)}</td></>}
  </>;
}

function RowDetail({ row, state, close }: { row?: QualitySample; state: FishQualityState; close: () => void }) {
  const study = state.study;
  return <Dialog open={!!row} onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
    <DialogHeader><DialogTitle className="text-sm">{row?.source.symbol} · 卖出对比</DialogTitle><DialogDescription className="text-xs">信号 {row?date(qualitySignalTime(row.source)):'—'} · 买入 {row?date(qualityMonitorEntryAt(row, qualityRowMonitorTimeBasis(study, row))):'—'} · 每方案独立模拟 100 USDT / 1 倍</DialogDescription></DialogHeader>
    {row && <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-[11px]"><thead className="bg-muted/40 text-muted-foreground"><tr><th className={cell}>指标</th>{study.sellPlans?.map(p => <th key={p.id} className={`${cell} font-medium`}>{qualityExitAlgorithmLabel(p.rule,p.label)} {ruleText(p)}</th>)}</tr></thead><tbody>{[
      ['状态', (r?: QualityResult) => `${resultText(r)}${r?.reason ? ` · ${qualityStaticDrawdownReason(r)}` : ''}`],
      ['当前一票阶段', (r?:QualityResult)=>r?.activeVetoStage?`第 ${r.activeVetoStage.afterAdditions} 次加仓后`:'原一票条件'],
      ['当前卖出算法', (r?:QualityResult)=>r?.activeSellStage?`第 ${r.activeSellStage.afterAdditions} 次加仓后 · ${r.activeSellStage.label} ${r.activeSellStage.rule.direction} ${r.activeSellStage.rule.threshold}`:'原卖出算法'],
      ['卖出切换记录', (r?:QualityResult)=>r?.sellStageSwitches?.map(stage=>`第 ${stage.afterAdditions} 次 · ${date(stage.at)} · ${stage.label}`).join('；')??'未切换'],
      ['买入时间', (r?: QualityResult) => date(r?.entryTime)], ['买入价', (r?: QualityResult) => r?.entryPrice?.toPrecision(7) ?? '—'],
      ['卖出 / 估值时间', (r?: QualityResult) => date(r?.endTime)], ['卖出 / 估值价', (r?: QualityResult) => r?.endPrice?.toPrecision(7) ?? '—'],
      ['加仓', (r?: QualityResult) => qualityAdditionFills(r??{}).length ? qualityAdditionFills(r??{}).map((a,i)=>`第${i+1}轮 ${date(a.at)} · ${a.quantity.toPrecision(7)} 枚 · T ${a.price.toPrecision(7)}${a.sizing?` · S ${a.sizing.previousSupport.toPrecision(7)} · K ${a.sizing.support.toPrecision(7)} · ATR ${a.sizing.atr.toPrecision(7)}`:''}`).join('；') : r?.additionNote ?? '未触发'],
      ['累计投入 / 持仓均价', (r?: QualityResult) => r?.additionFill ? `${r.totalInvested} USDT · ${r.averageEntryPrice?.toPrecision(8)}` : '—'],
      ['镜像平衡减仓', (r?: QualityResult) => r?.mirrorFill ? `${date(r.mirrorFill.at)} · 价格 ${r.mirrorFill.price.toPrecision(7)} · 卖出初始币数 ${+(r.mirrorFill.fraction*100).toPrecision(8)}%` : '未触发'],
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
export function FishQuality({ state, mining, onJump, onRate,canJump,jumpingSignalId,tradedDayIndex,campaignDayIndex,archiveView=false }: { archiveView?:boolean;state: FishQualityState; mining?: FishMiningApi; onJump?: (source: TradeSignal) => void;onRate?:(source:TradeSignal,value:number)=>void; canJump?: (source: TradeSignal) => boolean; jumpingSignalId?: string | null; tradedDayIndex?: Set<string>; campaignDayIndex?: Set<string> }) {
  const { study, ready, running, progress, resumeMonitoring, resumeFiltering, setSourceQuality } = state;
  const workspace = archiveView ? undefined : state.workspace;
  const lockedBatch = archiveView || workspace ? null : state.lockedBatch;
  const rateSource=useCallback((source:TradeSignal,value:number)=>{try{if(onRate)onRate(source,value);else setSourceQuality?.(source,normalizeSignalQuality(source.quality)===value?undefined:value);}catch(error){toast.error(error instanceof Error?error.message:'评分保存失败');}},[onRate,setSourceQuality]);
  // 从交易战役返回：按离开时记下的状态打开（见 lib/fish/qualityReturn）
  const uid=useId(),titleId=archiveView?uid+'-title':'fish-quality-title',contentId=archiveView?uid+'-content':'fish-quality-content';
  const [back] = useState(() => { const saved=archiveView?undefined:pendingQualityReturn(); if(saved?.owner&&state.account&&saved.owner!==state.account){finishQualityReturn();return undefined;}return saved; }), ui = back?.ui;
  const [manualOpen, setManualOpen] = useState(false);
  const [open, setOpen] = useState(ui?.open ?? true), [query, setQuery] = useState(ui?.query ?? ''), [month, setMonth] = useState(ui?.month ?? ''), [algorithmChoice, setAlgorithmsState] = useState<string[]>(() => ui?.algorithms ?? (ui?.algorithm ? [ui.algorithm] : [])), [origin, setOrigin] = useState<QualityReturnUi['origin']>(workspace ? '' : ui?.origin ?? '');
  const [directoryChoice,setDirectoryChoice]=useState<QualitySourceDirectory|undefined>(workspace ? undefined : ui?.directory);
  const [screeningRunId,setScreeningRunId]=useState<string|undefined>(ui?.screeningRunId ?? lockedBatch?.workingRoundId);
  const [directoryRequests,setDirectoryRequests]=useState<Partial<Record<QualitySourceDirectory['kind']|'monitor',FishDirectoryRequest>>>({});
  const sourceDefaulted=useRef(!!ui),sourceAccount=useRef(state.account);
  const latestEntry=latestEntryDirectory(state.preEntry?.library,study.monitorLibrary?.directoryEdits),latestEntryId=latestEntry?.id;
  useEffect(()=>{
    if(sourceAccount.current!==state.account){sourceAccount.current=state.account;sourceDefaulted.current=false;setDirectoryChoice(undefined);setScreeningRunId(undefined);setOrigin('');}
    if(!workspace&&!archiveView&&ready&&state.preEntry?.ready&&!sourceDefaulted.current&&latestEntryId){setOrigin('pre-entry');setDirectoryChoice({kind:'pre-entry',id:latestEntryId});}
  },[workspace,archiveView,ready,state.preEntry?.ready,state.account,latestEntryId]);
  // 【用户要求】2026-10-26「比较卖出和比较探测没必要分开，合并到一起，统一叫做卖出与探测（控制变量法）」：只有一个视图
  const phase = 'sell' as const;
  const [detectorExpanded, setDetectorExpanded] = useState(ui?.detectorExpanded ?? false);
  const [labelExpanded,setLabelExpanded]=useState<string[]>(ui?.labelExpanded??[]);
  const toggleLabel=(id:string)=>setLabelExpanded(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);
  const [entryExpanded,setEntryExpanded]=useState<string[]>(ui?.entryExpanded??[]);
  const [postExitExpanded,setPostExitExpanded]=useState<string[]>(ui?.postExitExpanded??[]);
  const postExitOpen=useMemo(()=>new Set(postExitExpanded),[postExitExpanded]);
  const entryReadings=useMemo(()=>new Map((study.entryReadings??[]).map(r=>[r.key,r])),[study.entryReadings]);
  const postExitReadings=useMemo(()=>new Map((study.postExitReadings??[]).map(r=>[r.key,r])),[study.postExitReadings]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false), [monitorOpen, setMonitorOpen] = useState(false);
  const [hideFilter, setHideFilter] = useState(() => readHidden('filter')), [hideMonitor, setHideMonitor] = useState(() => readHidden('monitor')), [hideScreening,setHideScreening]=useState(()=>readHidden('screening'));
  const toggleHidden = (kind: 'filter' | 'screening' | 'monitor') => (kind === 'filter' ? setHideFilter : kind==='screening'?setHideScreening:setHideMonitor)(hidden => { writeHidden(kind, !hidden); return !hidden; });
  const [sort, setSort] = useState<SortKey>((ui?.sort==='run'||ui?.sort?.startsWith('sell-error:')||workspace&&(ui?.sort==='detector'||ui?.sort==='detector-value')?'time':ui?.sort?.replace(/^dynamic:/,'peak:')) as SortKey ?? 'time'), [ascending, setAscending] = useState(ui?.ascending ?? false), [scrollTop, setScrollTop] = useState(ui?.tableTop ?? 0);
  const rootRef = useRef<HTMLElement>(null);
  // 【用户要求】2026-11-01 查「点进战役后持仓监测停了」：没在跑、上一轮是暂停结束时，直接写出暂停原因
  const lastRound = (workspace ? study.workspaceMonitorDraft : study.monitorLibrary)?.rounds.reduce<NonNullable<FishQualityStudy['monitorLibrary']>['rounds'][number] | undefined>((a, r) => !a || r.startedAt > a.startedAt ? r : a, undefined);
  const lastPause = lastRound?.state === 'paused' && lastRound.error ? { reason: lastRound.error, at: lastRound.finishedAt ?? lastRound.updatedAt } : null;
  /** 点进交易战役前记下界面状态与滚动位置，返回时原样恢复。 */
  const rememberReturn = () => {
    const top=tableRef.current?.scrollTop??scrollTop,index=Math.max(0,Math.min(rows.length-1,Math.floor(top/rowPx))),anchorRow=rows[index];
    saveQualityReturn({owner:state.account,
      ui:{open,query,month,algorithms:algorithmChoice,origin,directory:directoryChoice,detectorExpanded,labelExpanded,postExitExpanded,entryExpanded,sort,ascending,screeningRunId,rowPx,tableLeft:tableRef.current?.scrollLeft??0,tableTop:top,...(anchorRow?{anchor:{id:anchorRow.id,fraction:(top%rowPx)/rowPx}}:{})},
      scroll:ancestorScrolls(rootRef.current),
    });
  };
  const mountedEntry=useRef(currentHistoryEntry()),rememberLatestView=useRef(rememberReturn);rememberLatestView.current=rememberReturn;
  // Going to a chart closes this panel without changing the route. Save its
  // latest UI before removal; a campaign Link already saved the old route entry.
  useLayoutEffect(()=>()=>{if(!archiveView&&currentHistoryEntry()===mountedEntry.current)rememberLatestView.current();},[archiveView]);
  const [error, setError] = useState(''), [detailId, setDetailId] = useState('');
  const { samples, results, monitorTimeBasisByRow } = study;
  const allRows = useMemo(() => {
    const rows = qualityDisplayRows({ samples });
    return archiveView ? rows : rows.filter(row => !isDelayedTuringReplaySample(row.source));
  }, [samples, archiveView]);
  const screeningResults=useMemo(()=>qualityScreeningResults({screeningResults:study.screeningResults,screeningRounds:study.screeningRounds},archiveView?undefined:state.preEntry?.library),[study.screeningResults,study.screeningRounds,state.preEntry?.library,archiveView]);
  const screeningIndex=useMemo(()=>screeningResultIndex(screeningResults),[screeningResults]);
  const activeScreeningRound=state.preEntry?.running?state.preEntry.library.rounds.filter(r=>r.state==='running'&&(!workspace||!isAutomaticPreEntryRound(r))).reduce<typeof state.preEntry.library.rounds[number]|undefined>((latest,r)=>!latest||r.updatedAt>latest.updatedAt?r:latest,undefined):undefined;
  const activeScreeningId=activeScreeningRound?.id,activeScreeningAt=activeScreeningRound?.updatedAt;
  useEffect(()=>{if(!archiveView&&activeScreeningId){sourceDefaulted.current=true;setScreeningRunId(activeScreeningId);}},[archiveView,activeScreeningId,activeScreeningAt]);
  const directoryIds=directoryChoice?sourceDirectoryIds(directoryChoice):[];
  const directoryEdits=directoryChoice?.kind==='pre-entry'?mergeLibraryDirectoryEdits(study.monitorLibrary?.directoryEdits,state.preEntry?.library.directoryEdits):study.monitorLibrary?.directoryEdits;
  const screeningRoundId = lockedBatch ? lockedBatch.roundId : directoryChoice?.kind === 'pre-entry' && directoryIds.length === 1 ? directoryIds[0] : undefined;
  const showScreening=!hideScreening&&(!!state.preEntry||study.screeningResults!==undefined);
  const detectorMap = useMemo(() => new Map(study.groups.map(g => [g.id, g])), [study.groups]);
  const batch = useMemo(() => {
    if (!lockedBatch) return allRows;
    const ids = new Set(lockedBatch.rowIds);
    return allRows.filter(row => ids.has(row.id));
  }, [allRows, lockedBatch]);
  // 月份条数跟随来源、探测算法、标的筛选；同一信号的多个探测行只计一次。
  // 选中的探测算法里已不在当前批次的不算（否则整表会空掉）
  const batchDetectors = useMemo(() => new Set(batch.map(r => r.detectorId).filter((id): id is string => !!id)), [batch]);
  const defaultIds = useMemo(() => new Set(defaultQualityDetectorIds(study.groups)), [study.groups]);
  // Apply only the explicitly selected presets; the default table includes every historical capture.
  const activeAlgorithms = useMemo(() => lockedBatch ? [] : algorithmChoice.filter(id => batchDetectors.has(id) && defaultIds.has(id)), [lockedBatch, algorithmChoice, batchDetectors, defaultIds]);
  const directoryKeys=useMemo(()=>sourceDirectoryKeys(directoryChoice,{filterLibrary:study.filterLibrary},state.preEntry?.library),[directoryChoice,study.filterLibrary,state.preEntry?.library]);
  const searched = useMemo(() => lockedBatch ? batch : batch.filter(r => (!query.trim() || r.source.symbol.toUpperCase().includes(query.trim().toUpperCase())) &&
    (directoryChoice&&directoryChoice.kind===origin?(directoryKeys?directoryKeys.has(qualityEntryIdentity(r.source,r.enteredAt)):hasSource(r,'mined')&&sourceDirectoryIds(directoryChoice).some(id=>matchesMiningDirectory(r,study.groups,id))):!origin||origin!=='filter'&&hasSource(r,origin))), [lockedBatch,batch,query,origin,directoryChoice,directoryKeys,study.groups]);
  const narrowed = useMemo(() => activeAlgorithms.length ? searched.filter(r => activeAlgorithms.includes(r.detectorId ?? '')) : searched, [searched, activeAlgorithms]);
  /** 各探测算法在当前来源 / 标的筛选下的信号条数（同一信号只计一次）。 */
  const detectorSignals = useMemo(() => { const ids = new Map<string, Set<string>>(); for (const r of searched) if (r.detectorId) { if (!ids.has(r.detectorId)) ids.set(r.detectorId, new Set()); ids.get(r.detectorId)!.add(r.signalId ?? r.id); } return ids; }, [searched]);
  // 一项默认算法可能对应几个历史版本的组：按信号去重计数
  const signalsOf = (ids: readonly string[]) => new Set(ids.flatMap(id => [...(detectorSignals.get(id) ?? [])])).size;
  const resultMap = useMemo(() => qualityResultMap({ results }), [results]);
  // 旧试验兼容绑定过滤；新工作流的过滤列与卖出结果各自显示。
  const filtersOn = anyBuyFilters(study), filterReadings = study.filterReadings, signalMetrics = study.signalMetrics;
  const readingsOn = !!state.runStaticSettings && !!signalMetrics?.length;
  const signalReadingMap = useMemo(()=>new Map(study.signalReadings?.map(reading=>[reading.key,reading])),[study.signalReadings]);
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
  }, [narrowed, filterReadings, study.buyFilters, study.sellPlans, study.independentFilters, monitorTimeBasisByRow, study.monitorTimeBasis]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 这一行在这套方案下没买入（不满足 / 待判断 / 缺数据）时给出原因；买入了或没开过滤时为 undefined。 */
  const skippedBy = (plan: QualityGroup, row: QualitySample) => { const f = filterStatus.get(plan.id)?.get(row.signalId ?? row.id); return f && f.state !== 'pass' ? f : undefined; };
  const [monitorPlanId, setMonitorPlanId] = useState<string | null>(null);
  const filterCount = activeStandaloneBuyFilters(study).length, vetoCount = (study.sellPlans ?? []).reduce((n, p) => n + activeHoldingVetoes(p.holdingVetoes).length + (p.mirrorTakeProfit?.enabled ? 1 : 0) + (p.addition?.enabled ? 1 : 0)+(p.vetoStages?.length??0), 0);
  const plansForSort = study.sellPlans;
  const runScopeRows = useMemo(() => lockedBatch ? narrowed : narrowed.filter(r => !month || signalMonthKey(qualitySignalTime(r.source)) === month), [lockedBatch, narrowed, month]);
  const mergeCabinSignals = (lockedBatch?.groupBySignal ?? (!!workspace || origin === 'fish')) && !detectorExpanded;
  const sortedRows = useMemo(() => {
    const map = resultMap;
    const captureTimes = new Map<string, number>();
    if (mergeCabinSignals && sort === 'mined-at') {
      for (const row of runScopeRows) {
        const at = qualityTableCaptureTime(row);
        const key = qualityTableSignalKey(row);
        if (at !== null && at > (captureTimes.get(key) ?? 0)) captureTimes.set(key, at);
      }
    }
    const value = (r: QualitySample): number | string | null => {
      if(sort.startsWith('screening:')){const value=screeningCell(screeningRowResults(r,screeningIndex,screeningRoundId,screeningRunId));return sort==='screening:time'?value.time:sort==='screening:plan'?value.plan==='—'?null:value.plan:value.status==='—'?null:value.status;}
      if (sort === 'time') return qualitySignalTime(r.source);
      if (sort === 'mined-at') return mergeCabinSignals ? captureTimes.get(qualityTableSignalKey(r)) ?? null : qualityTableCaptureTime(r);
      if (sort === 'symbol') return r.source.symbol;
      if (sort === 'market') return r.source.market === 'us_stock' ? '美股' : '加密';
      if (sort === 'detector-value') return qualityDetectorReading(r).value;
      if (sort === 'quality') return normalizeSignalQuality(r.source.quality) ?? null;
      if (sort === 'process') return isLibrary(r) ? null : r.source.fish?.cutoffMs ?? null;
      if (sort === 'detector') { const g = detectorMap.get(r.detectorId ?? ''); return g ? `${g.label}\u0000${String(g.snapshot.threshold).padStart(12, '0')}\u0000${g.metric}` : null; }
      if (sort.startsWith('signal-value:')) { const metric=signalMetrics?.find(metric=>`signal-value:${metric.id}`===sort); return metric ? signalReadingMap.get(signalReadingKey(r,metric))?.value ?? null : null; }
      if (sort.startsWith('filter:')) { const column = filterColumns.find(c => `filter:${c.id}` === sort); return column ? qualityFilterValue(r, column.filter, filterReadingMap) : null; }
      if(sort.startsWith('entry:')){const p=plansForSort?.find(p=>p.id===sort.slice(6));if(!p)return null;const f=filterStatus.get(p.id)?.get(r.signalId??r.id);if(f&&f.state!=='pass')return null;const result=qualityRowResult(study,r,p,map),key=qualityEntryKey(r.source,result,p,qualityEntryParts(p)[0]),reading=key?entryReadings.get(key):undefined;return validEntryReading(reading)?reading!.value!:null;}
      if(sort.startsWith('price-change:')){const p=plansForSort?.find(p=>p.id===sort.slice(13));if(!p)return null;const f=filterStatus.get(p.id)?.get(r.signalId??r.id);return f&&f.state!=='pass'?null:qualitySalePriceChangePct(qualityRowResult(study,r,p,map));}
      if(sort.startsWith('addition:')){const p=plansForSort?.find(p=>p.id===sort.slice(9));if(!p)return null;const f=filterStatus.get(p.id)?.get(r.signalId??r.id);return f&&f.state!=='pass'?null:qualityAdditionSummary(p,qualityRowResult(study,r,p,map)).count;}
      if(sort.startsWith('label:')){const plan=plansForSort?.find(p=>p.id===sort.slice(6));if(!plan)return null;const f=filterStatus.get(plan.id)?.get(r.signalId??r.id);return qualityDetectorLabel(plan,qualityRowResult(study,r,plan,map),!!f&&f.state!=='pass').rank;}
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
    const keyed = runScopeRows.map(r => ({ r, v: value(r) }));
    return keyed.sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? qualitySignalTime(b.r.source) - qualitySignalTime(a.r.source) : a.v == null ? 1 : -1;
      const order = typeof a.v === 'string' ? a.v.localeCompare(String(b.v)) : a.v - (b.v as number);
      return order * (ascending ? 1 : -1) || qualitySignalTime(b.r.source) - qualitySignalTime(a.r.source) || a.r.id.localeCompare(b.r.id);
    }).map(x => x.r);
  }, [runScopeRows, sort, ascending, detectorMap, resultMap, plansForSort, monitorTimeBasisByRow, study.monitorTimeBasis, filterStatus, filterColumns, signalMetrics, signalReadingMap, filterReadingMap, postExitReadings, entryReadings,screeningIndex,screeningRoundId,screeningRunId,mergeCabinSignals]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows: QualityTableRow[] = useMemo(() => detectorExpanded ? sortedRows : collapseQualityTableRows(sortedRows, mergeCabinSignals ? 'signal' : 'entry'), [sortedRows, detectorExpanded, mergeCabinSignals]);
  // 表格为空时探测算法表头不显示：是它们滤空的，就在空状态里写明并给出清除
  const emptyByDetector = !rows.length && activeAlgorithms.length > 0 && searched.length > 0 && narrowed.length === 0;
  const monthCounts = useMemo(() => {
    const ids = new Map<string, Set<string>>();
    for (const r of narrowed) { const key = signalMonthKey(qualitySignalTime(r.source)); if (!ids.has(key)) ids.set(key, new Set()); ids.get(key)!.add(qualityTableSignalKey(r)); }
    return new Map([...ids].map(([key, signals]) => [key, signals.size]));
  }, [narrowed]);
  const months = [...new Set(batch.map(r => signalMonthKey(qualitySignalTime(r.source))))].sort().reverse();
  const sellVariables = qualityVariables(study.sellPlans ?? []);
  const plans = sellVariables.flatMap(v => v.levels), groups = study.groups.filter(g => batch.some(r => r.detectorId === g.id));
  // 隐藏只作用于组合表里的运行结果：过滤读数与入场读数 / 持仓监测各列；探测相关列照常显示
  // 【用户要求】2026-11-02 入场读数与探测值重复，整列删除；过滤读数清除后（或还没跑过）整列不显示，有读数才出现；
  // 隐藏「买前过滤」时整组（探测值、探测算法、捕捞过程、过滤读数）都不显示
  const shownFilters = hideFilter || !filterReadings?.length ? [] : filterColumns, shownPlans = hideMonitor ? [] : plans;
  const shownSignalMetrics = hideFilter ? [] : signalMetrics ?? [];
  const showDetectorColumns = !workspace && !hideFilter;
  const detectorChoices = useMemo(() => qualityDetectorChoices(groups), [groups]), chosenChoices = detectorChoices.filter(c => c.ids.some(id => activeAlgorithms.includes(id)));
  const requestPostExit=state.postExit?.request;
  const postExitPlanIds=postExitExpanded.filter(id=>plans.some(p=>p.id===id));
  const postExitScopeKey=JSON.stringify([postExitPlanIds,sortedRows.map(r=>r.signalId??r.id)]);
  const requestObservations=(retry=false)=>{if(postExitPlanIds.length)requestPostExit?.(postExitPlanIds,sortedRows.map(r=>r.signalId??r.id),retry);};
  useEffect(()=>{if(archiveView||!open||!ready||!postExitPlanIds.length)return;requestObservations();const timer=setInterval(()=>requestObservations(),60000);return()=>clearInterval(timer);},[open,ready,postExitScopeKey,study.results,requestPostExit]); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePostExit=(id:string)=>{const opening=!postExitOpen.has(id);setPostExitExpanded(ids=>opening?[...ids,id]:ids.filter(v=>v!==id));if(opening)requestPostExit?.([id],sortedRows.map(r=>r.signalId??r.id),true);};
  const selectedIds = useMemo(() => new Set(lockedBatch?.rowIds ?? study.selectedRowIds ?? []), [lockedBatch, study.selectedRowIds]);
  const selectedRows = useMemo(() => rows.filter(row => qualityTableMembers(row).some(member => selectedIds.has(member.id))), [rows, selectedIds]);
  // 【用户要求】2026-10-27 买前过滤、持仓监测只处理「当前筛选下可见、且已勾选」的行；筛选外勾着的不动
  const selectedBatch = batch.filter(r => selectedIds.has(r.id)), scopedSelected = sortedRows.filter(r => selectedIds.has(r.id));
  const selectedCount = countSignals(scopedSelected), selectedTotal = countSignals(selectedBatch);
  const readingsRunning = !!state.signalValues?.running;
  const staticRunning = state.filterRunning || readingsRunning;
  const staticProgress = readingsRunning ? state.signalValues?.progress : state.filterProgress;
  const canStartStatic = !!selectedCount && (filtersOn || readingsOn);
  const lockSelection = () => {
    if (!ready || !scopedSelected.length || state.archiving) return;
    sourceDefaulted.current = true;
    state.setLockedBatch?.({
      rowIds: scopedSelected.map(row => row.id),
      groupBySignal: origin === 'fish',
      roundId: screeningRoundId,
      workingRoundId: screeningRunId,
    });
    selectAnchor.current = null;
    resetScroll();
  };
  const unlockSelection = () => {
    state.setLockedBatch?.(null);
    selectAnchor.current = null;
    resetScroll();
  };
  // 【用户要求】2026-11-04「开始监测点不了」：勾选的信号都在筛选外时，写明在哪几个来源、各多少条，并能一键切过去
  const outsideSelection = useMemo(() => {
    if (selectedTotal <= selectedCount) return null;
    const inside = new Set(scopedSelected.map(qualityTableSignalKey)), rows = selectedBatch.filter(r => !inside.has(qualityTableSignalKey(r)));
    const bySource = (['mined', 'fish', 'library', 'turing', 'pre-entry'] as const).map(o => ({ o, n: countSignals(rows.filter(r => hasSource(r, o))) })).filter(x => x.n);
    const names = QUALITY_SOURCE_NAMES;
    return { count: selectedTotal - selectedCount, text: bySource.map(x => `${names[x.o]} ${x.n}`).join('、') };
  }, [selectedBatch, scopedSelected, selectedTotal, selectedCount]);
  /** 只改挡住已勾选信号的筛选：来源优先换成能包含全部勾选的那一个，否则全部来源；月份、标的、探测算法挡住了才清空。 */
  const revealSelected = () => {
    const sel = selectedBatch;
    setDirectoryChoice(undefined);sourceDefaulted.current=true;
    if (origin && (origin==='filter'||sel.some(r => !hasSource(r, origin)))) setOrigin((['mined', 'fish', 'library', 'turing', 'pre-entry'] as const).find(o => sel.every(r => hasSource(r, o))) ?? '');
    if (month && sel.some(r => signalMonthKey(qualitySignalTime(r.source)) !== month)) setMonth('');
    if (query.trim() && sel.some(r => !r.source.symbol.toUpperCase().includes(query.trim().toUpperCase()))) setQuery('');
    if (activeAlgorithms.length && sel.some(r => !activeAlgorithms.includes(r.detectorId ?? ''))) setAlgorithmsState([]);
    resetScroll();
  };
  const outsideHint = outsideSelection && <span className="inline-flex flex-wrap items-center gap-1" data-testid="quality-outside-selection">{selectedCount === 0 ? <>勾选的 {outsideSelection.count} 条都在当前筛选外</> : <>筛选外另有 {outsideSelection.count} 条已勾选</>}（{outsideSelection.text}）
    <button type="button" className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20" onClick={revealSelected}>切到包含勾选的筛选</button></span>;
  const { setScope } = state;
  useLayoutEffect(() => { setScope?.(sortedRows.map(r => r.id), {roundId:screeningRoundId,workingRoundId:screeningRunId}); }, [setScope, sortedRows, screeningRoundId, screeningRunId]);
  const selectedEntryCount = new Set(scopedSelected.map(r => r.signalId ?? r.id)).size;
  const rowSelected = (row: QualityTableRow) => qualityTableMembers(row).every(member => selectedIds.has(member.id));
  // 【用户要求】2026-11-02 像 Excel 那样：每行左侧有行号（选中的行号高亮），底部显示已选行数
  const selectedRowCount = rows.filter(rowSelected).length;
  const allSelected = rows.length > 0 && selectedRowCount === rows.length;
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
  // Capture time is display metadata. It does not affect entry or execution.
  const showCaptureTime=rows.some(row=>qualityTableCaptureTime(row)!=null);
  const columnWidths = [
    152, 130, ...(showCaptureTime ? [130] : []), 58, 80,
    ...(showDetectorColumns ? [detectorExpanded ? 145 : 102, detectorExpanded ? 174 : 146] : []),
    ...(hideFilter ? [] : [84]), ...shownFilters.map(() => 138), ...shownSignalMetrics.map(() => 124),
    ...(showScreening ? [144, 90, 138, 68] : []),
    ...shownPlans.flatMap(p => [252, 92, 86, 86, 90, 86, ...(postExitOpen.has(p.id) ? [132, ...Array(9).fill(116)] : [118])]),
    28,
  ];
  const rowLayoutKey=JSON.stringify([entryExpanded,labelExpanded,postExitExpanded,detectorExpanded,plans.map(p=>p.id)]),priorRowLayout=useRef(rowLayoutKey),pendingTableScroll=useRef<{top:number;left:number}>();
  const tableRef = useRef<HTMLDivElement>(null), [rowPx, setRowPx] = useState(ui?.rowPx ?? ROW_PX), [viewPx, setViewPx] = useState(TABLE_PX);
  const resetScroll = () => { setScrollTop(0); if (tableRef.current) tableRef.current.scrollTop = 0; };
  const setAlgorithms = (ids: string[]) => { setAlgorithmsState(ids); resetScroll(); };
  const chooseDirectory=async(kind:QualitySourceDirectory['kind'],id:string,snapshot:FishQualityStudy,ids?:string[])=>{
    if(!state.restoreMonitorStudy)return false;
    const copied=await state.restoreMonitorStudy(snapshot,undefined,true);if(!copied)return false;
    sourceDefaulted.current=true;setScreeningRunId(undefined);setDirectoryChoice({kind,id,...(ids?{ids}: {})});setOrigin(kind);setQuery('');setMonth('');setAlgorithmsState([]);setOpen(true);resetScroll();return true;
  };
  const selectSource=(value:QualityReturnUi['origin'])=>{
    sourceDefaulted.current=true;
    if(!archiveView&&(value==='filter'||value==='pre-entry'&&!!state.preEntry||value==='mined'&&!!mining)){
      const current=directoryChoice?.kind===value?directoryChoice.id:value==='pre-entry'?latestEntry?.id:undefined;
      setDirectoryRequests(requests=>({...requests,[value]:{key:(requests[value]?.key??0)+1,selectedId:current,selectedIds:directoryChoice?.kind===value?sourceDirectoryIds(directoryChoice):current?[current]:[]}}));return;
    }
    setDirectoryChoice(undefined);setOrigin(value);if(value === 'fish')setDetectorExpanded(false);resetScroll();
  };
  const openWorkspaceLibrary = (kind: QualitySourceDirectory['kind']|'monitor') =>
    setDirectoryRequests(requests=>({...requests,[kind]:{key:(requests[kind]?.key??0)+1}}));
  const importWorkspace = (snapshot: FishQualityStudy, ids: readonly string[]) => {
    if (!workspace?.importRows(snapshot,ids)) return false;
    setQuery('');setMonth('');setAlgorithmsState([]);setOpen(true);resetScroll();
    return true;
  };
  const renderArchive = (snapshot: FishQualityStudy, close?: () => void) => workspace ? <div className="space-y-2 px-4 py-3">
    <FishWorkspaceRows snapshot={snapshot} onImport={importWorkspace} onDone={close}/>
    <details><summary className="cursor-pointer text-[11px] text-muted-foreground">查看归档组合表</summary>
      <ArchivedQualityBoard study={snapshot} onJump={onJump} canJump={canJump}/>
    </details>
  </div> : <ArchivedQualityBoard study={snapshot} onJump={onJump} canJump={canJump}/>;
  const completeScreening = state.preEntry?.library.rounds.filter(round=>round.workspaceDraft&&round.state==='complete').length ?? 0;
  const completeFiltering = study.workspaceFilterDraft?.rounds.some(round=>round.state==='complete');
  const completeMonitoring = study.workspaceMonitorDraft?.rounds.filter(round=>round.state==='complete').length ?? 0;
  const [confirmRemove,setConfirmRemove] = useState(false);
  const expandDetectors = (expanded: boolean) => { setDetectorExpanded(expanded); selectAnchor.current = null; resetScroll(); };
  // 返回时把表格与外面各层滚回原处：数据是陆续载入的，逐帧重试到位置稳住（最多 8 秒）；用户一动滚轮 / 触屏 / 按键就停手
  const readyRef = useRef(ready); readyRef.current = ready;
  const restoreRows=useRef(rows),restoreRowPx=useRef(rowPx);restoreRows.current=rows;restoreRowPx.current=rowPx;
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
      const anchor=back.ui.anchor,index=anchor&&Number.isFinite(anchor.fraction)?restoreRows.current.findIndex(row=>row.id===anchor.id):-1;
      const targetTop=index>=0?(index+anchor!.fraction)*restoreRowPx.current:back.ui.tableTop;
      if (table && Math.abs(table.scrollTop - targetTop) > 1) { table.scrollTop = targetTop; setScrollTop(table.scrollTop); ok = Math.abs(table.scrollTop - targetTop) <= 1; }
      if (table && Math.abs(table.scrollLeft - (back.ui.tableLeft ?? 0)) > 1) { table.scrollLeft = back.ui.tableLeft ?? 0; ok = Math.abs(table.scrollLeft - (back.ui.tableLeft ?? 0)) <= 1 && ok; }
      if (!table && (back.ui.tableTop > 0 || (back.ui.tableLeft ?? 0) > 0)) ok = false;
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
  // Keep the live table virtualized. Export only frozen selected rows in small
  // offscreen batches, using exactly the same cell renderer as the live table.
  const EXPORT_BATCH=40,exportTableRef=useRef<HTMLTableElement>(null);
  type TableExport={nodes:ReactNode[];header:HTMLTableSectionElement;offset:number;sheet:ReturnType<typeof readQualityTableSheet>;owner?:string};
  const [tableExport,setTableExport]=useState<TableExport|null>(null);
  const visible=rows.slice(first,last),padTop=first*rowPx,padBottom=(rows.length-last)*rowPx;

  // 评估先算屏幕上看得见的行，再按表格顺序往下
  const { setPriority } = state;
  useEffect(() => { setPriority?.([...visible.flatMap(qualityTableMembers), ...rows.flatMap(qualityTableMembers)].map(r => r.signalId ?? r.id)); }, [setPriority, rows, first, last]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeSort = (key: SortKey) => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(TEXT_KEYS.has(key)); } resetScroll(); };
  const arrow = (key: SortKey) => sort === key ? ascending ? ' ↑' : ' ↓' : '';
  const ariaSort = (key: SortKey) => sort === key ? ascending ? 'ascending' as const : 'descending' as const : 'none' as const;
  const sortButton = (k: SortKey, label: string) => <button type="button" className="hover:text-foreground" onClick={() => changeSort(k)} aria-label={`按${label}排序`}>{label}{arrow(k)}</button>;
  const exportOwner=state.account??mining?.account;
  const renderRow=(row:typeof rows[number],index:number)=> {
    const members = qualityTableMembers(row);
    const rowTimeBasis = qualityRowMonitorTimeBasis(study, row);
    const jumping = jumpingSignalId === row.source.id;
    const jumpDisabled = jumping || !onJump || !!canJump && !canJump(row.source);
    const entries = [...new Map(members.map(member => [member.signalId ?? member.id, member])).values()];
    return (<tr key={row.id} style={{ height: rowPx }} className="group hover:bg-accent/30" data-testid="quality-fish-row">
          <td className={`${cell} sticky left-0 z-10 border-t border-border/40 bg-background font-mono group-hover:bg-accent`} title={`${(isTuringCupSymbol(row.source.symbol) ? '离线行情' : EXCHANGE_NAMES[row.source.exchange ?? 'binance'])} · 来源：${qualitySourceLabel(row)}`}><span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5"><span className={`w-5 shrink-0 select-none text-right text-[9px] tabular-nums ${rowSelected(row) ? 'font-medium text-primary' : 'text-muted-foreground/55'}`} data-testid="quality-row-number">{index + 1}</span><input type="checkbox" aria-label={`选择 ${row.source.symbol} ${date(qualitySignalTime(row.source))}${row.detectorId ? ` ${detectorMap.get(row.detectorId)?.label} ${detectorMap.get(row.detectorId)?.snapshot.threshold}` : detectorExpanded ? ' 信号库' : ' 合并信号'}`} title="按住 Shift 点另一行可连续选择" checked={rowSelected(row)} ref={el => { if (el) el.indeterminate = !rowSelected(row) && members.some(member => selectedIds.has(member.id)); }} disabled={!ready || !!lockedBatch} onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }} onChange={e => toggleRow(row.id, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)} className="h-3 w-3 shrink-0 accent-[hsl(var(--primary))]"/><button type="button" aria-label={`查看 ${row.source.symbol} 盘面`} title={`查看 ${row.source.symbol} 在 ${date(row.source.timeMs)} 的盘面`} disabled={jumpDisabled} aria-busy={jumping || undefined} onClick={() => onJump?.(row.source)} className={`${wrapCell} min-w-0 max-w-full rounded-sm text-left text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:text-inherit disabled:no-underline`}>{turingCupTicker(row.source.symbol)}</button>{jumping && <span role="status" className="font-sans text-[9px] text-muted-foreground">正在加载…</span>}{row.source.turingReplaySample && <span className="font-sans text-[9px] text-muted-foreground" title="图灵杯行情的模拟入场点">回放样本</span>}</span>{!isTuringCupSymbol(row.source.symbol) && row.source.exchange && row.source.exchange !== 'binance' && <span className="ml-1 font-sans text-[9px] text-muted-foreground">{EXCHANGE_NAMES[row.source.exchange]}</span>}</td>

          <td className={`${cell} border-t border-border/40 font-mono text-muted-foreground`} title={entries.length > 1 ? `合并 ${entries.length} 个入场记录 · 展开明细查看` : `模拟买入：${date(qualityMonitorEntryAt(row, rowTimeBasis))}（${rowTimeBasis ? qualityMonitorTimeLabels[rowTimeBasis] : row.source.preEntryMonitor||row.monitorEntry?'动态筛选首次满足':row.basis === 'detected' ? '实际发现' : row.basis === 'capture' ? '捕捞时刻' : row.basis === 'missing' ? '时间缺失' : isLibrary(row) ? qualitySourceLabel(row) + '信号时间' : '原始信号'}）`}>{date(qualitySignalTime(row.source))}</td>
          {showCaptureTime && (() => { const at = qualityTableCaptureTime(row); return <td className={`${cell} border-t border-border/40 font-mono text-muted-foreground`} data-testid="quality-mined-at-cell">{at ? date(at) : '—'}</td>; })()}
          <td className={`${cell} border-t border-border/40 text-muted-foreground`}>{row.source.market === 'us_stock' ? '美股' : ''}</td>
          <td className={`${cell} border-t border-border/40`}><span className="flex gap-px" aria-label={`评分 ${normalizeSignalQuality(row.source.quality) ?? 0} 星`}>{!archiveView&&ready&&(onRate||state.setSourceQuality)?<SignalQualityStars signalId={`quality-${row.id}`} value={normalizeSignalQuality(row.source.quality)} onChange={value=>rateSource(row.source,value)}/>: [1, 2, 3, 4, 5].map(i => <Star key={i} className={`h-3 w-3 ${i <= (normalizeSignalQuality(row.source.quality) ?? 0) ? 'fill-[#F0B90B] text-[#F0B90B]' : 'text-muted-foreground/35'}`}/>)}</span></td>
          {showDetectorColumns && <><td className={`${cell} ${wrapCell} border-l border-t border-border/40`} data-testid="quality-detector-value-cell">{!detectorExpanded ? (() => { const count = members.filter(member => member.detectorId).length; return count ? <button type="button" className="text-primary hover:underline" title="展开每个探测算法在发现此信号时保存的读数" onClick={() => expandDetectors(true)}>{count} 项 · 展开</button> : <span className="text-muted-foreground/60" title="信号库的信号没有探测读数">—</span>; })() : (() => { const reading = qualityDetectorReading(row); return <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5" title={reading.detail}><span className="font-mono tabular-nums">{reading.text}</span>{row.detectorId && <span className="text-[9px] text-muted-foreground/65">{reading.label}</span>}</span>; })()}</td>
          <td className={`${cell} ${wrapCell} border-t border-border/40 text-muted-foreground`} data-testid="quality-detector-cell" data-detector-id={row.detectorId ?? ''} title={row.detectorId ? `${detectorMap.get(row.detectorId)?.metric} · ${detectorMap.get(row.detectorId)?.snapshot.interval ?? '5m'} · 公式版本 ${row.detectorId}` : '导入的信号不归属探测算法'}>{!detectorExpanded && row.groups.length > 0 ? <button type="button" className="text-primary hover:underline" onClick={() => expandDetectors(true)} title="展开此列表的探测算法与各次买入记录">{row.groups.length} 个算法 · 展开</button> : row.detectorId ? <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5"><span>{detectorMap.get(row.detectorId)?.label ?? '探测算法'}</span><span className="font-mono text-muted-foreground/70">{detectorMap.get(row.detectorId)?.snapshot.direction ?? '>'} {detectorMap.get(row.detectorId)?.snapshot.threshold}</span></span> : '—'}</td></>}
          {!hideFilter && <td className={`${cell} border-t border-border/40`}>{isLibrary(row) ? <span className="text-muted-foreground/60">—</span> : <FishProcessButton signal={row.source} captures={mergeCabinSignals ? [...new Map(members.map(member => [member.source.id, member.source])).values()] : undefined}/>}</td>}
          {shownFilters.map(column => { const reading = qualityFilterCell(row, column.filter, filterReadingMap); return <td key={column.id} className={`${cell} ${wrapCell} border-l border-t border-border/40`} data-testid="quality-filter-cell" data-filter-state={reading.state} title={reading.detail}><span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5"><span className="font-mono tabular-nums">{reading.value}</span><span className={`text-[9px] ${reading.state === 'pass' ? 'text-emerald-600 dark:text-emerald-400' : reading.state === 'fail' ? 'text-destructive' : 'text-muted-foreground'}`}>{reading.status}</span></span></td>; })}
          {shownSignalMetrics.map(metric=>{const reading=signalReadingCell(row,metric,signalReadingMap);return <td key={metric.id} className={`${cell} ${wrapCell} border-l border-t border-border/40 font-mono tabular-nums`} data-testid="quality-signal-reading-cell" data-signal-reading-value={reading.value ?? undefined} title={reading.detail}>{reading.value===null?<span className="font-sans text-muted-foreground">{reading.status}</span>:reading.text}</td>;})}
          {showScreening&&<ScreeningCells cell={cell} results={screeningRowResults(row,screeningIndex,screeningRoundId,screeningRunId)}/>}
          {shownPlans.map(p => {
            if(entries.length > 1) return <Fragment key={p.id}><MergedEntryCells entries={entries.map(member => ({result:qualityRowResult(study,member,p,resultMap),skipped:skippedBy(p,member)}))} phase={phase} planId={p.id} plan={p} expand={() => expandDetectors(true)}/><PostExitCells plan={p} expanded={postExitOpen.has(p.id)} entries={entries.map(member=>({row:member,result:qualityRowResult(study,member,p,resultMap),skipped:!!skippedBy(p,member)}))} readings={postExitReadings} onExpand={()=>togglePostExit(p.id)}/></Fragment>;
            const f = skippedBy(p, row), skipped = f && f.state !== 'pass', result = qualityRowResult(study,row,p,resultMap);
            return <Fragment key={p.id}><td className={`${cell} border-l border-t border-border/40`}>{skipped ? <span className="text-[9px] text-muted-foreground/60" title={f.detail}>{f.state === 'fail' ? '未买入' : f.state === 'pending' ? '待判断' : '买入过滤缺数据'}</span> : filtersOn && !hasQualityExit(p) ? <span className="text-[9px] text-muted-foreground/60">待设卖出</span> : <ResultCell plan={p} result={result} section="sell" onClick={() => setDetailId(members[0].id)} onOpenCampaign={rememberReturn}/>}</td>{phase === 'sell' && <><td className={`${cell} ${wrapCell} text-right border-t border-border/40 font-mono tabular-nums ${!skipped && (qualityDrawdownPct(result,'static')??0)>0?'text-destructive':'text-muted-foreground'}`} data-testid="quality-static-drawdown" data-sell-plan={p.id}>{pct(skipped?null:qualityDrawdownPct(result,'static')).replace(/^\+/, '')}</td><td className={`${cell} ${wrapCell} text-right border-t border-border/40 font-mono tabular-nums ${signed(skipped?null:qualityPeakPct(result))}`} data-testid="quality-peak-gain" data-sell-plan={p.id} title={skipped?f.detail:'持仓价格路径的峰值涨幅，与该笔交易战役读取同一份结果'}>{pct(skipped?null:qualityPeakPct(result))}</td><QualitySalePriceChangeCell plan={p} entries={[{result,skipped}]}/><td className={`${cell} ${wrapCell} text-right border-t border-border/40`} data-testid="quality-half-mirror" data-sell-plan={p.id}><QualityHalfMirrorCell plan={p} result={result} skipped={skipped?f.detail:undefined}/></td></>}{phase === 'sell' && <td className={`${cell} ${wrapCell} text-right border-t border-border/40 font-mono tabular-nums ${result?.status === 'open' ? 'text-foreground/80' : 'text-muted-foreground'}`} data-testid="quality-held-time" data-sell-plan={p.id} title={skipped ? f.detail : result?.status === 'open' ? '仍在持有：算到最近一次估值' : result?.reason}>{skipped || !(result?.status === 'closed' || result?.status === 'open') ? '—' : heldText(result.heldHours)}</td>}<PostExitCells plan={p} expanded={postExitOpen.has(p.id)} entries={[{row,result,skipped:!!skipped}]} readings={postExitReadings} onExpand={()=>togglePostExit(p.id)}/></Fragment>; })}
          <td className={`${cell} border-t border-border/40`}><button type="button" aria-label={`跳转 ${row.source.symbol}`} disabled={jumpDisabled} aria-busy={jumping || undefined} onClick={() => onJump?.(row.source)} className="text-primary disabled:opacity-30"><ArrowRightCircle className="h-3.5 w-3.5"/></button></td>
        </tr>);
  };
  const exportRows=()=>{try{
    if(tableExport)return;
    const picked=rows.flatMap((row,index)=>rowSelected(row)?[{row,index}]:[]);
    if(!picked.length)throw Error('请先勾选组合表中要导出的行');
    const header=tableRef.current?.querySelector('thead');
    if(!header)throw Error('组合表还没显示，无法导出');
    const empty=document.createElement('table');empty.appendChild(header.cloneNode(true));
    const sheet=readQualityTableSheet(empty);
    setError('');setTableExport({nodes:picked.map(({row,index})=>renderRow(row,index)),header:header.cloneNode(true) as HTMLTableSectionElement,offset:0,sheet,owner:exportOwner});
  }catch(error){const message=error instanceof Error?error.message:'导出失败';setError(message);toast.error(message);}};
  useEffect(()=>{
    if(!tableExport)return;
    const timer=window.setTimeout(()=>{try{
      if(tableExport.owner!==exportOwner)throw Error('账号已切换，请重新选择组合表行后导出');
      const body=exportTableRef.current?.tBodies[0];if(!body)throw Error('导出行尚未准备好，请重试');
      const table=document.createElement('table');table.append(tableExport.header.cloneNode(true),body.cloneNode(true));
      const batch=readQualityTableSheet(table),sheet={...tableExport.sheet,rows:[...tableExport.sheet.rows,...batch.rows]};
      const offset=Math.min(tableExport.offset+EXPORT_BATCH,tableExport.nodes.length);
      if(batch.rows.length!==offset-tableExport.offset)throw Error('已选行导出不完整，请重试');
      if(offset<tableExport.nodes.length)setTableExport({...tableExport,sheet,offset});
      else{downloadQualityTableSheet(sheet);setTableExport(null);}
    }catch(error){const message=error instanceof Error?error.message:'导出失败';setError(message);toast.error(message);setTableExport(null);}},0);
    return()=>window.clearTimeout(timer);
  },[tableExport,exportOwner]);

  const body=<section ref={rootRef} className="min-w-0 border-t border-border/50 px-4 py-3" aria-labelledby={titleId} data-testid={archiveView?"quality-archive-board":"fish-quality"}>
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5"><h3><button id={titleId} type="button" className={fishSectionHeading} aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)}><Gauge aria-hidden className="h-3 w-3 text-muted-foreground"/><span>{archiveView?'归档运行结果':'鱼质量'}</span>{archiveView&&<FishCount n={countSignals(allRows)}/>}<ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button></h3>
        <button type="button" aria-label="鱼质量说明" title="鱼质量说明" className={fishInfoTrigger} onClick={() => setManualOpen(true)}><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button>
      </div>
    </div>
    <FishQualityManual open={manualOpen} onOpenChange={setManualOpen}><>
      <p>批量捕捞、买前过滤、持仓监测独立运行和暂停。买前过滤分为静态过滤、动态筛选。开始过滤、筛选和监测，只处理当前来源、月份、探测算法和标的范围内已勾选的记录；本轮清单和条件在开始时冻结。</p>
      <p>勾选标的后点击「锁定所选」，可单独查看和处理本批。解除锁定可返回原筛选范围。</p>
      <p>批量捕捞按设置中的算法、门槛与组合方式扫描信号。开始按钮右侧的 ▾ 中可选「重新开始」。捕捞库按算法家族分目录，目录表格沿用组合表形式。</p>
      <p>静态过滤按每条条件选择的周期检查原入场时点之前最后一根已收盘的 K 线，不移动入场时间。动态筛选须让必要条件、准入与排除门槛同分钟共同通过。v7 支持防守线新事件与多条指标准入取或，否决后重建观察起点，原总截止时间不变；旧版方案保留原口径。</p>
      <p>动态筛选在条件设置中填写「单标的筛选时限（小时）」，新筛选默认 48 小时，已有正数设置保留。首次满足即停在命中时间；到时未满足则结束并继续下一条。时限从每个标的的筛选起点计，不是现实运行耗时。行情更短、缺数据或历史不足会按实际状态显示。</p>
      <p>动态筛选运行时显示完成条数与实际扫描进度；暂停或完成后收起进度提示。运行时点击进度、停止后从开始按钮右侧的 ▾ 选择「本轮筛选结果」，可查看全部状态、原因和首次满足时间。组合表随新轮开始更新，手动保存后可在筛选库的时间目录查看。静态过滤与动态筛选的显示和擦除各自独立。</p>
      <p>暂停继续沿用本轮冻结条件；要使用新条件和时限，选「从头重新筛选」。旧的无限时暂停轮次保留，主按钮另开有限时新轮次。保存方案只保存设置；「保存并开始三阶筛选」按新设置从头运行。</p>
      <p>持仓监测按各条记录自己的入场时间、当前方案及各条件的生效范围运行。已完成且条件未变的结果可沿用；要全部重算，从监测按钮右侧的 ▾ 选「从头重新计算」。</p>
      <p>在「来源」打开各库，勾选记录并导入组合表。表内删除只移除本表记录。静态过滤、手动筛选和持仓监测完成后，可在组合表保存到对应库。</p>
      <p>信号库与图灵杯按信号时间入场，历史鱼按首次能发现的捕捞时刻入场，实时新鱼按实际发现时点入场；动态入选记录改用首次满足时间。图灵杯使用独立离线行情。收益未扣手续费、资金费和滑点；缺数据不计为零收益，重叠探测分组的盈亏不直接相加。</p>
    </></FishQualityManual>
    {open && <div id={contentId} className="mt-2 space-y-2">
      {!archiveView&&<div className={fishRail} aria-label="鱼质量工作模块" data-testid="quality-modules">
        {mining && <FishMiningPanel openRequest={directoryRequests.mined} onSelectDirectory={workspace || lockedBatch ? undefined : (id,snapshot,ids)=>chooseDirectory('mined',id,snapshot,ids)} directoryEdits={study.monitorLibrary?.directoryEdits} onSetHidden={state.setLibraryEntryHidden} renderStudy={renderArchive} onCopyStudy={!workspace&&!lockedBatch&&state.restoreMonitorStudy?async(snapshot)=>{const copied=await state.restoreMonitorStudy!(snapshot);if(copied){setScreeningRunId(undefined);sourceDefaulted.current=true;setDirectoryChoice(undefined);setOrigin('');setQuery('');setMonth('');setAlgorithmsState([]);setOpen(true);resetScroll();}return copied;}:undefined} mining={mining} onJump={onJump} canJump={canJump} onSelectInTable={!workspace && !lockedBatch && ready && state.selectMiningRecords ? signals => {
          const result = state.selectMiningRecords!(signals);
          if (!result.selected) return false;
          sourceDefaulted.current=true;setDirectoryChoice(undefined);setOrigin('mined'); setQuery(''); setMonth(''); setAlgorithmsState([]);
          setSort('mined-at'); setAscending(false); selectAnchor.current = null; resetScroll();
          setError(result.selected < result.requested ? `有 ${result.requested - result.selected} 个入场记录暂未在组合表找到。` : '');
          return true;
        } : undefined} sellFixed={!!study.sellPlans?.some(p => p.id === study.selectedSellId && hasQualityExit(p))} campaignHref="/journal/campaigns?section=quality"/>}
        <FishQualityModuleGroup>
          <FishQualityModule level="submodule" title="静态过滤" icon={Filter} testId="quality-static-controls" trailing={<QualityResultTools kind="filter" hidden={hideFilter} onToggle={()=>toggleHidden('filter')} count={study.filterReadings?.length??0} onClear={lockedBatch ? undefined : state.clearFilterResults} disabled={!ready||state.signalValues?.running}/>}
            summary={<FishQualityInfo label="静态过滤说明"><p>信号时点读数按原信号时间生成。买前过滤按每条条件选择的周期检查原入场时点之前最后一根已收盘的 K 线。两项都只处理当前范围内已勾选的记录。</p><p>过滤库按时间目录查看各轮结果，表格与组合表一致。本模块的眼睛和擦除独立于动态筛选、持仓监测。</p></FishQualityInfo>}
            status={!staticRunning&&state.filterProgress&&<span role="status">{resumeFiltering?'已暂停':state.filterError?'过滤未完成':state.filterProgress.done===state.filterProgress.total?'过滤完成':'过滤未完成'} {state.filterProgress.done}/{state.filterProgress.total}</span>}>
          <div role="group" aria-label="静态过滤运行" className="inline-flex h-6 shrink-0 items-stretch">
            {staticRunning
              ? <button type="button" className={qualitySplitPauseAction} onClick={state.signalValues?.running ? state.cancelSignalValues : state.cancelFilter}>
                <Pause aria-hidden className="h-3 w-3"/>{state.signalValues?.running ? '暂停读数' : '暂停过滤'}
              </button>
              : <button type="button" className={qualitySplitPrimaryAction} disabled={!ready || (!resumeFiltering && !canStartStatic)}
                title={resumeFiltering ? '沿用本轮已冻结的信号和条件，有效读数直接复用' : !filtersOn && !readingsOn ? '先设置并启用买入过滤条件，或添加读数算法' : selectedCount ? `对已勾选的 ${selectedCount} 条信号运行已保存的设置` : '当前筛选下没有已勾选的信号'}
                onClick={() => void (resumeFiltering ? resumeFiltering() : (state.runStaticSettings ?? state.startFilter)())}>
                <Filter aria-hidden className="h-3 w-3"/>{resumeFiltering ? '继续过滤' : state.filterError ? '重试缺数据' : readingsOn ? filtersOn ? '开始运行' : '生成读数' : '开始过滤'}
              </button>}
            <Popover open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
              <PopoverTrigger asChild><button type="button" aria-label="开始过滤的其他方式" disabled={!ready}
                className={`${qualitySplitMenuAction} ${staticRunning ? 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}>
                <ChevronDown aria-hidden className="h-3 w-3"/>
              </button></PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-1">
                <button type="button" aria-label="重新开始" disabled={!canStartStatic || !state.runStaticSettings}
                  className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
                  onClick={() => { setFilterMenuOpen(false); void state.runStaticSettings?.(true); }}>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium"><RotateCcw aria-hidden className="h-3 w-3"/>重新开始</span>
                  <span className="text-[10px] leading-relaxed text-muted-foreground">{staticRunning ? '停止当前运行，再按当前勾选和已保存设置重新计算。' : '按当前勾选和已保存设置重新计算。'}</span>
                </button>
              </PopoverContent>
            </Popover>
          </div>
          {/* 【用户要求】2026-10-28 旁边已有「条件设置」，原「未设置过滤条件 · 点此设置」等行内提示纯属重复，已删除；为何不能开始见按钮悬停 */}
          <Popover open={filterOpen} onOpenChange={setFilterOpen}><PopoverTrigger asChild><button type="button" className={`${qualitySettingsAction} ${filtersOn ? 'text-foreground' : ''}`} aria-label="买入过滤条件" title={filtersOn ? activeStandaloneBuyFilters(study).map(f=>`${f.label} ${f.direction} ${f.threshold}`).join(' 且 ') : '设置独立的买前过滤条件'}><Settings2 className="h-3 w-3"/>条件设置</button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="fish-condition-settings">
            <FishConditionSettings title="静态过滤条件" description="读数和过滤可单独设置，也可以一起运行。"><BuyFilterEditor key={state.account} state={state} selectedCount={selectedCount} done={() => setFilterOpen(false)}/></FishConditionSettings>
          </PopoverContent></Popover>
          <FishFilterLibrary onRename={state.renameLibraryEntry} openRequest={directoryRequests.filter} onSelectDirectory={workspace || lockedBatch ? undefined : (id,snapshot,ids)=>chooseDirectory('filter',id,snapshot,ids)} study={study} onSetHidden={state.setLibraryEntryHidden} renderStudy={renderArchive} onCopyStudy={!workspace&&!lockedBatch&&state.restoreMonitorStudy?async(snapshot)=>{const copied=await state.restoreMonitorStudy!(snapshot);if(copied){setScreeningRunId(undefined);sourceDefaulted.current=true;setDirectoryChoice(undefined);setOrigin('');setQuery('');setMonth('');setAlgorithmsState([]);setOpen(true);resetScroll();}return copied;}:undefined}/>
          {staticRunning && <FishQualityProgress
            testId="static-filter-progress"
            label={staticProgress?.waitingUntil ? '等待续跑' : readingsRunning ? '生成读数中' : '过滤进行中'}
            progressLabel={readingsRunning ? '信号时点读数处理进度' : '买前过滤处理进度'}
            done={staticProgress?.done ?? 0} total={staticProgress?.total ?? 0} waitingUntil={staticProgress?.waitingUntil}
            hitCount={!readingsRunning && staticProgress?.matched != null
              ? {value:staticProgress.matched,title:'本轮满足全部买前过滤条件的记录数'}
              : undefined}
          />}
          {state.signalValues?.error && <p role="alert" className="text-[11px] text-destructive">{state.signalValues.error}</p>}
          {state.filterError && <p role="alert" className="text-[11px] text-destructive">{state.filterError}</p>}
          </FishQualityModule>
          {state.preEntry&&<FishQualityModule level="submodule" title="动态筛选" icon={Activity} testId="quality-dynamic-controls"
            trailing={<QualityResultTools kind="screening" hidden={hideScreening} onToggle={()=>toggleHidden('screening')} count={screeningResults.length} onClear={lockedBatch ? undefined : state.clearScreeningResults} disabled={!ready||!state.preEntry?.ready||!!state.archiving}/>} summary={<FishQualityInfo label="动态筛选说明"><ol className="list-decimal space-y-2 pl-4"><li>必要条件。原信号时点全部通过，或跳过本步，即可继续。未通过时可启用动态门槛逐分钟追踪。</li><li>事件准入。任一启用项触发即成为候选。首次进入本步时，已达标的指标也可触发。跳过本步时，具备资格的观察时点直接成为候选。</li><li>排除检查。从候选时点向前检查。通过或跳过本步即入选。被排除就继续找候选，沿用原截止时间。</li></ol><p>三步开关适用于新版方案。已保存方案按冻结版本运行。</p></FishQualityInfo>}>
            <FishPreEntryMonitor openRequest={directoryRequests['pre-entry']} onSelectDirectory={workspace || lockedBatch ? undefined : (id,snapshot,ids)=>chooseDirectory('pre-entry',id,snapshot,ids)} onSetHidden={state.setLibraryEntryHidden} renderStudy={renderArchive} onCopyStudy={!workspace&&!lockedBatch&&state.restoreMonitorStudy?async(snapshot)=>{const copied=await state.restoreMonitorStudy!(snapshot);if(copied){setScreeningRunId(undefined);sourceDefaulted.current=true;setDirectoryChoice(undefined);setOrigin('');setQuery('');setMonth('');setAlgorithmsState([]);setOpen(true);resetScroll();}return copied;}:undefined} state={state} selectedCount={selectedCount} filtersOn={state.preEntry.library.settings?state.preEntry.library.settings.plans.length>0:filtersOn} onJump={onJump}
              onSelected={()=>{sourceDefaulted.current=true;setDirectoryChoice(undefined);setOrigin('pre-entry');setQuery('');setMonth('');setAlgorithmsState([]);setOpen(true);resetScroll();}}/>
          </FishQualityModule>}
        </FishQualityModuleGroup>
        <FishQualityModule title="持仓监测" icon={Activity} testId="quality-run-controls" trailing={<QualityResultTools kind="monitor" hidden={hideMonitor} onToggle={() => toggleHidden('monitor')} count={study.results.length} onClear={lockedBatch ? undefined : state.clearMonitorResults} disabled={!ready || !!state.archiving}/>} titleTestId="quality-mode" summary={<FishQualityInfo label="持仓监测说明"><p>100 USDT · 1 倍</p>{vetoCount > 0 && <p>{vetoCount} 项监测条件</p>}<p className="text-muted-foreground">按已勾选信号和当前卖出规则独立监测，支持后台运行；已算完且条件没变的结果直接沿用；要全部重算，点监测按钮右侧的 ▾。归档按时间排列，目录内使用当时的组合表快照，后续重算不会覆盖。</p><p>开始时可选原信号时间或动态筛选的首次满足时间。继续监测沿用本轮起点。各次加仓及其后的卖出条件按方案保存的生效范围执行。</p></FishQualityInfo>} status={!running && lastPause && <p className="max-w-[22rem] truncate text-muted-foreground" data-testid="quality-last-pause" title={`上一轮于 ${formatUTC8(lastPause.at)}（UTC+8）暂停：${lastPause.reason}`}>已暂停：{lastPause.reason}</p>}>
          <div role="group" aria-label="监测运行" className="inline-flex h-6 shrink-0 items-stretch">
            {running ? <button type="button" className={qualitySplitPauseAction} onClick={state.cancel}><Pause aria-hidden className="h-3 w-3"/>暂停监测</button>
              : resumeMonitoring ? <button type="button" className={qualitySplitPrimaryAction} disabled={!ready || !!state.archiving}
                title="沿用本轮已冻结的信号、方案和监测起点" onClick={() => void resumeMonitoring()}><RefreshCw aria-hidden className="h-3 w-3"/>继续监测</button>
              : <MonitorTimePicker onChoose={basis => void state.start(false, undefined, false, basis)}
                trigger={<button type="button" className={qualitySplitPrimaryAction} disabled={!ready || !!state.archiving || !selectedCount || !plans.length}
                  title={!selectedCount && outsideSelection ? `勾选的 ${outsideSelection.count} 条都在当前筛选外（${outsideSelection.text}）：点筛选栏右侧「切到包含勾选的筛选」` : selectedCount ? `为已勾选的 ${selectedCount} 条信号选择监测起点` : '当前筛选下没有已勾选的信号'}>
                  <RefreshCw aria-hidden className="h-3 w-3"/>开始监测
                </button>}/>}
            <MonitorTimePicker restart running={running} onChoose={basis => void state.restart(basis)}
              trigger={<button type="button" aria-label="开始监测的其他方式" title="从头重新计算" disabled={!ready || !!state.archiving || !selectedCount || !plans.length}
                className={`${qualitySplitMenuAction} ${running ? 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground' : 'border-primary/25 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/20'}`}>
                <ChevronDown aria-hidden className="h-3 w-3"/>
              </button>}/>
          </div>
          <Popover open={monitorOpen} onOpenChange={setMonitorOpen}><PopoverTrigger asChild><button type="button" className={`${qualitySettingsAction} ${vetoCount > 0 ? 'text-foreground' : ''}`} aria-label="持仓监测条件" title={vetoCount ? plans.map(p => `${p.label}：${activeHoldingVetoes(p.holdingVetoes).length} 条原始否决${p.vetoStages?.length?` · ${p.vetoStages.length} 个一票次数阶段`:''}${p.sellStages?.length?` · ${p.sellStages.length} 个卖出次数阶段`:''}${p.mirrorTakeProfit?.enabled ? ` · 镜像平衡减仓 ${p.mirrorTakeProfit.gainPct}% / ${p.mirrorTakeProfit.sellPct}%` : ''}`).join('\n') : '选择和编辑卖出算法、条件加仓、镜像平衡减仓与持仓否决'}><Settings2 className="h-3 w-3"/>条件设置</button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="fish-condition-settings">
            <FishConditionSettings imageExport title="持仓监测条件" description="按方案设置卖出、加仓、镜像和持仓否决"><HoldingMonitorSettings state={state} activeId={monitorPlanId} onSelect={setMonitorPlanId} done={() => setMonitorOpen(false)} selectedCount={selectedCount} outsideHint={!selectedCount ? outsideHint : null}/></FishConditionSettings>
          </PopoverContent></Popover>
          <FishMonitorLibrary openRequest={directoryRequests.monitor} onRename={state.renameLibraryEntry} study={study} loadArchive={state.loadMonitorArchive} onSetHidden={state.setMonitorEntryHidden} onCopyStudy={!workspace&&!lockedBatch&&state.restoreMonitorStudy?async(snapshot,sourceRoundId)=>{const copied=await state.restoreMonitorStudy!(snapshot,sourceRoundId);if(copied){setScreeningRunId(undefined);sourceDefaulted.current=true;setDirectoryChoice(undefined);setOrigin('');setQuery('');setMonth('');setAlgorithmsState([]);setOpen(true);resetScroll();}return copied;}:undefined} onJump={onJump} canJump={canJump} onOpenCampaign={rememberReturn} renderStudy={renderArchive}/>
          {running && <FishQualityProgress testId="holding-monitor-progress" progressLabel="持仓监测处理进度"
            label={progress?.waitingUntil ? '等待续跑' : '监测进行中'} done={progress?.done ?? 0} total={progress?.total ?? 0}
            waitingUntil={progress?.waitingUntil} detail={study.monitorTimeBasis && `监测起点：${qualityMonitorTimeLabels[study.monitorTimeBasis]}`}/>}
        </FishQualityModule>
        {state.preEntry && <FishInstantTrading key={state.account} state={state}>
          <FishScreened state={state} library={state.preEntry.library} ratings={study.sourceRatings} onJump={onJump} canJump={canJump} onRate={onRate}
            jumpingSignalId={jumpingSignalId} tradedDayIndex={tradedDayIndex} campaignDayIndex={campaignDayIndex}/>
        </FishInstantTrading>}
      </div>}
      {workspace && <FishQualityModule title="来源" icon={Database} testId="quality-workspace-sources">
        <FishWorkspaceSource name="信号库" snapshot={workspace.sources?.library} onImport={importWorkspace}/>
        <FishWorkspaceSource name="图灵杯" snapshot={workspace.sources?.turing} onImport={importWorkspace}/>
        <FishWorkspaceSource name="鱼舱" snapshot={workspace.sources?.fish} onImport={importWorkspace}/>
        {mining ? <button type="button" className={fishSourceButton} onClick={()=>openWorkspaceLibrary('mined')}><Database aria-hidden className="h-3 w-3"/>捕捞库</button> :
          <FishWorkspaceSource name="捕捞库" snapshot={workspace.sources?.mined} onImport={importWorkspace}/>}
        <button type="button" className={fishSourceButton} onClick={()=>openWorkspaceLibrary('filter')}><Database aria-hidden className="h-3 w-3"/>过滤库</button>
        <button type="button" className={fishSourceButton} disabled={!state.preEntry} onClick={()=>openWorkspaceLibrary('pre-entry')}><Database aria-hidden className="h-3 w-3"/>筛选库</button>
        <button type="button" className={fishSourceButton} onClick={()=>openWorkspaceLibrary('monitor')}><Database aria-hidden className="h-3 w-3"/>监测库</button>
      </FishQualityModule>}
      {!lockedBatch && <div className="flex flex-wrap items-center gap-1.5">
        {!workspace && <FishQualitySourcePicker value={origin} onSelect={selectSource} options={[
          {value:'',label:'全部来源',count:countSignals(batch)},
          {value:'library',label:'信号库',count:countSignals(batch.filter(r=>hasSource(r,'library')))},
          {value:'turing',label:'图灵杯',count:countSignals(batch.filter(r=>hasSource(r,'turing')))},
          ...(!archiveView?[{value:'filter' as const,label:'过滤库',count:new Set(study.filterLibrary?.records.map(r=>qualityEntryIdentity(r.source,r.enteredAt))).size}]:[]),
          {value:'pre-entry',label:'筛选库',count:state.preEntry?new Set(state.preEntry.library.records.filter(r=>r.status==='matched').map(r=>[r.sample.source.symbol,r.matchedAt].join('|'))).size:countSignals(batch.filter(r=>hasSource(r,'pre-entry')))},
          {value:'mined',label:'捕捞库',count:countSignals(batch.filter(r=>hasSource(r,'mined')))},
          {value:'fish',label:'鱼舱',count:countSignals(batch.filter(r=>hasSource(r,'fish')))},
        ]}/>}
        {!workspace&&directoryChoice&&<span className="text-[10px] text-muted-foreground" data-testid="quality-active-directory">已选目录{directoryIds.length>1?`（${directoryIds.length}）`:''}：{directoryIds.map(id=>directoryEdits?.[id]?.name||(id==='filter-legacy'?'历史记录':directoryChoice.kind==='mined'?id.replace('mining-family-','')+' 系列':formatUTC8(directoryChoice.kind==='filter'?study.filterLibrary?.rounds.find(r=>r.id===id)?.startedAt??0:state.preEntry?.library.rounds.find(r=>r.id===id)?.startedAt??0))).join('、')}</span>}
        <span className="relative shrink-0"><select aria-label="鱼质量的月份" title="按信号发生月份筛选。可在捕捞库按实际捕捞日期搜索，再带到组合表。" className={`${field} appearance-none pr-6 font-mono`} value={month} onChange={e => { setMonth(e.target.value); resetScroll(); }}><option value="">全部月份（{countSignals(narrowed)}）</option>{months.map(m => <option key={m} value={m}>{m}（{monthCounts.get(m) ?? 0}）</option>)}</select><ChevronDown className="pointer-events-none absolute right-1.5 top-2 h-3 w-3 text-muted-foreground/60"/></span>
        <input aria-label="筛选鱼质量信号" placeholder="筛选标的…" value={query} onChange={e => { setQuery(e.target.value); resetScroll(); }} className={`${field} min-w-32 flex-1 placeholder:text-muted-foreground/50`}/>
        {workspace && groups.length > 0 && <DetectorPicker choices={detectorChoices} signalsOf={signalsOf} selected={activeAlgorithms} onChange={setAlgorithms}>
          <button type="button" aria-label="按探测算法筛选" title={chosenChoices.length ? chosenChoices.map(choiceText).join('、') : '按探测算法筛选'}
            className={button + (activeAlgorithms.length ? ' bg-primary/15 text-primary' : '')}><Filter aria-hidden className="h-3.5 w-3.5"/>{chosenChoices.length > 0 && <span className="font-mono tabular-nums">{chosenChoices.length}</span>}</button>
        </DetectorPicker>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1 text-[10.5px] text-muted-foreground" data-testid="quality-selection-scope"><span className="tabular-nums" data-testid="quality-run-scope">{selectedCount === selectedTotal ? `本轮处理已勾选 ${selectedCount} 条` : <>本轮处理 <span className="text-foreground">{selectedCount}</span> 条 · </>}</span>{outsideHint}<FishQualityInfo label="处理范围说明"><p>开始筛选、开始监测只处理当前表内经月份、探测算法和标的筛选后已勾选的信号，筛选外勾着的这一轮不处理。</p><p className="text-muted-foreground">已勾选 {selectedEntryCount} 次入场。开始时冻结勾选清单，之后调整勾选用于下一轮。</p></FishQualityInfo></div>
      </div>}
      {state.archiving&&<p role="status" className="text-[11px] text-primary" data-testid="quality-archive-saving">{workspace?'正在保存结果…':'正在归档全部运行结果到监测库…保存完成后开始重算。'}</p>}
      {state.entry&&(state.entry.running||state.entry.error)&&<div className="flex items-center gap-3 text-[10px] text-muted-foreground" data-testid="quality-entry-progress"><span>入场读数 {state.entry.progress?.done??0}/{state.entry.progress?.total??0}</span>{state.entry.running?<button type="button" className="text-primary hover:underline" onClick={state.entry.cancel}>暂停入场补算</button>:<button type="button" className="text-primary hover:underline" onClick={()=>state.entry?.request(plans.map(p=>p.id),visible.flatMap(qualityTableMembers).map(r=>r.signalId??r.id),true)}>重试入场读数</button>}{state.entry.error&&<span className="text-destructive">{state.entry.error}</span>}</div>}
      {!archiveView&&postExitPlanIds.length>0&&<div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground" data-testid="quality-post-exit-progress"><span>卖后反事实 · 以实际最终卖出价为基准 · 0.5 / 1 / 2 / 4 / 6h</span>{state.postExit?.running?<><span role="status">补算 {state.postExit.progress?.done??0}/{state.postExit.progress?.total??0}</span><button type="button" className="text-primary hover:underline" onClick={state.postExit.cancel}>暂停反事实</button></>:<button type="button" className="text-primary hover:underline" onClick={()=>requestObservations(true)}>补算 / 重试反事实</button>}{state.postExit?.error&&<span className="text-destructive">{state.postExit.error}</span>}</div>}
      {!ready && <p role="status" className="text-[10.5px] text-muted-foreground">恢复本机记录…</p>}
      {(error || state.warning || state.error) && <p role="alert" className="text-[11px] text-destructive">{error || state.error || state.warning}</p>}
      {/* 表格到达上下边界后，滚轮自然交给「渔」面板，避免只能移到表格外才能继续滚动。 */}
      <div className="flex flex-wrap items-center justify-between gap-2" data-testid="quality-combination-toolbar"><div className="inline-flex items-center gap-0.5"><h4 className="text-xs font-medium text-foreground" data-testid="quality-combination-title">组合表</h4><FishCombinationHelp workspace={!!workspace}/>
          {lockedBatch && <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground" data-testid="quality-locked-batch">
            已锁定 {selectedCount} 条信号{batch.length < lockedBatch.rowIds.length ? ` · ${lockedBatch.rowIds.length - batch.length} 行已不可用` : ''}
          </span>}
        </div>
        <div className="flex items-center gap-1">
          {lockedBatch && <button type="button" className="px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline disabled:opacity-40" disabled={!!state.archiving} onClick={unlockSelection}>解除锁定</button>}
          {!workspace && !archiveView && !lockedBatch && state.setLockedBatch && <button type="button" className={button} disabled={!ready || !selectedCount || !!state.archiving}
            title="固定当前筛选内已勾选的记录，单独查看和处理这一批" onClick={lockSelection}>
            <Lock aria-hidden className="h-3 w-3"/>锁定所选
          </button>}
          {workspace && completeFiltering && <button type="button" className={button} disabled={staticRunning||!!state.archiving} onClick={()=>void workspace.saveFiltering().then(ok=>{if(ok)toast.success('过滤结果已保存到过滤库');})}><Save aria-hidden className="h-3 w-3"/>保存到过滤库</button>}
          {workspace && completeScreening > 0 && <button type="button" className={button} disabled={!!state.preEntry?.savingWorkspaceDraft} onClick={()=>void state.preEntry?.saveWorkspaceScreening?.().then(ok=>{if(ok)toast.success('筛选结果已保存到筛选库');})}><Save aria-hidden className="h-3 w-3"/>保存到筛选库</button>}
          {workspace && completeMonitoring > 0 && <button type="button" className={button} disabled={running||!!state.archiving} onClick={()=>void workspace.saveMonitoring().then(ok=>{if(ok)toast.success('监测结果已保存到监测库');})}><Save aria-hidden className="h-3 w-3"/>保存到监测库</button>}
          {workspace && <Popover open={confirmRemove} onOpenChange={setConfirmRemove}><PopoverTrigger asChild>
            <button type="button" className={button} disabled={!ready||!selectedRowCount}><Trash2 aria-hidden className="h-3 w-3"/>删除所选行</button>
          </PopoverTrigger><PopoverContent align="end" className="w-60 space-y-2 p-3 text-[11px]">
            <p>从组合表移除 {selectedRowCount} 行？原库记录会保留。</p>
            <button type="button" className={button+' text-destructive'} onClick={()=>{
              workspace.removeRows(rows.filter(rowSelected).flatMap(qualityTableMembers).map(row=>row.id));
              setConfirmRemove(false);resetScroll();
            }}>确认删除所选行</button>
          </PopoverContent></Popover>}
          <button type="button" className={button} disabled={!selectedRowCount||!!tableExport} onClick={exportRows} aria-label="导出已选组合表数据" title={selectedRowCount?'只导出当前组合表中已勾选的 '+selectedRowCount+' 行':'请先勾选组合表中要导出的行'}><Download className="h-3 w-3"/>{tableExport?'正在导出 '+tableExport.offset+'/'+tableExport.nodes.length:'导出数据'}</button>
        </div>
      </div>
      {tableExport&&<div hidden aria-hidden="true" data-testid="quality-export-batch"><table ref={exportTableRef}><tbody>{tableExport.nodes.slice(tableExport.offset,tableExport.offset+EXPORT_BATCH)}</tbody></table></div>}
      {rows.length ? <div ref={tableRef} onScroll={e => {const next=e.currentTarget.scrollTop;setScrollTop(current=>current===next?current:next);}} className="max-h-[28rem] w-fit max-w-full overflow-auto overscroll-x-contain overscroll-y-auto rounded-lg border border-border/60 [overflow-anchor:none]" aria-label="组合表" data-testid="quality-fish-table"><table className="table-fixed border-separate border-spacing-0 whitespace-nowrap text-left text-[10px]" style={{width:columnWidths.reduce((sum,width)=>sum+width,0)}}><colgroup>{columnWidths.map((width,i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead className="sticky top-0 z-20 bg-background text-[9px] font-medium text-muted-foreground">
          <tr className="bg-muted/35" data-testid="quality-algorithm-categories">
              <th colSpan={showCaptureTime?5:4} className="px-2 py-1.5 text-[9px] font-normal text-muted-foreground/70">入场信息</th>
            {!hideFilter && <><th colSpan={(showDetectorColumns?3:1)+shownFilters.length+shownSignalMetrics.length} className="relative border-l border-border/40 px-2 py-1.5 font-medium" data-testid="quality-filter-group">静态过滤</th></>}
            {showScreening&&<th colSpan={4} className="relative border-l border-border/40 px-2 py-1.5 font-medium" data-testid="quality-screening-group">动态筛选</th>}
            {shownPlans.length > 0 && <th colSpan={qualitySellSpan(shownPlans,postExitOpen)} className="relative border-l border-border/40 px-2 py-1.5 font-medium" data-testid="quality-monitor-group">持仓监测</th>}
            <th aria-hidden="true"/>
          </tr>
          <tr className="bg-muted/20" data-testid="quality-algorithm-variables">
            <th colSpan={showCaptureTime?5:4} className="px-2 py-1 text-[9px] font-normal text-muted-foreground/50">变量 / 水平</th>
            {showDetectorColumns && <><th aria-hidden="true" className="border-l border-border/40"/>
            <th className="relative px-2 py-1 font-normal text-muted-foreground/60" aria-label="探测变量数量">{detectorChoices.length ? `${detectorChoices.length} 个默认算法` : ''}</th>
            </>}
            {!hideFilter && <th aria-hidden="true"/>}
            {qualityVariables(shownFilters.map(c => c.filter)).map(v => <th key={v.id} colSpan={v.levels.length} className="relative border-l border-border/40 px-2 py-1.5 font-normal" aria-label={`过滤变量 ${v.label}`}>{v.label}{v.levels.length > 1 && <span className="ml-2 text-muted-foreground/50">{v.levels.length} 个水平</span>}</th>)}
            {!!shownSignalMetrics.length && <th colSpan={shownSignalMetrics.length} className="border-l border-border/40 px-2 py-1 font-normal">原信号时点</th>}
            {showScreening&&<th colSpan={4} className="relative border-l border-border/40 px-2 py-1 font-normal text-muted-foreground/60">冻结方案与首次满足结果</th>}
            {!hideMonitor && sellVariables.map(v => <th key={v.id} colSpan={qualitySellSpan(v.levels,postExitOpen)} className="relative border-l border-border/40 px-2 py-1.5 font-normal" aria-label={`卖出变量 ${v.label}`}>{v.label}{v.levels.length > 1 && <span className="ml-2 text-muted-foreground/50">{v.levels.length} 个水平</span>}</th>)}
            <th aria-hidden="true"/>
          </tr>
          <tr className="bg-muted/40">
          <th className={`${cell} sticky left-0 z-30 bg-muted font-medium`} aria-sort={ariaSort('symbol')}><span className="flex items-center gap-1.5"><span aria-hidden className="w-5 shrink-0"/><input type="checkbox" aria-label="全选当前筛选信号" title="全选当前筛选下的所有行；按住 Shift 点两行可连续选择" checked={allSelected} ref={el => { if (el) el.indeterminate = selectedRows.length > 0 && !allSelected; }} disabled={!ready || !!lockedBatch} onChange={e => selectVisible(e.target.checked)} className="h-3 w-3 accent-[hsl(var(--primary))]"/>{sortButton('symbol', '标的')}</span></th>
          <th className={`${cell} font-medium`} aria-sort={ariaSort('time')}>{sortButton('time', '信号时间')}</th>
          {showCaptureTime && <th className={`${cell} font-medium`} data-testid="quality-mined-at-column" aria-sort={ariaSort('mined-at')} title="实际捕捞到该信号的时间（北京时间）。同一入场有多次捕捞时显示最近一次。">{sortButton('mined-at', '捕捞时间')}</th>}
          <th className={`${cell} font-medium`} aria-sort={ariaSort('market')}>{sortButton('market', '市场')}</th>
          <th className={`${cell} font-medium`} aria-sort={ariaSort('quality')}>{sortButton('quality', '评分')}</th>
          {showDetectorColumns && <><th className={`${cell} border-l border-border/40 font-medium`} data-testid="quality-detector-value-column" aria-sort={ariaSort('detector-value')} title="当次探测快照的读数，按捕获时的倍率显示；展开后每个探测算法各占一行"><span className="inline-flex items-center gap-2">{sortButton('detector-value', '探测值')}<button type="button" aria-label="展开探测值明细" aria-expanded={detectorExpanded} onClick={() => expandDetectors(!detectorExpanded)} className="inline-flex items-center gap-1 text-primary hover:underline">{detectorExpanded ? '收起' : '展开'}<ChevronDown className={`h-3 w-3 ${detectorExpanded ? 'rotate-180' : ''}`}/></button></span></th>
          <th className={`${cell} relative font-medium`} data-testid="quality-detector-column" aria-sort={ariaSort('detector')}><span className="inline-flex items-center gap-2">{sortButton('detector', '探测算法')}{!lockedBatch && groups.length > 0 && <DetectorPicker choices={detectorChoices} signalsOf={signalsOf} selected={activeAlgorithms} onChange={setAlgorithms}><button type="button" aria-label="在表头选择探测算法" title={chosenChoices.length ? chosenChoices.map(choiceText).join('、') : '选择一个或多个探测算法'} className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 ${activeAlgorithms.length ? 'bg-primary/15 text-primary' : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground'}`}><Filter className="h-3 w-3"/>{chosenChoices.length > 0 && <span className="font-mono text-[10px] tabular-nums">{chosenChoices.length}</span>}</button></DetectorPicker>}<button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" aria-label="展开探测算法明细" aria-expanded={detectorExpanded} onClick={() => expandDetectors(!detectorExpanded)}>{detectorExpanded ? '收起' : '展开'}<ChevronDown className={`h-3 w-3 ${detectorExpanded ? 'rotate-180' : ''}`}/></button></span></th></>}
          {!hideFilter && <th className={`${cell} font-medium`} aria-sort={ariaSort('process')} title="按捕捞时刻排序；信号库在最后">{sortButton('process', '捕捞过程')}</th>}
          {shownFilters.map(column => <th key={column.id} className={`${cell} ${wrapCell} relative border-l border-border/40 font-medium`} data-testid="quality-filter-column" aria-sort={ariaSort(`filter:${column.id}`)} title="买入时刻之前最后一根已收盘 K 线的读数；独立过滤，不限制卖出监测。"><button type="button" className="block text-left hover:text-foreground" aria-label={`按过滤${column.filter.label} ${column.filter.direction} ${column.filter.threshold}读数排序`} onClick={() => changeSort(`filter:${column.id}`)}>过滤 · {column.filter.label}{arrow(`filter:${column.id}`)}</button><span className="mt-0.5 block font-mono text-primary">{column.filter.direction} {column.filter.threshold}</span></th>)}
          {shownSignalMetrics.map(metric=><th key={metric.id} className={`${cell} ${wrapCell} border-l border-border/40 font-medium`} data-testid="quality-signal-reading-column" aria-sort={ariaSort(`signal-value:${metric.id}`)} title={`原信号时点读数 · 算法周期 ${metric.snapshot.interval}`}>{sortButton(`signal-value:${metric.id}`,metric.label)}</th>)}
          {showScreening&&<ScreeningHeaders cell={cell} sort={sort} ascending={ascending} onSort={changeSort}/>}
          {shownPlans.map(p => <Fragment key={p.id}><th className={`${cell} border-l border-border/40 font-medium`} data-testid="quality-sell-column" aria-sort={sort === `sell:${p.id}` ? ascending ? 'ascending' : 'descending' : 'none'}><span className={`${SELL_PARTS} font-medium`} data-testid="quality-sell-parts"><button type="button" className="text-left hover:text-foreground" aria-label={`按${p.label}加仓次数排序`} onClick={()=>changeSort(`addition:${p.id}`)}>加仓次数{arrow(`addition:${p.id}`)}</button><button type="button" className="text-left hover:text-foreground" title="与交易战役同口径：几何仓位 M＝(1 − αf) × ∏(1 + αₖ)，αf 为首次加仓前已卖出的首仓比例（镜像平衡减仓），αₖ＝第 k 次加仓币数 ÷ 加仓前持币数；没有加仓时已卖出的计入镜像，仍持有的记 1。" aria-label={`按${p.label}几何仓位排序`} onClick={()=>changeSort(`geometric:${p.id}`)}>几何仓位{arrow(`geometric:${p.id}`)}</button><button type="button" className="text-left hover:text-foreground" title="与交易战役同口径：G＝(F − Kₘ) ÷ (E − K初)，F 最终卖出价、Kₘ 最后一次加仓的止损线、E 首次买入价、K初 优先由组合算法起始阶段的限制静态最大回撤得出；只算有加仓且已卖出的持仓。" aria-label={`按${p.label}相对涨幅排序`} onClick={()=>changeSort(`relative:${p.id}`)}>相对涨幅{arrow(`relative:${p.id}`)}</button><button type="button" className="text-left hover:text-foreground" title="与交易战役同口径：盈亏比＝已实现净盈亏 ÷ 初始最大预期亏损 L₀，单位 R；L₀＝初始仓位 × 初始静态回撤阈值，优先取组合算法起始阶段的限制阈值；只算已卖出的持仓。" aria-label={`按${p.label}盈亏比排序`} onClick={()=>changeSort(`payoff:${p.id}`)}>盈亏比{arrow(`payoff:${p.id}`)}</button></span></th>{phase === 'sell' && <><th className={`${cell} text-right font-medium`} aria-sort={ariaSort(`static:${p.id}`)} title="相对买入价到持仓最低价的最大跌幅，至少为 0%。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}静态最大回撤排序`} onClick={()=>changeSort(`static:${p.id}`)}>静态最大回撤{arrow(`static:${p.id}`)}</button></th><th className={`${cell} text-right font-medium`} aria-sort={ariaSort(`peak:${p.id}`)} title="与交易战役同口径：持仓期间相对买入价的最大有利价格涨幅，读取该轮冻结结果；不等于组合收益。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}峰值涨幅排序`} onClick={()=>changeSort(`peak:${p.id}`)}>峰值涨幅{arrow(`peak:${p.id}`)}</button></th><th className={`${cell} text-right font-medium`} data-testid="quality-price-change-header" aria-sort={ariaSort(`price-change:${p.id}`)} title="与交易战役「首仓涨跌幅」同口径：（最终卖出价 ÷ 首次买入价 − 1）×100%，首仓从买入到实际完成卖出的涨跌幅。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}首仓涨幅排序`} onClick={()=>changeSort(`price-change:${p.id}`)}>首仓涨幅{arrow(`price-change:${p.id}`)}</button></th><th className={`${cell} text-right font-medium`} aria-sort={ariaSort(`mirror:${p.id}`)} title="开仓至镜像平衡减仓成交时的实际涨幅 =（镜像成交价 ÷ 开仓价 − 1）× 100%；不乘卖出比例，不含余仓后续涨跌。未触发不记作零涨幅。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}镜像平衡减仓实际涨幅排序`} onClick={()=>changeSort(`mirror:${p.id}`)}>镜像平衡减仓{arrow(`mirror:${p.id}`)}</button></th></>}{/* 【用户要求】2026-11-02 持仓监测里的「探测标签」删除（买前过滤已有） */}{phase === 'sell' && <th className={`${cell} text-right font-medium`} aria-sort={ariaSort(`held:${p.id}`)} title="买入到卖出的时长；还在持有的算到最近一次估值。"><button type="button" className="hover:text-foreground" aria-label={`按${p.label}持仓时间排序`} onClick={() => changeSort(`held:${p.id}`)}>持仓时间{arrow(`held:${p.id}`)}</button></th>}<PostExitHeaders plan={p} expanded={postExitOpen.has(p.id)} toggle={()=>togglePostExit(p.id)} sort={sort} ascending={ascending} onSort={changeSort}/></Fragment>)}
          <th className={`${cell} font-medium`} aria-label="跳转"/>
        </tr></thead><tbody>{padTop > 0 && <tr aria-hidden style={{ height: padTop }}/>}{visible.map((row,vi)=>renderRow(row,first+vi))}{padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}/>}</tbody></table></div> : <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-[10.5px] text-muted-foreground">{lockedBatch ? '本批记录已不可用。解除锁定后可重新选择。' : allRows.length ? <>没有匹配的标的。{emptyByDetector && <span className="ml-1" data-testid="quality-empty-detector-filter">探测算法筛选{chosenChoices.length ? `（${chosenChoices.map(choiceText).join('、')}）` : ''}把它们全滤掉了{isSignalLibraryOrigin(origin) ? '：' + QUALITY_SOURCE_NAMES[origin] + '自己的信号没有探测算法' : ''}。<button type="button" className="ml-1 text-primary hover:underline" onClick={() => setAlgorithms([])}>清除探测算法筛选</button></span>}</> : workspace ? '组合表为空。请打开「来源」，勾选记录后导入。' : '暂无可评估的信号。'}</div>}
      {rows.length > 0 && <p className="text-right text-[10px] tabular-nums text-muted-foreground" data-testid="quality-row-count">{selectedRowCount > 0 && <span className="font-medium text-primary" data-testid="quality-selected-row-count">已选 {selectedRowCount} 行 · </span>}共 {rows.length} 行 · {countSignals(rows)} 条信号{mergeCabinSignals ? ' · 同一信号已合并' : !detectorExpanded ? ' · 已合并探测明细' : ''}{sortedRows.length < batch.length ? `（筛选自 ${countSignals(batch)} 条信号）` : ''}</p>}
    </div>}
    <RowDetail row={allRows.find(r => r.id === detailId)} state={state} close={() => setDetailId('')}/>
  </section>;
  return <QualityArchiveContext.Provider value={archiveView}>{body}</QualityArchiveContext.Provider>;
}

/** Reuse the live table's renderer; only selection/filter/expansion state is local to the viewer. */
export function ArchivedQualityBoard({ study, onJump, canJump, selection }: {
  study: FishQualityStudy;
  onJump?: (source: TradeSignal) => void;
  canJump?: (source: TradeSignal) => boolean;
  selection?: { rowIds: string[]; onChange: (ids: readonly string[]) => void };
}) {
  const [localSelection, setLocalSelection] = useState(study.selectedRowIds ?? []);
  const selectedRowIds = selection?.rowIds ?? localSelection;
  const onSelectionChange = selection?.onChange;
  const state = useMemo(() => {
    const noop = () => {};
    const asyncNoop = async () => {};
    return {
      study: { ...study, selectedRowIds }, ready: true, running: false, progress: null,
      filterRunning: false, filterProgress: null, filterError: '', warning: '', error: '',
      start: asyncNoop, restart: asyncNoop, cancel: noop, startFilter: asyncNoop, cancelFilter: noop,
      clearFilterResults: noop, clearMonitorResults: noop, setRule: noop, setCombo: noop, setObserveHours: noop, selectSell: noop,
      setSelectedRows: (ids: readonly string[]) => { if (onSelectionChange) onSelectionChange(ids); else setLocalSelection([...ids]); },
      setPriority: noop, setScope: noop, setFilters: noop, setHoldingVetoes: noop, setSellPlans: noop,
    } satisfies FishQualityState;
  }, [study, selectedRowIds, onSelectionChange]);
  return <FishQuality archiveView state={state} onJump={onJump} canJump={canJump}/>;
}
