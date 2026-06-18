import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandlestickChart } from '@/components/CandlestickChart';
import type { KlineData } from '@/hooks/useBinanceData';

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
    getBarSpace: vi.fn(() => 8),
    setBarSpace: vi.fn(),
    setOffsetRightDistance: vi.fn(),
    scrollToTimestamp: vi.fn(),
    convertFromPixel: vi.fn(),
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
  TooltipShowRule: { FollowCross: 'follow_cross' },
  TooltipShowType: { Standard: 'standard' },
}));

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

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
  });
});
