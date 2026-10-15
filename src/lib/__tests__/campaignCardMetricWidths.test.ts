import { describe, expect, it } from 'vitest';
import {
  CARD_METRIC_CELL_PADDING_X,
  cardMetricGridTemplate,
  cardMetricItemWidths,
  estimateCardMetricLabelWidth,
  estimateCardMetricValueWidth,
} from '../campaignCardMetricWidths';

describe('封面指标列宽（【用户要求】两排靠左、完整显示即可、不留大空隙）', () => {
  it('读数按 11px 等宽估算：半角 0.6182em，中文 1em；「·」「—」「−」按半角', () => {
    expect(estimateCardMetricValueWidth('10.00%')).toBeCloseTo(6 * 0.6182 * 11, 6);
    expect(estimateCardMetricValueWidth('已实现·盈利')).toBeCloseTo((5 + 0.6182) * 11, 6);
    expect(estimateCardMetricValueWidth('—')).toBeCloseTo(0.6182 * 11, 6);
    expect(estimateCardMetricLabelWidth('预期回撤')).toBe(40);
  });

  it('每项取指标名与全部读数里最宽的那个，加内边距后向上取整到偶数', () => {
    const labels = { a: '预期回撤', b: '盈亏比' };
    const widths = cardMetricItemWidths(labels, [
      { a: '1.00%', b: '50.00(+0.00)' },
      { a: '10.00%', b: '-6.25' },
    ]);
    // a：指标名 40px > 6 个半角 40.8px？40.8 更宽 → 40.8 + 20 = 60.8 → 62
    expect(widths.a).toBe(62);
    // b：12 个半角 81.6px + 20 → 102
    expect(widths.b).toBe(102);
    // 没有战役时只看指标名
    expect(cardMetricItemWidths(labels, [])).toEqual({ a: 40 + CARD_METRIC_CELL_PADDING_X, b: 30 + CARD_METRIC_CELL_PADDING_X });
  });

  it('列宽模板：第 k 列取第 k、k+n、k+2n… 项里最宽的', () => {
    const order = ['a', 'b', 'c', 'd', 'e'] as const;
    const widths = { a: 60, b: 80, c: 70, d: 100, e: 50 };
    expect(cardMetricGridTemplate(order, widths, 3)).toBe('100px 80px 70px');
    expect(cardMetricGridTemplate(order, widths, 5)).toBe('60px 80px 70px 100px 50px');
  });
});
