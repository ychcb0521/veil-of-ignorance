import type { KlineData } from '@/hooks/useBinanceData';
import {
  computeCampaignPnlPathExtremes,
  computeInitialExpectedMaxDrawdownPct,
  computeInitialExpectedMaxLoss,
  computeInitialMainExposureNotional,
  computeSopDeviation,
  resolveCampaignEquityPathLegFacts,
  resolveInitialExposureLegAttribution,
  resolveMainRiskAnchorEntryPrice,
  type CampaignLocalOrderFacts,
  type CampaignPnlPathLeg,
  type Deduction,
  type SopDeviationResult,
} from '@/lib/campaignAnalysis';
import {
  resolveLegExecution,
  type LegExitPriceCorrection,
  type LegExitPriceCorrections,
} from '@/lib/campaignLegExecution';
import { isCampaignResolved, resolveCampaignMainLeverage } from '@/lib/campaignMetrics';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';
import {
  closingSettlementRecord,
  computeCampaignRealizedPnl,
  legExitPriceCorrectionDelta,
  reconcileCampaignWithSettlement,
} from '@/lib/campaignRealizedPnl';
import { getCoinContractSizeUsd, getCoinContracts, roundCoinContracts } from '@/lib/coinMargined';
import { isLiquidationRecord, liquidationPnlFloorUsd } from '@/lib/liquidationRecord';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import { tradeRecordFees } from '@/lib/tradeFees';
import { resolveLegExecutionMethodEvidence } from '@/lib/legExecutionMethod';
import { getPositionNotionalUsd, getSettlementFeeParts } from '@/lib/tradingSettlement';
import {
  INITIAL_HEDGE_SIZE_PCT,
  MIRROR_TP_REDUCTION_PCT,
} from '@/lib/strategyTemplates';
import {
  isHistoricalCampaign,
  type CampaignCounterfactualChangeSummary,
  type CampaignCounterfactualEvent,
  type CampaignCounterfactualLegSummary,
  type CampaignCounterfactualManualLeg,
  type CampaignCounterfactualManualLegActual,
  type CampaignCounterfactualManualLegCut,
  type CampaignCounterfactualParams,
  type CampaignCounterfactualResult,
  type CampaignCounterfactualRiskContext,
  type CampaignCounterfactualStateSegment,
  type DeviationCost,
  type TradeCampaign,
  type TradeJournal,
} from '@/types/journal';
import { TAKER_FEE, type CampaignReverseHedgeOrder, type TradeRecord } from '@/types/trading';

const EPSILON = 0.000001;
const DEFAULT_ACCOUNT_SIZE = 10_000;

export type SupportedTemplate = 'main_dual_hedge_mirror_tp' | 'main_only';

/**
 * 战役模板 → 推演模板：只有 main_only 走「无保护线」路径，其余（含 custom）一律按双向对冲 + 镜像止盈。
 * 运行时选引擎、事后为老行重算风险锚都用这一条，否则 main_only 的老 SOP 行会被默认模板凭空造出一条止损线。
 */
export function counterfactualTemplateFor(campaign: Pick<TradeCampaign, 'strategy_template'>): SupportedTemplate {
  return campaign.strategy_template === 'main_only' ? 'main_only' : 'main_dual_hedge_mirror_tp';
}
type Direction = CampaignCounterfactualParams['entry']['direction'];
type ExitRule = CampaignCounterfactualParams['exit_rule'];
type StateName = 'state_0_setup' | 'state_1_lockin' | 'state_2_rolling' | 'state_3_exit';
type LegStatus = 'pending' | 'filled' | 'cancelled' | 'never_triggered';
type LegRole =
  | 'main_open'
  | 'hedge_initial_a'
  | 'hedge_initial_b'
  | 'hedge_rolling'
  | 'mirror_tp'
  | 'reentry_main';

interface SimulationLeg {
  id: string;
  role: LegRole;
  kind: 'main' | 'hedge' | 'mirror_tp';
  placedAt: string;
  triggerPrice: number;
  sizeUsdt: number;
  status: LegStatus;
  triggeredAt: string | null;
  fillPrice: number | null;
  realizedPnlUsdt: number;
  cycle: number;
  /** 手动腿自带的杠杆；SOP 推演腿不设，合成腿退回 entry.leverage。 */
  leverage?: number;
}

interface ActivePosition {
  role: 'main' | 'hedge';
  legId: string;
  side: Direction;
  entryPrice: number;
  sizeUsdt: number;
  leverage: number;
  openedAt: string;
}

interface SimulationState {
  template: SupportedTemplate;
  params: CampaignCounterfactualParams;
  events: CampaignCounterfactualEvent[];
  legs: SimulationLeg[];
  activeMain: ActivePosition | null;
  activeHedges: ActivePosition[];
  currentState: StateName;
  stateStartedAtMs: number;
  stateSegments: CampaignCounterfactualStateSegment[];
  realizedPnl: number;
  peakEquity: number;
  troughEquity: number;
  lastRollTimeMs: number | null;
  lastRollBasePrice: number;
  cycle: number;
  nextReentryAtMs: number | null;
  pendingReentrySizeUsdt: number | null;
  reentryCount: number;
}

export interface CampaignDeviationCostInput {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  account_size_usdt?: number | null;
}

export interface ActualCampaignEconomicResult {
  final_realized_pnl: number;
  account_size_usdt?: number | null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toIso(timeMs: number) {
  return new Date(timeMs).toISOString();
}

function getStateLabel(state: StateName) {
  if (state === 'state_0_setup') return '完整结构';
  if (state === 'state_1_lockin') return '已锁定不亏';
  if (state === 'state_2_rolling') return '滚动跟随';
  return '已退场';
}

function directionToCampaign(direction: Direction): TradeCampaign['direction'] {
  return direction === 'long' ? 'main_long' : 'main_short';
}

function oppositeDirection(direction: Direction): Direction {
  return direction === 'long' ? 'short' : 'long';
}

function pnlForClose(direction: Direction, entryPrice: number, exitPrice: number, sizeUsdt: number, _leverage: number) {
  const sign = direction === 'long' ? 1 : -1;
  // sizeUsdt 是「名义仓位」(entryPrice×quantity)。绝对盈亏(USDT) = 价格变动比例 × 名义仓位；
  // 杠杆只决定所需保证金与 ROE，不放大绝对盈亏，故不乘 leverage（与实盘引擎 calcUnrealizedPnl 同一口径）。
  return (exitPrice - entryPrice) * sign * sizeUsdt / entryPrice;
}

function unrealizedForPosition(position: ActivePosition, markPrice: number) {
  return pnlForClose(position.side, position.entryPrice, markPrice, position.sizeUsdt, position.leverage);
}

function priceFromOffset(basePrice: number, offsetPct: number) {
  return basePrice * (1 + offsetPct / 100);
}

function findStartIndex(klines: KlineData[], entryTimeMs: number) {
  if (klines.length === 0) return -1;
  const index = klines.findIndex((kline, idx) => {
    const nextTime = klines[idx + 1]?.time ?? Number.POSITIVE_INFINITY;
    return kline.time <= entryTimeMs && entryTimeMs < nextTime;
  });
  if (index !== -1) return index;
  return entryTimeMs < klines[0].time ? 0 : -1;
}

function triggerMatches(direction: Direction, kind: 'hedge' | 'mirror_tp', kline: KlineData, triggerPrice: number) {
  if (kind === 'mirror_tp') {
    return direction === 'long'
      ? kline.high >= triggerPrice
      : kline.low <= triggerPrice;
  }
  return direction === 'long'
    ? kline.low <= triggerPrice
    : kline.high >= triggerPrice;
}

function favorableMovePct(direction: Direction, currentPrice: number, basePrice: number) {
  if (basePrice <= 0) return 0;
  return direction === 'long'
    ? ((currentPrice - basePrice) / basePrice) * 100
    : ((basePrice - currentPrice) / basePrice) * 100;
}

function makeLegId(role: LegRole, cycle: number, index: number) {
  return `${role}-${cycle}-${index}`;
}

function pushEvent(state: SimulationState, event: CampaignCounterfactualEvent) {
  state.events.push({
    ...event,
    price: round(event.price),
    size_usdt: round(event.size_usdt),
  });
}

function transitionState(state: SimulationState, nextState: StateName, timestampMs: number) {
  if (nextState === state.currentState) return;
  if (timestampMs > state.stateStartedAtMs) {
    state.stateSegments.push({
      state: state.currentState,
      state_label: getStateLabel(state.currentState),
      start_time: toIso(state.stateStartedAtMs),
      end_time: toIso(timestampMs),
    });
  }
  state.currentState = nextState;
  state.stateStartedAtMs = timestampMs;
}

function finalizeStateSegments(state: SimulationState, endTimeMs: number) {
  const segmentEnd = Math.max(endTimeMs, state.stateStartedAtMs);
  state.stateSegments.push({
    state: state.currentState,
    state_label: getStateLabel(state.currentState),
    start_time: toIso(state.stateStartedAtMs),
    end_time: toIso(segmentEnd),
  });
}

function registerSetupLegs(
  state: SimulationState,
  atTimeMs: number,
  entryPrice: number,
  mainSizeUsdt: number,
  cycle: number,
) {
  if (state.template === 'main_only') return;
  const atIso = toIso(atTimeMs);
  const existingCount = state.legs.length;
  const hedgeA: SimulationLeg = {
    id: makeLegId('hedge_initial_a', cycle, existingCount + 1),
    role: 'hedge_initial_a',
    kind: 'hedge',
    placedAt: atIso,
    triggerPrice: priceFromOffset(entryPrice, state.params.hedge_a.offset_pct),
    sizeUsdt: mainSizeUsdt * state.params.hedge_a.size_pct / 100,
    status: 'pending',
    triggeredAt: null,
    fillPrice: null,
    realizedPnlUsdt: 0,
    cycle,
  };
  const hedgeB: SimulationLeg = {
    id: makeLegId('hedge_initial_b', cycle, existingCount + 2),
    role: 'hedge_initial_b',
    kind: 'hedge',
    placedAt: atIso,
    triggerPrice: priceFromOffset(entryPrice, state.params.hedge_b.offset_pct),
    sizeUsdt: mainSizeUsdt * state.params.hedge_b.size_pct / 100,
    status: 'pending',
    triggeredAt: null,
    fillPrice: null,
    realizedPnlUsdt: 0,
    cycle,
  };
  const mirrorTp: SimulationLeg = {
    id: makeLegId('mirror_tp', cycle, existingCount + 3),
    role: 'mirror_tp',
    kind: 'mirror_tp',
    placedAt: atIso,
    triggerPrice: priceFromOffset(entryPrice, state.params.mirror_tp.offset_pct),
    sizeUsdt: mainSizeUsdt * state.params.mirror_tp.size_pct / 100,
    status: 'pending',
    triggeredAt: null,
    fillPrice: null,
    realizedPnlUsdt: 0,
    cycle,
  };
  state.legs.push(hedgeA, hedgeB, mirrorTp);
  pushEvent(state, {
    timestamp: atIso,
    event_type: 'hedge_placed',
    leg_role: hedgeA.role,
    price: hedgeA.triggerPrice,
    size_usdt: hedgeA.sizeUsdt,
    notes: '初始对冲 A 已挂出',
  });
  pushEvent(state, {
    timestamp: atIso,
    event_type: 'hedge_placed',
    leg_role: hedgeB.role,
    price: hedgeB.triggerPrice,
    size_usdt: hedgeB.sizeUsdt,
    notes: '初始对冲 B 已挂出',
  });
  pushEvent(state, {
    timestamp: atIso,
    event_type: 'mirror_tp_placed',
    leg_role: mirrorTp.role,
    price: mirrorTp.triggerPrice,
    size_usdt: mirrorTp.sizeUsdt,
    notes: '镜像止盈已挂出',
  });
}

function placeMainPosition(
  state: SimulationState,
  atTimeMs: number,
  entryPrice: number,
  sizeUsdt: number,
  role: 'main_open' | 'reentry_main',
) {
  const leg: SimulationLeg = {
    id: makeLegId(role, state.cycle, state.legs.length + 1),
    role,
    kind: 'main',
    placedAt: toIso(atTimeMs),
    triggerPrice: entryPrice,
    sizeUsdt,
    status: 'filled',
    triggeredAt: toIso(atTimeMs),
    fillPrice: entryPrice,
    realizedPnlUsdt: 0,
    cycle: state.cycle,
  };
  state.legs.push(leg);
  state.activeMain = {
    role: 'main',
    legId: leg.id,
    side: state.params.entry.direction,
    entryPrice,
    sizeUsdt,
    leverage: state.params.entry.leverage,
    openedAt: toIso(atTimeMs),
  };
  pushEvent(state, {
    timestamp: toIso(atTimeMs),
    event_type: role === 'main_open' ? 'main_opened' : 'reentry_main_opened',
    leg_role: role,
    price: entryPrice,
    size_usdt: sizeUsdt,
    notes: role === 'main_open' ? '主仓建立' : '按 reentry 规则重建主仓',
  });
}

function cancelPendingLeg(state: SimulationState, leg: SimulationLeg, timestampMs: number, notes: string) {
  if (leg.status !== 'pending') return;
  leg.status = 'cancelled';
  pushEvent(state, {
    timestamp: toIso(timestampMs),
    event_type: 'hedge_cancelled',
    leg_role: leg.role,
    price: leg.triggerPrice,
    size_usdt: leg.sizeUsdt,
    notes,
  });
}

function closeMain(state: SimulationState, exitPrice: number, timestampMs: number, notes: string) {
  if (!state.activeMain) return;
  const pnl = pnlForClose(
    state.activeMain.side,
    state.activeMain.entryPrice,
    exitPrice,
    state.activeMain.sizeUsdt,
    state.activeMain.leverage,
  );
  state.realizedPnl += pnl;
  const mainLeg = state.legs.find(leg => leg.id === state.activeMain?.legId);
  if (mainLeg) {
    mainLeg.realizedPnlUsdt += pnl;
  }
  pushEvent(state, {
    timestamp: toIso(timestampMs),
    event_type: 'main_fully_closed',
    leg_role: mainLeg?.role ?? 'main_open',
    price: exitPrice,
    size_usdt: state.activeMain.sizeUsdt,
    notes,
  });
  state.activeMain = null;
}

function closeAllActiveHedges(state: SimulationState, exitPrice: number, timestampMs: number, notes: string) {
  if (state.activeHedges.length === 0) return;
  for (const hedge of state.activeHedges) {
    const pnl = pnlForClose(hedge.side, hedge.entryPrice, exitPrice, hedge.sizeUsdt, hedge.leverage);
    state.realizedPnl += pnl;
    const leg = state.legs.find(item => item.id === hedge.legId);
    if (leg) leg.realizedPnlUsdt += pnl;
    pushEvent(state, {
      timestamp: toIso(timestampMs),
      event_type: 'hedge_closed',
      leg_role: leg?.role ?? 'hedge_rolling',
      price: exitPrice,
      size_usdt: hedge.sizeUsdt,
      notes,
    });
  }
  state.activeHedges = [];
}

function triggerMirrorTp(state: SimulationState, mirrorLeg: SimulationLeg, timestampMs: number) {
  if (!state.activeMain) return;
  const closeSizeUsdt = Math.min(
    state.activeMain.sizeUsdt,
    state.activeMain.sizeUsdt * state.params.mirror_tp.size_pct / 100,
  );
  if (closeSizeUsdt <= EPSILON) {
    mirrorLeg.status = 'cancelled';
    return;
  }
  const pnl = pnlForClose(
    state.activeMain.side,
    state.activeMain.entryPrice,
    mirrorLeg.triggerPrice,
    closeSizeUsdt,
    state.activeMain.leverage,
  );
  state.realizedPnl += pnl;
  mirrorLeg.status = 'filled';
  mirrorLeg.triggeredAt = toIso(timestampMs);
  mirrorLeg.fillPrice = mirrorLeg.triggerPrice;
  mirrorLeg.realizedPnlUsdt += pnl;
  state.activeMain.sizeUsdt = Math.max(0, state.activeMain.sizeUsdt - closeSizeUsdt);
  pushEvent(state, {
    timestamp: toIso(timestampMs),
    event_type: 'mirror_tp_triggered',
    leg_role: 'mirror_tp',
    price: mirrorLeg.triggerPrice,
    size_usdt: closeSizeUsdt,
    notes: '镜像止盈成交，主仓部分锁利',
  });
  pushEvent(state, {
    timestamp: toIso(timestampMs),
    event_type: 'main_partial_closed',
    leg_role: 'main_open',
    price: mirrorLeg.triggerPrice,
    size_usdt: closeSizeUsdt,
    notes: '镜像止盈带来主仓部分平仓',
  });
  const hedgeB = state.legs.find(leg => leg.role === 'hedge_initial_b' && leg.cycle === mirrorLeg.cycle && leg.status === 'pending') ?? null;
  if (hedgeB) {
    cancelPendingLeg(state, hedgeB, timestampMs, 'mirror_tp 成交后按 SOP 取消 hedge_b');
  }
  transitionState(state, 'state_1_lockin', timestampMs);
}

function fillHedgePosition(state: SimulationState, hedgeLeg: SimulationLeg, timestampMs: number) {
  if (!state.activeMain) return;
  hedgeLeg.status = 'filled';
  hedgeLeg.triggeredAt = toIso(timestampMs);
  hedgeLeg.fillPrice = hedgeLeg.triggerPrice;
  state.activeHedges.push({
    role: 'hedge',
    legId: hedgeLeg.id,
    side: oppositeDirection(state.activeMain.side),
    entryPrice: hedgeLeg.triggerPrice,
    sizeUsdt: hedgeLeg.sizeUsdt,
    leverage: state.activeMain.leverage,
    openedAt: toIso(timestampMs),
  });
  pushEvent(state, {
    timestamp: toIso(timestampMs),
    event_type: 'hedge_triggered',
    leg_role: hedgeLeg.role,
    price: hedgeLeg.triggerPrice,
    size_usdt: hedgeLeg.sizeUsdt,
    notes: '对冲成交',
  });
}

function processHedgeTrigger(state: SimulationState, hedgeLeg: SimulationLeg, timestampMs: number) {
  if (!state.activeMain) return;
  fillHedgePosition(state, hedgeLeg, timestampMs);
  const exitRule: ExitRule = state.params.exit_rule;
  if (exitRule === 'manual_only') return;

  const currentMainSize = state.activeMain.sizeUsdt;
  closeMain(state, hedgeLeg.triggerPrice, timestampMs, 'hedge 触发后按 exit_rule 平主仓');

  const pendingOthers = state.legs.filter(leg => leg.kind !== 'main' && leg.id !== hedgeLeg.id && leg.status === 'pending');
  for (const otherLeg of pendingOthers) {
    cancelPendingLeg(state, otherLeg, timestampMs, 'hedge 触发后取消其余挂单');
  }
  closeAllActiveHedges(state, hedgeLeg.triggerPrice, timestampMs, 'exit_rule 触发，清掉活跃对冲');
  transitionState(state, 'state_3_exit', timestampMs);

  if (exitRule === 'reenter_after_hedge_trigger' && state.params.reentry) {
    state.nextReentryAtMs = timestampMs + state.params.reentry.delay_minutes * 60_000;
    state.pendingReentrySizeUsdt = currentMainSize * state.params.reentry.size_pct / 100;
  } else {
    state.nextReentryAtMs = null;
    state.pendingReentrySizeUsdt = null;
  }
}

function processRollingIfNeeded(state: SimulationState, kline: KlineData) {
  if (!state.activeMain) return;
  if (!state.params.rolling.enabled) return;
  if (state.currentState !== 'state_1_lockin' && state.currentState !== 'state_2_rolling') return;
  const elapsed = state.lastRollTimeMs == null ? Number.POSITIVE_INFINITY : (kline.time - state.lastRollTimeMs) / 60_000;
  if (elapsed < state.params.rolling.min_interval_minutes) return;
  const favorableMove = favorableMovePct(state.activeMain.side, kline.close, state.lastRollBasePrice);
  if (favorableMove < state.params.rolling.trigger_rise_pct) return;
  const oldHedge = [...state.legs]
    .reverse()
    .find(leg => leg.kind === 'hedge' && leg.status === 'pending') ?? null;
  if (!oldHedge) return;
  cancelPendingLeg(state, oldHedge, kline.time, '滚动触发，取消旧 hedge');
  const newHedge: SimulationLeg = {
    id: makeLegId('hedge_rolling', state.cycle, state.legs.length + 1),
    role: 'hedge_rolling',
    kind: 'hedge',
    placedAt: toIso(kline.time),
    triggerPrice: priceFromOffset(kline.close, state.params.rolling.new_hedge_offset_pct),
    sizeUsdt: state.activeMain.sizeUsdt * state.params.rolling.rolling_hedge_size_pct / 100,
    status: 'pending',
    triggeredAt: null,
    fillPrice: null,
    realizedPnlUsdt: 0,
    cycle: state.cycle,
  };
  state.legs.push(newHedge);
  pushEvent(state, {
    timestamp: toIso(kline.time),
    event_type: 'hedge_placed',
    leg_role: newHedge.role,
    price: newHedge.triggerPrice,
    size_usdt: newHedge.sizeUsdt,
    notes: '滚动 hedge 已挂出',
  });
  state.lastRollTimeMs = kline.time;
  state.lastRollBasePrice = kline.close;
  transitionState(state, 'state_2_rolling', kline.time);
}

function updateEquityExtremes(state: SimulationState, markPrice: number) {
  let unrealized = 0;
  if (state.activeMain) unrealized += unrealizedForPosition(state.activeMain, markPrice);
  for (const hedge of state.activeHedges) unrealized += unrealizedForPosition(hedge, markPrice);
  const equity = state.realizedPnl + unrealized;
  state.peakEquity = Math.max(state.peakEquity, equity);
  state.troughEquity = Math.min(state.troughEquity, equity);
}

function finalizeOpenPositions(state: SimulationState, lastKline: KlineData) {
  if (state.activeMain) {
    closeMain(state, lastKline.close, lastKline.time, '数据结束，按最后一根 close 强制平仓');
  }
  closeAllActiveHedges(state, lastKline.close, lastKline.time, '数据结束，强制平掉活跃对冲');
  const pendingLegs = state.legs.filter(leg => leg.status === 'pending');
  for (const leg of pendingLegs) {
    leg.status = 'cancelled';
    pushEvent(state, {
      timestamp: toIso(lastKline.time),
      event_type: leg.kind === 'mirror_tp' ? 'mirror_tp_cancelled' : 'hedge_cancelled',
      leg_role: leg.role,
      price: leg.triggerPrice,
      size_usdt: leg.sizeUsdt,
      notes: '战役结束，未触发挂单统一取消',
    });
  }
  transitionState(state, 'state_3_exit', lastKline.time);
}

function buildSyntheticCampaignAndLegs(
  params: CampaignCounterfactualParams,
  template: SupportedTemplate,
  result: Omit<CampaignCounterfactualResult, 'sop_score'>,
  events: CampaignCounterfactualEvent[],
  legs: SimulationLeg[],
): { campaign: TradeCampaign; legs: TradeJournal[] } {
  const closedAt = result.events[result.events.length - 1]?.timestamp ?? params.entry.time;
  const syntheticCampaign: TradeCampaign = {
    id: 'synthetic-campaign',
    user_id: 'synthetic-user',
    campaign_code: 'C-SYNTHETIC',
    symbol: 'SIM',
    direction: directionToCampaign(params.entry.direction),
    status: result.final_realized_pnl > 0 ? 'closed_profit' : result.final_realized_pnl < 0 ? 'closed_loss' : 'closed_breakeven',
    strategy_template: template,
    title: 'Synthetic Counterfactual',
    opened_at: params.entry.time,
    closed_at: closedAt,
    initial_main_size_usdt: params.entry.size_usdt,
    initial_leverage: params.entry.leverage,
    final_realized_pnl: result.final_realized_pnl,
    final_r_multiple: result.final_r_multiple,
    peak_unrealized_pnl: result.peak_unrealized_pnl,
    peak_drawdown: result.peak_drawdown,
    importance_weight: 0,
    notes: null,
    actual_evolution: events.map((event, index) => ({
      id: `synthetic-event-${index + 1}`,
      timestamp: event.timestamp,
      event_type: event.event_type as TradeCampaign['actual_evolution'][number]['event_type'],
      leg_role: event.leg_role === 'none' ? null : event.leg_role as TradeCampaign['actual_evolution'][number]['leg_role'],
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: event.price,
      size_usdt: event.size_usdt,
      notes: event.notes,
      recorded_at: event.timestamp,
    })),
    deviation_notes: {},
    deleted_at: null,
    created_at: params.entry.time,
    updated_at: closedAt,
  };

  const syntheticLegs: TradeJournal[] = legs.map((leg, index) => ({
    id: `synthetic-leg-${index + 1}`,
    user_id: syntheticCampaign.user_id,
    trade_record_id: null,
    campaign_id: syntheticCampaign.id,
    leg_role: leg.role,
    leg_sequence: index + 1,
    symbol: syntheticCampaign.symbol,
    direction: params.entry.direction,
    leverage: leg.leverage ?? params.entry.leverage,
    position_mode: 'isolated',
    order_kind: leg.kind === 'main' ? 'main' : 'hedge',
    pre_simulated_time: leg.placedAt,
    pre_real_time: leg.placedAt,
    pre_entry_price: leg.triggerPrice,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: 'synthetic',
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: true,
    pre_position_size: leg.sizeUsdt,
    pre_max_loss_usdt: null,
    post_outcome: null,
    post_realized_pnl: null,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    reason_was_rewritten: false,
    counterfactual_branches: [],
    post_error_scenario: null,
    post_original_hypothesis: null,
    post_reality_feedback: null,
    post_error_type_summary: null,
    post_real_problem: null,
    post_new_rule_draft: null,
    deep_analysis_completed_at: null,
    created_at: leg.placedAt,
    updated_at: leg.triggeredAt ?? leg.placedAt,
  }));

  return { campaign: syntheticCampaign, legs: syntheticLegs };
}

/**
 * 反事实分支的四个风险锚，与战役页「盈亏概览」逐项同口径：
 * L（最大预期亏损）、主力开仓名义仓位、预期回撤 d、主力杠杆。
 * 全部从合成战役 + 合成腿上用战役页同一批函数算出，不另写公式。
 */
export interface CounterfactualRiskAnchors {
  initialExpectedMaxLoss: number;
  initialMainExposureNotional: number;
  expectedMaxDrawdownPct: number;
  mainLeverage: number | null;
}

const ZERO_RISK_ANCHORS: CounterfactualRiskAnchors = {
  initialExpectedMaxLoss: 0,
  initialMainExposureNotional: 0,
  expectedMaxDrawdownPct: 0,
  mainLeverage: null,
};

interface RiskAnchorSynthetic {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  /** 手动 Legs 分支为有成交记录的腿造的同形记录（持仓窗口、归属时刻、开仓名义）；SOP 推演没有。 */
  records?: TradeRecord[];
}

function riskAnchorsFromSynthetic(
  synthetic: RiskAnchorSynthetic,
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): CounterfactualRiskAnchors {
  const records = synthetic.records ?? [];
  return {
    initialExpectedMaxLoss: computeInitialExpectedMaxLoss(synthetic.campaign, synthetic.legs, records, reverseHedgeOrders),
    initialMainExposureNotional: computeInitialMainExposureNotional(synthetic.campaign, synthetic.legs, records),
    expectedMaxDrawdownPct: computeInitialExpectedMaxDrawdownPct(synthetic.campaign, synthetic.legs, records, reverseHedgeOrders),
    mainLeverage: resolveCampaignMainLeverage(synthetic.campaign, synthetic.legs, records),
  };
}

function positivePrice(value: number | null | undefined): number | null {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

/**
 * 手动 Legs 分支的风险锚上下文：战役页算 L / 预期回撤时除了腿，还读这场战役的反向保护委托
 * （历史归类的战役只认委托快照），以及事件流里带价的初始对冲事件（某个角色一条腿都锚不出价时的兜底）。
 * 两样都没有时不影响 L，返回 undefined（不落库）。页面在「一键运行」时附到 params 上，老行没有。
 */
export function buildCounterfactualRiskContext(
  campaign: Pick<TradeCampaign, 'actual_evolution'>,
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
): CampaignCounterfactualRiskContext | undefined {
  const reverseOrders = reverseHedgeOrders
    .filter(order => Number.isFinite(order.price) && order.price > 0 && Number.isFinite(order.createdAt))
    .map(order => ({
      id: order.id,
      side: order.side,
      price: order.price,
      fill_price: Number.isFinite(order.fillPrice) ? Number(order.fillPrice) : null,
      created_at: order.createdAt,
    }));
  const events = campaign.actual_evolution ?? [];
  // 两个价都原样抄下（取哪一个、门槛多少由战役页的函数自己决定），只滤掉两个都不是正数的。
  const hedgeEvents = events.flatMap(event => {
    const price = positivePrice(event.price);
    const entryPrice = positivePrice(event.entry_price);
    return event.leg_role != null && INITIAL_HEDGE_LEG_ROLES.has(event.leg_role)
      && (price != null || entryPrice != null)
      && Number.isFinite(new Date(event.timestamp).getTime())
      ? [{
        timestamp: event.timestamp,
        role: event.leg_role as 'hedge_initial_a' | 'hedge_initial_b',
        price,
        ...(entryPrice != null ? { entry_price: entryPrice } : {}),
      }]
      : [];
  });
  if (reverseOrders.length === 0 && hedgeEvents.length === 0) return undefined;
  const initialOrders = reverseOrders.length === 0 ? [] : events.flatMap(event => (
    event.pending_order_id && (event.leg_role === 'hedge_initial_a' || event.leg_role === 'hedge_initial_b')
      ? [{ id: event.pending_order_id, role: event.leg_role }]
      : []
  ));
  return {
    historical: reverseOrders.length > 0 && isHistoricalCampaign(campaign),
    initial_orders: initialOrders,
    reverse_orders: reverseOrders,
    ...(hedgeEvents.length > 0 ? { hedge_events: hedgeEvents } : {}),
  };
}

/**
 * 真实战役此刻按页面的规则算不算「已了结」：结算套回战役行（reconcileCampaignWithSettlement）之后，
 * 状态是已结束、且已实现有数——与详情页、列表页的机会质量门槛同一条。
 * 页面在「一键运行」时记到 params.actual_resolved 上。
 */
export function resolveCounterfactualActualResolved(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  exitPriceCorrections: LegExitPriceCorrections = {},
): boolean {
  const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, exitPriceCorrections);
  return isCampaignResolved(reconcileCampaignWithSettlement(campaign, legs, settlement));
}

function riskContextReverseOrders(context: CampaignCounterfactualRiskContext | undefined): CampaignReverseHedgeOrder[] {
  return (context?.reverse_orders ?? []).map(order => ({
    id: order.id,
    side: order.side,
    price: order.price,
    fillPrice: order.fill_price,
    createdAt: order.created_at,
    cancelledAt: null,
    status: 'cancelled',
  }));
}

/** 把风险锚上下文还原进合成战役的事件流：历史归类标记、标成初始对冲 A/B 的委托 id、带价的初始对冲事件。 */
function withRiskContextEvents<T extends RiskAnchorSynthetic>(
  synthetic: T,
  context: CampaignCounterfactualRiskContext | undefined,
): T {
  if (!context) return synthetic;
  const stamp = synthetic.campaign.opened_at;
  const extra: TradeCampaign['actual_evolution'] = [
    ...(context.historical ? [{
      id: 'synthetic-risk-historical',
      timestamp: stamp,
      event_type: 'historical_classification_created' as const,
      leg_role: null,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: null,
      size_usdt: null,
      notes: null,
      recorded_at: stamp,
    }] : []),
    ...context.initial_orders.map((order, index) => ({
      id: `synthetic-risk-order-${index + 1}`,
      timestamp: stamp,
      event_type: 'hedge_placed' as const,
      leg_role: order.role,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: order.id,
      price: null,
      size_usdt: null,
      notes: null,
      recorded_at: stamp,
    })),
    ...(context.hedge_events ?? []).map((item, index) => ({
      id: `synthetic-risk-hedge-event-${index + 1}`,
      timestamp: item.timestamp,
      event_type: 'hedge_placed' as const,
      leg_role: item.role,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: item.price,
      ...(item.entry_price != null ? { entry_price: item.entry_price } : {}),
      size_usdt: null,
      notes: null,
      recorded_at: item.timestamp,
    })),
  ];
  if (extra.length === 0) return synthetic;
  return {
    ...synthetic,
    campaign: { ...synthetic.campaign, actual_evolution: [...synthetic.campaign.actual_evolution, ...extra] },
  };
}

/**
 * 结果里 L、名义、d 与手动分支已实现的落库精度。盈亏比 = 已实现 ÷ L：L 只有几美元时，
 * 按 4 位小数取整就足以让重跑的盈亏比与战役页差出 0.01 个百分点以上。
 */
const RESULT_AMOUNT_DIGITS = 8;

/** 把锚写成结果上的落库字段。 */
function riskAnchorResultFields(anchors: CounterfactualRiskAnchors) {
  return {
    initial_expected_max_loss: round(anchors.initialExpectedMaxLoss, RESULT_AMOUNT_DIGITS),
    initial_main_exposure_notional: round(anchors.initialMainExposureNotional, RESULT_AMOUNT_DIGITS),
    expected_max_drawdown_pct: round(anchors.expectedMaxDrawdownPct, RESULT_AMOUNT_DIGITS),
    main_leverage: anchors.mainLeverage,
  };
}

function buildResultFromState(state: SimulationState): CampaignCounterfactualResult {
  const baseResult = {
    final_realized_pnl: round(state.realizedPnl),
    // 先占位；合成战役建好之后才拿得到 L（见下方 plannedMaxLoss）。
    // buildSyntheticCampaignAndLegs 只是把这个值抄进合成战役的同名字段，
    // 而 computeInitialExpectedMaxLoss 不读它，所以这层循环依赖是良性的。
    final_r_multiple: 0,
    peak_unrealized_pnl: round(Math.max(0, state.peakEquity)),
    peak_drawdown: round(Math.abs(Math.min(0, state.troughEquity))),
    profit_capture_ratio: state.peakEquity > EPSILON
      ? round(clamp((state.realizedPnl / state.peakEquity) * 100, -999, 999))
      : 0,
    events: [...state.events],
    legs_summary: state.legs.map<CampaignCounterfactualLegSummary>(leg => ({
      leg_role: leg.role,
      placed_at: leg.placedAt,
      trigger_price: round(leg.triggerPrice),
      status: leg.status === 'pending' ? 'never_triggered' : leg.status,
      triggered_at: leg.triggeredAt,
      realized_pnl_usdt: round(leg.realizedPnlUsdt),
    })),
    state_segments: [...state.stateSegments],
  };

  const synthetic = buildSyntheticCampaignAndLegs(state.params, state.template, baseResult, state.events, state.legs);
  const sop = computeSopDeviation(synthetic.campaign, synthetic.legs, []);

  /**
   * 反事实的 R 必须与战役页的 b **同一个口径**，否则两个数并排放在一起没有可比性。
   *
   * 原来这里自己写了一份 plannedMaxLoss，和 resolveMainRiskAnchors 差两处，
   * 而且两处**同向**地把 L 做小、把 R 做大：
   *   ① 敞口只取 entry.size_usdt，**不含归属它的镜像止盈**。
   *      SOP 镜像 = 主仓 60%，所以差 1.60 倍。
   *   ② 保护线取 Math.max(A, B)，多单时那是**离开仓价最近**的一条；
   *      resolveMainRiskAnchors 取的是**最远**那条（承担的风险以最宽的止损计）。
   *      SOP 的 −2% / −4% 就是 2.00 倍。
   * 合计 3.20 倍——同一笔盈亏，战役页 b = 0.73R，反事实分支能给出 2.3R。
   *
   * 合成战役与合成腿这里本来就要造（computeSopDeviation 要用），腿上带着
   * leg_role、pre_position_size、pre_entry_price，正好够锚出「M + 镜像」的敞口
   * 与最远那条保护线。直接复用它，口径就不可能再分叉。
   */
  const anchors = riskAnchorsFromSynthetic(synthetic);
  const plannedMaxLoss = anchors.initialExpectedMaxLoss;
  return {
    ...baseResult,
    final_r_multiple: plannedMaxLoss > EPSILON ? round(state.realizedPnl / plannedMaxLoss) : 0,
    sop_score: sop.score ?? 0,
    ...riskAnchorResultFields(anchors),
  };
}

function initialState(params: CampaignCounterfactualParams, template: SupportedTemplate): SimulationState {
  return {
    template,
    params,
    events: [],
    legs: [],
    activeMain: null,
    activeHedges: [],
    currentState: 'state_0_setup',
    stateStartedAtMs: new Date(params.entry.time).getTime(),
    stateSegments: [],
    realizedPnl: 0,
    peakEquity: 0,
    troughEquity: 0,
    lastRollTimeMs: new Date(params.entry.time).getTime(),
    lastRollBasePrice: params.entry.price,
    cycle: 0,
    nextReentryAtMs: null,
    pendingReentrySizeUsdt: null,
    reentryCount: 0,
  };
}

export function simulateCampaign(
  params: CampaignCounterfactualParams,
  klines: KlineData[],
  template: SupportedTemplate,
): CampaignCounterfactualResult {
  if (klines.length === 0) {
    return {
      final_realized_pnl: 0,
      final_r_multiple: 0,
      peak_unrealized_pnl: 0,
      peak_drawdown: 0,
      profit_capture_ratio: 0,
      events: [],
      legs_summary: [],
      state_segments: [],
      sop_score: 0,
    };
  }

  const startIndex = findStartIndex(klines, new Date(params.entry.time).getTime());
  if (startIndex === -1) {
    return {
      final_realized_pnl: 0,
      final_r_multiple: 0,
      peak_unrealized_pnl: 0,
      peak_drawdown: 0,
      profit_capture_ratio: 0,
      events: [],
      legs_summary: [],
      state_segments: [],
      sop_score: 0,
    };
  }

  const state = initialState(params, template);
  placeMainPosition(state, new Date(params.entry.time).getTime(), params.entry.price, params.entry.size_usdt, 'main_open');
  registerSetupLegs(state, new Date(params.entry.time).getTime(), params.entry.price, params.entry.size_usdt, state.cycle);
  updateEquityExtremes(state, params.entry.price);

  for (let i = startIndex; i < klines.length; i++) {
    const kline = klines[i];

    if (!state.activeMain && state.nextReentryAtMs != null && kline.time >= state.nextReentryAtMs && (state.pendingReentrySizeUsdt ?? 0) > EPSILON) {
      state.cycle += 1;
      state.reentryCount += 1;
      placeMainPosition(state, kline.time, kline.open, state.pendingReentrySizeUsdt!, 'reentry_main');
      registerSetupLegs(state, kline.time, kline.open, state.pendingReentrySizeUsdt!, state.cycle);
      state.lastRollTimeMs = kline.time;
      state.lastRollBasePrice = kline.open;
      state.nextReentryAtMs = null;
      state.pendingReentrySizeUsdt = null;
      transitionState(state, 'state_0_setup', kline.time);
    }

    const activeMain = state.activeMain;
    const pendingHedges = activeMain
      ? state.legs
          .filter((leg): leg is SimulationLeg => leg.kind === 'hedge' && leg.status === 'pending')
          .sort((a, b) => {
            if (activeMain.side === 'long') return b.triggerPrice - a.triggerPrice;
            return a.triggerPrice - b.triggerPrice;
          })
      : [];

    let hedgeConsumedCandle = false;
    for (const hedgeLeg of pendingHedges) {
      if (!state.activeMain) break;
      if (!triggerMatches(state.activeMain.side, 'hedge', kline, hedgeLeg.triggerPrice)) continue;
      processHedgeTrigger(state, hedgeLeg, kline.time);
      hedgeConsumedCandle = true;
      break;
    }

    if (!hedgeConsumedCandle && state.activeMain) {
      const mirrorLeg = state.legs.find(leg => leg.kind === 'mirror_tp' && leg.status === 'pending') ?? null;
      if (mirrorLeg && triggerMatches(state.activeMain.side, 'mirror_tp', kline, mirrorLeg.triggerPrice)) {
        triggerMirrorTp(state, mirrorLeg, kline.time);
      }
      processRollingIfNeeded(state, kline);
    }

    updateEquityExtremes(state, kline.close);
  }

  finalizeOpenPositions(state, klines[klines.length - 1]);
  finalizeStateSegments(state, klines[klines.length - 1].time);
  return buildResultFromState(state);
}

function validManualLeg(leg: CampaignCounterfactualManualLeg): boolean {
  return !!leg.enabled
    && Number.isFinite(leg.entry_price)
    && Number.isFinite(leg.exit_price)
    && Number.isFinite(leg.size_usdt)
    && Number.isFinite(leg.leverage)
    && leg.entry_price > 0
    && leg.exit_price > 0
    && leg.size_usdt > 0
    && new Date(leg.open_time).getTime() > 0
    && new Date(leg.close_time).getTime() > 0
    && new Date(leg.close_time).getTime() >= new Date(leg.open_time).getTime();
}

/** 手动腿按调整后开平价算出的**毛**盈亏（名义仓位 × 价格变动比例，不乘杠杆、不扣费）。 */
export function manualLegPnl(leg: CampaignCounterfactualManualLeg): number {
  return pnlForClose(
    leg.direction,
    leg.entry_price,
    leg.exit_price,
    leg.size_usdt,
    leg.leverage,
  );
}

/** 一条手动腿计入分支的钱，以及它在权益路径与风险锚上的样子。 */
export interface ManualLegEconomics {
  /** 计入已实现与权益路径（平仓之后）的净盈亏；未成交的腿为 0。 */
  netPnl: number;
  grossPnl: number;
  /**
   * 已从 netPnl 扣掉、且金额完整已知的平仓手续费（USD）。只剩快照 / 摊自战役级已实现的腿记 0：
   * 它们的平仓费含在实际盈亏里、金额未知，改动带来的平仓费变化（按 Taker 费率）只进 netPnl——
   * 把这一截差额单列进来，合计就成了「一部分腿的全额 + 另一部分腿的差额」，还可能是负数。
   */
  closeFeeUsdt: number;
  /** 开仓手续费（USD）：与实际战役一样不从已实现里扣，只作说明。 */
  openFeeUsdt: number;
  /** 手续费已含在盈亏里、但金额未知（只剩复盘快照的腿）：不计入上面两项。 */
  feesUnknown: boolean;
  basis: NonNullable<CampaignCounterfactualLegSummary['pnl_basis']>;
  /** 权益路径上的分段：每一刀一段。未成交的腿、成交时刻未知且没改开仓时间的腿为空。 */
  pathSegments: CampaignPnlPathLeg[];
  /**
   * 合成战役里这条腿的开仓名义（USD）：战役页分给它的那份开仓名义（actual.exposure_usdt，「仓位」一格改过则按比例缩放），
   * 没有这份份额的腿（没有成交分片、新增的腿）取「仓位」一格——与战役页退到 pre_position_size 同一口径。
   */
  exposureUsdt: number;
  /** 合成战役里这条腿的风险锚价（pre_entry_price）。 */
  anchorPrice: number;
}

const MANUAL_LEG_PRICE_EPSILON = 1e-9;

function samePrice(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= MANUAL_LEG_PRICE_EPSILON;
}

function sameInstant(a: string, b: string): boolean {
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

/**
 * 方向、开平时间、开平价、仓位都与实际成交一致。平仓时间只是副本给的兜底（结算没有计入的腿）时不比它：
 * 老行保存那一刻的 K 线窗口与现在不同，兜底值就不同，那不是改动。
 * 只用来标注这条腿的盈亏来历、以及老行补事实时判断「改没改」；钱数走 resolveManualLegEconomics。
 */
export function manualLegMatchesActual(
  leg: CampaignCounterfactualManualLeg,
): leg is CampaignCounterfactualManualLeg & { actual: CampaignCounterfactualManualLegActual } {
  const actual = leg.actual;
  if (!actual || !Number.isFinite(actual.realized_pnl_usdt)) return false;
  return leg.direction === actual.direction
    && sameInstant(leg.open_time, actual.open_time)
    && (actual.close_time_fallback === true || sameInstant(leg.close_time, actual.close_time))
    && samePrice(leg.entry_price, actual.entry_price)
    && samePrice(leg.exit_price, actual.exit_price)
    && samePrice(leg.size_usdt, actual.size_usdt);
}

/**
 * 模拟器自己的收费口径（getSettlementFeeParts，Taker）：U 本位 = 数量 × 成交价 × 费率，
 * 数量 = 名义 ÷ 开仓价；币本位 = 张数 × 面值 × 费率（按币收、按成交价折美元后价格约掉）。
 * 新增的腿、切成「已成交」的挂单没有实际记录可对，按调整后的价格整笔计费。
 */
export function manualLegFeeUsdt(leg: CampaignCounterfactualManualLeg, price: number): number {
  if (!(price > 0) || !(leg.entry_price > 0) || !(leg.size_usdt > 0)) return 0;
  const side = leg.direction === 'short' ? 'SHORT' as const : 'LONG' as const;
  const leverage = leg.leverage > 0 ? leg.leverage : 1;
  if (leg.settlement_mode === 'coin') {
    const contractSizeUsd = getCoinContractSizeUsd('', { contractSizeUsd: leg.contract_size_usd });
    const contracts = getCoinContracts({ contracts: leg.size_usdt / contractSizeUsd });
    return getSettlementFeeParts('', {
      side,
      quantity: contracts,
      contracts,
      contractSizeUsd,
      leverage,
      marginMode: 'isolated',
      settlementMode: 'coin',
    }, price, false).feeUsd;
  }
  return getSettlementFeeParts('', {
    side,
    quantity: leg.size_usdt / leg.entry_price,
    leverage,
    marginMode: 'isolated',
    settlementMode: 'usdt',
  }, price, false).feeUsd;
}

/** 给定费率的一笔手续费：U 本位 数量 × 价 × 费率；币本位 张数 × 面值 × 费率（与价格无关）。 */
function feeAtRate(sizeUsdt: number, entryPrice: number, price: number, rate: number, coinFaceUsd: number | null): number {
  if (!(price > 0) || !(entryPrice > 0) || !(sizeUsdt > 0) || !(rate > 0)) return 0;
  if (coinFaceUsd != null && coinFaceUsd > 0) return roundCoinContracts(sizeUsdt / coinFaceUsd) * coinFaceUsd * rate;
  return (sizeUsdt / entryPrice) * price * rate;
}

function coinFaceOf(leg: CampaignCounterfactualManualLeg): number | null {
  return leg.settlement_mode === 'coin'
    ? getCoinContractSizeUsd('', { contractSizeUsd: leg.contract_size_usd })
    : null;
}

function timeMsOr(value: string | null | undefined, fallback: number): number {
  const ms = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : fallback;
}

/**
 * 一条腿的各刀里「收盘那一组」的下标：与收盘那一刀同一时刻平掉的全部刀（并进同一个仓位、一起平掉的加仓也在其中）。
 * 平仓价、平仓时间两格改的是这一组；更早平掉的刀维持实际成交。
 */
export function closingCutIndexes(cuts: CampaignCounterfactualManualLegCut[]): Set<number> {
  const last = cuts.length - 1;
  if (last < 0) return new Set();
  const closeMs = new Date(cuts[last].close_time).getTime();
  const indexes = new Set<number>([last]);
  cuts.forEach((cut, index) => {
    if (index !== last && new Date(cut.close_time).getTime() === closeMs) indexes.add(index);
  });
  return indexes;
}

/** 收盘那一组之前平掉的刀（编辑器在平仓价下方列出「另有 N 刀先平」）。 */
export function earlierClosedCuts(actual: CampaignCounterfactualManualLegActual | undefined): CampaignCounterfactualManualLegCut[] {
  const cuts = actual?.cuts ?? [];
  const closing = closingCutIndexes(cuts);
  return cuts.filter((_cut, index) => !closing.has(index));
}

/**
 * 实际成交的各刀；没有分刀的整条腿算一刀。平仓费率：只剩复盘快照的腿不知道当时收了多少，按模拟器现行 Taker；
 * 记着平仓费的按 费 ÷ 平仓名义 倒推（与 tradeRecordFees 对老记录的读法一致），记着 0 的按 0。
 */
function actualCutsOf(
  actual: CampaignCounterfactualManualLegActual,
  coinFaceUsd: number | null,
): CampaignCounterfactualManualLegCut[] {
  if (actual.cuts && actual.cuts.length > 0) return actual.cuts;
  const closeNotional = coinFaceUsd != null
    ? actual.size_usdt
    : actual.entry_price > 0 ? (actual.size_usdt / actual.entry_price) * actual.exit_price : 0;
  const closeFeeRate = actual.close_fee_usdt == null
    ? TAKER_FEE
    : actual.close_fee_usdt > 0 && closeNotional > 0 ? actual.close_fee_usdt / closeNotional : 0;
  return [{
    open_time: actual.open_time,
    close_time: actual.close_time,
    entry_price: actual.entry_price,
    exit_price: actual.exit_price,
    size_usdt: actual.size_usdt,
    realized_pnl_usdt: actual.realized_pnl_usdt,
    close_fee_usdt: actual.close_fee_usdt ?? 0,
    close_fee_rate: closeFeeRate,
    open_fee_usdt: actual.open_fee_usdt,
    open_fee_rate: TAKER_FEE,
  }];
}

function pathSide(direction: CampaignCounterfactualManualLeg['direction']): CampaignPnlPathLeg['side'] {
  return direction === 'short' ? 'SHORT' : 'LONG';
}

/** 按调整后的开平价整笔算：毛盈亏 − 模拟器 Taker 平仓费。新增的腿、切成「已成交」的挂单、改过的未结算腿走这里。 */
function modelLegEconomics(
  leg: CampaignCounterfactualManualLeg,
  anchorPrice: number,
): ManualLegEconomics {
  const openMs = timeMsOr(leg.open_time, 0);
  const closeMs = Math.max(timeMsOr(leg.close_time, openMs), openMs);
  const grossPnl = manualLegPnl(leg);
  const closeFeeUsdt = manualLegFeeUsdt(leg, leg.exit_price);
  const netPnl = grossPnl - closeFeeUsdt;
  return {
    netPnl,
    grossPnl,
    closeFeeUsdt,
    openFeeUsdt: manualLegFeeUsdt(leg, leg.entry_price),
    feesUnknown: false,
    basis: 'model',
    pathSegments: [{
      side: pathSide(leg.direction),
      quantity: leg.size_usdt / leg.entry_price,
      entryPrice: leg.entry_price,
      startMs: openMs,
      endMs: closeMs,
      realizedPnl: netPnl,
    }],
    exposureUsdt: leg.size_usdt,
    anchorPrice,
  };
}

/**
 * 一条手动腿的钱怎么算——引擎、偏离代价、结果摘要共用这一处：
 *   · 未成交（filled === false）：不持有，一分钱不计；
 *   · 没有实际成交可对（新增的腿、切成「已成交」的挂单）：毛盈亏按开平价算，再按模拟器 Taker 费率扣平仓费；
 *   · 实际结算没有计入的腿（既无成交记录也无复盘快照，如尚未平仓）：没改记 0，改了才按上一条整笔算；
 *   · 有实际成交（成交记录 / 复盘快照 / 摊自战役级已实现）：从实际结算值出发，**只加上改动本身值多少钱**——
 *       每一刀 = 实际已实现 + [模型(改后这一刀) − 模型(实际这一刀)]，模型 = 毛盈亏 − 平仓费（按这一刀自己的费率）。
 *     没改的格子两边输入逐位相同，差额恰为 0，原样重跑逐分复现战役页；改了一格，挪动的恰是这一格值的钱。
 *     以前「一改就整条腿换成模型重算」：分几刀平掉的腿被抹成全仓平在最后一刀、老记录 0.04% 的费被换成 0.05%、
 *     滑点被抹掉——平仓价改 0.01，相对实际跳 −29.89，全是改动之外的差额。
 *   改动怎么落到各刀上：方向、开仓价（按比例）、开仓时间（平移）、仓位（按比例）作用于每一刀；
 *   平仓价、平仓时间只作用于收盘那一组（编辑器里那一格显示的就是它；与它同一时刻平掉的刀——比如并进同一个仓位、
 *   没有腿的加仓——一起平移），更早平掉的刀维持实际成交。
 * 开仓费一律只作说明：战役页的已实现 P&L 是 Σ record.pnl，开仓费在开仓时从钱包扣走、不在其中，
 * 这里若扣掉它，未改动的副本就会凭空比实际少一截，被读成「原始错误的代价」。
 */
export function resolveManualLegEconomics(leg: CampaignCounterfactualManualLeg): ManualLegEconomics {
  const actual = leg.actual;
  // 风险锚价（初始对冲的委托价、老数据解混合后的主力开仓价）只在开仓价没改时代替开仓价。
  const anchorPrice = actual?.anchor_price != null && samePrice(leg.entry_price, actual.entry_price)
    ? actual.anchor_price
    : leg.entry_price;
  if (leg.filled === false) {
    return {
      netPnl: 0,
      grossPnl: 0,
      closeFeeUsdt: 0,
      openFeeUsdt: 0,
      feesUnknown: false,
      basis: 'unfilled',
      pathSegments: [],
      exposureUsdt: leg.size_usdt,
      anchorPrice,
    };
  }
  if (!actual || !Number.isFinite(actual.realized_pnl_usdt)) return modelLegEconomics(leg, anchorPrice);

  const openMs = timeMsOr(leg.open_time, 0);
  const closeMs = Math.max(timeMsOr(leg.close_time, openMs), openMs);
  // 成交时刻未知、权益路径不持有的腿：开仓时间没改就照样不持有（已实现照计）。
  const offPath = actual.off_path === true && sameInstant(leg.open_time, actual.open_time);

  const sizeRatio = actual.size_usdt > 0 ? leg.size_usdt / actual.size_usdt : 1;
  const exposureUsdt = actual.exposure_usdt != null ? actual.exposure_usdt * sizeRatio : leg.size_usdt;

  if (actual.source === 'unsettled') {
    if (!manualLegMatchesActual(leg)) return { ...modelLegEconomics(leg, anchorPrice), exposureUsdt };
    // 没改过：持仓按实际成交（从历史快照事件还原的腿带着事件里的那一刀），否则按这一格。
    const held = actual.cuts?.[actual.cuts.length - 1];
    const heldEntry = held ? held.entry_price : leg.entry_price;
    const heldSize = held ? held.size_usdt : leg.size_usdt;
    return {
      netPnl: 0,
      grossPnl: 0,
      closeFeeUsdt: 0,
      openFeeUsdt: 0,
      feesUnknown: false,
      basis: 'unsettled',
      pathSegments: offPath ? [] : [{
        side: pathSide(leg.direction),
        quantity: heldSize / heldEntry,
        entryPrice: heldEntry,
        startMs: openMs,
        endMs: closeMs,
        realizedPnl: 0,
      }],
      exposureUsdt,
      anchorPrice,
    };
  }

  const coinFace = coinFaceOf(leg);
  const cuts = actualCutsOf(actual, coinFace);
  const closingIndexes = closingCutIndexes(cuts);
  const actualOpenMs = timeMsOr(actual.open_time, openMs);
  const shiftMs = openMs - actualOpenMs;
  const priceRatio = actual.entry_price > 0 ? leg.entry_price / actual.entry_price : 1;
  // 平仓价一格改了多少：收盘那一组的每一刀都平移这么多（收盘那一刀的实际平仓价就是这一格显示的值）。
  const exitShift = leg.exit_price - actual.exit_price;
  /**
   * 摊自战役级已实现的腿：战役页的权益路径持有它们时平仓后记 0（没有成交记录、也没有快照），
   * 副本的路径同样只计改动本身的差额，那个总额只进最终已实现。
   */
  const pathExcludesActual = actual.source === 'campaign_total';
  const modelNet = (
    direction: CampaignCounterfactualManualLeg['direction'],
    entry: number,
    exit: number,
    size: number,
    rate: number,
  ) => pnlForClose(direction, entry, exit, size, 1) - feeAtRate(size, entry, exit, rate, coinFace);

  let netPnl = 0;
  let closeFeeUsdt = 0;
  let openFeeUsdt = 0;
  const pathSegments: CampaignPnlPathLeg[] = [];
  cuts.forEach((cut, index) => {
    const closing = closingIndexes.has(index);
    const entry = cut.entry_price * priceRatio;
    const size = cut.size_usdt * sizeRatio;
    // 收盘那一刀直接取这一格的值（免得 a + (b − a) 的浮点尾差）；同一时刻平掉的其余刀按同一差额平移。
    const exit = index === cuts.length - 1 ? leg.exit_price : closing ? cut.exit_price + exitShift : cut.exit_price;
    const cutOpenMs = timeMsOr(cut.open_time, actualOpenMs) + shiftMs;
    const cutCloseMs = Math.max(closing ? closeMs : timeMsOr(cut.close_time, closeMs), cutOpenMs);
    const editedNet = modelNet(leg.direction, entry, exit, size, cut.close_fee_rate);
    const actualNet = modelNet(actual.direction, cut.entry_price, cut.exit_price, cut.size_usdt, cut.close_fee_rate);
    const editWorth = editedNet - actualNet;
    /**
     * 逐仓强平的那一刀：盈亏在封顶处截断（「仓位」一格改过时按同一比例缩放，杠杆不变、保证金同比例变）。
     * 交易所在破产价上把仓位收走了，再往下的价格不属于这条腿——不截断就会算出
     * 一条保证金 1000 的腿亏掉 3078.96。封顶带符号（多笔成交并成的仓位拆账后，加仓那一片可能是正的），
     * 各刀相加恰好是 −整仓保证金；没改过时 editWorth 恒为 0、封顶就是实际结算值，截断不动它。
     */
    // 方向被改过的老分支（编辑器现已锁死爆仓腿的方向）：封顶是按原方向的保证金算的，套到反向仓位上会错截，不封。
    const pnlFloor = cut.pnl_floor_usdt != null && Number.isFinite(cut.pnl_floor_usdt) && leg.direction === actual.direction
      ? cut.pnl_floor_usdt * Math.abs(sizeRatio)
      : null;
    const realized = pnlFloor != null
      ? Math.max(cut.realized_pnl_usdt + editWorth, pnlFloor)
      : cut.realized_pnl_usdt + editWorth;
    closeFeeUsdt += cut.close_fee_usdt
      + feeAtRate(size, entry, exit, cut.close_fee_rate, coinFace)
      - feeAtRate(cut.size_usdt, cut.entry_price, cut.exit_price, cut.close_fee_rate, coinFace);
    openFeeUsdt += (cut.open_fee_usdt ?? 0)
      + feeAtRate(size, entry, entry, cut.open_fee_rate, coinFace)
      - feeAtRate(cut.size_usdt, cut.entry_price, cut.entry_price, cut.open_fee_rate, coinFace);
    netPnl += realized;
    pathSegments.push({
      side: pathSide(leg.direction),
      quantity: entry > 0 ? size / entry : 0,
      entryPrice: entry,
      startMs: cutOpenMs,
      endMs: cutCloseMs,
      realizedPnl: pathExcludesActual ? editWorth : realized,
      ...(pnlFloor != null ? { pnlFloorUsd: pnlFloor } : {}),
    });
  });
  // 只剩复盘快照的腿、摊自战役级已实现的腿：盈亏里已含手续费，但金额不知道——不计入手续费合计，只标出来；
  // 改动带来的平仓费变化已在上面的 editWorth 里扣进 netPnl，同样不单列（见 ManualLegEconomics.closeFeeUsdt）。
  const feesUnknown = actual.source === 'leg_snapshot' || actual.source === 'campaign_total';
  return {
    netPnl,
    grossPnl: feesUnknown ? netPnl : netPnl + closeFeeUsdt,
    closeFeeUsdt: feesUnknown ? 0 : closeFeeUsdt,
    openFeeUsdt: feesUnknown ? 0 : openFeeUsdt,
    feesUnknown,
    basis: manualLegMatchesActual(leg) ? actual.source : 'adjusted',
    pathSegments: offPath ? [] : pathSegments,
    exposureUsdt,
    anchorPrice,
  };
}

function manualTimeMs(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function defaultCloseTime(params: CampaignCounterfactualParams, klines: KlineData[]): string {
  const last = klines[klines.length - 1];
  return last ? new Date(last.time).toISOString() : params.entry.time;
}

export interface BuildManualLegsOptions {
  /**
   * 这场战役本身：「挂单从未成交」「对冲何时触发」要看它的事件流才判得准，风险锚要看它的历史归类与解混合，
   * 结算兜底要看它的落库值。页面与编辑器都必须传。不给时按主力开仓参数造一个最小战役，事件流里的证据看不到。
   */
  campaign?: TradeCampaign | null;
  /** 本地委托快照给出的事实（从未成交的委托 id）：与战役页权益路径读同一份，见 CampaignLocalOrderFacts。 */
  localOrders?: CampaignLocalOrderFacts;
  /** 实际触发委托证据：只用于保存开仓方式快照，不参与反事实成交或盈亏推断。 */
  reverseHedgeOrders?: CampaignReverseHedgeOrder[];
}

/** 没有战役行时的最小替身：只够 buildActiveLegs 定方向与时间窗。 */
function stubCampaignFromParams(params: CampaignCounterfactualParams): TradeCampaign {
  return {
    id: 'manual-legs-stub',
    user_id: '',
    campaign_code: '',
    symbol: '',
    direction: params.entry.direction === 'short' ? 'main_short' : 'main_long',
    status: 'active',
    strategy_template: 'custom',
    title: '',
    opened_at: params.entry.time,
    closed_at: null,
    initial_main_size_usdt: params.entry.size_usdt,
    initial_leverage: params.entry.leverage,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: params.entry.time,
    updated_at: params.entry.time,
  } as TradeCampaign;
}

const INITIAL_HEDGE_LEG_ROLES = new Set<string>(['hedge_initial_a', 'hedge_initial_b']);

/**
 * 一条腿认领到的每一刀（与已实现 P&L 同一份认领），收盘那一刀排最后。
 * 收盘那一刀的平仓时间 / 平仓价取腿上显示的那一份（已叠平仓价校正），已实现叠同一个校正差额——
 * 这样没改过的腿，引擎按刀重放出来的钱与战役页结算逐分相同。
 */
function buildRecordCuts(
  claimed: TradeRecord[],
  correction: LegExitPriceCorrection | undefined,
  displayed: { open_time: string; close_time: string; exit_price: number },
): CampaignCounterfactualManualLegCut[] {
  const closing = closingSettlementRecord(claimed) as TradeRecord;
  const recency = (record: TradeRecord) => record.closeTime || record.openTime || 0;
  const earlier = claimed.filter(record => record !== closing).sort((a, b) => recency(a) - recency(b));
  const delta = correction ? legExitPriceCorrectionDelta(claimed, correction) : 0;
  return [...earlier, closing].map(record => {
    const isClosing = record === closing;
    const fees = tradeRecordFees(record);
    const pnl = Number.isFinite(record.pnl) ? Number(record.pnl) : 0;
    const floor = liquidationPnlFloorUsd(record);
    return {
      open_time: record.openTime > 0 ? new Date(record.openTime).toISOString() : displayed.open_time,
      close_time: isClosing || !(record.closeTime > 0)
        ? displayed.close_time
        : new Date(record.closeTime).toISOString(),
      entry_price: record.entryPrice,
      exit_price: isClosing ? displayed.exit_price : record.exitPrice,
      size_usdt: getPositionNotionalUsd(record.symbol, record, record.entryPrice),
      realized_pnl_usdt: isClosing && correction ? pnl + delta : pnl,
      close_fee_usdt: fees.close.usd,
      // 费率没存的老记录按 费 ÷ 平仓名义 倒推（tradeRecordFees）；倒推不出（强平）才退到现行 Taker，免费的记录按 0。
      close_fee_rate: fees.close.rate ?? (fees.close.usd > 0 ? TAKER_FEE : 0),
      open_fee_usdt: fees.open?.usd ?? null,
      open_fee_rate: fees.open?.rate ?? TAKER_FEE,
      // 逐仓强平的刀：盈亏封顶（各刀相加 = −整仓保证金）。其余的刀不写这个字段，与此前逐字节相同。
      ...(floor != null ? { pnl_floor_usdt: floor } : {}),
    };
  });
}

/**
 * 实际成交结果：腿认领到的成交记录（分刀、叠校正）、复盘快照，或「结算没有计入」。
 *
 * 结算给这条腿记的是 null（既无成交记录也无复盘快照，典型是尚未平仓的腿）时，战役页的已实现不含它；
 * 原样重跑也必须记 0——否则按开平价重算（开平同价时只剩一笔平仓费）会凭空印出一截「相对实际」。
 */
type ManualLegRiskFacts = Pick<
  CampaignCounterfactualManualLegActual,
  'placed_time' | 'has_record' | 'exposure_usdt' | 'exposure_group' | 'exposure_excluded' | 'order_kind' | 'leg_role'
>;

function buildManualLegActual(input: {
  claimed: TradeRecord[];
  realizedPnl: number | null;
  /** 一条腿都结算不了、战役页取事件流 / 落库值时，这条腿摊到的那一份（见 buildManualLegs）。 */
  campaignTotalShare: number | null;
  correction: LegExitPriceCorrection | undefined;
  economics: Pick<CampaignCounterfactualManualLegActual, 'direction' | 'open_time' | 'close_time' | 'entry_price' | 'exit_price' | 'size_usdt'>;
  closeTimeFallback: boolean;
  campaignClosed: boolean;
  anchorPrice: number | null;
  offPath: boolean;
  riskFacts: ManualLegRiskFacts;
  executionFacts: Pick<CampaignCounterfactualManualLegActual, 'entry_method' | 'exit_method'>;
  /** 从历史快照事件还原、成交价或数量与腿上的委托快照不同的腿：事件里的成交（见 eventFillCut）。 */
  eventFill: { entryPrice: number; quantity: number } | null;
}): CampaignCounterfactualManualLegActual {
  const { claimed, realizedPnl, economics } = input;
  const facts = {
    ...economics,
    ...(input.closeTimeFallback ? { close_time_fallback: true } : {}),
    ...(input.anchorPrice != null ? { anchor_price: input.anchorPrice } : {}),
    ...(input.offPath ? { off_path: true } : {}),
    ...input.riskFacts,
    ...input.executionFacts,
  };
  const eventCuts = (realized: number) => (input.eventFill ? { cuts: [eventFillCut(economics, input.eventFill, realized)] } : {});
  if (input.campaignTotalShare != null) {
    return {
      source: 'campaign_total',
      ...facts,
      realized_pnl_usdt: input.campaignTotalShare,
      close_fee_usdt: null,
      open_fee_usdt: null,
      ...eventCuts(input.campaignTotalShare),
    };
  }
  if (realizedPnl == null || !Number.isFinite(realizedPnl)) {
    return {
      source: 'unsettled',
      ...facts,
      ...(input.closeTimeFallback && !input.campaignClosed ? { still_open: true } : {}),
      realized_pnl_usdt: 0,
      close_fee_usdt: null,
      open_fee_usdt: null,
      ...eventCuts(0),
    };
  }
  if (claimed.length === 0) {
    return {
      source: 'leg_snapshot',
      ...facts,
      realized_pnl_usdt: realizedPnl,
      close_fee_usdt: null,
      open_fee_usdt: null,
      ...eventCuts(realizedPnl),
    };
  }
  const cuts = buildRecordCuts(claimed, input.correction, economics);
  // 这条腿被交易所强平过：平仓价 / 平仓时间不是决策，编辑器据此锁格，盈亏按各刀的封顶截断。
  const liquidated = claimed.some(record => isLiquidationRecord(record));
  // 与 Legs 表「手续费」列同一份 tradeRecordFees：一条腿分几刀平掉时逐刀相加。
  let closeFee = 0;
  let openFee: number | null = 0;
  for (const cut of cuts) {
    closeFee += cut.close_fee_usdt;
    openFee = openFee == null || cut.open_fee_usdt == null ? null : openFee + cut.open_fee_usdt;
  }
  return {
    source: 'records',
    ...facts,
    ...(liquidated ? { liquidated: true as const } : {}),
    realized_pnl_usdt: realizedPnl,
    close_fee_usdt: closeFee,
    open_fee_usdt: openFee,
    cuts,
  };
}

/**
 * 从历史快照事件还原的腿（本地没有成交记录）：战役页的权益路径按事件里的成交价与数量持有它，
 * 腿上显示的却是委托价 / 委托名义（从已有日志腿归类时，事件抄的是当时成交记录的成交价）。
 * 副本给它一刀同形的「实际成交」：开仓价、开仓名义取事件，钱数仍是这条腿的结算值；
 * 手续费金额未知，费率按模拟器 Taker（与只剩快照的腿同一口径）。
 */
function eventFillCut(
  economics: Pick<CampaignCounterfactualManualLegActual, 'open_time' | 'close_time' | 'exit_price'>,
  fill: { entryPrice: number; quantity: number },
  realized: number,
): CampaignCounterfactualManualLegCut {
  return {
    open_time: economics.open_time,
    close_time: economics.close_time,
    entry_price: fill.entryPrice,
    exit_price: economics.exit_price,
    size_usdt: fill.entryPrice * fill.quantity,
    realized_pnl_usdt: realized,
    close_fee_usdt: 0,
    close_fee_rate: TAKER_FEE,
    open_fee_usdt: null,
    open_fee_rate: TAKER_FEE,
  };
}

/**
 * 战役页锚 L / 预期回撤时这条腿用的价，与副本里显示的开仓价不同时才返回：
 *   · 主力：老数据先把合并出来的开仓价解回主力自己的（resolveMainRiskAnchorEntryPrice）；
 *   · 初始对冲 A/B：委托价（pre_entry_price），不是滑点后的成交价——「委托快照是唯一有效的 ex-ante 边界」。
 */
function riskAnchorPriceFor(
  campaign: TradeCampaign | null,
  leg: TradeJournal,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  entryPrice: number,
): number | null {
  let anchor: number | null = null;
  if (leg.leg_role === 'main_open' && campaign) {
    anchor = resolveMainRiskAnchorEntryPrice(campaign, legs, tradeRecords, leg);
  } else if (leg.leg_role != null && INITIAL_HEDGE_LEG_ROLES.has(leg.leg_role)) {
    anchor = Number.isFinite(leg.pre_entry_price) && Number(leg.pre_entry_price) > 0 ? Number(leg.pre_entry_price) : null;
  }
  return anchor != null && !samePrice(anchor, entryPrice) ? anchor : null;
}

/**
 * 把战役已归类的 legs 转成「手动反事实」可编辑的腿副本（编辑器初始值 + 偏离代价的原始基线共用）。
 * 开平时间与价格复用原始 Legs 列表的统一成交解析；历史异常平仓价先应用 K 线校正，
 * 缺少成交记录时再退回腿上的快照；仍缺平仓时间的腿（挂单、未平仓）在战役结束时刻收，
 * 进行中的战役才退到末根 K 线——前者不随 K 线窗口变，换周期不会把没动过的腿读成「改过」。
 * 「仓位」一格仍是 Legs 表显示的委托名义（pre_position_size）。
 *
 * 每条腿还带上它的实际成交结果（actual），全部取自战役页用的同一批函数：
 *   · 盈亏：结算的 byLeg（叠同一份校正）；成交记录腿按认领到的每一刀拆开（cuts），
 *     每刀带自己的开仓名义（滑点后的成交价 × 数量）、平仓费与费率——引擎按刀重放，
 *     峰值路径与主力开仓名义仓位因此与战役页一致；
 *   · 手续费：Legs 表同一份 tradeRecordFees；
 *   · 持有与否：战役页权益路径（resolveCampaignEquityPathLegFacts）——从未成交的腿标 filled: false、不带 actual；
 *     成交时刻未知、路径不持有的腿标 off_path；没有成交记录、却在路径上的腿按路径上那一段开平仓
 *     （对冲按触发时刻开、触发后又撤单的按撤单时刻平；事件快照按事件里的开仓时刻开、按腿上的平仓时刻平，腿上没有才取事件的），
 *     从历史快照事件还原、成交价或数量与委托快照不同的腿，带一刀取自事件的实际成交（eventFillCut）；
 *   · 风险锚：初始对冲的委托价、老数据解混合后的主力开仓价（anchor_price）；合成战役要读的原始事实——
 *     挂出时刻（placed_time）、有没有本地成交记录（has_record）、战役页分给它的开仓名义份额与并组
 *     （exposure_usdt / exposure_group，resolveInitialExposureLegAttribution）、不计入开仓名义的反向腿、order_kind。
 * 结算没有计入的腿（byLeg 为 null）记成 unsettled，原样重跑同样记 0。
 * 一条腿都结算不了、战役页读事件流或落库值时，那个总额摊到成交过的腿上（campaign_total，见 campaignTotalSharesFor）。
 * 成交过的腿不写 filled。
 */
export function buildManualLegs(
  params: CampaignCounterfactualParams,
  legs: TradeJournal[],
  klines: KlineData[],
  tradeRecords: TradeRecord[],
  exitPriceCorrections: LegExitPriceCorrections = {},
  options: BuildManualLegsOptions = {},
): CampaignCounterfactualManualLeg[] {
  const campaign = options.campaign ?? null;
  const closedAtMs = campaign?.closed_at ? manualTimeMs(campaign.closed_at) : null;
  const recordMap = buildTradeRecordLookup(tradeRecords);
  const settlement = computeCampaignRealizedPnl(
    campaign ?? { final_realized_pnl: null, actual_evolution: [] },
    legs,
    tradeRecords,
    exitPriceCorrections,
  );
  const pathFacts = resolveCampaignEquityPathLegFacts(
    campaign ?? stubCampaignFromParams(params),
    legs,
    tradeRecords,
    options.localOrders,
  );
  /**
   * 平仓时间只是兜底的腿：已结束的战役收在战役页扫描窗口的终点（不早于路径上最晚的那次平仓，
   * closed_at 被存早了的老战役也一样，见 buildActiveLegs），战役页的路径把平仓时刻缺省的段持有到同一刻；
   * 进行中的战役收在末根 K 线。
   */
  const fallbackClose = closedAtMs != null && Number.isFinite(pathFacts.analysisEndMs)
    ? new Date(Math.max(closedAtMs, pathFacts.analysisEndMs)).toISOString()
    : closedAtMs != null
      ? new Date(closedAtMs).toISOString()
      : defaultCloseTime(params, klines);
  const ordered = [...legs].sort((a, b) => {
    const seqA = a.leg_sequence ?? 9999;
    const seqB = b.leg_sequence ?? 9999;
    if (seqA !== seqB) return seqA - seqB;
    return new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime();
  });

  const exposure = campaign
    ? resolveInitialExposureLegAttribution(campaign, legs, tradeRecords)
    : { shares: new Map(), excludedLegIds: new Set<string>() };

  const drafts = ordered
    .map((leg, index) => {
      const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      /**
       * 开平时间与价格取这条腿**自己认领到的**收盘那一刀：Legs 表按 id 查到的那条记录被另一条腿认领时
       * （例如实时主力的最后一刀，后来又作为回填的加仓腿归进同一场），战役页的路径只持有这条腿认领到的各刀，
       * 副本若照抄查到的那条的平仓时间，收盘那一刀会被持有到别人的平仓时刻。认领到的就是查到的那条时与此前逐字节相同。
       */
      const claimed = settlement.recordsByLeg.get(leg.id) ?? [];
      const ownClosing = record && claimed.length > 0 && !claimed.includes(record) ? closingSettlementRecord(claimed) : null;
      const execution = resolveLegExecution(leg, ownClosing ?? record, exitPriceCorrections);
      const executionMethods = resolveLegExecutionMethodEvidence(leg, ownClosing ?? record, options.reverseHedgeOrders, tradeRecords);
      // 没有成交记录、却在权益路径上的腿（带触发事件的对冲、快照、历史快照事件）按路径上那一段开仓；
      // 那一段有自己的平仓时刻（快照平仓时间、撤单事件、事件里的平仓时间）时也按它平。
      const heldStartMs = record ? null : pathFacts.heldStartMsByLeg.get(leg.id) ?? null;
      const heldPath = record ? null : pathFacts.heldWithoutRecordByLeg.get(leg.id) ?? null;
      const openTime = heldStartMs != null
        ? new Date(heldStartMs).toISOString()
        : execution.openTime != null
          ? new Date(execution.openTime).toISOString()
          : leg.pre_simulated_time || params.entry.time;
      const heldEndMs = heldPath?.endMs ?? null;
      const closeTimeFallback = heldEndMs == null && execution.closeTime == null;
      const closeTime = heldEndMs != null
        ? new Date(heldEndMs).toISOString()
        : execution.closeTime != null
          ? new Date(execution.closeTime).toISOString()
          : fallbackClose;
      const closeMs = manualTimeMs(closeTime) ?? manualTimeMs(fallbackClose) ?? manualTimeMs(openTime) ?? Date.now();
      const openMs = manualTimeMs(openTime) ?? closeMs;
      const normalizedClose = closeMs >= openMs ? closeTime : new Date(openMs).toISOString();
      const entryPrice = execution.entryPrice ?? params.entry.price;
      const exitPrice = execution.exitPrice ?? entryPrice;
      const direction: CampaignCounterfactualManualLeg['direction'] = leg.direction === 'short' ? 'short' : 'long';
      const sizeUsdt = leg.pre_position_size ?? params.entry.size_usdt;
      const coin = (record?.settlementMode ?? leg.pre_settlement_mode) === 'coin';
      const unfilled = pathFacts.unfilledLegIds.has(leg.id);
      const manualLeg: CampaignCounterfactualManualLeg = {
        id: leg.id || `leg-${index}`,
        leg_role: leg.leg_role ?? 'standalone',
        direction,
        open_time: openTime,
        close_time: normalizedClose,
        entry_price: entryPrice,
        exit_price: exitPrice,
        size_usdt: sizeUsdt,
        leverage: leg.leverage ?? params.entry.leverage ?? 1,
        enabled: true,
      };
      if (unfilled) manualLeg.filled = false;
      if (coin) {
        manualLeg.settlement_mode = 'coin';
        manualLeg.contract_size_usd = getCoinContractSizeUsd(leg.symbol, {
          contractSizeUsd: record?.contractSizeUsd ?? leg.pre_contract_size_usd ?? undefined,
        });
      }
      // 合成战役（风险锚）要读的原始事实：挂出时刻、有没有成交记录、开仓名义的份额与并组、order_kind。
      const placedMs = manualTimeMs(leg.pre_simulated_time);
      const share = exposure.shares.get(leg.id);
      const riskFacts: ManualLegRiskFacts = {
        leg_role: leg.leg_role,
        ...(placedMs != null && placedMs !== openMs ? { placed_time: new Date(placedMs).toISOString() } : {}),
        ...(record ? { has_record: true } : {}),
        ...(share ? { exposure_usdt: share.notionalUsd } : {}),
        ...(share && share.groupSize > 1 ? { exposure_group: share.groupKey } : {}),
        ...(exposure.excludedLegIds.has(leg.id) ? { exposure_excluded: true } : {}),
        ...(leg.order_kind === 'main' || leg.order_kind === 'hedge' ? { order_kind: leg.order_kind } : {}),
      };
      // 从历史快照事件还原的腿，事件里的成交价 / 数量与腿上的委托快照不同时，副本的持仓按事件（与战役页同一段）。
      const eventFill = heldPath?.eventFill
        && !(samePrice(heldPath.eventFill.entryPrice, entryPrice)
          && samePrice(heldPath.eventFill.entryPrice * heldPath.eventFill.quantity, sizeUsdt))
        ? heldPath.eventFill
        : null;
      const executionFacts = {
        ...(executionMethods.open.kind !== 'unknown' ? { entry_method: executionMethods.open.kind } : {}),
        ...(!closeTimeFallback && executionMethods.close.kind !== 'unknown' ? { exit_method: executionMethods.close.kind } : {}),
      };
      return { leg, manualLeg, unfilled, closeTimeFallback, riskFacts, eventFill, executionFacts };
    })
    .filter(draft => draft.manualLeg.entry_price > 0 && draft.manualLeg.size_usdt > 0);

  const campaignTotalShares = campaignTotalSharesFor(settlement, drafts);

  return drafts.map(({ leg, manualLeg, unfilled, closeTimeFallback, riskFacts, eventFill, executionFacts }) => {
    if (unfilled) return manualLeg;
    manualLeg.actual = buildManualLegActual({
      claimed: settlement.recordsByLeg.get(leg.id) ?? [],
      realizedPnl: settlement.byLeg.get(leg.id) ?? null,
      campaignTotalShare: campaignTotalShares?.get(leg.id) ?? null,
      correction: exitPriceCorrections[leg.id],
      economics: {
        direction: manualLeg.direction,
        open_time: manualLeg.open_time,
        close_time: manualLeg.close_time,
        entry_price: manualLeg.entry_price,
        exit_price: manualLeg.exit_price,
        size_usdt: manualLeg.size_usdt,
      },
      closeTimeFallback,
      campaignClosed: closedAtMs != null,
      anchorPrice: riskAnchorPriceFor(campaign, leg, legs, tradeRecords, manualLeg.entry_price),
      offPath: pathFacts.offPathLegIds.has(leg.id),
      riskFacts,
      executionFacts,
      eventFill,
    });
    return manualLeg;
  });
}

/**
 * 一条腿都结算不了（本地既无成交记录也无复盘快照）、战役页的已实现取自事件流或落库值时，
 * 把这个总额摊到成交过的腿上：每条腿先按自己的开平价估一份（毛盈亏 − 模拟器 Taker 平仓费），
 * 余差（估不到的手续费、滑点、资金费……）记在主力上（名义最大的那笔；没有主力就记在第一条腿上）。
 * 原样重跑时各份之和恰为那个总额；改一格挪动的仍是这一格值的钱；停用一条腿减去它自己那一份。
 * 其它结算口径返回 null（各腿按自己的结算值）。
 */
function campaignTotalSharesFor(
  settlement: ReturnType<typeof computeCampaignRealizedPnl>,
  drafts: Array<{ leg: TradeJournal; manualLeg: CampaignCounterfactualManualLeg; unfilled: boolean }>,
): Map<string, number> | null {
  if (settlement.basis !== 'events' && settlement.basis !== 'campaign_summary') return null;
  const total = settlement.total;
  if (total == null || !Number.isFinite(total)) return null;
  const filled = drafts.filter(draft => !draft.unfilled);
  if (filled.length === 0) return null;
  const shares = new Map<string, number>();
  let estimated = 0;
  for (const { leg, manualLeg } of filled) {
    const estimate = pnlForClose(manualLeg.direction, manualLeg.entry_price, manualLeg.exit_price, manualLeg.size_usdt, 1)
      - feeAtRate(manualLeg.size_usdt, manualLeg.entry_price, manualLeg.exit_price, TAKER_FEE, coinFaceOf(manualLeg));
    shares.set(leg.id, estimate);
    estimated += estimate;
  }
  const carrier = pickPrimaryMainLeg(filled.map(draft => draft.leg)) ?? filled[0].leg;
  shares.set(carrier.id, (shares.get(carrier.id) ?? 0) + (total - estimated));
  return shares;
}

/**
 * 与 manualLegMatchesActual 同一组字段：方向、开平时间、开平价、仓位——决定这条腿钱数与持仓的全部输入。
 * ignoreCloseTime：平仓时间只是兜底（挂单、未平仓）时不比。
 */
function sameManualLegEconomicFields(
  a: CampaignCounterfactualManualLeg,
  b: CampaignCounterfactualManualLeg,
  ignoreCloseTime = false,
): boolean {
  return a.direction === b.direction
    && sameInstant(a.open_time, b.open_time)
    && (ignoreCloseTime || sameInstant(a.close_time, b.close_time))
    && samePrice(a.entry_price, b.entry_price)
    && samePrice(a.exit_price, b.exit_price)
    && samePrice(a.size_usdt, b.size_usdt);
}

/**
 * 本次口径统一之前保存的分支，腿上没有 actual / filled / 结算方式。读它（偏离代价）或把它载回编辑器时，
 * 按当前原始基线里同 id 的那条腿补上，补的都是「这条腿本身的事实」：
 *   · actual、settlement_mode、contract_size_usd 照补——引擎从实际结算值出发，只加上改动值的钱；
 *   · 开仓时间：老引擎给没有成交记录的腿存的是挂出时刻（pre_simulated_time），基线按战役页权益路径的开始时刻
 *     （对冲的触发时刻）开仓；老行存的恰是挂出时刻就换成基线的值，否则没动过的对冲会被读成「改了开仓时间」、
 *     还被当作从挂出那一刻起就持有；
 *   · 挂单（基线 filled: false）：除平仓时间外逐项一致就补 filled: false，平仓时间也换成基线的兜底值
 *     （挂单的平仓时间不是事实，老行存的是保存那一刻 K 线窗口的末根，换了窗口就不同）；
 *     不一致就写明 filled: true——老引擎把挂单一律当作成交，老行里改过价的挂单是用户当时就在模拟它成交，
 *     写出来编辑器才画「未成交 / 已成交」开关，用户随时能切回去；
 *   · 平仓时间只是兜底的腿（基线 close_time_fallback）：老行存的是当时 K 线窗口的末根，满足任一条就认作兜底、
 *     换成基线的兜底值——等于那次运行的 K 线末根（savedWindowEnd）；或者不早于基线的兜底值（已结束的战役按结束时刻收，
 *     老窗口的末根只会在它之后）、且其余各格与基线一致。都不满足就原样保留，免得抹掉用户当时改过的平仓时间。
 *   · 那次运行的改动摘要（savedChangeSummary，9962e7e7 起的行都有）说这条腿的平仓时间没改：保存下来的平仓时间就是
 *     当时基线给的值，一律换成基线当前的值——进行中的战役里还没平的腿，老窗口的末根早于现在的末根，上一条认不出来；
 *     基线的平仓时间换了来历（例如触发后又撤单的老对冲，现在按撤单时刻平）也一样。
 * 带着 actual 或 filled 的腿是本次改动之后保存的，事实原样保留；只有平仓时间仍是它自己记下的兜底值、
 * 而基线的兜底值已经变了（进行中的战役，K 线窗口又往后长了）时，换成基线当前的兜底值。
 * 切成「已成交」的挂单（基线 filled: false、行里 filled: true，没有 actual）没有兜底标记，靠改动摘要认：
 * 平仓时间没改就换成基线当前的兜底值，模拟的成交照样持有到现在的末根。
 * 基线里没有这条腿（新增的腿）原样返回。
 */
export function adoptBaselineLegFacts(
  saved: CampaignCounterfactualManualLeg,
  baseline: CampaignCounterfactualManualLeg | undefined,
  savedWindowEnd: string | null = null,
  savedChangeSummary: CampaignCounterfactualChangeSummary | null = null,
): CampaignCounterfactualManualLeg {
  if (!baseline || baseline.id !== saved.id) return saved;
  const closeKept = closeKeptAtRun(savedChangeSummary, saved.id);
  if (saved.actual !== undefined || saved.filled !== undefined) {
    const current = adoptLiquidationFacts(adoptCurrentFallbackClose(saved, baseline), baseline);
    const simulatedFill = current.actual === undefined && current.filled === true && baseline.filled === false;
    return simulatedFill && closeKept && !sameInstant(current.close_time, baseline.close_time)
      ? { ...current, close_time: baseline.close_time }
      : current;
  }
  const adopted: CampaignCounterfactualManualLeg = { ...saved };
  if (baseline.actual !== undefined) adopted.actual = baseline.actual;
  if (saved.settlement_mode === undefined && baseline.settlement_mode !== undefined) {
    adopted.settlement_mode = baseline.settlement_mode;
  }
  if (saved.contract_size_usd === undefined && baseline.contract_size_usd !== undefined) {
    adopted.contract_size_usd = baseline.contract_size_usd;
  }
  const placedTime = baseline.actual?.placed_time;
  if (placedTime != null && baseline.actual?.has_record !== true && sameInstant(saved.open_time, placedTime)) {
    adopted.open_time = baseline.open_time;
  }
  if (baseline.filled === false) {
    if (sameManualLegEconomicFields(adopted, baseline, true)) {
      adopted.filled = false;
      adopted.close_time = baseline.close_time;
    } else {
      adopted.filled = true;
      if (closeKept) adopted.close_time = baseline.close_time;
    }
  } else if (closeKept) {
    adopted.close_time = baseline.close_time;
  } else if (baseline.actual?.close_time_fallback === true) {
    const savedCloseMs = new Date(adopted.close_time).getTime();
    const baselineCloseMs = new Date(baseline.close_time).getTime();
    const windowEnd = savedWindowEnd != null && sameInstant(adopted.close_time, savedWindowEnd);
    const laterDefault = Number.isFinite(savedCloseMs) && Number.isFinite(baselineCloseMs)
      && savedCloseMs >= baselineCloseMs
      && sameManualLegEconomicFields(adopted, baseline, true);
    if (windowEnd || laterDefault) adopted.close_time = baseline.close_time;
  }
  return adopted;
}

/**
 * 那次运行的改动摘要里，这条腿的平仓时间没有改：摘要里没有这条腿，或它是「改」且改动字段里没有 close_time。
 * 没有摘要（9962e7e7 之前的行）、或这条腿在摘要里是新增 / 删除 / 停用时，不下结论。
 */
function closeKeptAtRun(summary: CampaignCounterfactualChangeSummary | null, legId: string): boolean {
  if (!summary || !Array.isArray(summary.legs)) return false;
  const change = summary.legs.find(item => item.id === legId);
  if (!change) return true;
  return change.kind === 'edited' && !(change.changedFields ?? []).includes('close_time');
}

/**
 * 「这条腿被交易所强平过」这件事一律按当前基线补——它不是用户当时的改动，是成交记录上的事实。
 *
 * 带着 actual 的分支（本次改动之前保存的那一批也算）事实原样保留，唯独强平这两项要补：
 * 老分支里既没有 liquidated（编辑器不画红色「爆仓」标记、平仓价 / 平仓时间两格不锁），
 * 也没有各刀的 pnl_floor_usdt（盈亏不封顶）——用户当年把强平价从 0.9540 拖到 0.8500 存下的那一条，
 * 载回来仍读 −3078.96，而且还能接着往下拖。补完之后那两格锁死、盈亏在封顶处截断，
 * 存下的那个平仓价仍留在（已锁的）格子里，看得见当年改过什么。
 *
 * 只在基线说这条腿是强平时动手；各刀对不上（老分支存的刀数与现在不同）时只补标记不补封顶，
 * 免得把封顶写到另一刀上。其余字段一概不碰。
 */
function adoptLiquidationFacts(
  saved: CampaignCounterfactualManualLeg,
  baseline: CampaignCounterfactualManualLeg,
): CampaignCounterfactualManualLeg {
  const baselineActual = baseline.actual;
  const savedActual = saved.actual;
  if (!baselineActual || !savedActual || baselineActual.liquidated !== true) return saved;
  const baselineCuts = baselineActual.cuts;
  const savedCuts = savedActual.cuts;
  const alignedCuts = baselineCuts != null && savedCuts != null && baselineCuts.length === savedCuts.length
    ? savedCuts.map((cut, index) => {
      const floor = baselineCuts[index].pnl_floor_usdt;
      if (floor === cut.pnl_floor_usdt) return cut;
      const next = { ...cut };
      if (floor == null) delete next.pnl_floor_usdt;
      else next.pnl_floor_usdt = floor;
      return next;
    })
    : null;
  const sameCuts = alignedCuts == null || alignedCuts.every((cut, index) => cut === savedCuts?.[index]);
  if (savedActual.liquidated === true && sameCuts) return saved;
  return {
    ...saved,
    actual: {
      ...savedActual,
      liquidated: true,
      ...(alignedCuts != null ? { cuts: alignedCuts } : {}),
    },
  };
}

/** 新行里平仓时间仍是它自己记下的兜底值、而基线的兜底值变了：换成基线当前的兜底值（见 adoptBaselineLegFacts）。 */
function adoptCurrentFallbackClose(
  saved: CampaignCounterfactualManualLeg,
  baseline: CampaignCounterfactualManualLeg,
): CampaignCounterfactualManualLeg {
  const savedActual = saved.actual;
  const baselineActual = baseline.actual;
  if (
    saved.filled === false
    || savedActual?.close_time_fallback !== true
    || baselineActual?.close_time_fallback !== true
    || !sameInstant(saved.close_time, savedActual.close_time)
    || sameInstant(saved.close_time, baseline.close_time)
  ) {
    return saved;
  }
  const { still_open: _stillOpen, ...rest } = savedActual;
  return {
    ...saved,
    close_time: baseline.close_time,
    actual: {
      ...rest,
      close_time: baselineActual.close_time,
      ...(baselineActual.still_open ? { still_open: true } : {}),
    },
  };
}

export interface ManualLegDeviationCost {
  legId: string;
  leg_role: string;
  cost_usdt: number;
}

/**
 * 偏离代价（手动调整 vs 原始）逐腿拆分：
 * 每条腿代价 = 调整后腿盈亏 − 原始腿盈亏（按 leg id 匹配）；新增腿 = 调整后盈亏；删除/停用腿 = −原始盈亏。
 * 合计 = 手动调整总盈亏 − 原始总盈亏 = 原始错误的代价。仅返回 |代价| > EPSILON 的腿。
 * savedWindowEnd：这条分支运行时 K 线窗口的末根（params.run_context.to）；savedChangeSummary：那次运行的改动摘要
 * （params.change_summary）——两者都给认兜底平仓时间用（见 adoptBaselineLegFacts）。
 */
export function computeManualLegDeviationCosts(
  originalLegs: CampaignCounterfactualManualLeg[],
  adjustedLegs: CampaignCounterfactualManualLeg[],
  savedWindowEnd: string | null = null,
  savedChangeSummary: CampaignCounterfactualChangeSummary | null = null,
): ManualLegDeviationCost[] {
  // 与引擎同一份净额：未改动的腿两边都取实际结算值，差额恰为 0；未成交的腿两边都记 0。
  const legPnl = (leg: CampaignCounterfactualManualLeg | undefined) =>
    leg && leg.enabled && validManualLeg(leg) ? resolveManualLegEconomics(leg).netPnl : 0;
  const origById = new Map(originalLegs.map(leg => [leg.id, leg]));
  const adjById = new Map(adjustedLegs.map(leg => [leg.id, leg]));
  const out: ManualLegDeviationCost[] = [];
  for (const saved of adjustedLegs) {
    const orig = origById.get(saved.id);
    /**
     * 老行（本次改动之前保存的分支）的腿没有 actual / filled：按原始基线补上（adoptBaselineLegFacts），
     * 没改的腿两边都取实际结算值，代价仍恰为 0；否则老行里每一条没动过的腿都会按
     * 「模拟费率 vs 实际费率」的零头印出一行假代价，换一次 K 线周期还会多出挂单的假代价。
     */
    const adj = adoptBaselineLegFacts(saved, orig, savedWindowEnd, savedChangeSummary);
    const cost = legPnl(adj) - legPnl(orig);
    if (Math.abs(cost) > EPSILON) out.push({ legId: saved.id, leg_role: saved.leg_role, cost_usdt: round(cost, 2) });
  }
  for (const orig of originalLegs) {
    if (adjById.has(orig.id)) continue;
    const cost = -legPnl(orig);
    if (Math.abs(cost) > EPSILON) out.push({ legId: orig.id, leg_role: orig.leg_role, cost_usdt: round(cost, 2) });
  }
  return out;
}

export function simulateManualLegScenario(
  params: CampaignCounterfactualParams,
  klines: KlineData[],
): CampaignCounterfactualResult {
  const manualLegs = sortedValidManualLegs(params);

  if (manualLegs.length === 0) {
    return {
      final_realized_pnl: 0,
      final_r_multiple: 0,
      peak_unrealized_pnl: 0,
      peak_drawdown: 0,
      profit_capture_ratio: 0,
      events: [],
      legs_summary: [],
      state_segments: [],
      sop_score: 0,
      fees_total: 0,
      open_fees_total: 0,
    };
  }

  /**
   * 未成交的腿（filled === false，Legs 表里的「挂单中」）不进持仓、不进已实现——
   * 战役页的权益路径同样不持有它；把挂单当成持有，一根 K 线冲高时它会凭空吃掉一截浮盈。
   * 但它**留在**下面的合成战役里：初始对冲 A/B 的挂单价正是定义 L 与预期回撤的那条止损线，
   * 拿掉它 L 就变成 0、七项派生指标全部变「—」。
   */
  const economicsByLeg = new Map(manualLegs.map(leg => [leg, resolveManualLegEconomics(leg)] as const));
  const economicsOf = (leg: CampaignCounterfactualManualLeg) => economicsByLeg.get(leg) as ManualLegEconomics;
  const heldLegs = manualLegs.filter(leg => leg.filled !== false);

  const events = heldLegs
    .flatMap<CampaignCounterfactualEvent>(leg => ([
      {
        timestamp: leg.open_time,
        event_type: 'manual_leg_opened',
        leg_role: leg.leg_role,
        price: round(leg.entry_price),
        size_usdt: round(leg.size_usdt),
        notes: '手动 Legs 方案开仓',
      },
      {
        timestamp: leg.close_time,
        event_type: 'manual_leg_closed',
        leg_role: leg.leg_role,
        price: round(leg.exit_price),
        size_usdt: round(leg.size_usdt),
        notes: '手动 Legs 方案平仓',
      },
    ]))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // 净额：与战役页已实现 P&L（Σ record.pnl，已扣平仓费、叠平仓价校正）同一口径。
  const finalPnl = heldLegs.reduce((sum, leg) => sum + economicsOf(leg).netPnl, 0);
  const feesTotal = heldLegs.reduce((sum, leg) => sum + economicsOf(leg).closeFeeUsdt, 0);
  const openFeesTotal = heldLegs.reduce((sum, leg) => sum + economicsOf(leg).openFeeUsdt, 0);
  const feeUnknownLegCount = heldLegs.filter(leg => economicsOf(leg).feesUnknown).length;
  /**
   * 峰值浮盈 / 最大回撤直接用战役页 computeDecisionAccuracy 的那一份权益路径算法
   * （computeCampaignPnlPathExtremes）：一根 K 线里逐个还原持仓状态——K 线起点、每条腿开仓、
   * 每条腿平仓前一刻与平仓时刻、K 线终点——各自用这根的最高价 / 最低价重估，已平的腿计已实现。
   * 不再自写近似：「这根里碰过的腿一律同时持有、同在极值价上估」在多腿同一根换状态时
   * 会与战役页对不上，原样重跑的副本就印出与真实盈亏概览不同的峰值。
   * 已平的每一刀计的是与上面同一份净额——战役页的路径读的也是（校正后的）record.pnl。
   *
   * 粒度告诫：一根 K 线内高低点与开平仓的先后顺序不可知，这是「该周期粒度下」的上下界；
   * 运行时的周期与根数记在 params.run_context 里，读的人才知道该拿它跟什么比。
   */
  // 每条腿按它实际成交的每一刀各放一段（分几刀平掉的腿、并仓后按比例减仓的镜像都在这里还原）；
  // 成交时刻未知、战役页也不持有的腿不放。
  const pathLegs = heldLegs.flatMap(leg => economicsOf(leg).pathSegments);
  const extremes = pathLegs.length > 0
    ? computeCampaignPnlPathExtremes(
      pathLegs,
      klines,
      Math.min(...pathLegs.map(leg => leg.startMs)),
      Math.max(...pathLegs.map(leg => leg.endMs)),
    )
    : { maxProfit: 0, maxDrawdown: 0 };
  // 最终已实现盈亏本身就是权益路径上的一点（最后一腿平在末根 K 线之后时扫描看不到它）：
  // 战役页同样先扫 K 线再与已实现取最大，峰值不能低于最终盈亏。没有 K 线时它就是唯一的点。
  const peakEquity = Math.max(extremes.maxProfit, finalPnl);
  const troughEquity = Math.min(extremes.maxDrawdown, finalPnl);

  const timelineLegs = heldLegs.length > 0 ? heldLegs : manualLegs;
  const firstTime = timelineLegs[0].open_time;
  const lastTime = timelineLegs.reduce((latest, leg) => (
    new Date(leg.close_time).getTime() > new Date(latest).getTime() ? leg.close_time : latest
  ), timelineLegs[0].close_time);
  /**
   * 手动 Legs 分支原来把保护线**写死成 2%**，既不看这场战役实际挂在哪，
   * 敞口也只有主力一条腿。止损越宽被高估得越离谱：实盘那笔 13.38% 的主力，
   * L 真值 37,781 而这里给 3,530——R 高估 10.7 倍，而它恰恰是最该被警告的一类。
   *
   * 手动腿上带着角色、开仓时刻、开仓价、名义，信息本来就够。映射成合成腿之后
   * 复用同一个 buildSyntheticCampaignAndLegs + computeInitialExpectedMaxLoss，
   * 与战役页、与上面那支反事实**共用一套口径**，不可能再分叉。
   * 锚不出保护线时返回 0（下方 > EPSILON 判断会让 R 显示 0），
   * 绝不拿一个凭空的 2% 顶上——那是在给一个不存在的止损定价。
   */
  const manualSynthetic = buildManualSynthetic(params, validManualLegsInOrder(params, manualLegs), {
    final_realized_pnl: round(finalPnl, RESULT_AMOUNT_DIGITS),
    peak_unrealized_pnl: round(Math.max(0, peakEquity)),
    peak_drawdown: round(Math.abs(Math.min(0, troughEquity))),
  }, economicsOf);
  const anchors = riskAnchorsFromSynthetic(manualSynthetic, riskContextReverseOrders(params.risk_context));
  const plannedMaxLoss = anchors.initialExpectedMaxLoss;

  return {
    // 已实现与 L 都按 8 位小数落库：盈亏比 = 已实现 ÷ L，L 只有几美元时 4 位小数的取整就够把它挪出 0.01 个百分点。
    final_realized_pnl: round(finalPnl, RESULT_AMOUNT_DIGITS),
    final_r_multiple: plannedMaxLoss > EPSILON ? round(finalPnl / plannedMaxLoss) : 0,
    peak_unrealized_pnl: round(Math.max(0, peakEquity)),
    peak_drawdown: round(Math.abs(Math.min(0, troughEquity))),
    profit_capture_ratio: peakEquity > EPSILON
      ? round(clamp((finalPnl / peakEquity) * 100, -999, 999))
      : 0,
    events,
    legs_summary: manualLegs.map<CampaignCounterfactualLegSummary>(leg => {
      const economics = economicsOf(leg);
      const held = leg.filled !== false;
      return {
        leg_role: leg.leg_role,
        placed_at: leg.open_time,
        trigger_price: round(leg.entry_price),
        status: held ? 'filled' : 'never_triggered',
        triggered_at: held ? leg.close_time : null,
        realized_pnl_usdt: round(economics.netPnl),
        close_fee_usdt: round(economics.closeFeeUsdt),
        open_fee_usdt: round(economics.openFeeUsdt),
        pnl_basis: economics.basis,
      };
    }),
    state_segments: [{
      state: 'manual_legs',
      state_label: '手动 Legs 方案',
      start_time: firstTime,
      end_time: lastTime,
    }],
    sop_score: 0,
    ...riskAnchorResultFields(anchors),
    fees_total: round(feesTotal),
    open_fees_total: round(openFeesTotal),
    ...(feeUnknownLegCount > 0 ? { fee_unknown_leg_count: feeUnknownLegCount } : {}),
  };
}

/** 与 journalApi 选引擎的判断同一条：只要有一条手动腿启用，就是手动 Legs 分支。 */
export function isManualLegScenario(params: CampaignCounterfactualParams): boolean {
  return params.manual_legs?.some(leg => leg.enabled) ?? false;
}

/**
 * 同一批有效腿，按副本里的顺序（原始 Legs 的 leg_sequence，新增的腿排在后面）——合成战役按这个顺序排腿，
 * 与战役页读 legs 的顺序一致（主力归属按 leg_sequence 裁决并列）。sorted 是按开仓时间排过的同一批对象。
 */
function validManualLegsInOrder(
  params: CampaignCounterfactualParams,
  sorted: CampaignCounterfactualManualLeg[],
): CampaignCounterfactualManualLeg[] {
  const valid = new Set(sorted);
  return (params.manual_legs ?? []).filter(leg => valid.has(leg));
}

function sortedValidManualLegs(params: CampaignCounterfactualParams): CampaignCounterfactualManualLeg[] {
  return (params.manual_legs ?? [])
    .filter(validManualLeg)
    .sort((a, b) => new Date(a.open_time).getTime() - new Date(b.open_time).getTime());
}

/**
 * 把手动腿映射成合成腿（再为有成交记录的腿造同形的记录）、造合成战役——simulateManualLegScenario 与
 * deriveCounterfactualRiskAnchors 共用，保证「运行时落库的锚」与「老行事后重算的锚」出自同一份映射。
 *
 * 目标是让 resolveMainRiskAnchors / computeInitialMainExposureNotional 读到与战役页**同形**的输入：
 *   · 腿的顺序按副本里的顺序（即原始 Legs 的 leg_sequence），挂出时刻取原始腿的 pre_simulated_time
 *     （同角色的两张保护单按它排先后）；
 *   · 有成交记录的腿配一条合成记录：开平时刻即副本的开平时间（战役页的持仓窗口、归属时刻都按记录），
 *     开仓价是风险锚价，名义是战役页分给它的那份开仓名义，同一笔开仓成交的几条腿共用一个 fillId、并回一组；
 *   · 没有成交记录的腿按 pre_simulated_time 开窗，平仓时间是兜底（挂单、未平仓）时窗口朝右开口，与战役页一样；
 *   · 事件流只放风险锚上下文里的那几样（历史归类、初始对冲委托、带价的初始对冲事件），
 *     不放腿的开平仓事件——多主力时它们会被按时间归属、误当成别的主力的保护线。
 * 未成交的保护单也映射进来：它的挂单价是止损线，L 与预期回撤靠它锚出来；只是不带成交记录。
 */
function buildManualSynthetic(
  params: CampaignCounterfactualParams,
  manualLegs: CampaignCounterfactualManualLeg[],
  base: Pick<CampaignCounterfactualResult, 'final_realized_pnl' | 'peak_unrealized_pnl' | 'peak_drawdown'>,
  economicsOf: (leg: CampaignCounterfactualManualLeg) => ManualLegEconomics = resolveManualLegEconomics,
): RiskAnchorSynthetic {
  const entryDirection = params.entry.direction;
  const syntheticSimLegs: SimulationLeg[] = manualLegs.map((leg, index) => {
    const held = leg.filled !== false;
    const economics = economicsOf(leg);
    return {
      id: leg.id || `manual-leg-${index + 1}`,
      role: leg.leg_role as LegRole,
      kind: leg.leg_role === 'main_open' ? 'main' : leg.leg_role === 'mirror_tp' ? 'mirror_tp' : 'hedge',
      placedAt: leg.open_time,
      triggerPrice: economics.anchorPrice,
      sizeUsdt: economics.exposureUsdt,
      status: held ? 'filled' : 'never_triggered',
      triggeredAt: held ? leg.close_time : null,
      fillPrice: held ? leg.entry_price : null,
      realizedPnlUsdt: economics.netPnl,
      cycle: 1,
      leverage: Number.isFinite(leg.leverage) && leg.leverage > 0 ? leg.leverage : undefined,
    };
  });
  const manualBase = {
    ...base,
    final_r_multiple: 0,
    profit_capture_ratio: 0,
    events: [],
    legs_summary: [],
    state_segments: [],
  } as Omit<CampaignCounterfactualResult, 'sop_score'>;
  const skeleton = buildSyntheticCampaignAndLegs(params, 'main_dual_hedge_mirror_tp', manualBase, [], syntheticSimLegs);

  const records: TradeRecord[] = [];
  const legs = skeleton.legs.map((syntheticLeg, index) => {
    const leg = manualLegs[index];
    const actual = leg.actual;
    const held = leg.filled !== false;
    const economics = economicsOf(leg);
    const openMs = timeMsOr(leg.open_time, 0);
    const closeMs = timeMsOr(leg.close_time, openMs);
    // 开仓时间改了多少，挂出时刻就跟着平移多少。
    const shiftMs = actual ? openMs - timeMsOr(actual.open_time, openMs) : 0;
    const placedMs = actual?.placed_time != null ? timeMsOr(actual.placed_time, openMs) + shiftMs : openMs;
    const hasRecord = held && actual?.has_record === true;
    const closeIsFallback = !held
      || (actual?.close_time_fallback === true && sameInstant(leg.close_time, actual.close_time));
    const direction = actual?.exposure_excluded ? oppositeDirection(entryDirection) : entryDirection;
    const recordId = hasRecord ? `synthetic-record-${index + 1}` : null;
    if (recordId) {
      records.push({
        id: recordId,
        // fillId 有值：战役页不再尝试把它当成合并出来的老记录去解混合（开仓价已经是风险锚价）。
        fillId: actual?.exposure_group ?? recordId,
        symbol: syntheticLeg.symbol,
        side: leg.direction === 'short' ? 'SHORT' : 'LONG',
        type: 'MARKET',
        action: 'CLOSE',
        entryPrice: economics.anchorPrice,
        exitPrice: leg.exit_price,
        quantity: economics.anchorPrice > 0 ? economics.exposureUsdt / economics.anchorPrice : 0,
        leverage: syntheticLeg.leverage,
        pnl: economics.netPnl,
        fee: 0,
        slippage: 0,
        openTime: openMs,
        closeTime: closeMs,
        settlementMode: 'usdt',
      });
    }
    return {
      ...syntheticLeg,
      direction,
      order_kind: actual?.order_kind ?? syntheticLeg.order_kind,
      trade_record_id: recordId,
      pre_simulated_time: new Date(placedMs).toISOString(),
      pre_real_time: new Date(placedMs).toISOString(),
      // 有记录的腿，持仓窗口按记录；没有记录的腿按这一格（战役页 pre_position_size 的位置）计开仓名义。
      pre_position_size: hasRecord ? leg.size_usdt : economics.exposureUsdt,
      post_simulated_close_time: closeIsFallback ? null : new Date(closeMs).toISOString(),
      created_at: new Date(placedMs).toISOString(),
    } as TradeJournal;
  });
  return withRiskContextEvents({ campaign: skeleton.campaign, legs, records }, params.risk_context);
}

/**
 * 只凭 params 重建风险锚（L / 主力开仓名义仓位 / 预期回撤 d / 主力杠杆），不需要 K 线。
 *
 * 用途：老的 campaign_counterfactuals 行没有把这四项随结果落库，读它们时按 params 重算一遍；
 * 新行直接读 result 上的同名字段，两者出自同一份 riskAnchorsFromSynthetic。
 *
 * 手动 Legs 分支：走 buildManualSynthetic，与运行时完全一致；没有一条有效腿时全 0。
 * SOP 分支：只重建入场那一刻的建仓腿（主力 + 初始对冲 A/B + 镜像止盈），挂单价由
 * entry.price 与偏移决定，本来就不依赖 K 线。有重入周期的分支，运行时的合成腿还多几条
 * 同名 mirror_tp，锚可能有微小差异——那种行只在没有落库字段时才会走到这里。
 */
export function deriveCounterfactualRiskAnchors(
  params: CampaignCounterfactualParams,
  template: SupportedTemplate = 'main_dual_hedge_mirror_tp',
): CounterfactualRiskAnchors {
  if (isManualLegScenario(params)) {
    const manualLegs = sortedValidManualLegs(params);
    if (manualLegs.length === 0) return { ...ZERO_RISK_ANCHORS };
    const synthetic = buildManualSynthetic(params, validManualLegsInOrder(params, manualLegs), {
      final_realized_pnl: 0,
      peak_unrealized_pnl: 0,
      peak_drawdown: 0,
    });
    return riskAnchorsFromSynthetic(synthetic, riskContextReverseOrders(params.risk_context));
  }

  const entryMs = new Date(params.entry.time).getTime();
  if (!Number.isFinite(entryMs)) return { ...ZERO_RISK_ANCHORS };
  const state = initialState(params, template);
  placeMainPosition(state, entryMs, params.entry.price, params.entry.size_usdt, 'main_open');
  registerSetupLegs(state, entryMs, params.entry.price, params.entry.size_usdt, state.cycle);
  const base = {
    final_realized_pnl: 0,
    final_r_multiple: 0,
    peak_unrealized_pnl: 0,
    peak_drawdown: 0,
    profit_capture_ratio: 0,
    events: state.events,
    legs_summary: [],
    state_segments: [],
  } as Omit<CampaignCounterfactualResult, 'sop_score'>;
  const synthetic = buildSyntheticCampaignAndLegs(params, template, base, state.events, state.legs);
  return riskAnchorsFromSynthetic(synthetic);
}

function inferActualParams(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[] = [],
): CampaignCounterfactualParams | null {
  const mainLeg = legs.find(leg => leg.leg_role === 'main_open') ?? legs.find(leg => leg.leg_role === 'reentry_main') ?? null;
  if (!mainLeg?.pre_entry_price || !mainLeg.pre_position_size || !mainLeg.leverage) return null;

  // 反事实锚点以「真实成交」为准：主力腿有成交记录时用其成交价 / 成交时间，
  // 让紫色推演轨迹精确贴合实际开仓那根 K 线；没有成交记录才退回计划值 pre_*。
  const mainRecord = mainLeg.trade_record_id
    ? buildTradeRecordLookup(tradeRecords).get(mainLeg.trade_record_id) ?? null
    : null;
  const entryDirection: Direction = campaign.direction === 'main_short' ? 'short' : 'long';
  const entryPrice = mainRecord?.entryPrice && mainRecord.entryPrice > 0 ? mainRecord.entryPrice : mainLeg.pre_entry_price;
  const entryTime = mainRecord?.openTime && mainRecord.openTime > 0
    ? new Date(mainRecord.openTime).toISOString()
    : mainLeg.pre_simulated_time;
  const entrySize = mainLeg.pre_position_size;
  const hedgeA = legs.find(leg => leg.leg_role === 'hedge_initial_a') ?? null;
  const hedgeB = legs.find(leg => leg.leg_role === 'hedge_initial_b') ?? null;
  const mirror = legs.find(leg => leg.leg_role === 'mirror_tp') ?? null;
  const rollingLegs = legs.filter(leg => leg.leg_role === 'hedge_rolling').sort((a, b) =>
    new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime(),
  );
  const hasReentry = legs.some(leg => leg.leg_role === 'reentry_main');
  const reentryMain = legs.find(leg => leg.leg_role === 'reentry_main') ?? null;

  const offsetPct = (price: number | null, fallback: number) => {
    if (!price || entryPrice <= 0) return fallback;
    return ((price / entryPrice) - 1) * 100;
  };
  const sizePct = (size: number | null, fallback: number) => {
    if (!size || entrySize <= 0) return fallback;
    return (size / entrySize) * 100;
  };

  let exitRule: ExitRule = 'close_all_on_hedge_trigger';
  if (hasReentry) exitRule = 'reenter_after_hedge_trigger';
  else if (legs.some(leg => (leg.leg_role === 'hedge_initial_a' || leg.leg_role === 'hedge_initial_b' || leg.leg_role === 'hedge_rolling') && leg.trade_record_id)) {
    exitRule = 'manual_only';
  }

  const reentryDelay = (() => {
    if (!reentryMain) return 30;
    const firstHedgeTime = legs
      .filter(leg => leg.leg_role === 'hedge_initial_a' || leg.leg_role === 'hedge_initial_b')
      .map(leg => new Date(leg.pre_simulated_time).getTime())
      .sort((a, b) => a - b)[0];
    if (!firstHedgeTime) return 30;
    return Math.max(1, Math.round((new Date(reentryMain.pre_simulated_time).getTime() - firstHedgeTime) / 60_000));
  })();

  return {
    entry: {
      time: entryTime,
      price: entryPrice,
      size_usdt: entrySize,
      direction: entryDirection,
      leverage: mainLeg.leverage,
    },
    hedge_a: {
      offset_pct: offsetPct(hedgeA?.pre_entry_price ?? null, entryDirection === 'long' ? -2 : 2),
      size_pct: hedgeA ? sizePct(hedgeA.pre_position_size, 50) : 0,
    },
    hedge_b: {
      offset_pct: offsetPct(hedgeB?.pre_entry_price ?? null, entryDirection === 'long' ? -4 : 4),
      size_pct: hedgeB ? sizePct(hedgeB.pre_position_size, 50) : 0,
    },
    mirror_tp: {
      offset_pct: offsetPct(mirror?.pre_entry_price ?? null, entryDirection === 'long' ? 2 : -2),
      size_pct: mirror ? sizePct(mirror.pre_position_size, MIRROR_TP_REDUCTION_PCT) : 0,
    },
    rolling: {
      enabled: rollingLegs.length > 0,
      trigger_rise_pct: 10,
      min_interval_minutes: rollingLegs.length > 1
        ? Math.max(1, Math.round(
            (new Date(rollingLegs[1].pre_simulated_time).getTime() - new Date(rollingLegs[0].pre_simulated_time).getTime()) / 60_000,
          ))
        : 60,
      new_hedge_offset_pct: rollingLegs[0]?.pre_entry_price
        ? (((rollingLegs[0].pre_entry_price / entryPrice) - 1) * 100)
        : (entryDirection === 'long' ? -2 : 2),
      rolling_hedge_size_pct: rollingLegs[0] ? sizePct(rollingLegs[0].pre_position_size, 100) : 100,
    },
    exit_rule: exitRule,
    reentry: hasReentry
      ? {
          delay_minutes: reentryDelay,
          size_pct: reentryMain?.pre_position_size ? sizePct(reentryMain.pre_position_size, 100) : 100,
        }
      : undefined,
  };
}

export function buildPureSopParams(campaign: TradeCampaign, legs: TradeJournal[], tradeRecords: TradeRecord[] = []): CampaignCounterfactualParams | null {
  const actual = inferActualParams(campaign, legs, tradeRecords);
  if (!actual) return null;
  const isLong = actual.entry.direction === 'long';
  if (campaign.strategy_template === 'main_only') {
    return {
      ...actual,
      hedge_a: { offset_pct: isLong ? -2 : 2, size_pct: 0 },
      hedge_b: { offset_pct: isLong ? -4 : 4, size_pct: 0 },
      mirror_tp: { offset_pct: isLong ? 2 : -2, size_pct: 0 },
      rolling: {
        enabled: false,
        trigger_rise_pct: 10,
        min_interval_minutes: 60,
        new_hedge_offset_pct: isLong ? -2 : 2,
        rolling_hedge_size_pct: 0,
      },
      exit_rule: 'manual_only',
      reentry: undefined,
    };
  }
  return {
    ...actual,
    hedge_a: { offset_pct: isLong ? -2 : 2, size_pct: INITIAL_HEDGE_SIZE_PCT },
    hedge_b: { offset_pct: isLong ? -4 : 4, size_pct: INITIAL_HEDGE_SIZE_PCT },
    mirror_tp: { offset_pct: isLong ? 2 : -2, size_pct: MIRROR_TP_REDUCTION_PCT },
    rolling: {
      enabled: true,
      trigger_rise_pct: 10,
      min_interval_minutes: 60,
      new_hedge_offset_pct: isLong ? -2 : 2,
      rolling_hedge_size_pct: 100,
    },
    exit_rule: 'close_all_on_hedge_trigger',
    reentry: undefined,
  };
}

function applyDeductionFix(
  campaign: TradeCampaign,
  baseParams: CampaignCounterfactualParams,
  deduction: Deduction,
): { params: CampaignCounterfactualParams; fix_description: string } | null {
  const isLong = baseParams.entry.direction === 'long';
  const params: CampaignCounterfactualParams = JSON.parse(JSON.stringify(baseParams));
  const reason = deduction.reason;

  if (reason.includes('缺少 初始对冲 A')) {
    params.hedge_a = { offset_pct: isLong ? -2 : 2, size_pct: INITIAL_HEDGE_SIZE_PCT };
    return { params, fix_description: '补齐 hedge_a' };
  }
  if (reason.includes('缺少 初始对冲 B')) {
    params.hedge_b = { offset_pct: isLong ? -4 : 4, size_pct: INITIAL_HEDGE_SIZE_PCT };
    return { params, fix_description: '补齐 hedge_b' };
  }
  if (reason.includes('缺少 mirror_tp')) {
    params.mirror_tp = { offset_pct: isLong ? 2 : -2, size_pct: MIRROR_TP_REDUCTION_PCT };
    return { params, fix_description: '补齐 mirror_tp' };
  }
  if (reason.includes('hedge_initial_a仓位大小未对齐主仓 50%') || reason.includes('初始对冲 A仓位大小未对齐主仓 50%')) {
    params.hedge_a.size_pct = INITIAL_HEDGE_SIZE_PCT;
    return { params, fix_description: `将 hedge_a 调整为主仓 ${INITIAL_HEDGE_SIZE_PCT}%` };
  }
  if (reason.includes('hedge_initial_b仓位大小未对齐主仓 50%') || reason.includes('初始对冲 B仓位大小未对齐主仓 50%')) {
    params.hedge_b.size_pct = INITIAL_HEDGE_SIZE_PCT;
    return { params, fix_description: `将 hedge_b 调整为主仓 ${INITIAL_HEDGE_SIZE_PCT}%` };
  }
  if (
    reason.includes('mirror_tp 仓位大小未对齐主仓 50%') ||
    reason.includes(`mirror_tp 仓位大小未对齐主仓 ${MIRROR_TP_REDUCTION_PCT}%`) ||
    reason.includes('主力部分平仓比例不等于 50%') ||
    reason.includes(`主力部分平仓比例不等于 ${MIRROR_TP_REDUCTION_PCT}%`)
  ) {
    params.mirror_tp.size_pct = MIRROR_TP_REDUCTION_PCT;
    return { params, fix_description: `将 mirror_tp 调整为主仓 ${MIRROR_TP_REDUCTION_PCT}%` };
  }
  if (reason.includes('mirror_tp 触发后 5 分钟内未取消任一 hedge')) {
    return { params, fix_description: '按时取消 hedge_b' };
  }
  if (reason.includes('mirror_tp 触发后取消了 2 个 hedge')) {
    params.hedge_a.size_pct = INITIAL_HEDGE_SIZE_PCT;
    params.hedge_b.size_pct = INITIAL_HEDGE_SIZE_PCT;
    return { params, fix_description: '仅取消 hedge_b，保留 1 个防守 hedge' };
  }
  if (reason.includes('新 hedge 价格相对旧 hedge 发生反向滚动')) {
    params.rolling.enabled = true;
    params.rolling.new_hedge_offset_pct = isLong ? -2 : 2;
    return { params, fix_description: '恢复顺势滚动方向' };
  }
  if (reason.includes('旧 hedge 取消时间早于新 hedge 挂出时间，存在敞口空窗')) {
    params.rolling.enabled = true;
    return { params, fix_description: '先挂新 hedge 再取消旧 hedge' };
  }
  if (reason.includes('新 hedge 仓位大小不等于当前主仓')) {
    params.rolling.rolling_hedge_size_pct = 100;
    return { params, fix_description: '将滚动 hedge 调整为当前主仓等额' };
  }
  if (reason.includes('触发 exit 事件后 30 分钟内未做出处置决策')) {
    params.exit_rule = 'close_all_on_hedge_trigger';
    params.reentry = undefined;
    return { params, fix_description: '触发 exit 后立即执行处置' };
  }
  if (reason.includes('active 状态超过 7 天未结束')) {
    params.exit_rule = campaign.strategy_template === 'main_only' ? 'manual_only' : 'close_all_on_hedge_trigger';
    return { params, fix_description: '在规则触发时结束战役' };
  }
  if (reason.includes('max_drawdown 占初始保证金超过 10%')) {
    params.hedge_a.offset_pct = isLong ? -2 : 2;
    params.hedge_b.offset_pct = isLong ? -4 : 4;
    return { params, fix_description: '恢复标准防守位，压低回撤' };
  }
  if (reason.includes('整套 setup 用时超过 10 分钟')) {
    return { params, fix_description: '将 setup 同步预挂，避免拖延执行' };
  }
  return null;
}

function deductionKey(deduction: Deduction, index: number) {
  return `${deduction.category}:${index}:${deduction.reason}`;
}

export function buildDeviationFixParams(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  sourceDeductionId: string,
): { params: CampaignCounterfactualParams; fix_description: string } | null {
  if (campaign.strategy_template === 'custom') return null;
  const baseParams = inferActualParams(campaign, legs, tradeRecords) ?? buildPureSopParams(campaign, legs, tradeRecords);
  if (!baseParams) return null;
  const sop = computeSopDeviation(campaign, legs, tradeRecords);
  for (let index = 0; index < sop.deductions.length; index += 1) {
    const deduction = sop.deductions[index];
    if (deductionKey(deduction, index) !== sourceDeductionId) continue;
    return applyDeductionFix(campaign, baseParams, deduction);
  }
  return null;
}

export function computeDeviationCosts(
  actualCampaign: CampaignDeviationCostInput,
  actualResult: ActualCampaignEconomicResult,
  klines: KlineData[],
): DeviationCost[] {
  if (actualCampaign.campaign.strategy_template === 'custom') return [];
  const template = actualCampaign.campaign.strategy_template as SupportedTemplate;
  const baseParams = inferActualParams(actualCampaign.campaign, actualCampaign.legs, actualCampaign.tradeRecords)
    ?? buildPureSopParams(actualCampaign.campaign, actualCampaign.legs, actualCampaign.tradeRecords);
  if (!baseParams) return [];
  const sop: SopDeviationResult = computeSopDeviation(actualCampaign.campaign, actualCampaign.legs, actualCampaign.tradeRecords);
  const accountSize = actualResult.account_size_usdt ?? actualCampaign.account_size_usdt ?? DEFAULT_ACCOUNT_SIZE;

  const costs = sop.deductions.flatMap((deduction, index) => {
    const fix = applyDeductionFix(actualCampaign.campaign, baseParams, deduction);
    if (!fix) return [];
    const simulation = simulateCampaign(fix.params, klines, template);
    const cost = simulation.final_realized_pnl - actualResult.final_realized_pnl;
    return [{
      deduction_category: deduction.category,
      deduction_reason: deduction.reason,
      cost_usdt: round(cost, 2),
      cost_pct_of_account: accountSize > EPSILON ? round((cost / accountSize) * 100, 4) : 0,
      fix_description: fix.fix_description,
      source_deduction_id: deductionKey(deduction, index),
    }];
  });

  return costs.sort((a, b) => b.cost_usdt - a.cost_usdt);
}

export function buildActualSimulationParams(campaign: TradeCampaign, legs: TradeJournal[], tradeRecords: TradeRecord[] = []) {
  return inferActualParams(campaign, legs, tradeRecords);
}
