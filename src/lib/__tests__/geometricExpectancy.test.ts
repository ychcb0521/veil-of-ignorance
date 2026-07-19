import { describe, expect, it } from 'vitest';
import {
  geometricGrowthFactor,
  optimalDrawdownFraction,
  computeGeometricExpectancy,
} from '../geometricExpectancy';

describe('geometricGrowthFactor', () => {
  it('用户例子：p=0.6, b=10, x=0.1 → G≈1.453（+45.3%/笔）', () => {
    // G = 2^0.6 · 0.9^0.4
    expect(geometricGrowthFactor(0.6, 10, 0.1)).toBeCloseTo(Math.pow(2, 0.6) * Math.pow(0.9, 0.4), 10);
    expect(geometricGrowthFactor(0.6, 10, 0.1)).toBeCloseTo(1.4532, 3);
  });

  it('n 笔复利 = G^n：例子里 20 笔 ≈ 1763×', () => {
    const g = geometricGrowthFactor(0.6, 10, 0.1);
    expect(Math.pow(g, 20)).toBeCloseTo(Math.pow(2, 12) * Math.pow(0.9, 8), 4); // 4096·0.9^8 ≈ 1763
    expect(Math.pow(g, 20)).toBeCloseTo(1763.2, 0);
  });

  it('波动拖累：算术打平(b=1,p=0.5,x=0.5)几何却缩水(<1)', () => {
    // 算术 E = 0.5·0.5 − 0.5·0.5 = 0；几何 G = √1.5·√0.5 = √0.75 ≈ 0.866 → 归零
    const g = geometricGrowthFactor(0.5, 1, 0.5);
    expect(g).toBeCloseTo(Math.sqrt(0.75), 10);
    expect(g).toBeLessThan(1);
  });

  it('过度下注：正算术期望(b=2,p=0.5)押 x=0.6 → 几何翻负(<1)，押 x=0.3 → 复利(>1)', () => {
    expect(geometricGrowthFactor(0.5, 2, 0.6)).toBeLessThan(1);
    expect(geometricGrowthFactor(0.5, 2, 0.3)).toBeGreaterThan(1);
  });

  it('边界：x≤0 → 1（不增不减）；x≥1 → 0（亏光）', () => {
    expect(geometricGrowthFactor(0.6, 10, 0)).toBe(1);
    expect(geometricGrowthFactor(0.6, 10, -0.2)).toBe(1);
    expect(geometricGrowthFactor(0.6, 10, 1)).toBe(0);
    expect(geometricGrowthFactor(0.6, 10, 1.5)).toBe(0);
  });
});

describe('optimalDrawdownFraction（Kelly x*）', () => {
  it('p=0.6, b=10 → x* = (6−0.4)/10 = 0.56', () => {
    expect(optimalDrawdownFraction(0.6, 10)).toBeCloseTo(0.56, 10);
  });

  it('负 edge → 0（不该下注）', () => {
    expect(optimalDrawdownFraction(0.4, 1)).toBe(0); // E = 0.4·1 − 0.6 < 0
  });

  it('G 在 x* 处最大：x* 的 G ≥ 邻近 x 的 G', () => {
    const xStar = optimalDrawdownFraction(0.6, 2);
    const gStar = geometricGrowthFactor(0.6, 2, xStar);
    expect(gStar).toBeGreaterThanOrEqual(geometricGrowthFactor(0.6, 2, xStar - 0.05));
    expect(gStar).toBeGreaterThanOrEqual(geometricGrowthFactor(0.6, 2, xStar + 0.05));
  });
});

describe('computeGeometricExpectancy', () => {
  it('未给 x → 用 Kelly 最优 x*，产出 G−1 与 bleeds', () => {
    const r = computeGeometricExpectancy(0.6, 10);
    expect(r).not.toBeNull();
    expect(r!.optimalFraction).toBeCloseTo(0.56, 10);
    expect(r!.drawdownFraction).toBeCloseTo(0.56, 10);
    expect(r!.geometricEdge).toBeCloseTo(r!.growthFactor - 1, 12);
    expect(r!.bleeds).toBe(false);
  });

  it('显式给 x（复用 T4 最大预期回撤）→ 按实际仓位算', () => {
    const r = computeGeometricExpectancy(0.6, 10, 0.1);
    expect(r!.drawdownFraction).toBe(0.1);
    expect(r!.growthFactor).toBeCloseTo(1.4532, 3);
  });

  it('显式固定正仓位时，b<0 进入公式并产生负几何期望', () => {
    const r = computeGeometricExpectancy(0.6, -0.8, 0.2);
    expect(r!.drawdownFraction).toBe(0.2);
    expect(r!.growthFactor).toBeCloseTo(Math.pow(0.84, 0.6) * Math.pow(0.8, 0.4), 10);
    expect(r!.geometricEdge).toBeLessThan(0);
    expect(r!.bleeds).toBe(true);
  });

  it('显式给 x=0 时尊重不下注，不回退到该场自己的 Kelly 仓位', () => {
    const r = computeGeometricExpectancy(0.6, 10, 0);
    expect(r!.optimalFraction).toBeCloseTo(0.56, 10);
    expect(r!.drawdownFraction).toBe(0);
    expect(r!.growthFactor).toBe(1);
    expect(r!.geometricEdge).toBe(0);
  });

  it('实际风险比例 x≥1 时不截断，按账户权益被击穿处理', () => {
    const r = computeGeometricExpectancy(0.6, 2, 1.2);
    expect(r!.drawdownFraction).toBe(1.2);
    expect(r!.growthFactor).toBe(0);
    expect(r!.geometricEdge).toBe(-1);
  });

  it('负 edge → x*=0、G=1、几何期望 0（不该下注）', () => {
    const r = computeGeometricExpectancy(0.4, 1);
    expect(r!.optimalFraction).toBe(0);
    expect(r!.growthFactor).toBe(1);
    expect(r!.geometricEdge).toBe(0);
  });

  it('入参缺失 → null', () => {
    expect(computeGeometricExpectancy(null, 10)).toBeNull();
    expect(computeGeometricExpectancy(0.6, null)).toBeNull();
    expect(computeGeometricExpectancy(0.6, Number.NaN)).toBeNull();
  });
});
