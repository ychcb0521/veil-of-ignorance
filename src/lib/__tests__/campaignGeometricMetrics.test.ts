import { describe, expect, it } from 'vitest';
import { computeCampaignGeometricMetrics, effectivePriceChangePct, positionGeometricMultiple } from '@/lib/campaignGeometricMetrics';
import { resolveCampaignAddQuantitySteps } from '@/lib/campaignAddSizingCheck';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { buildCampaignPnlOverviewItems } from '@/lib/campaignPnlOverview';
import { rowEffectivePriceChangePct, rowPositionGeometricMultiple, sortCampaignRows, type CampaignSortRow } from '@/lib/campaignListSort';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

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
  it('uses plus alpha, including adds greater than 100%; never the erroneous minus product', () => {
    expect(positionGeometricMultiple(0.5, [1.5, 1.5, 1])).toBe(6.25);
    expect(positionGeometricMultiple(0.4, [0.5, 1])).toBeCloseTo(1.8);
    expect(positionGeometricMultiple(0, [])).toBe(1);
    expect(positionGeometricMultiple(0.5, [])).toBe(0.5);
    expect(positionGeometricMultiple(null, [1])).toBeNull();
    expect(positionGeometricMultiple(0.5, [Number.NaN])).toBeNull();
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
    expect(result.positionGeometricMultiple).toBeCloseTo((1 - reduction) * 2.5 * 2.5);
    expect(result.geometricMetricBasis.finalExitPrice).toBe(220);
    expect(result.geometricMetricBasis.lastSupport).toBe(140);
    expect(result.effectivePriceChangePct).toBeCloseTo(80 / 140 * 100);
    const card = buildCampaignCardData(data as Parameters<typeof buildCampaignCardData>[0]);
    expect(rowPositionGeometricMultiple(card)).toBe(result.positionGeometricMultiple);
    expect(rowEffectivePriceChangePct(card)).toBe(result.effectivePriceChangePct);
    const items = buildCampaignPnlOverviewItems({ ...result } as Parameters<typeof buildCampaignPnlOverviewItems>[0]);
    const keys = items.map(item => item.key);
    expect(keys[keys.indexOf('positionAmplification') + 1]).toBe('positionGeometricMultiple');
    expect(keys[keys.indexOf('geometricExpectancy') + 1]).toBe('effectivePriceChangePct');
  });
  it('no adds: actual retained factor, no Km; unfilled adds do not invent factors', () => {
    const data = scenario(0.4);
    data.legs = data.legs.slice(0, 2);
    data.tradeRecords = data.tradeRecords.slice(0, 2);
    const pending = { ...scenario().legs[2], id: 'pending', trade_record_id: null, post_simulated_close_time: null, post_exit_price_snapshot: null };
    const result = computeCampaignGeometricMetrics(data.campaign, [...data.legs, pending], data.tradeRecords);
    expect(result.positionGeometricMultiple).toBeCloseTo(0.6);
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
  it('both metrics support ascending/descending and multi-level sort', () => {
    const row = (id: string, multiple: number, rise: number) => ({
      ...scenario(), campaign: { ...scenario().campaign, id }, positionGeometricMultiple: multiple, effectivePriceChangePct: rise,
      profitCaptureRatio: 10, initialExpectedMaxDrawdownPct: 10, arithmeticExpectancy: 0, geometricExpectancy: 0,
    } as unknown as CampaignSortRow);
    const rows = [row('a', 2, -10), row('b', 4, 20), row('c', 1, 5)];
    expect(sortCampaignRows(rows, [{ mode: 'positionGeometricMultiple', direction: 'desc' }]).map(value => value.campaign.id)).toEqual(['b', 'a', 'c']);
    expect(sortCampaignRows(rows, [{ mode: 'effectivePriceChangePct', direction: 'asc' }]).map(value => value.campaign.id)).toEqual(['a', 'c', 'b']);
  });
});
