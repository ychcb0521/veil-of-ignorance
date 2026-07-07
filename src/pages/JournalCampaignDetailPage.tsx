import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Eye, EyeOff, Info, Layers, MessageSquare, Send, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type ChartMarker, type TimeBoundPriceLine, type VerticalLine } from '@/components/journal/ReplayCandleChart';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { CampaignWhatIfEditor } from '@/components/journal/CampaignWhatIfEditor';
import { EndCampaignDialog } from '@/components/journal/EndCampaignDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { intervalToMs } from '@/hooks/useBinanceData';
import { useCampaignKlines, CAMPAIGN_EDGE_PAD_MS } from '@/hooks/useCampaignKlines';
import {
  buildCampaignEventStream,
  computeDecisionAccuracy,
  shouldSuggestCampaignEnd,
} from '@/lib/campaignAnalysis';
import { buildCampaignChartContentTimeSpan, pickCampaignOverviewInterval, type CampaignChartInterval } from '@/lib/campaignChartContentSpan';
import { buildSelectedLegVerticalLines, legRoleMarkerLabel } from '@/lib/campaignLegMarkers';
import { exportCampaignBoardPng } from '@/lib/campaignLegsPngExport';
import {
  deleteCounterfactual,
  detachCampaignLegFromCampaign,
  createCampaignComment,
  followAccount,
  getCampaignFullData,
  hasMutualFollow,
  saveCampaignDeviationNotes,
  syncCampaignDeviationRulesToChecklist,
  type CampaignDeviationNote,
  listCampaignComments,
  listCounterfactuals,
  runAndPersistCustomCounterfactual,
} from '@/lib/journalApi';
import { STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import {
  buildActualSimulationParams,
  buildManualLegs,
  computeManualLegDeviationCosts,
  type ManualLegDeviationCost,
} from '@/lib/campaignSimulationEngine';
import { buildCampaignReverseOrderPriceLines, isDisplayableReverseHedgeOrder } from '@/lib/campaignReverseOrderLines';
import type {
  CampaignCounterfactual,
  CampaignCounterfactualParams,
  CampaignComment,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { CampaignReverseHedgeOrder, PendingOrder, TradeRecord } from '@/types/trading';

const INTERVALS = ['1m', '5m', '15m', '1h'] as const;
type Interval = CampaignChartInterval;

function pnlColor(value: number | null) {
  if (value == null) return 'text-muted-foreground';
  if (value > 0) return 'text-[#0ECB81]';
  if (value < 0) return 'text-[#F6465D]';
  return 'text-muted-foreground';
}

// 战役详情页统一用浏览器本地时区显示 K 线/模拟时间——与下方 Legs 列表（本地 getHours）
// 和主图时间轴对齐。早先用 UTC 是因为误以为 Legs 列表是 UTC，实际它一直是本地时区。
const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

function shortAccountId(value: string) {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
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
) {
  const events = buildCampaignEventStream(campaign, legs, tradeRecords);
  const eventMap = new Map(events.map(event => [event.journal_id ?? event.id, event]));
  const markers: ChartMarker[] = [];
  const timeBoundPriceLines: TimeBoundPriceLine[] = [];
  const verticalLines: VerticalLine[] = [];

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
    const record = leg.trade_record_id ? tradeRecords.find(item => item.id === leg.trade_record_id) ?? null : null;
    const placedMs = safeTimeMs(leg.pre_simulated_time) ?? new Date(campaign.opened_at).getTime();
    const openTime = record?.openTime ?? placedMs;
    const closeTime = record?.closeTime ?? safeTimeMs(leg.post_real_close_time);
    const price = leg.pre_entry_price ?? record?.entryPrice ?? 0;
    const exitPrice = record?.exitPrice ?? leg.post_exit_price_snapshot ?? price;
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
        markers.push({
          time: closeTime,
          price: exitPrice,
          shape: 'circle',
          color: '#0ECB81',
          label: 'M 减仓 50%',
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

export default function JournalCampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { getEffectiveTime } = useTradingContext();
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<TradeCampaign | null>(null);
  const [legs, setLegs] = useState<TradeJournal[]>([]);
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [reverseHedgeOrders, setReverseHedgeOrders] = useState<CampaignReverseHedgeOrder[]>([]);
  const [interval, setInterval] = useState<Interval>('1m');
  const [intervalTouched, setIntervalTouched] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [counterfactuals, setCounterfactuals] = useState<CampaignCounterfactual[]>([]);
  const [selectedCounterfactualId, setSelectedCounterfactualId] = useState<string | null>(null);
  const [pendingCounterfactualId, setPendingCounterfactualId] = useState<string | null>(null);
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
  const [comments, setComments] = useState<CampaignComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentScore, setCommentScore] = useState(3);
  const [commentSaving, setCommentSaving] = useState(false);
  const [followeeId, setFolloweeId] = useState('');
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [full, savedCounterfactuals] = await Promise.all([
          getCampaignFullData(id),
          listCounterfactuals(id),
        ]);
        if (cancelled) return;
        const ownCampaign = full.campaign.user_id === user.id;
        const mutual = ownCampaign ? true : await hasMutualFollow(user.id, full.campaign.user_id);
        if (!mutual) {
          nav(`/journal/campaigns${location.search}`);
          return;
        }
        setIsOwner(ownCampaign);
        setCampaign(full.campaign);
        setLegs(full.legs);
        setTradeRecords(full.tradeRecords);
        setPendingOrders(full.pendingOrders);
        setReverseHedgeOrders(full.reverseHedgeOrders);
        setCounterfactuals(savedCounterfactuals);
        setSelectedCounterfactualId(prev => prev ?? savedCounterfactuals[0]?.id ?? null);
        setCommentsLoading(true);
        try {
          const nextComments = await listCampaignComments(full.campaign.id);
          if (!cancelled) setComments(nextComments);
        } finally {
          if (!cancelled) setCommentsLoading(false);
        }
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
  }, [id, user, nav, location.search]);

  const effectiveClosedAt = useMemo(() => {
    if (!campaign) return null;
    return campaign.closed_at ?? new Date(getEffectiveTime(campaign.symbol)).toISOString();
  }, [campaign, getEffectiveTime]);

  // Legs 列表里所有腿的最早开单时间与最晚平单时间，用来撑开 K 线前后区间（需求②）。
  const legTimeSpan = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const leg of legs) {
      const record = leg.trade_record_id
        ? tradeRecords.find(item => item.id === leg.trade_record_id) ?? null
        : null;
      const openMs = record?.openTime ?? new Date(leg.pre_simulated_time).getTime();
      if (Number.isFinite(openMs)) { min = Math.min(min, openMs); max = Math.max(max, openMs); }
      const closeMs = record?.closeTime ?? safeTimeMs(leg.post_real_close_time);
      if (closeMs != null) {
        min = Math.min(min, closeMs);
        max = Math.max(max, closeMs);
      }
    }
    return {
      startMs: Number.isFinite(min) ? min : null,
      endMs: Number.isFinite(max) ? max : null,
    };
  }, [legs, tradeRecords]);

  const selectedCounterfactual = useMemo(
    () => counterfactuals.find(branch => branch.id === selectedCounterfactualId) ?? null,
    [counterfactuals, selectedCounterfactualId],
  );
  const chartContentTimeSpan = useMemo(
    () => buildCampaignChartContentTimeSpan(campaign, legs, tradeRecords, reverseHedgeOrders, selectedCounterfactual),
    [campaign, legs, tradeRecords, reverseHedgeOrders, selectedCounterfactual],
  );
  const overviewInterval = useMemo(
    () => pickCampaignOverviewInterval(chartContentTimeSpan),
    [chartContentTimeSpan],
  );

  useEffect(() => {
    if (!intervalTouched && interval !== overviewInterval) {
      setInterval(overviewInterval);
    }
  }, [interval, intervalTouched, overviewInterval]);

  const { klines, loading: klinesLoading, error: klinesError, reload: reloadKlines } = useCampaignKlines(
    campaign?.symbol ?? '',
    campaign?.opened_at ?? new Date().toISOString(),
    effectiveClosedAt,
    interval,
    chartContentTimeSpan.startMs ?? legTimeSpan.startMs,
    chartContentTimeSpan.endMs ?? legTimeSpan.endMs,
  );

  const accuracy = useMemo(
    () => (campaign ? computeDecisionAccuracy(campaign, legs, tradeRecords, klines) : null),
    [campaign, legs, tradeRecords, klines],
  );
  const chart = useMemo(
    () => (campaign ? buildChartArtifacts(campaign, legs, tradeRecords) : { markers: [], timeBoundPriceLines: [], verticalLines: [], events: [] }),
    [campaign, legs, tradeRecords],
  );
  const pendingCounterfactual = useMemo(
    () => counterfactuals.find(branch => branch.id === pendingCounterfactualId) ?? null,
    [counterfactuals, pendingCounterfactualId],
  );
  const counterfactualChart = useMemo(
    () => buildCounterfactualChartArtifacts(selectedCounterfactual),
    [selectedCounterfactual],
  );
  const selectedLegVerticalLines = useMemo(
    () => buildSelectedLegVerticalLines(legs, tradeRecords, selectedLegMarkerIds),
    [legs, tradeRecords, selectedLegMarkerIds],
  );
  // 「补齐（紫色）」反事实对照层：可显示/隐藏（默认显示）；showCfLegend 控制标记说明展开。
  const [showCfOverlay, setShowCfOverlay] = useState(true);
  const [showCfLegend, setShowCfLegend] = useState(false);
  // 「委托空单（黄色）」挂单层：只画开仓性质的 SHORT 委托；止盈/止损平仓委托不进入这里。
  const [showOrderInfo, setShowOrderInfo] = useState(true);
  const [showReverseOrderManager, setShowReverseOrderManager] = useState(false);
  const [hiddenReverseHedgeOrderIds, setHiddenReverseHedgeOrderIds] = useState<string[]>([]);
  const hiddenReverseOrderStorageKey = useMemo(
    () => (campaign ? `campaign:${campaign.id}:hidden-reverse-hedge-orders` : null),
    [campaign?.id],
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
  const hiddenReverseOrderCount = useMemo(
    () => displayableReverseHedgeOrders.filter(order => hiddenReverseOrderSet.has(order.id)).length,
    [displayableReverseHedgeOrders, hiddenReverseOrderSet],
  );
  const orderInfoPriceLines = useMemo<TimeBoundPriceLine[]>(() => {
    if (!campaign) return [];
    const fallbackEnd = campaign.closed_at
      ? new Date(campaign.closed_at).getTime()
      : (klines.length > 0 ? klines[klines.length - 1].time : 0);
    return buildCampaignReverseOrderPriceLines(visibleReverseHedgeOrders, tradeRecords, fallbackEnd);
  }, [campaign, visibleReverseHedgeOrders, tradeRecords, klines]);
  const displayMarkers = useMemo(
    () => [...chart.markers, ...(showCfOverlay ? counterfactualChart.markers : [])],
    [chart.markers, counterfactualChart.markers, showCfOverlay],
  );
  const displayPriceLines = useMemo(
    () => [
      ...chart.timeBoundPriceLines,
      ...(showCfOverlay ? counterfactualChart.timeBoundPriceLines : []),
      ...(showOrderInfo ? orderInfoPriceLines : []),
    ],
    [chart.timeBoundPriceLines, counterfactualChart.timeBoundPriceLines, showCfOverlay, orderInfoPriceLines, showOrderInfo],
  );
  const displayVerticalLines = useMemo(
    () => [...chart.verticalLines, ...(showCfOverlay ? counterfactualChart.verticalLines : []), ...selectedLegVerticalLines],
    [chart.verticalLines, counterfactualChart.verticalLines, selectedLegVerticalLines, showCfOverlay],
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
    const originalLegs = buildManualLegs(actualParams, legs, klines, tradeRecords);
    return computeManualLegDeviationCosts(originalLegs, adjustedLegs);
  }, [campaign, selectedCounterfactual, legs, tradeRecords, klines]);
  // 门槛：选中分支是「手动运行」分支（带 manual_legs）才展示偏离明细。
  const hasManualRunBranch = (selectedCounterfactual?.params?.manual_legs ?? []).length > 0;
  // 已保存分支列表里隐藏自动生成的「修正分支」(补齐 X)，只保留 Pure SOP 与自定义 What-if。
  const visibleBranches = useMemo(
    () => counterfactuals.filter(branch => branch.branch_kind !== 'fix_one_deviation'),
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

  // 主图当前时间游标：聚焦到某事件时用 focusTime，否则停在「全部盘面内容的最后时间 + 缓冲」。
  // 关键：ReplayKlineChart 会用 `line.time <= currentTime` 过滤竖线/标记，并以 currentTime 作为可见区右沿。
  // 这里用 chartContentTimeSpan（legs + 委托空单 + 反事实层 + 战役边界），确保默认盘面把上方标注全部囊括进去。
  // 必须放在上面的 loading guard 之后——此时 campaign 一定非空；放在 guard 之前会在
  // 首帧（campaign 仍为 null）就解引用 campaign.opened_at 直接崩溃、整页白屏。
  const chartDefaultCurrentTime = chartContentTimeSpan.endMs != null
    ? chartContentTimeSpan.endMs + CAMPAIGN_EDGE_PAD_MS
    : new Date(effectiveClosedAt ?? campaign.opened_at).getTime();
  const chartDefaultViewportCenterTime = chartContentTimeSpan.startMs != null && chartContentTimeSpan.endMs != null
    ? Math.round((chartContentTimeSpan.startMs + chartContentTimeSpan.endMs) / 2)
    : chartDefaultCurrentTime;
  const chartCurrentTime = focusTime ?? chartDefaultCurrentTime;
  const chartViewportCenterTime = focusTime ?? chartDefaultViewportCenterTime;

  const mainCount = legs.filter((leg: TradeJournal) => leg.leg_role === 'main_open' || leg.leg_role === 'reentry_main' || leg.leg_role?.startsWith('main_add_')).length;
  const hedgeCount = legs.filter((leg: TradeJournal) => leg.leg_role?.startsWith('hedge_')).length;
  const tpCount = legs.filter((leg: TradeJournal) => leg.leg_role === 'mirror_tp').length;
  const otherCount = Math.max(0, legs.length - mainCount - hedgeCount - tpCount);
  const actualPnl = campaign.final_realized_pnl ?? 0;
  const totalDeviationCost = deviationLegCosts.reduce((sum, item) => sum + item.cost_usdt, 0);
  const selectedCounterfactualDelta = selectedCounterfactual
    ? selectedCounterfactual.result.final_realized_pnl - actualPnl
    : null;
  const canLeaveExternalComment = !isOwner;

  const refreshCampaign = async () => {
    const full = await getCampaignFullData(campaign.id);
    setCampaign(full.campaign);
    setLegs(full.legs);
    setTradeRecords(full.tradeRecords);
    setPendingOrders(full.pendingOrders);
    setReverseHedgeOrders(full.reverseHedgeOrders);
  };

  const reloadCounterfactuals = async (keepSelectionId?: string | null) => {
    const next = await listCounterfactuals(campaign.id);
    setCounterfactuals(next);
    setSelectedCounterfactualId(keepSelectionId ?? next[0]?.id ?? null);
  };

  const handleFollowAccount = async () => {
    const target = followeeId.trim();
    if (!target || target === user?.id) {
      toast.error('请输入对方的用户 ID');
      return;
    }
    try {
      setFollowing(true);
      await followAccount(target);
      setFolloweeId('');
      toast.success('已关注。双方互关后，可查看并评价彼此的交易战役');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setFollowing(false);
    }
  };

  const handleCreateComment = async () => {
    if (!commentText.trim()) return;
    try {
      setCommentSaving(true);
      const next = await createCampaignComment({
        campaignId: campaign.id,
        body: commentText.trim(),
        believabilityScore: commentScore,
      });
      setComments(prev => [next, ...prev]);
      setCommentText('');
      toast.success('可信度评价已写入');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCommentSaving(false);
    }
  };

  const handleRunWhatIf = async (label: string, params: CampaignCounterfactualParams) => {
    if (klinesLoading || klines.length === 0) {
      toast.error('K 线尚未加载完成，暂时无法运行 What-if');
      return;
    }
    try {
      setWhatIfRunning(true);
      const branch = await runAndPersistCustomCounterfactual(campaign.id, label, params, klines);
      await reloadCounterfactuals(branch.id);
      setSelectedCounterfactualId(branch.id);
      setPendingCounterfactualId(branch.id);
      toast.success('What-if 结果已生成，请选择保存或删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setWhatIfRunning(false);
    }
  };

  const handleDeleteBranch = async (branchId: string) => {
    try {
      await deleteCounterfactual(branchId);
      const next = counterfactuals.filter(branch => branch.id !== branchId);
      setCounterfactuals(next);
      if (pendingCounterfactualId === branchId) {
        setPendingCounterfactualId(null);
      }
      if (selectedCounterfactualId === branchId) {
        setSelectedCounterfactualId(next[0]?.id ?? null);
      }
      toast.success('分支已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDiscardGeneratedCounterfactual = async (branchId: string) => {
    try {
      await deleteCounterfactual(branchId);
      setPendingCounterfactualId(null);
      await reloadCounterfactuals(selectedCounterfactualId === branchId ? null : selectedCounterfactualId);
      toast.success('已删除并刷新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleKeepGeneratedCounterfactual = async (branchId: string) => {
    try {
      await reloadCounterfactuals(branchId);
      setSelectedCounterfactualId(branchId);
      setPendingCounterfactualId(null);
      toast.success('已保存并刷新');
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
        campaign,
        legs,
        tradeRecords,
        reverseHedgeOrders: visibleReverseHedgeOrders,
        chartElement: campaignChartExportRef.current,
      });
      toast.success('K 线盘面与 Legs 列表已保存为 PNG', { description: fileName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLegsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => nav(`/journal/campaigns${location.search}`)}
              className="h-8 w-8 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium truncate">{campaign.title}</h1>
              <div className="font-mono text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
                <span
                  className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px]"
                  title={`战役编号 ${campaign.campaign_code}`}
                >
                  {campaign.campaign_code}
                </span>
                <span>{campaign.symbol}</span>
                <span className={`px-2 py-0.5 rounded ${campaign.direction === 'main_long' ? 'bg-[#0ECB81]/10 text-[#0ECB81]' : 'bg-[#F6465D]/10 text-[#F6465D]'}`}>
                  {campaign.direction === 'main_long' ? '主多' : '主空'}
                </span>
                <span>{STRATEGY_TEMPLATES[campaign.strategy_template].name}</span>
                <span className={`px-2 py-0.5 rounded ${chipForStatus(campaign.status)}`}>{campaign.status}</span>
              </div>
            </div>
          </div>
          {campaign.status === 'active' && (
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
            <div className="text-muted-foreground">操作时间：{fmtMdHm(campaign.created_at)}</div>
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

          <div className="bg-card border border-border rounded p-4 space-y-2 text-[12px]">
            <div className="font-medium">盈亏概览</div>
            <div className={pnlColor(campaign.final_realized_pnl)}>已实现 P&L：{campaign.final_realized_pnl?.toFixed(2) ?? '—'} USDT</div>
            <div>峰值浮盈：{accuracy.campaign_max_profit_real.toFixed(2)}</div>
            <div>最大回撤：{accuracy.campaign_max_drawdown_real.toFixed(2)}</div>
            <div>盈利捕获率：{accuracy.profit_capture_ratio.toFixed(1)}%</div>
          </div>

        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4">
          <div className="bg-card border border-border rounded p-4 space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              可信度加权外部校验
            </div>
            {canLeaveExternalComment && (
              <div className="rounded border border-border bg-background/60 p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2">
                  <Textarea
                    value={commentText}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCommentText(event.target.value)}
                    placeholder="按当时信息评价这场战役的决策质量、证伪条件和风险控制。"
                    className="min-h-[92px] text-[12px]"
                  />
                  <div className="space-y-2">
                    <label className="text-[11px] text-muted-foreground">可信度权重</label>
                    <select
                      value={commentScore}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => setCommentScore(Number(event.target.value))}
                      className="h-9 w-full rounded border border-border bg-background px-2 text-[12px]"
                    >
                      {[1, 2, 3, 4, 5].map(score => (
                        <option key={score} value={score}>{score}</option>
                      ))}
                    </select>
                    <Button
                      disabled={!commentText.trim() || commentSaving}
                      onClick={handleCreateComment}
                      className="w-full h-9 bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 text-[12px]"
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      {commentSaving ? '写入中…' : '留言评价'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {commentsLoading ? (
                <div className="text-[12px] text-muted-foreground">加载留言中…</div>
              ) : comments.length === 0 ? (
                <div className="rounded border border-border bg-background/50 px-3 py-4 text-[12px] text-muted-foreground">
                  暂无互关账户评价。
                </div>
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className="rounded border border-border bg-background/60 px-3 py-2">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono">{shortAccountId(comment.user_id)}</span>
                      <span>可信度 {comment.believability_score}/5</span>
                      <span className="ml-auto font-mono">{fmtMdHm(comment.created_at)}</span>
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap">{comment.body}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="bg-card border border-border rounded p-4 space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <UserPlus className="w-4 h-4 text-muted-foreground" />
              互关账户
            </div>
            {isOwner ? (
              <>
                <div className="rounded border border-border bg-background/60 px-3 py-2 text-[12px]">
                  <div className="text-muted-foreground">你的用户 ID</div>
                  <div className="mt-1 font-mono break-all">{user?.id}</div>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={followeeId}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setFolloweeId(event.target.value)}
                    placeholder="输入对方用户 ID"
                    className="h-9 text-[12px]"
                  />
                  <Button
                    variant="outline"
                    className="h-9 shrink-0 text-[12px]"
                    disabled={following || !followeeId.trim()}
                    onClick={handleFollowAccount}
                  >
                    {following ? '关注中…' : '关注'}
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  双方都关注后，彼此可打开对方战役详情页并留下带权重的外部校验评价。
                </div>
              </>
            ) : (
              <div className="text-[12px] text-muted-foreground leading-relaxed">
                你正在查看互关账户的交易战役。你的留言会作为外部校验进入这场战役的可信度加权记录。
              </div>
            )}
          </div>
        </section>

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
                    className={`h-6 px-2 rounded text-[10px] font-mono ${interval === item ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
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
                  klines={klines}
                  currentTime={chartCurrentTime}
                  intervalMs={intervalToMs(interval)}
                  symbol={campaign.symbol}
                  markers={displayMarkers}
                  timeBoundPriceLines={displayPriceLines}
                  verticalLines={displayVerticalLines}
                  fitAll
                  showLastPriceLine={false}
                  viewportCenterTime={chartViewportCenterTime}
                  timezone={LOCAL_TIME_ZONE}
                />
              )}
            </div>
            {displayableReverseHedgeOrders.length > 0 && (
              <div className="mt-2 px-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setShowOrderInfo(v => !v)}
                    title={showOrderInfo ? '隐藏委托空单（黄色）' : '显示委托空单（黄色）'}
                    aria-label={showOrderInfo ? '隐藏委托空单' : '显示委托空单'}
                    className="inline-flex items-center text-[#F0B90B]/60 hover:text-[#F0B90B] transition-colors"
                  >
                    {showOrderInfo ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <span>
                    委托空单挂单（<span className="text-[#F0B90B]">黄色水平线</span>，按委托价{showOrderInfo ? '' : '·已隐藏'}）
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowReverseOrderManager(v => !v)}
                    className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/55 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {showReverseOrderManager ? '收起' : '管理'}
                  </button>
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
                    {visibleReverseHedgeOrders.map(order => (
                      <div
                        key={order.id}
                        className="group inline-flex items-center gap-1 rounded border border-border/40 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground"
                      >
                        <span className="text-[#F0B90B]/80">{reverseOrderStatusText(order)}</span>
                        <span>{fmtReverseOrderChipTime(order.createdAt)}</span>
                        <span>@ {fmtReverseOrderChipPrice(order.price)}</span>
                        <button
                          type="button"
                          onClick={() => hideReverseHedgeOrder(order.id)}
                          title="从盘面隐藏这条委托空单"
                          aria-label="从盘面隐藏这条委托空单"
                          className="ml-0.5 inline-flex items-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-[#F6465D] group-hover:opacity-100"
                        >
                          <EyeOff className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {selectedCounterfactual && (
              <div className="mt-2 px-1 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setShowCfOverlay(v => !v)}
                    title={showCfOverlay ? '隐藏补齐对照（紫色）' : '显示补齐对照（紫色）'}
                    aria-label={showCfOverlay ? '隐藏补齐对照' : '显示补齐对照'}
                    className="inline-flex items-center text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    {showCfOverlay ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  {showCfOverlay ? (
                    <span>实际轨迹（标准色）vs <span className="text-[#B080FF]">{selectedCounterfactual.label}</span>（紫色）</span>
                  ) : (
                    <span>实际轨迹（标准色）· <span className="text-[#B080FF]/70">{selectedCounterfactual.label}</span> 已隐藏</span>
                  )}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={legsExporting || legs.length === 0}
              onClick={handleExportCampaignBoardPng}
              className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              title="保存当前 K 线盘面与完整 Legs 列表为高清 PNG"
            >
              <Download className="h-3.5 w-3.5" />
              {legsExporting ? '生成中' : 'PNG'}
            </Button>
          </div>
          <CampaignLegsList
            legs={legs}
            tradeRecords={tradeRecords}
            reverseHedgeOrders={visibleReverseHedgeOrders}
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
              如果当时换一种打法，会发生什么？在下方「Legs 副本」里手动调整各条腿，点「一键运行」用真实行情跑一遍；再把你的调整与原始战役逐腿对比，把原始错误的代价折算成 USDT。
            </div>
          </div>

          <CampaignWhatIfEditor
            campaign={campaign}
            legs={legs}
            tradeRecords={tradeRecords}
            klines={klines}
            klinesLoading={klinesLoading}
            interval={interval}
            intervalOptions={INTERVALS}
            onIntervalChange={(nextInterval) => setInterval(nextInterval as Interval)}
            timezone={LOCAL_TIME_ZONE}
            whatIfRunning={whatIfRunning}
            onRunWhatIf={handleRunWhatIf}
            baseMarkers={chart.markers}
            baseTimeBoundPriceLines={chart.timeBoundPriceLines}
            baseVerticalLines={chart.verticalLines}
            orderInfoPriceLines={showOrderInfo ? orderInfoPriceLines : []}
          />

          {pendingCounterfactual && (
            <div className="rounded border border-[#F0B90B]/40 bg-[#F0B90B]/10 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-[13px] font-medium text-foreground">刚生成的反事实结果</div>
                <div className="text-[12px] text-muted-foreground">
                  {pendingCounterfactual.label} · 分支 P&L
                  <span className={`ml-2 font-mono ${pnlColor(pendingCounterfactual.result.final_realized_pnl)}`}>
                    {pendingCounterfactual.result.final_realized_pnl >= 0 ? '+' : ''}{pendingCounterfactual.result.final_realized_pnl.toFixed(2)}
                  </span>
                  <span className="mx-2">·</span>
                  相对实际
                  <span className={`ml-2 font-mono ${pnlColor(pendingCounterfactual.result.final_realized_pnl - actualPnl)}`}>
                    {pendingCounterfactual.result.final_realized_pnl - actualPnl >= 0 ? '+' : ''}
                    {(pendingCounterfactual.result.final_realized_pnl - actualPnl).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 text-[12px]"
                  onClick={() => handleDiscardGeneratedCounterfactual(pendingCounterfactual.id)}
                >
                  删除并刷新
                </Button>
                <Button
                  type="button"
                  className="h-9 bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 text-[12px]"
                  onClick={() => handleKeepGeneratedCounterfactual(pendingCounterfactual.id)}
                >
                  保存并刷新
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[13px] font-medium">已保存分支</div>
            {visibleBranches.length === 0 ? (
              <div className="rounded border border-border bg-background/40 px-4 py-4 text-[12px] text-muted-foreground">
                还没有反事实分支。先运行一键方案或新建 What-if 分支。
              </div>
            ) : (
              visibleBranches.map(branch => {
                    const delta = branch.result.final_realized_pnl - actualPnl;
                    const active = branch.id === selectedCounterfactualId;
                    return (
                      <div
                        key={branch.id}
                        className={`bg-card border rounded p-3 flex items-center gap-3 cursor-pointer ${active ? 'border-[#B080FF]/60 ring-1 ring-[#B080FF]/30' : 'border-border'}`}
                        onClick={() => setSelectedCounterfactualId(active ? null : branch.id)}
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${branchKindDot(branch.branch_kind)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium truncate">{branch.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {branchKindLabel(branch.branch_kind)} · {fmtMdHm(branch.created_at)}
                          </div>
                        </div>
                        <div className={`px-2 py-1 rounded text-[11px] font-mono ${pnlColor(branch.result.final_realized_pnl)}`}>
                          {branch.result.final_realized_pnl >= 0 ? '+' : ''}{branch.result.final_realized_pnl.toFixed(2)}
                        </div>
                        <div className={`px-2 py-1 rounded text-[11px] font-mono ${pnlColor(delta)}`}>
                          {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                        </div>
                        <div className="px-2 py-1 rounded text-[11px] font-mono bg-muted text-foreground">
                          SOP {branch.result.sop_score}
                        </div>
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

          {selectedCounterfactual && (
            <div className="bg-card border border-border rounded p-4 mt-4 space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-[13px] font-medium">所选分支结果</div>
                  <div className="text-[12px] text-muted-foreground mt-1">
                    这里展示当前高亮分支的模拟结果，与上方“已保存分支”保持同一口径。
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-right">
                  <div>
                    <div className="text-[11px] text-muted-foreground">分支 P&L</div>
                    <div className={`font-mono text-[20px] ${pnlColor(selectedCounterfactual.result.final_realized_pnl)}`}>
                      {selectedCounterfactual.result.final_realized_pnl >= 0 ? '+' : ''}
                      {selectedCounterfactual.result.final_realized_pnl.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">相对实际</div>
                    <div className={`font-mono text-[20px] ${pnlColor(selectedCounterfactualDelta)}`}>
                      {selectedCounterfactualDelta != null && selectedCounterfactualDelta >= 0 ? '+' : ''}
                      {selectedCounterfactualDelta?.toFixed(2) ?? '-'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded border border-border bg-background/50 px-3 py-2 text-[12px] text-muted-foreground">
                SOP {selectedCounterfactual.result.sop_score} · {branchKindLabel(selectedCounterfactual.branch_kind)} · {fmtMdHm(selectedCounterfactual.created_at)}
              </div>
            </div>
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
                                <Input
                                  value={categoryVal}
                                  onChange={e => setField('category', e.target.value)}
                                  placeholder="违规阶段（选填）"
                                  className="h-8 text-[11px] capitalize"
                                />
                              ) : (
                                <span className="capitalize">{categoryVal || '—'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-foreground">
                              {isOwner ? (
                                <Input
                                  value={reasonVal}
                                  onChange={e => setField('reason', e.target.value)}
                                  placeholder="违规描述（选填）"
                                  className="h-8 text-[11px]"
                                />
                              ) : (
                                <span>{reasonVal || '—'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-muted-foreground">
                              {isOwner ? (
                                <Input
                                  value={fixVal}
                                  onChange={e => setField('fix', e.target.value)}
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
