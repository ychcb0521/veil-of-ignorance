import { describe, expect, it } from 'vitest';
import { buildCampaignOddsSeries } from '@/lib/campaignOddsSeries';

describe('buildCampaignOddsSeries', () => {
  it('keeps valid odds, sorts by objective operation time, and assigns uniform sequence positions', () => {
    const result = buildCampaignOddsSeries([
      { campaignId: 'later', title: 'Later', symbol: 'BTCUSDT', odds: -0.8, operationTime: 300 },
      { campaignId: 'same-b', title: 'Same B', symbol: 'BTCUSDT', odds: 1.2, operationTime: 200 },
      { campaignId: 'same-a', title: 'Same A', symbol: 'BTCUSDT', odds: 0, operationTime: 200 },
      { campaignId: 'missing-odds', title: 'Missing odds', symbol: 'BTCUSDT', odds: null, operationTime: 100 },
      { campaignId: 'missing-time', title: 'Missing time', symbol: 'BTCUSDT', odds: 2, operationTime: null },
    ]);

    expect(result.points.map(point => ({
      id: point.campaignId,
      odds: point.odds,
      sequence: point.sequence,
    }))).toEqual([
      { id: 'same-a', odds: 0, sequence: 1 },
      { id: 'same-b', odds: 1.2, sequence: 2 },
      { id: 'later', odds: -0.8, sequence: 3 },
    ]);
    expect(result.excludedMissingOddsCount).toBe(1);
    expect(result.excludedMissingOperationTimeCount).toBe(1);
  });
});
