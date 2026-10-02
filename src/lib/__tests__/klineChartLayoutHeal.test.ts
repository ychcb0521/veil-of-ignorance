import { describe, expect, it } from 'vitest';
import { klineChartLayoutIsStale } from '@/lib/klineChartLayoutHeal';

const pane = (height: number, dom = height, canvas = height) => ({
  getBounding: () => ({ height }),
  _container: { offsetHeight: dom },
  _mainWidget: { _mainCanvas: { _element: { clientHeight: canvas } } },
});

const chart = (opts: { panes?: ReturnType<typeof pane>[]; container?: number } = {}) => ({
  // KlineCharts v9：_drawPanes 已含横轴窗格；分隔条在 Map 里
  _drawPanes: opts.panes ?? [pane(636), pane(100), pane(24)],
  _separatorPanes: new Map([[0, { getBounding: () => ({ height: 1 }) }]]),
  _chartContainer: { clientHeight: opts.container ?? 761 },
});

describe('【用户反馈】盘面内部布局过时（十字线落到副图、缩放失效）的识别', () => {
  it('内部高度、DOM、画布、容器总高都对得上：不过时', () => {
    expect(klineChartLayoutIsStale(chart())).toBe(false);
  });

  it('主图内部高度与它的 DOM / 画布不一致：过时', () => {
    expect(klineChartLayoutIsStale(chart({ panes: [pane(516, 636, 636), pane(100), pane(24)] }))).toBe(true);
    expect(klineChartLayoutIsStale(chart({ panes: [pane(636, 636, 500), pane(100), pane(24)] }))).toBe(true);
  });

  it('容器变高了、各窗格还按旧高度排：过时', () => {
    expect(klineChartLayoutIsStale(chart({ container: 911 }))).toBe(true);
  });

  it('结构认不出（不是 KlineCharts v9 的实例）时不动图表', () => {
    expect(klineChartLayoutIsStale(null)).toBe(false);
    expect(klineChartLayoutIsStale({})).toBe(false);
    expect(klineChartLayoutIsStale({ _drawPanes: [{}] })).toBe(false);
  });
});
