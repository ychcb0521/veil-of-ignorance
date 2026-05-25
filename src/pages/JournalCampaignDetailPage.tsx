import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Flag, Info, Layers, Sparkles, Target, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ReplayCandleChart, type ChartMarker, type TimeBoundPriceLine, type VerticalLine } from '@/components/journal/ReplayCandleChart';
import { StateMachineTimeline } from '@/components/journal/StateMachineTimeline';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { DecisionAccuracyPanel } from '@/components/journal/DecisionAccuracyPanel';
import { SopDeviationCard } from '@/components/journal/SopDeviationCard';
import { EndCampaignDialog } from '@/components/journal/EndCampaignDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { intervalToMs } from '@/hooks/useBinanceData';
import { useCampaignKlines } from '@/hooks/useCampaignKlines';
import { buildPureSopParams } from '@/lib/campaignSimulationEngine';
import {
  buildCampaignEventStream,
  computeDecisionAccuracy,
  computeSopDeviation,
  deriveCampaignStates,
  shouldSuggestCampaignEnd,
} from '@/lib/campaignAnalysis';
import {
  deleteCounterfactual,
  detachJournalFromCampaign,
  getCampaignFullData,
  listCounterfactuals,
  runAndPersistCustomCounterfactual,
  runAndPersistDeviationCosts,
  runAndPersistPureSop,
} from '@/lib/journalApi';
import { STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import type {
  CampaignCounterfactual,
  CampaignCounterfactualParams,
  DeviationCost,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { PendingOrder, TradeRecord } from '@/types/trading';

const INTERVALS = ['1m', '5m', '15m', '1h'] as const;
type Interval = (typeof INTERVALS)[number];

function pnlColor(value: number | null) {
  if (value == null) return 'text-muted-foreground';
  if (value > 0) return 'text-[#0ECB81]';
  if (value < 0) return 'text-[#F6465D]';
  return 'text-muted-foreground';
}

function fmtMdHm(value: string | null) {
  if (!value) return '进行中';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(start: string, end: string | null) {
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((to - from) / 60000));
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return `${hours} 小时 ${rest} 分钟`;
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

function gradeClass(grade: string | null) {
  switch (grade) {
    case 'A': return 'bg-[#0ECB81]/15 text-[#0ECB81]';
    case 'B': return 'bg-[#0ECB81]/10 text-foreground';
    case 'C': return 'bg-[#F0B90B]/15 text-[#F0B90B]';
    case 'D': return 'bg-[#F6465D]/10 text-[#F6465D]';
    case 'F': return 'bg-[#F6465D]/20 text-[#F6465D] font-bold';
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
    case 'reentry_main': return 'CF-Re';
    case 'hedge_initial_a': return 'CF-Ha';
    case 'hedge_initial_b': return 'CF-Hb';
    case 'hedge_rolling': return 'CF-Hr';
    case 'mirror_tp': return 'CF-TP';
    default: return 'CF';
  }
}

function buildDefaultWhatIfParams(campaign: TradeCampaign, legs: TradeJournal[]) {
  return buildPureSopParams(campaign, legs);
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
    color: 'rgba(255,255,255,0.45)',
    width: 1,
    z: 1,
  });
  if (campaign.closed_at) {
    verticalLines.push({
      time: new Date(campaign.closed_at).getTime(),
      color: 'rgba(255,255,255,0.45)',
      width: 1,
      z: 1,
    });
  }

  const stateEvents = events.filter(event =>
    event.event_type === 'mirror_tp_triggered' ||
    event.event_type === 'hedge_triggered' ||
    event.event_type === 'main_fully_closed',
  );
  for (const event of stateEvents) {
    verticalLines.push({
      time: new Date(event.timestamp).getTime(),
      color: 'rgba(240,185,11,0.6)',
      width: 1.2,
      z: 2,
    });
  }

  let rollingIndex = 1;
  for (const leg of legs) {
    const record = leg.trade_record_id ? tradeRecords.find(item => item.id === leg.trade_record_id) ?? null : null;
    const placedMs = new Date(leg.pre_simulated_time).getTime();
    const price = leg.pre_entry_price ?? record?.entryPrice ?? 0;
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
    if (leg.leg_role === 'reentry_main') { label = 'ReM'; }
    if (leg.leg_role === 'reentry_hedge') { label = 'ReH'; shape = 'triangle-down'; }
    if (leg.leg_role === 'main_open') { label = leg.direction === 'short' ? 'M↓' : 'M↑'; }

    markers.push({ time: record?.openTime ?? placedMs, price, shape, color, label });

    const cancelEvent = events.find(event => event.journal_id === leg.id && event.event_type === 'hedge_cancelled') ?? null;
    const startTime = placedMs;
    const endTime = record
      ? (leg.leg_role === 'mirror_tp' ? record.closeTime : record.openTime)
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

    if (record) {
      if (leg.leg_role === 'mirror_tp') {
        markers.push({
          time: record.closeTime,
          price: record.exitPrice,
          shape: 'circle',
          color: '#0ECB81',
          label: 'M 减仓 50%',
        });
      }
      if (leg.leg_role === 'main_open' || leg.leg_role === 'reentry_main') {
        markers.push({
          time: record.closeTime,
          price: record.exitPrice,
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
        color: 'rgba(176,128,255,0.55)',
        width: 1,
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
        color: 'rgba(176,128,255,0.55)',
        width: 1,
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
  const [interval, setInterval] = useState<Interval>('5m');
  const [endOpen, setEndOpen] = useState(false);
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [counterfactuals, setCounterfactuals] = useState<CampaignCounterfactual[]>([]);
  const [selectedCounterfactualId, setSelectedCounterfactualId] = useState<string | null>(null);
  const [pureRunning, setPureRunning] = useState(false);
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [whatIfLabel, setWhatIfLabel] = useState('');
  const [whatIfDescription, setWhatIfDescription] = useState('');
  const [whatIfParams, setWhatIfParams] = useState<CampaignCounterfactualParams | null>(null);
  const [whatIfRunning, setWhatIfRunning] = useState(false);
  const [deviationCosts, setDeviationCosts] = useState<DeviationCost[]>([]);
  const [deviationLoading, setDeviationLoading] = useState(false);
  const [deviationHydrated, setDeviationHydrated] = useState(false);
  const [detachTarget, setDetachTarget] = useState<TradeJournal | null>(null);
  const [detaching, setDetaching] = useState(false);
  const sopRef = useRef<HTMLDivElement | null>(null);

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
        if (full.campaign.user_id !== user.id) {
          nav(`/journal/campaigns${location.search}`);
          return;
        }
        setCampaign(full.campaign);
        setLegs(full.legs);
        setTradeRecords(full.tradeRecords);
        setPendingOrders(full.pendingOrders);
        setCounterfactuals(savedCounterfactuals);
        setSelectedCounterfactualId(prev => prev ?? savedCounterfactuals[0]?.id ?? null);
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

  const { klines, loading: klinesLoading } = useCampaignKlines(
    campaign?.symbol ?? '',
    campaign?.opened_at ?? new Date().toISOString(),
    effectiveClosedAt,
    interval,
  );

  const states = useMemo(
    () => (campaign ? deriveCampaignStates(campaign, legs, tradeRecords) : []),
    [campaign, legs, tradeRecords],
  );
  const accuracy = useMemo(
    () => (campaign ? computeDecisionAccuracy(campaign, legs, tradeRecords, klines) : null),
    [campaign, legs, tradeRecords, klines],
  );
  const sop = useMemo(
    () => (campaign ? computeSopDeviation(campaign, legs, tradeRecords) : null),
    [campaign, legs, tradeRecords],
  );
  const chart = useMemo(
    () => (campaign ? buildChartArtifacts(campaign, legs, tradeRecords) : { markers: [], timeBoundPriceLines: [], verticalLines: [], events: [] }),
    [campaign, legs, tradeRecords],
  );
  const selectedCounterfactual = useMemo(
    () => counterfactuals.find(branch => branch.id === selectedCounterfactualId) ?? null,
    [counterfactuals, selectedCounterfactualId],
  );
  const counterfactualChart = useMemo(
    () => buildCounterfactualChartArtifacts(selectedCounterfactual),
    [selectedCounterfactual],
  );
  const displayMarkers = useMemo(
    () => [...chart.markers, ...counterfactualChart.markers],
    [chart.markers, counterfactualChart.markers],
  );
  const displayPriceLines = useMemo(
    () => [...chart.timeBoundPriceLines, ...counterfactualChart.timeBoundPriceLines],
    [chart.timeBoundPriceLines, counterfactualChart.timeBoundPriceLines],
  );
  const displayVerticalLines = useMemo(
    () => [...chart.verticalLines, ...counterfactualChart.verticalLines],
    [chart.verticalLines, counterfactualChart.verticalLines],
  );
  const canSuggestEnd = useMemo(
    () => (campaign ? shouldSuggestCampaignEnd(campaign, legs, tradeRecords, pendingOrders, getEffectiveTime(campaign.symbol)) : false),
    [campaign, legs, tradeRecords, pendingOrders, getEffectiveTime],
  );
  const chartCurrentTime = focusTime ?? new Date(effectiveClosedAt ?? campaign.opened_at).getTime();
  const pureSopDefaults = useMemo(
    () => (campaign ? buildDefaultWhatIfParams(campaign, legs) : null),
    [campaign, legs],
  );
  const hasPureSopBranch = useMemo(
    () => counterfactuals.some(branch => branch.branch_kind === 'pure_sop'),
    [counterfactuals],
  );
  const retroactiveLegCount = useMemo(
    () => legs.filter(leg => leg.source === 'retroactive_from_record').length,
    [legs],
  );

  useEffect(() => {
    if (!pureSopDefaults) return;
    setWhatIfParams(pureSopDefaults);
  }, [pureSopDefaults]);

  useEffect(() => {
    if (!campaign || campaign.strategy_template === 'custom') return;
    if (!hasPureSopBranch || deviationHydrated || klines.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        setDeviationLoading(true);
        const costs = await runAndPersistDeviationCosts(campaign.id, klines);
        if (cancelled) return;
        setDeviationCosts(costs);
        setDeviationHydrated(true);
        setCounterfactuals(await listCounterfactuals(campaign.id));
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setDeviationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign, hasPureSopBranch, deviationHydrated, klines]);

  if (loading || !campaign || !accuracy || !sop) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4">
        <Skeleton className="h-16 w-full bg-card" />
        <Skeleton className="h-36 w-full bg-card" />
        <Skeleton className="h-[560px] w-full bg-card" />
      </div>
    );
  }

  const totalPlannedMaxLoss = legs.reduce((sum: number, leg: TradeJournal) => sum + (leg.pre_max_loss_usdt ?? 0), 0);
  const peakRMultiple = totalPlannedMaxLoss > 0 ? accuracy.campaign_max_profit_real / totalPlannedMaxLoss : null;
  const mainCount = legs.filter((leg: TradeJournal) => leg.leg_role === 'main_open' || leg.leg_role === 'reentry_main').length;
  const hedgeCount = legs.filter((leg: TradeJournal) => leg.leg_role?.startsWith('hedge_')).length;
  const tpCount = legs.filter((leg: TradeJournal) => leg.leg_role === 'mirror_tp').length;
  const otherCount = Math.max(0, legs.length - mainCount - hedgeCount - tpCount);
  const actualPnl = campaign.final_realized_pnl ?? 0;
  const totalDeviationCost = deviationCosts.reduce((sum, item) => sum + item.cost_usdt, 0);

  const refreshCampaign = async () => {
    const full = await getCampaignFullData(campaign.id);
    setCampaign(full.campaign);
    setLegs(full.legs);
    setTradeRecords(full.tradeRecords);
    setPendingOrders(full.pendingOrders);
  };

  const reloadCounterfactuals = async (keepSelectionId?: string | null) => {
    const next = await listCounterfactuals(campaign.id);
    setCounterfactuals(next);
    setSelectedCounterfactualId(keepSelectionId ?? next[0]?.id ?? null);
  };

  const handleRunPureSop = async () => {
    if (klinesLoading || klines.length === 0) {
      toast.error('K 线尚未加载完成，暂时无法运行 Pure SOP');
      return;
    }
    try {
      setPureRunning(true);
      const branch = await runAndPersistPureSop(campaign.id, klines);
      await reloadCounterfactuals(branch.id);
      setSelectedCounterfactualId(branch.id);
      setDeviationLoading(true);
      const costs = await runAndPersistDeviationCosts(campaign.id, klines);
      setDeviationCosts(costs);
      setDeviationHydrated(true);
      await reloadCounterfactuals(branch.id);
      toast.success('Pure SOP 反事实已运行');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPureRunning(false);
      setDeviationLoading(false);
    }
  };

  const handleRunWhatIf = async () => {
    if (!whatIfParams) return;
    if (!whatIfLabel.trim()) {
      toast.error('请填写分支标签');
      return;
    }
    if (klinesLoading || klines.length === 0) {
      toast.error('K 线尚未加载完成，暂时无法运行 What-if');
      return;
    }
    try {
      setWhatIfRunning(true);
      const branch = await runAndPersistCustomCounterfactual(campaign.id, whatIfLabel.trim(), whatIfParams, klines);
      await reloadCounterfactuals(branch.id);
      setSelectedCounterfactualId(branch.id);
      setWhatIfOpen(false);
      setWhatIfDescription('');
      toast.success('What-if 分支已保存');
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
      if (selectedCounterfactualId === branchId) {
        setSelectedCounterfactualId(next[0]?.id ?? null);
      }
      toast.success('分支已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleViewFixBranch = async (cost: DeviationCost) => {
    if (!cost.source_deduction_id) return;
    const existing = counterfactuals.find(branch => branch.source_deduction_id === cost.source_deduction_id);
    if (existing) {
      setSelectedCounterfactualId(existing.id);
      return;
    }
    if (klinesLoading || klines.length === 0) {
      toast.error('K 线尚未加载完成，暂时无法运行修正分支');
      return;
    }
    try {
      setDeviationLoading(true);
      const costs = await runAndPersistDeviationCosts(campaign.id, klines);
      setDeviationCosts(costs);
      setDeviationHydrated(true);
      const next = await listCounterfactuals(campaign.id);
      setCounterfactuals(next);
      const matched = next.find(branch => branch.source_deduction_id === cost.source_deduction_id);
      if (matched) setSelectedCounterfactualId(matched.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeviationLoading(false);
    }
  };

  const updateWhatIf = <K extends keyof CampaignCounterfactualParams>(
    key: K,
    value: CampaignCounterfactualParams[K],
  ) => {
    setWhatIfParams(prev => prev ? { ...prev, [key]: value } : prev);
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

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded p-4 space-y-2 text-[12px]">
            <div className="font-medium">战役元数据</div>
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
          </div>

          <div className="bg-card border border-border rounded p-4 space-y-2 text-[12px]">
            <div className="font-medium">盈亏概览</div>
            <div className={pnlColor(campaign.final_realized_pnl)}>已实现 P&L：{campaign.final_realized_pnl?.toFixed(2) ?? '—'} USDT</div>
            <div>峰值浮盈：{accuracy.campaign_max_profit_real.toFixed(2)}</div>
            <div>最大回撤：{accuracy.campaign_max_drawdown_real.toFixed(2)}</div>
            <div>盈利捕获率：{accuracy.profit_capture_ratio.toFixed(1)}%</div>
          </div>

          <div className="bg-card border border-border rounded p-4 space-y-2 text-[12px]">
            <div className="font-medium">R 倍数</div>
            <div className={`font-mono text-[20px] ${pnlColor(campaign.final_r_multiple)}`}>最终 R̄：{campaign.final_r_multiple?.toFixed(2) ?? '—'}</div>
            <div className={`font-mono ${pnlColor(peakRMultiple)}`}>峰值可达 R̄：{peakRMultiple != null ? peakRMultiple.toFixed(2) : '—'}</div>
          </div>

          <button
            type="button"
            onClick={() => sopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="bg-card border border-border rounded p-4 text-left hover:bg-accent transition-colors"
          >
            <div className="font-medium text-[12px] mb-2">SOP 偏离度</div>
            <div className="font-mono text-[28px]">{sop.score ?? '—'}/100</div>
            <div className={`inline-flex mt-2 px-2 py-0.5 rounded text-[11px] ${gradeClass(sop.grade)}`}>{sop.grade ?? '—'}</div>
            <div className="text-[10px] text-muted-foreground mt-2">查看下方详细 breakdown</div>
          </button>
        </section>

        <section className="space-y-3">
          <div className="bg-card border border-border rounded p-2">
            <div className="h-9 px-2 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                {INTERVALS.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setInterval(item)}
                    className={`h-6 px-2 rounded text-[10px] font-mono ${interval === item ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setFocusTime(new Date(campaign.opened_at).getTime())}>→ 战役开始</Button>
                {states.map((segment: typeof states[number]) => (
                  <Button
                    key={`${segment.state}-${segment.start_time}`}
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={() => {
                      setFocusTime(new Date(segment.triggering_event?.timestamp ?? segment.start_time).getTime());
                    }}
                  >
                    → {segment.state_label}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setFocusTime(new Date(effectiveClosedAt ?? campaign.opened_at).getTime())}>→ 战役结束</Button>
              </div>
            </div>
            <div className="h-[480px] border border-border rounded overflow-hidden">
              {klinesLoading ? (
                <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">加载 K 线…</div>
              ) : (
                <ReplayCandleChart
                  klines={klines}
                  currentTime={chartCurrentTime}
                  intervalMs={intervalToMs(interval)}
                  markers={displayMarkers}
                  timeBoundPriceLines={displayPriceLines}
                  verticalLines={displayVerticalLines}
                  windowCandles={180}
                />
              )}
            </div>
            {selectedCounterfactual && (
              <div className="mt-2 px-1 text-[11px] text-muted-foreground">
                实际轨迹（标准色）vs <span className="text-[#B080FF]">{selectedCounterfactual.label}</span>（紫色）
              </div>
            )}
            <div className="mt-3">
              <StateMachineTimeline
                segments={states}
                secondarySegments={selectedCounterfactual?.result.state_segments}
                secondaryLabel={selectedCounterfactual?.label}
                onJumpTo={setFocusTime}
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Layers className="w-4 h-4 text-muted-foreground" />
              Legs 列表
            </div>
            <CampaignLegsList legs={legs} tradeRecords={tradeRecords} onDetach={setDetachTarget} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Target className="w-4 h-4 text-muted-foreground" />
              决策准确性
            </div>
            <DecisionAccuracyPanel result={accuracy} />
          </div>
        </section>

        <section ref={sopRef} className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <Flag className="w-4 h-4 text-muted-foreground" />
            SOP 偏离度评分
          </div>
          <SopDeviationCard
            result={sop}
            active={campaign.status === 'active'}
            historicalWarning={retroactiveLegCount > 0}
            onJumpToEvent={(eventIds) => {
              const event = chart.events.find((item: typeof chart.events[number]) => eventIds.includes(item.id));
              if (event) setFocusTime(new Date(event.timestamp).getTime());
            }}
          />
        </section>

        <section className="bg-card border border-border rounded p-6 mb-6 space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Sparkles className="w-4 h-4 text-[#B080FF]" />
              反事实战役
            </div>
            <div className="text-[14px] text-foreground">
              如果你严格按 SOP 执行这场战役，会发生什么？反事实战役用真实市场数据 + 标准 SOP 参数跑一遍，让 SOP 偏离度评分变成可折算的 USDT 代价。
            </div>
          </div>

          {campaign.strategy_template === 'custom' ? (
            <div className="rounded border border-border bg-muted/40 px-4 py-4 text-[13px] text-muted-foreground">
              自定义模板暂不支持反事实模拟。
            </div>
          ) : (
            <>
              <div className="bg-[#0ECB81]/5 border border-[#0ECB81]/30 rounded p-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-[#0ECB81]/15 flex items-center justify-center text-[#0ECB81]">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">Pure SOP 一键运行</div>
                    <div className="text-[11px] text-muted-foreground">
                      用你冷静时定下的 SOP 默认参数（基于战役模板）+ 这场战役实际的市场数据，跑一次完整模拟。
                    </div>
                  </div>
                </div>
                <div className="flex-1" />
                <Button
                  className="bg-[#0ECB81] text-black hover:bg-[#0ECB81]/90 h-9 text-[12px]"
                  disabled={pureRunning || klinesLoading || klines.length === 0}
                  onClick={handleRunPureSop}
                >
                  {pureRunning ? '运行中…' : '运行'}
                </Button>
              </div>

              <details className="rounded border border-border bg-background/60 px-4 py-3 text-[12px]">
                <summary className="cursor-pointer text-muted-foreground">查看 Pure SOP 默认参数</summary>
                {pureSopDefaults && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px]">
                    <div>hedge_a_offset_pct: {pureSopDefaults.hedge_a.offset_pct.toFixed(1)}%</div>
                    <div>hedge_b_offset_pct: {pureSopDefaults.hedge_b.offset_pct.toFixed(1)}%</div>
                    <div>mirror_tp_offset_pct: {pureSopDefaults.mirror_tp.offset_pct.toFixed(1)}%</div>
                    <div>mirror_tp_size_pct: {pureSopDefaults.mirror_tp.size_pct.toFixed(0)}%</div>
                    <div>rolling.enabled: {pureSopDefaults.rolling.enabled ? 'true' : 'false'}</div>
                    <div>rolling.trigger_rise_pct: {pureSopDefaults.rolling.trigger_rise_pct.toFixed(1)}%</div>
                    <div>rolling.min_interval_minutes: {pureSopDefaults.rolling.min_interval_minutes}</div>
                    <div>rolling.new_hedge_offset_pct: {pureSopDefaults.rolling.new_hedge_offset_pct.toFixed(1)}%</div>
                    <div>rolling_hedge_size_pct: {pureSopDefaults.rolling.rolling_hedge_size_pct.toFixed(0)}%</div>
                    <div>exit_rule: '{pureSopDefaults.exit_rule}'</div>
                  </div>
                )}
              </details>

              <div className="bg-card border border-border rounded p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-medium">自定义 What-if 分支</div>
                    <div className="text-[11px] text-muted-foreground">如果对冲位放在 X、镜像 TP 放在 Y、或直接不滚动，会怎样？</div>
                  </div>
                  <Button
                    variant="outline"
                    className="h-8 text-[12px]"
                    onClick={() => setWhatIfOpen(prev => !prev)}
                  >
                    {whatIfOpen ? '收起' : '+ 新建 What-if 分支'}
                  </Button>
                </div>

                {whatIfOpen && whatIfParams && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">分支标签</label>
                        <Input
                          value={whatIfLabel}
                          maxLength={20}
                          placeholder="例如：对冲更宽 / 不滚动 / 单 hedge"
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setWhatIfLabel(e.target.value)}
                          className="text-[12px]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">描述（可选）</label>
                        <Textarea
                          value={whatIfDescription}
                          placeholder="记录这个分支想验证什么"
                          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setWhatIfDescription(e.target.value)}
                          className="min-h-[72px] text-[12px]"
                        />
                      </div>
                    </div>

                    <details open className="rounded border border-border bg-background/50 px-4 py-3">
                      <summary className="cursor-pointer text-[12px] font-medium">Setup</summary>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <Input
                          type="number"
                          value={whatIfParams.hedge_a.offset_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('hedge_a', { ...whatIfParams.hedge_a, offset_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="hedge_a 偏移 %"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.hedge_a.size_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('hedge_a', { ...whatIfParams.hedge_a, size_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="hedge_a 仓位 %"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.hedge_b.offset_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('hedge_b', { ...whatIfParams.hedge_b, offset_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="hedge_b 偏移 %"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.hedge_b.size_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('hedge_b', { ...whatIfParams.hedge_b, size_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="hedge_b 仓位 %"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.mirror_tp.offset_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('mirror_tp', { ...whatIfParams.mirror_tp, offset_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="mirror_tp 偏移 %"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.mirror_tp.size_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('mirror_tp', { ...whatIfParams.mirror_tp, size_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="mirror_tp 仓位 %"
                        />
                      </div>
                    </details>

                    <details className="rounded border border-border bg-background/50 px-4 py-3">
                      <summary className="cursor-pointer text-[12px] font-medium">Rolling</summary>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <div className="flex items-center justify-between rounded border border-border px-3 py-2 text-[12px]">
                          <span>启用滚动</span>
                          <Switch
                            checked={whatIfParams.rolling.enabled}
                            onCheckedChange={(checked: boolean) => updateWhatIf('rolling', { ...whatIfParams.rolling, enabled: checked })}
                          />
                        </div>
                        <Input
                          type="number"
                          value={whatIfParams.rolling.trigger_rise_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('rolling', { ...whatIfParams.rolling, trigger_rise_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="触发上涨 %"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.rolling.min_interval_minutes}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('rolling', { ...whatIfParams.rolling, min_interval_minutes: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="最小间隔（分钟）"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.rolling.new_hedge_offset_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('rolling', { ...whatIfParams.rolling, new_hedge_offset_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="新 hedge 偏移 %"
                        />
                        <Input
                          type="number"
                          value={whatIfParams.rolling.rolling_hedge_size_pct}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('rolling', { ...whatIfParams.rolling, rolling_hedge_size_pct: Number(e.target.value) })}
                          className="text-[12px]"
                          placeholder="滚动 hedge 仓位 %"
                        />
                      </div>
                    </details>

                    <details className="rounded border border-border bg-background/50 px-4 py-3">
                      <summary className="cursor-pointer text-[12px] font-medium">Exit</summary>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <select
                          value={whatIfParams.exit_rule}
                          onChange={(e: ChangeEvent<HTMLSelectElement>) => updateWhatIf('exit_rule', e.target.value as CampaignCounterfactualParams['exit_rule'])}
                          className="h-10 rounded border border-border bg-background px-3 text-[12px]"
                        >
                          <option value="close_all_on_hedge_trigger">close_all</option>
                          <option value="reenter_after_hedge_trigger">reenter</option>
                          <option value="manual_only">manual_only</option>
                        </select>
                        {whatIfParams.exit_rule === 'reenter_after_hedge_trigger' && (
                          <>
                            <Input
                              type="number"
                              value={whatIfParams.reentry?.delay_minutes ?? 30}
                              onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('reentry', {
                                delay_minutes: Number(e.target.value),
                                size_pct: whatIfParams.reentry?.size_pct ?? 100,
                              })}
                              className="text-[12px]"
                              placeholder="延迟分钟"
                            />
                            <Input
                              type="number"
                              value={whatIfParams.reentry?.size_pct ?? 100}
                              onChange={(e: ChangeEvent<HTMLInputElement>) => updateWhatIf('reentry', {
                                delay_minutes: whatIfParams.reentry?.delay_minutes ?? 30,
                                size_pct: Number(e.target.value),
                              })}
                              className="text-[12px]"
                              placeholder="重入仓位 %"
                            />
                          </>
                        )}
                      </div>
                    </details>

                    <div className="flex justify-end">
                      <Button
                        className="bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 h-9 text-[12px]"
                        disabled={whatIfRunning || !whatIfLabel.trim()}
                        onClick={handleRunWhatIf}
                      >
                        {whatIfRunning ? '运行中…' : '运行分支'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-[13px] font-medium">已保存分支</div>
                {counterfactuals.length === 0 ? (
                  <div className="rounded border border-border bg-background/40 px-4 py-4 text-[12px] text-muted-foreground">
                    还没有反事实分支。先运行 Pure SOP 或新建 What-if 分支。
                  </div>
                ) : (
                  counterfactuals.map(branch => {
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

              {hasPureSopBranch && (
                <div className="bg-card border border-border rounded p-4 mt-4 space-y-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className={`font-mono text-[36px] leading-none ${pnlColor(totalDeviationCost)}`}>
                        {totalDeviationCost >= 0 ? '+' : ''}{totalDeviationCost.toFixed(2)} USDT
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-2">
                        如果你严格按 SOP 执行，这场战役本可以多赚（或少亏）这么多。
                      </div>
                    </div>
                    {deviationLoading && <div className="text-[11px] text-muted-foreground">计算中…</div>}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-background text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2">违规阶段</th>
                          <th className="text-left px-3 py-2">违规描述</th>
                          <th className="text-left px-3 py-2">修正后</th>
                          <th className="text-right px-3 py-2">代价 (USDT)</th>
                          <th className="text-right px-3 py-2">占账户 %</th>
                          <th className="text-right px-3 py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deviationCosts.map(cost => (
                          <tr key={cost.source_deduction_id ?? `${cost.deduction_category}-${cost.deduction_reason}`} className="border-t border-border">
                            <td className="px-3 py-2 capitalize">{cost.deduction_category}</td>
                            <td className="px-3 py-2 text-foreground">{cost.deduction_reason}</td>
                            <td className="px-3 py-2 text-muted-foreground">{cost.fix_description}</td>
                            <td className={`px-3 py-2 text-right font-mono ${pnlColor(cost.cost_usdt)}`}>
                              {cost.cost_usdt >= 0 ? '+' : ''}{cost.cost_usdt.toFixed(2)}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono ${pnlColor(cost.cost_pct_of_account)}`}>
                              {cost.cost_pct_of_account >= 0 ? '+' : ''}{cost.cost_pct_of_account.toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                variant="outline"
                                className="h-8 text-[11px]"
                                onClick={() => handleViewFixBranch(cost)}
                              >
                                查看修正分支
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {deviationCosts.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-5 text-center text-[12px] text-muted-foreground">
                              {deviationLoading ? '正在计算偏离代价…' : '暂无可折算的 SOP 偏离代价'}
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
            </>
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
                    await detachJournalFromCampaign(detachTarget.id);
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
