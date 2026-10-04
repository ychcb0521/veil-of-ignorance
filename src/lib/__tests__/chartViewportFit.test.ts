import { describe, expect, it } from 'vitest';
import { CHART_FIT_MARGIN, chartBoxHeightToFitViewport } from '@/lib/chartViewportFit';

describe('【用户要求】散点图一屏看全：绘图盒的高度上限', () => {
  it('上限 = 视口高 − 面板顶边 − 面板里绘图盒以外的部分 − 留白', () => {
    // 用户截图的情形：视口 778，面板顶边 168，面板 872 高、其中绘图盒 704 → 盒子以外 168
    expect(chartBoxHeightToFitViewport({ viewportHeight: 778, panelTop: 168, panelHeight: 872, boxHeight: 704 }))
      .toBe(778 - 168 - 168 - CHART_FIT_MARGIN);
    // 盒子按上限缩小之后再量一次，结果不变（不会来回追）
    expect(chartBoxHeightToFitViewport({ viewportHeight: 778, panelTop: 168, panelHeight: 434 + 168, boxHeight: 434 }))
      .toBe(434);
  });

  it('盒子以外的部分变高（图例换行、说明展开），上限跟着变小', () => {
    const plain = chartBoxHeightToFitViewport({ viewportHeight: 900, panelTop: 150, panelHeight: 700, boxHeight: 540 })!;
    const withGuide = chartBoxHeightToFitViewport({ viewportHeight: 900, panelTop: 150, panelHeight: 820, boxHeight: 540 })!;
    expect(plain - withGuide).toBe(120);
  });

  it('窗口太矮时结果可以很小甚至为负，由绘图元件的 18rem 下限兜住', () => {
    expect(chartBoxHeightToFitViewport({ viewportHeight: 400, panelTop: 250, panelHeight: 600, boxHeight: 440 })).toBeLessThan(0);
  });

  it('量不到尺寸（没挂载、jsdom 里全是 0）返回 null = 不设上限', () => {
    expect(chartBoxHeightToFitViewport({ viewportHeight: 768, panelTop: 57, panelHeight: 0, boxHeight: 0 })).toBeNull();
    expect(chartBoxHeightToFitViewport({ viewportHeight: 0, panelTop: 57, panelHeight: 600, boxHeight: 400 })).toBeNull();
    expect(chartBoxHeightToFitViewport({ viewportHeight: 768, panelTop: Number.NaN, panelHeight: 600, boxHeight: 400 })).toBeNull();
    expect(chartBoxHeightToFitViewport({ viewportHeight: 768, panelTop: 57, panelHeight: 600, boxHeight: 0 })).toBeNull();
  });

  it('面板顶边为负（滚过头）按 0 算，不会放大上限', () => {
    expect(chartBoxHeightToFitViewport({ viewportHeight: 778, panelTop: -40, panelHeight: 600, boxHeight: 450 }))
      .toBe(778 - 150 - CHART_FIT_MARGIN);
  });
});
