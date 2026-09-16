import { describe, expect, it } from 'vitest';
import {
  computeLegPriceChangePct,
  formatLegPriceChangePct,
  legPriceChangeDirection,
} from '@/lib/legPriceChange';

/**
 * 【用户要求】Legs 表在开平价右边加「涨跌幅」列，按这条腿的方向计：
 * 多单 =（平仓价 − 开仓价）÷ 开仓价 × 100%，空单 =（开仓价 − 平仓价）÷ 开仓价 × 100%。
 * 正数即这条腿在价格上占优，与「贡献 / 盈亏」同号——对冲是空单，价格涨了不能印成绿色正数。
 */
describe('涨跌幅 helper', () => {
  it('多单 2.8717 → 6.5194：+127.02%，绿（up）', () => {
    const pct = computeLegPriceChangePct(2.8717, 6.5194, 'long');
    expect(pct).toBeCloseTo(127.0223, 3);
    expect(formatLegPriceChangePct(pct)).toBe('+127.02%');
    expect(legPriceChangeDirection(pct)).toBe('up');
  });

  it('ORDIUSDT 滚动对冲（空单）6.3132 → 6.5194：价格涨了 3.27%，空单是 -3.27%，红（down）', () => {
    const pct = computeLegPriceChangePct(6.3132, 6.5194, 'short');
    expect(pct).toBeCloseTo(-3.2662, 3);
    expect(formatLegPriceChangePct(pct)).toBe('-3.27%');
    expect(legPriceChangeDirection(pct)).toBe('down');
    // 同一对价按多单算就是 +3.27%：符号只由方向决定
    expect(formatLegPriceChangePct(computeLegPriceChangePct(6.3132, 6.5194, 'long'))).toBe('+3.27%');
  });

  it('空单价格下跌是正数：10 → 9.659 空单 = +3.41%，绿（up）；同一对价多单是 -3.41%', () => {
    const short = computeLegPriceChangePct(10, 9.659, 'short');
    expect(short).toBeCloseTo(3.41, 6);
    expect(formatLegPriceChangePct(short)).toBe('+3.41%');
    expect(legPriceChangeDirection(short)).toBe('up');
    const long = computeLegPriceChangePct(10, 9.659, 'long');
    expect(formatLegPriceChangePct(long)).toBe('-3.41%');
    expect(legPriceChangeDirection(long)).toBe('down');
  });

  it('保留原始精度，只在格式化时取两位；小价格币也不丢精度', () => {
    // TUTUSDT 主力（多单）0.0336792 → 对冲平仓 0.052
    const pct = computeLegPriceChangePct(0.0336792, 0.052, 'long')!;
    expect(pct).toBeCloseTo(54.39796, 4);
    expect(formatLegPriceChangePct(pct)).toBe('+54.40%');
    expect(formatLegPriceChangePct(computeLegPriceChangePct(1, 124.4567, 'long'))).toBe('+12345.67%');
    // 平仓价 0 是合法的：多单 −100%、空单 +100%，不是缺值
    expect(formatLegPriceChangePct(computeLegPriceChangePct(5, 0, 'long'))).toBe('-100.00%');
    expect(formatLegPriceChangePct(computeLegPriceChangePct(5, 0, 'short'))).toBe('+100.00%');
  });

  it('取整为 0 印「0.00%」：不带 +，也绝不是「-0.00%」，方向是中性 flat——多空都一样', () => {
    for (const side of ['long', 'short'] as const) {
      for (const exit of [100.004, 99.996, 100]) {
        const pct = computeLegPriceChangePct(100, exit, side);
        expect(pct).not.toBeNull();
        expect(formatLegPriceChangePct(pct)).toBe('0.00%');
        expect(legPriceChangeDirection(pct)).toBe('flat');
      }
    }
    expect(formatLegPriceChangePct(-0)).toBe('0.00%');
    expect(formatLegPriceChangePct(-0.0049)).toBe('0.00%');
  });

  it('任一价格缺失、非有限或开仓价 ≤ 0：null，显示「—」，无方向——多空都一样', () => {
    const cases: Array<[number | null | undefined, number | null | undefined]> = [
      [null, 1], [1, null], [undefined, 1], [1, undefined],
      [Number.NaN, 1], [1, Number.NaN], [Number.POSITIVE_INFINITY, 1], [1, Number.NEGATIVE_INFINITY],
      [0, 1], [-2, 1],
    ];
    for (const side of ['long', 'short'] as const) {
      for (const [entry, exit] of cases) {
        const pct = computeLegPriceChangePct(entry, exit, side);
        expect(pct).toBeNull();
        expect(formatLegPriceChangePct(pct)).toBe('—');
        expect(legPriceChangeDirection(pct)).toBeNull();
      }
    }
    expect(formatLegPriceChangePct(Number.NaN)).toBe('—');
  });
});
