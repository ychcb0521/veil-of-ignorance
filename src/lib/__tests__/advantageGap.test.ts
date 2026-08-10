import { describe, expect, it } from 'vitest';
import { breakEvenWinRate, computeAdvantageGap } from '../advantageGap';

describe('computeAdvantageGap', () => {
  it('多头 K < S < T：P₀ 为已走过的距离占全程的比例', () => {
    // S 位于 K 与 T 的正中 → 市场免费给的胜率是 50%，赔率恰为 1
    const result = computeAdvantageGap(100, 90, 110, 0.6);
    expect(result).toEqual({
      valid: true, direction: 'long', baseline: 0.5, payoffRatio: 1, gap: expect.closeTo(0.1, 12),
    });
  });

  it('空头 T < S < K：同一套绝对值公式成立', () => {
    const result = computeAdvantageGap(100, 110, 90, 0.6);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.direction).toBe('short');
    expect(result.baseline).toBeCloseTo(0.5, 12);
    expect(result.gap).toBeCloseTo(0.1, 12);
  });

  it('价格逼近目标时基线抬高、优势被吃掉', () => {
    const early = computeAdvantageGap(92, 90, 110, 0.6);
    const late = computeAdvantageGap(108, 90, 110, 0.6);
    expect(early.valid && early.baseline).toBeCloseTo(0.1, 12);
    expect(late.valid && late.baseline).toBeCloseTo(0.9, 12);
    // 同一个主观胜率，越晚进场 gap 越小，直至转负
    expect(early.valid && early.gap).toBeCloseTo(0.5, 12);
    expect(late.valid && late.gap).toBeCloseTo(-0.3, 12);
  });

  it('P 未填写时只给基线，不给 gap', () => {
    const result = computeAdvantageGap(100, 90, 110, null);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.baseline).toBeCloseTo(0.5, 12);
    expect(result.gap).toBeNull();
  });

  it('T === K 判为退化，不出数字', () => {
    expect(computeAdvantageGap(100, 100, 100, 0.6)).toEqual({ valid: false, reason: 'degenerate' });
  });

  it('方向不成立时不出数字', () => {
    // S 在 K 与 T 的同一侧：既非 K<S<T，也非 T<S<K
    expect(computeAdvantageGap(80, 90, 110, 0.6)).toEqual({ valid: false, reason: 'direction' });
    expect(computeAdvantageGap(120, 90, 110, 0.6)).toEqual({ valid: false, reason: 'direction' });
    // 边界：S 落在 K 或 T 上，方向同样不成立
    expect(computeAdvantageGap(90, 90, 110, 0.6)).toEqual({ valid: false, reason: 'direction' });
    expect(computeAdvantageGap(110, 90, 110, 0.6)).toEqual({ valid: false, reason: 'direction' });
  });

  it('动态赔率 b =（T − S）÷（S − K），多空两向均为正', () => {
    // 多头：上方还有 20、下方风险 10 → b = 2
    const long = computeAdvantageGap(100, 90, 120, null);
    expect(long.valid && long.payoffRatio).toBeCloseTo(2, 12);
    // 空头：下方还有 20、上方风险 10 → 同样 b = 2
    const short = computeAdvantageGap(100, 110, 80, null);
    expect(short.valid && short.payoffRatio).toBeCloseTo(2, 12);
  });

  it('恒等式 1 ÷ (1 + b) ≡ P₀——盈亏平衡胜率就是市场免费给的胜率', () => {
    const cases: Array<[number, number, number]> = [
      [100, 90, 110], [100, 90, 120], [100, 95, 130],
      [100, 110, 80], [100, 105, 70], [0.0178, 0.0176, 0.0197],
    ];
    for (const [s, k, t] of cases) {
      const r = computeAdvantageGap(s, k, t, null);
      expect(r.valid).toBe(true);
      if (!r.valid) continue;
      expect(breakEvenWinRate(r.payoffRatio)).toBeCloseTo(r.baseline, 12);
    }
  });

  it('价格逼近目标时赔率坍缩、平衡胜率抬高', () => {
    const early = computeAdvantageGap(92, 90, 110, null);
    const late = computeAdvantageGap(108, 90, 110, null);
    expect(early.valid && early.payoffRatio).toBeCloseTo(9, 12);   // 赚 18 亏 2
    expect(late.valid && late.payoffRatio).toBeCloseTo(2 / 18, 12); // 赚 2 亏 18
    expect(breakEvenWinRate(early.valid ? early.payoffRatio : 0)).toBeCloseTo(0.1, 12);
    expect(breakEvenWinRate(late.valid ? late.payoffRatio : 0)).toBeCloseTo(0.9, 12);
  });

  it('breakEvenWinRate 的边界：b=0 需要 100%，b≤−1 无意义', () => {
    expect(breakEvenWinRate(0)).toBe(1);
    expect(breakEvenWinRate(-1)).toBeNull();
    expect(breakEvenWinRate(Number.NaN)).toBeNull();
  });

  it('缺少任一价格或拿到非有限数时判为未完成', () => {
    expect(computeAdvantageGap(null, 90, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(100, null, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(100, 90, null, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(Number.NaN, 90, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
  });
});
