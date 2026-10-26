import { expect, it } from 'vitest';
import { qualityHistogram } from '@/lib/fish/qualityDistribution';

it('uses the same bins for comparisons, includes negative and long-tail values, and never drops the upper boundary', () => {
  const histogram = qualityHistogram([{ id: 'a', label: 'a', values: [-20, -5, 0, 5, 200] }, { id: 'b', label: 'b', values: [-10, 10] }])!;
  expect(histogram.plots.map(plot => plot.bins.reduce((sum, n) => sum + n, 0))).toEqual([5, 2]);
  expect(histogram.min).toBeLessThanOrEqual(-20); expect(histogram.max).toBeGreaterThanOrEqual(200);
  expect(histogram.plots[0].median).toBe(0); expect(histogram.plots[0].mean).toBe(36); expect(histogram.plots[1].median).toBe(0);
});
it('handles zero variance and missing observations without inventing a normal curve or treating missing data as zero', () => {
  expect(qualityHistogram([{ id: 'a', label: 'a', values: [NaN] }])).toBeNull();
  const histogram = qualityHistogram([{ id: 'a', label: 'a', values: [0, 0, 0] }])!;
  expect(histogram.plots[0].n).toBe(3); expect(histogram.plots[0].bins.reduce((sum, n) => sum + n, 0)).toBe(3); expect(histogram.max).toBeGreaterThan(histogram.min);
});
