import { computeInitialExpectedMaxDrawdownPct, computeInitialMainExposureNotional, resolveInitialExposureLegAttribution, resolveMainRiskAnchors, type CampaignLocalOrderFacts } from '@/lib/campaignAnalysis';
import { evaluateCampaignAddSizing, resolveCampaignAddQuantitySteps, type AddSizingVerdict } from '@/lib/campaignAddSizingCheck';
import { resolveLegExecution, tradeRecordNotionalAt, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { campaignPriceChange } from '@/lib/campaignMainPriceChange';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';
import { buildCampaignLegTheoreticalFactors, type LegGeometricFactor, type LegTheoreticalGeometricFactor } from '@/lib/campaignLegGeometricFactor';

export const POSITION_GEOMETRIC_FORMULA = '(1 − αf) × ∏ₖ(1 + αₖ)';
export const POSITION_THEORETICAL_FORMULA = '(1 − αf) × ∏ₖ(1 + αₖ理论)';
export const EFFECTIVE_PRICE_CHANGE_FORMULA = '相对涨幅 = (F − Kₘ) ÷ (E − K初)';
export const EFFECTIVE_PRICE_CHANGE_RULE = '最后一截的有效涨幅价差相对于初始回撤价差的倍数 = 最后一截的有效涨幅价差 ÷ 初始回撤价差。E 为最初开仓时主力与镜像仓位合计的币数加权开仓价；K初 为该批开仓的初始止损线，沿用初始风险的委托依据，多条初始保护线取最大亏损边界，多笔初始主力按币数加权。E 与 K初 均固定，不随加仓或止损上移变化。F 与「涨跌幅」的平仓价同源；Kₘ 为最后一次实际加仓时的新支撑线。';
export const POSITION_GEOMETRIC_ALPHA_RULE = 'αₖ = 第 k 次实际加仓币数 ÷ 加仓前实际持币数。首次覆盖预算 = G + Q₁(K₁ − S₁)，实际止损 K₁ 不变。加仓后整体保本价 = S后 − G ÷ Q后；Q后为加仓后的总币数，不能使用加仓前 Q₁。落袋利润只计入一次。';
export const MAGIC_B_FORMULA = '神奇的 b = 仓位几何累积倍数 × 相对涨幅';
export const MAGIC_B_THEORETICAL_FORMULA = '神奇的 b（理论） = 仓位几何累积倍数（理论） × 相对涨幅';
export const MAGIC_B_SETTLEMENT_FORMULA = '神奇的 b = 已实现净盈亏 ÷ 初始最大预期亏损 L₀';
export const MAGIC_B_METHODS_DESCRIPTION = `算法一 · 原盈亏比：${MAGIC_B_SETTLEMENT_FORMULA}。算法二 · 几何公式：${MAGIC_B_FORMULA}。方法三 · 神奇的 b（理论）：${MAGIC_B_THEORETICAL_FORMULA}。盈亏比及相关统计采用算法一，神奇的 b 指标采用算法二，方法三仅作理论对照。`;
export const MAGIC_B_RULE = '采用实际仓位几何累积倍数（含首次减仓因子），相对涨幅以初始每币风险 E − K初 为分母。b 直接乘该比值，初始风险不再重复除一次；例如相对涨幅 2.00× 参与计算为 2。不再乘基数仓位比例 β，不追加结算修正。几何公式与已实现净盈亏 ÷ L₀ 的结算口径可能存在差异；缺少有效依据时显示「—」。';

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

export interface CampaignGeometricMetrics {
  effectivePriceChangePct: number | null;
  effectivePriceChangeMultiple: number | null;
  positionGeometricMultiple: number | null;
  positionGeometricMultipleTheoretical?: number | null;
  magicB?: number | null;
  geometricMetricBasis: {
    initialCoins: number | null;
    initialEntryPrice?: number | null;
    initialStopPrice?: number | null;
    initialReductionFactors?: Array<LegGeometricFactor & { legId: string }>;
    earlyReductionFraction: number | null;
    addRatios: number[] | null;
    finalExitPrice: number | null;
    lastSupport: number | null;
    firstAdd?: GeometricFirstAddBasis | null;
    theoreticalFactors?: Array<LegTheoreticalGeometricFactor | null> | null;
  };
}

/** Initial main + mirror coins are 1; retain the first cut and multiply observed add factors. */
export function positionGeometricMultiple(ratios: readonly number[] | null, reduction: number | null = 0): number | null {
  if (ratios == null
    || reduction == null || !Number.isFinite(reduction) || reduction < 0 || reduction > 1
    || ratios.some(ratio => !Number.isFinite(ratio) || ratio < 0)) return null;
  const value = ratios.reduce((product, ratio) => product * (1 + ratio), 1 - reduction);
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

export function effectivePriceChangePct(exitPrice: number | null, stopLine: number | null, initialEntryPrice: number | null, initialStopPrice: number | null): number | null {
  if (exitPrice == null || stopLine == null || initialEntryPrice == null || initialStopPrice == null
    || ![exitPrice, stopLine, initialEntryPrice, initialStopPrice].every(Number.isFinite)
    || exitPrice <= 0 || stopLine <= 0 || initialEntryPrice <= 0 || initialStopPrice <= 0 || initialEntryPrice <= initialStopPrice) return null;
  const value = (exitPrice - stopLine) / (initialEntryPrice - initialStopPrice) * 100;
  return Number.isFinite(value) ? value : null;
}

/** Both inputs are percentages; their ratio is a dimensionless multiple (e.g. 45% / 9% = 5x). */
export function computeEffectivePriceChangeMultiple(risePct: number | null | undefined, drawdownPct: number | null | undefined): number | null {
  if (risePct == null || drawdownPct == null || !Number.isFinite(risePct) || !Number.isFinite(drawdownPct) || drawdownPct <= 0) return null;
  const value = risePct / drawdownPct;
  return Number.isFinite(value) ? value : null;
}

/** Effective rise is stored in percentage points; 20% participates as 0.20. */
export function computeMagicB(risePct: number | null | undefined, positionMultiple: number | null | undefined): number | null {
  if (risePct == null || positionMultiple == null
    || ![risePct, positionMultiple].every(Number.isFinite) || positionMultiple < 0) return null;
  const value = positionMultiple * (risePct / 100);
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
    geometricMetricBasis: { initialCoins: null, initialEntryPrice: null, initialStopPrice: null, earlyReductionFraction: null, addRatios: null, finalExitPrice: null, lastSupport: null },
  };
  if (campaign.direction !== 'main_long') return empty;
  const lookup = buildTradeRecordLookup(tradeRecords);
  const executions = new Map(legs.map(leg => [leg.id, resolveLegExecution(leg, leg.trade_record_id ? lookup.get(leg.trade_record_id) ?? null : null, corrections)]));
  const initialCandidates = legs.filter(leg => leg.direction === 'long' && (leg.leg_role === 'main_open' || leg.leg_role === 'mirror_tp'));
  const firstOpen = Math.min(...initialCandidates.flatMap(leg => executions.get(leg.id)?.openTime == null ? [] : [executions.get(leg.id)!.openTime!]));
  // Only the initial opening batch is the original 1. Later reentry mirrors are not initial coins.
  const initial = initialCandidates.filter(leg => executions.get(leg.id)?.openTime === firstOpen);
  const attribution = resolveInitialExposureLegAttribution(campaign, initial, tradeRecords);
  let initialCoins: number | null = 0;
  let initialNotional = 0;
  if (attribution.shares.size) {
    for (const [id, share] of attribution.shares) {
      const entry = executions.get(id)?.entryPrice;
      if (entry == null || entry <= 0) { initialCoins = null; break; }
      initialCoins += share.notionalUsd / entry;
      initialNotional += share.notionalUsd;
    }
  } else {
    const mains = initial.filter(leg => leg.leg_role === 'main_open');
    const entry = mains.length === 1 ? executions.get(mains[0].id)?.entryPrice : null;
    const exposure = computeInitialMainExposureNotional(campaign, legs, tradeRecords);
    initialCoins = entry != null && entry > 0 && exposure > 0 ? exposure / entry : null;
    initialNotional = exposure;
  }
  if (initialCoins == null || !Number.isFinite(initialCoins) || initialCoins <= 0) initialCoins = null;
  if (initialCandidates.some(leg => executions.get(leg.id)?.openTime == null)) initialCoins = null;
  // E and Q₀ describe the same original main + mirror cohort, before any cuts/adds.
  const entry = initialCoins != null ? initialNotional / initialCoins : null;
  const initialEntryPrice = entry != null && Number.isFinite(entry) && entry > 0 ? entry : null;
  const initialMainIds = new Set(initial.filter(leg => leg.leg_role === 'main_open').map(leg => leg.id));
  const initialAnchors = resolveMainRiskAnchors(campaign, legs, tradeRecords, orders).anchors.filter(anchor => initialMainIds.has(anchor.mainLegId));
  const validInitialStops = initialAnchors.length > 0 && initialAnchors.length === initialMainIds.size
    && initialAnchors.every(anchor => anchor.stopPrice != null && anchor.stopPrice > 0
      && anchor.entryPrice != null && anchor.entryPrice > anchor.stopPrice && anchor.exposureNotional > 0);
  const anchorCoins = validInitialStops ? initialAnchors.reduce((sum, anchor) => sum + anchor.exposureNotional / anchor.entryPrice!, 0) : 0;
  const initialStopPrice = anchorCoins > 0
    ? initialAnchors.reduce((sum, anchor) => sum + anchor.stopPrice! * anchor.exposureNotional / anchor.entryPrice!, 0) / anchorCoins
    : null;

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
  const initialReductionFactors: Array<LegGeometricFactor & { legId: string }> = [];
  if (initialCoins != null) {
    const firstReductionFraction = (cuts: typeof closes) => {
      if (!cuts.length) return 0;
      const firstTime = Math.min(...cuts.map(cut => cut.time));
      const batch = cuts.filter(cut => cut.time === firstTime);
      const quantities = new Map<string, number>();
      for (const cut of batch) quantities.set(cut.legId, (quantities.get(cut.legId) ?? 0) + cut.coins);
      let before = initialCoins!;
      for (const [legId, removed] of [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (before > 0 && removed > 0 && removed <= before + 1e-8) {
          initialReductionFactors.push({ legId, kind: 'reduction', beforeCoins: before, addCoins: removed,
            multiple: Math.max(0, 1 - removed / before) });
        }
        before -= removed;
      }
      return batch.reduce((sum, cut) => sum + cut.coins, 0) / initialCoins!;
    };
    const initialIds = new Set(initial.map(leg => leg.id));
    const firstAdd = steps[0];
    const firstLeg = firstAdd ? legs.find(leg => leg.id === firstAdd.legId)! : null;
    const firstOperation = firstLeg ? executions.get(firstLeg.id)?.record?.openedRealAt ?? (firstLeg.pre_real_time ? Date.parse(firstLeg.pre_real_time) : null) : null;
    if (firstAdd && Number.isFinite(firstAdd.openTime)) reduction = firstReductionFraction(closes.filter(close => initialIds.has(close.legId)
      && close.time <= firstAdd.openTime
      && !(firstOperation != null && close.operationTime != null && close.operationTime > firstOperation))
      );
    else if (!steps.length && resolved && finalTime != null) reduction = firstReductionFraction(closes.filter(close => initialIds.has(close.legId) && (close.mirror || close.time < finalTime - 60_000)));
    else if (!steps.length) reduction = 0;
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
  const rise = effectivePriceChangePct(finalExitPrice, lastSupport, initialEntryPrice, initialStopPrice);
  const drawdownPct = computeInitialExpectedMaxDrawdownPct(campaign, legs, tradeRecords, orders);
  const riseMultiple = computeEffectivePriceChangeMultiple(rise, drawdownPct);
  const multiple = !steps.length && initialCoins == null ? null : positionGeometricMultiple(addRatios, reduction);
  const theoreticalMap = buildCampaignLegTheoreticalFactors(input, verdicts ?? undefined);
  const theoreticalFactors = steps.map(step => theoreticalMap.get(step.legId) ?? null);
  const theoreticalRatios = theoreticalFactors.every(Boolean) ? theoreticalFactors.map(factor => factor!.alpha) : null;
  const theoreticalMultiple = !steps.length && initialCoins == null ? null : positionGeometricMultiple(theoreticalRatios, reduction);
  const firstAdd = steps[0] ? geometricFirstAddBasis(verdicts?.get(steps[0].legId)) : null;
  return {
    effectivePriceChangePct: rise,
    effectivePriceChangeMultiple: riseMultiple,
    positionGeometricMultiple: multiple,
    positionGeometricMultipleTheoretical: theoreticalMultiple,
    magicB: computeMagicB(rise, multiple),
    geometricMetricBasis: { initialCoins, initialEntryPrice, initialStopPrice, initialReductionFactors: reduction == null ? [] : initialReductionFactors, earlyReductionFraction: reduction, addRatios, finalExitPrice, lastSupport, firstAdd, theoreticalFactors },
  };
}
