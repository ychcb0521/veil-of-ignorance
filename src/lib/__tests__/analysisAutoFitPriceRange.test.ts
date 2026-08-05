import { describe, expect, it } from 'vitest';
import { buildAnalysisAutoFitPriceRange } from '@/lib/analysisAutoFitPriceRange';

describe('buildAnalysisAutoFitPriceRange', () => {
  it('只纳入当前时间窗口相交的 K 线、标注与委托线', () => {
    const range = buildAnalysisAutoFitPriceRange({
      data: [
        { time: 1000, low: 10, high: 12 },
        { time: 2000, low: 8, high: 11 },
        { time: 3000, low: 100, high: 120 },
      ],
      visibleStartTime: 1000,
      visibleEndTime: 2000,
      annotations: {
        markers: [
          { time: 1500, price: 7 },
          { time: 3000, price: 1 },
        ],
        timeBoundPriceLines: [
          { price: 5, startTime: 500, endTime: 1500 },
          { price: 200, startTime: 3000, endTime: 4000 },
        ],
      },
    });

    expect(range).not.toBeNull();
    expect(range!.min).toBeCloseTo(4.72, 8);
    expect(range!.max).toBeCloseTo(12.28, 8);
  });

  it('全局价格线与可拖动价格线始终进入纵轴边界', () => {
    const range = buildAnalysisAutoFitPriceRange({
      data: [{ time: 1000, low: 10, high: 12 }],
      visibleStartTime: 900,
      visibleEndTime: 1100,
      annotations: {
        priceLines: [{ price: 15 }],
      },
      draggablePriceLines: [{ price: 4 }],
    });

    expect(range).not.toBeNull();
    expect(range!.min).toBeCloseTo(3.56, 8);
    expect(range!.max).toBeCloseTo(15.44, 8);
  });

  it('没有可用价格时返回 null，单一价格仍保留可见留白', () => {
    expect(buildAnalysisAutoFitPriceRange({ data: [] })).toBeNull();

    const range = buildAnalysisAutoFitPriceRange({
      data: [{ time: 1000, low: 2, high: 2 }],
    });
    expect(range).not.toBeNull();
    expect(range!.min).toBeLessThan(2);
    expect(range!.max).toBeGreaterThan(2);
  });
});
