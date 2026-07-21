import { describe, expect, it } from 'vitest';

import {
  computeOpportunityQuality,
  computeRealizedOpportunityQuality,
  formatOpportunityQuality,
} from '../opportunityQuality';

describe('opportunity quality', () => {
  it('divides the expected payoff ratio by drawdown percentage points', () => {
    expect(computeOpportunityQuality({ payoffRatio: 5, drawdownPct: 2 })).toBe(2.5);
    expect(formatOpportunityQuality(2.5)).toBe('2.50');
  });

  it('rewards a smaller structural drawdown for the same payoff ratio', () => {
    const tight = computeOpportunityQuality({ payoffRatio: 4, drawdownPct: 1 });
    const wide = computeOpportunityQuality({ payoffRatio: 4, drawdownPct: 8 });
    expect(tight).toBe(4);
    expect(wide).toBe(0.5);
    expect(tight).toBeGreaterThan(wide!);
  });

  it('rejects missing, zero, negative, and non-finite inputs', () => {
    expect(computeOpportunityQuality({ payoffRatio: null, drawdownPct: 2 })).toBeNull();
    expect(computeOpportunityQuality({ payoffRatio: 5, drawdownPct: 0 })).toBeNull();
    expect(computeOpportunityQuality({ payoffRatio: -1, drawdownPct: 2 })).toBeNull();
    expect(computeOpportunityQuality({ payoffRatio: 5, drawdownPct: Number.NaN })).toBeNull();
  });

  it('实际盈亏比小于 1 时按 1 计算，不取绝对值', () => {
    expect(computeRealizedOpportunityQuality({ payoffRatio: 3, drawdownPct: 2 })).toBe(1.5);
    expect(computeRealizedOpportunityQuality({ payoffRatio: 0.5, drawdownPct: 2 })).toBe(0.5);
    expect(computeRealizedOpportunityQuality({ payoffRatio: -0.8, drawdownPct: 4 })).toBe(0.25);
    expect(computeRealizedOpportunityQuality({ payoffRatio: -3, drawdownPct: 2 })).toBe(0.5);
    expect(computeRealizedOpportunityQuality({ payoffRatio: 0, drawdownPct: 2 })).toBe(0.5);
    expect(computeRealizedOpportunityQuality({ payoffRatio: null, drawdownPct: 2 })).toBeNull();
    expect(computeRealizedOpportunityQuality({ payoffRatio: 3, drawdownPct: 0 })).toBeNull();
  });
});
