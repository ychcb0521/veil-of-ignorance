import { describe, expect, it } from 'vitest';
import {
  computeLegPriceChangePct,
  formatLegPriceChangePct,
  legPriceChangeDirection,
} from '@/lib/legPriceChange';

/**
 * 【用户要求】Legs 表在开平价右边加「涨跌幅」列：
 * （平仓价 − 开仓价）÷ 开仓价 × 100%，标的本身的涨跌，不按方向翻转。
 */
describe('涨跌幅 helper', () => {
  it('多单 2.8717 → 6.5194：+127.02%，绿（up）', () => {
    const pct = computeLegPriceChangePct(2.8717, 6.5194);
    expect(pct).toBeCloseTo(127.0223, 3);
    expect(formatLegPriceChangePct(pct)).toBe('+127.02%');
    expect(legPriceChangeDirection(pct)).toBe('up');
  });

  it('价格下跌是负数，不看方向：空单的价格跌了照样印负号', () => {
    const pct = computeLegPriceChangePct(10, 9.659);
    expect(formatLegPriceChangePct(pct)).toBe('-3.41%');
    expect(legPriceChangeDirection(pct)).toBe('down');
  });

  it('保留原始精度，只在格式化时取两位；小价格币也不丢精度', () => {
    // TUTUSDT 主力 0.0336792 → 对冲平仓 0.052
    const pct = computeLegPriceChangePct(0.0336792, 0.052)!;
    expect(pct).toBeCloseTo(54.39796, 4);
    expect(formatLegPriceChangePct(pct)).toBe('+54.40%');
    expect(formatLegPriceChangePct(computeLegPriceChangePct(1, 124.4567))).toBe('+12345.67%');
    // 平仓价 0 是合法的 −100%，不是缺值
    expect(formatLegPriceChangePct(computeLegPriceChangePct(5, 0))).toBe('-100.00%');
  });

  it('取整为 0 印「0.00%」：不带 +，也绝不是「-0.00%」，方向是中性 flat', () => {
    for (const exit of [100.004, 99.996, 100]) {
      const pct = computeLegPriceChangePct(100, exit);
      expect(pct).not.toBeNull();
      expect(formatLegPriceChangePct(pct)).toBe('0.00%');
      expect(legPriceChangeDirection(pct)).toBe('flat');
    }
    expect(formatLegPriceChangePct(-0)).toBe('0.00%');
    expect(formatLegPriceChangePct(-0.0049)).toBe('0.00%');
  });

  it('任一价格缺失、非有限或开仓价 ≤ 0：null，显示「—」，无方向', () => {
    const cases: Array<[number | null | undefined, number | null | undefined]> = [
      [null, 1], [1, null], [undefined, 1], [1, undefined],
      [Number.NaN, 1], [1, Number.NaN], [Number.POSITIVE_INFINITY, 1], [1, Number.NEGATIVE_INFINITY],
      [0, 1], [-2, 1],
    ];
    for (const [entry, exit] of cases) {
      const pct = computeLegPriceChangePct(entry, exit);
      expect(pct).toBeNull();
      expect(formatLegPriceChangePct(pct)).toBe('—');
      expect(legPriceChangeDirection(pct)).toBeNull();
    }
    expect(formatLegPriceChangePct(Number.NaN)).toBe('—');
  });
});
