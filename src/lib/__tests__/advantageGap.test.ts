import { describe, expect, it } from 'vitest';
import { computeAdvantageGap } from '../advantageGap';

describe('computeAdvantageGap', () => {
  it('多头 K < S < T：P₀ 为已走过的距离占全程的比例', () => {
    // S 位于 K 与 T 的正中 → 市场免费给的胜率是 50%
    const result = computeAdvantageGap(100, 90, 110, 0.6);
    expect(result).toEqual({ valid: true, direction: 'long', baseline: 0.5, gap: expect.closeTo(0.1, 12) });
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

  it('缺少任一价格或拿到非有限数时判为未完成', () => {
    expect(computeAdvantageGap(null, 90, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(100, null, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(100, 90, null, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
    expect(computeAdvantageGap(Number.NaN, 90, 110, 0.6)).toEqual({ valid: false, reason: 'incomplete' });
  });
});
