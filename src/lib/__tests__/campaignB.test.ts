import { describe, expect, it } from 'vitest';
import { resolveUnifiedMagicB } from '@/lib/campaignB';
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
  it('ignores conflicting historical net ratios in readers, add efficiency and sorting', () => {
    const high = makeSortRow({id: 'high', pcr: -500, magicB: 4, add: true, mpc: 20, dd: 10});
    const low = makeSortRow({id: 'low', pcr: 10000, magicB: 2, add: true, mpc: 20, dd: 10});
    const missing = makeSortRow({id: 'missing', pcr: 10000, magicB: null});
    expect(rowMagicB(high)).toBe(4);
    expect(rowPayoffRatio(high)).toBe(4);
    expect(rowAddEfficiency(high)).toBe(2);
    expect(rowMagicB(missing)).toBeNull();
    expect(sortCampaignRows([low, high, missing], [{mode: 'magicB', direction: 'desc'}]).map(row => row.campaign.id)).toEqual(['high', 'low']);
  });
  it('all existing expectancy calculations are adapters to the canonical b API', () => {
    for (const b of [-12, -1, -0.5, 0, 2, 496.29]) {
      expect(computeCampaignExpectancies(b * 100)).toEqual(computeCampaignExpectanciesFromMagicB(b));
    }
    expect(computeCampaignExpectanciesFromMagicB(null)).toEqual({arithmeticExpectancy: null, geometricExpectancy: null});
  });
  it('old b URLs migrate without duplicate sort levels or changed directions', () => {
    expect(parseCampaignSortChain('?sort=captureRate&direction=asc&then=magicB.desc&then=addCount.follow')).toEqual([
      {mode: 'magicB', direction: 'asc'}, {mode: 'addCount', direction: 'asc', follow: true},
    ]);
  });
});
