import { describe, expect, it } from 'vitest';
import { computeCampaignGeometricMetrics, computeEffectivePriceChangeMultiple, computeMagicB, computePositionProfit, computeUnitProfit, computeUnitRise, effectivePriceChangePct, geometricFirstAddBasis, positionGeometricMultiple } from '@/lib/campaignGeometricMetrics';
import { evaluateCampaignAddSizing, resolveCampaignAddQuantitySteps } from '@/lib/campaignAddSizingCheck';
import { calculateAddPosition, initialAddPositionState } from '@/lib/addPositionCoverage';
import { campaignPriceChange } from '@/lib/campaignMainPriceChange';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { buildCampaignPnlOverviewItems } from '@/lib/campaignPnlOverview';
import { rowEffectivePriceChangePct, rowMagicB, rowPositionGeometricMultiple, sortCampaignRows, type CampaignSortRow } from '@/lib/campaignListSort';
import { computeInitialExpectedMaxLoss } from '@/lib/campaignAnalysis';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const START = Date.parse('2026-08-01T00:00:00Z');
const at = (hour: number) => START + hour * 3_600_000;
const iso = (hour: number) => new Date(at(hour)).toISOString();
function scenario(reduction = 0.5) {
  const campaign = {
    id: 'c', user_id: 'u', direction: 'main_long', status: 'closed_profit', symbol: 'TESTUSDT',
    opened_at: iso(0), closed_at: iso(8), initial_main_size_usdt: 1000, actual_evolution: [], final_realized_pnl: null,
  } as unknown as TradeCampaign;
  const retained = 10 * (1 - reduction);
  const quantities = [retained, 10 * reduction, retained * 1.5, retained * 2.5 * 1.5];
  const prices = [100, 100, 130, 160];
  const times = [0, 0, 2, 4];
  const closes = [8, 1, 8, 8];
  const ids = ['main', 'mirror', 'add1', 'add2'];
  const roles = ['main_open', 'mirror_tp', 'main_add_1', 'main_add_2'] as const;
  const legs = ids.map((id, i) => ({
    id, campaign_id: 'c', user_id: 'u', trade_record_id: `${id}-record`, leg_role: roles[i], leg_sequence: i,
    direction: 'long', symbol: 'TESTUSDT', pre_position_size: quantities[i] * prices[i], pre_entry_price: prices[i],
    pre_simulated_time: iso(times[i]), post_simulated_close_time: iso(closes[i]),
    post_exit_price_snapshot: i === 1 ? 120 : 220, created_at: iso(0), updated_at: iso(9),
  } as unknown as TradeJournal));
  const records = ids.map((id, i) => ({
    id: `${id}-record`, fillId: id, symbol: 'TESTUSDT', side: 'LONG', action: 'CLOSE', type: 'MARKET',
    quantity: quantities[i], entryPrice: prices[i], exitPrice: i === 1 ? 120 : 220,
    openTime: at(times[i]), closeTime: at(closes[i]), pnl: quantities[i] * ((i === 1 ? 120 : 220) - prices[i]), fee: 0,
    addSizingSnapshot: i >= 2 ? { s1: i === 2 ? 110 : 140 } : undefined,
  } as unknown as TradeRecord));
  legs.push({ ...legs[0], id: 'initial-hedge', trade_record_id: 'initial-hedge-record', leg_role: 'hedge_initial_a', direction: 'short',
    pre_position_size: 90, pre_entry_price: 90, post_simulated_close_time: iso(1) });
  records.push({ ...records[0], id: 'initial-hedge-record', fillId: 'initial-hedge', side: 'SHORT', entryPrice: 90, exitPrice: 90,
    quantity: 1, pnl: 0, closeTime: at(1), addSizingSnapshot: undefined });
  return { campaign, legs, tradeRecords: records, reverseHedgeOrders: [], pendingOrders: [] };
}

describe('campaign geometric metrics', () => {
  it('magic b is actual position multiple times decimal effective rise, without beta or risk denominator', () => {
    expect(computeEffectivePriceChangeMultiple(45, 9)).toBe(5);
    expect(computeEffectivePriceChangeMultiple(-10, 5)).toBe(-2);
    expect(computeEffectivePriceChangeMultiple(45, 0)).toBeNull();
    expect(computeEffectivePriceChangeMultiple(null, 9)).toBeNull();
    expect(computeMagicB(20, 2)).toBe(0.4);
    expect(computeMagicB(-20, 3)).toBeCloseTo(-0.6);
    expect(computeMagicB(0, 3)).toBe(0);
    expect(computeMagicB(20, 0)).toBe(0);
    expect(computeMagicB(null, 3)).toBeNull();
    expect(computeMagicB(45, null)).toBeNull();
    expect(computeMagicB(Infinity, 3)).toBeNull();
    expect(computeMagicB(5, -2)).toBeNull();
  });
  it('F reuses the main-price-change exit, never the weighted or later add-leg exits', () => {
    const data = scenario();
    data.tradeRecords[2].exitPrice = 280;
    data.tradeRecords[3].exitPrice = 300;
    data.tradeRecords[3].closeTime = at(9);
    const basis = campaignPriceChange(data.campaign, data.legs, data.tradeRecords);
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(basis.exitPrice).toBe(220);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(basis.exitPrice);
    expect(result.effectivePriceChangePct).toBeCloseTo((220 - 140) / (100 - 90) * 100);
    expect(buildCampaignCardData(data as Parameters<typeof buildCampaignCardData>[0]).effectivePriceChangePct).toBe(result.effectivePriceChangePct);
  });

  it.each(['hedge_rolling', 'hedge_initial_a', 'hedge_initial_b', 'reentry_hedge'] as const)('F shares the %s lock-price rule, including the same-close tolerance', role => {
    const data = scenario();
    data.legs.push({ ...data.legs[0], id: 'hedge', leg_role: role, direction: 'short', trade_record_id: 'hedge-record' });
    data.tradeRecords.push({ ...data.tradeRecords[0], id: 'hedge-record', fillId: 'hedge', side: 'SHORT', entryPrice: 200, exitPrice: 220, openTime: at(7), closeTime: at(8) - 60_000 });
    const basis = campaignPriceChange(data.campaign, data.legs, data.tradeRecords);
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(basis.exitPrice).toBe(200);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(basis.exitPrice);
    expect(result.effectivePriceChangePct).toBeCloseTo((200 - 140) / (100 - 90) * 100);
    const card = buildCampaignCardData(data as Parameters<typeof buildCampaignCardData>[0]);
    expect(card.geometricMetricBasis?.finalExitPrice).toBe(basis.exitPrice);
    expect(card.mainPriceChangePct).toBe(basis.pct);
    // Just outside the shared one-minute window: no lock.
    data.tradeRecords.at(-1)!.closeTime = at(8) - 60_001;
    expect(computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords).geometricMetricBasis.finalExitPrice).toBe(220);
  });

  it('F shares earliest hedge selection instead of averaging multiple lock prices', () => {
    const data = scenario();
    for (const [id, entry, open] of [['early', 200, 6], ['late', 210, 7]] as const) {
      data.legs.push({ ...data.legs[0], id, leg_role: 'hedge_rolling', direction: 'short', trade_record_id: `${id}-record` });
      data.tradeRecords.push({ ...data.tradeRecords[0], id: `${id}-record`, fillId: id, side: 'SHORT', entryPrice: entry, openTime: at(open) });
    }
    expect(computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords).geometricMetricBasis.finalExitPrice).toBe(200);
  });

  it('unfilled local-order evidence is identical for F and the card price-change basis', () => {
    const data = scenario();
    data.legs.push({ ...data.legs[0], id: 'pending', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: 'pending-order', pre_entry_price: 200, pre_simulated_time: iso(7), post_simulated_close_time: null, post_exit_price_snapshot: null });
    const local = { unfilledOrderIds: new Set(['pending-order']) };
    const basis = campaignPriceChange(data.campaign, data.legs, data.tradeRecords, {}, local);
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, [], {}, local);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(basis.exitPrice);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(220);
    const card = buildCampaignCardData({ ...data, unfilledOrderIds: ['pending-order'] } as Parameters<typeof buildCampaignCardData>[0]);
    expect(card.geometricMetricBasis?.finalExitPrice).toBe(basis.exitPrice);
    expect(card.mainPriceChangePct).toBe(basis.pct);
  });

  it('F shares corrected main exits and does not impose a separate campaign-status rule', () => {
    const data = scenario();
    data.campaign.status = 'active';
    const corrections = { main: { exitPrice: 225, originalExitPrice: 220, candleLow: 224, candleHigh: 226 } };
    const basis = campaignPriceChange(data.campaign, data.legs, data.tradeRecords, corrections);
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, [], corrections);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(basis.exitPrice);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(225);
    expect(result.effectivePriceChangePct).toBeCloseTo((225 - 140) / (100 - 90) * 100);
  });

  it('uses plus alpha, including adds greater than 100%; never the erroneous minus product', () => {
    expect(positionGeometricMultiple([1.5, 1.5, 1])).toBe(12.5);
    expect(positionGeometricMultiple([0.5, 1])).toBeCloseTo(3);
    expect(positionGeometricMultiple([])).toBe(1);
    expect(positionGeometricMultiple(null)).toBeNull();
    expect(positionGeometricMultiple([Number.NaN])).toBeNull();
    expect(positionGeometricMultiple([-0.1])).toBeNull();
  });
  it('effective rise uses fixed initial entry, allows losses and zero, and rejects missing/nonfinite prices', () => {
    expect(effectivePriceChangePct(220, 170, 100, 90)).toBe(500);
    expect(effectivePriceChangePct(140, 140, 100, 90)).toBe(0);
    expect(effectivePriceChangePct(126, 140, 100, 90)).toBeCloseTo(-140);
    expect(effectivePriceChangePct(220, 0, 100, 90)).toBeNull();
    expect(effectivePriceChangePct(null, 140, 100, 90)).toBeNull();
    expect(effectivePriceChangePct(220, 140, null, 90)).toBeNull();
    expect(effectivePriceChangePct(220, 140, 0, 90)).toBeNull();
    expect(effectivePriceChangePct(220, 140, Infinity, 90)).toBeNull();
    expect(effectivePriceChangePct(220, Number.NaN, 100, 90)).toBeNull();
    expect(effectivePriceChangePct(220, 140, Number.MIN_VALUE, 90)).toBeNull();
    expect(effectivePriceChangePct(220, 140, 100, null)).toBeNull();
    expect(effectivePriceChangePct(220, 140, 100, 100)).toBeNull();
    expect(effectivePriceChangePct(220, 140, 100, 110)).toBeNull();
    expect(effectivePriceChangePct(220, 140, 100, 0)).toBeNull();
  });
  it('initial stop sets relative-rise risk, while the later support cannot replace a missing initial stop', () => {
    const data = scenario();
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialStopPrice).toBe(90);
    expect(result.effectivePriceChangePct).toBe(800);
    data.legs[4].pre_entry_price = 80;
    data.tradeRecords[4].entryPrice = data.tradeRecords[4].exitPrice = 80;
    const widerRisk = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(widerRisk.geometricMetricBasis.initialStopPrice).toBe(80);
    expect(widerRisk.effectivePriceChangePct).toBe(400);
    expect(widerRisk.magicB).toBeCloseTo(result.magicB! / 2);
    data.legs.pop(); data.tradeRecords.pop();
    const missing = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(missing.geometricMetricBasis.lastSupport).toBe(140);
    expect(missing.geometricMetricBasis.initialStopPrice).toBeNull();
    expect(missing.effectivePriceChangePct).toBeNull();
    expect(missing.magicB).toBeNull();
  });
  it('E is fixed to the initial main + mirror entry even when later adds and reentries use different prices', () => {
    const data = scenario();
    const later = { ...data.legs[0], id: 'later-main', trade_record_id: 'later-record', pre_entry_price: 50, pre_position_size: 100,
      pre_simulated_time: iso(3) };
    data.legs.push(later);
    data.tradeRecords.push({ ...data.tradeRecords[0], id: 'later-record', fillId: 'later', entryPrice: 50, quantity: 2, openTime: at(3) });
    // The general price-change metric may choose a later main's more favorable entry.
    expect(campaignPriceChange(data.campaign, data.legs, data.tradeRecords).entryPrice).toBe(50);
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialEntryPrice).toBe(100);
    expect(result.effectivePriceChangePct).toBe(800);
    expect(result.magicB).toBeCloseTo(result.positionGeometricMultiple! * 8);
  });
  it('initial main and mirror entries are coin-weighted using the same cohort as Q0', () => {
    const data = scenario();
    data.legs[1].pre_entry_price = 110;
    data.legs[1].pre_position_size = 550;
    data.tradeRecords[1].entryPrice = 110;
    data.campaign.initial_main_size_usdt = 1050;
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialCoins).toBeCloseTo(10);
    expect(result.geometricMetricBasis.initialEntryPrice).toBeCloseTo(105);
    expect(result.effectivePriceChangePct).toBeCloseTo(80 / (105 - 90) * 100);
  });
  it('actual geometric product times effective rise equals modeled profit over initial risk', () => {
    const data = scenario();
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    const finalCoins = 5 + 7.5 + 18.75;
    expect(result.magicB).toBeCloseTo(finalCoins * (220 - 140) / (10 * (100 - 90)));
    expect(result.geometricMetricBasis.initialEntryPrice).toBe(100);
  });
  it('【用户要求】G = F − Kₘ、U = Q × ΔP、W = U × 几何仓位（理论值同样乘几何仓位（理论））', () => {
    const data = scenario();
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(220);
    expect(result.geometricMetricBasis.lastSupport).toBe(140);
    expect(result.geometricMetricBasis.initialCoins).toBeCloseTo(10);
    expect(result.unitRise).toBeCloseTo(80);
    expect(result.unitProfit).toBeCloseTo(800);
    expect(result.positionProfit).toBeCloseTo(800 * result.positionGeometricMultiple!);
    expect(result.positionProfit).toBeCloseTo((5 + 7.5 + 18.75) * 80);
    expect(result.positionProfitTheoretical).toBeCloseTo(800 * result.positionGeometricMultipleTheoretical!);
    // W ÷ (Q × (E − K初)) 就是神奇的 b：三者同一份 F、Kₘ、Q、几何仓位
    expect(result.positionProfit! / (10 * (100 - 90))).toBeCloseTo(result.magicB!);
  });
  it('G / U / W 缺依据时为 null，不补 0', () => {
    expect(computeUnitRise(null, 100)).toBeNull();
    expect(computeUnitRise(120, 0)).toBeNull();
    expect(computeUnitRise(90, 100)).toBe(-10);
    expect(computeUnitProfit(null, 10)).toBeNull();
    expect(computeUnitProfit(0, 10)).toBeNull();
    expect(computeUnitProfit(2, -10)).toBe(-20);
    expect(computePositionProfit(-20, null)).toBeNull();
    expect(computePositionProfit(-20, 1.5)).toBe(-30);
    const data = scenario();
    data.legs.pop(); data.tradeRecords.pop();
    const missing = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    // 初始止损缺失只影响相对涨幅；G / U 只用 F、Kₘ、Q，照常算
    expect(missing.effectivePriceChangePct).toBeNull();
    expect(missing.unitRise).toBeCloseTo(80);
  });
  it('initial 1 includes main and mirror but excludes a later reentry mirror; first cut is not the sum of all cuts', () => {
    const data = scenario();
    const firstCut = data.tradeRecords[1];
    const secondCut = { ...firstCut, id: 'mirror-cut-2', closeTime: firstCut.closeTime + 60_000, quantity: firstCut.quantity / 2, pnl: firstCut.pnl / 2, positionId: 'mirror-position' };
    data.tradeRecords[1] = { ...firstCut, quantity: firstCut.quantity / 2, pnl: firstCut.pnl / 2, positionId: 'mirror-position' };
    data.legs[1].trade_record_id = 'mirror-position';
    data.tradeRecords.push(secondCut);
    const later = { ...scenario().legs[1], id: 'later-mirror', trade_record_id: 'later-mirror-record', pre_simulated_time: iso(3), post_simulated_close_time: iso(7) };
    data.legs.push(later);
    data.tradeRecords.push({ ...scenario().tradeRecords[1], id: 'later-mirror-record', fillId: 'later-fill', openTime: at(3), closeTime: at(7) });
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialCoins).toBe(10);
    expect(result.geometricMetricBasis.earlyReductionFraction).toBe(0.25);
    expect(positionGeometricMultiple([1, 1], 0.25)).toBe(3);
    expect(positionGeometricMultiple([1], null)).toBeNull();
  });
  it.each([0.5, 0.4, 0.53])('actual early reduction %s, two actual adds and final exit', reduction => {
    const data = scenario(reduction);
    const steps = resolveCampaignAddQuantitySteps(data);
    expect(steps).toHaveLength(2);
    expect(steps[0].beforeCoins).toBeCloseTo(10 * (1 - reduction));
    expect(steps[1].beforeCoins).toBeCloseTo(25 * (1 - reduction));
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialCoins).toBeCloseTo(10);
    expect(result.geometricMetricBasis.earlyReductionFraction).toBeCloseTo(reduction);
    expect(result.geometricMetricBasis.addRatios).toEqual([1.5, 1.5]);
    // Actual pre-add coins already reflect early reduction; never multiply by retention again.
    expect(result.positionGeometricMultiple).toBeCloseTo((1 - reduction) * 2.5 * 2.5);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(220);
    expect(result.geometricMetricBasis.lastSupport).toBe(140);
    expect(result.effectivePriceChangePct).toBeCloseTo(80 / (100 - 90) * 100);
    const card = buildCampaignCardData(data as Parameters<typeof buildCampaignCardData>[0]);
    expect(rowPositionGeometricMultiple(card)).toBe(result.positionGeometricMultiple);
    expect(rowEffectivePriceChangePct(card)).toBe(result.effectivePriceChangePct);
    const items = buildCampaignPnlOverviewItems({ ...result } as Parameters<typeof buildCampaignPnlOverviewItems>[0]);
    const keys = items.map(item => item.key);
    expect(keys).toEqual(expect.arrayContaining(['addCount', 'positionGeometricMultiple', 'effectivePriceChangePct', 'magicB', 'payoffRatio']));
    expect(keys).not.toContain('positionGeometricMultipleTheoretical');
    // Relative rise now uses the fixed initial risk price gap exactly once.
    expect(card.initialExpectedMaxDrawdownPct).toBe(10);
    expect(result.effectivePriceChangeMultiple).toBe(80);
    expect(result.magicB).toBeCloseTo(result.positionGeometricMultiple! * 80 / (100 - 90));
  });
  it('no adds: product is one, no Km; unfilled adds do not invent factors', () => {
    const data = scenario(0.4);
    data.legs = data.legs.slice(0, 2);
    data.tradeRecords = data.tradeRecords.slice(0, 2);
    const pending = { ...scenario().legs[2], id: 'pending', trade_record_id: null, post_simulated_close_time: null, post_exit_price_snapshot: null };
    const result = computeCampaignGeometricMetrics(data.campaign, [...data.legs, pending], data.tradeRecords);
    expect(result.positionGeometricMultiple).toBeCloseTo(1 - result.geometricMetricBasis.earlyReductionFraction!);
    expect(result.effectivePriceChangePct).toBeNull();
    expect(result.magicB).toBeNull();
  });
  it('no actual add stays unavailable even when net profit and initial risk are both known', () => {
    const data = scenario();
    data.legs = data.legs.slice(0, 2);
    data.tradeRecords = data.tradeRecords.slice(0, 2);
    const orders = [{ id: 'initial', side: 'SHORT', price: 90, status: 'cancelled', createdAt: at(0), cancelledAt: at(1) }] as CampaignReverseHedgeOrder[];
    expect(computeInitialExpectedMaxLoss(data.campaign, data.legs, data.tradeRecords, orders)).toBe(100);
    expect(computeCampaignRealizedPnl(data.campaign, data.legs, data.tradeRecords).total).toBe(700);
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.positionGeometricMultiple).toBeCloseTo(1 - result.geometricMetricBasis.earlyReductionFraction!);
    expect(result.magicB).toBeNull();
  });
  it('missing prices stay unknown; cached null is not replaced with a guessed value', () => {
    const data = scenario();
    data.legs[0].pre_position_size = null;
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.positionGeometricMultiple).toBeNull();
    expect(result.geometricMetricBasis.initialEntryPrice).toBe(100);
    expect(result.effectivePriceChangePct).toBe(800);
    expect(result.magicB).toBeNull();
    expect(rowPositionGeometricMultiple({ ...data, positionGeometricMultiple: null })).toBeNull();
  });
  it('shared opening fill is counted once; early mirror profit is not a terminal exit', () => {
    const data = scenario();
    data.tradeRecords[0].fillId = data.tradeRecords[1].fillId = 'initial-shared-fill';
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialCoins).toBe(10);
    expect(result.geometricMetricBasis.earlyReductionFraction).toBe(0.5);
    expect(result.positionGeometricMultiple).toBe(3.125);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(220);
  });
  it('a main position closed in slices uses actual early cut and actual final cut price', () => {
    const data = scenario();
    const cut = { ...data.tradeRecords[1], id: 'early-cut', fillId: 'main-fill', positionId: 'main-position' };
    const final = { ...data.tradeRecords[0], fillId: 'main-fill', positionId: 'main-position' };
    data.tradeRecords = [cut, final, ...data.tradeRecords.slice(2)];
    data.legs = [ { ...data.legs[0], trade_record_id: 'main-position', pre_position_size: 1000 }, ...data.legs.slice(2) ];
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialCoins).toBe(10);
    expect(result.geometricMetricBasis.earlyReductionFraction).toBe(0.5);
    expect(result.geometricMetricBasis.addRatios).toEqual([1.5, 1.5]);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(220);
    expect(result.positionGeometricMultiple).toBe(3.125);
  });
  it('first add uses mirror-adjusted S0 once, then the next risk-budget line equals the prior support', () => {
    const data = scenario();
    const orders = [
      { id: 'k1', side: 'SHORT', price: 110, status: 'cancelled', createdAt: at(2), cancelledAt: at(3) },
      { id: 'k2', side: 'SHORT', price: 140, status: 'cancelled', createdAt: at(4), cancelledAt: at(8) },
    ] as CampaignReverseHedgeOrder[];
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.geometricMetricBasis.firstAdd).toMatchObject({
      beforeCoins: 5, addCoins: 7.5, costLine: 100, breakevenLine: 80, bankedProfit: 100,
      support: 110, addPrice: 130, actualRatio: 1.5, allowedRatio: 1.5,
    });
    const first = calculateAddPosition({ currentPrice: 130, support: 110, state: initialAddPositionState(100, 5, 100) });
    expect(result.geometricMetricBasis.firstAdd!.afterCoins).toBe(12.5);
    expect(result.geometricMetricBasis.firstAdd!.afterCostLine).toBe(118);
    expect(result.geometricMetricBasis.firstAdd!.afterBreakevenLine).toBe(110);
    expect(first.addCoins / 5).toBe(result.geometricMetricBasis.firstAdd!.allowedRatio);
    expect(first.next!.mirrorProfitAvailable).toBe(0);
    const second = calculateAddPosition({ currentPrice: 160, support: 140, state: first.next! });
    expect(second.addCoins / first.newCoins).toBe(1.5);
    const verdicts = evaluateCampaignAddSizing({ ...data, reverseHedgeOrders: orders });
    // Recomputed real average − the same banked profit gives K1; it never creates a second profit allowance.
    expect(geometricFirstAddBasis(verdicts.get('add2'))!.breakevenLine).toBe(110);
    expect(result.positionGeometricMultiple).toBe(0.5 * (1 + 1.5) * (1 + 1.5));
    expect(result.geometricMetricBasis.theoreticalFactors?.map(factor => factor?.alpha)).toEqual([1.5, 1.1]);
    expect(result.positionGeometricMultipleTheoretical).toBeCloseTo(0.5 * 2.5 * 2.1);
    expect(rowPositionGeometricMultiple(buildCampaignCardData({ ...data, reverseHedgeOrders: orders } as Parameters<typeof buildCampaignCardData>[0]))).toBe(3.125);
  });
  it('does not substitute the allowable cap for an actual partial add', () => {
    const data = scenario();
    data.legs[2].pre_position_size = 5 * 130;
    data.tradeRecords[2].quantity = 5;
    const orders = [{ id: 'k1', side: 'SHORT', price: 110, status: 'cancelled', createdAt: at(2), cancelledAt: at(3) }] as CampaignReverseHedgeOrder[];
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.geometricMetricBasis.firstAdd!.allowedRatio).toBe(1.5);
    expect(result.geometricMetricBasis.firstAdd!.actualRatio).toBe(1);
    expect(result.positionGeometricMultiple).toBeCloseTo(0.5 * (1 + 1) * (1 + 18.75 / 10));
  });
  it('the rise multiple sorts independently from raw rise and magic b', () => {
    const row = (id: string, multiple: number, rise: number) => ({
      ...scenario(), campaign: { ...scenario().campaign, id }, positionGeometricMultiple: multiple, effectivePriceChangePct: rise,
      profitCaptureRatio: multiple * rise * 10, initialExpectedMaxDrawdownPct: 10, arithmeticExpectancy: 0, geometricExpectancy: 0,
      magicB: multiple * rise / 10,
    } as unknown as CampaignSortRow);
    const rows = [row('a', 2, -10), row('b', 4, 20), row('c', 1, 5)];
    expect(sortCampaignRows(rows, [{ mode: 'positionGeometricMultiple', direction: 'desc' }]).map(value => value.campaign.id)).toEqual(['b', 'a', 'c']);
    expect(sortCampaignRows(rows, [{ mode: 'effectivePriceChangePct', direction: 'asc' }]).map(value => value.campaign.id)).toEqual(['a', 'c', 'b']);
    expect(sortCampaignRows(rows, [{ mode: 'effectivePriceChangeMultiple', direction: 'asc' }]).map(value => value.campaign.id)).toEqual(['a', 'c', 'b']);
    expect(sortCampaignRows(rows, [{ mode: 'magicB', direction: 'desc' }]).map(value => value.campaign.id)).toEqual(['b', 'c', 'a']);
  });

  it('EVAA multiplies actual geometry by effective rise, independently of the net-settlement payoff', () => {
    const E = 1.9344530604459202, T = 2.12834119256148, K = 1.9009;
    const F = 2.599662936, D = 2.574768235, M = 2.0292560416666667, X = 2.562348235;
    const data = scenario();
    data.campaign.initial_main_size_usdt = 1740380;
    const values = [
      ['main', 'main_open', 'long', 870190, E, D, 0, 8, 435.095],
      ['mirror', 'mirror_tp', 'long', 870190, E, M, 0, 1, 435.095],
      ['add1', 'main_add_1', 'long', 255270, T, D, 2, 8, 127.635],
      ['hedge', 'hedge_rolling', 'short', 148200, F, X, 7, 8, 74.1],
    ] as const;
    data.legs = values.map(([id, role, side, notional, entry, exit, open, close]) => ({ ...scenario().legs[0], id, leg_role: role,
      direction: side, trade_record_id: `${id}-record`, pre_position_size: notional, pre_entry_price: entry,
      pre_simulated_time: iso(open), post_simulated_close_time: iso(close), post_exit_price_snapshot: exit } as TradeJournal));
    data.tradeRecords = values.map(([id, , side, notional, entry, exit, open, close, fee]) => ({ ...scenario().tradeRecords[0],
      id: `${id}-record`, fillId: id, side: side === 'long' ? 'LONG' : 'SHORT', entryPrice: entry, exitPrice: exit,
      quantity: notional / entry, openTime: at(open), closeTime: at(close), fee,
      pnl: (side === 'long' ? 1 : -1) * notional / entry * (exit - entry) - fee,
      addSizingSnapshot: id === 'add1' ? { s1: K } : undefined } as TradeRecord));
    const orders = [{ id: 'initial', side: 'SHORT', price: 1.7424, status: 'cancelled', createdAt: at(0), cancelledAt: at(1) },
      { id: 'k1', side: 'SHORT', price: K, status: 'cancelled', createdAt: at(2), cancelledAt: at(8) }] as CampaignReverseHedgeOrder[];
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.positionGeometricMultiple).toBeCloseTo(0.5 * 1.266626084915328, 10);
    const expected = result.positionGeometricMultiple! * (F - K) / (E - 1.7424);
    expect(result.magicB).toBeCloseTo(expected, 10);
    expect(result.magicB).toBeCloseTo(0.5 * 1.266626084915328 * (F - K) / (E - 1.7424), 10);
    expect(result.magicB).not.toBeCloseTo(2.229834766100436, 5);
    expect(result.geometricMetricBasis.firstAdd!.afterBreakevenLine).toBeCloseTo(1.9011834778793941, 10);
    const card = buildCampaignCardData({ ...data, reverseHedgeOrders: orders } as Parameters<typeof buildCampaignCardData>[0]);
    expect(rowMagicB(card)).toBe(result.magicB);
    expect(result.geometricMetricBasis).not.toHaveProperty('magicBReconciliation');
  });

  it.each([false, true])('multiple adds and intermediate reduction=%s retain actual-alpha geometry without settlement adjustment', intermediate => {
    const data = scenario();
    const orders = [{ id: 'initial', side: 'SHORT', price: 90, status: 'cancelled', createdAt: at(0), cancelledAt: at(1) }] as CampaignReverseHedgeOrder[];
    if (intermediate) {
      data.legs[0].trade_record_id = 'main-position';
      data.tradeRecords[0].positionId = 'main-position';
      data.tradeRecords[0].quantity = 3;
      data.tradeRecords[0].pnl = 3 * 120 - 2;
      data.tradeRecords.push({ ...data.tradeRecords[0], id: 'middle-cut', quantity: 2, exitPrice: 150, closeTime: at(3), pnl: 2 * 50 - 1 });
    }
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    const L0 = computeInitialExpectedMaxLoss(data.campaign, data.legs, data.tradeRecords, orders);
    expect(L0).toBe(100);
    const steps = resolveCampaignAddQuantitySteps({ ...data, reverseHedgeOrders: orders });
    const expectedC = steps.reduce((product, step) => product * (1 + step.addCoins! / step.beforeCoins!), 1);
    expect(result.positionGeometricMultiple).toBeCloseTo(0.5 * expectedC, 10);
    expect(result.magicB).toBeCloseTo(expectedC * 0.5 * 80 / (100 - 90), 10);
  });

  it('changed net settlement, fees and liquidation PnL never override the same geometric inputs', () => {
    const data = scenario();
    const orders = [{ id: 'initial', side: 'SHORT', price: 90, status: 'cancelled', createdAt: at(0), cancelledAt: at(1) }] as CampaignReverseHedgeOrder[];
    const corrections = {add2: {originalExitPrice: 220, exitPrice: 210, candleLow: 200, candleHigh: 215}};
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders, corrections);
    const oldSettlement = computeCampaignRealizedPnl(data.campaign, data.legs, data.tradeRecords, corrections).total;
    data.tradeRecords[3].action = 'LIQUIDATION';
    data.tradeRecords[3].pnl = -500;
    data.tradeRecords[3].fee = 123;
    data.campaign.final_realized_pnl = 999999;
    const liquidation = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders, corrections);
    expect(computeCampaignRealizedPnl(data.campaign, data.legs, data.tradeRecords, corrections).total).not.toBe(oldSettlement);
    expect(liquidation.magicB).toBe(result.magicB);
  });

  it('missing first sizing verdict does not prevent b when actual quantity factors and final support are known', () => {
    const data = scenario();
    const orders = [{ id: 'initial', side: 'SHORT', price: 90, status: 'cancelled', createdAt: at(0), cancelledAt: at(1) }] as CampaignReverseHedgeOrder[];
    data.tradeRecords[2].addSizingSnapshot = undefined;
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.geometricMetricBasis.firstAdd).toBeNull();
    expect(result.magicB).toBeCloseTo(3.125 * 80 / (100 - 90), 10);
  });

  it('b uses actual quantity geometry, without mapping coins onto T1 for beta', () => {
    const data = scenario();
    const orders = [{ id: 'initial', side: 'SHORT', price: 90, status: 'cancelled', createdAt: at(0), cancelledAt: at(1) }] as CampaignReverseHedgeOrder[];
    data.legs[2].pre_entry_price = 120;
    data.tradeRecords[2].entryPrice = 132;
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.magicB).toBeCloseTo(result.positionGeometricMultiple! * 80 / (100 - 90), 10);
  });

  it('missing first-add price never falls back to net settlement, Km, or stored campaign total', () => {
    const data = scenario();
    const orders = [{ id: 'initial', side: 'SHORT', price: 90, status: 'cancelled', createdAt: at(0), cancelledAt: at(1) }] as CampaignReverseHedgeOrder[];
    data.tradeRecords[2].entryPrice = 0;
    data.legs[2].pre_entry_price = null;
    data.campaign.final_realized_pnl = 999999;
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.magicB).toBeNull();
    expect(rowMagicB({...data, magicB: null})).toBeNull();
  });
});
