import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

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

vi.mock('@/hooks/useCampaignKlines', () => ({
  buildCampaignKlineTimeWindow: () => ({
    fromTime: Date.parse('2025-12-31T23:00:00.000Z'),
    toTime: Date.parse('2026-01-01T02:00:00.000Z'),
  }),
  useCampaignKlines: () => ({
    klines: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    fromTime: Date.parse('2025-12-31T23:00:00.000Z'),
    toTime: Date.parse('2026-01-01T02:00:00.000Z'),
  }),
}));

vi.mock('@/lib/journalApi', () => ({
  getCampaignFullData: vi.fn(async (id: string) => detailsById[id]),
  listAllCampaigns: vi.fn(async () => campaigns),
  listVisibleCampaigns: vi.fn(async () => campaigns),
  listCounterfactuals: vi.fn(async () => []),
  listCampaignComments: vi.fn(async () => []),
  hasMutualFollow: vi.fn(async () => true),
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: () => <div data-testid="campaign-chart" />,
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/CampaignWhatIfEditor', () => ({ CampaignWhatIfEditor: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));

describe('JournalCampaignDetailPage metrics', () => {
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
    expect(screen.getByText('+0.50R')).toBeInTheDocument();
    expect(screen.getByText('+0.5%/笔')).toBeInTheDocument();
    expect(screen.getByText(/2 场有效战役，实时胜率 50.00%/)).toBeInTheDocument();
  });
});
