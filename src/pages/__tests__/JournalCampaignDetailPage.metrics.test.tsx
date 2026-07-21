import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignBoardExportInput } from '@/lib/campaignLegsPngExport';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

const scrollToMock = vi.fn();
const { exportCampaignBoardPngMock, replayVisibleRanges } = vi.hoisted(() => ({
  exportCampaignBoardPngMock: vi.fn(async (_input: CampaignBoardExportInput) => 'BTCUSDT campaign.png'),
  replayVisibleRanges: [] as Array<{ start: number; end: number }>,
}));

beforeEach(() => {
  scrollToMock.mockClear();
  exportCampaignBoardPngMock.mockClear();
  replayVisibleRanges.length = 0;
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    writable: true,
    value: scrollToMock,
  });
});

const { campaigns, detailsById } = vi.hoisted(() => {
  const makeCampaign = (
    id: string,
    status: TradeCampaign['status'],
    realizedPnl: number,
  ): TradeCampaign => ({
    id,
    user_id: 'user-1',
    campaign_code: `C-${id}`,
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status,
    strategy_template: 'custom',
    title: `${id} campaign`,
    opened_at: '2026-01-01T00:00:00.000Z',
    closed_at: '2026-01-01T01:00:00.000Z',
    initial_main_size_usdt: 1_000,
    initial_leverage: 1,
    final_realized_pnl: realizedPnl,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T01:00:00.000Z',
  });
  const makeLegs = (campaignId: string): TradeJournal[] => ([
    {
      id: `${campaignId}-main`,
      user_id: 'user-1',
      campaign_id: campaignId,
      trade_record_id: null,
      leg_role: 'main_open',
      source: 'post_review',
      symbol: 'BTCUSDT',
      direction: 'long',
      order_kind: 'main',
      pre_simulated_time: '2026-01-01T00:00:00.000Z',
      pre_real_time: '2026-07-19T10:00:00.000Z',
      pre_entry_price: 100,
      pre_position_size: 1_000,
      pre_account_equity_usdt: 10_000,
      post_simulated_close_time: '2026-01-01T01:00:00.000Z',
      post_real_close_time: '2026-07-19T11:00:00.000Z',
      post_realized_pnl: null,
    } as TradeJournal,
    {
      id: `${campaignId}-hedge-a`,
      user_id: 'user-1',
      campaign_id: campaignId,
      trade_record_id: null,
      leg_role: 'hedge_initial_a',
      source: 'post_review',
      symbol: 'BTCUSDT',
      direction: 'short',
      order_kind: 'hedge',
      pre_simulated_time: '2026-01-01T00:01:00.000Z',
      pre_real_time: '2026-07-19T10:01:00.000Z',
      pre_entry_price: 90,
      pre_position_size: 1_000,
      post_simulated_close_time: '2026-01-01T01:00:00.000Z',
      post_real_close_time: '2026-07-19T11:00:00.000Z',
      post_realized_pnl: null,
    } as TradeJournal,
  ]);

  const rows = [
    makeCampaign('winner', 'closed_profit', 200),
    makeCampaign('loser', 'closed_loss', -100),
  ];
  return {
    campaigns: rows,
    detailsById: Object.fromEntries(rows.map(campaign => [campaign.id, {
      campaign,
      legs: makeLegs(campaign.id),
      tradeRecords: [],
      pendingOrders: [],
      reverseHedgeOrders: [],
    }])),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    getEffectiveTime: () => Date.parse('2026-01-01T01:00:00.000Z'),
    balance: 10_000,
    positionsMap: {},
    priceMap: {},
  }),
}));

vi.mock('@/hooks/useCampaignKlines', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useCampaignKlines')>();
  return {
    ...actual,
    buildCampaignKlineTimeWindow: () => ({
      fromTime: Date.parse('2025-12-31T07:30:00.000Z'),
      toTime: Date.parse('2026-01-01T17:30:00.000Z'),
      defaultFromTime: Date.parse('2025-12-31T23:30:00.000Z'),
      defaultToTime: Date.parse('2026-01-01T01:30:00.000Z'),
      contentStartMs: Date.parse('2026-01-01T00:10:00.000Z'),
      contentEndMs: Date.parse('2026-01-01T00:50:00.000Z'),
      contextMs: 40 * 60_000,
      availableContextMs: 1_000 * 60_000,
    }),
    useCampaignKlines: () => ({
      klines: [{
        time: Date.parse('2026-01-01T00:00:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      }],
      loading: false,
      error: null,
      reload: vi.fn(),
      fromTime: Date.parse('2025-12-31T07:30:00.000Z'),
      toTime: Date.parse('2026-01-01T17:30:00.000Z'),
    }),
  };
});

vi.mock('@/lib/journalApi', () => ({
  getCampaignFullData: vi.fn(async (id: string) => detailsById[id]),
  listAllCampaigns: vi.fn(async () => campaigns),
  listVisibleCampaigns: vi.fn(async () => campaigns),
  listCounterfactuals: vi.fn(async () => []),
  listCampaignComments: vi.fn(async () => []),
  hasMutualFollow: vi.fn(async () => true),
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: (props: { initialVisibleStartTime: number; initialVisibleEndTime: number }) => {
    replayVisibleRanges.push({
      start: props.initialVisibleStartTime,
      end: props.initialVisibleEndTime,
    });
    return <div data-testid="campaign-chart" />;
  },
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/CampaignWhatIfEditor', () => ({ CampaignWhatIfEditor: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));
vi.mock('@/lib/campaignLegsPngExport', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegsPngExport')>();
  return {
    ...actual,
    exportCampaignBoardPng: exportCampaignBoardPngMock,
  };
});

function ListLocationProbe() {
  const location = useLocation();
  return <div data-testid="list-location-probe">{location.pathname}{location.search}</div>;
}

describe('JournalCampaignDetailPage metrics', () => {
  it('defaults to 3x and jumps to the selected centered K-line range', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button3x = await screen.findByRole('button', { name: '显示 3 倍战役时间范围' });
    expect(button3x).toHaveAttribute('aria-pressed', 'true');
    for (const multiplier of [2, 3, 5, 11, 21, 31, 41, 51]) {
      expect(screen.getByRole('button', { name: `显示 ${multiplier} 倍战役时间范围` })).toBeInTheDocument();
    }
    await waitFor(() => expect(replayVisibleRanges.at(-1)).toEqual({
      start: Date.parse('2025-12-31T23:30:00.000Z'),
      end: Date.parse('2026-01-01T01:30:00.000Z'),
    }));

    fireEvent.click(screen.getByRole('button', { name: '显示 51 倍战役时间范围' }));
    await waitFor(() => expect(replayVisibleRanges.at(-1)).toEqual({
      start: Date.parse('2025-12-31T07:30:00.000Z'),
      end: Date.parse('2026-01-01T17:30:00.000Z'),
    }));
    expect(screen.getByRole('button', { name: '显示 51 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
  }, 10_000);

  it('returns to the exact campaign-list history state when opened from the list', async () => {
    const listLocation = '/journal/campaigns?scope=own&sort=opportunityQuality&direction=asc';
    render(
      <MemoryRouter
        initialEntries={[
          listLocation,
          {
            pathname: '/journal/campaigns/winner',
            search: '?scope=own&sort=opportunityQuality&direction=asc',
            state: { fromCampaignList: true },
          },
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/journal/campaigns" element={<ListLocationProbe />} />
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    await waitFor(() => expect(screen.getByText('winner campaign')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '返回进入前的交易战役列表' }));
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(listLocation);
  });

  it('shows the same payoff, opportunity-quality and expectancy metrics as the campaign list', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('机会质量')).toBeInTheDocument());
    expect(screen.getByText('200.0%（2.00）')).toBeInTheDocument();
    expect(screen.getByText('0.20')).toBeInTheDocument();
    // 算术/几何期望与实时胜率依赖异步加载的 campaignPerformance（同账户有效战役），需等它落定。
    await waitFor(() => expect(screen.getByText('+0.50R')).toBeInTheDocument());
    expect(screen.getByText('+0.5%/笔')).toBeInTheDocument();
    expect(screen.getByText(/2 场有效战役，实时胜率 50.00%/)).toBeInTheDocument();

    for (const label of [
      '已实现 P&L',
      '峰值浮盈',
      '最大回撤',
      '最大预期亏损',
      '预期最大回撤百分比',
      '盈亏比',
      '机会质量',
      '算术期望',
      '几何期望',
    ]) {
      expect(screen.getByRole('button', { name: `${label}说明` })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: '机会质量说明' }));
    expect(await screen.findByText(/Q = 实际盈亏比 b ÷ 预期最大回撤百分点 d/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
    await waitFor(() => expect(exportCampaignBoardPngMock).toHaveBeenCalledTimes(1));
    const exportInput = exportCampaignBoardPngMock.mock.calls[0][0];
    expect(exportInput.pnlOverview.items.map(item => item.label)).toEqual([
      '已实现 P&L',
      '峰值浮盈',
      '最大回撤',
      '最大预期亏损',
      '预期最大回撤百分比',
      '盈亏比',
      '机会质量',
      '算术期望',
      '几何期望',
    ]);
    expect(exportInput.pnlOverview.note).toContain('2 场有效战役，实时胜率 50.00%');
  });
});
