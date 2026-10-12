import { computeInitialExpectedMaxDrawdownPct, computeInitialExpectedMaxLoss, computeInitialMainExposureNotional, resolveInitialExposureLegAttribution, type CampaignLocalOrderFacts } from '@/lib/campaignAnalysis';
import { evaluateCampaignAddSizing, resolveCampaignAddQuantitySteps, type AddSizingVerdict } from '@/lib/campaignAddSizingCheck';
import { buildTradeRecordPnlCorrection, resolveLegExecution, tradeRecordNotionalAt, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { closingSettlementRecord, computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { campaignPriceChange } from '@/lib/campaignMainPriceChange';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

export const POSITION_GEOMETRIC_FORMULA = '∏ₖ(1 + αₖ)';
export const POSITION_GEOMETRIC_ALPHA_RULE = 'αₖ = 第 k 次实际加仓币数 ÷ 加仓前实际持币数。首次覆盖预算 = G + Q₁(K₁ − S₁)，实际止损 K₁ 不变。加仓后整体保本价 = S后 − G ÷ Q后；Q后为加仓后的总币数，不能使用加仓前 Q₁。落袋利润只计入一次。';
export const MAGIC_B_FORMULA = '神奇的 b = 有效涨幅倍数 × 仓位几何累积倍数 × 风险基准换算 + 结算修正 ÷ L₀';
export const MAGIC_B_RULE = '风险基准换算 = 首次加仓前币数 × Kₘ ÷ 初始名义敞口。结算修正逐项包含保本余额、实际退出与 F 的价差、对冲及其他腿净盈亏、费用和中途仓位变化。F 与涨跌幅同源，L₀ 与盈亏比同源；完整结算时与实际盈亏比一致，缺少依据时不计算。';

export interface GeometricFirstAddBasis {
  beforeCoins: number;
  addCoins: number;
  costLine: number;
  breakevenLine: number;
  bankedProfit: number;
  support: number;
  addPrice: number;
  actualRatio: number;
  allowedRatio: number;
  afterCoins?: number;
  afterCostLine?: number;
  afterBreakevenLine?: number;
}

export interface MagicBReconciliation {
  referenceCoins: number;
  projectedCoins: number;
  settledCoins: number;
  initialExposure: number;
  initialRisk: number;
  normalization: number;
  rawProduct: number;
  modelPnl: number;
  balanceAtSupport: number;
  exitPriceAdjustment: number;
  otherNetPnl: number;
  netSettlementAdjustment: number;
  quantityAdjustment: number;
  totalAdjustment: number;
  reconstructedPnl: number;
}

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
    firstAdd?: GeometricFirstAddBasis | null;
    magicBReconciliation?: MagicBReconciliation | null;
  };
}

/** Growth from the coin position immediately before the first add; an empty product is 1. */
export function positionGeometricMultiple(ratios: readonly number[] | null): number | null {
  if (ratios == null
    || ratios.some(ratio => !Number.isFinite(ratio) || ratio < 0)) return null;
  const value = ratios.reduce((product, ratio) => product * (1 + ratio), 1);
  return Number.isFinite(value) ? value : null;
}

/** The calculator's signed risk budget written once as S₀, without adding G a second time. */
export function geometricFirstAddBasis(verdict: AddSizingVerdict | undefined): GeometricFirstAddBasis | null {
  if (!verdict || verdict.status === 'unknown') return null;
  const { x1Coins: Q, x2Coins: addCoins, s1: K, s2: T, cushion: Y, banked: G } = verdict;
  if (Q == null || !(Q > 0) || addCoins == null || !(addCoins > 0)
    || K == null || T == null || !(T > K) || Y == null || G == null
    || ![Q, addCoins, K, T, Y, G].every(Number.isFinite)) return null;
  const costLine = K - Y / Q;
  const breakevenLine = costLine - G / Q;
  const allowedRatio = Math.max(0, K - breakevenLine) / (T - K);
  if (![costLine, breakevenLine, allowedRatio].every(Number.isFinite)) return null;
  const afterCoins = Q + addCoins;
  const afterCostLine = (Q * costLine + addCoins * T) / afterCoins;
  return { beforeCoins: Q, addCoins, costLine, breakevenLine, bankedProfit: G,
    afterCoins, afterCostLine, afterBreakevenLine: afterCostLine - G / afterCoins,
    support: K, addPrice: T, actualRatio: addCoins / Q, allowedRatio };
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

export function computeMagicB(effectiveMultiple: number | null | undefined, positionMultiple: number | null | undefined, normalization: number | null | undefined, correctionR = 0): number | null {
  if (effectiveMultiple == null || positionMultiple == null || normalization == null
    || ![effectiveMultiple, positionMultiple, normalization, correctionR].every(Number.isFinite) || normalization <= 0) return null;
  const value = effectiveMultiple * positionMultiple * normalization + correctionR;
  return Number.isFinite(value) ? value : null;
}

/** A settlement identity, not a copy of total/L₀. Every claimed slice is counted once.
 * Late closes are repriced at K and F, preserving their official net adjustments.
 * Intermediate reductions/re-entry appear explicitly as a quantity correction.
 */
function reconcileMagicB(campaign: TradeCampaign, legs: TradeJournal[], records: TradeRecord[], corrections: LegExitPriceCorrections,
  referenceCoins: number | null, multiple: number | null, F: number | null, K: number | null,
  lastAddTime: number | undefined, initialExposure: number, initialRisk: number): MagicBReconciliation | null {
  if (referenceCoins == null || multiple == null || F == null || K == null || lastAddTime == null
    || ![referenceCoins, multiple, F, K, lastAddTime, initialExposure, initialRisk].every(Number.isFinite)
    || referenceCoins <= 0 || initialExposure <= 0 || initialRisk <= 0) return null;
  const settlement = computeCampaignRealizedPnl(campaign, legs, records, corrections);
  if (!settlement.settled || settlement.total == null) return null;
  let earlyNet = 0, settledCoins = 0, atSupport = 0, exitPriceAdjustment = 0, netSettlementAdjustment = 0, otherNetPnl = 0;
  for (const leg of legs) {
    const net = settlement.byLeg.get(leg.id);
    if (net == null || !Number.isFinite(net)) return null;
    if (leg.direction !== 'long') { otherNetPnl += net; continue; }
    const claimed = settlement.recordsByLeg.get(leg.id) ?? [];
    const closing = closingSettlementRecord(claimed);
    const slices = claimed.length ? claimed.map(record => {
      const correction = record === closing ? corrections[leg.id] : null;
      const delta = correction ? buildTradeRecordPnlCorrection(record, correction) : null;
      const sized = !record.settlementMode && leg.pre_settlement_mode === 'coin' ? { ...record, settlementMode: 'coin' as const } : record;
      return { q: tradeRecordNotionalAt(sized) / record.entryPrice, entry: record.entryPrice,
        exit: delta?.correctedExitPrice ?? record.exitPrice, time: record.closeTime,
        net: delta?.correctedNetPnl ?? record.pnl };
    }) : [{ q: leg.pre_position_size != null && leg.pre_entry_price ? leg.pre_position_size / leg.pre_entry_price : NaN,
      entry: leg.pre_entry_price ?? NaN, exit: resolveLegExecution(leg, null, corrections).exitPrice ?? NaN,
      time: resolveLegExecution(leg, null, corrections).closeTime ?? NaN, net }];
    let sliceNet = 0;
    for (const s of slices) {
      if (![s.q, s.entry, s.exit, s.time, s.net].every(Number.isFinite) || s.q <= 0 || s.entry <= 0 || s.exit <= 0 || s.time <= 0) return null;
      sliceNet += s.net;
      if (s.time <= lastAddTime) { earlyNet += s.net; continue; }
      settledCoins += s.q;
      atSupport += s.q * (K - s.entry);
      exitPriceAdjustment += s.q * (s.exit - F);
      netSettlementAdjustment += s.net - s.q * (s.exit - s.entry);
    }
    if (Math.abs(sliceNet - net) > 1e-7 * Math.max(1, Math.abs(net))) return null;
  }
  const projectedCoins = referenceCoins * multiple;
  const modelPnl = projectedCoins * (F - K);
  const balanceAtSupport = earlyNet + atSupport;
  const quantityAdjustment = (settledCoins - projectedCoins) * (F - K);
  const totalAdjustment = balanceAtSupport + exitPriceAdjustment + otherNetPnl + netSettlementAdjustment + quantityAdjustment;
  const reconstructedPnl = modelPnl + totalAdjustment;
  if (Math.abs(reconstructedPnl - settlement.total) > 1e-7 * Math.max(1, Math.abs(settlement.total))) return null;
  return { referenceCoins, projectedCoins, settledCoins, initialExposure, initialRisk,
    normalization: referenceCoins * K / initialExposure,
    rawProduct: modelPnl / initialRisk / (referenceCoins * K / initialExposure),
    modelPnl, balanceAtSupport, exitPriceAdjustment, otherNetPnl, netSettlementAdjustment,
    quantityAdjustment, totalAdjustment, reconstructedPnl };
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
  const verdicts = steps.length ? evaluateCampaignAddSizing(input) : null;
  const verdict = lastAdd ? verdicts?.get(lastAdd.legId) : null;
  const lastLeg = lastAdd ? legs.find(leg => leg.id === lastAdd.legId) : null;
  const snapshotStop = lastLeg?.trade_record_id ? lookup.get(lastLeg.trade_record_id)?.addSizingSnapshot?.s1 : null;
  const stop = verdict?.s1 ?? snapshotStop ?? null;
  const lastSupport = stop != null && Number.isFinite(stop) && stop > 0 ? stop : null;
  const rise = effectivePriceChangePct(finalExitPrice, lastSupport);
  const drawdownPct = computeInitialExpectedMaxDrawdownPct(campaign, legs, tradeRecords, orders);
  const riseMultiple = computeEffectivePriceChangeMultiple(rise, drawdownPct);
  // Early reduction sets Q₁ in the actual add ledger; it is not a second factor.
  const multiple = !steps.length && initialCoins == null ? null : positionGeometricMultiple(addRatios);
  const firstAdd = steps[0] ? geometricFirstAddBasis(verdicts?.get(steps[0].legId)) : null;
  const bridge = reconcileMagicB(campaign, legs, tradeRecords, corrections, steps[0]?.beforeCoins ?? null,
    multiple, finalExitPrice, lastSupport, lastAdd?.openTime,
    computeInitialMainExposureNotional(campaign, legs, tradeRecords),
    computeInitialExpectedMaxLoss(campaign, legs, tradeRecords, orders));
  return {
    effectivePriceChangePct: rise,
    effectivePriceChangeMultiple: riseMultiple,
    positionGeometricMultiple: multiple,
    magicB: bridge ? computeMagicB(riseMultiple, multiple, bridge.normalization, bridge.totalAdjustment / bridge.initialRisk) : null,
    geometricMetricBasis: { initialCoins, earlyReductionFraction: reduction, addRatios, finalExitPrice, lastSupport, firstAdd, magicBReconciliation: bridge },
  };
}
