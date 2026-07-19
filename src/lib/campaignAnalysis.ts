import type { KlineData } from '@/hooks/useBinanceData';
import { MAIN_ADD_ROLES, usesDualHedgeSop } from '@/lib/strategyTemplates';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import { isHistoricalCampaign, type CampaignEvent, type LegRole, type TradeCampaign, type TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, PendingOrder, TradeRecord } from '@/types/trading';

export interface StateSegment {
  state: 'state_0_setup' | 'state_1_lockin' | 'state_2_rolling' | 'state_3_exit';
  state_label: string;
  start_time: string;
  end_time: string;
  triggering_event: CampaignEvent | null;
}

export interface HedgePrecision {
  leg_id: string;
  role: 'hedge_initial_a' | 'hedge_initial_b' | 'hedge_rolling';
  trigger_price: number;
  was_triggered: boolean;
  market_extreme_after_trigger: number | null;
  excess_depth_pct: number | null;
  closest_approach_pct: number | null;
  verdict: string;
}

export interface MirrorTpCapture {
  tp_price: number;
  was_triggered: boolean;
  market_extreme_after_trigger: number | null;
  foregone_profit_pct: number | null;
  closest_approach_pct: number | null;
  verdict: string;
}

export interface DecisionAccuracyResult {
  hedge_precision: HedgePrecision[];
  mirror_tp_capture: MirrorTpCapture | null;
  initial_expected_max_loss: number;
  profit_capture_ratio: number;
  campaign_max_drawdown_real: number;
  campaign_max_profit_real: number;
}

export interface Deduction {
  category: 'setup' | 'lockin' | 'rolling' | 'exit';
  points: number;
  reason: string;
  related_event_ids: string[];
}

export interface SopDeviationResult {
  is_applicable: boolean;
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  deductions: Deduction[];
  total_deductions: number;
  retroactive_leg_count: number;
}

const HEDGE_ROLES: LegRole[] = ['hedge_initial_a', 'hedge_initial_b', 'hedge_rolling'];
const INITIAL_HEDGE_ROLES: LegRole[] = ['hedge_initial_a', 'hedge_initial_b'];
const MAIN_ROLES: LegRole[] = ['main_open', ...MAIN_ADD_ROLES, 'reentry_main'];
const EPSILON = 0.0001;

const toMs = (value: string) => new Date(value).getTime();
const toIso = (value: number) => new Date(value).toISOString();

function legSize(leg: TradeJournal): number | null {
  if (leg.pre_position_size != null) return leg.pre_position_size;
  if (leg.pre_entry_price != null && leg.pre_max_loss_usdt != null) return leg.pre_entry_price * leg.pre_max_loss_usdt;
  return null;
}

function findTradeRecord(leg: TradeJournal, tradeRecords: TradeRecord[]): TradeRecord | null {
  if (!leg.trade_record_id) return null;
  return buildTradeRecordLookup(tradeRecords).get(leg.trade_record_id) ?? null;
}

function tradeRecordNotionalUsd(record: TradeRecord, price = record.entryPrice): number {
  return getPositionNotionalUsd(record.symbol, record, price || record.entryPrice);
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number | null {
  const value = values.find(candidate => Number.isFinite(candidate) && Number(candidate) > EPSILON);
  return value == null ? null : Number(value);
}

function findInitialMainLeg(legs: TradeJournal[]): TradeJournal | null {
  return legs
    .filter(leg => leg.leg_role === 'main_open')
    .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time))[0] ?? null;
}

/**
 * Initial risk anchor used by 盈亏比:
 * main notional x the widest distance from the original main entry to hedge A/B.
 * The denominator describes risk known before execution. Historical role legs
 * are reconstructed from fills, so preserved order snapshots take precedence;
 * actual fill prices are only a fallback when no original snapshot survives.
 */
export function computeInitialExpectedMaxLoss(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): number {
  const mainLeg = findInitialMainLeg(legs);
  const mainRecord = mainLeg ? findTradeRecord(mainLeg, tradeRecords) : null;
  const mainEvent = (campaign.actual_evolution ?? []).find(event =>
    event.leg_role === 'main_open' && firstPositiveNumber(event.entry_price, event.price) != null,
  ) ?? null;
  const entryPrice = firstPositiveNumber(
    mainRecord?.entryPrice,
    mainLeg?.pre_entry_price,
    mainEvent?.entry_price,
    mainEvent?.price,
  );
  const recordNotional = mainRecord ? tradeRecordNotionalUsd(mainRecord, mainRecord.entryPrice) : null;
  const mainNotional = firstPositiveNumber(
    recordNotional,
    mainLeg?.pre_position_size,
    campaign.initial_main_size_usdt,
    mainEvent?.size_usdt,
  );
  if (entryPrice == null || mainNotional == null) return 0;
  const historical = isHistoricalCampaign(campaign);

  const roleHedgePrices = INITIAL_HEDGE_ROLES.flatMap(role => {
    const roleLegs = legs
      .filter(leg => leg.leg_role === role)
      .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
    const plannedLeg = roleLegs.find(leg => firstPositiveNumber(leg.pre_entry_price) != null) ?? null;
    const plannedPrice = firstPositiveNumber(plannedLeg?.pre_entry_price);
    if (plannedPrice != null) return [plannedPrice];

    const recordLeg = roleLegs.find(leg => findTradeRecord(leg, tradeRecords) != null) ?? null;
    const recordPrice = recordLeg
      ? firstPositiveNumber(findTradeRecord(recordLeg, tradeRecords)?.entryPrice)
      : null;
    if (recordPrice != null) return [recordPrice];

    const event = (campaign.actual_evolution ?? [])
      .filter(item => item.leg_role === role)
      .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
      .find(item => firstPositiveNumber(item.entry_price, item.price) != null);
    const eventPrice = firstPositiveNumber(event?.entry_price, event?.price);
    return eventPrice == null ? [] : [eventPrice];
  });
  const expectedSide = campaign.direction === 'main_long' ? 'SHORT' : 'LONG';
  const initialReversePrices: number[] = [];
  for (const order of [...reverseHedgeOrders]
    .filter(item => item.side === expectedSide && firstPositiveNumber(item.price) != null)
    .sort((a, b) => a.createdAt - b.createdAt)) {
    const duplicate = initialReversePrices.some(existing =>
      Math.abs(existing - order.price) <= Math.max(EPSILON, Math.abs(existing) * 1e-6),
    );
    if (!duplicate) initialReversePrices.push(order.price);
    if (initialReversePrices.length >= INITIAL_HEDGE_ROLES.length) break;
  }

  // Historical A/B legs are reconstructed from fills, so their entry prices can
  // include slippage. When original order snapshots exist, those snapshots are
  // the only valid ex-ante risk boundary. Role prices remain the fallback for
  // older campaigns that have no preserved order history at all.
  const hedgePrices = historical && initialReversePrices.length > 0
    ? [...initialReversePrices]
    : [...roleHedgePrices];
  if (hedgePrices.length < INITIAL_HEDGE_ROLES.length && !historical) {
    for (const price of initialReversePrices) {
      const duplicate = hedgePrices.some(existing =>
        Math.abs(existing - price) <= Math.max(EPSILON, Math.abs(existing) * 1e-6),
      );
      if (!duplicate) hedgePrices.push(price);
      if (hedgePrices.length >= INITIAL_HEDGE_ROLES.length) break;
    }
  }
  if (hedgePrices.length === 0) return 0;

  const widestRiskRate = Math.max(...hedgePrices.map(price => Math.abs(price - entryPrice) / entryPrice));
  return widestRiskRate * mainNotional;
}

export interface CampaignInitialRiskFraction {
  /** Initial maximum expected loss L_i in USDT. */
  initialExpectedMaxLoss: number;
  /** Account equity snapshot A_i captured immediately before the main entry. */
  accountEquityAtMainOpen: number;
  /** Actual fraction of account equity at risk: x_i = L_i / A_i. */
  drawdownFraction: number;
}

export type CampaignInitialRiskSource = 'main_open_snapshot' | 'current_account_fallback';

export interface ResolvedCampaignInitialRiskFraction extends CampaignInitialRiskFraction {
  source: CampaignInitialRiskSource;
}

/**
 * Reconstruct the actual capital fraction risked by one campaign.
 *
 * The denominator must be the immutable account-equity snapshot attached to
 * the initial main leg. Current equity and later-leg snapshots are not valid
 * substitutes because they would introduce hindsight into historical results.
 */
export function computeCampaignInitialRiskFraction(
  initialExpectedMaxLoss: number,
  legs: TradeJournal[],
): CampaignInitialRiskFraction | null {
  if (!Number.isFinite(initialExpectedMaxLoss) || initialExpectedMaxLoss <= EPSILON) return null;
  const mainLeg = findInitialMainLeg(legs);
  const accountEquityAtMainOpen = Number(mainLeg?.pre_account_equity_usdt);
  if (!Number.isFinite(accountEquityAtMainOpen) || accountEquityAtMainOpen <= EPSILON) return null;
  return {
    initialExpectedMaxLoss,
    accountEquityAtMainOpen,
    drawdownFraction: initialExpectedMaxLoss / accountEquityAtMainOpen,
  };
}

/**
 * Resolve one campaign's risk fraction without overwriting historical data.
 * A saved main-entry snapshot always wins. The live-account fallback exists
 * only for legacy rows that predate that snapshot field.
 */
export function resolveCampaignInitialRiskFraction(
  initialExpectedMaxLoss: number,
  legs: TradeJournal[],
  currentAccountEquityFallback: number | null = null,
): ResolvedCampaignInitialRiskFraction | null {
  const captured = computeCampaignInitialRiskFraction(initialExpectedMaxLoss, legs);
  if (captured) {
    return { ...captured, source: 'main_open_snapshot' };
  }

  const fallbackEquity = Number(currentAccountEquityFallback);
  if (
    !Number.isFinite(initialExpectedMaxLoss)
    || initialExpectedMaxLoss <= EPSILON
    || !Number.isFinite(fallbackEquity)
    || fallbackEquity <= EPSILON
  ) {
    return null;
  }

  return {
    initialExpectedMaxLoss,
    accountEquityAtMainOpen: fallbackEquity,
    drawdownFraction: initialExpectedMaxLoss / fallbackEquity,
    source: 'current_account_fallback',
  };
}

function computeRealizedPnl(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): number {
  const campaignPnl = Number.isFinite(campaign.final_realized_pnl)
    ? Number(campaign.final_realized_pnl)
    : null;
  const historical = isHistoricalCampaign(campaign);
  if (campaignPnl != null && !historical) return campaignPnl;

  const recordMap = buildTradeRecordLookup(tradeRecords);
  const pnlByIdentity = new Map<string, number>();

  // Lowest-priority historical source first; later sources overwrite the same
  // trade identity without adding it twice.
  const legById = new Map(legs.map(leg => [leg.id, leg]));
  for (const event of [...(campaign.actual_evolution ?? [])]
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))) {
    if (!Number.isFinite(event.realized_pnl)) continue;
    if (!event.leg_role && !event.trade_record_id && !event.journal_id) continue;
    const linkedLeg = event.journal_id ? legById.get(event.journal_id) ?? null : null;
    const recordReference = event.trade_record_id ?? linkedLeg?.trade_record_id;
    const identity = recordReference
      ? recordMap.get(recordReference)?.id ?? recordReference
      : null;
    pnlByIdentity.set(identity ? `record:${identity}` : `journal:${event.journal_id ?? event.id}`, Number(event.realized_pnl));
  }

  for (const leg of legs) {
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    const pnl = leg.post_realized_pnl;
    if (!Number.isFinite(pnl)) continue;
    const identity = record?.id ?? leg.trade_record_id;
    pnlByIdentity.set(identity ? `record:${identity}` : `journal:${leg.id}`, Number(pnl));
  }
  for (const record of tradeRecords) {
    if (!Number.isFinite(record.pnl)) continue;
    pnlByIdentity.set(`record:${record.id}`, Number(record.pnl));
  }

  if (pnlByIdentity.size > 0) {
    return Array.from(pnlByIdentity.values()).reduce((sum, pnl) => sum + pnl, 0);
  }
  return campaignPnl ?? 0;
}

export function computeProfitCaptureRatio(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): number {
  const initialExpectedMaxLoss = computeInitialExpectedMaxLoss(
    campaign,
    legs,
    tradeRecords,
    reverseHedgeOrders,
  );
  if (initialExpectedMaxLoss <= EPSILON) return 0;
  return (computeRealizedPnl(campaign, legs, tradeRecords) / initialExpectedMaxLoss) * 100;
}

export function formatCampaignPayoffRatio(value: number, percentDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(percentDigits)}%（${(value / 100).toFixed(2)}）`;
}

function eventTradeRecord(
  event: CampaignEvent,
  tradeRecords: TradeRecord[],
  journalRecordIds: Map<string, string>,
): TradeRecord | null {
  const recordId = event.trade_record_id ?? (event.journal_id ? journalRecordIds.get(event.journal_id) ?? null : null);
  if (!recordId) return null;
  return buildTradeRecordLookup(tradeRecords).get(recordId) ?? null;
}

function isCanonicalSyntheticEvent(event: CampaignEvent, leg: TradeJournal | null): boolean {
  if (!leg?.leg_role) return false;
  if (leg.leg_role === 'mirror_tp') return event.event_type === 'mirror_tp_triggered';
  if (HEDGE_ROLES.includes(leg.leg_role)) return event.event_type === 'hedge_triggered';
  if (MAIN_ROLES.includes(leg.leg_role)) {
    return event.event_type === 'main_partial_closed' || event.event_type === 'main_fully_closed';
  }
  return false;
}

function normalizeEventSnapshotFromRecord(event: CampaignEvent, record: TradeRecord): CampaignEvent {
  const openIso = toIso(record.openTime);
  const closeIso = toIso(record.closeTime);
  const next: CampaignEvent = {
    ...event,
    trade_record_id: record.id,
    direction: record.side === 'SHORT' ? 'short' : 'long',
    leverage: record.leverage,
    open_time: openIso,
    close_time: closeIso,
    entry_price: record.entryPrice,
    exit_price: record.exitPrice,
    realized_pnl: record.pnl,
  };

  if (
    event.event_type === 'main_partial_closed' ||
    event.event_type === 'main_fully_closed' ||
    event.event_type === 'mirror_tp_triggered'
  ) {
    next.timestamp = closeIso;
    next.price = record.exitPrice;
    next.size_usdt = tradeRecordNotionalUsd(record, record.exitPrice);
  } else if (event.event_type === 'hedge_triggered') {
    next.timestamp = openIso;
    next.price = record.entryPrice;
    next.size_usdt = tradeRecordNotionalUsd(record, record.entryPrice);
  }

  return next;
}

export function buildCampaignEventStream(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): CampaignEvent[] {
  const legByJournalId = new Map(legs.map(leg => [leg.id, leg]));
  const legByRecordId = new Map(
    legs
      .filter(leg => Boolean(leg.trade_record_id))
      .map(leg => [leg.trade_record_id as string, leg]),
  );
  const journalRecordIds = new Map(
    legs
      .filter(leg => Boolean(leg.trade_record_id))
      .map(leg => [leg.id, leg.trade_record_id as string]),
  );
  const events: CampaignEvent[] = [...(campaign.actual_evolution ?? [])].flatMap(event => {
    const record = eventTradeRecord(event, tradeRecords, journalRecordIds);
    if (!record) return [{ ...event }];
    const leg = (event.journal_id ? legByJournalId.get(event.journal_id) ?? null : null)
      ?? legByRecordId.get(record.id)
      ?? null;
    const normalized = normalizeEventSnapshotFromRecord(event, record);
    return isCanonicalSyntheticEvent(normalized, leg) ? [] : [normalized];
  });

  for (const leg of legs) {
    const tradeRecord = findTradeRecord(leg, tradeRecords);
    if (!tradeRecord) continue;
    if (leg.leg_role === 'mirror_tp') {
      events.push({
        id: `synthetic-${leg.id}-mirror-tp`,
        timestamp: new Date(tradeRecord.closeTime).toISOString(),
        event_type: 'mirror_tp_triggered',
        leg_role: leg.leg_role,
        journal_id: leg.id,
        trade_record_id: tradeRecord.id,
        pending_order_id: null,
        price: tradeRecord.exitPrice,
        size_usdt: tradeRecordNotionalUsd(tradeRecord, tradeRecord.exitPrice),
        notes: null,
        recorded_at: new Date(tradeRecord.closeTime).toISOString(),
      });
      continue;
    }

    if (leg.leg_role && HEDGE_ROLES.includes(leg.leg_role)) {
      events.push({
        id: `synthetic-${leg.id}-hedge-triggered`,
        timestamp: new Date(tradeRecord.openTime).toISOString(),
        event_type: 'hedge_triggered',
        leg_role: leg.leg_role,
        journal_id: leg.id,
        trade_record_id: tradeRecord.id,
        pending_order_id: null,
        price: tradeRecord.entryPrice,
        size_usdt: tradeRecordNotionalUsd(tradeRecord, tradeRecord.entryPrice),
        notes: null,
        recorded_at: new Date(tradeRecord.openTime).toISOString(),
      });
      continue;
    }

    if (leg.leg_role && MAIN_ROLES.includes(leg.leg_role)) {
      const mainSize = leg.pre_position_size ?? tradeRecordNotionalUsd(tradeRecord, tradeRecord.entryPrice);
      const closedNotional = tradeRecordNotionalUsd(tradeRecord, tradeRecord.exitPrice);
      const isPartial = mainSize > EPSILON && closedNotional < mainSize * 0.95;
      events.push({
        id: `synthetic-${leg.id}-${isPartial ? 'main-partial' : 'main-full'}`,
        timestamp: new Date(tradeRecord.closeTime).toISOString(),
        event_type: isPartial ? 'main_partial_closed' : 'main_fully_closed',
        leg_role: leg.leg_role,
        journal_id: leg.id,
        trade_record_id: tradeRecord.id,
        pending_order_id: null,
        price: tradeRecord.exitPrice,
        size_usdt: closedNotional,
        notes: null,
        recorded_at: new Date(tradeRecord.closeTime).toISOString(),
      });
    }
  }

  if (campaign.closed_at && !events.some(event => event.event_type === 'campaign_closed')) {
    events.push({
      id: `synthetic-${campaign.id}-closed`,
      timestamp: campaign.closed_at,
      event_type: 'campaign_closed',
      leg_role: null,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: null,
      size_usdt: null,
      notes: campaign.notes ?? null,
      recorded_at: campaign.closed_at,
    });
  }

  return events.sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
}

function campaignEndMs(campaign: TradeCampaign, tradeRecords: TradeRecord[]) {
  const latestRecord = tradeRecords.reduce((max, record) => Math.max(max, record.closeTime, record.openTime), 0);
  return campaign.closed_at ? toMs(campaign.closed_at) : Math.max(latestRecord, toMs(campaign.opened_at));
}

export function deriveCampaignStates(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): StateSegment[] {
  const events = buildCampaignEventStream(campaign, legs, tradeRecords);
  const startMs = toMs(campaign.opened_at);
  const endMs = campaignEndMs(campaign, tradeRecords);

  const pushSegment = (
    out: StateSegment[],
    state: StateSegment['state'],
    state_label: string,
    start: number,
    end: number,
    triggering_event: CampaignEvent | null,
  ) => {
    if (end <= start) return;
    out.push({
      state,
      state_label,
      start_time: toIso(start),
      end_time: toIso(end),
      triggering_event,
    });
  };

  const exitEvent = events.find(event => event.event_type === 'hedge_triggered' || event.event_type === 'main_fully_closed') ?? null;
  const closeEvent = events.find(event => event.event_type === 'campaign_closed') ?? null;
  const exitStartMs = exitEvent ? toMs(exitEvent.timestamp) : (closeEvent ? toMs(closeEvent.timestamp) : endMs);

  if (!usesDualHedgeSop(campaign.strategy_template)) {
    const out: StateSegment[] = [];
    pushSegment(out, 'state_0_setup', '完整结构', startMs, exitStartMs, null);
    pushSegment(out, 'state_3_exit', '已退场', exitStartMs, closeEvent ? toMs(closeEvent.timestamp) : endMs, exitEvent);
    return out;
  }

  const mirrorTpTriggered = events.find(event => event.event_type === 'mirror_tp_triggered') ?? null;
  const hedgeRollingPlaced = events.find(event => event.event_type === 'hedge_placed' && event.leg_role === 'hedge_rolling') ?? null;
  const mirrorMs = mirrorTpTriggered ? toMs(mirrorTpTriggered.timestamp) : exitStartMs;
  const rollingMs = hedgeRollingPlaced ? toMs(hedgeRollingPlaced.timestamp) : exitStartMs;
  const closeMs = closeEvent ? toMs(closeEvent.timestamp) : endMs;

  const out: StateSegment[] = [];
  pushSegment(out, 'state_0_setup', '完整结构', startMs, mirrorMs, mirrorTpTriggered);
  if (mirrorTpTriggered) {
    pushSegment(out, 'state_1_lockin', '已锁定不亏', mirrorMs, rollingMs, hedgeRollingPlaced ?? exitEvent);
  }
  if (hedgeRollingPlaced) {
    pushSegment(out, 'state_2_rolling', '滚动跟随', rollingMs, exitStartMs, exitEvent);
  }
  pushSegment(out, 'state_3_exit', '已退场', exitStartMs, closeMs, exitEvent ?? closeEvent);
  return out;
}

function getKlinesInRange(klines: KlineData[], fromMs: number, toMs: number) {
  return klines.filter(kline => kline.time >= fromMs && kline.time <= toMs);
}

function buildActiveLegs(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): Array<{
  id: string;
  journalId: string;
  role: LegRole | null;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  startMs: number;
  endMs: number;
}> {
  const endMs = campaignEndMs(campaign, tradeRecords);
  const syntheticEvents = buildCampaignEventStream(campaign, legs, tradeRecords);

  return legs.flatMap(leg => {
    const record = findTradeRecord(leg, tradeRecords);

    if (leg.leg_role === 'mirror_tp') return [];

    if (record) {
      return [{
        id: record.id,
        journalId: leg.id,
        role: leg.leg_role,
        side: record.side,
        quantity: record.quantity,
        entryPrice: record.entryPrice,
        startMs: record.openTime,
        endMs: record.closeTime || endMs,
      }];
    }

    if (leg.leg_role && MAIN_ROLES.includes(leg.leg_role) && leg.pre_entry_price != null && leg.pre_position_size != null) {
      return [{
        id: `open-${leg.id}`,
        journalId: leg.id,
        role: leg.leg_role,
        side: leg.direction === 'short' ? 'SHORT' : 'LONG',
        quantity: leg.pre_position_size / leg.pre_entry_price,
        entryPrice: leg.pre_entry_price,
        startMs: toMs(leg.pre_simulated_time),
        endMs,
      }];
    }

    if (leg.leg_role && HEDGE_ROLES.includes(leg.leg_role) && leg.pre_entry_price != null && leg.pre_position_size != null) {
      const triggerEvent = syntheticEvents.find(event =>
        event.journal_id === leg.id && event.event_type === 'hedge_triggered',
      );
      if (!triggerEvent) return [];
      const side = campaign.direction === 'main_long' ? 'SHORT' : 'LONG';
      return [{
        id: `synthetic-hedge-${leg.id}`,
        journalId: leg.id,
        role: leg.leg_role,
        side,
        quantity: leg.pre_position_size / leg.pre_entry_price,
        entryPrice: leg.pre_entry_price,
        startMs: toMs(triggerEvent.timestamp),
        endMs,
      }];
    }

    return [];
  });
}

function verdictByThresholds(value: number, thresholds: number[], labels: string[]) {
  if (value < thresholds[0]) return labels[0];
  if (value < thresholds[1]) return labels[1];
  if (value < thresholds[2]) return labels[2];
  return labels[3];
}

export function computeDecisionAccuracy(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  klines: KlineData[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[] = [],
): DecisionAccuracyResult {
  const isLongCampaign = campaign.direction === 'main_long';
  const endMs = campaignEndMs(campaign, tradeRecords);
  const hedge_precision: HedgePrecision[] = [];

  for (const leg of legs) {
    if (!leg.leg_role || !HEDGE_ROLES.includes(leg.leg_role) || leg.pre_entry_price == null) continue;
    const record = findTradeRecord(leg, tradeRecords);
    if (record) {
      const hedgeRole = leg.leg_role as HedgePrecision['role'];
      const range = getKlinesInRange(klines, record.openTime, endMs);
      const extreme = range.length === 0
        ? leg.pre_entry_price
        : (isLongCampaign
          ? Math.min(...range.map(k => k.low))
          : Math.max(...range.map(k => k.high)));
      const excess = isLongCampaign
        ? ((leg.pre_entry_price - extreme) / leg.pre_entry_price) * 100
        : ((extreme - leg.pre_entry_price) / leg.pre_entry_price) * 100;

      hedge_precision.push({
        leg_id: leg.id,
        role: hedgeRole,
        trigger_price: leg.pre_entry_price,
        was_triggered: true,
        market_extreme_after_trigger: extreme,
        excess_depth_pct: Math.max(0, excess),
        closest_approach_pct: null,
        verdict: verdictByThresholds(
          Math.max(0, excess),
          [0.5, 3, 8],
          ['止跌精准', '小幅深探', '过早设防', '深度套牢'],
        ),
      });
    } else {
      const hedgeRole = leg.leg_role as HedgePrecision['role'];
      const cancelEvent = buildCampaignEventStream(campaign, legs, tradeRecords).find(event =>
        event.leg_role === leg.leg_role && event.event_type === 'hedge_cancelled' && event.journal_id === leg.id,
      );
      const range = getKlinesInRange(klines, toMs(leg.pre_simulated_time), cancelEvent ? toMs(cancelEvent.timestamp) : endMs);
      const extreme = range.length === 0
        ? leg.pre_entry_price
        : (isLongCampaign
          ? Math.min(...range.map(k => k.low))
          : Math.max(...range.map(k => k.high)));
      const closest = isLongCampaign
        ? ((leg.pre_entry_price - extreme) / leg.pre_entry_price) * 100
        : ((extreme - leg.pre_entry_price) / leg.pre_entry_price) * 100;
      hedge_precision.push({
        leg_id: leg.id,
        role: hedgeRole,
        trigger_price: leg.pre_entry_price,
        was_triggered: false,
        market_extreme_after_trigger: null,
        excess_depth_pct: null,
        closest_approach_pct: Math.max(0, closest),
        verdict: Math.max(0, closest) < 1 ? '险些触发' : Math.max(0, closest) <= 5 ? '保险充裕' : '设置过远',
      });
    }
  }

  const mirrorLeg = legs.find(leg => leg.leg_role === 'mirror_tp' && leg.pre_entry_price != null) ?? null;
  let mirror_tp_capture: MirrorTpCapture | null = null;
  if (mirrorLeg && mirrorLeg.pre_entry_price != null) {
    const record = findTradeRecord(mirrorLeg, tradeRecords);
    if (record) {
      const range = getKlinesInRange(klines, record.closeTime, endMs);
      const extreme = range.length === 0
        ? mirrorLeg.pre_entry_price
        : (isLongCampaign
          ? Math.max(...range.map(k => k.high))
          : Math.min(...range.map(k => k.low)));
      const foregone = isLongCampaign
        ? ((extreme - mirrorLeg.pre_entry_price) / mirrorLeg.pre_entry_price) * 100
        : ((mirrorLeg.pre_entry_price - extreme) / mirrorLeg.pre_entry_price) * 100;
      mirror_tp_capture = {
        tp_price: mirrorLeg.pre_entry_price,
        was_triggered: true,
        market_extreme_after_trigger: extreme,
        foregone_profit_pct: Math.max(0, foregone),
        closest_approach_pct: null,
        verdict: Math.max(0, foregone) < 2 ? '精准锁利' : Math.max(0, foregone) <= 10 ? '部分让利' : '过早止盈',
      };
    } else {
      const range = getKlinesInRange(klines, toMs(mirrorLeg.pre_simulated_time), endMs);
      const extreme = range.length === 0
        ? mirrorLeg.pre_entry_price
        : (isLongCampaign
          ? Math.max(...range.map(k => k.high))
          : Math.min(...range.map(k => k.low)));
      const closest = isLongCampaign
        ? ((extreme - mirrorLeg.pre_entry_price) / mirrorLeg.pre_entry_price) * 100
        : ((mirrorLeg.pre_entry_price - extreme) / mirrorLeg.pre_entry_price) * 100;
      mirror_tp_capture = {
        tp_price: mirrorLeg.pre_entry_price,
        was_triggered: false,
        market_extreme_after_trigger: null,
        foregone_profit_pct: null,
        closest_approach_pct: closest,
        verdict: '未触发',
      };
    }
  }

  const activeLegs = buildActiveLegs(campaign, legs, tradeRecords);
  let maxProfit = 0;
  let maxDrawdown = 0;
  for (const kline of klines) {
    let total = 0;
    for (const leg of activeLegs) {
      if (kline.time < leg.startMs || kline.time > leg.endMs) continue;
      const pnl = leg.side === 'LONG'
        ? (kline.close - leg.entryPrice) * leg.quantity
        : (leg.entryPrice - kline.close) * leg.quantity;
      total += pnl;
    }
    maxProfit = Math.max(maxProfit, total);
    maxDrawdown = Math.min(maxDrawdown, total);
  }

  const initial_expected_max_loss = computeInitialExpectedMaxLoss(
    campaign,
    legs,
    tradeRecords,
    reverseHedgeOrders,
  );
  const profit_capture_ratio = computeProfitCaptureRatio(
    campaign,
    legs,
    tradeRecords,
    reverseHedgeOrders,
  );

  return {
    hedge_precision,
    mirror_tp_capture,
    initial_expected_max_loss,
    profit_capture_ratio,
    campaign_max_drawdown_real: Math.abs(maxDrawdown),
    campaign_max_profit_real: maxProfit,
  };
}

function gradeForScore(score: number): SopDeviationResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function toleranceEqual(value: number | null, target: number | null, tolerancePct: number) {
  if (value == null || target == null || Math.abs(target) < EPSILON) return false;
  return Math.abs(value - target) / target <= tolerancePct;
}

function deductionCategoryForLeg(role: LegRole | null): Deduction['category'] {
  if (role === 'mirror_tp') return 'lockin';
  if (role === 'hedge_rolling') return 'rolling';
  if (role === 'reentry_main' || role === 'reentry_hedge') return 'exit';
  return 'setup';
}

export function computeSopDeviation(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): SopDeviationResult {
  if (campaign.strategy_template === 'custom') {
    return {
      is_applicable: false,
      score: null,
      grade: null,
      deductions: [],
      total_deductions: 0,
      retroactive_leg_count: 0,
    };
  }

  const events = buildCampaignEventStream(campaign, legs, tradeRecords);
  const deductions: Deduction[] = [];
  const addDeduction = (category: Deduction['category'], points: number, reason: string, related_event_ids: string[]) => {
    deductions.push({ category, points, reason, related_event_ids });
  };
  const retroactiveLegs = legs.filter(leg => leg.source === 'retroactive_from_record');
  const retroactiveLegIds = new Set(retroactiveLegs.map(leg => leg.id));
  const liveLegs = legs.filter(leg => leg.source !== 'retroactive_from_record');

  for (const retroLeg of retroactiveLegs) {
    addDeduction(
      deductionCategoryForLeg(retroLeg.leg_role),
      0,
      `${retroLeg.leg_role ?? 'unknown'} 为历史回填，本项扣分跳过`,
      [retroLeg.id],
    );
  }

  const mainLeg = liveLegs.find(leg => leg.leg_role === 'main_open') ?? liveLegs.find(leg => leg.leg_role === 'reentry_main') ?? null;
  const mainSize = mainLeg ? legSize(mainLeg) : null;
  const mainLeverage = mainLeg?.leverage ?? campaign.initial_leverage ?? null;
  const requiredSetupRoles: LegRole[] = campaign.strategy_template === 'main_only'
    ? ['main_open']
    : ['main_open', 'hedge_initial_a', 'hedge_initial_b', 'mirror_tp'];
  for (const role of requiredSetupRoles) {
    if (!legs.some(leg => leg.leg_role === role)) {
      const points = role === 'main_open' ? 30 : 10;
      addDeduction('setup', points, `缺少 ${role === 'main_open' ? '主力开仓' : role === 'mirror_tp' ? 'mirror_tp' : LEGEND[role]}`, []);
    }
  }

  if (usesDualHedgeSop(campaign.strategy_template) && mainSize != null) {
    for (const role of ['hedge_initial_a', 'hedge_initial_b'] as const) {
      const leg = liveLegs.find(item => item.leg_role === role) ?? null;
      if (leg && !toleranceEqual(legSize(leg), mainSize * 0.5, 0.05)) {
        addDeduction('setup', 3, `${LEGEND[role]}仓位大小未对齐主仓 50%`, [leg.id]);
      }
    }
    const mirrorLeg = liveLegs.find(item => item.leg_role === 'mirror_tp') ?? null;
    if (mirrorLeg && !toleranceEqual(legSize(mirrorLeg), mainSize * 0.5, 0.05)) {
      addDeduction('setup', 3, 'mirror_tp 仓位大小未对齐主仓 50%', [mirrorLeg.id]);
    }
  }

  const setupLegs = liveLegs.filter(leg =>
    leg.leg_role === 'main_open' ||
    leg.leg_role === 'hedge_initial_a' ||
    leg.leg_role === 'hedge_initial_b' ||
    leg.leg_role === 'mirror_tp',
  );
  if (setupLegs.length > 1) {
    const times = setupLegs.map(leg => toMs(leg.pre_simulated_time)).sort((a, b) => a - b);
    if (times[times.length - 1] - times[0] > 10 * 60_000) {
      addDeduction('setup', 5, '整套 setup 用时超过 10 分钟', setupLegs.map(leg => leg.id));
    }
  }

  const mirrorTriggered = events.find(event => event.event_type === 'mirror_tp_triggered' && (!event.journal_id || !retroactiveLegIds.has(event.journal_id))) ?? null;
  if (usesDualHedgeSop(campaign.strategy_template) && mirrorTriggered) {
    const tpMs = toMs(mirrorTriggered.timestamp);
    const cancelWithinFive = events.filter(event =>
      event.event_type === 'hedge_cancelled' &&
      toMs(event.timestamp) >= tpMs &&
      toMs(event.timestamp) <= tpMs + 5 * 60_000,
    );
    if (cancelWithinFive.length === 0) {
      addDeduction('lockin', 10, 'mirror_tp 触发后 5 分钟内未取消任一 hedge', [mirrorTriggered.id]);
    }
    if (cancelWithinFive.length >= 2) {
      addDeduction('lockin', 15, 'mirror_tp 触发后取消了 2 个 hedge', cancelWithinFive.map(event => event.id));
    }
    const mirrorLeg = liveLegs.find(leg => leg.leg_role === 'mirror_tp') ?? null;
    if (mirrorLeg && mainSize != null && !toleranceEqual(legSize(mirrorLeg), mainSize * 0.5, 0.05)) {
      addDeduction('lockin', 5, '主力部分平仓比例不等于 50%', [mirrorLeg.id]);
    }
  }

  if (usesDualHedgeSop(campaign.strategy_template)) {
    const rollingLegs = liveLegs.filter(leg => leg.leg_role === 'hedge_rolling').sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
    const orderedHedges = liveLegs
      .filter(leg => leg.leg_role && [...HEDGE_ROLES, 'reentry_hedge'].includes(leg.leg_role))
      .sort((a, b) => toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time));
    for (const rollingLeg of rollingLegs) {
      const rollingPrice = rollingLeg.pre_entry_price;
      const previousHedge = orderedHedges
        .filter(leg => leg.id !== rollingLeg.id && toMs(leg.pre_simulated_time) < toMs(rollingLeg.pre_simulated_time))
        .slice(-1)[0];
      if (rollingPrice != null && previousHedge?.pre_entry_price != null) {
        const wrongDirection = campaign.direction === 'main_long'
          ? rollingPrice <= previousHedge.pre_entry_price
          : rollingPrice >= previousHedge.pre_entry_price;
        if (wrongDirection) {
          addDeduction('rolling', 5, '新 hedge 价格相对旧 hedge 发生反向滚动', [rollingLeg.id, previousHedge.id]);
        }
      }
      const cancelEvent = events.find(event =>
        event.event_type === 'hedge_cancelled' &&
        toMs(event.timestamp) < toMs(rollingLeg.pre_simulated_time),
      );
      if (cancelEvent) {
        addDeduction('rolling', 3, '旧 hedge 取消时间早于新 hedge 挂出时间，存在敞口空窗', [cancelEvent.id, rollingLeg.id]);
      }
      if (mainSize != null && !toleranceEqual(legSize(rollingLeg), mainSize, 0.05)) {
        addDeduction('rolling', 3, '新 hedge 仓位大小不等于当前主仓', [rollingLeg.id]);
      }
    }
  }

  const exitTrigger = events.find(event =>
    (event.event_type === 'hedge_triggered' || event.event_type === 'main_fully_closed') &&
    (!event.journal_id || !retroactiveLegIds.has(event.journal_id)),
  ) ?? null;
  if (exitTrigger) {
    const triggerMs = toMs(exitTrigger.timestamp);
    const nextDecision = events.find(event =>
      toMs(event.timestamp) > triggerMs &&
      toMs(event.timestamp) <= triggerMs + 30 * 60_000 &&
      (
        event.event_type === 'main_fully_closed' ||
        event.event_type === 'hedge_cancelled' ||
        event.event_type === 'hedge_placed' ||
        event.event_type === 'campaign_closed'
      ),
    );
    if (!nextDecision) {
      addDeduction('exit', 10, '触发 exit 事件后 30 分钟内未做出处置决策', [exitTrigger.id]);
    }
  }

  const observedEndMs = Math.max(
    toMs(campaign.opened_at),
    ...legs.map(leg => toMs(leg.pre_simulated_time)),
    ...tradeRecords.flatMap(record => [record.openTime, record.closeTime]),
    ...events.map(event => toMs(event.timestamp)),
  );
  if (campaign.status === 'active' && (observedEndMs - toMs(campaign.opened_at)) > 7 * 24 * 60 * 60_000) {
    addDeduction('exit', 10, '战役 active 状态超过 7 天未结束', []);
  }

  if (campaign.peak_drawdown != null && mainSize != null && mainLeverage != null && mainLeverage > 0) {
    const initialMargin = mainSize / mainLeverage;
    if (initialMargin > EPSILON && (campaign.peak_drawdown / initialMargin) > 0.1) {
      addDeduction('exit', 5, '最终账户层级的 max_drawdown 占初始保证金超过 10%', []);
    }
  }

  const maxScore = campaign.strategy_template === 'main_only' ? 50 : 100;
  const rawScore = Math.max(0, maxScore - deductions.reduce((sum, deduction) => sum + deduction.points, 0));
  const normalizedScore = campaign.strategy_template === 'main_only'
    ? Math.round((rawScore / 50) * 100)
    : rawScore;

  return {
    is_applicable: true,
    score: normalizedScore,
    grade: gradeForScore(normalizedScore),
    deductions,
    total_deductions: deductions.reduce((sum, deduction) => sum + deduction.points, 0),
      retroactive_leg_count: retroactiveLegs.length,
  };
}

export function shouldSuggestCampaignEnd(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  pendingOrders: PendingOrder[],
  referenceTimeMs?: number,
): boolean {
  if (campaign.status !== 'active') return false;
  const mainLegs = legs.filter(leg => leg.leg_role && MAIN_ROLES.includes(leg.leg_role));
  const hedgeLegs = legs.filter(leg => leg.leg_role && HEDGE_ROLES.includes(leg.leg_role));
  const mainAllClosed = mainLegs.length > 0 && mainLegs.every(leg => !!findTradeRecord(leg, tradeRecords));
  const noPendingHedge = pendingOrders.length === 0;
  if (mainAllClosed && noPendingHedge) return true;

  const allHedgesTriggered = hedgeLegs.length > 0 && hedgeLegs.every(leg => !!findTradeRecord(leg, tradeRecords));
  const lastOpMs = Math.max(
    toMs(campaign.opened_at),
    ...legs.map(leg => toMs(leg.pre_simulated_time)),
    ...tradeRecords.flatMap(record => [record.openTime, record.closeTime]),
  );
  const nowMs = referenceTimeMs ?? lastOpMs;
  return allHedgesTriggered && (nowMs - lastOpMs) >= 24 * 60 * 60_000;
}

const LEGEND: Record<Exclude<LegRole, 'standalone'>, string> = {
  main_open: '主力开仓',
  main_add_1: '加仓1',
  main_add_2: '加仓2',
  main_add_3: '加仓3',
  main_add_4: '加仓4',
  main_add_5: '加仓5',
  main_add_6: '加仓6',
  hedge_initial_a: '初始对冲 A',
  hedge_initial_b: '初始对冲 B',
  hedge_rolling: '滚动对冲',
  mirror_tp: '镜像止盈',
  reentry_main: '重新入场主力',
  reentry_hedge: '重新入场对冲',
};
