import { describe, expect, it } from 'vitest';
import {
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
