import { describe, expect, it } from 'vitest';
import { buildCampaignMetricSeries } from '@/lib/campaignMetricSeries';

describe('buildCampaignMetricSeries', () => {
  it('sorts finite metric values by objective operation time with stable tie ordering', () => {
    const result = buildCampaignMetricSeries([
      { campaignId: 'later', title: 'Later', symbol: 'BTCUSDT', value: -0.8, operationTime: 300 },
      { campaignId: 'same-b', title: 'Same B', symbol: 'BTCUSDT', value: 1.2, operationTime: 200 },
      { campaignId: 'same-a', title: 'Same A', symbol: 'BTCUSDT', value: 0, operationTime: 200 },
      { campaignId: 'missing-value', title: 'Missing value', symbol: 'BTCUSDT', value: null, operationTime: 100 },
      { campaignId: 'invalid-value', title: 'Invalid value', symbol: 'BTCUSDT', value: Number.NaN, operationTime: 100 },
      { campaignId: 'missing-time', title: 'Missing time', symbol: 'BTCUSDT', value: 2, operationTime: null },
    ]);

    expect(result.points.map(point => ({
      id: point.campaignId,
      value: point.value,
      sequence: point.sequence,
    }))).toEqual([
      { id: 'same-a', value: 0, sequence: 1 },
      { id: 'same-b', value: 1.2, sequence: 2 },
      { id: 'later', value: -0.8, sequence: 3 },
    ]);
    expect(result.excludedMissingValueCount).toBe(2);
    expect(result.excludedMissingOperationTimeCount).toBe(1);
  });
});
