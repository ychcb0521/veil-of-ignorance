import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCampaignKlineTimeWindow, buildCampaignKlineVisibleRange } from '@/hooks/useCampaignKlines';
import type { TradeCampaign } from '@/types/journal';
import { CampaignWhatIfEditor } from '../CampaignWhatIfEditor';

const { replayVisibleRanges, replayChartProps, buildManualLegsKlines } = vi.hoisted(() => ({
  replayVisibleRanges: [] as Array<{ start: number; end: number }>,
  replayChartProps: [] as Array<{ klines: unknown[]; intervalMs: number }>,
  buildManualLegsKlines: [] as unknown[][],
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: (props: { initialVisibleStartTime: number; initialVisibleEndTime: number; klines: unknown[]; intervalMs: number }) => {
    replayVisibleRanges.push({
      start: props.initialVisibleStartTime,
      end: props.initialVisibleEndTime,
    });
    replayChartProps.push({ klines: props.klines, intervalMs: props.intervalMs });
    return <div data-testid="counterfactual-chart" />;
  },
}));

vi.mock('@/lib/campaignSimulationEngine', () => ({
  buildActualSimulationParams: () => ({
    entry: {
      time: '2026-01-02T00:30:00.000Z',
      price: 100,
      size_usdt: 1_000,
      direction: 'long',
      leverage: 1,
    },
    hedge_a: { offset_pct: 1, size_pct: 50 },
    hedge_b: { offset_pct: 2, size_pct: 50 },
    mirror_tp: { offset_pct: 1, size_pct: 50 },
    rolling: {
      enabled: false,
      trigger_rise_pct: 0,
      min_interval_minutes: 0,
      new_hedge_offset_pct: 0,
      rolling_hedge_size_pct: 0,
    },
    exit_rule: 'manual_only',
  }),
  buildPureSopParams: () => null,
  buildManualLegs: (_params: unknown, _legs: unknown, klines: unknown[]) => {
    buildManualLegsKlines.push(klines);
    return [];
  },
}));

const campaign: TradeCampaign = {
  id: 'campaign-1',
  user_id: 'user-1',
  campaign_code: 'C-CAMPAIGN1',
  symbol: 'BTCUSDT',
  direction: 'main_long',
  status: 'closed_profit',
  strategy_template: 'custom',
  title: 'BTCUSDT campaign',
  opened_at: '2026-01-02T00:30:00.000Z',
  closed_at: '2026-01-02T02:30:00.000Z',
  initial_main_size_usdt: 1_000,
  initial_leverage: 1,
  final_realized_pnl: 100,
  final_r_multiple: null,
  peak_unrealized_pnl: null,
  peak_drawdown: null,
  importance_weight: 0,
  notes: null,
  actual_evolution: [],
  deviation_notes: {},
  deleted_at: null,
  created_at: '2026-01-02T00:30:00.000Z',
  updated_at: '2026-01-02T02:30:00.000Z',
};

const timeWindow = buildCampaignKlineTimeWindow(
  Date.parse('2026-01-02T00:30:00.000Z'),
  Date.parse('2026-01-02T02:30:00.000Z'),
  Date.parse('2026-01-02T00:30:00.000Z'),
  Date.parse('2026-01-02T02:30:00.000Z'),
);

describe('CampaignWhatIfEditor K-line range', () => {
  beforeEach(() => {
    replayVisibleRanges.length = 0;
    replayChartProps.length = 0;
    buildManualLegsKlines.length = 0;
  });

  it('defaults to 1.1x and shares the original campaign range presets through 51x', async () => {
    render(
      <CampaignWhatIfEditor
        campaign={campaign}
        legs={[]}
        tradeRecords={[]}
        legExitPriceCorrections={{}}
        klines={[
          { time: timeWindow.fromTime, open: 100, high: 101, low: 99, close: 100, volume: 1 },
          { time: timeWindow.toTime, open: 100, high: 101, low: 99, close: 100, volume: 1 },
        ]}
        klinesLoading={false}
        interval="5m"
        intervalOptions={['1m', '5m', '15m', '1h']}
        onIntervalChange={vi.fn()}
        klineTimeWindow={timeWindow}
        timezone="Asia/Shanghai"
        whatIfRunning={false}
        onRunWhatIf={vi.fn()}
      />,
    );

    const defaultButton = screen.getByRole('button', { name: '反事实盘面显示 1.1 倍战役时间范围' });
    expect(defaultButton).toHaveAttribute('aria-pressed', 'true');
    // 【用户要求】与原始盘面同一组档位：1.1 / 2.1 / 3.1 / 5 … 51；旧的 2 倍、3 倍不再出现
    for (const multiplier of [1.1, 2.1, 3.1, 5, 11, 21, 31, 41, 51]) {
      expect(screen.getByRole('button', {
        name: `反事实盘面显示 ${multiplier} 倍战役时间范围`,
      })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '反事实盘面显示 2.1 倍战役时间范围' })).toHaveTextContent('2.1x');
    expect(screen.getByRole('button', { name: '反事实盘面显示 3.1 倍战役时间范围' })).toHaveTextContent('3.1x');
    for (const legacy of [2, 3]) {
      expect(screen.queryByRole('button', { name: `反事实盘面显示 ${legacy} 倍战役时间范围` })).not.toBeInTheDocument();
    }
    const defaultRange = buildCampaignKlineVisibleRange(timeWindow, 1.1);
    await waitFor(() => expect(replayVisibleRanges.at(-1)).toEqual({
      start: defaultRange.fromTime,
      end: defaultRange.toTime,
    }));

    fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 51 倍战役时间范围' }));
    await waitFor(() => expect(replayVisibleRanges.at(-1)).toEqual({
      start: timeWindow.fromTime,
      end: timeWindow.toTime,
    }));
    expect(screen.getByRole('button', {
      name: '反事实盘面显示 51 倍战役时间范围',
    })).toHaveAttribute('aria-pressed', 'true');
  });

  it('计算与显示分开：副本基线读计算用 K 线，反事实盘面画显示用 K 线（周期按显示周期）', async () => {
    const computeKlines = [
      { time: timeWindow.fromTime, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { time: timeWindow.fromTime + 60_000, open: 100, high: 102, low: 98, close: 101, volume: 1 },
    ];
    const chartKlines = [
      { time: timeWindow.fromTime, open: 100, high: 105, low: 95, close: 102, volume: 5 },
    ];
    render(
      <CampaignWhatIfEditor
        campaign={campaign}
        legs={[]}
        tradeRecords={[]}
        legExitPriceCorrections={{}}
        klines={computeKlines}
        klinesLoading={false}
        chartKlines={chartKlines}
        chartKlinesLoading={false}
        interval="15m"
        intervalHint="默认 5 分钟线，放不下时自动放宽"
        intervalOptions={['1m', '5m', '15m', '1h']}
        onIntervalChange={vi.fn()}
        klineTimeWindow={timeWindow}
        timezone="Asia/Shanghai"
        whatIfRunning={false}
        onRunWhatIf={vi.fn()}
      />,
    );
    await waitFor(() => expect(replayChartProps.length).toBeGreaterThan(0));
    expect(replayChartProps.at(-1)!.klines).toBe(chartKlines);
    expect(replayChartProps.at(-1)!.intervalMs).toBe(15 * 60_000);
    expect(buildManualLegsKlines.length).toBeGreaterThan(0);
    for (const klines of buildManualLegsKlines) expect(klines).toBe(computeKlines);
    // 周期按钮选中态 = 显示周期，悬停提示写明默认规则
    const active = screen.getByRole('button', { name: '15m' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active).toHaveAttribute('title', '默认 5 分钟线，放不下时自动放宽');
  });

  it('显示用 K 线加载失败：反事实盘面显示错误与重试，副本基线照旧读计算用 K 线', async () => {
    const onRetry = vi.fn();
    const computeKlines = [{ time: timeWindow.fromTime, open: 100, high: 101, low: 99, close: 100, volume: 1 }];
    render(
      <CampaignWhatIfEditor
        campaign={campaign}
        legs={[]}
        tradeRecords={[]}
        legExitPriceCorrections={{}}
        klines={computeKlines}
        klinesLoading={false}
        chartKlines={[]}
        chartKlinesLoading={false}
        chartKlinesError="API 429"
        onRetryChartKlines={onRetry}
        interval="5m"
        klineTimeWindow={timeWindow}
        whatIfRunning={false}
        onRunWhatIf={vi.fn()}
      />,
    );
    const section = screen.getByTestId('counterfactual-chart-section');
    expect(section).toHaveTextContent('K 线加载失败：API 429');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(replayChartProps).toHaveLength(0);
    expect(buildManualLegsKlines.length).toBeGreaterThan(0);
    for (const klines of buildManualLegsKlines) expect(klines).toBe(computeKlines);
  });

  it('倍数可由详情页接管：按 viewMultiplier 显示，点档位回报给 onViewMultiplierChange（详情页据此选反事实盘面的周期）', async () => {
    const onViewMultiplierChange = vi.fn();
    const props = {
      campaign,
      legs: [],
      tradeRecords: [],
      legExitPriceCorrections: {},
      klines: [{ time: timeWindow.fromTime, open: 100, high: 101, low: 99, close: 100, volume: 1 }],
      klinesLoading: false,
      interval: '15m',
      intervalHint: (item: string) => (item === '15m' ? '当前视窗放不下 5 分钟线，已自动放宽到 15 分钟。默认 5 分钟线' : '默认 5 分钟线'),
      intervalOptions: ['1m', '5m', '15m', '1h'],
      onIntervalChange: vi.fn(),
      klineTimeWindow: timeWindow,
      timezone: 'Asia/Shanghai',
      whatIfRunning: false,
      onRunWhatIf: vi.fn(),
      onViewMultiplierChange,
    };
    const { rerender } = render(<CampaignWhatIfEditor {...props} viewMultiplier={5} />);
    expect(screen.getByRole('button', { name: '反事实盘面显示 5 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
    const range5 = buildCampaignKlineVisibleRange(timeWindow, 5);
    await waitFor(() => expect(replayVisibleRanges.at(-1)).toEqual({ start: range5.fromTime, end: range5.toTime }));
    fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 51 倍战役时间范围' }));
    expect(onViewMultiplierChange).toHaveBeenLastCalledWith(51);
    rerender(<CampaignWhatIfEditor {...props} viewMultiplier={51} />);
    expect(screen.getByRole('button', { name: '反事实盘面显示 51 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
    // 周期按钮的悬停提示可以逐个给（选中的那个写明为什么放宽）
    expect(screen.getByRole('button', { name: '15m' })).toHaveAttribute('title', '当前视窗放不下 5 分钟线，已自动放宽到 15 分钟。默认 5 分钟线');
    expect(screen.getByRole('button', { name: '5m' })).toHaveAttribute('title', '默认 5 分钟线');
  });

  it('窄屏：周期组与倍数组之间的竖分隔线隐藏（两组折成两行后它会挂在第一行末尾，与原始盘面工具栏同一写法）', () => {
    render(
      <CampaignWhatIfEditor
        campaign={campaign}
        legs={[]}
        tradeRecords={[]}
        legExitPriceCorrections={{}}
        klines={[{ time: timeWindow.fromTime, open: 100, high: 101, low: 99, close: 100, volume: 1 }]}
        klinesLoading={false}
        interval="5m"
        intervalOptions={['1m', '5m', '15m', '1h']}
        onIntervalChange={vi.fn()}
        klineTimeWindow={timeWindow}
        timezone="Asia/Shanghai"
        whatIfRunning={false}
        onRunWhatIf={vi.fn()}
      />,
    );
    const separator = screen.getByRole('group', { name: '反事实盘面 K 线周期' }).nextElementSibling;
    expect(separator).toHaveClass('h-4', 'w-px', 'max-sm:hidden');
    expect(separator?.nextElementSibling).toHaveAttribute('aria-label', '反事实 K 线显示范围');
  });
});
