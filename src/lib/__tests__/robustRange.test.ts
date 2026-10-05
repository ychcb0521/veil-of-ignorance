import { describe, expect, it } from 'vitest';
import { ROBUST_FENCE_FACTOR, ROBUST_FENCE_MIN_SAMPLES, ROBUST_MIN_CLIP_GAIN, quantileOfSorted, robustFenceRange } from '@/lib/robustRange';

/** 用户账户的形状：过半数战役贴着 0，右尾又细又长（几场上百）。 */
function heavyTailed() {
  const body = Array.from({ length: 240 }, (_, index) => -1 + (index / 240) * 3);          // −1 ~ +2，均匀
  const tail = [6, 8, 11, 15, 22, 30, 41, 58, 77, 96, 120, 160, 210, 252];
  return [...body, ...tail];
}

describe('【用户要求】稳健窗口：坐标轴留给主体，极端值贴边', () => {
  it('长尾不再把窗口撑开：上界停在 Q3 + 3·IQR，而不是 p98', () => {
    const values = heavyTailed();
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantileOfSorted(sorted, 0.25);
    const q3 = quantileOfSorted(sorted, 0.75);
    const p98 = quantileOfSorted(sorted, 0.98);
    const range = robustFenceRange(values);
    expect(ROBUST_FENCE_FACTOR).toBe(3);
    expect(p98).toBeGreaterThan(30);                       // 照 p98 走窗口会开到几十
    expect(range.high).toBeCloseTo(q3 + 3 * (q3 - q1), 9);  // 现在停在远栅栏上
    expect(range.high).toBeLessThan(8);
    expect(range.spread).toBeCloseTo(q3 - q1, 9);
    // 下侧没有离群值：仍是 p2
    expect(range.low).toBe(quantileOfSorted(sorted, 0.02));
  });

  it('栅栏倍数可以收紧：倍数越小窗口越窄', () => {
    const values = heavyTailed();
    expect(robustFenceRange(values, 1.5).high).toBeLessThan(robustFenceRange(values, 3).high);
  });

  it('没有离群值时就是 p2–p98；不套分位数这一层时就是最小值与最大值，一个点都不裁', () => {
    const values = Array.from({ length: 101 }, (_, index) => index / 10);     // 0 ~ 10 均匀
    expect(robustFenceRange(values)).toMatchObject({ low: 0.2, high: 9.8 });
    expect(robustFenceRange(values, 3, { quantileBounds: false })).toMatchObject({ low: 0, high: 10 });
    // 时序图用的就是后一种：只有真越过栅栏的才裁
    const withOutlier = [...values, 400];
    const range = robustFenceRange(withOutlier, 3, { quantileBounds: false });
    expect(range.low).toBe(0);
    expect(range.high).toBeLessThan(30);
    expect(range.high).toBeGreaterThanOrEqual(10);
  });

  it('四分之三以上取同一个值（IQR 真的是 0）时换 p10–p90 的一半当尺度，窗口不塌成一个点；再量不出就退回外层的界', () => {
    const mostlyZero = [...Array.from({ length: 80 }, () => 0), ...Array.from({ length: 18 }, (_, index) => 1 + index * 0.1), 150, 300];
    const sorted = [...mostlyZero].sort((a, b) => a - b);
    expect(quantileOfSorted(sorted, 0.25)).toBe(0);
    expect(quantileOfSorted(sorted, 0.75)).toBe(0);          // IQR = 0
    const range = robustFenceRange(mostlyZero);
    expect(range.spread).toBeCloseTo((quantileOfSorted(sorted, 0.9) - 0) / 2, 9);
    expect(range.high).toBeGreaterThanOrEqual(quantileOfSorted(sorted, 0.9));
    expect(range.high).toBeLessThan(10);
    expect(robustFenceRange(Array.from({ length: 12 }, () => 5))).toEqual({ low: 5, high: 5, spread: 0 });
  });

  it('【评审发现】同一个值占住中位数到 Q1（74 场都是 0）：IQR 只是一个相邻值的间距，不能拿它当尺度', () => {
    // Q3 落在第一个非零值 0.01 上：IQR = 0.01，照它算上界是 0.04，其余 25 场（四分之一）全被当成离群值
    const values = [...Array.from({ length: 74 }, () => 0), 0.01, ...Array.from({ length: 25 }, (_, index) => 5 + index)];
    const sorted = [...values].sort((a, b) => a - b);
    expect(quantileOfSorted(sorted, 0.75) - quantileOfSorted(sorted, 0.25)).toBeCloseTo(0.01, 9);
    const range = robustFenceRange(values, 3, { quantileBounds: false });
    expect(range.spread).toBeCloseTo((quantileOfSorted(sorted, 0.9) - 0) / 2, 9);   // (p90 − p10) ÷ 2 = 9.5，不是 0.01
    expect(range.high).toBeCloseTo(0.01 + 3 * 9.5, 9);
    expect(values.filter(value => value > range.high).length).toBeLessThanOrEqual(1);   // 原来是 25 场
  });

  it('【评审发现】不足 10 场不裁：四分位数那时只是相邻的两三个值，普通战役会被当成离群', () => {
    expect(ROBUST_FENCE_MIN_SAMPLES).toBe(10);
    for (const values of [[0.2, 0.3, 4], [-1, 0.1, 0.2, 6], [0, 0.1, 0.2, 0.3, 40], [-1, -0.9, -0.8, 0, 0.1, 0.2, 0.3, 5, 90]]) {
      const range = robustFenceRange(values, 3, { quantileBounds: false });
      expect(range).toEqual({ low: Math.min(...values), high: Math.max(...values), spread: 0 });
    }
    // 第 10 场起栅栏才生效
    const ten = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 90];
    expect(robustFenceRange(ten, 3, { quantileBounds: false }).high).toBeLessThan(90);
  });

  it('【评审发现】每一侧最多约一成贴边：亏损都挤在 −1R、盈利散得很开时，盈利那一半不会整个被裁掉', () => {
    // 40 场止损（−1 ~ −0.9）+ 10 场盈利（1 ~ 46）：Q1、Q3 都在亏损堆里，IQR ≈ 0.05，照栅栏算 10 场盈利全部出界
    const losses = Array.from({ length: 40 }, (_, index) => -1 + index * 0.0025);
    const wins = Array.from({ length: 10 }, (_, index) => 1 + index * 5);
    const values = [...losses, ...wins];
    const sorted = [...values].sort((a, b) => a - b);
    for (const factor of [3, 2.5, 2, 1.5]) {
      const range = robustFenceRange(values, factor, { quantileBounds: false });
      expect(range.high).toBeGreaterThanOrEqual(quantileOfSorted(sorted, 0.9));
      expect(range.low).toBeLessThanOrEqual(quantileOfSorted(sorted, 0.1));
      expect(values.filter(value => value > range.high).length).toBeLessThanOrEqual(5);     // 50 场的一成
      expect(values.filter(value => value < range.low).length).toBeLessThanOrEqual(5);
    }
  });

  it('【评审发现】栅栏外是紧挨着的一群时整侧不裁：裁掉的点只比边界高一点点，主体照样挤着，裁了也换不来空间', () => {
    expect(ROBUST_MIN_CLIP_GAIN).toBeCloseTo(1 / 3, 12);
    // 八成在 0 附近、两成在 100 附近：p90 落在第二群里面，照 p90 裁只是把第二群拦腰切开
    const twoClusters = [
      ...Array.from({ length: 80 }, (_, index) => index * 0.001),
      ...Array.from({ length: 20 }, (_, index) => 100 + index * 0.001),
    ];
    expect(robustFenceRange(twoClusters, 3, { quantileBounds: false })).toMatchObject({ low: 0, high: 100.019 });
    // 十场里两场很远：p90 就是其中一场，裁掉另一场省不出轴长
    const twoFar = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 93, 93.4];
    expect(robustFenceRange(twoFar, 3, { quantileBounds: false })).toMatchObject({ low: 0, high: 93.4 });
    // 对照：尾部拖得很远时退到 p90 裁（省出一半以上的轴长）
    const longTail = [...Array.from({ length: 40 }, (_, index) => -1 + index * 0.0025), ...Array.from({ length: 10 }, (_, index) => 1 + index * 5)];
    expect(robustFenceRange(longTail, 3, { quantileBounds: false }).high).toBe(21);
  });

  it('空样本与非有限值不炸', () => {
    expect(robustFenceRange([])).toEqual({ low: 0, high: 0, spread: 0 });
    expect(robustFenceRange([Number.NaN, 1, 2, 3, Number.POSITIVE_INFINITY])).toMatchObject({ low: 1, high: 3 });
    expect(robustFenceRange([Number.NaN, ...Array.from({ length: 20 }, (_, index) => index), Number.NEGATIVE_INFINITY], 3, { quantileBounds: false }))
      .toMatchObject({ low: 0, high: 19 });
  });
});
