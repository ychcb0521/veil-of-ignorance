import { computeInitialExpectedMaxDrawdownPct, computeInitialMainExposureNotional, resolveInitialExposureLegAttribution, type CampaignLocalOrderFacts } from '@/lib/campaignAnalysis';
import { evaluateCampaignAddSizing, resolveCampaignAddQuantitySteps } from '@/lib/campaignAddSizingCheck';
import { resolveLegExecution, tradeRecordNotionalAt, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { campaignPriceChange } from '@/lib/campaignMainPriceChange';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

export interface CampaignGeometricMetrics {
  effectivePriceChangePct: number | null;
  effectivePriceChangeMultiple: number | null;
  positionGeometricMultiple: number | null;
  magicB?: number | null;
  geometricMetricBasis: {
    initialCoins: number | null;
    earlyReductionFraction: number | null;
    addRatios: number[] | null;
    finalExitPrice: number | null;
    lastSupport: number | null;
  };
}

/** Coin-position growth: actual early retention times each actual add factor. */
export function positionGeometricMultiple(reduction: number | null, ratios: readonly number[] | null): number | null {
  if (reduction == null || !Number.isFinite(reduction) || reduction < 0 || reduction > 1 || ratios == null
    || ratios.some(ratio => !Number.isFinite(ratio) || ratio < 0)) return null;
  const value = ratios.reduce((product, ratio) => product * (1 + ratio), 1 - reduction);
  return Number.isFinite(value) ? value : null;
}

export function effectivePriceChangePct(exitPrice: number | null, stopLine: number | null): number | null {
  return exitPrice != null && Number.isFinite(exitPrice) && exitPrice > 0
    && stopLine != null && Number.isFinite(stopLine) && stopLine > 0
    ? (exitPrice - stopLine) / stopLine * 100 : null;
}

/** Both inputs are percentages; their ratio is a dimensionless multiple (e.g. 45% / 9% = 5x). */
export function computeEffectivePriceChangeMultiple(risePct: number | null | undefined, drawdownPct: number | null | undefined): number | null {
  if (risePct == null || drawdownPct == null || !Number.isFinite(risePct) || !Number.isFinite(drawdownPct) || drawdownPct <= 0) return null;
  const value = risePct / drawdownPct;
  return Number.isFinite(value) ? value : null;
}

export function computeMagicB(effectiveMultiple: number | null | undefined, positionMultiple: number | null | undefined): number | null {
  if (effectiveMultiple == null || positionMultiple == null || !Number.isFinite(effectiveMultiple) || !Number.isFinite(positionMultiple)) return null;
  const value = effectiveMultiple * positionMultiple;
  return Number.isFinite(value) ? value : null;
}

/** Shared by list, detail, sorting and charts. Missing evidence remains null. */
export function computeCampaignGeometricMetrics(
  campaign: TradeCampaign, legs: TradeJournal[], tradeRecords: TradeRecord[],
  orders: CampaignReverseHedgeOrder[] = [], corrections: LegExitPriceCorrections = {},
  localOrders: CampaignLocalOrderFacts = {},
): CampaignGeometricMetrics {
  const empty: CampaignGeometricMetrics = {
    effectivePriceChangePct: null, effectivePriceChangeMultiple: null, positionGeometricMultiple: null, magicB: null,
    geometricMetricBasis: { initialCoins: null, earlyReductionFraction: null, addRatios: null, finalExitPrice: null, lastSupport: null },
  };
  if (campaign.direction !== 'main_long') return empty;
  const lookup = buildTradeRecordLookup(tradeRecords);
  const initial = legs.filter(leg => leg.direction === 'long' && (leg.leg_role === 'main_open' || leg.leg_role === 'mirror_tp'));
  const executions = new Map(legs.map(leg => [leg.id, resolveLegExecution(leg, leg.trade_record_id ? lookup.get(leg.trade_record_id) ?? null : null, corrections)]));
  const attribution = resolveInitialExposureLegAttribution(campaign, legs, tradeRecords);
  let initialCoins: number | null = 0;
  if (attribution.shares.size) {
    for (const [id, share] of attribution.shares) {
      const entry = executions.get(id)?.entryPrice;
      if (entry == null || entry <= 0) { initialCoins = null; break; }
      initialCoins += share.notionalUsd / entry;
    }
  } else {
    const mains = initial.filter(leg => leg.leg_role === 'main_open');
    const entry = mains.length === 1 ? executions.get(mains[0].id)?.entryPrice : null;
    const exposure = computeInitialMainExposureNotional(campaign, legs, tradeRecords);
    initialCoins = entry != null && entry > 0 && exposure > 0 ? exposure / entry : null;
  }
  if (initialCoins == null || !Number.isFinite(initialCoins) || initialCoins <= 0) initialCoins = null;

  const input = { legs, tradeRecords, reverseHedgeOrders: orders, legExitPriceCorrections: corrections };
  const steps = resolveCampaignAddQuantitySteps(input).filter(step => legs.find(leg => leg.id === step.legId)?.direction === 'long');
  const validSteps = steps.every(step => Number.isFinite(step.openTime) && step.beforeCoins != null && step.beforeCoins > 0 && step.addCoins != null && step.addCoins > 0);
  const addRatios = validSteps ? steps.map(step => step.addCoins! / step.beforeCoins!) : null;
  const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, corrections);
  const mainSide = legs.filter(leg => leg.direction === 'long' && (leg.leg_role === 'main_open' || leg.leg_role === 'mirror_tp' || (leg.leg_role ?? '').startsWith('main_add_')));
  const claimed = new Set<string>();
  const closes: Array<{ time: number; operationTime: number | null; legId: string; mirror: boolean; coins: number; price: number }> = [];
  for (const leg of mainSide) {
    const records = settlement.recordsByLeg.get(leg.id) ?? [];
    const last = Math.max(...records.map(record => record.closeTime));
    for (const record of records) {
      if (claimed.has(record.id) || !(record.closeTime > 0) || !(record.entryPrice > 0)) continue;
      claimed.add(record.id);
      const sized = !record.settlementMode && leg.pre_settlement_mode === 'coin' ? { ...record, settlementMode: 'coin' as const } : record;
      const coins = tradeRecordNotionalAt(sized) / record.entryPrice;
      const price = record.closeTime === last && corrections[leg.id] ? corrections[leg.id].exitPrice : record.exitPrice;
      if (coins > 0 && price > 0) closes.push({ time: record.closeTime, operationTime: record.closedRealAt ?? null, legId: leg.id, mirror: leg.leg_role === 'mirror_tp', coins, price });
    }
    if (!records.length) {
      const execution = executions.get(leg.id)!;
      const coins = execution.entryPrice != null && execution.entryPrice > 0 && leg.pre_position_size != null ? leg.pre_position_size / execution.entryPrice : 0;
      if (execution.closeTime != null && execution.exitPrice != null && coins > 0) closes.push({ time: execution.closeTime, operationTime: leg.post_real_close_time ? Date.parse(leg.post_real_close_time) : null, legId: leg.id, mirror: leg.leg_role === 'mirror_tp', coins, price: execution.exitPrice });
    }
  }
  const resolved = ['closed_profit', 'closed_loss', 'closed_breakeven'].includes(campaign.status);
  const finalTime = closes.length ? Math.max(...closes.map(close => close.time)) : null;
  // F is exactly the exit basis of 涨跌幅, including hedge locks, execution
  // corrections and unfilled-order evidence. Never average the main/add exits.
  const finalExitPrice = campaignPriceChange(campaign, legs, tradeRecords, corrections, localOrders).exitPrice;
  let reduction: number | null = null;
  if (initialCoins != null) {
    const initialIds = new Set(initial.map(leg => leg.id));
    const firstAdd = steps[0];
    const firstLeg = firstAdd ? legs.find(leg => leg.id === firstAdd.legId)! : null;
    const firstOperation = firstLeg ? executions.get(firstLeg.id)?.record?.openedRealAt ?? (firstLeg.pre_real_time ? Date.parse(firstLeg.pre_real_time) : null) : null;
    if (firstAdd && Number.isFinite(firstAdd.openTime)) reduction = closes.filter(close => initialIds.has(close.legId)
      && close.time <= firstAdd.openTime
      && !(firstOperation != null && close.operationTime != null && close.operationTime > firstOperation))
      .reduce((sum, close) => sum + close.coins, 0) / initialCoins;
    else if (!steps.length && resolved && finalTime != null) reduction = closes.filter(close => initialIds.has(close.legId) && (close.mirror || close.time < finalTime - 60_000)).reduce((sum, close) => sum + close.coins, 0) / initialCoins;
    if (reduction != null && (reduction < -1e-8 || reduction > 1 + 1e-8)) reduction = null;
    else if (reduction != null) reduction = Math.max(0, Math.min(1, reduction));
  }
  const lastAdd = steps.at(-1);
  const verdict = lastAdd ? evaluateCampaignAddSizing(input).get(lastAdd.legId) : null;
  const lastLeg = lastAdd ? legs.find(leg => leg.id === lastAdd.legId) : null;
  const snapshotStop = lastLeg?.trade_record_id ? lookup.get(lastLeg.trade_record_id)?.addSizingSnapshot?.s1 : null;
  const stop = verdict?.s1 ?? snapshotStop ?? null;
  const lastSupport = stop != null && Number.isFinite(stop) && stop > 0 ? stop : null;
  const rise = effectivePriceChangePct(finalExitPrice, lastSupport);
  const drawdownPct = computeInitialExpectedMaxDrawdownPct(campaign, legs, tradeRecords, orders);
  const riseMultiple = computeEffectivePriceChangeMultiple(rise, drawdownPct);
  const multiple = positionGeometricMultiple(reduction, addRatios);
  return {
    effectivePriceChangePct: rise,
    effectivePriceChangeMultiple: riseMultiple,
    positionGeometricMultiple: multiple,
    magicB: computeMagicB(riseMultiple, multiple),
    geometricMetricBasis: { initialCoins, earlyReductionFraction: reduction, addRatios, finalExitPrice, lastSupport },
  };
}
