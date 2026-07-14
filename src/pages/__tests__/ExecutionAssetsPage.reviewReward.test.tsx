import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExecutionAssetsPage from '../ExecutionAssetsPage';

const {
  mockReconcileCampaignRewards,
  mockReconcilePostTradeReviewRewards,
  mockSettleCampaignMissingPenalties,
  mockReconcileReviewMissingPenalties,
  mockListAllCampaigns,
  mockListJournals,
} = vi.hoisted(() => ({
  mockReconcileCampaignRewards: vi.fn(),
  mockReconcilePostTradeReviewRewards: vi.fn(),
  mockSettleCampaignMissingPenalties: vi.fn(),
  mockReconcileReviewMissingPenalties: vi.fn(),
  mockListAllCampaigns: vi.fn(async () => [{
    id: 'campaign-1',
    symbol: 'BTCUSDT',
    created_at: '2026-07-10T00:00:00.000Z',
  }]),
  mockListJournals: vi.fn(async () => [{
    id: 'journal-1',
    post_reviewed_at: '2026-07-11T08:00:00.000Z',
  }]),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    executionAsset: {
      points: 2265,
      decisionTradeCount: 0,
      directTradeCount: 0,
      campaignCount: 1,
      reviewCount: 1,
      penaltyDays: 0,
      tradedDates: {},
      lastDailyCheckDate: '2026-07-11',
      events: [{
        id: 'review-event-1',
        type: 'review_reward',
        points: 666,
        date: '2026-07-11',
        createdAt: Date.parse('2026-07-11T08:00:00.000Z'),
        label: '完成平仓评价奖励',
        journalId: 'journal-1',
      }, {
        id: 'direct-event-1',
        type: 'direct_reward',
        points: 99,
        date: '2026-07-12',
        createdAt: Date.parse('2026-07-12T02:00:00.000Z'),
        label: '直接交易奖励',
      }, {
        id: 'campaign-event-1',
        type: 'campaign_reward',
        points: 1500,
        date: '2026-07-13',
        createdAt: Date.parse('2026-07-13T02:00:00.000Z'),
        label: '创建交易战役奖励',
        campaignId: 'campaign-1',
      }],
      rewardedCampaignIds: ['campaign-1'],
      rewardedReviewJournalIds: ['journal-1'],
    },
    tradeHistory: [],
    reconcileCampaignRewards: mockReconcileCampaignRewards,
    reconcilePostTradeReviewRewards: mockReconcilePostTradeReviewRewards,
    settleCampaignMissingPenalties: mockSettleCampaignMissingPenalties,
    reconcileReviewMissingPenalties: mockReconcileReviewMissingPenalties,
  }),
}));

vi.mock('@/lib/journalApi', () => ({
  backfillJournalFromRecord: vi.fn(),
  listAllCampaigns: mockListAllCampaigns,
  listJournals: mockListJournals,
  listJournalsByTradeRecordId: vi.fn(async () => []),
}));

describe('ExecutionAssetsPage review reward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles completed reviews and exposes the +666 detail panel', async () => {
    render(
      <MemoryRouter>
        <ExecutionAssetsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockReconcilePostTradeReviewRewards).toHaveBeenCalledWith([{
      journalId: 'journal-1',
      reviewedAt: '2026-07-11T08:00:00.000Z',
    }]));
    expect(mockReconcileCampaignRewards).toHaveBeenCalledWith([{
      id: 'campaign-1',
      createdAt: '2026-07-10T00:00:00.000Z',
    }]);

    expect(Array.from(screen.getByTestId('execution-rule-grid').children).map(card => (
      card.textContent?.replace(/\s+/g, '')
    ))).toEqual([
      // 三对镜像（做 vs 不做，同额反号）+ 独立一档的「未练习 −2000」
      '完成平仓评价+1000',
      '决策记录交易+600',
      '创建交易战役+300',
      '未做平仓评价-1000',
      '直接交易（每标的）-600',
      '标的未建战役（每标的）-300',
      '自然日未练习-2000',
    ]);

    await waitFor(() => {
      const recentEvents = Array.from(screen.getByTestId('recent-execution-events').children);
      expect(recentEvents[0]).toHaveTextContent('直接交易奖励');
      expect(recentEvents[0]).toHaveTextContent('操作时间 2026-07-12 10:00:00');
      expect(recentEvents[1]).toHaveTextContent('完成平仓评价奖励');
      expect(recentEvents[1]).toHaveTextContent('操作时间 2026-07-11 16:00:00');
      expect(recentEvents[2]).toHaveTextContent('创建交易战役奖励');
      expect(recentEvents[2]).toHaveTextContent('操作时间 2026-07-10 08:00:00');
    });

    const reviewCard = screen.getByText('平仓评价').closest('button');
    expect(reviewCard).not.toBeNull();
    fireEvent.click(reviewCard!);

    expect(screen.getByText('平仓评价明细')).toBeInTheDocument();
    expect(screen.getAllByText('完成平仓评价奖励').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('+666').length).toBeGreaterThanOrEqual(1);
  });

  it('opens the corresponding campaign when its reward score is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/execution-assets']}>
        <Routes>
          <Route path="/execution-assets" element={<ExecutionAssetsPage />} />
          <Route path="/journal/campaigns/:campaignId" element={<div>已进入对应交易战役</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const campaignEvent = await waitFor(() => {
      const item = document.querySelector('[data-event-id="campaign-event-1"]');
      expect(item).not.toBeNull();
      expect(within(item as HTMLElement).getByRole('button')).toHaveAttribute(
        'title',
        '点击进入对应的交易战役',
      );
      return item as HTMLElement;
    });

    fireEvent.click(within(campaignEvent).getByText('+1,500'));
    expect(await screen.findByText('已进入对应交易战役')).toBeInTheDocument();
  });
});
