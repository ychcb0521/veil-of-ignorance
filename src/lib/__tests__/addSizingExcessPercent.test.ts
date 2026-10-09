import { describe, expect, it } from 'vitest';
import { formatAddSizingExcessPercent } from '../campaignAddSizingCheck';
describe('多加仓位占比', () => {
  it('uses allowed position as denominator', () => {
    expect(formatAddSizingExcessPercent(120, 100)).toBe('20.00%');
    expect(formatAddSizingExcessPercent(101.01, 100)).toBe('1.01%');
    expect(formatAddSizingExcessPercent(90, 100)).toBe('0.00%');
  });
  it('does not invent a percentage with a zero or missing limit', () => {
    expect(formatAddSizingExcessPercent(10, 0)).toBe('无法计算（上限为0）');
    expect(formatAddSizingExcessPercent(null, 100)).toBe('—');
  });
});
