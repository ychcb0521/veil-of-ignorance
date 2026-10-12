import { describe, expect, it } from 'vitest';
import { computeSettlementPayoffRatio, resolveUnifiedMagicB } from '@/lib/campaignB';
import { computeCampaignExpectancies, computeCampaignExpectanciesFromMagicB } from '@/lib/campaignMetrics';
import { parseCampaignSortChain, rowMagicB, rowPayoffRatio, rowAddEfficiency, sortCampaignRows } from '@/lib/campaignListSort';
import { makeSortRow } from '@/test/fixtures/campaignSortRows';

describe('unified campaign b', () => {
  it('retains canonical b and rejects missing or non-finite values without unit conversion', () => {
    expect(resolveUnifiedMagicB(2)).toBe(2);
    expect(resolveUnifiedMagicB(-0.5)).toBe(-0.5);
    expect(resolveUnifiedMagicB(0)).toBe(0);
    expect(resolveUnifiedMagicB(null)).toBeNull();
    expect(resolveUnifiedMagicB(undefined)).toBeNull();
    expect(resolveUnifiedMagicB(Infinity)).toBeNull();
    expect(resolveUnifiedMagicB(NaN)).toBeNull();
  });
  it('restores original payoff independently of geometric b, including no-add campaigns', () => {
    const high = makeSortRow({id: 'high', pcr: -500, magicB: 4, add: true, mpc: 20, dd: 10});
    const low = makeSortRow({id: 'low', pcr: 10000, magicB: 2, add: true, mpc: 20, dd: 10});
    const missing = makeSortRow({id: 'missing', pcr: 10000, magicB: null});
    expect(rowMagicB(high)).toBe(4);
    expect(rowPayoffRatio(high)).toBe(-5);
    expect(rowAddEfficiency(high)).toBe(-2.5);
    expect(rowPayoffRatio(missing)).toBe(100);
    expect(rowMagicB(missing)).toBeNull();
    expect(sortCampaignRows([low, high, missing], [{mode: 'magicB', direction: 'desc'}]).map(row => row.campaign.id)).toEqual(['high', 'low']);
    expect(sortCampaignRows([low, high, missing], [{mode: 'captureRate', direction: 'asc'}])[0].campaign.id).toBe('high');
  });
  it('all existing expectancy calculations are adapters to the canonical b API', () => {
    for (const b of [-12, -1, -0.5, 0, 2, 496.29]) {
      expect(computeCampaignExpectancies(b * 100)).toEqual(computeCampaignExpectanciesFromMagicB(b));
    }
    expect(computeCampaignExpectanciesFromMagicB(null)).toEqual({arithmeticExpectancy: null, geometricExpectancy: null});
  });
  it('restored payoff and geometric b retain separate URL sort levels', () => {
    expect(parseCampaignSortChain('?sort=captureRate&direction=asc&then=magicB.desc&then=addCount.follow')).toEqual([
      {mode: 'captureRate', direction: 'asc'}, {mode: 'magicB', direction: 'desc'}, {mode: 'addCount', direction: 'desc', follow: true},
    ]);
  });
  it('computes original settlement ratio with signed results and rejects invalid initial risk', () => {
    expect(computeSettlementPayoffRatio(385282.96,172785.43)).toBeCloseTo(2.23,2);
    expect(computeSettlementPayoffRatio(-50,100)).toBe(-0.5);
    expect(computeSettlementPayoffRatio(0,100)).toBe(0);
    expect(computeSettlementPayoffRatio(50,0)).toBeNull();
    expect(computeSettlementPayoffRatio(null,100)).toBeNull();
  });
});
