import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandlestickChart } from '@/components/CandlestickChart';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { KlineData } from '@/hooks/useBinanceData';
import { FLOATING_LABEL_HEIGHT, layoutAnalysisFloatingLabels } from '@/lib/analysisFloatingLabels';

const mocks = vi.hoisted(() => {
  const chart = {
    resize: vi.fn(),
    subscribeAction: vi.fn(),
    unsubscribeAction: vi.fn(),
    setStyles: vi.fn(),
    setPriceVolumePrecision: vi.fn(),
    applyNewData: vi.fn(),
    applyMoreData: vi.fn(),
    updateData: vi.fn(),
    createOverlay: vi.fn(),
    removeOverlay: vi.fn(),
    getSize: vi.fn(() => ({ width: 1000, height: 520 })),
    getDataList: vi.fn(() => []),
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
    init: vi.fn(() => chart),
    dispose: vi.fn(),
    registerIndicator: vi.fn(),
  };
});

vi.mock('klinecharts', () => ({
  init: mocks.init,
  dispose: mocks.dispose,
  registerIndicator: mocks.registerIndicator,
  CandleType: { CandleSolid: 'candle_solid' },
  LineType: { Dashed: 'dashed', Solid: 'solid' },
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

describe('CandlestickChart analysis annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mocks.chart.subscribeAction).toHaveBeenCalledWith('onScroll', expect.any(Function));
    expect(mocks.chart.subscribeAction).toHaveBeenCalledWith('onZoom', expect.any(Function));
    expect(mocks.chart.subscribeAction).toHaveBeenCalledWith('onVisibleRangeChange', expect.any(Function));
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
      { timestamp: 1000, dataIndex: 0, value: 1 },
      { timestamp: 1000, dataIndex: 0, value: 1.005 },
    ]);
  });

  it('图表滚动或缩放后，先重绘 K 线画布，再按当前坐标重新定位浮层标注', async () => {
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

    await waitFor(() => {
      expect(document.querySelector('[data-analysis-label]')).not.toBeNull();
    });
    const before = (document.querySelector('[data-analysis-label]') as HTMLElement).style.left;
    const zoomCallback = mocks.chart.subscribeAction.mock.calls.find(([type]) => type === 'onZoom')?.[1];
    expect(zoomCallback).toEqual(expect.any(Function));

    mocks.chart.convertToPixel.mockImplementation(() => ({ x: 260, y: 0 }));
    zoomCallback?.();

    await waitFor(() => {
      expect(mocks.chart.scrollByDistance).toHaveBeenCalledWith(0, 0);
      expect((document.querySelector('[data-analysis-label]') as HTMLElement).style.left).not.toEqual(before);
    });
  });

  it('旧战役的非整周期事件会绑定到最近的真实 K 线索引', async () => {
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
        dataIndex: 1,
      }));
      expect(mocks.chart.convertToPixel).toHaveBeenCalledWith(
        expect.objectContaining({ dataIndex: 1 }),
        { paneId: 'candle_pane' },
      );
    });
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
    dataReadyCallbacks.forEach(callback => callback());

    await waitFor(() => {
      expect(mocks.chart.setBarSpace).toHaveBeenCalled();
      expect(mocks.chart.scrollByDistance).toHaveBeenCalledWith(0, 0);
    });
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

    await waitFor(() => {
      expect(document.querySelector('[data-analysis-label]')).not.toBeNull();
    });

    const labelTexts = Array.from(document.querySelectorAll('[data-analysis-label]')).map((label) => label.textContent);
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

    await waitFor(() => {
      expect(document.querySelector('[data-analysis-label]')).not.toBeNull();
    });

    const labelTexts = Array.from(document.querySelectorAll('[data-analysis-label]')).map((label) => label.textContent);
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

    await waitFor(() => {
      expect(Array.from(document.querySelectorAll('[data-analysis-label]')).some(label => label.textContent?.includes('A1'))).toBe(true);
    });

    const labels = Array.from(document.querySelectorAll('[data-analysis-label]')) as HTMLElement[];
    const addLabel = labels.find(label => label.textContent?.includes('A1'));
    const normalLabel = labels.find(label => label.textContent?.includes('TP'));
    const labelTexts = labels.map(label => label.textContent);
    expect(labelTexts).not.toContain('加仓1·开仓');
    expect(addLabel?.style.fontWeight).toBe('800');
    expect(addLabel?.style.fontSize).toBe('8px');
    expect(normalLabel?.style.fontSize).toBe('7px');

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
