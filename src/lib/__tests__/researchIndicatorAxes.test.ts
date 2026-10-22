import { describe, expect, it, vi } from 'vitest';
import type { Chart } from 'klinecharts';
import { configureResearchPaneAxis } from '@/lib/researchIndicatorAxes';
import { RESEARCH_INDICATORS, researchKcName } from '@/lib/researchIndicators';

describe('研究指标的反向纵轴', () => {
  it.each(RESEARCH_INDICATORS)('$id 的原值与两个均值只按卖方标记反转，不动价格轴和其他指标', item => {
    const axis = { isReverse: () => false };
    const getDrawPaneById = vi.fn(() => ({ getAxisComponent: () => axis }));
    const setPaneOptions = vi.fn();
    const chart = { getDrawPaneById, setPaneOptions } as unknown as Chart;
    for (const level of [0, 1, 2]) {
      configureResearchPaneAxis(chart, 'pane_' + level, researchKcName(item.id, level));
      expect(axis.isReverse()).toBe(item.seller);
    }
    expect(setPaneOptions).toHaveBeenCalledTimes(item.seller ? 3 : 0);
    getDrawPaneById.mockClear();
    configureResearchPaneAxis(chart, 'candle_pane', researchKcName(item.id));
    configureResearchPaneAxis(chart, 'another_pane', 'MACD');
    expect(getDrawPaneById).not.toHaveBeenCalled();
  });

  it('未创建的窗格或缺少兼容接口时不影响其他图表', () => {
    const chart = { setPaneOptions: vi.fn() } as unknown as Chart;
    expect(() => configureResearchPaneAxis(chart, null, 'CDI2_CUSTOM')).not.toThrow();
    expect(() => configureResearchPaneAxis(chart, 'pane_1', 'CDI2_CUSTOM')).not.toThrow();
    expect(chart.setPaneOptions).not.toHaveBeenCalled();
  });
});
