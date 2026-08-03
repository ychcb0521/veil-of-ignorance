import { describe, expect, it } from 'vitest';
import {
  computeCompoundCampaignGrowth,
  formatCompoundCampaignGrowthRate,
} from '../compoundCampaignGrowth';

describe('computeCompoundCampaignGrowth', () => {
  it('computes the geometric mean of normalized realized campaign returns', () => {
    const result = computeCompoundCampaignGrowth([
      { realizedPnl: 30, accountEquityAtEntry: 100 },
      { realizedPnl: 1_000, accountEquityAtEntry: 40_000 },
      { realizedPnl: -20, accountEquityAtEntry: 500 },
    ]);

    expect(result.sampleCount).toBe(3);
    expect(result.totalGrowthFactor).toBeCloseTo(1.2792, 10);
    expect(result.rate).toBeCloseTo(0.085540798, 8);
    expect(result.estimatedSampleCount).toBe(0);
    expect(result.wipedOut).toBe(false);
  });

  it('excludes invalid samples and counts only included legacy estimates', () => {
    const result = computeCompoundCampaignGrowth([
      { realizedPnl: 10, accountEquityAtEntry: 100, estimated: true },
      { realizedPnl: 20, accountEquityAtEntry: 100, eligible: false, estimated: true },
      { realizedPnl: 10, accountEquityAtEntry: 0, estimated: true },
      { realizedPnl: Number.NaN, accountEquityAtEntry: 100 },
      { realizedPnl: null, accountEquityAtEntry: 100 },
    ]);

    expect(result.sampleCount).toBe(1);
    expect(result.estimatedSampleCount).toBe(1);
    expect(result.totalGrowthFactor).toBeCloseTo(1.1, 10);
    expect(result.rate).toBeCloseTo(0.1, 10);
  });

  it('returns minus one when a campaign wipes out entry account equity', () => {
    const result = computeCompoundCampaignGrowth([
      { realizedPnl: 10, accountEquityAtEntry: 100 },
      { realizedPnl: -100, accountEquityAtEntry: 100 },
    ]);

    expect(result.sampleCount).toBe(2);
    expect(result.totalGrowthFactor).toBe(0);
    expect(result.rate).toBe(-1);
    expect(result.wipedOut).toBe(true);
  });

  it('returns an empty summary when no campaign is eligible', () => {
    expect(computeCompoundCampaignGrowth([])).toEqual({
      rate: null,
      totalGrowthFactor: null,
      sampleCount: 0,
      estimatedSampleCount: 0,
      wipedOut: false,
    });
  });
});

describe('formatCompoundCampaignGrowthRate', () => {
  it('formats positive, negative and unavailable rates', () => {
    expect(formatCompoundCampaignGrowthRate(0.085540798)).toBe('+8.55%/战役');
    expect(formatCompoundCampaignGrowthRate(-0.125)).toBe('-12.50%/战役');
    expect(formatCompoundCampaignGrowthRate(null)).toBe('—');
  });
});
