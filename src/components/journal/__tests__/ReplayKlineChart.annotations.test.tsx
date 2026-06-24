import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import type { AnalysisChartAnnotations } from '@/components/CandlestickChart';
import type { KlineData } from '@/hooks/useBinanceData';

const mocks = vi.hoisted(() => ({
  annotations: [] as AnalysisChartAnnotations[],
}));

vi.mock('@/components/CandlestickChart', () => ({
  CandlestickChart: (props: { analysisAnnotations?: AnalysisChartAnnotations }) => {
    if (props.analysisAnnotations) mocks.annotations.push(props.analysisAnnotations);
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
});
