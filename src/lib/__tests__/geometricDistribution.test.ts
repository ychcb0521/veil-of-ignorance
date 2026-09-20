import { describe, expect, it } from 'vitest';
import { buildGeometricDistributionModel, formatGeometricDistributionValue, geometricLogPosition } from '../geometricDistribution';
import { stackLayout } from '@/components/charts/stackLayout';
import { buildOddsDistributionModel, kdeCountPath } from '../oddsDistribution';

const points = (factors: number[]) => factors.map((factor, index) => ({
  campaignId: `c${index}`, title: `战役 ${index}`, symbol: 'TESTUSDT',
  value: factor - 1, sequence: index + 1, operationTime: index,
}));

describe('geometric distribution log coordinates', () => {
  it('transforms stored G−1, preserving multiplicative distances around break-even', () => {
    expect(geometricLogPosition(0)).toBe(0);
    expect(geometricLogPosition(-0.5)).toBeCloseTo(-Math.LN2);
    expect(geometricLogPosition(1)).toBeCloseTo(Math.LN2);
    expect(geometricLogPosition(-0.75)).toBeCloseTo(-2 * Math.LN2);
    expect(geometricLogPosition(-1)).toBeNull();
    expect(geometricLogPosition(-2)).toBeNull();
    expect(geometricLogPosition(NaN)).toBeNull();
    expect(geometricLogPosition(Infinity)).toBeNull();
  });

  it('keeps zero separate; raw statistics, inputs and ordering remain unchanged', () => {
    const input = points([0, 0.1, 0.5, 1, 2, 20, 50]);
    const before = structuredClone(input);
    const model = buildGeometricDistributionModel(input);
    expect(model.zeroIds).toEqual(['c0']);
    expect(model.values).toHaveLength(6);
    expect(model.values.every(Number.isFinite)).toBe(true);
    expect(model.values[0]).toBeCloseTo(Math.log(0.1));
    expect(model.labels.every(label => Number(label.text) > 0)).toBe(true);
    expect(model.labels.some(label => label.text === '1.00' && label.at === 0)).toBe(true);
    const summary = buildOddsDistributionModel(input).summary;
    expect(summary.n).toBe(7);
    expect(summary.winCount).toBe(3);
    expect(summary.mean + 1).toBeCloseTo(73.6 / 7);
    expect(input).toEqual(before);
  });

  it.each([[], [0], [0, 0, 0], [1], [2, 2], [0.01, 0.01], [1e-12, 1000]].map(factors => ({ factors })))(
    'has finite domains, ticks and bandwidth for degenerate sample $factors', ({ factors }) => {
      const model = buildGeometricDistributionModel(points(factors));
      expect(model.domain.min).toBeLessThan(0);
      expect(model.domain.max).toBeGreaterThan(0);
      expect(Number.isFinite(model.domain.min)).toBe(true);
      expect(Number.isFinite(model.domain.max)).toBe(true);
      expect(model.bandwidth).toBeGreaterThan(0);
      expect(model.labels.every(label => Number(label.text) > 0 && Number.isFinite(label.at))).toBe(true);
    },
  );

  it('spreads losses across columns on desktop and narrow charts without crossing break-even', () => {
    const input = points([0, 0.05, 0.1, 0.2, 0.5, 0.8, 0.95, 1.01, 2, 20, 50]);
    const model = buildGeometricDistributionModel(input);
    for (const width of [220, 900]) {
      const left = 84;
      const right = left + width;
      const layout = stackLayout(input.map(point => ({ id: point.campaignId, x: geometricLogPosition(point.value) ?? 0 })), {
        xMin: model.domain.min, xMax: model.domain.max,
        left, right, top: 12, plotHeight: 500, isolatedLeft: { ids: model.zeroIds, cx: 36 }, integerBoundaries: false,
      });
      const zeroX = left + -model.domain.min / (model.domain.max - model.domain.min) * width;
      const losses = layout.placed.filter(point => input.find(p => p.campaignId === point.id)!.value < 0 && point.id !== 'c0');
      expect(new Set(losses.map(point => point.cx)).size).toBeGreaterThanOrEqual(4);
      expect(losses.every(point => point.cx < zeroX)).toBe(true);
      expect(layout.placed.find(point => point.id === 'c0')?.cx).toBe(36);
      expect(layout.binCounts.reduce((sum, count) => sum + count, 0)).toBe(input.length);
    }
  });

  it('retains isolated zero counts and overflow without using a fake log coordinate', () => {
    const input = points([...Array(100).fill(0), 0.5, 1, 2]);
    const model = buildGeometricDistributionModel(input);
    const layout = stackLayout(input.map(point => ({ id: point.campaignId, x: geometricLogPosition(point.value) ?? 0 })), {
      xMin: model.domain.min, xMax: model.domain.max,
      left: 84, right: 900, top: 12, plotHeight: 100, isolatedLeft: { ids: model.zeroIds, cx: 36 },
    });
    const zeros = layout.placed.filter(point => model.zeroIds.includes(point.id));
    const overflow = layout.overflow.filter(column => column.cx === 36);
    expect(zeros.length + overflow.reduce((sum, column) => sum + column.count, 0)).toBe(100);
    expect(zeros.every(point => point.cx === 36 && point.clamped === null)).toBe(true);
  });

  it('uses only positive factors for log KDE, including the all-zero empty curve', () => {
    const scale = {
      x: (value: number) => value * 10, countY: (count: number) => 500 - count * 14,
      binWidth: 0.1, binPx: 14, pitchY: 14, rowsFit: 35, n: 3,
      plot: { left: 0, right: 900, top: 0, bottom: 500 }, clipPathId: 'test',
    };
    const model = buildGeometricDistributionModel(points([0, 0, 0.5, 1, 2]));
    const path = kdeCountPath(model.values, model.domain, scale, model.bandwidth);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path.match(/M /g)).toHaveLength(1);
    const withoutZeros = buildGeometricDistributionModel(points([0.5, 1, 2]));
    expect(path).toBe(kdeCountPath(withoutZeros.values, withoutZeros.domain, scale, withoutZeros.bandwidth));
    const allZero = buildGeometricDistributionModel(points([0, 0]));
    expect(kdeCountPath(allZero.values, allZero.domain, scale, allZero.bandwidth)).toBe('');
  });

  it('does not round tiny positive growth factors to zero', () => {
    expect(formatGeometricDistributionValue(-1)).toBe('0.00');
    expect(Number(formatGeometricDistributionValue(0.0001 - 1))).toBeCloseTo(0.0001, 10);
    expect(formatGeometricDistributionValue(0)).toBe('1.00');
    expect(formatGeometricDistributionValue(1)).toBe('2.00');
  });
});
