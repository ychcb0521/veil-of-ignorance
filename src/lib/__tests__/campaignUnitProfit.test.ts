import { describe, expect, it } from 'vitest';
import {
  summarizeGeometricExpectancy,
  compactUnitRiseBinValue, compactUsdBinValue, computeGeometricGrowth, formatCompactUnitRise, formatCompactUsd, formatGeometricGrowth,
} from '@/lib/campaignUnitProfit';

describe('【用户要求】封面紧凑读数：长数字加 w（万），单位涨幅统一有效数字', () => {
  it('单位利润 / 仓位利润：≥ 1 万写 w，1000–1 万取整，< 1000 两位小数', () => {
    expect(formatCompactUsd(800)).toBe('800.00');
    expect(formatCompactUsd(8225)).toBe('8225');
    expect(formatCompactUsd(28_000)).toBe('2.80w');
    expect(formatCompactUsd(123_456.78)).toBe('12.35w');
    expect(formatCompactUsd(-625)).toBe('-625.00');
    expect(formatCompactUsd(-18_000)).toBe('-1.80w');
    expect(formatCompactUsd(-0.004)).toBe('0.00');
    expect(formatCompactUsd(null)).toBe('—');
  });

  it('单位涨幅：约 4 位有效数字；≥ 1 万写 w；小数点后连着 3 个以上 0 用下标记个数', () => {
    expect(formatCompactUnitRise(84)).toBe('84.00');
    expect(formatCompactUnitRise(140)).toBe('140.0');
    expect(formatCompactUnitRise(1234.5)).toBe('1235');
    expect(formatCompactUnitRise(5.5)).toBe('5.500');
    expect(formatCompactUnitRise(0.05)).toBe('0.0500');
    expect(formatCompactUnitRise(0.012)).toBe('0.0120');
    expect(formatCompactUnitRise(0.0000123)).toBe('0.0₄123');
    expect(formatCompactUnitRise(-0.00012346)).toBe('-0.0₃123');
    expect(formatCompactUnitRise(-18_000)).toBe('-1.80w');
    expect(formatCompactUnitRise(undefined)).toBe('—');
  });

  it('排序 / 分档按封面同一个取整：封面读数相同就是同一个数', () => {
    expect(compactUsdBinValue(28_049)).toBe(compactUsdBinValue(27_951));
    expect(compactUsdBinValue(28_049)).toBe(28_000);
    expect(compactUsdBinValue(8225.4)).toBe(8225);
    expect(compactUsdBinValue(-0.004)).toBe(0);
    expect(compactUnitRiseBinValue(0.0000123)).toBeCloseTo(0.0000123, 12);
    expect(compactUnitRiseBinValue(1234.5)).toBe(1235);
    expect(compactUnitRiseBinValue(-18_040)).toBe(-18_000);
  });

  it('几何增长 W（b）= 1 + 0.1 × b', () => {
    expect(computeGeometricGrowth(25)).toBeCloseTo(3.5, 12);
    expect(computeGeometricGrowth(-12)).toBeCloseTo(-0.2, 12);
    expect(computeGeometricGrowth(null)).toBeNull();
    expect(formatGeometricGrowth(1.0002)).toBe('1.00');
  });
});

describe('【用户要求】W（b）三种算法的读数：方法一（方法二/方法三）', () => {
  it('括号里两个都算不出时不写括号；单个算不出写「—」', async () => {
    const { formatGeometricGrowthMethods } = await import('@/lib/campaignUnitProfit');
    expect(formatGeometricGrowthMethods(3.5, 3.4, 3)).toBe('3.50（3.40/3.00）');
    expect(formatGeometricGrowthMethods(0.92, null, null)).toBe('0.92');
    expect(formatGeometricGrowthMethods(1.2, 1.2, null)).toBe('1.20（1.20/—）');
    expect(formatGeometricGrowthMethods(null, 3.4, 3)).toBe('—（3.40/3.00）');
    expect(formatGeometricGrowthMethods(-0.2, -0.2, null)).toBe('-0.20（-0.20/—）');
  });
});

describe('【美观】W（b）≥ 10 时只留一位小数，封面三个读数放得下', () => {
  it('显示与分档同一个取整', async () => {
    const { formatGeometricGrowth, geometricGrowthBinValue } = await import('@/lib/campaignUnitProfit');
    expect(formatGeometricGrowth(12.345)).toBe('12.3');
    expect(formatGeometricGrowth(9.996)).toBe('10.0');
    expect(formatGeometricGrowth(9.24)).toBe('9.24');
    expect(geometricGrowthBinValue(12.345)).toBe(12.3);
    expect(geometricGrowthBinValue(9.243)).toBe(9.24);
    expect(geometricGrowthBinValue(1.0002)).toBe(1);
  });
});

describe('【用户要求】统计概览的几何期望：单场几何期望逐场连乘、取几何平均', () => {
  it('连乘与几何平均；算不出的场不计入 n', () => {
    const summary = summarizeGeometricExpectancy([1.2, 0.9, null, undefined, Number.NaN, 1.5]);
    expect(summary.count).toBe(3);
    expect(summary.product).toBeCloseTo(1.2 * 0.9 * 1.5, 12);
    expect(summary.mean).toBeCloseTo(Math.cbrt(1.2 * 0.9 * 1.5), 12);
    expect(summary.ruinCount).toBe(0);
  });

  it('有一场 ≤ 0（b ≤ −10）时连乘与几何平均归零，并报出场数', () => {
    expect(summarizeGeometricExpectancy([1.2, 0, -0.5])).toEqual({ count: 3, product: 0, mean: 0, ruinCount: 2 });
  });

  it('没有样本时为 null；几百场也不会上溢', () => {
    expect(summarizeGeometricExpectancy([])).toEqual({ count: 0, product: null, mean: null, ruinCount: 0 });
    const many = summarizeGeometricExpectancy(Array.from({ length: 2000 }, () => 3));
    expect(many.mean).toBeCloseTo(3, 9);
    expect(many.product).toBe(Number.POSITIVE_INFINITY);
  });
});
