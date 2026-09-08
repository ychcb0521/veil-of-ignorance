import { describe, expect, it } from 'vitest';
import { gaussianKde, quantileSorted, sampleStd, silvermanBandwidth } from '@/lib/kernelDensity';

describe('silvermanBandwidth', () => {
  it('h = 0.9 · min(σ, IQR/1.34) · n^(−1/5)', () => {
    const values = Array.from({ length: 10 }, (_, index) => index + 1);
    const sigma = sampleStd(values);
    const sorted = [...values].sort((a, b) => a - b);
    const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
    const expected = 0.9 * Math.min(sigma, iqr / 1.34) * 10 ** (-1 / 5);
    expect(silvermanBandwidth(values)).toBeCloseTo(expected, 9);
  });

  it('加一个 +38 的离群值只让带宽变化不到 5%：IQR 那一项赢了', () => {
    // 主群集中在 ±0.3、两翼各 10 个 ±2：σ 已被两翼撑大，IQR/1.34 是较小项。
    const base = [
      ...Array.from({ length: 100 }, (_, index) => -0.3 + (index / 99) * 0.6),
      ...Array.from({ length: 10 }, () => -2),
      ...Array.from({ length: 10 }, () => 2),
    ];
    const withTail = [...base, 38];
    const relative = Math.abs(silvermanBandwidth(withTail) - silvermanBandwidth(base)) / silvermanBandwidth(base);
    expect(relative).toBeLessThan(0.05);
  });

  it('全相等样本仍给出有限正带宽与有限密度', () => {
    const h = silvermanBandwidth([2, 2, 2, 2]);
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBeGreaterThan(0);
    const f = gaussianKde([2, 2, 2, 2], h);
    expect(Number.isFinite(f(2))).toBe(true);
    expect(Number.isFinite(f(3))).toBe(true);
    expect(silvermanBandwidth([])).toBeGreaterThan(0);
  });
});

describe('gaussianKde', () => {
  it('密度在 [−10, 10] 上积分 ≈ 1，对称样本给对称密度', () => {
    const values = [-2, -1, -0.5, 0, 0.5, 1, 2];
    const f = gaussianKde(values, silvermanBandwidth(values));
    let integral = 0;
    for (let x = -10; x < 10; x += 0.01) integral += f(x + 0.005) * 0.01;
    expect(integral).toBeCloseTo(1, 2);
    expect(f(0.7)).toBeCloseTo(f(-0.7), 9);
    expect(f(1.3)).toBeCloseTo(f(-1.3), 9);
  });

  it('空样本处处为 0', () => {
    expect(gaussianKde([], 1)(0)).toBe(0);
  });
});
