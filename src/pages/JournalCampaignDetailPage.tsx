import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Download, Eye, EyeOff, FileText, Info, Layers, Sparkles, Trash2 } from 'lucide-react';
import { toast } from '@/lib/notificationCenter';
import { waitForCampaignListHeal } from '@/lib/campaignListCache';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ImeSafeInput } from '@/components/ui/ime-safe-text-field';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type ChartMarker, type TimeBoundPriceLine, type VerticalLine } from '@/components/journal/ReplayCandleChart';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { CampaignPnlOverviewPanel } from '@/components/journal/CampaignPnlOverviewPanel';
import { CounterfactualOverviewRow } from '@/components/journal/CounterfactualOverviewRow';
import { CounterfactualLegsTable } from '@/components/journal/CounterfactualLegsTable';
import {
  CampaignWhatIfEditor,
  type CampaignWhatIfLoadLegsRequest,
  type CampaignWhatIfRunContext,
} from '@/components/journal/CampaignWhatIfEditor';
import { EndCampaignDialog } from '@/components/journal/EndCampaignDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { intervalToMs } from '@/hooks/useBinanceData';
import {
  CAMPAIGN_ABSOLUTE_RANGE_PRESETS,
  CAMPAIGN_MIN_CONTEXT_MS,
  CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS,
  buildCampaignChartVisibleRange,
  buildCampaignKlineTimeWindow,
  buildCampaignKlineVisibleRange,
  useCampaignKlines,
  type CampaignChartRangeSelection,
  type CampaignKlineTimeWindow,
  type CampaignViewMultiplier,
} from '@/hooks/useCampaignKlines';
import { computeCurrentAccountEquity } from '@/lib/accountEquity';
import { operationDateKey } from '@/lib/assetReport';
import { formatCampaignDisplayCode, resolveCampaignAccountName } from '@/lib/campaignCode';
import {
  buildCampaignEventStream,
  computeCampaignPnlReconciliation,
  computeInitialMainExposureNotional,
  computeDecisionAccuracy,
  computeInitialExpectedMaxDrawdownPct,
  computeInitialExpectedMaxLoss,
  computeMirrorTpReductionPct,
  computeProfitCaptureRatio,
  resolveCampaignInitialRiskFraction,
  shouldSuggestCampaignEnd,
  type CampaignLocalOrderFacts,
} from '@/lib/campaignAnalysis';
import {
  computeCampaignRealizedPnl,
  hasMaterialDrift,
  reconcileCampaignWithSettlement,
} from '@/lib/campaignRealizedPnl';
import {
  computeCampaignExpectancies,
  resolveCampaignMainLeverage,
  resolveCampaignOpportunityQuality,
} from '@/lib/campaignMetrics';
import {
  buildCampaignPnlOverviewItems,
  buildCampaignPnlOverviewNote,
  pnlColor,
  type CampaignPnlOverviewItem,
} from '@/lib/campaignPnlOverview';
import {
  buildCampaignChartContentTimeSpan,
  pickCampaignOverviewInterval,
  pickCoarserCampaignInterval,
  type CampaignChartInterval,
} from '@/lib/campaignChartContentSpan';
import {
  fetchLegExitPriceCorrections,
  resolveLegExecution,
  sameLegExitPriceCorrections,
  type LegExitPriceCorrections,
} from '@/lib/campaignLegExecution';
import { buildSelectedLegVerticalLines, legRoleMarkerLabel } from '@/lib/campaignLegMarkers';
import {
  campaignStatusLabel,
  exportCampaignBoardPng,
} from '@/lib/campaignLegsPngExport';
import { buildEmotionDiaryExportSummary } from '@/lib/emotionDiary';
import { getDecisionEmotionDiaryByDate } from '@/lib/emotionDiaryApi';
import { exportCampaignEmotionDiaryTxt } from '@/lib/emotionDiaryTxtExport';
import { exportCampaignPostReviewsTxt, reviewedCampaignLegs } from '@/lib/campaignReviewTxtExport';
import {
  exportCampaignOpeningSnapshotsTxt,
  openingSnapshotCampaignLegs,
} from '@/lib/campaignSnapshotTxtExport';
import { campaignOperationTime, buildTradeRecordLookup, journalSimulatedCloseTime } from '@/lib/objectiveOperationTime';
import {
  createCounterfactual,
  deleteCounterfactual,
  detachCampaignLegFromCampaign,
  getCampaignFullData,
  hasMutualFollow,
  listAllCampaigns,
  saveCampaignDeviationNotes,
  syncCampaignDeviationRulesToChecklist,
  type CampaignDeviationNote,
  listCounterfactuals,
  listVisibleCampaigns,
  runCustomCounterfactual,
} from '@/lib/journalApi';
import { summarizeCampaignPerformance, type CampaignPerformanceSummary } from '@/lib/kellySizing';
import {
  computeAsymmetricRiskContribution,
  summarizeAsymmetricRiskMetrics,
  type AsymmetricRiskMetricsSummary,
} from '@/lib/asymmetricRiskMetrics';
import {
  buildActualSimulationParams,
  buildCounterfactualRiskContext,
  buildManualLegs,
  computeManualLegDeviationCosts,
  counterfactualTemplateFor,
  isManualLegScenario,
  resolveCounterfactualActualResolved,
  type ManualLegDeviationCost,
} from '@/lib/campaignSimulationEngine';
import {
  COUNTERFACTUAL_NAME_MAX_LENGTH,
  buildCounterfactualChangeSummary,
  defaultCounterfactualName,
  formatCounterfactualStamp,
} from '@/lib/counterfactualChangeSummary';
import {
  buildCounterfactualOverviewMetrics,
  buildCounterfactualOverviewNoteInput,
  type CounterfactualOverviewShared,
} from '@/lib/counterfactualOverview';
import {
  buildCampaignReverseOrderPriceLines,
  buildForeignReplayOrderPriceLines,
  buildManualHedgeShortPriceLines,
  formatForeignReplayOrdersHeading,
  isDisplayableReverseHedgeOrder,
  isHedgeShortLeg,
  type HedgeShortLegExecution,
} from '@/lib/campaignReverseOrderLines';
import type {
  CampaignCounterfactual,
  CampaignCounterfactualParams,
  CampaignCounterfactualResult,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';
import type { CampaignReverseHedgeOrder, PendingOrder, TradeRecord } from '@/types/trading';

/** 把毫秒跨度写成中文提示文案：aria-label 里的「N 倍」在短战役上会撒谎，真实时长放 title 里。 */
function formatCampaignSpanLabel(spanMs: number): string {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return '0 分钟';
  if (spanMs >= 24 * 60 * 60_000) return `${(spanMs / (24 * 60 * 60_000)).toFixed(1)} 天`;
  if (spanMs >= 60 * 60_000) return `${(spanMs / (60 * 60_000)).toFixed(1)} 小时`;
  return `${(spanMs / 60_000).toFixed(1)} 分钟`;
}

function campaignMultiplierSpanMs(window: CampaignKlineTimeWindow, multiplier: CampaignViewMultiplier): number {
  const range = buildCampaignKlineVisibleRange(window, multiplier);
  return range.toTime - range.fromTime;
}

const INTERVALS = ['1m', '5m', '15m', '1h'] as const;
type Interval = CampaignChartInterval;

type CampaignDetailNavigationState = {
  fromCampaignList?: boolean;
};

// 战役详情页统一用浏览器本地时区显示 K 线/模拟时间——与下方 Legs 列表（本地 getHours）
// 和主图时间轴对齐。早先用 UTC 是因为误以为 Legs 列表是 UTC，实际它一直是本地时区。
const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** 「没有校正」的唯一那份空对象：每次现造一个 {} 就等于告诉下游「校正变了」。 */
const EMPTY_LEG_EXIT_PRICE_CORRECTIONS: LegExitPriceCorrections = {};
const NO_UNFILLED_ORDER_IDS: ReadonlySet<string> = new Set<string>();

function sameOrderIdSet(current: ReadonlySet<string>, ids: string[]): boolean {
  const next = new Set(ids);
  return next.size === current.size && [...next].every(id => current.has(id));
}

function fmtMdHm(value: string | null) {
  if (!value) return '进行中';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtReverseOrderChipTime(value: number | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtReverseOrderChipPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

function reverseOrderStatusText(order: CampaignReverseHedgeOrder) {
  if (order.status === 'triggered') return '已触发';
  if (order.status === 'cancelled') return '已撤';
  return '挂单中';
}

function fmtDuration(start: string, end: string | null) {
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((to - from) / 60000));
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return `${hours} 小时 ${rest} 分钟`;
}

function safeTimeMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function chipForStatus(status: TradeCampaign['status']) {
  switch (status) {
    case 'active': return 'bg-[#F0B90B]/15 text-[#F0B90B]';
    case 'closed_profit': return 'bg-[#0ECB81]/15 text-[#0ECB81]';
    case 'closed_loss': return 'bg-[#F6465D]/15 text-[#F6465D]';
    case 'abandoned': return 'bg-[#F0B90B]/10 text-[#F0B90B]';
    default: return 'bg-muted text-muted-foreground';
  }
}

function branchKindDot(kind: CampaignCounterfactual['branch_kind']) {
  if (kind === 'pure_sop') return 'bg-[#0ECB81]';
  if (kind === 'fix_one_deviation') return 'bg-[#F0B90B]';
  return 'bg-[#B080FF]';
}

function branchKindLabel(kind: CampaignCounterfactual['branch_kind']) {
  if (kind === 'pure_sop') return 'Pure SOP';
  if (kind === 'fix_one_deviation') return '修正分支';
  return 'What-if';
}

/**
 * 已保存分支列表隐藏自动生成的「修正分支」（补齐 X），默认选中也只从可见分支里挑：
 * 否则一条列表里看不见的行会顶着「反事实盈亏概览」面板和「删除」出现，而它正是元监控
 * 「战役 SOP 经济成本」读的那批行。
 */
function isVisibleCounterfactualBranch(branch: CampaignCounterfactual): boolean {
  return branch.branch_kind !== 'fix_one_deviation';
}

function firstVisibleCounterfactualId(branches: CampaignCounterfactual[]): string | null {
  return branches.find(isVisibleCounterfactualBranch)?.id ?? null;
}

/** 刚运行、还没点「保存」的反事实：只活在页面状态里，离开页面即丢。 */
type CounterfactualDraft = {
  params: CampaignCounterfactualParams;
  result: CampaignCounterfactualResult;
};

/** 反事实面板与真实「盈亏概览」走同一个构造器；这里只把分支翻译成纯数字对象再交给它。 */
function buildCounterfactualOverview(
  branch: { params: CampaignCounterfactualParams; result: CampaignCounterfactualResult },
  shared: CounterfactualOverviewShared,
): { items: CampaignPnlOverviewItem[]; note: string } {
  const metrics = buildCounterfactualOverviewMetrics(branch, shared);
  return {
    items: buildCampaignPnlOverviewItems(metrics),
    note: buildCampaignPnlOverviewNote(buildCounterfactualOverviewNoteInput(metrics, shared)),
  };
}

/**
 * 「相对实际」按两位小数印：分支结果落库时按 4 位小数取整，而上方的已实现是未取整的现算值，
 * 原样重跑时两者只差几个亿分位——不归零就会印出染红的「-0.00」，被读成一笔亏损。
 */
function counterfactualDelta(branchRealizedPnl: number, actualPnl: number): number {
  const delta = branchRealizedPnl - actualPnl;
  return Math.abs(delta) < 0.005 ? 0 : delta;
}

function counterfactualLabel(role: string) {
  switch (role) {
    case 'main_open': return 'CF-M';
    case 'main_add_1': return 'CF-A1';
    case 'main_add_2': return 'CF-A2';
    case 'main_add_3': return 'CF-A3';
    case 'main_add_4': return 'CF-A4';
    case 'main_add_5': return 'CF-A5';
    case 'main_add_6': return 'CF-A6';
    case 'reentry_main': return 'CF-Re';
    case 'hedge_initial_a': return 'CF-Ha';
    case 'hedge_initial_b': return 'CF-Hb';
    case 'hedge_rolling': return 'CF-Hr';
    case 'mirror_tp': return 'CF-TP';
    default: return 'CF';
  }
}

// 开单/平单竖线配色：多单蓝、空单橘（与持仓方向绑定，独立于 leg_role 的标记色）。
// 这些线只负责定位，不抢 K 线主体。
const LEG_LONG_LINE_COLOR = 'rgba(43,128,255,0.24)';
const LEG_SHORT_LINE_COLOR = 'rgba(247,147,26,0.24)';
const LEG_LONG_LABEL_COLOR = 'rgba(43,128,255,0.66)';
const LEG_SHORT_LABEL_COLOR = 'rgba(247,147,26,0.66)';
const CAMPAIGN_BOUNDARY_LINE_COLOR = 'rgba(132,142,156,0.12)';
const CAMPAIGN_VERTICAL_LINE_WIDTH = 0.3;
const LEG_VERTICAL_LINE_WIDTH = 0.45;

function isMainStartLeg(leg: Pick<TradeJournal, 'leg_role'>): boolean {
  return leg.leg_role === 'main_open' || leg.leg_role === 'reentry_main';
}

function buildChartArtifacts(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  legExitPriceCorrections: LegExitPriceCorrections = {},
) {
  const events = buildCampaignEventStream(campaign, legs, tradeRecords);
  const eventMap = new Map(events.map(event => [event.journal_id ?? event.id, event]));
  const tradeRecordLookup = buildTradeRecordLookup(tradeRecords);
  const markers: ChartMarker[] = [];
  const timeBoundPriceLines: TimeBoundPriceLine[] = [];
  const verticalLines: VerticalLine[] = [];
  const formatReductionPct = (value: number | null) => {
    if (value == null) return null;
    const roundedInteger = Math.round(value);
    return Math.abs(value - roundedInteger) < 0.05
      ? String(roundedInteger)
      : value.toFixed(1).replace(/\.0$/, '');
  };

  verticalLines.push({
    time: new Date(campaign.opened_at).getTime(),
    color: CAMPAIGN_BOUNDARY_LINE_COLOR,
    width: CAMPAIGN_VERTICAL_LINE_WIDTH,
    z: 1,
  });
  if (campaign.closed_at) {
    verticalLines.push({
      time: new Date(campaign.closed_at).getTime(),
      color: CAMPAIGN_BOUNDARY_LINE_COLOR,
      width: CAMPAIGN_VERTICAL_LINE_WIDTH,
      z: 1,
    });
  }

  let rollingIndex = 1;
  for (const leg of legs) {
    const record = leg.trade_record_id ? tradeRecordLookup.get(leg.trade_record_id) ?? null : null;
    const resolved = resolveLegExecution(leg, record, legExitPriceCorrections);
    const openTime = resolved.openTime ?? new Date(campaign.opened_at).getTime();
    const closeTime = resolved.closeTime;
    const price = resolved.entryPrice ?? 0;
    const exitPrice = resolved.exitPrice ?? price;
    const color = leg.leg_role === 'mirror_tp'
      ? '#F0B90B'
      : leg.leg_role === 'hedge_rolling'
        ? '#5BA3FF'
        : leg.leg_role === 'hedge_initial_a' || leg.leg_role === 'hedge_initial_b'
          ? '#2B80FF'
          : leg.leg_role === 'reentry_main' || leg.leg_role === 'reentry_hedge'
            ? '#B080FF'
            : leg.direction === 'short'
              ? '#F6465D'
              : '#0ECB81';

    let label = 'M';
    let shape: ChartMarker['shape'] = leg.direction === 'short' ? 'triangle-down' : 'triangle-up';
    if (leg.leg_role === 'hedge_initial_a') { label = 'Ha'; shape = 'triangle-down'; }
    if (leg.leg_role === 'hedge_initial_b') { label = 'Hb'; shape = 'triangle-down'; }
    if (leg.leg_role === 'hedge_rolling') { label = `Hr${rollingIndex++}`; shape = 'triangle-down'; }
    if (leg.leg_role === 'mirror_tp') { label = 'TP'; shape = 'square'; }
    if (leg.leg_role?.startsWith('main_add_')) { label = `A${leg.leg_role.slice('main_add_'.length)}`; }
    if (leg.leg_role === 'reentry_main') { label = '再入主力'; }
    if (leg.leg_role === 'reentry_hedge') { label = 'ReH'; shape = 'triangle-down'; }
    if (leg.leg_role === 'main_open') { label = '主力开始'; }

    markers.push({ time: openTime, price, shape, color, label });

    // 按方向配色的开单/平单竖线：开单实线，平单虚线；多单蓝、空单橘。
    const legDirColor = leg.direction === 'short' ? LEG_SHORT_LINE_COLOR : LEG_LONG_LINE_COLOR;
    const legLabelColor = leg.direction === 'short' ? LEG_SHORT_LABEL_COLOR : LEG_LONG_LABEL_COLOR;
    const isPrimaryMainStart = isMainStartLeg(leg);
    verticalLines.push({
      time: openTime,
      color: legDirColor,
      width: isPrimaryMainStart ? LEG_VERTICAL_LINE_WIDTH * 1.8 : LEG_VERTICAL_LINE_WIDTH,
      z: isPrimaryMainStart ? 5 : 3,
      dashed: false,
      label: `${legRoleMarkerLabel(leg.leg_role)}·开仓`,
      labelColor: legLabelColor,
      alwaysVisible: isPrimaryMainStart,
    });
    if (closeTime != null) {
      verticalLines.push({
        time: closeTime,
        color: legDirColor,
        width: LEG_VERTICAL_LINE_WIDTH,
        z: 3,
        dashed: true,
        label: `${legRoleMarkerLabel(leg.leg_role)}·平仓`,
        labelColor: legLabelColor,
      });
    }

    const cancelEvent = events.find(event => event.journal_id === leg.id && event.event_type === 'hedge_cancelled') ?? null;
    const startTime = openTime;
    const endTime = closeTime != null
      ? (leg.leg_role === 'mirror_tp' ? closeTime : openTime)
      : cancelEvent
        ? new Date(cancelEvent.timestamp).getTime()
        : (campaign.closed_at ? new Date(campaign.closed_at).getTime() : Date.now());
    if (leg.leg_role && (leg.leg_role.startsWith('hedge_') || leg.leg_role === 'mirror_tp')) {
      timeBoundPriceLines.push({
        price,
        color,
        startTime,
        endTime,
        dashed: !record,
        endMarker: !record && !!cancelEvent ? 'x' : null,
        title: label,
      });
    }

    if (closeTime != null) {
      if (leg.leg_role === 'mirror_tp') {
        const reductionPct = formatReductionPct(
          computeMirrorTpReductionPct(campaign, leg, legs, tradeRecords),
        );
        markers.push({
          time: closeTime,
          price: exitPrice,
          shape: 'circle',
          color: '#0ECB81',
          label: reductionPct == null ? 'M 减仓' : `M 减仓 ${reductionPct}%`,
        });
      }
      if (leg.leg_role === 'main_open' || leg.leg_role === 'reentry_main' || leg.leg_role?.startsWith('main_add_')) {
        markers.push({
          time: closeTime,
          price: exitPrice,
          shape: 'square',
          color: '#2B80FF',
          label: 'M 全平',
        });
      }
    }

    eventMap.get(leg.id);
  }

  return { markers, timeBoundPriceLines, verticalLines, events };
}

function buildCounterfactualChartArtifacts(
  branch: CampaignCounterfactual | null,
): { markers: ChartMarker[]; timeBoundPriceLines: TimeBoundPriceLine[]; verticalLines: VerticalLine[] } {
  if (!branch) return { markers: [], timeBoundPriceLines: [], verticalLines: [] };
  const color = '#B080FF';
  const markers: ChartMarker[] = [];
  const timeBoundPriceLines: TimeBoundPriceLine[] = [];
  const verticalLines: VerticalLine[] = [];
  const lastEventTime = branch.result.events[branch.result.events.length - 1]
    ? new Date(branch.result.events[branch.result.events.length - 1].timestamp).getTime()
    : new Date(branch.params.entry.time).getTime();
  const direction = branch.params.entry.direction;

  for (const event of branch.result.events) {
    const time = new Date(event.timestamp).getTime();
    if (event.event_type === 'main_opened' || event.event_type === 'reentry_main_opened') {
      markers.push({
        time,
        price: event.price,
        shape: direction === 'short' ? 'triangle-down' : 'triangle-up',
        color,
        label: event.event_type === 'main_opened' ? 'CF-M' : 'CF-Re',
      });
    }
    if (event.event_type === 'hedge_triggered') {
      markers.push({
        time,
        price: event.price,
        shape: direction === 'short' ? 'triangle-up' : 'triangle-down',
        color,
        label: counterfactualLabel(event.leg_role),
      });
      verticalLines.push({
        time,
        color: 'rgba(176,128,255,0.38)',
        width: LEG_VERTICAL_LINE_WIDTH,
        z: 2,
      });
    }
    if (event.event_type === 'mirror_tp_triggered') {
      markers.push({
        time,
        price: event.price,
        shape: 'square',
        color,
        label: 'CF-TP',
      });
      verticalLines.push({
        time,
        color: 'rgba(176,128,255,0.38)',
        width: LEG_VERTICAL_LINE_WIDTH,
        z: 2,
      });
    }
    if (event.event_type === 'main_fully_closed') {
      markers.push({
        time,
        price: event.price,
        shape: 'circle',
        color,
        label: 'CF-Exit',
      });
    }
  }

  for (const leg of branch.result.legs_summary) {
    if (!leg.leg_role.startsWith('hedge_') && leg.leg_role !== 'mirror_tp') continue;
    timeBoundPriceLines.push({
      price: leg.trigger_price,
      color,
      title: counterfactualLabel(leg.leg_role),
      startTime: new Date(leg.placed_at).getTime(),
      endTime: leg.triggered_at ? new Date(leg.triggered_at).getTime() : lastEventTime,
      dashed: leg.status !== 'filled',
      endMarker: leg.status === 'cancelled' ? 'x' : null,
    });
  }

  return { markers, timeBoundPriceLines, verticalLines };
}

type AccountCampaignMetrics = {
  performance: CampaignPerformanceSummary;
  asymmetricRisk: AsymmetricRiskMetricsSummary;
};

async function loadAccountCampaignPerformance(
  ownerUserId: string,
  viewerUserId: string,
): Promise<AccountCampaignMetrics> {
  const campaigns = ownerUserId === viewerUserId
    ? await listAllCampaigns(ownerUserId)
    : (await listVisibleCampaigns(viewerUserId)).filter(item => item.user_id === ownerUserId);
  const settledSamples = await Promise.allSettled(campaigns.map(async item => {
    // 账户级样本只是读：这里自己算校正后的口径，不需要（也不该）让每一场都走一遍回写。
    // 此前默认 heal 让打开一个详情页对全部 ~147 场各写一次库，还与本场的回写抢同一行。
    const details = await getCampaignFullData(item.id, { heal: false });
    const exitPriceCorrections = await fetchLegExitPriceCorrections(
      details.campaign.symbol,
      details.legs,
      details.tradeRecords,
    );
    // 无条件同源。此前只有「存在平仓价校正」时才切换到重算口径，
    // 于是同一场战役在列表页显示落库值、在详情页显示重算值——两个页面两个数。
    const settlement = computeCampaignRealizedPnl(
      details.campaign, details.legs, details.tradeRecords, exitPriceCorrections,
    );
    const reconciledCampaign = reconcileCampaignWithSettlement(details.campaign, details.legs, settlement);
    const initialExpectedMaxLoss = computeInitialExpectedMaxLoss(
      details.campaign,
      details.legs,
      details.tradeRecords,
      details.reverseHedgeOrders,
    );
    const payoffRatio = Number.isFinite(initialExpectedMaxLoss) && initialExpectedMaxLoss > 0
      ? computeProfitCaptureRatio(
        details.campaign,
        details.legs,
        details.tradeRecords,
        details.reverseHedgeOrders,
        exitPriceCorrections,
      ) / 100
      : null;
    return { campaign: reconciledCampaign, payoffRatio };
  }));
  const samples = settledSamples.flatMap(result => (
    result.status === 'fulfilled' ? [result.value] : []
  ));

  return {
    performance: summarizeCampaignPerformance(samples),
    asymmetricRisk: summarizeAsymmetricRiskMetrics(samples),
  };
}

/** 情绪日记折叠态的本机存储键（跨战役共用一个偏好）。 */
const EMOTION_DIARY_COLLAPSED_STORAGE_KEY = 'journal:campaign-emotion-diary-collapsed';

export default function JournalCampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();
  const viewerUserId = user?.id ?? null;
  const campaignAccountName = useMemo(
    () => resolveCampaignAccountName({
      displayName: profile?.display_name,
      email: user?.email,
      userId: user?.id,
    }),
    [profile?.display_name, user?.email, user?.id],
  );
  const { getEffectiveTime, balance, positionsMap, priceMap } = useTradingContext();
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<TradeCampaign | null>(null);
  const campaignDisplayCode = useMemo(
    () => campaign
      ? formatCampaignDisplayCode(campaign.campaign_code, campaignAccountName, campaign.id)
      : '',
    [campaign, campaignAccountName],
  );
  const [legs, setLegs] = useState<TradeJournal[]>([]);
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>([]);
  const [legExitPriceCorrections, setLegExitPriceCorrections] = useState<LegExitPriceCorrections>({});
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [reverseHedgeOrders, setReverseHedgeOrders] = useState<CampaignReverseHedgeOrder[]>([]);
  // 别的回放留下、本场期间仍挂着的委托：只标注显示，不进 reverseHedgeOrders / pendingOrders。
  const [foreignLiveOrders, setForeignLiveOrders] = useState<CampaignReverseHedgeOrder[]>([]);
  /**
   * 腿上挂着、本地委托快照证明从未成交的委托 id：盈亏概览的权益路径与「Legs 副本」读同一份。
   * 内容没变就保留原来那个对象——它一路传到副本编辑器，换身份会冲掉编辑到一半的腿（与平仓价校正同一条规则）。
   */
  const [unfilledOrderIds, setUnfilledOrderIds] = useState<ReadonlySet<string>>(NO_UNFILLED_ORDER_IDS);
  const localOrderFacts = useMemo<CampaignLocalOrderFacts>(() => ({ unfilledOrderIds }), [unfilledOrderIds]);
  const adoptUnfilledOrderIds = useCallback((ids: string[] | undefined) => {
    setUnfilledOrderIds(prev => (sameOrderIdSet(prev, ids ?? []) ? prev : new Set(ids ?? [])));
  }, []);
  const [interval, setInterval] = useState<Interval>('1m');
  const [intervalTouched, setIntervalTouched] = useState(false);
  const [chartRangeSelection, setChartRangeSelection] = useState<CampaignChartRangeSelection>(
    { kind: 'multiplier', multiplier: 3 },
  );
  const [endOpen, setEndOpen] = useState(false);
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [counterfactuals, setCounterfactuals] = useState<CampaignCounterfactual[]>([]);
  const [selectedCounterfactualId, setSelectedCounterfactualId] = useState<string | null>(null);
  /** 本页删过的分支 id：删除之前发出的列表查询晚到时，用它把已删的行滤掉。 */
  const deletedCounterfactualIdsRef = useRef(new Set<string>());
  // 刚运行、尚未保存的反事实：只在页面状态里，点「保存」才 createCounterfactual。
  const [counterfactualDraft, setCounterfactualDraft] = useState<CounterfactualDraft | null>(null);
  const [counterfactualDraftName, setCounterfactualDraftName] = useState('');
  const [counterfactualDraftSaving, setCounterfactualDraftSaving] = useState(false);
  const [loadLegsRequest, setLoadLegsRequest] = useState<CampaignWhatIfLoadLegsRequest | null>(null);
  const loadLegsNonceRef = useRef(0);
  // 当前页面正在看的战役 id：保存 / 删除分支的 await 之后先对一下它，用户已切到别的战役就不再动列表。
  const activeCampaignIdRef = useRef(id);
  const [whatIfRunning, setWhatIfRunning] = useState(false);
  // 用户对偏离行三列文字的手改覆盖（按行键 = legId），来自本地持久化；保存后下次打开仍在。
  const [deviationNotes, setDeviationNotes] = useState<Record<string, CampaignDeviationNote>>({});
  const [deviationNotesSaving, setDeviationNotesSaving] = useState(false);
  const [detachTarget, setDetachTarget] = useState<TradeJournal | null>(null);
  const [detaching, setDetaching] = useState(false);
  const [selectedLegMarkerIds, setSelectedLegMarkerIds] = useState<string[]>([]);
  const [legsExporting, setLegsExporting] = useState(false);
  const campaignChartExportRef = useRef<HTMLDivElement | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  const [campaignPerformance, setCampaignPerformance] = useState<CampaignPerformanceSummary | null>(null);
  const [campaignAsymmetricRisk, setCampaignAsymmetricRisk] = useState<AsymmetricRiskMetricsSummary | null>(null);
  const [campaignPerformanceLoading, setCampaignPerformanceLoading] = useState(false);
  const [campaignPerformanceError, setCampaignPerformanceError] = useState<string | null>(null);
  const [campaignEmotionDiary, setCampaignEmotionDiary] = useState<DecisionEmotionDiary | null>(null);
  const [campaignEmotionDiaryLoading, setCampaignEmotionDiaryLoading] = useState(false);
  const reviewedLegs = useMemo(() => reviewedCampaignLegs(legs), [legs]);
  const openingSnapshotLegs = useMemo(() => openingSnapshotCampaignLegs(legs), [legs]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [id]);

  useEffect(() => {
    // 换战役必须连绝对预设一起重置：否则从某战役的「1月」视图进另一个 symbol，
    // 开场就带着一个月的拉取窗口。
    setChartRangeSelection({ kind: 'multiplier', multiplier: 3 });
  }, [id]);

  useEffect(() => {
    // 换战役时草稿与「载入到 Legs 副本」请求都作废：它们只对当前战役有意义。
    activeCampaignIdRef.current = id;
    setCounterfactualDraft(null);
    setCounterfactualDraftName('');
    setLoadLegsRequest(null);
  }, [id]);

  useEffect(() => {
    if (!id || !viewerUserId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 列表页的后台自愈正好在跑这一场：等它落地再读（最多等 2 s），之后在本页的编辑不会被它晚到的写入盖回去
        await waitForCampaignListHeal(id);
        if (cancelled) return;
        const [full, savedCounterfactuals] = await Promise.all([
          getCampaignFullData(id),
          listCounterfactuals(id),
        ]);
        if (cancelled) return;
        const ownCampaign = full.campaign.user_id === viewerUserId;
        const mutual = ownCampaign ? true : await hasMutualFollow(viewerUserId, full.campaign.user_id);
        if (!mutual) {
          nav(`/journal/campaigns${location.search}`);
          return;
        }
        setIsOwner(ownCampaign);
        setCampaign(full.campaign);
        setLegs(full.legs);
        setTradeRecords(full.tradeRecords);
        // 自愈路径已经拉过校正：首屏就用它，页眉状态与已实现 P&L 从第一帧起同源，
        // 不再出现「先画盈利、校正到了再翻成亏损」。下面的 effect 随后命中缓存、结果相同。
        setLegExitPriceCorrections(full.legExitPriceCorrections ?? {});
        setPendingOrders(full.pendingOrders);
        setReverseHedgeOrders(full.reverseHedgeOrders);
        setForeignLiveOrders(full.foreignLiveOrders ?? []);
        adoptUnfilledOrderIds(full.unfilledOrderIds);
        // 回放时间线的影子比对（Phase 1）：精确判定与启发式不一致时只记一条日志，界面照旧按启发式显示
        const diagnostics = full.timelineDiagnostics;
        if (diagnostics && diagnostics.disagreements.length > 0) {
          console.info('[JournalCampaignDetailPage] 回放时间线影子比对：精确判定与启发式不一致（本期不改显示）', {
            campaignId: id,
            mode: diagnostics.mode,
            timelineIds: diagnostics.timelineIds,
            anchorTimelineIds: diagnostics.anchorTimelineIds,
            unstampedAnchors: diagnostics.unstampedAnchors,
            missingAnchorNodes: diagnostics.missingAnchorNodes,
            disagreements: diagnostics.disagreements,
          });
        }
        setCounterfactuals(savedCounterfactuals);
        setSelectedCounterfactualId(prev => (
          prev && savedCounterfactuals.some(branch => branch.id === prev && isVisibleCounterfactualBranch(branch))
            ? prev
            : firstVisibleCounterfactualId(savedCounterfactuals)
        ));
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : String(error));
          nav(`/journal/campaigns${location.search}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, viewerUserId, nav, location.search, adoptUnfilledOrderIds]);

  const campaignOwnerId = campaign?.user_id ?? null;

  useEffect(() => {
    if (!campaignOwnerId || !viewerUserId) return;
    let cancelled = false;
    setCampaignPerformance(null);
    setCampaignAsymmetricRisk(null);
    setCampaignPerformanceError(null);
    setCampaignPerformanceLoading(true);
    loadAccountCampaignPerformance(campaignOwnerId, viewerUserId)
      .then(result => {
        if (!cancelled) {
          setCampaignPerformance(result.performance);
          setCampaignAsymmetricRisk(result.asymmetricRisk);
        }
      })
      .catch(error => {
        if (!cancelled) {
          setCampaignPerformanceError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setCampaignPerformanceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignOwnerId, viewerUserId]);

  const effectiveClosedAt = useMemo(() => {
    if (!campaign) return null;
    return campaign.closed_at ?? new Date(getEffectiveTime(campaign.symbol)).toISOString();
  }, [campaign, getEffectiveTime]);
  const objectiveOperationTime = useMemo(
    () => campaignOperationTime(legs, tradeRecords),
    [legs, tradeRecords],
  );
  const campaignOperationDate = useMemo(
    () => objectiveOperationTime == null ? null : operationDateKey(objectiveOperationTime),
    [objectiveOperationTime],
  );
  const campaignEmotionDiarySummary = useMemo(
    () => campaignEmotionDiary ? buildEmotionDiaryExportSummary(campaignEmotionDiary) : null,
    [campaignEmotionDiary],
  );

  useEffect(() => {
    if (!viewerUserId || !isOwner || !campaignOperationDate) {
      setCampaignEmotionDiary(null);
      setCampaignEmotionDiaryLoading(false);
      return;
    }
    let cancelled = false;
    setCampaignEmotionDiaryLoading(true);
    getDecisionEmotionDiaryByDate(viewerUserId, campaignOperationDate)
      .then(diary => {
        if (!cancelled) setCampaignEmotionDiary(diary);
      })
      .catch(error => {
        if (!cancelled) {
          setCampaignEmotionDiary(null);
          console.warn('[JournalCampaignDetailPage] 读取操作日情绪日记失败', error);
        }
      })
      .finally(() => {
        if (!cancelled) setCampaignEmotionDiaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignOperationDate, isOwner, viewerUserId]);
  /**
   * 情绪日记折叠与否。折叠态会一并带进 PNG 导出：用户把它收起来，
   * 多半就是不想让这段私人记录出现在要分享的图里。
   * 记在本机浏览器（跨战役生效）：导出前刷新一次，不该把日记又自己摊开。
   */
  const [emotionDiaryCollapsed, setEmotionDiaryCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(EMOTION_DIARY_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleEmotionDiaryCollapsed = () => {
    setEmotionDiaryCollapsed(current => {
      const next = !current;
      try {
        if (next) window.localStorage.setItem(EMOTION_DIARY_COLLAPSED_STORAGE_KEY, '1');
        else window.localStorage.removeItem(EMOTION_DIARY_COLLAPSED_STORAGE_KEY);
      } catch {
        // 存储不可用时只在本次会话里生效
      }
      return next;
    });
  };
  const tradeRecordLookup = useMemo(
    () => buildTradeRecordLookup(tradeRecords),
    [tradeRecords],
  );

  // Legs 列表里所有腿的最早开单时间与最晚平单时间，用来撑开 K 线前后区间（需求②）。
  const legTimeSpan = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const leg of legs) {
      const record = leg.trade_record_id
        ? tradeRecordLookup.get(leg.trade_record_id) ?? null
        : null;
      const openMs = record?.openTime ?? new Date(leg.pre_simulated_time).getTime();
      if (Number.isFinite(openMs)) { min = Math.min(min, openMs); max = Math.max(max, openMs); }
      const closeMs = record?.closeTime ?? journalSimulatedCloseTime(leg);
      if (closeMs != null) {
        min = Math.min(min, closeMs);
        max = Math.max(max, closeMs);
      }
    }
    return {
      startMs: Number.isFinite(min) ? min : null,
      endMs: Number.isFinite(max) ? max : null,
    };
  }, [legs, tradeRecordLookup]);

  const selectedCounterfactual = useMemo(
    () => counterfactuals.find(branch => branch.id === selectedCounterfactualId) ?? null,
    [counterfactuals, selectedCounterfactualId],
  );
  // 他场委托也进取景跨度：管理区与 Legs 淡注列出的每一张，盘面上都找得到（与本场委托同一条不变量）
  const chartContentTimeSpan = useMemo(
    () => buildCampaignChartContentTimeSpan(
      campaign, legs, tradeRecords, [...reverseHedgeOrders, ...foreignLiveOrders], selectedCounterfactual,
    ),
    [campaign, legs, tradeRecords, reverseHedgeOrders, foreignLiveOrders, selectedCounterfactual],
  );
  const campaignKlineSpanStartMs = chartContentTimeSpan.startMs ?? legTimeSpan.startMs;
  const campaignKlineSpanEndMs = chartContentTimeSpan.endMs ?? legTimeSpan.endMs;
  // 基准窗口 = 完全不含绝对预设的今日行为。反事实面板拿的是它：
  // 把一个「被 1 个月撑开过」的窗口交给 What-if，它的 51 倍会指向与主图不同的数据边界。
  const campaignKlineBaseWindow = useMemo(() => {
    const openedAtMs = campaign ? new Date(campaign.opened_at).getTime() : Date.now();
    const closedAtMs = new Date(effectiveClosedAt).getTime();
    return buildCampaignKlineTimeWindow(
      openedAtMs,
      closedAtMs,
      campaignKlineSpanStartMs,
      campaignKlineSpanEndMs,
    );
  }, [campaign, campaignKlineSpanEndMs, campaignKlineSpanStartMs, effectiveClosedAt]);
  const campaignKlineTimeWindow = useMemo(() => {
    const openedAtMs = campaign ? new Date(campaign.opened_at).getTime() : Date.now();
    const closedAtMs = new Date(effectiveClosedAt).getTime();
    return buildCampaignKlineTimeWindow(
      openedAtMs,
      closedAtMs,
      campaignKlineSpanStartMs,
      campaignKlineSpanEndMs,
      chartRangeSelection,
    );
  }, [campaign, campaignKlineSpanEndMs, campaignKlineSpanStartMs, chartRangeSelection, effectiveClosedAt]);
  const campaignKlineVisibleRange = useMemo(
    () => buildCampaignChartVisibleRange(campaignKlineTimeWindow, chartRangeSelection),
    [campaignKlineTimeWindow, chartRangeSelection],
  );
  const overviewInterval = useMemo(() => {
    // 拉取项 = 今天的行为，一个字不动：倍率按钮只是取景，绝不允许连带改周期。
    // 一旦改了，klines 的粒度会跟着变，而 klines 同时喂给 computeDecisionAccuracy /
    // buildManualLegs / runCustomCounterfactual —— 点一下缩放就能让一次运行的结果偏掉。
    const fetchedInterval = pickCampaignOverviewInterval({
      startMs: campaignKlineTimeWindow.fromTime,
      endMs: campaignKlineTimeWindow.toTime,
    }, 6_000);
    if (chartRangeSelection.kind !== 'absolute') return fetchedInterval;
    // 只有绝对预设需要按「可见根数」再收紧一次：klinecharts 的 barSpace 下限是 1px，
    // 可见根数超过画布宽度（约 1700）就会被静默裁掉中心以外的部分，
    // 用户点了「1月」只会拿到不可读的 1px 柱子和被裁掉一大半的区间。
    const visibleInterval = pickCampaignOverviewInterval({
      startMs: campaignKlineVisibleRange.fromTime,
      endMs: campaignKlineVisibleRange.toTime,
    }, 1_200);
    return pickCoarserCampaignInterval(visibleInterval, fetchedInterval);
  }, [
    campaignKlineTimeWindow.fromTime,
    campaignKlineTimeWindow.toTime,
    campaignKlineVisibleRange.fromTime,
    campaignKlineVisibleRange.toTime,
    chartRangeSelection,
  ]);
  // 自动挡直接派生，不再走 state 往返。旧写法是在 effect 里 setInterval，
  // 于是「点预设」的那一帧窗口已经是 30 天、interval 还停在 1m，
  // useReplayKlines 的 effect 先跑起来就是 43200 根 / 29 个串行请求。
  // 手动挡（intervalTouched）在倍率视图下原样保留；绝对预设下只保证不比可读下限更细。
  const effectiveInterval = useMemo<Interval>(() => {
    if (!intervalTouched) return overviewInterval;
    if (chartRangeSelection.kind !== 'absolute') return interval;
    return pickCoarserCampaignInterval(interval, overviewInterval);
  }, [chartRangeSelection, interval, intervalTouched, overviewInterval]);

  const {
    klines,
    loading: klinesLoading,
    error: klinesError,
    reload: reloadKlines,
    fromTime: campaignKlineFromTime,
    toTime: campaignKlineToTime,
  } = useCampaignKlines(
    campaign?.symbol ?? '',
    campaign?.opened_at ?? new Date().toISOString(),
    effectiveClosedAt,
    effectiveInterval,
    campaignKlineSpanStartMs,
    campaignKlineSpanEndMs,
    chartRangeSelection,
  );

  /**
   * 平仓价校正：内容没变就**保留原来那个对象**，依赖也只收到真正用到的 symbol。
   *
   * 这份 state 会一路传到「Legs 副本」编辑器，编辑器的重置 effect 把它列在依赖里。
   * 从前这里既把整个 campaign 挂在依赖上（「保存备注」只写 deviation_notes，也会换战役对象、
   * 把这个 effect 整个重跑），又每次都塞一个新对象（早退的 {} 字面量、或新的 Object.fromEntries）——
   * 于是点一下「保存备注」，用户刚「载入到 Legs 副本」或手改到一半的腿就被静默冲掉。
   * 校正是纯函数产物，重算出来逐字相同的概率极高，内容相同就不该留下「变过」的痕迹。
   */
  const campaignSymbol = campaign?.symbol;
  useEffect(() => {
    if (!campaignSymbol || legs.length === 0 || tradeRecords.length === 0) {
      setLegExitPriceCorrections(prev => (sameLegExitPriceCorrections(prev, EMPTY_LEG_EXIT_PRICE_CORRECTIONS) ? prev : EMPTY_LEG_EXIT_PRICE_CORRECTIONS));
      return;
    }

    let cancelled = false;
    fetchLegExitPriceCorrections(campaignSymbol, legs, tradeRecords)
      .then(corrections => {
        if (!cancelled) setLegExitPriceCorrections(prev => (sameLegExitPriceCorrections(prev, corrections) ? prev : corrections));
      })
      .catch(() => {
        if (!cancelled) setLegExitPriceCorrections(prev => (sameLegExitPriceCorrections(prev, EMPTY_LEG_EXIT_PRICE_CORRECTIONS) ? prev : EMPTY_LEG_EXIT_PRICE_CORRECTIONS));
      });

    return () => {
      cancelled = true;
    };
  }, [campaignSymbol, legs, tradeRecords]);

  const accuracy = useMemo(
    () => (campaign
      ? computeDecisionAccuracy(
        campaign,
        legs,
        tradeRecords,
        klines,
        reverseHedgeOrders,
        legExitPriceCorrections,
        localOrderFacts,
      )
      : null),
    [campaign, legs, tradeRecords, klines, reverseHedgeOrders, legExitPriceCorrections, localOrderFacts],
  );
  const pnlReconciliation = useMemo(
    () => (campaign
      ? computeCampaignPnlReconciliation(
        campaign,
        legs,
        tradeRecords,
        legExitPriceCorrections,
      )
      : null),
    [campaign, legs, tradeRecords, legExitPriceCorrections],
  );
  /**
   * 本页**唯一**的一份结算：叠着平仓价校正算。已实现 P&L、页眉状态、导出 PNG 的
   * 「方向 / 状态」与标题 slug、结束对话框推出的状态，全部从它派生。
   * 此前页眉读的是落库的 campaign.status（未校正），盈亏概览读的是校正后的现算值，
   * 于是同一页上「盈利结束」旁边挂着 −1756.64 USDT。
   */
  const settlement = useMemo(
    () => (campaign ? computeCampaignRealizedPnl(campaign, legs, tradeRecords, legExitPriceCorrections) : null),
    [campaign, legs, tradeRecords, legExitPriceCorrections],
  );
  /** 落库行套上结算结果：已结算 → 状态 / 金额 / R 由结算推出；未结算 → 原样保留落库状态。 */
  const displayCampaign = useMemo(
    () => (campaign && settlement ? reconcileCampaignWithSettlement(campaign, legs, settlement) : campaign),
    [campaign, legs, settlement],
  );
  const currentAccountEquity = useMemo(
    () => computeCurrentAccountEquity(balance, positionsMap, priceMap),
    [balance, positionsMap, priceMap],
  );
  const campaignMetricValues = useMemo(() => {
    if (!campaign || !displayCampaign || !accuracy) return null;
    const profitCaptureRatio = accuracy.initial_expected_max_loss > 0
      ? accuracy.profit_capture_ratio
      : null;
    const initialExpectedMaxDrawdownPct = computeInitialExpectedMaxDrawdownPct(
      campaign,
      legs,
      tradeRecords,
      reverseHedgeOrders,
    );
    // 机会质量的「已结束」门槛读派生状态，与列表页传 reconciledCampaign 同一口径。
    const opportunityQuality = resolveCampaignOpportunityQuality(
      displayCampaign,
      profitCaptureRatio,
      initialExpectedMaxDrawdownPct,
    );
    const initialRisk = resolveCampaignInitialRiskFraction(
      accuracy.initial_expected_max_loss,
      legs,
      isOwner ? currentAccountEquity : null,
    );
    const expectancies = computeCampaignExpectancies(
      profitCaptureRatio,
      campaignPerformance?.expectedWinRate ?? null,
    );

    return {
      profitCaptureRatio,
      initialExpectedMaxDrawdownPct,
      opportunityQuality,
      initialRisk,
      ...expectancies,
    };
  }, [
    accuracy,
    campaign,
    displayCampaign,
    campaignPerformance?.expectedWinRate,
    currentAccountEquity,
    isOwner,
    legs,
    reverseHedgeOrders,
    tradeRecords,
  ]);
  const asymmetricRiskContribution = useMemo(() => computeAsymmetricRiskContribution(
    campaignMetricValues?.profitCaptureRatio == null
      ? null
      : campaignMetricValues.profitCaptureRatio / 100,
    campaignAsymmetricRisk,
  ), [campaignAsymmetricRisk, campaignMetricValues?.profitCaptureRatio]);
  const campaignPnlOverviewItems = useMemo<CampaignPnlOverviewItem[]>(() => {
    if (!campaign || !accuracy) return [];
    const pnlSettlement = settlement;
    // 系统一直算得出这个差额，却从来不显示——分歧被静默吞掉正是「两页两个数」能长期存在的原因。
    const pnlDrift = pnlSettlement && hasMaterialDrift(pnlSettlement) ? pnlSettlement.drift : null;
    // 12 项的顺序、文案与着色只在 buildCampaignPnlOverviewItems 里写一次；
    // 这里只负责把真实战役的各个 memo 收成一个纯数字对象。反事实面板走同一个构造器。
    return buildCampaignPnlOverviewItems({
      realizedPnl: pnlReconciliation?.correctedPnl ?? campaign.final_realized_pnl,
      settlement: pnlSettlement
        ? { basis: pnlSettlement.basis, stored: pnlSettlement.stored, drift: pnlDrift }
        : null,
      mainLeverage: resolveCampaignMainLeverage(campaign, legs, tradeRecords),
      initialMainExposureNotional: computeInitialMainExposureNotional(campaign, legs, tradeRecords),
      peakUnrealizedPnl: accuracy.campaign_max_profit_real,
      initialExpectedMaxLoss: accuracy.initial_expected_max_loss,
      expectedMaxDrawdownPct: campaignMetricValues?.initialExpectedMaxDrawdownPct ?? 0,
      payoffRatio: campaignMetricValues?.profitCaptureRatio ?? null,
      asymmetricRiskContribution,
      opportunityQuality: campaignMetricValues?.opportunityQuality ?? null,
      arithmeticExpectancy: campaignMetricValues?.arithmeticExpectancy ?? null,
      geometricExpectancy: campaignMetricValues?.geometricExpectancy ?? null,
      initialRisk: campaignMetricValues?.initialRisk ?? null,
      todayAccountEquity: isOwner && Number.isFinite(currentAccountEquity) && currentAccountEquity > 0
        ? currentAccountEquity
        : null,
      expectedWinRate: campaignPerformance?.expectedWinRate ?? null,
    });
  }, [
    accuracy,
    asymmetricRiskContribution,
    campaign,
    campaignMetricValues,
    campaignPerformance?.expectedWinRate,
    currentAccountEquity,
    isOwner,
    legs,
    pnlReconciliation,
    settlement,
    tradeRecords,
  ]);
  const campaignPnlOverviewNote = useMemo(() => buildCampaignPnlOverviewNote({
    performanceLoading: campaignPerformanceLoading,
    performanceError: !!campaignPerformanceError,
    expectedWinRate: campaignPerformance?.expectedWinRate ?? null,
    payoffRatioSampleCount: campaignPerformance?.payoffRatioSampleCount ?? 0,
    initialRiskSource: campaignMetricValues?.initialRisk?.source ?? null,
  }), [
    campaignMetricValues?.initialRisk?.source,
    campaignPerformance,
    campaignPerformanceError,
    campaignPerformanceLoading,
  ]);
  const chart = useMemo(
    () => (campaign ? buildChartArtifacts(campaign, legs, tradeRecords, legExitPriceCorrections) : { markers: [], timeBoundPriceLines: [], verticalLines: [], events: [] }),
    [campaign, legs, tradeRecords, legExitPriceCorrections],
  );
  // 反事实面板与真实「盈亏概览」共用的账户级输入：胜率样本、DSI/USI 汇总、今日总资产。
  const counterfactualOverviewShared = useMemo<CounterfactualOverviewShared>(() => ({
    // 老行没有落库锚时按这场战役自己的模板重算：main_only 没有保护线，不能被默认模板造出 L。
    // 首帧 campaign 还没到（下面才 return 加载态），先给默认模板占位，不会有分支用到它。
    strategyTemplate: campaign ? counterfactualTemplateFor(campaign) : 'main_dual_hedge_mirror_tp',
    expectedWinRate: campaignPerformance?.expectedWinRate ?? null,
    payoffRatioSampleCount: campaignPerformance?.payoffRatioSampleCount ?? 0,
    performanceLoading: campaignPerformanceLoading,
    performanceError: !!campaignPerformanceError,
    asymmetricRiskSummary: campaignAsymmetricRisk,
    currentAccountEquity,
    isOwner,
  }), [
    campaign,
    campaignAsymmetricRisk,
    campaignPerformance,
    campaignPerformanceError,
    campaignPerformanceLoading,
    currentAccountEquity,
    isOwner,
  ]);
  const counterfactualDraftOverview = useMemo(
    () => (counterfactualDraft ? buildCounterfactualOverview(counterfactualDraft, counterfactualOverviewShared) : null),
    [counterfactualDraft, counterfactualOverviewShared],
  );
  const selectedCounterfactualOverview = useMemo(
    () => (selectedCounterfactual ? buildCounterfactualOverview(selectedCounterfactual, counterfactualOverviewShared) : null),
    [selectedCounterfactual, counterfactualOverviewShared],
  );
  const counterfactualChart = useMemo(
    () => buildCounterfactualChartArtifacts(selectedCounterfactual),
    [selectedCounterfactual],
  );
  const selectedLegVerticalLines = useMemo(
    () => buildSelectedLegVerticalLines(legs, tradeRecords, selectedLegMarkerIds),
    [legs, tradeRecords, selectedLegMarkerIds],
  );
  // 「补齐（紫色）」反事实对照层按分支独立显示/隐藏，避免隐藏 hedge_b 后
  // 切换到其他 What-if 分支时也被连带隐藏。
  const [hiddenCounterfactualIds, setHiddenCounterfactualIds] = useState<string[]>([]);
  const [showCfLegend, setShowCfLegend] = useState(false);
  const hiddenCounterfactualStorageKey = useMemo(
    () => (campaign ? `campaign:${campaign.id}:hidden-counterfactual-overlays` : null),
    [campaign],
  );
  useEffect(() => {
    if (!hiddenCounterfactualStorageKey) {
      setHiddenCounterfactualIds([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(hiddenCounterfactualStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setHiddenCounterfactualIds(Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []);
    } catch {
      setHiddenCounterfactualIds([]);
    }
  }, [hiddenCounterfactualStorageKey]);
  const persistHiddenCounterfactualIds = useCallback((next: string[]) => {
    if (!hiddenCounterfactualStorageKey) return;
    try {
      if (next.length === 0) {
        window.localStorage.removeItem(hiddenCounterfactualStorageKey);
      } else {
        window.localStorage.setItem(hiddenCounterfactualStorageKey, JSON.stringify(next));
      }
    } catch {
      // 本地显示偏好失败不影响反事实战役数据。
    }
  }, [hiddenCounterfactualStorageKey]);
  const hiddenCounterfactualSet = useMemo(
    () => new Set(hiddenCounterfactualIds),
    [hiddenCounterfactualIds],
  );
  const showSelectedCounterfactual = selectedCounterfactual != null
    && !hiddenCounterfactualSet.has(selectedCounterfactual.id);
  const toggleSelectedCounterfactual = useCallback(() => {
    if (!selectedCounterfactual) return;
    setHiddenCounterfactualIds(prev => {
      const next = prev.includes(selectedCounterfactual.id)
        ? prev.filter(item => item !== selectedCounterfactual.id)
        : [...prev, selectedCounterfactual.id];
      persistHiddenCounterfactualIds(next);
      return next;
    });
  }, [persistHiddenCounterfactualIds, selectedCounterfactual]);
  // 「委托空单（黄色）」挂单层：只画开仓性质的 SHORT 委托；止盈/止损平仓委托不进入这里。
  const [showOrderInfo, setShowOrderInfo] = useState(true);
  const [showReverseOrderManager, setShowReverseOrderManager] = useState(false);
  const [hiddenReverseHedgeOrderIds, setHiddenReverseHedgeOrderIds] = useState<string[]>([]);
  // 盘面点选的委托线 ⇄ 管理区色块：两边按同一组委托 id 同步高亮。
  const [selectedReverseOrderIds, setSelectedReverseOrderIds] = useState<string[]>([]);
  const hiddenReverseOrderStorageKey = useMemo(
    () => (campaign ? `campaign:${campaign.id}:hidden-reverse-hedge-orders` : null),
    [campaign],
  );
  useEffect(() => {
    if (!hiddenReverseOrderStorageKey) {
      setHiddenReverseHedgeOrderIds([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(hiddenReverseOrderStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setHiddenReverseHedgeOrderIds(Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []);
    } catch {
      setHiddenReverseHedgeOrderIds([]);
    }
  }, [hiddenReverseOrderStorageKey]);
  const persistHiddenReverseHedgeOrderIds = useCallback((next: string[]) => {
    if (!hiddenReverseOrderStorageKey) return;
    try {
      if (next.length === 0) {
        window.localStorage.removeItem(hiddenReverseOrderStorageKey);
      } else {
        window.localStorage.setItem(hiddenReverseOrderStorageKey, JSON.stringify(next));
      }
    } catch {
      // 本地隐藏偏好失败不影响战役数据。
    }
  }, [hiddenReverseOrderStorageKey]);
  const hideReverseHedgeOrder = useCallback((orderId: string) => {
    setHiddenReverseHedgeOrderIds(prev => {
      if (prev.includes(orderId)) return prev;
      const next = [...prev, orderId];
      persistHiddenReverseHedgeOrderIds(next);
      return next;
    });
  }, [persistHiddenReverseHedgeOrderIds]);
  const restoreHiddenReverseHedgeOrders = useCallback(() => {
    setHiddenReverseHedgeOrderIds([]);
    persistHiddenReverseHedgeOrderIds([]);
  }, [persistHiddenReverseHedgeOrderIds]);
  const hiddenReverseOrderSet = useMemo(
    () => new Set(hiddenReverseHedgeOrderIds),
    [hiddenReverseHedgeOrderIds],
  );
  const displayableReverseHedgeOrders = useMemo(
    () => reverseHedgeOrders.filter(isDisplayableReverseHedgeOrder),
    [reverseHedgeOrders],
  );
  const visibleReverseHedgeOrders = useMemo(
    () => displayableReverseHedgeOrders.filter(order => !hiddenReverseOrderSet.has(order.id)),
    [displayableReverseHedgeOrders, hiddenReverseOrderSet],
  );
  // 「他场委托」（灰色）：与本场委托共用眼睛开关与隐藏列表，但不进黄色层、不进任何指标。
  const displayableForeignLiveOrders = useMemo(
    () => foreignLiveOrders.filter(isDisplayableReverseHedgeOrder),
    [foreignLiveOrders],
  );
  const visibleForeignLiveOrders = useMemo(
    () => displayableForeignLiveOrders.filter(order => !hiddenReverseOrderSet.has(order.id)),
    [displayableForeignLiveOrders, hiddenReverseOrderSet],
  );
  // Legs 表 Δb 列的分母：战役初始最大预期亏损 L
  const legsInitialExpectedMaxLoss = useMemo(
    () => (campaign ? computeInitialExpectedMaxLoss(campaign, legs, tradeRecords, reverseHedgeOrders) : null),
    [campaign, legs, tradeRecords, reverseHedgeOrders],
  );
  const hiddenReverseOrderCount = useMemo(
    () => [...displayableReverseHedgeOrders, ...displayableForeignLiveOrders]
      .filter(order => hiddenReverseOrderSet.has(order.id)).length,
    [displayableReverseHedgeOrders, displayableForeignLiveOrders, hiddenReverseOrderSet],
  );
  // 手动开的对冲空单：与被触发的委托空单同一个目的，同在这一层、同样黄色（见 buildManualHedgeShortPriceLines）。
  const manualHedgeShortLegs = useMemo<HedgeShortLegExecution[]>(() => {
    const lookup = buildTradeRecordLookup(tradeRecords);
    const result: HedgeShortLegExecution[] = [];
    for (const leg of legs) {
      if (!isHedgeShortLeg(leg)) continue;
      const record = leg.trade_record_id ? lookup.get(leg.trade_record_id) ?? null : null;
      const resolved = resolveLegExecution(leg, record, legExitPriceCorrections);
      // 既没有成交记录、也没有平仓时刻的是计划中的对冲，还不是开出来的单。
      if (!resolved.record && resolved.closeTime == null) continue;
      result.push({
        legId: leg.id,
        recordId: resolved.record?.id ?? null,
        openTime: resolved.openTime,
        closeTime: resolved.closeTime,
        entryPrice: resolved.entryPrice,
      });
    }
    return result;
  }, [legs, tradeRecords, legExitPriceCorrections]);
  const hasReverseOrders = displayableReverseHedgeOrders.length > 0;
  const hasManualHedgeShorts = manualHedgeShortLegs.length > 0;
  const hasForeignLiveOrders = displayableForeignLiveOrders.length > 0;
  const hasYellowOrderLayer = hasReverseOrders || hasManualHedgeShorts;
  // 眼睛开关的说明按盘上真有的层来写：只有他场委托时不能还说「委托/手动对冲空单（黄色）」
  const orderLayerNames = [
    hasReverseOrders && '委托',
    hasManualHedgeShorts && '手动对冲空单',
    hasForeignLiveOrders && '他场委托',
  ].filter((name): name is string => Boolean(name));
  const orderLayerColors = [hasYellowOrderLayer && '黄色', hasForeignLiveOrders && '灰色'].filter(Boolean).join('、');
  const orderLayerToggleVerb = showOrderInfo ? '隐藏' : '显示';
  const orderLayerToggleTitle = `${orderLayerToggleVerb}${orderLayerNames.join('/')}（${orderLayerColors}）`;
  const orderLayerToggleLabel = `${orderLayerToggleVerb}${orderLayerNames.length > 2 ? orderLayerNames.join('、') : orderLayerNames.join('与')}`;
  const orderInfoPriceLines = useMemo<TimeBoundPriceLine[]>(() => {
    if (!campaign) return [];
    const fallbackEnd = campaign.closed_at
      ? new Date(campaign.closed_at).getTime()
      : (klines.length > 0 ? klines[klines.length - 1].time : 0);
    return [
      ...buildCampaignReverseOrderPriceLines(visibleReverseHedgeOrders, tradeRecords, fallbackEnd),
      // 「是不是触发单开出的腿」按全部可显示的委托判，隐藏某张委托不会让它的腿冒充手动单。
      ...buildManualHedgeShortPriceLines(manualHedgeShortLegs, displayableReverseHedgeOrders, tradeRecords, fallbackEnd),
      // 他场委托：灰色淡虚线，跟着同一个眼睛开关，但不是黄色层的一部分
      ...buildForeignReplayOrderPriceLines(visibleForeignLiveOrders, fallbackEnd),
    ];
  }, [campaign, visibleReverseHedgeOrders, displayableReverseHedgeOrders, visibleForeignLiveOrders, manualHedgeShortLegs, tradeRecords, klines]);
  // 隐藏的委托、关掉的委托层都不再算选中——免得管理区里看不见的单子还挂着高亮。
  const activeSelectedReverseOrderSet = useMemo(() => {
    if (!showOrderInfo) return new Set<string>();
    const visibleIds = new Set([...visibleReverseHedgeOrders, ...visibleForeignLiveOrders].map(order => order.id));
    return new Set(selectedReverseOrderIds.filter(id => visibleIds.has(id)));
  }, [showOrderInfo, visibleReverseHedgeOrders, visibleForeignLiveOrders, selectedReverseOrderIds]);
  const orderLineIdsBySelectId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const line of orderInfoPriceLines) {
      if (line.orderIds?.length) map.set(line.orderIds.join('|'), line.orderIds);
    }
    return map;
  }, [orderInfoPriceLines]);
  const selectableOrderInfoPriceLines = useMemo<TimeBoundPriceLine[]>(
    () => orderInfoPriceLines.map(line => (line.orderIds?.length
      ? {
        ...line,
        selectId: line.orderIds.join('|'),
        selected: line.orderIds.some(id => activeSelectedReverseOrderSet.has(id)),
      }
      : line)),
    [orderInfoPriceLines, activeSelectedReverseOrderSet],
  );
  const selectReverseOrderLine = useCallback((selectId: string) => {
    const ids = orderLineIdsBySelectId.get(selectId);
    if (!ids) return;
    // 再点同一条线取消选中
    setSelectedReverseOrderIds(prev => (
      prev.length === ids.length && ids.every(id => prev.includes(id)) ? [] : ids
    ));
    // 管理区收着时展开，色块才看得见
    setShowReverseOrderManager(true);
  }, [orderLineIdsBySelectId]);
  const toggleReverseOrderSelection = useCallback((orderId: string) => {
    setSelectedReverseOrderIds(prev => (prev.length === 1 && prev[0] === orderId ? [] : [orderId]));
  }, []);
  const displayMarkers = useMemo(
    () => [...chart.markers, ...(showSelectedCounterfactual ? counterfactualChart.markers : [])],
    [chart.markers, counterfactualChart.markers, showSelectedCounterfactual],
  );
  const displayPriceLines = useMemo(
    () => [
      ...chart.timeBoundPriceLines,
      ...(showSelectedCounterfactual ? counterfactualChart.timeBoundPriceLines : []),
      ...(showOrderInfo ? selectableOrderInfoPriceLines : []),
    ],
    [chart.timeBoundPriceLines, counterfactualChart.timeBoundPriceLines, showSelectedCounterfactual, selectableOrderInfoPriceLines, showOrderInfo],
  );
  const displayVerticalLines = useMemo(
    () => [...chart.verticalLines, ...(showSelectedCounterfactual ? counterfactualChart.verticalLines : []), ...selectedLegVerticalLines],
    [chart.verticalLines, counterfactualChart.verticalLines, selectedLegVerticalLines, showSelectedCounterfactual],
  );
  const canSuggestEnd = useMemo(
    () => (campaign ? shouldSuggestCampaignEnd(campaign, legs, tradeRecords, pendingOrders, getEffectiveTime(campaign.symbol)) : false),
    [campaign, legs, tradeRecords, pendingOrders, getEffectiveTime],
  );
  // 偏离代价（手动调整 vs 原始）：取当前选中「手动运行」分支的 manual_legs，与原始基线 legs 逐腿对比。
  // 合计 = 手动调整总盈亏 − 原始实盘总盈亏 = 原始错误的总代价。
  const deviationLegCosts = useMemo<ManualLegDeviationCost[]>(() => {
    if (!campaign || !selectedCounterfactual) return [];
    const adjustedLegs = selectedCounterfactual.params?.manual_legs ?? [];
    if (adjustedLegs.length === 0) return [];
    const actualParams = buildActualSimulationParams(campaign, legs, tradeRecords);
    if (!actualParams) return [];
    const originalLegs = buildManualLegs(
      actualParams, legs, klines, tradeRecords, legExitPriceCorrections, { campaign, localOrders: localOrderFacts },
    );
    // 老行的兜底平仓时间按那次运行的 K 线末根与改动摘要认：换了周期、窗口长了都不能读成「改过」。
    return computeManualLegDeviationCosts(
      originalLegs,
      adjustedLegs,
      selectedCounterfactual.params?.run_context?.to ?? null,
      selectedCounterfactual.params?.change_summary ?? null,
    );
  }, [campaign, selectedCounterfactual, legs, tradeRecords, klines, legExitPriceCorrections, localOrderFacts]);
  // 门槛：选中分支是「手动运行」分支（带 manual_legs）才展示偏离明细。
  const hasManualRunBranch = (selectedCounterfactual?.params?.manual_legs ?? []).length > 0;
  // 已保存分支列表里隐藏自动生成的「修正分支」(补齐 X)，只保留 Pure SOP 与自定义 What-if。
  const visibleBranches = useMemo(
    () => counterfactuals.filter(isVisibleCounterfactualBranch),
    [counterfactuals],
  );
  const retroactiveLegCount = useMemo(
    () => legs.filter(leg => leg.source === 'retroactive_from_record').length,
    [legs],
  );

  // 载入该战役已保存的偏离备注（存在战役行上，互关者一并读到）。
  useEffect(() => {
    if (!campaign) return;
    setDeviationNotes(campaign.deviation_notes ?? {});
  }, [campaign]);

  if (loading || !campaign || !accuracy) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4">
        <Skeleton className="h-16 w-full bg-card" />
        <Skeleton className="h-36 w-full bg-card" />
        <Skeleton className="h-[560px] w-full bg-card" />
      </div>
    );
  }

  // 主图当前时间游标：聚焦到某事件时用 focusTime，否则停在当前倍率窗口的最右端。
  // 关键：ReplayKlineChart 会用 `line.time <= currentTime` 过滤竖线/标记，并以 currentTime 作为可见区右沿。
  // 数据层实际预载 51 倍范围；首次打开仍只铺满「前 1 倍 + 战役 1 倍 + 后 1 倍」。
  // 必须放在上面的 loading guard 之后——此时 campaign 一定非空；放在 guard 之前会在
  // 首帧（campaign 仍为 null）就解引用 campaign.opened_at 直接崩溃、整页白屏。
  // ReplayKlineChart 用 currentTime 当「标注截止时刻」（marker/竖线/委托线都按 time <= currentTime 过滤）。
  // 倍率档位天生 toTime >= contentEnd，这个 max 是恒等的；但绝对预设的右沿会被夹到「现在」，
  // 一旦落在战役内容右端之前，整段后半程的 marker 与竖线会无声消失。
  const chartDefaultCurrentTime = Math.max(
    campaignKlineVisibleRange.toTime,
    campaignKlineTimeWindow.contentEndMs ?? Number.NEGATIVE_INFINITY,
  );
  const chartDefaultViewportCenterTime = Math.round(
    (campaignKlineVisibleRange.fromTime + campaignKlineVisibleRange.toTime) / 2,
  );
  const chartCurrentTime = focusTime ?? chartDefaultCurrentTime;
  const chartViewportCenterTime = focusTime ?? chartDefaultViewportCenterTime;

  const mainCount = legs.filter((leg: TradeJournal) => leg.leg_role === 'main_open' || leg.leg_role === 'reentry_main' || leg.leg_role?.startsWith('main_add_')).length;
  const hedgeCount = legs.filter((leg: TradeJournal) => leg.leg_role?.startsWith('hedge_')).length;
  const tpCount = legs.filter((leg: TradeJournal) => leg.leg_role === 'mirror_tp').length;
  const otherCount = Math.max(0, legs.length - mainCount - hedgeCount - tpCount);
  /**
   * 页眉、结束按钮、导出文件名读的状态：已结算 → 由校正后的结算推出；
   * 未结算（进行中）→ 落库状态原样。与已实现 P&L 同一份 settlement。
   */
  const displayStatus = (displayCampaign ?? campaign).status;
  /**
   * 反事实的「相对实际」和「占本场盈亏 %」的基线：**界面上印的那个已实现 P&L**。
   * 盈亏概览读的是叠了平仓价校正的现算值（pnlReconciliation.correctedPnl），
   * 落库的 final_realized_pnl 只有在已结算的战役上才与它相等——
   * 进行中的战役拿落库值当基线，会印出一个和上面那格对不上的差额。
   */
  const actualPnl = pnlReconciliation?.correctedPnl ?? (displayCampaign ?? campaign).final_realized_pnl ?? 0;
  const totalDeviationCost = deviationLegCosts.reduce((sum, item) => sum + item.cost_usdt, 0);
  const selectedCounterfactualDelta = selectedCounterfactual
    ? counterfactualDelta(selectedCounterfactual.result.final_realized_pnl, actualPnl)
    : null;

  const refreshCampaign = async () => {
    const full = await getCampaignFullData(campaign.id);
    setCampaign(full.campaign);
    setLegs(full.legs);
    setTradeRecords(full.tradeRecords);
    setLegExitPriceCorrections(full.legExitPriceCorrections ?? {});
    setPendingOrders(full.pendingOrders);
    setReverseHedgeOrders(full.reverseHedgeOrders);
    setForeignLiveOrders(full.foreignLiveOrders ?? []);
    adoptUnfilledOrderIds(full.unfilledOrderIds);
  };

  // 管理区色块：本场的委托与「他场」委托共用同一套点选 / 隐藏，他场的整体压灰并带「他场」标签。
  const renderReverseOrderChip = (order: CampaignReverseHedgeOrder, foreign = false) => {
    const selected = activeSelectedReverseOrderSet.has(order.id);
    return (
      <div
        key={order.id}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        data-testid={foreign ? 'foreign-replay-order-chip' : 'reverse-order-chip'}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => toggleReverseOrderSelection(order.id)}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggleReverseOrderSelection(order.id);
        }}
        className={`group inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[10px] transition-colors ${
          foreign
            ? selected
              ? 'border-[#848E9C] bg-[#848E9C]/15 text-foreground/80'
              : 'border-border/30 bg-muted/10 text-muted-foreground/60 hover:border-[#848E9C]/40'
            : selected
              ? 'border-[#F0B90B] bg-[#F0B90B]/20 text-foreground shadow-[0_0_0_1px_rgba(240,185,11,0.45)]'
              : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-[#F0B90B]/40'
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 shrink-0 rounded-[2px] transition-colors ${
            foreign
              ? selected ? 'bg-[#848E9C]' : 'bg-[#848E9C]/25'
              : selected ? 'bg-[#F0B90B]' : 'bg-[#F0B90B]/25'
          }`}
        />
        {foreign && <span className="rounded-sm bg-muted/40 px-1 text-[9px] text-muted-foreground/70">他场</span>}
        <span className={foreign ? '' : selected ? 'font-medium text-[#F0B90B]' : 'text-[#F0B90B]/80'}>{reverseOrderStatusText(order)}</span>
        <span>{fmtReverseOrderChipTime(order.createdAt)}</span>
        <span>@ {fmtReverseOrderChipPrice(order.price)}</span>
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            hideReverseHedgeOrder(order.id);
          }}
          title={foreign ? '从盘面隐藏这条他场委托' : '从盘面隐藏这条委托空单'}
          aria-label={foreign ? '从盘面隐藏这条他场委托' : '从盘面隐藏这条委托空单'}
          className="ml-0.5 inline-flex items-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-[#F6465D] group-hover:opacity-100"
        >
          <EyeOff className="w-3 h-3" />
        </button>
      </div>
    );
  };

  const reloadCounterfactuals = async (campaignId: string, keepSelectionId?: string | null) => {
    const fetched = await listCounterfactuals(campaignId);
    // 等待期间用户可能已切到别的战役：这份列表属于旧战役，不能盖到新战役头上。
    if (activeCampaignIdRef.current !== campaignId) return;
    // 查询发出之后才删掉的分支还在这份结果里：删掉的行不会再回来，按本页删过的 id 滤掉，免得它死而复生、又被选中。
    const next = fetched.filter(branch => !deletedCounterfactualIdsRef.current.has(branch.id));
    setCounterfactuals(next);
    setSelectedCounterfactualId(keepSelectionId ?? firstVisibleCounterfactualId(next));
  };

  const handleRunWhatIf = async (
    label: string,
    params: CampaignCounterfactualParams,
    context?: CampaignWhatIfRunContext,
  ) => {
    if (klinesLoading || klines.length === 0) {
      toast.error('K 线尚未加载完成，暂时无法运行 What-if');
      return;
    }
    // 模拟引擎会走完整个 klines 数组，并用最后一根收盘结算未平仓位。
    // 绝对预设下这个数组是「1 天 / 1 周 / 1 月」的窗口，同一组参数会因为
    // 当时恰好选了哪个预设而写出不同的 final_realized_pnl —— 这是会污染库里数据的静默错误。
    if (chartRangeSelection.kind === 'absolute') {
      toast.error('当前是绝对时间范围预设，请先切回倍率视图再运行 What-if');
      return;
    }
    try {
      setWhatIfRunning(true);
      const runLegs = params.manual_legs ?? [];
      // 改动摘要在运行那一刻算：基线与编辑器当前腿都来自编辑器，之后 legs 再变也不影响已落库的摘要。
      const changeSummary = buildCounterfactualChangeSummary(
        context?.baselineLegs ?? [],
        context?.manualLegs ?? runLegs,
        runLegs,
      );
      const ranAt = new Date();
      // 只运行、不落库：结果先摆成「反事实盈亏概览 · 未保存」，用户点「保存」才写库。
      // 风险锚上下文：战役页算 L / 预期回撤时读的反向委托、历史归类标记与初始对冲事件，副本按同一份锚。
      const riskContext = buildCounterfactualRiskContext(campaign, reverseHedgeOrders);
      // 真实战役此刻算不算「已了结」（机会质量的门槛），与上方盈亏概览同一条规则。
      const actualResolved = resolveCounterfactualActualResolved(campaign, legs, tradeRecords, legExitPriceCorrections);
      const run = await runCustomCounterfactual(
        campaign.id,
        {
          ...params,
          change_summary: changeSummary,
          ...(riskContext ? { risk_context: riskContext } : {}),
          actual_resolved: actualResolved,
        },
        klines,
        effectiveInterval,
      );
      setCounterfactualDraft({ params: run.params, result: run.result });
      setCounterfactualDraftName(defaultCounterfactualName(changeSummary, run.params.run_context?.ran_at ?? ranAt));
      toast.success(`${label}已运行，结果尚未保存`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setWhatIfRunning(false);
    }
  };

  const handleSaveCounterfactualDraft = async () => {
    // 整个流程只认点「保存」那一刻的那一份草稿：插库期间用户又点了一次「一键运行」，
    // 页面上的草稿已经换成新的一份，清空时必须认出来——否则刚跑出来、还没看过的结果被静默抹掉。
    const draft = counterfactualDraft;
    if (!draft) return;
    // 整个流程只认点「保存」那一刻的战役：插库期间用户切到别的战役，这行仍属于旧战役，
    // 不能塞进新战役的列表、更不能把新战役的列表换成旧战役的。
    const campaignId = campaign.id;
    const fallbackName = defaultCounterfactualName(
      draft.params.change_summary,
      draft.params.run_context?.ran_at ?? new Date(),
    );
    const name = (counterfactualDraftName.trim() || fallbackName).slice(0, COUNTERFACTUAL_NAME_MAX_LENGTH);
    try {
      setCounterfactualDraftSaving(true);
      const created = await createCounterfactual({
        campaign_id: campaignId,
        label: name,
        branch_kind: 'custom_what_if',
        params: draft.params,
        result: draft.result,
      });
      toast.success(`反事实「${name}」已保存`);
      // 已切走：草稿早在换战役那一刻清掉了，列表也不是这场的，到此为止。
      if (activeCampaignIdRef.current !== campaignId) return;
      // 草稿已经被下一次运行换掉了就原样留着（名字同理，它是跟着那份草稿一起改的）。
      let draftReplaced = false;
      setCounterfactualDraft(prev => {
        draftReplaced = prev !== draft;
        return draftReplaced ? prev : null;
      });
      setCounterfactualDraftName(prev => (draftReplaced ? prev : ''));
      // 先把新行放进列表并选中，再按库里的顺序刷新一遍；两步都指向同一个 id。
      setCounterfactuals(prev => [created, ...prev.filter(branch => branch.id !== created.id)]);
      setSelectedCounterfactualId(created.id);
      await reloadCounterfactuals(campaignId, created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCounterfactualDraftSaving(false);
    }
  };

  const handleDiscardCounterfactualDraft = () => {
    setCounterfactualDraft(null);
    setCounterfactualDraftName('');
    toast.info('已丢弃本次运行结果，未保存');
  };

  const handleLoadCounterfactualLegs = (branch: CampaignCounterfactual) => {
    const legsToLoad = branch.params?.manual_legs ?? [];
    if (legsToLoad.length === 0) {
      toast.warning('这条分支没有手动 Legs 可载入');
      return;
    }
    loadLegsNonceRef.current += 1;
    setLoadLegsRequest({
      nonce: loadLegsNonceRef.current,
      legs: legsToLoad.map(leg => ({ ...leg })),
      savedWindowEnd: branch.params?.run_context?.to ?? null,
      savedChangeSummary: branch.params?.change_summary ?? null,
    });
    toast.success(`已把「${branch.label}」的 Legs 载入副本，可继续调整后再次运行`);
  };

  const handleDeleteBranch = async (branchId: string) => {
    const campaignId = campaign.id;
    try {
      await deleteCounterfactual(branchId);
      toast.success('分支已删除');
      // 与保存同一条规则：删除期间切走了，就别再拿旧战役的列表改新战役的状态。
      deletedCounterfactualIdsRef.current.add(branchId);
      if (activeCampaignIdRef.current !== campaignId) return;
      // 一律用函数式更新：删除悬着的时候，保存可能已经把新分支加进列表并选中了它，
      // 拿点「删除」那一刻的旧列表和旧选中去改，会把刚保存的分支一起抹掉。
      // remaining 在列表的更新函数里算出，选中的更新函数紧随其后执行——
      // counterfactuals 的 useState 声明在 selectedCounterfactualId 之前，React 按声明顺序处理两者的更新队列。
      let remaining: CampaignCounterfactual[] = [];
      setCounterfactuals(prev => {
        remaining = prev.filter(branch => branch.id !== branchId);
        return remaining;
      });
      setSelectedCounterfactualId(prev => (prev === branchId ? firstVisibleCounterfactualId(remaining) : prev));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveDeviationNotes = async () => {
    if (!user || !campaign) return;
    try {
      setDeviationNotesSaving(true);
      await saveCampaignDeviationNotes(campaign.id, deviationNotes);
      const syncResult = await syncCampaignDeviationRulesToChecklist(user.id, deviationNotes, deviationLegCosts, campaign.id);
      setCampaign(prev => (prev ? { ...prev, deviation_notes: deviationNotes } : prev));
      if (syncResult.created > 0) {
        toast.success(`偏离备注已保存，并同步 ${syncResult.created} 条规则`);
      } else if (syncResult.drafts > 0) {
        toast.success('偏离备注已保存，规则已在复盘中心中');
      } else {
        toast.success('偏离备注已保存');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeviationNotesSaving(false);
    }
  };

  const handleExportCampaignBoardPng = async () => {
    if (!campaign || legsExporting) return;
    try {
      setLegsExporting(true);
      const fileName = await exportCampaignBoardPng({
        // 标题 slug（profit / loss）、文件名、「方向 / 状态」、「最终 R」全部读派生后的行，
        // 与图中 Legs 合计、盈亏概览同一份校正。
        campaign: displayCampaign ?? campaign,
        initialExpectedMaxLoss: legsInitialExpectedMaxLoss,
        accountName: campaignAccountName,
        legs,
        tradeRecords,
        reverseHedgeOrders: visibleReverseHedgeOrders,
        foreignLiveOrders: visibleForeignLiveOrders,
        legExitPriceCorrections,
        chartElement: campaignChartExportRef.current,
        chartInterval: effectiveInterval,
        pnlOverview: {
          items: campaignPnlOverviewItems.map(({ key, label, value, color }) => ({
            key,
            label,
            value,
            color,
          })),
          note: campaignPnlOverviewNote,
        },
        emotionDiary: campaignEmotionDiarySummary,
        emotionDiaryCollapsed,
      });
      toast.success('交易战役完整图片已保存为 PNG', { description: fileName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLegsExporting(false);
    }
  };

  const handleExportCampaignReviewsTxt = () => {
    if (!campaign || reviewedLegs.length === 0) return;
    try {
      // 三个 TXT 的文件名 slug 同样来自状态：一律用派生后的行。
      const fileName = exportCampaignPostReviewsTxt(displayCampaign ?? campaign, legs, campaignAccountName, tradeRecords);
      toast.success('平仓评价已保存为 TXT', { description: fileName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleExportCampaignSnapshotsTxt = () => {
    if (!campaign || openingSnapshotLegs.length === 0) return;
    try {
      const fileName = exportCampaignOpeningSnapshotsTxt(
        displayCampaign ?? campaign,
        openingSnapshotLegs,
        campaignAccountName,
      );
      toast.success('开仓快照已保存为 TXT', { description: fileName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleExportCampaignEmotionDiaryTxt = () => {
    if (!campaign || !campaignEmotionDiary) return;
    try {
      const fileName = exportCampaignEmotionDiaryTxt(
        displayCampaign ?? campaign,
        campaignEmotionDiary,
        campaignAccountName,
      );
      toast.success('操作日情绪日记已保存为 TXT', { description: fileName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleBackToCampaigns = () => {
    const navigationState = location.state as CampaignDetailNavigationState | null;
    if (navigationState?.fromCampaignList) {
      nav(-1);
      return;
    }
    nav(`/journal/campaigns${location.search}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleBackToCampaigns}
              aria-label="返回进入前的交易战役列表"
              title="返回进入前的列表状态"
              className="h-8 w-8 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium truncate">{campaign.title}</h1>
              <div className="font-mono text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
                <span
                  className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px]"
                  title={`战役编号 ${campaignDisplayCode}`}
                >
                  {campaignDisplayCode}
                </span>
                <span>{campaign.symbol}</span>
                <span className={`px-2 py-0.5 rounded ${campaign.direction === 'main_long' ? 'bg-[#0ECB81]/10 text-[#0ECB81]' : 'bg-[#F6465D]/10 text-[#F6465D]'}`}>
                  {campaign.direction === 'main_long' ? '主多' : '主空'}
                </span>
                {/* 状态读派生值：与下方已实现 P&L、Legs 合计、导出图同一份校正后的结算。 */}
                <span
                  data-testid="campaign-status-chip"
                  className={`px-2 py-0.5 rounded ${chipForStatus(displayStatus)}`}
                  title={displayStatus}
                >
                  {campaignStatusLabel(displayStatus)}
                </span>
              </div>
            </div>
          </div>
          {displayStatus === 'active' && (
            <Button className="bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 h-8" onClick={() => setEndOpen(true)}>
              结束战役
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
        {canSuggestEnd && (
          <div className="text-[11px] text-[#F0B90B] bg-[#F0B90B]/10 px-3 py-2 rounded border border-[#F0B90B]/30">
            本战役看起来已经结束（主仓全平且无活跃挂单）。建议立即点击右上角[结束战役]录入最终复盘。
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded p-4 space-y-2 text-[12px]">
            <div className="font-medium">战役元数据</div>
            <div className="text-muted-foreground">
              操作时间：{objectiveOperationTime == null ? '—' : fmtMdHm(new Date(objectiveOperationTime).toISOString())}
            </div>
            <div>开始：{fmtMdHm(campaign.opened_at)}</div>
            <div>结束：{fmtMdHm(campaign.closed_at)}</div>
            <div>持续时间：{fmtDuration(campaign.opened_at, campaign.closed_at)}</div>
            <div>legs 数：{legs.length} (主仓 {mainCount} / 对冲 {hedgeCount} / TP {tpCount} / 其他 {otherCount})</div>
            {retroactiveLegCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span>本战役 legs 中含 {retroactiveLegCount} 个历史回填项</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground">
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px] text-[11px]">
                    历史回填的 legs 缺少原始开仓决策信息，SOP 评分会跳过这些 legs。
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
            <div className="text-[11px] text-muted-foreground/70 pt-1">未标注的时间均为 K 线（模拟）时间。</div>
          </div>

          <CampaignPnlOverviewPanel
            title="盈亏概览"
            items={campaignPnlOverviewItems}
            note={campaignPnlOverviewNote}
          />

        </section>

        {isOwner && campaignOperationDate && (
          <section className="border border-border bg-card" data-testid="campaign-emotion-diary">
            <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${emotionDiaryCollapsed ? '' : 'border-b border-border'}`}>
              <button
                type="button"
                data-testid="campaign-emotion-diary-toggle"
                aria-expanded={!emotionDiaryCollapsed}
                aria-controls="campaign-emotion-diary-body"
                aria-label={emotionDiaryCollapsed ? '展开操作日情绪日记' : '折叠操作日情绪日记'}
                title={emotionDiaryCollapsed ? '展开（导出图片也会显示内容）' : '折叠（导出图片也只保留标题）'}
                onClick={toggleEmotionDiaryCollapsed}
                className="-ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform ${emotionDiaryCollapsed ? '-rotate-90' : ''}`}
                />
              </button>
              <div>
                <div className="text-[12px] font-medium">
                  操作日情绪日记
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {campaignOperationDate}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  按客观操作时间关联，不使用 K 线模拟时间
                  {emotionDiaryCollapsed ? ' · 已折叠，导出图片同样不显示内容' : ''}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => nav(`/journal/emotion-diary?date=${campaignOperationDate}`)}
                className="ml-auto h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {campaignEmotionDiary ? '查看 / 编辑' : '去记录'}
              </Button>
            </div>
            {emotionDiaryCollapsed ? null : campaignEmotionDiaryLoading ? (
              <div id="campaign-emotion-diary-body" className="px-4 py-5 text-[11px] text-muted-foreground">正在读取操作日日记…</div>
            ) : campaignEmotionDiarySummary ? (
              <div id="campaign-emotion-diary-body" className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_420px]">
                <div>
                  <div className="text-[10px] text-muted-foreground">最近起波澜的事情</div>
                  <div className="mt-1 whitespace-pre-wrap text-[12px] leading-6">
                    {campaignEmotionDiarySummary.eventText}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-l-0 border-border lg:border-l lg:pl-4">
                  {(campaignEmotionDiarySummary.pomsTotal
                    ? [
                      ['POMS 总心境扰乱', campaignEmotionDiarySummary.pomsTotal],
                      ['PANAS 正性情感', campaignEmotionDiarySummary.panasPositive ?? '—'],
                      ['PANAS 负性情感', campaignEmotionDiarySummary.panasNegative ?? '—'],
                      [
                        '个人主动性 PI-7',
                        campaignEmotionDiarySummary.personalInitiativeTotal
                          && campaignEmotionDiarySummary.personalInitiativeMean
                          ? `${campaignEmotionDiarySummary.personalInitiativeTotal} · 均分 ${campaignEmotionDiarySummary.personalInitiativeMean}`
                          : '未填写',
                      ],
                      ['焦虑 HADS-A', campaignEmotionDiarySummary.anxiety],
                      ['抑郁 HADS-D', campaignEmotionDiarySummary.depression],
                    ]
                    : [
                      ['历史 SAM 情绪效价', campaignEmotionDiarySummary.legacyValence ?? '—'],
                      ['历史 SAM 情绪唤醒度', campaignEmotionDiarySummary.legacyArousal ?? '—'],
                      ['焦虑 HADS-A', campaignEmotionDiarySummary.anxiety],
                      ['抑郁 HADS-D', campaignEmotionDiarySummary.depression],
                    ]
                  ).map(([label, value]) => (
                    <div key={label}>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                      <div className="mt-1 font-mono text-[11px]">{value}</div>
                    </div>
                  ))}
                  {campaignEmotionDiarySummary.pomsDimensions && (
                    <div className="col-span-2 border-t border-border/70 pt-2">
                      <div className="text-[10px] text-muted-foreground">POMS 七个分量表</div>
                      <div className="mt-1 text-[10px] leading-5">
                        {campaignEmotionDiarySummary.pomsDimensions}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div id="campaign-emotion-diary-body" className="px-4 py-5 text-[11px] text-muted-foreground">
                该操作日尚未记录情绪日记。记录后会自动出现在这里及战役导出文件中。
              </div>
            )}
          </section>
        )}

        <section className="space-y-3">
          <div className="bg-card border border-border rounded p-2">
            <div className="h-9 px-2 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                {INTERVALS.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setIntervalTouched(true);
                      setInterval(item);
                    }}
                    title={effectiveInterval !== item && intervalTouched && interval === item
                      ? `当前绝对时间预设下已自动放粗到 ${effectiveInterval}，避免 K 线被压成 1 像素`
                      : undefined}
                    className={`h-6 px-2 rounded text-[10px] font-mono ${effectiveInterval === item ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="h-4 w-px bg-border/70" />
              <div className="flex items-center gap-0.5" aria-label="K 线显示范围">
                {CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS.map(multiplier => (
                  <button
                    key={multiplier}
                    type="button"
                    title={`显示 ${multiplier} 倍战役时间范围（约 ${formatCampaignSpanLabel(
                      campaignMultiplierSpanMs(campaignKlineBaseWindow, multiplier),
                    )}）`}
                    aria-label={`显示 ${multiplier} 倍战役时间范围`}
                    aria-pressed={chartRangeSelection.kind === 'multiplier' && chartRangeSelection.multiplier === multiplier}
                    onClick={() => {
                      setFocusTime(null);
                      setChartRangeSelection({ kind: 'multiplier', multiplier });
                    }}
                    className={`h-5 min-w-6 rounded px-1 text-[9px] font-mono transition-colors ${
                      chartRangeSelection.kind === 'multiplier' && chartRangeSelection.multiplier === multiplier
                        ? 'bg-foreground/85 text-background'
                        : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {multiplier}x
                  </button>
                ))}
                <div className="h-4 w-px bg-border/70 mx-1" />
                {CAMPAIGN_ABSOLUTE_RANGE_PRESETS.map(preset => {
                  /*
                   * 绝对档一律可点。
                   *
                   * 曾按「比 51 倍还窄就置灰」处理，结果恰好在最该有它们的两头全锁死：
                   * 67 秒的战役 51 倍已是 25.5 小时，「1天」一进来就是灰的；
                   * 而超过 14 小时的战役三个档全灰，一排点不动的按钮读起来就是坏了。
                   * 「正好一天」本身就是一种有意义的取景，不该因为另一个档更宽而禁用；
                   * 比战役本身还窄的情形另有兜底（effectiveSpan 取 max，战役永远在画面内）。
                   */
                  const pressed = chartRangeSelection.kind === 'absolute' && chartRangeSelection.key === preset.key;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      title={`以战役为中心显示 ${preset.label} K 线（不短于战役本身，右沿不超过现在）`}
                      aria-label={`显示 ${preset.label} K 线范围`}
                      aria-pressed={pressed}
                      onClick={() => {
                        setFocusTime(null);
                        // nowMs 在点击这一刻取样并随选择冻结：放进 memo 里裸调 Date.now()
                        // 会让 fromTime/toTime 每帧都变，等于无限重取 + 图表反复重挂。
                        setChartRangeSelection({ kind: 'absolute', key: preset.key, nowMs: Date.now() });
                      }}
                      className={`h-5 min-w-7 rounded px-1 text-[9px] font-mono transition-colors ${
                        pressed
                          ? 'bg-foreground/85 text-background'
                          : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {campaignKlineBaseWindow.contentStartMs != null
                && campaignKlineBaseWindow.contentEndMs != null
                && campaignKlineBaseWindow.contentEndMs - campaignKlineBaseWindow.contentStartMs < CAMPAIGN_MIN_CONTEXT_MS && (
                <div className="text-[9px] text-muted-foreground/70">
                  本战役仅 {formatCampaignSpanLabel(
                    campaignKlineBaseWindow.contentEndMs - campaignKlineBaseWindow.contentStartMs,
                  )}，已按 {formatCampaignSpanLabel(CAMPAIGN_MIN_CONTEXT_MS)}最小上下文取景；
                  倍数拉大后 K 线会挤成发丝，换更大的周期即可
                </div>
              )}
              <div className="flex-1" />
            </div>
            <div ref={campaignChartExportRef} className="h-[480px] border border-border rounded overflow-hidden">
              {klinesLoading ? (
                <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">加载 K 线…</div>
              ) : klinesError ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-[12px] text-[#F6465D]">
                  <div>K 线加载失败：{klinesError}</div>
                  <div className="text-[11px] text-muted-foreground">可能是网络或交易所接口限制，并非战役数据本身的问题。</div>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={reloadKlines}>重试</Button>
                </div>
              ) : klines.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">该时间段暂无 K 线数据</div>
              ) : (
                <ReplayKlineChart
                  key={`${campaign.id}:${effectiveInterval}:${campaignKlineFromTime}:${campaignKlineToTime}`}
                  klines={klines}
                  currentTime={chartCurrentTime}
                  intervalMs={intervalToMs(effectiveInterval)}
                  symbol={campaign.symbol}
                  markers={displayMarkers}
                  timeBoundPriceLines={displayPriceLines}
                  verticalLines={displayVerticalLines}
                  onSelectTimeBoundPriceLine={selectReverseOrderLine}
                  fitAll
                  initialVisibleStartTime={campaignKlineVisibleRange.fromTime}
                  initialVisibleEndTime={campaignKlineVisibleRange.toTime}
                  showLastPriceLine={false}
                  viewportCenterTime={chartViewportCenterTime}
                  timezone={LOCAL_TIME_ZONE}
                />
              )}
            </div>
            {(hasYellowOrderLayer || hasForeignLiveOrders) && (
              <div className="mt-2 px-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setShowOrderInfo(v => !v)}
                    title={orderLayerToggleTitle}
                    aria-label={orderLayerToggleLabel}
                    className={`inline-flex items-center transition-colors ${
                      hasYellowOrderLayer ? 'text-[#F0B90B]/60 hover:text-[#F0B90B]' : 'text-[#848E9C]/60 hover:text-[#848E9C]'
                    }`}
                  >
                    {showOrderInfo ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  {hasYellowOrderLayer && (
                    <span>
                      {[hasReverseOrders && '委托空单挂单', hasManualHedgeShorts && '手动对冲空单'].filter(Boolean).join(' · ')}
                      （<span className="text-[#F0B90B]">黄色水平线</span>，
                      {[hasReverseOrders && '委托按委托价', hasManualHedgeShorts && '手动按开仓价'].filter(Boolean).join('、')}
                      {showOrderInfo ? '' : '·已隐藏'}）
                    </span>
                  )}
                  {hasForeignLiveOrders && (
                    <span data-testid="foreign-replay-order-legend" className="text-muted-foreground/55">
                      {hasYellowOrderLayer ? '· ' : ''}他场委托（<span className="text-[#848E9C]">灰色淡虚线</span>，另一次回放留下、未计入本场
                      {showOrderInfo ? '' : '·已隐藏'}）
                    </span>
                  )}
                  {(hasReverseOrders || hasForeignLiveOrders) && (
                    <button
                      type="button"
                      onClick={() => setShowReverseOrderManager(v => !v)}
                      className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/55 hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {showReverseOrderManager ? '收起' : '管理'}
                    </button>
                  )}
                  {hiddenReverseOrderCount > 0 && (
                    <button
                      type="button"
                      onClick={restoreHiddenReverseHedgeOrders}
                      className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/55 hover:bg-muted hover:text-foreground transition-colors"
                    >
                      恢复 {hiddenReverseOrderCount}
                    </button>
                  )}
                </div>
                {showReverseOrderManager && showOrderInfo && visibleReverseHedgeOrders.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-5">
                    {visibleReverseHedgeOrders.map(order => renderReverseOrderChip(order))}
                  </div>
                )}
                {/* 他场委托单独一组、整体压灰，排在本场的色块之后：一眼看出不是这场挂的。标题只数各自状态，与色块的 已撤 / 已触发 对得上 */}
                {showReverseOrderManager && showOrderInfo && visibleForeignLiveOrders.length > 0 && (
                  <div data-testid="foreign-replay-order-group" className="flex flex-wrap items-center gap-1.5 pl-5">
                    <span className="text-[10px] text-muted-foreground/50">
                      {formatForeignReplayOrdersHeading(visibleForeignLiveOrders)}
                    </span>
                    {visibleForeignLiveOrders.map(order => renderReverseOrderChip(order, true))}
                  </div>
                )}
              </div>
            )}
            {selectedCounterfactual && (
              <div className="mt-2 px-1 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={toggleSelectedCounterfactual}
                    title={showSelectedCounterfactual ? `隐藏${selectedCounterfactual.label}` : `显示${selectedCounterfactual.label}`}
                    aria-label={showSelectedCounterfactual ? `隐藏${selectedCounterfactual.label}` : `显示${selectedCounterfactual.label}`}
                    aria-pressed={showSelectedCounterfactual}
                    className="inline-flex items-center gap-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    {showSelectedCounterfactual ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    {showSelectedCounterfactual ? (
                      <span>实际轨迹（标准色）vs <span className="text-[#B080FF]">{selectedCounterfactual.label}</span>（紫色）</span>
                    ) : (
                      <span>实际轨迹（标准色）· <span className="text-[#B080FF]/70">{selectedCounterfactual.label}</span> 已隐藏</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCfLegend(v => !v)}
                    title="标记说明"
                    aria-label="标记说明"
                    className="inline-flex items-center text-muted-foreground/40 hover:text-foreground transition-colors"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </div>
                {showCfLegend && (
                  <div className="rounded border border-border/60 bg-muted/30 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                    <div className="text-foreground/80 mb-1">
                      CF = 反事实「补齐」分支（紫色虚拟轨迹，按标准 SOP 推演，不是真实成交）
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>CF-M 主力开仓</span>
                      <span>CF-A1~A6 加仓</span>
                      <span>CF-Re 再入场主力</span>
                      <span>CF-Ha / CF-Hb 初始对冲 a / b</span>
                      <span>CF-Hr 滚动对冲</span>
                      <span>CF-TP 镜像止盈</span>
                      <span>CF-Exit 平仓</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Layers className="w-4 h-4 text-muted-foreground" />
              Legs 列表
            </div>
            <div className="flex items-center gap-1.5">
              {campaignEmotionDiary && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleExportCampaignEmotionDiaryTxt}
                  className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  title={`导出 ${campaignOperationDate ?? '操作日'} 的情绪日记为 TXT`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  情绪 TXT
                </Button>
              )}
              {openingSnapshotLegs.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleExportCampaignSnapshotsTxt}
                  className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  title={`导出本战役 ${openingSnapshotLegs.length} 条开仓快照为 TXT`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  快照 TXT
                </Button>
              )}
              {reviewedLegs.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleExportCampaignReviewsTxt}
                  className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  title={`导出本战役 ${reviewedLegs.length} 条平仓评价为 TXT`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  评价 TXT
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={legsExporting || legs.length === 0}
                onClick={handleExportCampaignBoardPng}
                className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                title="保存战役原数据、盈亏概览、当前 K 线盘面与完整 Legs 列表为高清 PNG"
              >
                <Download className="h-3.5 w-3.5" />
                {legsExporting ? '生成中' : 'PNG'}
              </Button>
            </div>
          </div>
          <CampaignLegsList
            initialExpectedMaxLoss={legsInitialExpectedMaxLoss}
            /* 「占比」列按战役主方向取一侧：主多看多单、主空看空单（导出 PNG 从同一个战役对象取，两处一致） */
            campaignDirection={campaign.direction}
            legs={legs}
            tradeRecords={tradeRecords}
            campaignEvents={campaign.actual_evolution}
            legExitPriceCorrections={legExitPriceCorrections}
            reverseHedgeOrders={visibleReverseHedgeOrders}
            foreignLiveOrders={visibleForeignLiveOrders}
            highlightedLegIds={selectedLegMarkerIds}
            onToggleHighlight={(leg) => {
              setFocusTime(null);
              setSelectedLegMarkerIds(prev => (
                prev.includes(leg.id)
                  ? prev.filter(item => item !== leg.id)
                  : [...prev, leg.id]
              ));
            }}
            onHideReverseHedgeOrder={(order) => hideReverseHedgeOrder(order.id)}
            onDetach={setDetachTarget}
          />
        </section>

        <section className="bg-card border border-border rounded p-6 mb-6 space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Sparkles className="w-4 h-4 text-[#B080FF]" />
              反事实战役
            </div>
            <div className="text-[14px] text-foreground">
              如果当时换一种打法，会发生什么？在下方「Legs 副本」里手动调整各条腿，点「一键运行」用真实行情跑一遍，结果按「盈亏概览」同一套 12 项指标摆出来；满意就起个名字保存，之后随时删除或载回 Legs 副本；再把你的调整与原始战役逐腿对比，把原始错误的代价折算成 USDT。
            </div>
          </div>

          <CampaignWhatIfEditor
            campaign={campaign}
            legs={legs}
            tradeRecords={tradeRecords}
            legExitPriceCorrections={legExitPriceCorrections}
            localOrders={localOrderFacts}
            klines={klines}
            klinesLoading={klinesLoading}
            interval={effectiveInterval}
            intervalOptions={INTERVALS}
            onIntervalChange={(nextInterval) => {
              setIntervalTouched(true);
              setInterval(nextInterval as Interval);
            }}
            klineTimeWindow={campaignKlineBaseWindow}
            timezone={LOCAL_TIME_ZONE}
            whatIfRunning={whatIfRunning}
            onRunWhatIf={handleRunWhatIf}
            loadLegsRequest={loadLegsRequest}
            baseMarkers={chart.markers}
            baseTimeBoundPriceLines={chart.timeBoundPriceLines}
            baseVerticalLines={chart.verticalLines}
            orderInfoPriceLines={showOrderInfo ? orderInfoPriceLines : []}
          />

          {counterfactualDraft && counterfactualDraftOverview && (
            <>
              <CounterfactualOverviewRow
                testIdPrefix="counterfactual-draft"
                title="反事实盈亏概览 · 未保存"
                items={counterfactualDraftOverview.items}
                note={counterfactualDraftOverview.note}
                delta={counterfactualDelta(counterfactualDraft.result.final_realized_pnl, actualPnl)}
                changeSummary={counterfactualDraft.params.change_summary}
                runContext={counterfactualDraft.params.run_context}
                actions={(
                  <>
                    <ImeSafeInput
                      data-testid="counterfactual-draft-name"
                      aria-label="反事实分支名"
                      value={counterfactualDraftName}
                      onValueChange={setCounterfactualDraftName}
                      maxLength={COUNTERFACTUAL_NAME_MAX_LENGTH}
                      placeholder="分支名（≤ 20 字）"
                      className="h-8 w-56 max-w-full text-[12px]"
                    />
                    <div className="flex items-center gap-2">
                      <Button type="button" data-testid="counterfactual-save" className="h-8 bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 text-[12px]" disabled={counterfactualDraftSaving} onClick={handleSaveCounterfactualDraft}>
                        {counterfactualDraftSaving ? '保存中…' : '保存'}
                      </Button>
                      <Button type="button" data-testid="counterfactual-discard" variant="outline" className="h-8 text-[12px]" disabled={counterfactualDraftSaving} onClick={handleDiscardCounterfactualDraft}>
                        丢弃
                      </Button>
                    </div>
                  </>
                )}
              />
              {(counterfactualDraft.params.manual_legs ?? []).length > 0 && (
                <CounterfactualLegsTable campaign={campaign} legs={counterfactualDraft.params.manual_legs ?? []} result={counterfactualDraft.result} />
              )}
            </>
          )}

          <div className="space-y-2">
            <div className="text-[13px] font-medium">已保存分支</div>
            {visibleBranches.length === 0 ? (
              <div className="rounded border border-border bg-background/40 px-4 py-4 text-[12px] text-muted-foreground">
                还没有反事实分支。先运行一键方案或新建 What-if 分支。
              </div>
            ) : (
              visibleBranches.map(branch => {
                    const delta = counterfactualDelta(branch.result.final_realized_pnl, actualPnl);
                    const active = branch.id === selectedCounterfactualId;
                    // 手动 Legs 分支的 sop_score 恒为 0，没有信息量，只给 SOP 推演分支看。
                    const manualRun = isManualLegScenario(branch.params);
                    const changeShort = branch.params?.change_summary?.short;
                    return (
                      <div
                        key={branch.id}
                        data-testid={`counterfactual-branch-row-${branch.id}`}
                        className={`bg-card border rounded p-3 flex items-center gap-3 cursor-pointer ${active ? 'border-[#B080FF]/60 ring-1 ring-[#B080FF]/30' : 'border-border'}`}
                        onClick={() => setSelectedCounterfactualId(active ? null : branch.id)}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${branchKindDot(branch.branch_kind)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium truncate">{branch.label}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {branchKindLabel(branch.branch_kind)}
                            {changeShort ? ` · ${changeShort}` : ''}
                            {` · ${formatCounterfactualStamp(branch.created_at)}`}
                          </div>
                        </div>
                        <div className={`px-2 py-1 rounded text-[11px] font-mono ${pnlColor(branch.result.final_realized_pnl)}`}>
                          {branch.result.final_realized_pnl >= 0 ? '+' : ''}{branch.result.final_realized_pnl.toFixed(2)}
                        </div>
                        <div className={`px-2 py-1 rounded text-[11px] font-mono ${pnlColor(delta)}`}>
                          {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                        </div>
                        {!manualRun && (
                          <div className="px-2 py-1 rounded text-[11px] font-mono bg-muted text-foreground">
                            SOP {branch.result.sop_score}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteBranch(branch.id);
                          }}
                          className="h-8 w-8 rounded flex items-center justify-center text-muted-foreground hover:text-[#F6465D] hover:bg-[#F6465D]/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
              })
            )}
          </div>

          {selectedCounterfactual && selectedCounterfactualOverview && (
            <>
            <CounterfactualOverviewRow
              testIdPrefix="counterfactual-saved"
              title={`反事实盈亏概览 · ${selectedCounterfactual.label}`}
              items={selectedCounterfactualOverview.items}
              note={selectedCounterfactualOverview.note}
              delta={selectedCounterfactualDelta}
              changeSummary={selectedCounterfactual.params?.change_summary}
              runContext={selectedCounterfactual.params?.run_context}
              kindLine={[
                branchKindLabel(selectedCounterfactual.branch_kind),
                isManualLegScenario(selectedCounterfactual.params) ? null : `SOP ${selectedCounterfactual.result.sop_score}`,
                `保存于 ${formatCounterfactualStamp(selectedCounterfactual.created_at)}`,
              ].filter(Boolean).join(' · ')}
              actions={(
                <>
                  {hasManualRunBranch && (
                    <Button
                      type="button"
                      data-testid="counterfactual-load-legs"
                      variant="outline"
                      className="h-8 text-[12px]"
                      onClick={() => handleLoadCounterfactualLegs(selectedCounterfactual)}
                    >
                      载入到 Legs 副本
                    </Button>
                  )}
                  <Button
                    type="button"
                    data-testid="counterfactual-delete"
                    variant="outline"
                    className="h-8 text-[12px] border-[#F6465D]/40 text-[#F6465D] hover:bg-[#F6465D]/10"
                    onClick={() => handleDeleteBranch(selectedCounterfactual.id)}
                  >
                    删除
                  </Button>
                </>
              )}
            />
              {(selectedCounterfactual.params.manual_legs ?? []).length > 0 && (
                <CounterfactualLegsTable
                  campaign={campaign}
                  legs={selectedCounterfactual.params.manual_legs ?? []}
                  result={selectedCounterfactual.result}
                  title={`反事实 Legs · ${selectedCounterfactual.label}`}
                />
              )}
            </>
          )}

          {hasManualRunBranch && (
                <div className="bg-card border border-border rounded p-4 mt-4 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[13px] font-medium">
                        偏离代价明细（手动调整 vs 原始）
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-2">
                        把你手动调整后的 Legs 与原始战役逐腿对比，每条代价 = 调整后盈亏 − 原始盈亏。
                        合计 {totalDeviationCost >= 0 ? '+' : ''}{totalDeviationCost.toFixed(2)} USDT = 原始错误的总代价。
                        保存后会把已填写的「修正后」汇总进复盘中心的规则。
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isOwner && (
                        <Button
                          variant="outline"
                          className="h-8 text-[11px]"
                          disabled={deviationNotesSaving}
                          onClick={handleSaveDeviationNotes}
                        >
                          {deviationNotesSaving ? '保存中…' : '保存备注'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-background text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2">违规阶段</th>
                          <th className="text-left px-3 py-2">违规描述</th>
                          <th className="text-left px-3 py-2">修正后</th>
                          <th className="text-right px-3 py-2">代价 (USDT)</th>
                          <th className="text-right px-3 py-2">占本场盈亏 %</th>
                          <th className="text-right px-3 py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deviationLegCosts.map(cost => {
                          const rowKey = cost.legId;
                          const note = deviationNotes[rowKey] ?? {};
                          const categoryVal = note.category ?? cost.leg_role ?? '';
                          const reasonVal = note.reason ?? '';
                          const fixVal = note.fix ?? '';
                          // 占本场盈亏 %：以本战役实际总盈亏的绝对值为分母；分母为 0 时无法折算。
                          const pctOfPnl = Math.abs(actualPnl) > 0 ? (cost.cost_usdt / Math.abs(actualPnl)) * 100 : null;
                          const setField = (field: keyof CampaignDeviationNote, value: string) =>
                            setDeviationNotes(prev => ({ ...prev, [rowKey]: { ...prev[rowKey], [field]: value } }));
                          return (
                          <tr key={rowKey} className="border-t border-border">
                            <td className="px-3 py-2 align-top">
                              {isOwner ? (
                                <ImeSafeInput
                                  value={categoryVal}
                                  onValueChange={value => setField('category', value)}
                                  placeholder="违规阶段（选填）"
                                  className="h-8 text-[11px] capitalize"
                                />
                              ) : (
                                <span className="capitalize">{categoryVal || '—'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-foreground">
                              {isOwner ? (
                                <ImeSafeInput
                                  value={reasonVal}
                                  onValueChange={value => setField('reason', value)}
                                  placeholder="违规描述（选填）"
                                  className="h-8 text-[11px]"
                                />
                              ) : (
                                <span>{reasonVal || '—'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-muted-foreground">
                              {isOwner ? (
                                <ImeSafeInput
                                  value={fixVal}
                                  onValueChange={value => setField('fix', value)}
                                  placeholder="修正后（选填）"
                                  className="h-8 text-[11px]"
                                />
                              ) : (
                                <span>{fixVal || '—'}</span>
                              )}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono align-top ${pnlColor(cost.cost_usdt)}`}>
                              {cost.cost_usdt >= 0 ? '+' : ''}{cost.cost_usdt.toFixed(2)}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono align-top ${pctOfPnl == null ? 'text-muted-foreground' : pnlColor(pctOfPnl)}`}>
                              {pctOfPnl == null ? '—' : `${pctOfPnl >= 0 ? '+' : ''}${pctOfPnl.toFixed(2)}%`}
                            </td>
                            <td className="px-3 py-2 text-right align-top">
                              <Button
                                variant="outline"
                                className="h-8 text-[11px]"
                                onClick={() => setSelectedLegMarkerIds([cost.legId])}
                              >
                                标到盘面
                              </Button>
                            </td>
                          </tr>
                          );
                        })}
                        {deviationLegCosts.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-5 text-center text-[12px] text-muted-foreground">
                              本次手动调整与原始战役无差异（合计 0）
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded border border-[#F6465D]/35 bg-[#F6465D]/8 px-4 py-3 text-[13px] text-foreground">
                    这张表是这套系统对你最锋利的一刀。每一条都是真金白银。
                    如果总代价 &lt; 10 USDT，本场偏离基本无害；如果 &gt; 100 USDT 或 &gt; 1% 账户，立即把对应违规升级为 checklist 强制规则。
                  </div>
                </div>
          )}
        </section>

        <EndCampaignDialog
          open={endOpen}
          onOpenChange={setEndOpen}
          campaign={campaign}
          legs={legs}
          tradeRecords={tradeRecords}
          settlement={settlement}
          accuracy={accuracy}
          currentSimulatedTime={getEffectiveTime(campaign.symbol)}
          onClosed={async () => {
            await refreshCampaign();
            toast.success('战役已结束');
          }}
        />
        <Dialog open={!!detachTarget} onOpenChange={(open) => { if (!open) setDetachTarget(null); }}>
          <DialogContent className="max-w-[520px]">
            <DialogHeader>
              <DialogTitle>解除该 leg 归属</DialogTitle>
              <DialogDescription className="text-[12px] leading-relaxed">
                解除后该 journal 将变为未归属状态，可重新归类。
                战役的 actual_evolution 中将保留一条“leg 解除”的记录。
                其他 legs 与战役 SOP 评分不受影响（但分数会因 leg 缺失而重新计算）。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDetachTarget(null)}>取消</Button>
              <Button
                variant="outline"
                className="border-[#F6465D]/40 text-[#F6465D] hover:bg-[#F6465D]/10"
                disabled={!detachTarget || detaching}
                onClick={async () => {
                  if (!detachTarget) return;
                  try {
                    setDetaching(true);
                    await detachCampaignLegFromCampaign(campaign.id, detachTarget);
                    await refreshCampaign();
                    setDetachTarget(null);
                    toast.success('该 leg 已解除归属');
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  } finally {
                    setDetaching(false);
                  }
                }}
              >
                确认解除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
