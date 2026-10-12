import { describe, expect, it } from 'vitest';
import { magicBFromRealizedPnl, resolveUnifiedMagicB } from '@/lib/campaignB';
import { computeCampaignExpectancies, computeCampaignExpectanciesFromMagicB } from '@/lib/campaignMetrics';
import { parseCampaignSortChain } from '@/lib/campaignListSort';

describe('unified campaign b', () => {
  it('uses net settlement for wins, losses and zero without requiring an add', () => {
    expect(magicBFromRealizedPnl(200, 100)).toBe(2);
    expect(magicBFromRealizedPnl(-50, 100)).toBe(-0.5);
    expect(magicBFromRealizedPnl(0, 100)).toBe(0);
    expect(magicBFromRealizedPnl(200, 0)).toBeNull();
    expect(magicBFromRealizedPnl(null, 100)).toBeNull();
    expect(magicBFromRealizedPnl(Infinity, 100)).toBeNull();
  });
  it('adapts historical percent fields and never prefers a stale cached product', () => {
    expect(resolveUnifiedMagicB(223, 4.69)).toBe(2.23);
    expect(resolveUnifiedMagicB(-50, 4.69)).toBe(-0.5);
    expect(resolveUnifiedMagicB(null, 4.69)).toBeNull();
    expect(resolveUnifiedMagicB(undefined, 2.23)).toBe(2.23);
    expect(resolveUnifiedMagicB(NaN, 4.69)).toBeNull();
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
