import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import type { AnalysisChartAnnotations } from '@/components/CandlestickChart';
import type { KlineData } from '@/hooks/useBinanceData';

const mocks = vi.hoisted(() => ({
  annotations: [] as AnalysisChartAnnotations[],
  visibleRanges: [] as Array<{ start: number | null | undefined; end: number | null | undefined }>,
  datasets: [] as KlineData[][],
}));

vi.mock('@/components/CandlestickChart', () => ({
  CandlestickChart: (props: {
    data: KlineData[];
    analysisAnnotations?: AnalysisChartAnnotations;
    analysisVisibleStartTime?: number | null;
    analysisVisibleEndTime?: number | null;
  }) => {
    if (props.analysisAnnotations) mocks.annotations.push(props.analysisAnnotations);
    mocks.datasets.push(props.data);
    mocks.visibleRanges.push({
      start: props.analysisVisibleStartTime,
      end: props.analysisVisibleEndTime,
    });
    return <div data-testid="mock-candlestick-chart" />;
  },
}));

function candle(time: number): KlineData {
  return {
    time,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 1,
  };
}

describe('ReplayKlineChart annotations', () => {
  beforeEach(() => {
    mocks.annotations.length = 0;
    mocks.visibleRanges.length = 0;
    mocks.datasets.length = 0;
  });

  it('用户手动标注的 leg 竖线会越过回放时间过滤，普通未来竖线仍隐藏', async () => {
    render(
      <ReplayKlineChart
        klines={[candle(1000), candle(2000), candle(3000), candle(4000)]}
        currentTime={1500}
        intervalMs={1000}
        symbol="BTCUSDT"
        verticalLines={[
          { time: 3000, color: '#002FA7', alwaysVisible: true, label: '主力·平仓' },
          { time: 4000, color: '#F0B90B', label: '未来普通线' },
        ]}
        fitAll
      />,
    );

    await waitFor(() => {
      expect(mocks.annotations.length).toBeGreaterThan(0);
    });

    const latest = mocks.annotations.at(-1);
    expect(latest?.verticalLines?.some(line => line.time === 3000 && line.label === '主力·平仓')).toBe(true);
    expect(latest?.verticalLines?.some(line => line.time === 3000 && line.alwaysVisible === true)).toBe(true);
    expect(latest?.verticalLines?.some(line => line.time === 4000 && line.label === '未来普通线')).toBe(false);
  });

  it('仅激活默认视口附近 K 线，同时把时间范围透传给初始视口', async () => {
    render(
      <ReplayKlineChart
        klines={Array.from({ length: 1000 }, (_, index) => candle(index * 1000))}
        currentTime={999_000}
        intervalMs={1000}
        symbol="BTCUSDT"
        fitAll
        initialVisibleStartTime={400_000}
        initialVisibleEndTime={500_000}
      />,
    );

    await waitFor(() => expect(mocks.visibleRanges.length).toBeGreaterThan(0));
    expect(mocks.visibleRanges.at(-1)).toEqual({ start: 400_000, end: 500_000 });
    expect(mocks.datasets.at(-1)?.length).toBe(341);
    expect(mocks.datasets.at(-1)?.[0].time).toBe(280_000);
    expect(mocks.datasets.at(-1)?.at(-1)?.time).toBe(620_000);
  });

  it('传给主图的旧战役 K 线时间轴始终严格递增且不重复', async () => {
    render(
      <ReplayKlineChart
        klines={[candle(3000), candle(1000), candle(2000), { ...candle(2000), close: 7 }]}
        currentTime={3000}
        intervalMs={1000}
        symbol="HIFIUSDT"
        fitAll
      />,
    );

    await waitFor(() => expect(mocks.datasets.length).toBeGreaterThan(0));
    expect(mocks.datasets.at(-1)?.map(item => item.time)).toEqual([1000, 2000, 3000]);
    expect(mocks.datasets.at(-1)?.[1].close).toBe(7);
  });
});
