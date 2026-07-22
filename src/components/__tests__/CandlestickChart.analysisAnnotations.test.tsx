import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandlestickChart } from '@/components/CandlestickChart';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { KlineData } from '@/hooks/useBinanceData';
import { FLOATING_LABEL_HEIGHT, layoutAnalysisFloatingLabels } from '@/lib/analysisFloatingLabels';
import {
  installKlineChartPointerInteraction,
  primeKlineChartPointerInteraction,
} from '@/lib/klineChartInteraction';
import {
  ANALYSIS_BAND_LABEL_OVERLAY,
  createAnalysisBandLabelFigures,
} from '@/lib/analysisBandLabelOverlay';

const mocks = vi.hoisted(() => {
  type ChartCandle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  const dataList: ChartCandle[] = [];
  const registeredOverlays = new Map<string, any>();
  const chart = {
    resize: vi.fn(),
    subscribeAction: vi.fn(),
    unsubscribeAction: vi.fn(),
    setStyles: vi.fn(),
    setPriceVolumePrecision: vi.fn(),
    applyNewData: vi.fn((nextData: ChartCandle[], _more?: boolean, callback?: () => void) => {
      dataList.splice(0, dataList.length, ...nextData);
      callback?.();
    }),
    applyMoreData: vi.fn((olderData: ChartCandle[], _more?: boolean, callback?: () => void) => {
      dataList.splice(0, 0, ...olderData);
      callback?.();
    }),
    updateData: vi.fn((nextCandle: ChartCandle, callback?: () => void) => {
      const last = dataList[dataList.length - 1];
      if (last?.timestamp === nextCandle.timestamp) dataList[dataList.length - 1] = nextCandle;
      else dataList.push(nextCandle);
      callback?.();
    }),
    createOverlay: vi.fn(),
    overrideOverlay: vi.fn(),
    removeOverlay: vi.fn(),
    getSize: vi.fn(() => ({ width: 1000, height: 520 })),
    getDataList: vi.fn(() => dataList),
    getBarSpace: vi.fn(() => 8),
    setBarSpace: vi.fn(),
    setOffsetRightDistance: vi.fn(),
    scrollByDistance: vi.fn(),
    scrollToRealTime: vi.fn(),
    scrollToTimestamp: vi.fn(),
    convertFromPixel: vi.fn(),
    convertToPixel: vi.fn((point: any) => {
      const value = Array.isArray(point) ? point[0] : point;
      return {
        x: typeof value?.dataIndex === 'number'
          ? value.dataIndex * 100 + 50
          : typeof value?.timestamp === 'number' ? value.timestamp / 10 : 0,
        y: 0,
      };
    }),
  };

  return {
    chart,
    dataList,
    init: vi.fn(() => chart),
    dispose: vi.fn(),
    registerIndicator: vi.fn(),
    registerOverlay: vi.fn((template: any) => registeredOverlays.set(template.name, template)),
    getSupportedOverlays: vi.fn(() => Array.from(registeredOverlays.keys())),
    registeredOverlays,
  };
});

vi.mock('klinecharts', () => ({
  init: mocks.init,
  dispose: mocks.dispose,
  registerIndicator: mocks.registerIndicator,
  registerOverlay: mocks.registerOverlay,
  getSupportedOverlays: mocks.getSupportedOverlays,
  CandleType: { CandleSolid: 'candle_solid' },
  LineType: { Dashed: 'dashed', Solid: 'solid' },
  PolygonType: { StrokeFill: 'stroke_fill' },
  DomPosition: { Root: 'root', Main: 'main', YAxis: 'yAxis' },
  ActionType: {
    OnDataReady: 'onDataReady',
    OnScroll: 'onScroll',
    OnZoom: 'onZoom',
    OnVisibleRangeChange: 'onVisibleRangeChange',
  },
  TooltipShowRule: { FollowCross: 'follow_cross' },
  TooltipShowType: { Standard: 'standard' },
}));

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

const labelsOverlap = (
  a: ReturnType<typeof layoutAnalysisFloatingLabels>[number],
  b: ReturnType<typeof layoutAnalysisFloatingLabels>[number],
) => {
  const height = FLOATING_LABEL_HEIGHT;
  return !(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + height <= b.top || b.top + height <= a.top);
};

function candle(time: number, close = 1): KlineData {
  return {
    time,
    open: close,
    high: close + 0.1,
    low: close - 0.1,
    close,
    volume: 1,
  };
}

const getBandOverlay = () => mocks.chart.createOverlay.mock.calls
  .map(([overlay]) => overlay)
  .find(overlay => overlay.name === ANALYSIS_BAND_LABEL_OVERLAY);

const getBandLabelTexts = () => getBandOverlay()?.extendData?.labels?.map((label: any) => label.text) ?? [];

describe('CandlestickChart analysis annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dataList.length = 0;
    mocks.chart.getDataList.mockImplementation(() => mocks.dataList);
    mocks.chart.convertToPixel.mockImplementation((point: any) => {
      const value = Array.isArray(point) ? point[0] : point;
      return {
        x: typeof value?.dataIndex === 'number'
          ? value.dataIndex * 100 + 50
          : typeof value?.timestamp === 'number' ? value.timestamp / 10 : 0,
        y: 0,
      };
    });
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  it('图表在静止鼠标下异步挂载时会预激活原生指针交互', () => {
    const host = document.createElement('div');
    const chartEventRoot = document.createElement('div');
    const mouseEnter = vi.fn();
    chartEventRoot.addEventListener('mouseenter', mouseEnter);
    host.appendChild(chartEventRoot);

    expect(primeKlineChartPointerInteraction(host)).toBe(true);
    expect(mouseEnter).toHaveBeenCalledTimes(1);
  });

  it('图表在鼠标已位于盘面时会同步窗格并补发首次移动', () => {
    const host = document.createElement('div');
    const chartEventRoot = document.createElement('div');
    chartEventRoot.tabIndex = 1;
    const nativeMouseMove = vi.fn();
    const beforeActivate = vi.fn();
    chartEventRoot.addEventListener('mouseenter', () => {
      chartEventRoot.addEventListener('mousemove', nativeMouseMove);
    });
    host.appendChild(chartEventRoot);

    const interaction = installKlineChartPointerInteraction(host, beforeActivate);
    chartEventRoot.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 120,
      clientY: 80,
    }));

    expect(beforeActivate).toHaveBeenCalledTimes(1);
    expect(nativeMouseMove).toHaveBeenCalled();

    chartEventRoot.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(beforeActivate).toHaveBeenCalledTimes(1);
    interaction.destroy();
  });

  it('为分析标注创建独立 overlay，避免竖线被标签或 marker 覆盖', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          verticalLines: [
            {
              time: 1000,
              color: 'rgba(0,47,167,0.84)',
              width: 0.85,
              dashed: false,
              label: '主力·开仓',
            },
            {
              time: 2000,
              color: 'rgba(54,24,91,0.84)',
              width: 0.85,
              dashed: true,
              label: '滚动对冲·平仓',
            },
          ],
          markers: [
            {
              time: 1000,
              price: 1,
              color: '#0ECB81',
              shape: 'triangle-up',
              label: 'M',
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(mocks.chart.createOverlay).toHaveBeenCalled();
    });

    const overlays = mocks.chart.createOverlay.mock.calls.map(([overlay]) => overlay);
    const ids = overlays.map(overlay => overlay.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => String(id).startsWith('analysis_annotations_'))).toBe(true);

    const verticalOverlays = overlays.filter(overlay => overlay.name === 'verticalStraightLine');
    expect(verticalOverlays).toHaveLength(2);
    expect(verticalOverlays[0]).toMatchObject({
      paneId: 'candle_pane',
      styles: {
        line: {
          style: 'solid',
          color: 'rgba(0,47,167,0.84)',
          size: 0.85,
        },
      },
    });
    expect(verticalOverlays[1]).toMatchObject({
      paneId: 'candle_pane',
      styles: {
        line: {
          style: 'dashed',
          color: 'rgba(54,24,91,0.84)',
          size: 0.85,
        },
      },
    });
    expect(
      overlays.flatMap(overlay => overlay.points ?? []).every(point => !('dataIndex' in point)),
    ).toBe(true);
    const bandOverlay = overlays.find(overlay => overlay.name === ANALYSIS_BAND_LABEL_OVERLAY);
    expect(bandOverlay?.points).toEqual([
      { timestamp: 2000, value: 1.2 },
      { timestamp: 1000, value: 1.2 },
    ]);
    expect(document.querySelector('[data-analysis-label]')).toBeNull();
    expect(mocks.chart.subscribeAction).not.toHaveBeenCalledWith('onScroll', expect.any(Function));
    expect(mocks.chart.subscribeAction).not.toHaveBeenCalledWith('onZoom', expect.any(Function));
  });

  it('隐藏反事实层时按组彻底清除紫色原生图层和浮动标签', async () => {
    const data = [candle(1000, 1), candle(2000, 1.2)];
    const { rerender } = render(
      <CandlestickChart
        data={data}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          markers: [{
            time: 1000,
            price: 1,
            color: '#B080FF',
            shape: 'triangle-up',
            label: 'CF-M',
          }],
          timeBoundPriceLines: [{
            startTime: 1000,
            endTime: 2000,
            price: 1.1,
            color: '#B080FF',
            title: 'CF-Ha',
          }],
          verticalLines: [{
            time: 1000,
            color: 'rgba(176,128,255,0.38)',
          }],
        }}
      />,
    );

    await waitFor(() => {
      expect(getBandLabelTexts().some((label: string) => label.includes('CF-'))).toBe(true);
    });
    expect(mocks.chart.createOverlay.mock.calls.map(([overlay]) => overlay)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: 'analysis_annotations' }),
      ]),
    );

    mocks.chart.createOverlay.mockClear();
    mocks.chart.removeOverlay.mockClear();
    rerender(
      <CandlestickChart
        data={data}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{}}
      />,
    );

    await waitFor(() => expect(getBandOverlay()).toBeUndefined());
    expect(mocks.chart.removeOverlay).toHaveBeenCalledWith({ groupId: 'analysis_annotations' });
    expect(mocks.chart.createOverlay).not.toHaveBeenCalled();
  });

  it('同一时间多个标记仍按真实价格落点，不为避让改动 marker value', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          markers: [
            {
              time: 1000,
              price: 1,
              color: '#0ECB81',
              shape: 'triangle-up',
              label: 'M',
            },
            {
              time: 1000,
              price: 1.005,
              color: '#2B80FF',
              shape: 'square',
              label: 'M 全平',
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(mocks.chart.createOverlay).toHaveBeenCalled();
    });

    const markerOverlays = mocks.chart.createOverlay.mock.calls
      .map(([overlay]) => overlay)
      .filter(overlay => overlay.name === 'simpleAnnotation');

    expect(markerOverlays.map(overlay => overlay.points?.[0])).toEqual([
      { timestamp: 1000, value: 1 },
      { timestamp: 1000, value: 1.005 },
    ]);
  });

  it('图表滚动或缩放时标签由原生覆盖物坐标重绘，不存在独立 DOM 位移反馈', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          verticalLines: [
            {
              time: 1000,
              color: '#3B82F6',
              width: 0.85,
              dashed: true,
              label: '主力开始',
            },
          ],
        }}
      />,
    );

    await waitFor(() => expect(getBandOverlay()).toBeDefined());
    const overlay = getBandOverlay();
    const before = createAnalysisBandLabelFigures({
      overlay,
      coordinates: [{ x: 120, y: 0 }],
      bounding: { width: 1000, height: 520 },
    } as any);
    const after = createAnalysisBandLabelFigures({
      overlay,
      coordinates: [{ x: 410, y: 0 }],
      bounding: { width: 1000, height: 520 },
    } as any);

    expect(before[0].attrs.x).toBe(120);
    expect(after[0].attrs.x).toBe(410);
    expect(document.querySelector('[data-analysis-label]')).toBeNull();
    expect(mocks.chart.scrollByDistance).not.toHaveBeenCalled();
  });

  it('历史图表标签和 K 线共用同一原生时间点，不注册手势追踪循环', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.2)]}
        symbol="HIFIUSDT"
        rawSymbol="HIFIUSDT"
        analysisMode
        analysisAnnotations={{
          verticalLines: [{
            time: 1000,
            color: '#3B82F6',
            label: '主力开始',
          }],
        }}
      />,
    );

    await waitFor(() => expect(getBandOverlay()).toBeDefined());
    expect(getBandOverlay()?.points).toEqual([{ timestamp: 1000, value: 1.2 }]);
    expect(mocks.chart.subscribeAction).not.toHaveBeenCalledWith('onZoom', expect.any(Function));
    expect(mocks.chart.subscribeAction).not.toHaveBeenCalledWith('onScroll', expect.any(Function));
  });

  it('旧战役的非整周期事件会绑定到最近的真实 K 线时间戳', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.1), candle(3000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          markers: [{
            time: 2400,
            price: 1.1,
            color: '#0ECB81',
            shape: 'triangle-up',
            label: 'A1',
          }],
        }}
      />,
    );

    await waitFor(() => {
      const markerOverlay = mocks.chart.createOverlay.mock.calls
        .map(([overlay]) => overlay)
        .find(overlay => overlay.name === 'simpleAnnotation');
      expect(markerOverlay?.points?.[0]).toEqual(expect.objectContaining({
        timestamp: 2000,
      }));
      expect(getBandOverlay()?.points?.[0]).toEqual({ timestamp: 2000, value: 1.2 });
    });
  });

  it('旧战役首尾未变但中间时间轴修正时会整段重载并重新绑定标注', async () => {
    const annotations = {
      markers: [{
        time: 2400,
        price: 1.1,
        color: '#0ECB81',
        shape: 'triangle-up' as const,
        label: 'A1',
      }],
    };
    const { rerender } = render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.1), candle(3000, 1.2)]}
        symbol="HIFIUSDT"
        rawSymbol="HIFIUSDT"
        analysisMode
        analysisAnnotations={annotations}
      />,
    );

    await waitFor(() => {
      const markerOverlay = mocks.chart.createOverlay.mock.calls
        .map(([overlay]) => overlay)
        .find(overlay => overlay.name === 'simpleAnnotation');
      expect(markerOverlay?.points?.[0]?.timestamp).toBe(2000);
    });

    mocks.chart.applyNewData.mockClear();
    mocks.chart.createOverlay.mockClear();
    rerender(
      <CandlestickChart
        data={[candle(1000, 1), candle(2500, 1.1), candle(3000, 1.2)]}
        symbol="HIFIUSDT"
        rawSymbol="HIFIUSDT"
        analysisMode
        analysisAnnotations={annotations}
      />,
    );

    await waitFor(() => {
      expect(mocks.chart.applyNewData).toHaveBeenCalled();
      const markerOverlay = mocks.chart.createOverlay.mock.calls
        .map(([overlay]) => overlay)
        .find(overlay => overlay.name === 'simpleAnnotation');
      expect(markerOverlay?.points?.[0]?.timestamp).toBe(2500);
    });
    expect(mocks.chart.getDataList().map(item => item.timestamp)).toEqual([1000, 2500, 3000]);
  });

  it('历史 K 线异步载入完成后再统一自适应并重绘原生盘面', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.1), candle(3000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisFitAll
      />,
    );

    const dataReadyCallbacks = mocks.chart.subscribeAction.mock.calls
      .filter(([type]) => type === 'onDataReady')
      .map(([, callback]) => callback);
    expect(dataReadyCallbacks.length).toBeGreaterThan(0);
    act(() => {
      dataReadyCallbacks.forEach(callback => callback());
    });

    await waitFor(() => {
      expect(mocks.chart.setBarSpace).toHaveBeenCalled();
      expect(mocks.chart.scrollByDistance).toHaveBeenCalledWith(0, 0);
    });
  });

  it('长历史数据原生提交完成后会按同一时间戳重建标注层', async () => {
    const data = Array.from({ length: 2400 }, (_, index) => candle(index * 60_000, 1 + index / 10_000));
    render(
      <CandlestickChart
        data={data}
        symbol="HIFIUSDT"
        rawSymbol="HIFIUSDT"
        analysisMode
        analysisAnnotations={{
          markers: [{
            time: 90_001,
            price: 1.1,
            color: '#0ECB81',
            shape: 'triangle-up',
            label: 'M',
          }],
        }}
      />,
    );

    await waitFor(() => {
      expect(mocks.chart.createOverlay.mock.calls.some(([overlay]) => overlay.name === 'simpleAnnotation')).toBe(true);
    });
    mocks.chart.createOverlay.mockClear();

    const dataReadyCallbacks = mocks.chart.subscribeAction.mock.calls
      .filter(([type]) => type === 'onDataReady')
      .map(([, callback]) => callback);
    act(() => {
      dataReadyCallbacks.forEach(callback => callback());
    });

    await waitFor(() => {
      const markerOverlay = mocks.chart.createOverlay.mock.calls
        .map(([overlay]) => overlay)
        .find(overlay => overlay.name === 'simpleAnnotation');
      expect(markerOverlay?.points?.[0]).toEqual({
        timestamp: 120_000,
        value: 1.1,
      });
    });
  });

  it('历史 K 线原生时间轴尚未提交时不提前创建屏幕脱钩标注', async () => {
    let nativeReady = false;
    mocks.chart.getDataList.mockImplementation(() => nativeReady ? mocks.dataList : []);
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.1), candle(3000, 1.2)]}
        symbol="HIFIUSDT"
        rawSymbol="HIFIUSDT"
        analysisMode
        analysisAnnotations={{
          markers: [{
            time: 2400,
            price: 1.1,
            color: '#0ECB81',
            shape: 'triangle-up',
            label: 'A1',
          }],
        }}
      />,
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(mocks.chart.createOverlay.mock.calls.some(([overlay]) => overlay.name === 'simpleAnnotation')).toBe(false);

    nativeReady = true;
    const dataReadyCallbacks = mocks.chart.subscribeAction.mock.calls
      .filter(([type]) => type === 'onDataReady')
      .map(([, callback]) => callback);
    act(() => dataReadyCallbacks.forEach(callback => callback()));

    await waitFor(() => {
      const markerOverlay = mocks.chart.createOverlay.mock.calls
        .map(([overlay]) => overlay)
        .find(overlay => overlay.name === 'simpleAnnotation');
      expect(markerOverlay?.points?.[0]).toEqual({ timestamp: 2000, value: 1.1 });
    });
  });

  it('预载五十一倍数据时把指定三倍区间铺满，并让持仓段位于默认视口正中', async () => {
    const data = Array.from({ length: 100 }, (_, index) => candle(index * 1000, 1 + index / 100));
    mocks.chart.convertToPixel.mockImplementation((point: any) => {
      const value = Array.isArray(point) ? point[0] : point;
      if (value?.timestamp === 29_500) return { x: 987.5, y: 0 };
      return { x: 0, y: 0 };
    });
    render(
      <CandlestickChart
        data={data}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisFitAll
        analysisVisibleStartTime={10_000}
        analysisVisibleEndTime={49_000}
      />,
    );

    const dataReadyCallbacks = mocks.chart.subscribeAction.mock.calls
      .filter(([type]) => type === 'onDataReady')
      .map(([, callback]) => callback);
    act(() => {
      dataReadyCallbacks.forEach(callback => callback());
    });

    await waitFor(() => {
      expect(mocks.chart.setBarSpace).toHaveBeenCalledWith(25);
      expect(mocks.chart.setOffsetRightDistance).toHaveBeenCalledWith(0);
      expect(mocks.chart.scrollToTimestamp).toHaveBeenCalledWith(29_500, 0);
      expect(mocks.chart.scrollByDistance).toHaveBeenCalledWith(-487.5, 0);
    });
  });

  it('历史数据等价重渲染不会覆盖用户已经完成的平移或缩放视窗', async () => {
    const initialData = Array.from({ length: 100 }, (_, index) => candle(index * 1000, 1 + index / 100));
    const stableAnnotations = {
      verticalLines: [{ time: 20_000, color: '#3B82F6', label: '主力开始' }],
    };
    const { rerender } = render(
      <CandlestickChart
        data={initialData}
        symbol="HIFIUSDT"
        rawSymbol="HIFIUSDT"
        analysisMode
        analysisFitAll
        analysisAnnotations={stableAnnotations}
        analysisVisibleStartTime={10_000}
        analysisVisibleEndTime={49_000}
      />,
    );

    await waitFor(() => expect(mocks.chart.setBarSpace).toHaveBeenCalled());
    mocks.chart.setBarSpace.mockClear();
    mocks.chart.setOffsetRightDistance.mockClear();
    mocks.chart.scrollToTimestamp.mockClear();
    mocks.chart.scrollByDistance.mockClear();

    rerender(
      <CandlestickChart
        data={initialData.map(item => ({ ...item }))}
        symbol="HIFIUSDT"
        rawSymbol="HIFIUSDT"
        analysisMode
        analysisFitAll
        analysisAnnotations={stableAnnotations}
        analysisVisibleStartTime={10_000}
        analysisVisibleEndTime={49_000}
      />,
    );

    await act(async () => Promise.resolve());
    expect(mocks.chart.setBarSpace).not.toHaveBeenCalled();
    expect(mocks.chart.setOffsetRightDistance).not.toHaveBeenCalled();
    expect(mocks.chart.scrollToTimestamp).not.toHaveBeenCalled();
    expect(mocks.chart.scrollByDistance).not.toHaveBeenCalled();
  });

  it('委托空撤单结束点显示 ×，并带对应撤单竖线', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          timeBoundPriceLines: [
            {
              startTime: 1000,
              endTime: 2000,
              price: 1.1,
              color: '#F0B90B',
              title: '委托空',
              dashed: true,
              endMarker: 'x',
            },
          ],
        }}
      />,
    );

    await waitFor(() => expect(getBandOverlay()).toBeDefined());

    const labelTexts = getBandLabelTexts();
    expect(labelTexts).toContain('委托空');
    expect(labelTexts).toContain('×');

    const overlays = mocks.chart.createOverlay.mock.calls.map(([overlay]) => overlay);
    const startVertical = overlays.find(
      overlay => overlay.name === 'verticalStraightLine' && overlay.points?.[0]?.timestamp === 1000,
    );
    const cancelVertical = overlays.find(
      overlay => overlay.name === 'verticalStraightLine' && overlay.points?.[0]?.timestamp === 2000,
    );
    expect(startVertical).toMatchObject({
      points: [{ timestamp: 1000, value: 1.1 }],
      styles: {
        line: {
          style: 'dashed',
          color: '#F0B90B66',
          size: 0.75,
        },
      },
    });
    expect(cancelVertical).toMatchObject({
      points: [{ timestamp: 2000, value: 1.1 }],
      styles: {
        line: {
          style: 'dashed',
          color: '#F0B90B88',
          size: 0.75,
        },
      },
    });
  });

  it('同一时间重复的委托空标注和竖线会合并为一个', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          timeBoundPriceLines: [
            {
              startTime: 1000,
              endTime: 2000,
              price: 1.1,
              color: '#F0B90B',
              title: '委托空',
              dashed: true,
            },
            {
              startTime: 1000,
              endTime: 2000,
              price: 1.15,
              color: '#F0B90B',
              title: '委托空',
              dashed: true,
            },
          ],
        }}
      />,
    );

    await waitFor(() => expect(getBandOverlay()).toBeDefined());

    const labelTexts = getBandLabelTexts();
    expect(labelTexts.filter(text => text === '委托空')).toHaveLength(1);

    const overlays = mocks.chart.createOverlay.mock.calls.map(([overlay]) => overlay);
    const reverseOrderVerticals = overlays.filter(
      overlay => overlay.name === 'verticalStraightLine' && overlay.styles?.line?.color === '#F0B90B66',
    );
    expect(reverseOrderVerticals).toHaveLength(1);
  });

  it('加仓标注颜色更重且加粗，普通标注保持更小字号', async () => {
    render(
      <CandlestickChart
        data={[candle(1000, 1), candle(2000, 1.2)]}
        symbol="BTCUSDT"
        rawSymbol="BTCUSDT"
        analysisMode
        analysisAnnotations={{
          verticalLines: [
            {
              time: 1000,
              color: '#0ECB81',
              label: '加仓1·开仓',
              dashed: false,
            },
          ],
          markers: [
            {
              time: 1000,
              price: 1,
              color: '#0ECB81',
              shape: 'triangle-up',
              label: 'A1',
            },
            {
              time: 2000,
              price: 1.2,
              color: '#F0B90B',
              shape: 'square',
              label: 'TP',
            },
          ],
        }}
      />,
    );

    await waitFor(() => expect(getBandLabelTexts().some((label: string) => label.includes('A1'))).toBe(true));

    const bandOverlay = getBandOverlay();
    const labelTexts = getBandLabelTexts();
    expect(labelTexts).not.toContain('加仓1·开仓');
    const figures = createAnalysisBandLabelFigures({
      overlay: bandOverlay,
      coordinates: bandOverlay.points.map((_point: any, index: number) => ({ x: 100 + index * 200, y: 0 })),
      bounding: { width: 1000, height: 520 },
    } as any);
    const addLabel = figures.find(figure => figure.attrs.text.includes('A1'));
    const normalLabel = figures.find(figure => figure.attrs.text.includes('TP'));
    expect(addLabel?.styles?.weight).toBe(800);
    expect(addLabel?.styles?.size).toBe(8);
    expect(normalLabel?.styles?.size).toBe(7);

    const overlays = mocks.chart.createOverlay.mock.calls.map(([overlay]) => overlay);
    const addMarkerOverlay = overlays.find(
      overlay => overlay.name === 'simpleAnnotation' && overlay.points?.[0]?.timestamp === 1000,
    );
    expect(addMarkerOverlay?.styles?.text).toMatchObject({
      size: 10,
      backgroundColor: '#008F5A',
    });
  });

  it('为反事实手动 Legs 创建可拖动时间竖线，并在拖动后回传新时间', async () => {
    const handleDrag = vi.fn();
    const handleSelect = vi.fn();

    render(
      <TooltipProvider>
        <CandlestickChart
          data={[candle(1000, 1), candle(2000, 1.2)]}
          symbol="BTCUSDT"
          rawSymbol="BTCUSDT"
          draggableVerticalLines={[
            {
              id: 'leg-1:open',
              time: 1000,
              color: '#002FA7',
              dashed: false,
              label: '主力·开仓',
              labelColor: 'rgba(0,47,167,0.84)',
            },
            {
              id: 'leg-1:close',
              time: 2000,
              color: '#3B0764',
              dashed: true,
              label: '主力·平仓',
              labelColor: 'rgba(54,24,91,0.84)',
            },
          ]}
          onDragVerticalLine={handleDrag}
          onSelectVerticalLine={handleSelect}
        />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(mocks.chart.createOverlay).toHaveBeenCalled();
    });

    const overlays = mocks.chart.createOverlay.mock.calls.map(([overlay]) => overlay);
    const dragTimeOverlays = overlays.filter(overlay => String(overlay.id ?? '').startsWith('whatif_drag_time_'));
    expect(dragTimeOverlays).toHaveLength(2);
    expect(dragTimeOverlays[0]).toMatchObject({
      name: 'verticalStraightLine',
      paneId: 'candle_pane',
      lock: false,
      extendData: '',
      styles: {
        line: {
          style: 'solid',
          color: '#002FA7',
          size: 0.85,
        },
      },
    });
    expect(dragTimeOverlays[1]).toMatchObject({
      name: 'verticalStraightLine',
      lock: false,
      extendData: '',
      styles: {
        line: {
          style: 'dashed',
          color: '#3B0764',
        },
      },
    });

    const dragLabelOverlays = overlays.filter(overlay => String(overlay.id ?? '').startsWith('whatif_drag_label_'));
    expect(dragLabelOverlays).toHaveLength(2);
    expect(dragLabelOverlays[0]).toMatchObject({
      name: 'simpleAnnotation',
      paneId: 'candle_pane',
      lock: true,
      extendData: '主力·开仓',
      styles: {
        text: {
          color: 'rgba(0,47,167,0.84)',
          size: 7,
          backgroundColor: 'rgba(11, 14, 17, 0.26)',
        },
        point: { color: 'rgba(0,0,0,0)' },
      },
    });
    expect(dragLabelOverlays[1]).toMatchObject({
      name: 'simpleAnnotation',
      extendData: '主力·平仓',
      styles: {
        text: {
          color: 'rgba(54,24,91,0.84)',
        },
      },
    });

    dragTimeOverlays[0].onClick?.();
    expect(handleSelect).toHaveBeenCalledWith('leg-1:open');
    dragTimeOverlays[0].onSelected?.();
    expect(handleSelect).toHaveBeenCalledWith('leg-1:open');
    dragTimeOverlays[1].onPressedMoveStart?.();
    expect(handleSelect).toHaveBeenCalledWith('leg-1:close');

    dragTimeOverlays[0].onPressedMoveEnd?.({
      overlay: { points: [{ timestamp: 1500 }] },
    });
    expect(handleDrag).toHaveBeenCalledWith('leg-1:open', 1500);
    expect(handleSelect).toHaveBeenCalledWith('leg-1:open');
  });
});

describe('layoutAnalysisFloatingLabels', () => {
  it('同一时间的多个事件完整保留，并分配到不重叠的像素行', () => {
    const labels = layoutAnalysisFloatingLabels(
      ['主力开始', 'TP', 'M 全平', '委托空', '×'].map((text, index) => ({
        id: `event-${index}`,
        time: 1000,
        text,
        color: '#F0B90B',
      })),
      { minTime: 900, maxTime: 1100, width: 420 },
    );

    expect(labels).toHaveLength(5);
    expect(labels.map(label => label.text)).toEqual(['主力开始', 'TP', 'M 全平', '委托空', '×']);
    expect(new Set(labels.map(label => label.left))).toHaveLength(1);
    expect(new Set(labels.map(label => label.width))).toHaveLength(1);

    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        expect(labelsOverlap(labels[i], labels[j])).toBe(false);
      }
    }
  });

  it('相近时间的标签也会横向避让，不因价格轴压缩而重叠', () => {
    const labels = layoutAnalysisFloatingLabels(
      [
        { id: 'a', time: 1000, text: '▲ A1', color: '#22C55E' },
        { id: 'b', time: 1001, text: '■ TP', color: '#EAB308' },
        { id: 'c', time: 1002, text: '● M 减仓 50%', color: '#22C55E' },
        { id: 'd', time: 1020, text: '▼ Hr1', color: '#60A5FA' },
      ],
      { minTime: 1000, maxTime: 1020, width: 360 },
    );

    expect(labels).toHaveLength(4);
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        expect(labelsOverlap(labels[i], labels[j])).toBe(false);
      }
    }
  });
});
