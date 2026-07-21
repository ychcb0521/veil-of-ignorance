import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCampaignKlineTimeWindow } from '@/hooks/useCampaignKlines';
import type { TradeCampaign } from '@/types/journal';
import { CampaignWhatIfEditor } from '../CampaignWhatIfEditor';

const { replayVisibleRanges } = vi.hoisted(() => ({
  replayVisibleRanges: [] as Array<{ start: number; end: number }>,
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: (props: { initialVisibleStartTime: number; initialVisibleEndTime: number }) => {
    replayVisibleRanges.push({
      start: props.initialVisibleStartTime,
      end: props.initialVisibleEndTime,
    });
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
  buildManualLegs: () => [],
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
  });

  it('defaults to 1x and shares the original campaign range presets through 51x', async () => {
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

    const button1x = screen.getByRole('button', { name: '反事实盘面显示 1 倍战役时间范围' });
    expect(button1x).toHaveAttribute('aria-pressed', 'true');
    for (const multiplier of [1, 2, 3, 5, 11, 21, 31, 41, 51]) {
      expect(screen.getByRole('button', {
        name: `反事实盘面显示 ${multiplier} 倍战役时间范围`,
      })).toBeInTheDocument();
    }
    await waitFor(() => expect(replayVisibleRanges.at(-1)).toEqual({
      start: timeWindow.contentStartMs,
      end: timeWindow.contentEndMs,
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
});
