import { describe, expect, it } from 'vitest';
import { buildExpectedDrawdownBins, drawdownReciprocal } from '@/lib/expectedDrawdownBins';

describe('buildExpectedDrawdownBins', () => {
  it('按 100 ÷ D% 取倒数', () => {
    expect(drawdownReciprocal(2)).toBe(50);
    expect(drawdownReciprocal(0)).toBeNull();
    expect(drawdownReciprocal(Number.NaN)).toBeNull();
  });

  it('档在倒数上等间距，从左到右倒数递增、回撤递减，空档保留', () => {
    // 倒数：5、10、50、100
    const { bins, step, binOf } = buildExpectedDrawdownBins([20, 10, 2, 1]);
    expect(bins.length).toBeGreaterThan(1);
    bins.forEach((bin, index) => {
      expect(bin.index).toBe(index);
      expect(bin.upper - bin.lower).toBeCloseTo(step);
      if (index > 0) expect(bin.lower).toBeCloseTo(bins[index - 1].upper);
    });
    expect(binOf(20)).toBe(0);
    expect(binOf(1)).toBe(bins.length - 1);
    expect(binOf(10)!).toBeLessThan(binOf(2)!);
    // 中间有空档：10 与 50 之间隔着没有战役的柱。
    expect(binOf(2)! - binOf(10)!).toBeGreaterThan(1);
  });

  it('档界落在步长的整数倍上，恰好在界上的归右侧', () => {
    const { bins, binOf } = buildExpectedDrawdownBins([10, 5, 4, 2]); // 10、20、25、50
    const at20 = bins.find(bin => bin.lower === 20);
    if (at20) expect(binOf(5)).toBe(at20.index);
    bins.forEach(bin => expect(Number.isFinite(bin.lower)).toBe(true));
  });

  it('样本够多且有远端离群值时，并入最后一根「≥ 上界」柱', () => {
    const drawdowns = [...Array.from({ length: 30 }, (_, index) => 2 + index * 0.2), 0.05]; // 0.05% → 倒数 2000
    const { bins, binOf } = buildExpectedDrawdownBins(drawdowns);
    const last = bins[bins.length - 1];
    expect(last.upper).toBe(Infinity);
    expect(last.label.startsWith('≥')).toBe(true);
    expect(binOf(0.05)).toBe(last.index);
    expect(bins.length).toBeLessThanOrEqual(13);
  });

  it('只有一场也能分出一根柱', () => {
    const { bins, binOf } = buildExpectedDrawdownBins([3]);
    expect(bins).toHaveLength(1);
    expect(binOf(3)).toBe(0);
  });

  it('没有有效回撤时不分档', () => {
    expect(buildExpectedDrawdownBins([]).bins).toEqual([]);
    expect(buildExpectedDrawdownBins([0, -1]).bins).toEqual([]);
  });
});

describe('【用户要求】柱脚按实际预期回撤百分比标注', () => {
  it('倒数 0–5 → ≥20%，5–10 → 20–10%，10–15 → 10–6.67%；溢出柱写 ≤ 下界', () => {
    const { bins, step } = buildExpectedDrawdownBins([100, 2]); // 倒数 1、50 → 步长 5
    expect(step).toBe(5);
    expect(bins[0].drawdownLabel).toBe('≥20%');
    expect(bins[1].drawdownLabel).toBe('20–10%');
    expect(bins[2].drawdownLabel).toBe('10–6.67%');
    const outlier = buildExpectedDrawdownBins([...Array.from({ length: 30 }, (_, index) => 2 + index * 0.2), 0.05]).bins;
    expect(outlier[outlier.length - 1].drawdownLabel.startsWith('≤')).toBe(true);
  });
});
