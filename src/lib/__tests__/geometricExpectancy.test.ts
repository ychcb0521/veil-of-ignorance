import { describe, expect, it } from 'vitest';
import {
  FIXED_DRAWDOWN_FRACTION,
  compoundGrowthFactor,
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

describe('【用户要求】全表口径：x 固定 0.1，b 取盈利战役平均 b，p 取有效战役胜率，n 取有效战役数', () => {
  it('x 统一取 0.1，不再随 Kelly 最优仓位漂', () => {
    expect(FIXED_DRAWDOWN_FRACTION).toBe(0.1);
    const r = computeGeometricExpectancy(0.568, 2.01, FIXED_DRAWDOWN_FRACTION)!;
    expect(r.drawdownFraction).toBe(0.1);
    // 最优仓位仍算得出来，只是不参与 G
    expect(r.optimalFraction).toBeCloseTo(0.353, 3);
    expect(r.growthFactor).toBeCloseTo(
      Math.pow(1 + 2.01 * 0.1, 0.568) * Math.pow(1 - 0.1, 1 - 0.568),
      12,
    );
    expect(r.geometricEdge).toBeCloseTo(r.growthFactor - 1, 12);
  });

  it('W = G^n：n 笔复利总因子', () => {
    const r = computeGeometricExpectancy(0.568, 2.01, FIXED_DRAWDOWN_FRACTION)!;
    expect(compoundGrowthFactor(r.growthFactor, 1)).toBeCloseTo(r.growthFactor, 12);
    expect(compoundGrowthFactor(r.growthFactor, 3)).toBeCloseTo(r.growthFactor ** 3, 10);
    // 几百场也不能先溢出成 Infinity
    expect(Number.isFinite(compoundGrowthFactor(1.02, 227))).toBe(true);
    expect(compoundGrowthFactor(1.02, 227)).toBeCloseTo(1.02 ** 227, 6);
  });

  it('W 的边界：n≤0 不算下注，G≤0 视为本金归零', () => {
    expect(compoundGrowthFactor(1.5, 0)).toBe(1);
    expect(compoundGrowthFactor(1.5, -3)).toBe(1);
    expect(compoundGrowthFactor(0, 100)).toBe(0);
  });

  it('同一个 p、同一个 x 下，b 越大几何期望越高（b 用盈利侧均值才不会被亏损腿罚两次）', () => {
    const winSideOnly = computeGeometricExpectancy(0.568, 2.01, FIXED_DRAWDOWN_FRACTION)!;
    const mixedAverage = computeGeometricExpectancy(0.568, 0.6, FIXED_DRAWDOWN_FRACTION)!;
    expect(winSideOnly.geometricEdge).toBeGreaterThan(mixedAverage.geometricEdge);
  });
});
