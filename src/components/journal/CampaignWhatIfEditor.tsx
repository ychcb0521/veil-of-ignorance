import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, Trash2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import { type ChartMarker, type TimeBoundPriceLine, type VerticalLine } from '@/components/journal/ReplayCandleChart';
import { type AnalysisDraggableVerticalLine } from '@/components/CandlestickChart';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import {
  CAMPAIGN_VIEW_MULTIPLIERS,
  buildCampaignKlineVisibleRange,
  type CampaignKlineTimeWindow,
  type CampaignViewMultiplier,
} from '@/hooks/useCampaignKlines';
import {
  SELECTED_LEG_LONG_LINE_COLOR,
  SELECTED_LEG_SHORT_LINE_COLOR,
  SELECTED_LEG_VERTICAL_LINE_WIDTH,
  legRoleMarkerLabel,
} from '@/lib/campaignLegMarkers';
import { resolveUnfilledLegIds, type CampaignLocalOrderFacts } from '@/lib/campaignAnalysis';
import type { LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import {
  adoptBaselineLegFacts,
  buildActualSimulationParams,
  buildPureSopParams,
  buildManualLegs,
  earlierClosedCuts,
} from '@/lib/campaignSimulationEngine';
import { formatCounterfactualStamp } from '@/lib/counterfactualChangeSummary';
import { fromLocalDateTimeInputValue, toLocalDateTimeInputValue } from '@/lib/localDateTimeInput';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type {
  CampaignCounterfactualChangeSummary,
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  LegRole,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/**
 * 点「一键运行」那一刻编辑器里的两份腿：
 *   · baselineLegs 上一次重置（换战役 / 还原 Legs）时 buildManualLegs 的输出，即「原始」；
 *   · manualLegs   编辑器当前的全部腿（含停用），页面用它区分「停用」与「删除」。
 * 页面拿这两份与 params.manual_legs（仅启用）算改动摘要，随分支一起落库。
 */
export interface CampaignWhatIfRunContext {
  baselineLegs: CampaignCounterfactualManualLeg[];
  manualLegs: CampaignCounterfactualManualLeg[];
}

/** 「载入到 Legs 副本」：nonce 变一次就用 legs 的副本整体替换编辑器里的腿。 */
export interface CampaignWhatIfLoadLegsRequest {
  nonce: number;
  legs: CampaignCounterfactualManualLeg[];
  /** 那条分支运行时的 K 线末根（params.run_context.to）：老行里未结算腿的兜底平仓时间按它认。 */
  savedWindowEnd?: string | null;
  /** 那条分支运行时的改动摘要（params.change_summary）：没改过平仓时间的腿，平仓时间换成基线当前的值。 */
  savedChangeSummary?: CampaignCounterfactualChangeSummary | null;
}

interface Props {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  legExitPriceCorrections: LegExitPriceCorrections;
  /** 本地委托快照给出的事实（从未成交的委托 id）：与上方盈亏概览的权益路径读同一份，副本据此标「挂单中」。 */
  localOrders?: CampaignLocalOrderFacts;
  /** 完整委托历史（不受盘面隐藏影响），只用于保存可靠开仓方式。 */
  reverseHedgeOrders?: CampaignReverseHedgeOrder[];
  klines: KlineData[];
  klinesLoading: boolean;
  interval: string;
  intervalOptions?: readonly string[];
  onIntervalChange?: (interval: string) => void;
  /** 与原始战役盘面共用的完整时间窗口；反事实盘面默认只显示战役本身的 1 倍范围。 */
  klineTimeWindow: CampaignKlineTimeWindow;
  timezone?: string;
  whatIfRunning: boolean;
  onRunWhatIf: (label: string, params: CampaignCounterfactualParams, context: CampaignWhatIfRunContext) => void;
  /**
   * 把某条已保存分支的 manual_legs 载回编辑器。只在 nonce 变化时生效，替换整份腿并清掉选中；
   * 保留原 id（永远不含 ':'，盘面竖线 id 靠它拆分）。下面的重置 effect 原样保留：之后
   * legs / tradeRecords / 平仓价校正再变一次，载入的腿仍会被基线重置——与手工编辑同一条规则。
   * 战役行只换对象不换推演参数（例如「保存备注」只写 deviation_notes）不算重置：底稿按内容认身份。
   */
  loadLegsRequest?: CampaignWhatIfLoadLegsRequest | null;
  /** 原始交易战役盘面标记：反事实盘面用作只读背景，避免丢失原始上下文。 */
  baseMarkers?: ChartMarker[];
  /** 原始交易战役盘面横向区间线：对冲/TP 等只读背景。 */
  baseTimeBoundPriceLines?: TimeBoundPriceLine[];
  /** 原始交易战役盘面竖线：开仓、平仓和战役边界只读背景。 */
  baseVerticalLines?: VerticalLine[];
  /** 「委托空单（黄色）」挂单层：与原始战役盘面同一套数据，由父组件按开关传入；空数组即不显示。 */
  orderInfoPriceLines?: TimeBoundPriceLine[];
  /**
   * 【用户要求】「反事实的盘面的高度要与交易战役的原始盘面保持一致」：父组件把原始盘面按可视区实测出的高度传进来，
   * 两块盘面同高、随窗口一起变；缺省 480px（与原始盘面实测前的兜底一致）。
   */
  chartHeight?: number;
}

const ROLE_OPTIONS: LegRole[] = [
  'main_open',
  'main_add_1',
  'main_add_2',
  'main_add_3',
  'main_add_4',
  'main_add_5',
  'main_add_6',
  'hedge_initial_a',
  'hedge_initial_b',
  'hedge_rolling',
  'mirror_tp',
  'reentry_main',
  'reentry_hedge',
  'standalone',
];

const NO_LOCAL_ORDER_FACTS: CampaignLocalOrderFacts = {};
const NO_REVERSE_ORDERS: CampaignReverseHedgeOrder[] = [];

const COUNTERFACTUAL_VIEW_MULTIPLIERS: readonly CampaignViewMultiplier[] = [
  1.1,
  ...CAMPAIGN_VIEW_MULTIPLIERS,
];

function round(value: number, digits: number = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roleLabel(role: string) {
  return LEG_ROLE_LABELS[role as LegRole] ?? role;
}

function validTimeMs(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** 收盘那一组之前平掉的各刀（实际成交里先平掉的部分）；与收盘那一刀同一时刻平掉的刀不算「先平」。 */
function earlierCuts(leg: CampaignCounterfactualManualLeg) {
  return earlierClosedCuts(leg.actual);
}

function nearestKline(klines: KlineData[], time: number): KlineData | null {
  if (klines.length === 0) return null;
  return klines.reduce((best, item) => (
    Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best
  ), klines[0]);
}

function defaultCloseTime(params: CampaignCounterfactualParams, klines: KlineData[]) {
  const last = klines[klines.length - 1];
  return last ? new Date(last.time).toISOString() : params.entry.time;
}

export function CampaignWhatIfEditor({
  campaign,
  legs,
  tradeRecords,
  legExitPriceCorrections,
  localOrders = NO_LOCAL_ORDER_FACTS,
  reverseHedgeOrders = NO_REVERSE_ORDERS,
  klines,
  klinesLoading,
  interval,
  intervalOptions = [],
  onIntervalChange,
  klineTimeWindow,
  timezone,
  whatIfRunning,
  onRunWhatIf,
  loadLegsRequest = null,
  baseMarkers = [],
  baseTimeBoundPriceLines = [],
  baseVerticalLines = [],
  orderInfoPriceLines = [],
  chartHeight,
}: Props) {
  const actualDefaults = useMemo(() => buildActualSimulationParams(campaign, legs, tradeRecords), [campaign, legs, tradeRecords]);
  const sopDefaults = useMemo(() => buildPureSopParams(campaign, legs, tradeRecords), [campaign, legs, tradeRecords]);
  /**
   * 底稿按内容、不按对象身份认「换了底稿」。
   *
   * 页面上「保存备注」只改战役行的 deviation_notes，却会 setCampaign 换一个对象；推演参数一个字没变，
   * 若底稿跟着换身份，下面的重置 effect 就把用户刚「载入到 Legs 副本」的腿或手改到一半的腿静默冲掉。
   * 参数本来就是要落 jsonb 的纯 JSON，序列化成键再解析回来，键不变则引用不变。
   */
  const baseDefaultsKey = JSON.stringify(actualDefaults ?? sopDefaults);
  const baseDefaults = useMemo(
    () => JSON.parse(baseDefaultsKey) as CampaignCounterfactualParams | null,
    [baseDefaultsKey],
  );
  const [params, setParams] = useState<CampaignCounterfactualParams | null>(baseDefaults);
  const [manualLegs, setManualLegs] = useState<CampaignCounterfactualManualLeg[]>([]);
  // 最近一次重置产出的基线：改动摘要的「原始」一侧。只在重置 / 还原时写，编辑不动它。
  const [baselineLegs, setBaselineLegs] = useState<CampaignCounterfactualManualLeg[]>([]);
  const [label, setLabel] = useState('');
  const [selectedManualLegId, setSelectedManualLegId] = useState<string | null>(null);
  const [chartRangeMultiplier, setChartRangeMultiplier] = useState<CampaignViewMultiplier>(1.1);

  const chartVisibleRange = useMemo(
    () => buildCampaignKlineVisibleRange(klineTimeWindow, chartRangeMultiplier),
    [chartRangeMultiplier, klineTimeWindow],
  );
  const chartViewportCenterTime = Math.round(
    (chartVisibleRange.fromTime + chartVisibleRange.toTime) / 2,
  );

  /**
   * 重置只跟「换了战役 / 换了底稿」走，不跟 klines 数组的身份走。
   *
   * K 线范围加了绝对档（1天/1周/1月）之后，点一下就会重新拉取，klines 换成新数组——
   * 而这个 effect 原本把 klines 列在依赖里，于是用户填到一半的反事实参数和手工腿
   * 会被静默清空。倍数按钮不重取，所以两组相邻的按钮行为还不一样。
   * klines 只是算手工腿入场价的材料，用 ref 读当前值即可；真正该触发重建的是
   * 「K 线从无到有」那一次。
   */
  const klinesRef = useRef(klines);
  klinesRef.current = klines;
  const klinesReady = klines.length > 0;
  /**
   * 「挂单中」（从未成交的保护单）要看战役的事件流才判得准，所以基线要拿到战役行；
   * 但战役行换对象（「保存备注」只写 deviation_notes）不该冲掉编辑到一半的腿——
   * 战役走 ref，重置只认判定结果的内容：哪几条腿算挂单、战役何时结束、
   * 一条腿都结算不了时页面读的那个战役级已实现，这几样真的变了才重建基线。
   */
  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;
  // 本地委托事实同样走 ref：父组件每次给的对象可能是新的，内容（从未成交的委托 id）变了才重建基线。
  const localOrdersRef = useRef(localOrders);
  localOrdersRef.current = localOrders;
  const reverseHedgeOrdersRef = useRef(reverseHedgeOrders);
  reverseHedgeOrdersRef.current = reverseHedgeOrders;
  const unfilledOrderIdsKey = [...(localOrders.unfilledOrderIds ?? [])].sort().join('|');
  const baselineCampaignKey = useMemo(() => {
    const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, legExitPriceCorrections);
    const campaignTotal = settlement.basis === 'events' || settlement.basis === 'campaign_summary'
      ? String(settlement.total)
      : '';
    return [
      [...resolveUnfilledLegIds(campaign, legs, tradeRecords, localOrdersRef.current)].sort().join('|'),
      campaign.closed_at ?? '',
      campaignTotal,
      unfilledOrderIdsKey,
    ].join('#');
  }, [campaign, legs, tradeRecords, legExitPriceCorrections, unfilledOrderIdsKey]);
  useEffect(() => {
    setParams(baseDefaults);
    if (baseDefaults) {
      const baseline = buildManualLegs(
        baseDefaults,
        legs,
        klinesRef.current,
        tradeRecords,
        legExitPriceCorrections,
        { campaign: campaignRef.current, localOrders: localOrdersRef.current, reverseHedgeOrders: reverseHedgeOrdersRef.current },
      );
      setBaselineLegs(baseline);
      setManualLegs(baseline.map(leg => ({ ...leg })));
    }
    setSelectedManualLegId(null);
  }, [baseDefaults, legs, klinesReady, tradeRecords, legExitPriceCorrections, baselineCampaignKey]);

  // 「载入到 Legs 副本」：legs 走 ref、只认 nonce，避免父组件每次渲染都重新载入。
  const loadLegsRequestRef = useRef(loadLegsRequest);
  loadLegsRequestRef.current = loadLegsRequest;
  const baselineLegsRef = useRef(baselineLegs);
  baselineLegsRef.current = baselineLegs;
  const loadLegsNonce = loadLegsRequest?.nonce ?? null;
  useEffect(() => {
    if (loadLegsNonce == null) return;
    const request = loadLegsRequestRef.current;
    if (!request) return;
    // 口径统一之前保存的分支没有实际成交结果与成交状态：按当前基线补上，重跑才与上方盈亏概览同一口径。
    const baselineById = new Map(baselineLegsRef.current.map(leg => [leg.id, leg]));
    setManualLegs(request.legs.map(leg => adoptBaselineLegFacts(
      { ...leg },
      baselineById.get(leg.id),
      request.savedWindowEnd ?? null,
      request.savedChangeSummary ?? null,
    )));
    setSelectedManualLegId(null);
  }, [loadLegsNonce]);

  useEffect(() => {
    setChartRangeMultiplier(1.1);
  }, [campaign.id]);

  const canRun = !klinesLoading && klines.length > 0;
  const chartCurrentTime = chartVisibleRange.toTime;

  const updateManualLeg = (id: string, patch: Partial<CampaignCounterfactualManualLeg>) => {
    setManualLegs(prev => prev.map(leg => (leg.id === id ? { ...leg, ...patch } : leg)));
  };

  const addHedgeLeg = () => {
    if (!params) return;
    const now = params.entry.time;
    const lastTime = defaultCloseTime(params, klines);
    const lastPrice = klines[klines.length - 1]?.close ?? params.entry.price;
    const id = `manual-${Date.now()}`;
    // 币本位战役里新增的腿同样按币本位收费（张数 × 面值 × 费率）：结算方式与面值抄原始 Legs 里的币本位腿。
    const coinTemplate = baselineLegs.find(leg => leg.settlement_mode === 'coin') ?? null;
    setManualLegs(prev => [
      ...prev,
      {
        id,
        leg_role: 'hedge_rolling',
        direction: params.entry.direction === 'long' ? 'short' : 'long',
        open_time: now,
        close_time: lastTime,
        entry_price: params.entry.price,
        exit_price: lastPrice,
        size_usdt: round(params.entry.size_usdt * 0.5, 2),
        leverage: params.entry.leverage,
        enabled: true,
        ...(coinTemplate
          ? { settlement_mode: 'coin' as const, contract_size_usd: coinTemplate.contract_size_usd }
          : {}),
      },
    ]);
    setSelectedManualLegId(id);
  };

  const resetManualLegs = () => {
    if (!baseDefaults) return;
    const baseline = buildManualLegs(baseDefaults, legs, klines, tradeRecords, legExitPriceCorrections, { campaign, localOrders, reverseHedgeOrders });
    setBaselineLegs(baseline);
    setManualLegs(baseline.map(leg => ({ ...leg })));
    setParams(baseDefaults);
    setSelectedManualLegId(null);
  };

  const activeManualLegs = manualLegs.filter(leg => leg.enabled);

  const verticalLines = useMemo<AnalysisDraggableVerticalLine[]>(() => {
    return activeManualLegs.flatMap(leg => {
      const color = leg.direction === 'long' ? SELECTED_LEG_LONG_LINE_COLOR : SELECTED_LEG_SHORT_LINE_COLOR;
      const openMs = validTimeMs(leg.open_time);
      const closeMs = validTimeMs(leg.close_time);
      const labelPrefix = legRoleMarkerLabel(leg.leg_role);
      const selected = selectedManualLegId === leg.id;
      return [
        openMs == null ? null : {
          id: `${leg.id}:open`,
          time: openMs,
          color,
          width: SELECTED_LEG_VERTICAL_LINE_WIDTH,
          dashed: false,
          label: `${labelPrefix}·开仓`,
          labelColor: color,
          selected,
        },
        closeMs == null ? null : {
          id: `${leg.id}:close`,
          time: closeMs,
          color,
          width: SELECTED_LEG_VERTICAL_LINE_WIDTH,
          dashed: true,
          label: `${labelPrefix}·平仓`,
          labelColor: color,
          selected,
        },
      ].filter(Boolean) as AnalysisDraggableVerticalLine[];
    });
  }, [activeManualLegs, selectedManualLegId]);

  const handleDragVerticalLine = (id: string, time: number) => {
    const [legId, endpoint] = id.split(':');
    if (legId) setSelectedManualLegId(legId);
    const kline = nearestKline(klines, time);
    const iso = new Date(time).toISOString();
    if (endpoint === 'open') {
      updateManualLeg(legId, {
        open_time: iso,
        entry_price: kline ? round(kline.close, 8) : undefined,
      });
    }
    if (endpoint === 'close') {
      // 强平腿的平仓端点由交易所决定：图上拖动也不改它（与编辑器里锁死那两格同一条规则）。
      const target = manualLegs.find(leg => leg.id === legId);
      if (target?.actual?.liquidated === true) return;
      updateManualLeg(legId, {
        close_time: iso,
        exit_price: kline ? round(kline.close, 8) : undefined,
      });
    }
  };

  const handleSelectVerticalLine = (id: string) => {
    const [legId] = id.split(':');
    setSelectedManualLegId(legId || null);
  };

  const runManualScenario = () => {
    if (!params) return;
    const runLabel = label.trim() || '手动调整';
    onRunWhatIf(runLabel, {
      ...params,
      manual_legs: activeManualLegs,
    }, { baselineLegs, manualLegs });
  };

  if (!params) {
    return (
      <div className="rounded border border-border bg-muted/40 px-4 py-4 text-[13px] text-muted-foreground">
        无法从该战役推断主力开仓数据，暂不能运行反事实模拟。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#0ECB81]/5 border border-[#0ECB81]/30 rounded p-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-full bg-[#0ECB81]/15 flex items-center justify-center text-[#0ECB81]">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-medium">一键运行（按你手动调整的 Legs）</div>
            <div className="text-[11px] text-muted-foreground">
              用这场战役的真实行情，跑你在下方「Legs 副本·手动反事实」里调整后的 Legs。
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <Button
          className="bg-[#0ECB81] text-black hover:bg-[#0ECB81]/90 h-9 text-[12px]"
          disabled={whatIfRunning || !canRun || activeManualLegs.length === 0}
          onClick={runManualScenario}
        >
          {whatIfRunning ? '运行中…' : '一键运行'}
        </Button>
      </div>

      <div className="bg-card border border-border rounded p-4 flex flex-col gap-4">
        <div className="order-1 flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="space-y-1 min-w-0">
            <div className="text-[14px] font-medium">Legs 副本 · 手动反事实</div>
            <div className="text-[11px] text-muted-foreground">
              复制当前 Legs 后再调整。你可以改开/平时间、价格、仓位，也可以删除或增添；拖动盘面竖线会同步回写时间与价格。
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-8 text-[11px]" onClick={resetManualLegs}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              还原 Legs
            </Button>
            <Button variant="outline" className="h-8 text-[11px]" onClick={addHedgeLeg}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              增添
            </Button>
          </div>
        </div>

        <div className="order-2 min-h-9 px-2 py-1 flex flex-wrap items-center gap-2">
          {onIntervalChange && intervalOptions.length > 0 && (
            <div className="flex items-center gap-1">
              {intervalOptions.map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onIntervalChange(item)}
                  className={`h-6 px-2 rounded text-[10px] font-mono ${interval === item ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground'}`}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
          {onIntervalChange && intervalOptions.length > 0 && (
            <div className="h-4 w-px bg-border/70" />
          )}
          <div className="flex items-center gap-0.5" aria-label="反事实 K 线显示范围">
            {COUNTERFACTUAL_VIEW_MULTIPLIERS.map(multiplier => (
              <button
                key={multiplier}
                type="button"
                title={`反事实盘面显示 ${multiplier} 倍战役时间范围`}
                aria-label={`反事实盘面显示 ${multiplier} 倍战役时间范围`}
                aria-pressed={chartRangeMultiplier === multiplier}
                onClick={() => setChartRangeMultiplier(multiplier)}
                className={`h-5 min-w-6 rounded px-1 text-[9px] font-mono transition-colors ${
                  chartRangeMultiplier === multiplier
                    ? 'bg-foreground/85 text-background'
                    : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground'
                }`}
              >
                {multiplier}x
              </button>
            ))}
          </div>
          <div className="flex-1" />
        </div>

        <div
          data-testid="counterfactual-chart-section"
          className="order-4 border border-border rounded overflow-hidden"
          style={{ height: chartHeight ?? 480 }}
        >
          {klinesLoading ? (
            <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">加载 K 线…</div>
          ) : klines.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">暂无 K 线数据</div>
          ) : (
            <ReplayKlineChart
              klines={klines}
              currentTime={chartCurrentTime}
              intervalMs={intervalToMs(interval)}
              symbol={campaign.symbol}
              fitAll
              initialVisibleStartTime={chartVisibleRange.fromTime}
              initialVisibleEndTime={chartVisibleRange.toTime}
              showLastPriceLine={false}
              viewportCenterTime={chartViewportCenterTime}
              markers={baseMarkers}
              timeBoundPriceLines={[
                ...baseTimeBoundPriceLines,
                ...orderInfoPriceLines,
              ]}
              verticalLines={baseVerticalLines}
              draggableVerticalLines={verticalLines}
              onDragVerticalLine={handleDragVerticalLine}
              onSelectVerticalLine={handleSelectVerticalLine}
              timezone={timezone}
            />
          )}
        </div>

        <div
          data-testid="counterfactual-legs-table"
          className="order-3 overflow-x-auto rounded border border-border"
        >
          <table className="w-full min-w-[980px] text-[11px]">
            <thead className="bg-muted/80 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">角色</th>
                <th className="text-left px-3 py-2">方向</th>
                <th className="text-left px-3 py-2">开仓时间</th>
                <th className="text-left px-3 py-2">平仓时间</th>
                <th className="text-left px-3 py-2">开仓价</th>
                <th className="text-left px-3 py-2">平仓价</th>
                <th className="text-left px-3 py-2">仓位</th>
                <th className="text-right px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {manualLegs.map((leg, index) => {
                const isSelected = selectedManualLegId === leg.id;
                /**
                 * 被交易所强平掉的腿：平仓价 / 平仓时间不是决策，是交易所在强平价上的动作。
                 * 「如果当时晚一点平」在现实里不存在（仓位已经被收走），所以这两格锁死；
                 * 逐仓强平的盈亏另按各刀在破产价上结算掉的那笔钱截断（resolveManualLegEconomics），全仓强平不封顶。
                 */
                const liquidated = leg.actual?.liquidated === true;
                const liquidatedHint = '这条腿是被交易所强平的：方向、平仓价与平仓时间由强平决定，改不动。其余格子照常可改；逐仓强平的亏损按保证金封顶，全仓强平没有封顶。';
                return (
                  <tr
                    key={leg.id}
                    onClick={() => setSelectedManualLegId(leg.id)}
                    className={[
                      'cursor-pointer border-t border-border transition-colors',
                      isSelected ? 'bg-[#F0B90B]/10 shadow-[inset_3px_0_0_rgba(240,185,11,0.8)]' : '',
                      isSelected ? '' : 'hover:bg-muted/40',
                      leg.enabled ? '' : 'opacity-45',
                    ].filter(Boolean).join(' ')}
                  >
                    <td className="px-3 py-2 font-mono">{index + 1}</td>
                    <td className="px-3 py-2">
                      <select
                        className="h-8 w-full rounded border border-border bg-background px-2"
                        value={leg.leg_role}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => updateManualLeg(leg.id, { leg_role: e.target.value })}
                      >
                        {ROLE_OPTIONS.map(role => (
                          <option key={role} value={role}>{roleLabel(role)}</option>
                        ))}
                      </select>
                      {/* 只有原本从未成交的腿（挂单）才带 filled 字段：它不进持仓与已实现，但仍是定义 L 的止损线。
                          切到「已成交」即模拟它成交，盈亏按你填的开平价与模拟器费率算。
                          老行里改过价的挂单载入时写成 filled: true（老引擎当它成交），同样画开关，随时能切回去。 */}
                      {liquidated && (
                        <div className="mt-1">
                          <span
                            data-testid={`counterfactual-leg-liquidated-${leg.id}`}
                            title={liquidatedHint}
                            className="rounded border border-[#F6465D]/40 bg-[#F6465D]/10 px-1 text-[10px] leading-4 text-[#F6465D]"
                          >
                            爆仓
                          </span>
                        </div>
                      )}
                      {leg.filled !== undefined && (
                        <div className="mt-1 flex items-center gap-1.5">
                          {leg.filled === false && (
                            <span className="rounded border border-[#F0B90B]/40 px-1 text-[10px] leading-4 text-[#F0B90B]">
                              挂单中
                            </span>
                          )}
                          <button
                            type="button"
                            data-testid={`counterfactual-leg-filled-toggle-${leg.id}`}
                            aria-pressed={leg.filled !== false}
                            title={leg.filled === false
                              ? '这张挂单实际从未成交：不计入持仓与已实现，只作止损线。点一下模拟它成交。'
                              : '正在模拟这张挂单成交：按开平价与模拟器费率计盈亏。点一下恢复为未成交。'}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedManualLegId(leg.id);
                              updateManualLeg(leg.id, { filled: leg.filled === false });
                            }}
                            className="inline-flex h-4 items-center overflow-hidden rounded border border-border text-[10px] leading-4"
                          >
                            <span className={`px-1 ${leg.filled === false ? 'bg-foreground/85 text-background' : 'text-muted-foreground'}`}>未成交</span>
                            <span className={`px-1 ${leg.filled !== false ? 'bg-foreground/85 text-background' : 'text-muted-foreground'}`}>已成交</span>
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {/* 爆仓腿的方向也锁死：多单翻成空单后这笔强平在现实里已不存在，
                          锁着的平仓价 / 时间与按原方向保证金算的封顶都会套错方向。 */}
                      <select
                        data-testid={`counterfactual-leg-direction-${leg.id}`}
                        className="h-8 w-full rounded border border-border bg-background px-2"
                        value={leg.direction}
                        disabled={liquidated}
                        title={liquidated ? liquidatedHint : undefined}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => updateManualLeg(leg.id, { direction: e.target.value as 'long' | 'short' })}
                      >
                        <option value="long">多</option>
                        <option value="short">空</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="datetime-local"
                        className="h-8 text-[11px]"
                        value={toLocalDateTimeInputValue(leg.open_time)}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { open_time: fromLocalDateTimeInputValue(e.target.value, leg.open_time) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="datetime-local"
                        data-testid={`counterfactual-leg-close-time-${leg.id}`}
                        className="h-8 text-[11px]"
                        disabled={liquidated}
                        title={liquidated ? liquidatedHint : undefined}
                        value={toLocalDateTimeInputValue(leg.close_time)}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { close_time: fromLocalDateTimeInputValue(e.target.value, leg.close_time) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        className="h-8 text-[11px]"
                        value={leg.entry_price}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { entry_price: Number(e.target.value) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        data-testid={`counterfactual-leg-exit-price-${leg.id}`}
                        className="h-8 text-[11px]"
                        disabled={liquidated}
                        title={liquidated ? liquidatedHint : undefined}
                        value={leg.exit_price}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { exit_price: Number(e.target.value) })}
                      />
                      {/* 分几刀平掉的腿：更早平掉的刀维持实际成交、按各自时刻平仓，这里列出来；
                          平仓价 / 平仓时间两格改的是最后那一刻平掉的全部（含同一时刻一起平掉的刀）。 */}
                      {earlierCuts(leg).length > 0 && (
                        <div
                          data-testid={`counterfactual-leg-cuts-${leg.id}`}
                          className="mt-1 text-[10px] leading-4 text-muted-foreground"
                          title="这条腿实际分几刀平掉：更早平掉的刀按实际成交还原，平仓价与平仓时间两格只改最后那一刻平掉的部分。"
                        >
                          另有 {earlierCuts(leg).length} 刀先平：
                          {earlierCuts(leg)
                            .map(cut => `${formatCounterfactualStamp(cut.close_time)} @ ${cut.exit_price}`)
                            .join('；')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        className="h-8 text-[11px]"
                        value={leg.size_usdt}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { size_usdt: Number(e.target.value) })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedManualLegId(leg.id);
                          updateManualLeg(leg.id, { enabled: !leg.enabled });
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground mr-3"
                      >
                        {leg.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setManualLegs(prev => prev.filter(item => item.id !== leg.id));
                          if (selectedManualLegId === leg.id) setSelectedManualLegId(null);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-[#F6465D]/10 hover:text-[#F6465D]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {manualLegs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-5 text-center text-[12px] text-muted-foreground">
                    还没有可模拟的 leg。先点“增添”，或回到归类页补全 Legs。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 方案名输入按用户要求隐藏：分支名在页面反事实结果行左栏的「相对原始的变化情况」卡片里起（CounterfactualOverviewRow），默认来自改动摘要；label/setLabel 留着以备恢复。 */}
      </div>
    </div>
  );
}
