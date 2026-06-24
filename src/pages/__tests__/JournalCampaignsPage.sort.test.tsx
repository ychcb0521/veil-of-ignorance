import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import JournalCampaignsPage from '../JournalCampaignsPage';

const { mockUser } = vi.hoisted(() => ({
  mockUser: { id: 'user-1' },
}));

const campaigns: TradeCampaign[] = [
  makeCampaign({
    id: 'high-importance',
    title: 'High Importance',
    opened_at: '2026-01-01T00:00:00.000Z',
    closed_at: '2026-01-02T00:00:00.000Z',
    final_realized_pnl: 10,
    importance_weight: 5,
  }),
  makeCampaign({
    id: 'newest',
    title: 'Newest Operation',
    opened_at: '2026-03-01T00:00:00.000Z',
    closed_at: '2026-03-02T00:00:00.000Z',
    final_realized_pnl: 50,
    importance_weight: 1,
  }),
  makeCampaign({
    id: 'best-pnl',
    title: 'Best PnL',
    opened_at: '2026-02-01T00:00:00.000Z',
    closed_at: '2026-02-02T00:00:00.000Z',
    final_realized_pnl: 1000,
    importance_weight: 0,
  }),
  makeCampaign({
    id: 'late-close',
    title: 'Late Close',
    opened_at: '2025-12-01T00:00:00.000Z',
    closed_at: '2026-04-01T00:00:00.000Z',
    final_realized_pnl: 20,
    importance_weight: 2,
  }),
];

const legsByCampaign: Record<string, TradeJournal[]> = {
  'high-importance': [
    makeLeg({
      id: 'high-importance-leg',
      pre_real_time: '2026-04-03T00:00:00.000Z',
    }),
  ],
  newest: [
    makeLeg({
      id: 'newest-leg',
      pre_real_time: '2026-01-10T00:00:00.000Z',
    }),
  ],
  'best-pnl': [
    makeLeg({
      id: 'best-pnl-leg',
      pre_real_time: '2026-03-02T00:00:00.000Z',
    }),
  ],
  'late-close': [
    makeLeg({
      id: 'late-close-leg',
      pre_real_time: '2026-02-01T00:00:00.000Z',
    }),
  ],
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

vi.mock('@/lib/journalApi', () => ({
  deleteCampaign: vi.fn(),
  getCampaignWithLegs: vi.fn(async (id: string) => ({
    campaign: campaigns.find(campaign => campaign.id === id),
    legs: legsByCampaign[id] ?? [],
  })),
  listAllCampaigns: vi.fn(async () => campaigns),
  listVisibleCampaigns: vi.fn(async () => []),
  updateCampaignImportance: vi.fn(async (_id: string, weight: number) => weight),
}));

function makeCampaign(overrides: Partial<TradeCampaign>): TradeCampaign {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: overrides.id ?? 'campaign',
    user_id: 'user-1',
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: overrides.title ?? 'Campaign',
    opened_at: overrides.opened_at ?? now,
    closed_at: overrides.closed_at ?? null,
    initial_main_size_usdt: null,
    initial_leverage: null,
    final_realized_pnl: overrides.final_realized_pnl ?? null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: overrides.importance_weight ?? 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

function makeLeg(overrides: Partial<TradeJournal>): TradeJournal {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: overrides.id ?? 'leg',
    user_id: 'user-1',
    trade_record_id: null,
    campaign_id: overrides.campaign_id ?? null,
    leg_role: 'main_open',
    leg_sequence: null,
    source: 'post_review',
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: null,
    position_mode: null,
    order_kind: 'main',
    pre_simulated_time: overrides.pre_simulated_time ?? now,
    pre_real_time: overrides.pre_real_time ?? now,
    pre_entry_price: null,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: null,
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: null,
    pre_max_loss_usdt: null,
    post_outcome: null,
    post_realized_pnl: null,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    post_real_close_time: overrides.post_real_close_time ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  } as TradeJournal;
}

function cardOrder(): string[] {
  return screen.getAllByTestId('campaign-card').map(card => {
    const text = card.textContent ?? '';
    return campaigns.find(campaign => text.includes(campaign.title))?.title ?? '';
  });
}

describe('JournalCampaignsPage sorting', () => {
  it('defaults to operation time and toggles sort direction for each field', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <JournalCampaignsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));

    expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Late Close', 'Newest Operation']);
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-label', '操作时间，从大到小排序');

    fireEvent.click(screen.getByTestId('campaign-sort-time'));
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-label', '操作时间，从小到大排序');
    expect(cardOrder()).toEqual(['Newest Operation', 'Late Close', 'Best PnL', 'High Importance']);

    fireEvent.click(screen.getByTestId('campaign-sort-importance'));
    expect(screen.getByTestId('campaign-sort-importance')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-importance')).toHaveAttribute('data-sort-direction', 'desc');
    expect(cardOrder()).toEqual(['High Importance', 'Late Close', 'Newest Operation', 'Best PnL']);

    fireEvent.click(screen.getByTestId('campaign-sort-importance'));
    expect(screen.getByTestId('campaign-sort-importance')).toHaveAttribute('data-sort-direction', 'asc');
    expect(cardOrder()).toEqual(['Best PnL', 'Newest Operation', 'Late Close', 'High Importance']);

    fireEvent.click(screen.getByTestId('campaign-sort-time'));
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('data-sort-direction', 'desc');
    expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Late Close', 'Newest Operation']);

    fireEvent.click(screen.getByTestId('campaign-sort-pnl'));
    expect(screen.getByTestId('campaign-sort-pnl')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-pnl')).toHaveAttribute('data-sort-direction', 'desc');
    expect(cardOrder()).toEqual(['Best PnL', 'Newest Operation', 'Late Close', 'High Importance']);

    fireEvent.click(screen.getByTestId('campaign-sort-pnl'));
    expect(screen.getByTestId('campaign-sort-pnl')).toHaveAttribute('data-sort-direction', 'asc');
    expect(cardOrder()).toEqual(['High Importance', 'Late Close', 'Newest Operation', 'Best PnL']);

    fireEvent.click(screen.getByTestId('campaign-sort-alpha'));
    expect(screen.getByTestId('campaign-sort-alpha')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-alpha')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-alpha')).toHaveAttribute('aria-label', '字母，A 到 Z排序');
    expect(cardOrder()).toEqual(['Best PnL', 'High Importance', 'Late Close', 'Newest Operation']);

    fireEvent.click(screen.getByTestId('campaign-sort-alpha'));
    expect(screen.getByTestId('campaign-sort-alpha')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-alpha')).toHaveAttribute('aria-label', '字母，Z 到 A排序');
    expect(cardOrder()).toEqual(['Newest Operation', 'Late Close', 'High Importance', 'Best PnL']);
  });
});
