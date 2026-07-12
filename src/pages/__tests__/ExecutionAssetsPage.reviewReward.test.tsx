import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExecutionAssetsPage from '../ExecutionAssetsPage';

const {
  mockReconcileCampaignRewards,
  mockReconcilePostTradeReviewRewards,
  mockListAllCampaigns,
  mockListJournals,
} = vi.hoisted(() => ({
  mockReconcileCampaignRewards: vi.fn(),
  mockReconcilePostTradeReviewRewards: vi.fn(),
  mockListAllCampaigns: vi.fn(async () => []),
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
      points: 666,
      decisionTradeCount: 0,
      directTradeCount: 0,
      campaignCount: 0,
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
      }],
      rewardedCampaignIds: [],
      rewardedReviewJournalIds: ['journal-1'],
    },
    tradeHistory: [],
    reconcileCampaignRewards: mockReconcileCampaignRewards,
    reconcilePostTradeReviewRewards: mockReconcilePostTradeReviewRewards,
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

    const reviewCard = screen.getByText('平仓评价').closest('button');
    expect(reviewCard).not.toBeNull();
    fireEvent.click(reviewCard!);

    expect(screen.getByText('平仓评价明细')).toBeInTheDocument();
    expect(screen.getAllByText('完成平仓评价奖励').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('+666').length).toBeGreaterThanOrEqual(1);
  });
});
