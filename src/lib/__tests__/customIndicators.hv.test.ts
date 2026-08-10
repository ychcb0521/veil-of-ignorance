import { describe, expect, it } from 'vitest';
import { computeAnnualizedVolatility } from '../customIndicators';

const MIN = 60_000;
const MS_PER_YEAR = 365 * 24 * 3_600_000;

describe('computeAnnualizedVolatility（历史波动率：对数收益滚动方差 → 年化 σ%）', () => {
  it('恒定收益率 → 方差为 0，年化波动率为 0', () => {
    // 每根 +1%：对数收益恒定，样本方差应为 0
    const closesArr = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i);
    const hv = computeAnnualizedVolatility(closesArr, 10, MIN);
    const finite = hv.filter(Number.isFinite);
    expect(finite.length).toBeGreaterThan(0);
    for (const v of finite) expect(v).toBeCloseTo(0, 8);
  });

  it('已知交替收益的样本方差与年化系数逐项吻合', () => {
    // 收益交替 +1% / −1%（对数域精确构造）
    const up = Math.exp(0.01);
    const down = Math.exp(-0.01);
    const closesArr = [100];
    for (let i = 0; i < 20; i++) closesArr.push(closesArr[closesArr.length - 1] * (i % 2 === 0 ? up : down));

    const period = 4;
    const hv = computeAnnualizedVolatility(closesArr, period, MIN);
    // 窗口内收益 [+.01,−.01,+.01,−.01]（或反相）：均值 0，样本方差 = 4·(0.01²)/3
    const expectedSigma = Math.sqrt((4 * 0.01 ** 2) / 3);
    const annualize = Math.sqrt(MS_PER_YEAR / MIN);
    const idx = hv.findIndex(Number.isFinite);
    expect(idx).toBe(period); // 第 period 根起才有完整窗口
    expect(hv[idx]).toBeCloseTo(expectedSigma * annualize * 100, 6);
  });

  it('年化随周期自动适配：1h 周期的系数是 1m 的 1/√60', () => {
    const closesArr = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 3 + i * 0.1);
    const hv1m = computeAnnualizedVolatility(closesArr, 10, MIN);
    const hv1h = computeAnnualizedVolatility(closesArr, 10, 60 * MIN);
    const i = hv1m.findIndex(Number.isFinite);
    expect(hv1m[i] / hv1h[i]).toBeCloseTo(Math.sqrt(60), 8);
  });

  it('窗口未满与无效价格处为 NaN，不出假值', () => {
    const closesArr = [100, 101, 0, 102, 103, 104, 105, 106, 107, 108];
    const hv = computeAnnualizedVolatility(closesArr, 3, MIN);
    // 前 3 根窗口未满
    expect(Number.isFinite(hv[0])).toBe(false);
    expect(Number.isFinite(hv[2])).toBe(false);
    // 0 价产生的 NaN 收益污染所及窗口均不出数
    expect(Number.isFinite(hv[3])).toBe(false);
    expect(Number.isFinite(hv[4])).toBe(false);
    // 远离污染后恢复
    expect(Number.isFinite(hv[9])).toBe(true);
  });

  it('滚动窗口只看最近 N 根：早期高波动移出窗口后读数回落', () => {
    // 前段剧烈震荡，后段完全平稳
    const closesArr = [100, 120, 90, 130, 85, 110, 100];
    for (let i = 0; i < 15; i++) closesArr.push(100); // 收益全 0
    const hv = computeAnnualizedVolatility(closesArr, 5, MIN);
    const last = hv[hv.length - 1];
    // 增量滚动求和存在浮点残差；相对典型读数（几十~几百 %）以 0.01% 为零阈
    expect(last).toBeLessThan(0.01);
  });
});
