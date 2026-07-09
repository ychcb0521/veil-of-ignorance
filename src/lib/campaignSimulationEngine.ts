import type { KlineData } from '@/hooks/useBinanceData';
import { computeSopDeviation, type Deduction, type SopDeviationResult } from '@/lib/campaignAnalysis';
import type {
  CampaignCounterfactualEvent,
  CampaignCounterfactualLegSummary,
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  CampaignCounterfactualResult,
  CampaignCounterfactualStateSegment,
  DeviationCost,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const EPSILON = 0.000001;
const DEFAULT_ACCOUNT_SIZE = 10_000;

type SupportedTemplate = 'main_dual_hedge_mirror_tp' | 'main_only';
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
    leverage: params.entry.leverage,
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

function buildResultFromState(state: SimulationState): CampaignCounterfactualResult {
  const plannedMaxLoss = (() => {
    if (!state.activeMain && state.params.entry.size_usdt <= 0) return 0;
    const triggerCandidates = [state.params.hedge_a, state.params.hedge_b]
      .filter(item => item.size_pct > 0)
      .map(item => priceFromOffset(state.params.entry.price, item.offset_pct));
    const firstAdverse = state.params.entry.direction === 'long'
      ? Math.max(...triggerCandidates, -Infinity)
      : Math.min(...triggerCandidates, Infinity);
    if (!Number.isFinite(firstAdverse)) return 0;
    return Math.abs(pnlForClose(
      state.params.entry.direction,
      state.params.entry.price,
      firstAdverse,
      state.params.entry.size_usdt,
      state.params.entry.leverage,
    ));
  })();

  const baseResult = {
    final_realized_pnl: round(state.realizedPnl),
    final_r_multiple: plannedMaxLoss > EPSILON ? round(state.realizedPnl / plannedMaxLoss) : 0,
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
  return {
    ...baseResult,
    sop_score: sop.score ?? 0,
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

export function manualLegPnl(leg: CampaignCounterfactualManualLeg): number {
  return pnlForClose(
    leg.direction,
    leg.entry_price,
    leg.exit_price,
    leg.size_usdt,
    leg.leverage || 1,
  );
}

function manualTimeMs(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function defaultCloseTime(params: CampaignCounterfactualParams, klines: KlineData[]): string {
  const last = klines[klines.length - 1];
  return last ? new Date(last.time).toISOString() : params.entry.time;
}

/**
 * 把战役已归类的 legs 转成「手动反事实」可编辑的腿副本（编辑器初始值 + 偏离代价的原始基线共用）。
 * 价格/平仓时间优先用真实成交记录，其次腿上的回填快照，最后才退回开仓价/末根 K 线。
 */
export function buildManualLegs(
  params: CampaignCounterfactualParams,
  legs: TradeJournal[],
  klines: KlineData[],
  tradeRecords: TradeRecord[],
): CampaignCounterfactualManualLeg[] {
  const fallbackClose = defaultCloseTime(params, klines);
  const recordMap = new Map(tradeRecords.map(record => [record.id, record]));
  const ordered = [...legs].sort((a, b) => {
    const seqA = a.leg_sequence ?? 9999;
    const seqB = b.leg_sequence ?? 9999;
    if (seqA !== seqB) return seqA - seqB;
    return new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime();
  });

  return ordered
    .map((leg, index) => {
      const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      const openTime = leg.pre_simulated_time || params.entry.time;
      const recordCloseIso = record?.closeTime ? new Date(record.closeTime).toISOString() : null;
      const closeTime = recordCloseIso || leg.post_real_close_time || fallbackClose;
      const closeMs = manualTimeMs(closeTime) ?? manualTimeMs(fallbackClose) ?? manualTimeMs(openTime) ?? Date.now();
      const openMs = manualTimeMs(openTime) ?? closeMs;
      const normalizedClose = closeMs >= openMs ? closeTime : new Date(openMs).toISOString();
      const entryPrice = record?.entryPrice ?? leg.pre_entry_price ?? params.entry.price;
      const exitPrice = record?.exitPrice ?? leg.post_exit_price_snapshot ?? entryPrice;
      return {
        id: leg.id || `leg-${index}`,
        leg_role: leg.leg_role ?? 'standalone',
        direction: leg.direction === 'short' ? 'short' : 'long',
        open_time: openTime,
        close_time: normalizedClose,
        entry_price: entryPrice,
        exit_price: exitPrice,
        size_usdt: leg.pre_position_size ?? params.entry.size_usdt,
        leverage: leg.leverage ?? params.entry.leverage ?? 1,
        enabled: true,
      } satisfies CampaignCounterfactualManualLeg;
    })
    .filter(leg => leg.entry_price > 0 && leg.size_usdt > 0);
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
 */
export function computeManualLegDeviationCosts(
  originalLegs: CampaignCounterfactualManualLeg[],
  adjustedLegs: CampaignCounterfactualManualLeg[],
): ManualLegDeviationCost[] {
  const legPnl = (leg: CampaignCounterfactualManualLeg | undefined) =>
    leg && leg.enabled && validManualLeg(leg) ? manualLegPnl(leg) : 0;
  const origById = new Map(originalLegs.map(leg => [leg.id, leg]));
  const adjById = new Map(adjustedLegs.map(leg => [leg.id, leg]));
  const out: ManualLegDeviationCost[] = [];
  for (const adj of adjustedLegs) {
    const cost = legPnl(adj) - legPnl(origById.get(adj.id));
    if (Math.abs(cost) > EPSILON) out.push({ legId: adj.id, leg_role: adj.leg_role, cost_usdt: round(cost, 2) });
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
  const manualLegs = (params.manual_legs ?? [])
    .filter(validManualLeg)
    .sort((a, b) => new Date(a.open_time).getTime() - new Date(b.open_time).getTime());

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
    };
  }

  const events = manualLegs
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

  const finalPnl = manualLegs.reduce((sum, leg) => sum + manualLegPnl(leg), 0);
  let peakEquity = 0;
  let troughEquity = 0;

  if (klines.length > 0) {
    for (const kline of klines) {
      const equity = manualLegs.reduce((sum, leg) => {
        const openMs = new Date(leg.open_time).getTime();
        const closeMs = new Date(leg.close_time).getTime();
        if (kline.time < openMs) return sum;
        if (kline.time >= closeMs) return sum + manualLegPnl(leg);
        return sum + pnlForClose(
          leg.direction,
          leg.entry_price,
          kline.close,
          leg.size_usdt,
          leg.leverage || 1,
        );
      }, 0);
      peakEquity = Math.max(peakEquity, equity);
      troughEquity = Math.min(troughEquity, equity);
    }
  } else {
    peakEquity = Math.max(0, finalPnl);
    troughEquity = Math.min(0, finalPnl);
  }

  const firstTime = manualLegs[0].open_time;
  const lastTime = manualLegs.reduce((latest, leg) => (
    new Date(leg.close_time).getTime() > new Date(latest).getTime() ? leg.close_time : latest
  ), manualLegs[0].close_time);
  const mainLeg = manualLegs.find(leg => leg.leg_role === 'main_open') ?? manualLegs[0];
  const plannedMaxLoss = mainLeg
    ? Math.abs(manualLegPnl({
      ...mainLeg,
      exit_price: params.entry.direction === 'long'
        ? params.entry.price * 0.98
        : params.entry.price * 1.02,
    }))
    : 0;

  return {
    final_realized_pnl: round(finalPnl),
    final_r_multiple: plannedMaxLoss > EPSILON ? round(finalPnl / plannedMaxLoss) : 0,
    peak_unrealized_pnl: round(Math.max(0, peakEquity)),
    peak_drawdown: round(Math.abs(Math.min(0, troughEquity))),
    profit_capture_ratio: peakEquity > EPSILON
      ? round(clamp((finalPnl / peakEquity) * 100, -999, 999))
      : 0,
    events,
    legs_summary: manualLegs.map<CampaignCounterfactualLegSummary>(leg => ({
      leg_role: leg.leg_role,
      placed_at: leg.open_time,
      trigger_price: round(leg.entry_price),
      status: 'filled',
      triggered_at: leg.close_time,
      realized_pnl_usdt: round(manualLegPnl(leg)),
    })),
    state_segments: [{
      state: 'manual_legs',
      state_label: '手动 Legs 方案',
      start_time: firstTime,
      end_time: lastTime,
    }],
    sop_score: 0,
  };
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
    ? tradeRecords.find(record => record.id === mainLeg.trade_record_id) ?? null
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
      size_pct: mirror ? sizePct(mirror.pre_position_size, 50) : 0,
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
    hedge_a: { offset_pct: isLong ? -2 : 2, size_pct: 50 },
    hedge_b: { offset_pct: isLong ? -4 : 4, size_pct: 50 },
    mirror_tp: { offset_pct: isLong ? 2 : -2, size_pct: 50 },
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
    params.hedge_a = { offset_pct: isLong ? -2 : 2, size_pct: 50 };
    return { params, fix_description: '补齐 hedge_a' };
  }
  if (reason.includes('缺少 初始对冲 B')) {
    params.hedge_b = { offset_pct: isLong ? -4 : 4, size_pct: 50 };
    return { params, fix_description: '补齐 hedge_b' };
  }
  if (reason.includes('缺少 mirror_tp')) {
    params.mirror_tp = { offset_pct: isLong ? 2 : -2, size_pct: 50 };
    return { params, fix_description: '补齐 mirror_tp' };
  }
  if (reason.includes('hedge_initial_a仓位大小未对齐主仓 50%') || reason.includes('初始对冲 A仓位大小未对齐主仓 50%')) {
    params.hedge_a.size_pct = 50;
    return { params, fix_description: '将 hedge_a 调整为主仓 50%' };
  }
  if (reason.includes('hedge_initial_b仓位大小未对齐主仓 50%') || reason.includes('初始对冲 B仓位大小未对齐主仓 50%')) {
    params.hedge_b.size_pct = 50;
    return { params, fix_description: '将 hedge_b 调整为主仓 50%' };
  }
  if (reason.includes('mirror_tp 仓位大小未对齐主仓 50%') || reason.includes('主力部分平仓比例不等于 50%')) {
    params.mirror_tp.size_pct = 50;
    return { params, fix_description: '将 mirror_tp 调整为主仓 50%' };
  }
  if (reason.includes('mirror_tp 触发后 5 分钟内未取消任一 hedge')) {
    return { params, fix_description: '按时取消 hedge_b' };
  }
  if (reason.includes('mirror_tp 触发后取消了 2 个 hedge')) {
    params.hedge_a.size_pct = 50;
    params.hedge_b.size_pct = 50;
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
