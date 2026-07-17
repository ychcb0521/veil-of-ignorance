import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import JournalCampaignsPage from '../JournalCampaignsPage';

const { mockUser, mockListDeletedCampaigns, mockRestoreCampaign, mockPermanentlyDeleteCampaign } = vi.hoisted(() => ({
  mockUser: { id: 'user-1' },
  mockListDeletedCampaigns: vi.fn(async () => []),
  mockRestoreCampaign: vi.fn(async () => undefined),
  mockPermanentlyDeleteCampaign: vi.fn(async () => undefined),
}));

const campaigns: TradeCampaign[] = [
  makeCampaign({
    id: 'high-importance',
    title: 'High Importance',
    opened_at: '2026-01-01T00:00:00.000Z',
    closed_at: '2026-01-02T00:00:00.000Z',
    initial_main_size_usdt: 100,
    final_realized_pnl: 10,
    importance_weight: 5,
  }),
  makeCampaign({
    id: 'newest',
    title: 'Newest Operation',
    opened_at: '2026-03-01T00:00:00.000Z',
    closed_at: '2026-03-02T00:00:00.000Z',
    initial_main_size_usdt: 1000,
    final_realized_pnl: 50,
    importance_weight: 1,
  }),
  makeCampaign({
    id: 'best-pnl',
    title: 'Best PnL',
    opened_at: '2026-02-01T00:00:00.000Z',
    closed_at: '2026-02-02T00:00:00.000Z',
    initial_main_size_usdt: 100000,
    final_realized_pnl: 1000,
    importance_weight: 0,
  }),
  makeCampaign({
    id: 'late-close',
    title: 'Late Close',
    status: 'closed_loss',
    opened_at: '2025-12-01T00:00:00.000Z',
    closed_at: '2026-04-01T00:00:00.000Z',
    initial_main_size_usdt: 50,
    final_realized_pnl: -20,
    importance_weight: 2,
  }),
];

const deletedCampaign = makeCampaign({
  id: 'deleted-campaign',
  title: 'Deleted Campaign',
  opened_at: '2025-11-01T00:00:00.000Z',
  closed_at: '2025-11-02T00:00:00.000Z',
  deleted_at: '2026-07-17T03:00:00.000Z',
});

const legsByCampaign: Record<string, TradeJournal[]> = {
  'high-importance': [
    makeLeg({
      id: 'high-importance-leg',
      trade_record_id: 'high-importance-record',
      pre_real_time: '2026-04-03T00:00:00.000Z',
      post_real_close_time: '2025-12-01T00:00:00.000Z',
    }),
  ],
  newest: [
    makeLeg({
      id: 'newest-leg',
      trade_record_id: 'newest-record',
      pre_real_time: '2026-01-10T00:00:00.000Z',
      post_real_close_time: '2026-12-01T00:00:00.000Z',
    }),
  ],
  'best-pnl': [
    makeLeg({
      id: 'best-pnl-leg',
      trade_record_id: 'best-pnl-record',
      pre_real_time: '2026-03-02T00:00:00.000Z',
    }),
    makeLeg({
      id: 'best-pnl-hedge',
      leg_role: 'hedge_initial_a',
      pre_entry_price: 98,
    }),
  ],
  'late-close': [
    makeLeg({
      id: 'late-close-leg',
      trade_record_id: 'late-close-record',
      pre_real_time: '2026-02-01T00:00:00.000Z',
    }),
    makeLeg({
      id: 'late-close-hedge',
      leg_role: 'hedge_initial_a',
      pre_entry_price: 50,
    }),
  ],
};

const reverseOrdersByCampaign = {
  'high-importance': [
    { id: 'high-importance-hedge', side: 'SHORT', price: 90, createdAt: 1, status: 'pending' as const },
  ],
};

const tradeHistory: TradeRecord[] = [
  makeRecord('high-importance-record', '2026-04-03T00:00:00.000Z', 1),
  makeRecord('newest-record', '2026-01-10T00:00:00.000Z', 10),
  makeRecord('best-pnl-record', '2026-03-02T00:00:00.000Z', 1_000),
  makeRecord('late-close-record', '2026-02-01T00:00:00.000Z', 0.5),
];

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

vi.mock('@/lib/journalApi', () => ({
  deleteCampaign: vi.fn(),
  getCampaignFullData: vi.fn(async (id: string) => ({
    campaign: [...campaigns, deletedCampaign].find(campaign => campaign.id === id),
    legs: legsByCampaign[id] ?? [],
    tradeRecords: tradeHistory.filter(record => (legsByCampaign[id] ?? []).some(leg => leg.trade_record_id === record.id)),
    pendingOrders: [],
    reverseHedgeOrders: reverseOrdersByCampaign[id as keyof typeof reverseOrdersByCampaign] ?? [],
  })),
  listAllCampaigns: vi.fn(async () => campaigns),
  listDeletedCampaigns: mockListDeletedCampaigns,
  listVisibleCampaigns: vi.fn(async () => []),
  permanentlyDeleteCampaign: mockPermanentlyDeleteCampaign,
  restoreCampaign: mockRestoreCampaign,
  updateCampaignImportance: vi.fn(async (_id: string, weight: number) => weight),
}));

function makeRecord(id: string, objectiveTime: string, quantity: number): TradeRecord {
  return {
    id,
    symbol: 'BTCUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 100,
    exitPrice: 110,
    quantity,
    leverage: 1,
    pnl: 10,
    fee: 0,
    slippage: 0,
    openTime: Date.parse('2025-01-01T00:00:00.000Z'),
    closeTime: Date.parse('2025-01-01T01:00:00.000Z'),
    closedRealAt: Date.parse(objectiveTime),
  };
}

function makeCampaign(overrides: Partial<TradeCampaign>): TradeCampaign {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: overrides.id ?? 'campaign',
    user_id: 'user-1',
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: overrides.status ?? 'closed_profit',
    strategy_template: 'custom',
    title: overrides.title ?? 'Campaign',
    opened_at: overrides.opened_at ?? now,
    closed_at: overrides.closed_at ?? null,
    initial_main_size_usdt: overrides.initial_main_size_usdt ?? null,
    initial_leverage: null,
    final_realized_pnl: overrides.final_realized_pnl ?? null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: overrides.importance_weight ?? 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: overrides.deleted_at ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

function makeLeg(overrides: Partial<TradeJournal>): TradeJournal {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: overrides.id ?? 'leg',
    user_id: 'user-1',
    trade_record_id: overrides.trade_record_id ?? null,
    campaign_id: overrides.campaign_id ?? null,
    leg_role: overrides.leg_role ?? 'main_open',
    leg_sequence: null,
    source: 'post_review',
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: null,
    position_mode: null,
    order_kind: 'main',
    pre_simulated_time: overrides.pre_simulated_time ?? now,
    pre_real_time: overrides.pre_real_time ?? now,
    pre_entry_price: overrides.pre_entry_price ?? null,
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
    expect(screen.getAllByTestId('campaign-operation-time').map(node => node.textContent)).toEqual([
      '操作时间：2026-04-03 08:00',
      '操作时间：2026-03-02 08:00',
      '操作时间：2026-02-01 08:00',
      '操作时间：2026-01-10 08:00',
    ]);
    expect(screen.getAllByTestId('campaign-payoff-ratio').map(node => node.textContent)).toEqual([
      '盈亏比：100.00%（1.00）',
      '盈亏比：50.00%（0.50）',
      '盈亏比：-80.00%（-0.80）',
      '盈亏比：—',
    ]);
    expect(screen.queryByText(/峰值浮盈/)).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-label', '操作时间，从大到小排序');
    expect(screen.getByTestId('campaign-win-rate')).toHaveTextContent('胜率（75.00%）');
    expect(screen.getByTestId('campaign-win-rate')).toHaveAttribute(
      'aria-label',
      '盈利战役 3 场，亏损战役 1 场，胜率 75.00%',
    );
    fireEvent.click(screen.getByTestId('campaign-win-rate'));
    expect(screen.getByText('胜率计算公式')).toBeInTheDocument();
    expect(screen.getByText('P(赢) = 盈利战役数 ÷（盈利战役数 + 亏损战役数）')).toBeInTheDocument();
    expect(screen.getByText('= 3 ÷（3 + 1）')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-win-rate'));
    expect(screen.getByTestId('campaign-average-payoff-ratio')).toHaveTextContent('平均盈亏比（0.23）');
    expect(screen.getByTestId('campaign-average-payoff-ratio')).toHaveAttribute(
      'aria-label',
      '平均盈亏比 0.23，共 3 场战役',
    );
    fireEvent.click(screen.getByTestId('campaign-average-payoff-ratio'));
    expect(screen.getByText('平均盈亏比计算公式')).toBeInTheDocument();
    expect(screen.getByText('b̄ = Σ 单场盈亏比 bᵢ ÷ 有效战役数 N')).toBeInTheDocument();
    expect(screen.getByText('= 0.70 ÷ 3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-average-payoff-ratio'));
    expect(screen.getByTestId('campaign-expected-value')).toHaveTextContent('期望值（-0.18R）');
    fireEvent.click(screen.getByTestId('campaign-expected-value'));
    expect(screen.getByText('E = P(赢) × b − (1 − P(赢))')).toBeInTheDocument();
    expect(screen.getByText('= -0.18R')).toBeInTheDocument();
    expect(screen.getByText('P(赢) 仅统计设置了最大预期亏损的有效战役')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '互关可见' }));
    await waitFor(() => expect(screen.getByTestId('campaign-win-rate')).toHaveTextContent('胜率（—）'));
    expect(screen.getByTestId('campaign-average-payoff-ratio')).toHaveTextContent('平均盈亏比（—）');
    expect(screen.getByTestId('campaign-expected-value')).toHaveTextContent('期望值（—）');
    fireEvent.click(screen.getByRole('button', { name: '我的战役' }));
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
    expect(screen.getByTestId('campaign-win-rate')).toHaveTextContent('胜率（75.00%）');
    expect(screen.getByTestId('campaign-average-payoff-ratio')).toHaveTextContent('平均盈亏比（0.23）');
    expect(screen.getByTestId('campaign-expected-value')).toHaveTextContent('期望值（-0.18R）');

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

    expect(screen.queryByTestId('campaign-sort-pnl')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-sort-pnlPct')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('campaign-sort-captureRate'));
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveTextContent('盈亏比');
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('aria-label', '盈亏比，从大到小排序');
    expect(screen.getByText('单场盈亏比计算公式')).toBeInTheDocument();
    expect(screen.getByText('bᵢ = 已实现盈亏ᵢ ÷ 初始最大预期亏损ᵢ')).toBeInTheDocument();
    expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Late Close']);

    fireEvent.click(screen.getByTestId('campaign-sort-captureRate'));
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('aria-label', '盈亏比，从小到大排序');
    expect(cardOrder()).toEqual(['Late Close', 'Best PnL', 'High Importance']);

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

  it('opens the subtle deleted-campaign entry and restores a campaign', async () => {
    mockListDeletedCampaigns.mockResolvedValue([deletedCampaign]);

    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <JournalCampaignsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
    await waitFor(() => expect(screen.getByTestId('deleted-campaigns-entry')).toHaveTextContent('1'));
    fireEvent.click(screen.getByTestId('deleted-campaigns-entry'));

    expect(await screen.findByText('Deleted Campaign')).toBeInTheDocument();
    expect(screen.getByText('删除于 2026-07-17 11:00')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('restore-campaign-deleted-campaign'));
    await waitFor(() => expect(mockRestoreCampaign).toHaveBeenCalledWith('deleted-campaign'));
    await waitFor(() => expect(screen.queryByTestId('deleted-campaign-row')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(5));
  });
});
