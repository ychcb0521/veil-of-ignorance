import { describe, expect, it } from 'vitest';
import { computeCampaignGeometricMetrics, computeEffectivePriceChangeMultiple, computeMagicB, effectivePriceChangePct, geometricFirstAddBasis, positionGeometricMultiple } from '@/lib/campaignGeometricMetrics';
import { evaluateCampaignAddSizing, resolveCampaignAddQuantitySteps } from '@/lib/campaignAddSizingCheck';
import { calculateAddPosition, initialAddPositionState } from '@/lib/addPositionCoverage';
import { campaignPriceChange } from '@/lib/campaignMainPriceChange';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { buildCampaignPnlOverviewItems } from '@/lib/campaignPnlOverview';
import { rowEffectivePriceChangePct, rowPositionGeometricMultiple, sortCampaignRows, type CampaignSortRow } from '@/lib/campaignListSort';
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
  return { campaign, legs, tradeRecords: records, reverseHedgeOrders: [], pendingOrders: [] };
}

describe('campaign geometric metrics', () => {
  it('rise multiples use the initial drawdown and magic b multiplies the two full-precision factors', () => {
    expect(computeEffectivePriceChangeMultiple(45, 9)).toBe(5);
    expect(computeEffectivePriceChangeMultiple(-10, 5)).toBe(-2);
    expect(computeEffectivePriceChangeMultiple(45, 0)).toBeNull();
    expect(computeEffectivePriceChangeMultiple(null, 9)).toBeNull();
    expect(computeMagicB(5, 2)).toBe(10);
    expect(computeMagicB(-2, 3)).toBe(-6);
    expect(computeMagicB(0, 3)).toBe(0);
    expect(computeMagicB(null, 3)).toBeNull();
    expect(computeMagicB(45, null)).toBeNull();
    expect(computeMagicB(Infinity, 3)).toBeNull();
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
    expect(result.effectivePriceChangePct).toBeCloseTo((220 - 140) / 140 * 100);
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
    expect(result.effectivePriceChangePct).toBeCloseTo((200 - 140) / 140 * 100);
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
    expect(result.effectivePriceChangePct).toBeCloseTo((225 - 140) / 140 * 100);
  });

  it('uses plus alpha, including adds greater than 100%; never the erroneous minus product', () => {
    expect(positionGeometricMultiple([1.5, 1.5, 1])).toBe(12.5);
    expect(positionGeometricMultiple([0.5, 1])).toBeCloseTo(3);
    expect(positionGeometricMultiple([])).toBe(1);
    expect(positionGeometricMultiple(null)).toBeNull();
    expect(positionGeometricMultiple([Number.NaN])).toBeNull();
    expect(positionGeometricMultiple([-0.1])).toBeNull();
  });
  it('effective rise allows losses and zero; requires positive Km', () => {
    expect(effectivePriceChangePct(220, 170)).toBeCloseTo(29.4117647059);
    expect(effectivePriceChangePct(140, 140)).toBe(0);
    expect(effectivePriceChangePct(126, 140)).toBe(-10);
    expect(effectivePriceChangePct(220, 0)).toBeNull();
    expect(effectivePriceChangePct(null, 140)).toBeNull();
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
    expect(result.positionGeometricMultiple).toBeCloseTo(2.5 * 2.5);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(220);
    expect(result.geometricMetricBasis.lastSupport).toBe(140);
    expect(result.effectivePriceChangePct).toBeCloseTo(80 / 140 * 100);
    const card = buildCampaignCardData(data as Parameters<typeof buildCampaignCardData>[0]);
    expect(rowPositionGeometricMultiple(card)).toBe(result.positionGeometricMultiple);
    expect(rowEffectivePriceChangePct(card)).toBe(result.effectivePriceChangePct);
    const items = buildCampaignPnlOverviewItems({ ...result } as Parameters<typeof buildCampaignPnlOverviewItems>[0]);
    const keys = items.map(item => item.key);
    expect(keys[keys.indexOf('positionAmplification') + 1]).toBe('positionGeometricMultiple');
    expect(keys[keys.indexOf('positionGeometricMultiple') + 1]).toBe('effectivePriceChangePct');
    expect(keys[keys.indexOf('effectivePriceChangePct') + 1]).toBe('effectivePriceChangeMultiple');
    expect(keys[keys.indexOf('effectivePriceChangeMultiple') + 1]).toBe('magicB');
    // The synthetic campaign has no initial hedge boundary, so the risk denominator is genuinely missing.
    expect(card.initialExpectedMaxDrawdownPct).toBe(0);
    expect(result.effectivePriceChangeMultiple).toBeNull();
    expect(result.magicB).toBeNull();
  });
  it('no adds: product is one, no Km; unfilled adds do not invent factors', () => {
    const data = scenario(0.4);
    data.legs = data.legs.slice(0, 2);
    data.tradeRecords = data.tradeRecords.slice(0, 2);
    const pending = { ...scenario().legs[2], id: 'pending', trade_record_id: null, post_simulated_close_time: null, post_exit_price_snapshot: null };
    const result = computeCampaignGeometricMetrics(data.campaign, [...data.legs, pending], data.tradeRecords);
    expect(result.positionGeometricMultiple).toBe(1);
    expect(result.effectivePriceChangePct).toBeNull();
  });
  it('missing prices stay unknown; cached null is not replaced with a guessed value', () => {
    const data = scenario();
    data.legs[0].pre_position_size = null;
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.positionGeometricMultiple).toBeNull();
    expect(rowPositionGeometricMultiple({ ...data, positionGeometricMultiple: null })).toBeNull();
  });
  it('shared opening fill is counted once; early mirror profit is not a terminal exit', () => {
    const data = scenario();
    data.tradeRecords[0].fillId = data.tradeRecords[1].fillId = 'initial-shared-fill';
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    expect(result.geometricMetricBasis.initialCoins).toBe(10);
    expect(result.geometricMetricBasis.earlyReductionFraction).toBe(0.5);
    expect(result.positionGeometricMultiple).toBe(6.25);
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
    expect(result.positionGeometricMultiple).toBe(6.25);
  });
  it('first add uses mirror-adjusted S0 once, then the next risk-budget line equals the prior support', () => {
    const data = scenario();
    const orders = [
      { id: 'k1', side: 'SHORT', price: 110, status: 'cancelled', createdAt: at(2), cancelledAt: at(3) },
      { id: 'k2', side: 'SHORT', price: 140, status: 'cancelled', createdAt: at(4), cancelledAt: at(8) },
    ] as CampaignReverseHedgeOrder[];
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.geometricMetricBasis.firstAdd).toEqual({
      beforeCoins: 5, addCoins: 7.5, costLine: 100, breakevenLine: 80, bankedProfit: 100,
      support: 110, addPrice: 130, actualRatio: 1.5, allowedRatio: 1.5,
    });
    const first = calculateAddPosition({ currentPrice: 130, support: 110, state: initialAddPositionState(100, 5, 100) });
    expect(first.addCoins / 5).toBe(result.geometricMetricBasis.firstAdd!.allowedRatio);
    expect(first.next!.mirrorProfitAvailable).toBe(0);
    const second = calculateAddPosition({ currentPrice: 160, support: 140, state: first.next! });
    expect(second.addCoins / first.newCoins).toBe(1.5);
    const verdicts = evaluateCampaignAddSizing({ ...data, reverseHedgeOrders: orders });
    // Recomputed real average − the same banked profit gives K1; it never creates a second profit allowance.
    expect(geometricFirstAddBasis(verdicts.get('add2'))!.breakevenLine).toBe(110);
    expect(result.positionGeometricMultiple).toBe((1 + 1.5) * (1 + 1.5));
    expect(rowPositionGeometricMultiple(buildCampaignCardData({ ...data, reverseHedgeOrders: orders } as Parameters<typeof buildCampaignCardData>[0]))).toBe(6.25);
  });
  it('does not substitute the allowable cap for an actual partial add', () => {
    const data = scenario();
    data.legs[2].pre_position_size = 5 * 130;
    data.tradeRecords[2].quantity = 5;
    const orders = [{ id: 'k1', side: 'SHORT', price: 110, status: 'cancelled', createdAt: at(2), cancelledAt: at(3) }] as CampaignReverseHedgeOrder[];
    const result = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(result.geometricMetricBasis.firstAdd!.allowedRatio).toBe(1.5);
    expect(result.geometricMetricBasis.firstAdd!.actualRatio).toBe(1);
    expect(result.positionGeometricMultiple).toBeCloseTo((1 + 1) * (1 + 18.75 / 10));
  });
  it('the rise multiple sorts independently from raw rise and magic b', () => {
    const row = (id: string, multiple: number, rise: number) => ({
      ...scenario(), campaign: { ...scenario().campaign, id }, positionGeometricMultiple: multiple, effectivePriceChangePct: rise,
      profitCaptureRatio: 10, initialExpectedMaxDrawdownPct: 10, arithmeticExpectancy: 0, geometricExpectancy: 0,
    } as unknown as CampaignSortRow);
    const rows = [row('a', 2, -10), row('b', 4, 20), row('c', 1, 5)];
    expect(sortCampaignRows(rows, [{ mode: 'positionGeometricMultiple', direction: 'desc' }]).map(value => value.campaign.id)).toEqual(['b', 'a', 'c']);
    expect(sortCampaignRows(rows, [{ mode: 'effectivePriceChangePct', direction: 'asc' }]).map(value => value.campaign.id)).toEqual(['a', 'c', 'b']);
    expect(sortCampaignRows(rows, [{ mode: 'effectivePriceChangeMultiple', direction: 'asc' }]).map(value => value.campaign.id)).toEqual(['a', 'c', 'b']);
    expect(sortCampaignRows(rows, [{ mode: 'magicB', direction: 'desc' }]).map(value => value.campaign.id)).toEqual(['b', 'c', 'a']);
  });
});
