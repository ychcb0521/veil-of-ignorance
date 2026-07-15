import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExecutionAssetsPage from '../ExecutionAssetsPage';

const {
  mockReconcileCampaignRewards,
  mockReconcilePostTradeReviewRewards,
  mockSettleCampaignMissingPenalties,
  mockReconcileReviewMissingPenalties,
  mockListAllCampaigns,
  mockListJournals,
  mockListJournalsByTradeRecordId,
  mockTradeHistory,
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
    journal_kind: 'trade',
    order_kind: 'main',
    direction: 'long',
    symbol: 'BTCUSDT',
    trade_record_id: 'record-1',
    post_reviewed_at: '2026-07-11T08:00:00.000Z',
  }]),
  mockListJournalsByTradeRecordId: vi.fn(async () => [{
    id: 'journal-direct',
    post_reviewed_at: null,
  }]),
  mockTradeHistory: [{
    id: 'record-1',
    symbol: 'BTCUSDT',
    action: 'CLOSE',
    side: 'LONG',
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    contracts: 1,
    pnl: 10,
    fee: 0,
    openTime: Date.parse('2026-07-12T01:00:00.000Z'),
    closeTime: Date.parse('2026-07-12T03:00:00.000Z'),
    closedRealAt: Date.parse('2026-06-22T04:05:06.000Z'),
  }],
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
        id: 'review-missing-event-1',
        type: 'review_missing_penalty',
        points: -1000,
        date: '2026-07-09',
        createdAt: Date.parse('2026-07-14T08:00:00.000Z'),
        operationTime: Date.parse('2026-07-09T08:00:00.000Z'),
        label: '未做平仓评价扣分',
        journalId: 'journal-missing',
        reviewSymbol: 'ETHUSDT',
      }, {
        id: 'direct-event-1',
        type: 'direct_reward',
        points: 99,
        date: '2026-07-12',
        createdAt: Date.parse('2026-07-12T02:00:00.000Z'),
        label: '直接交易奖励',
        trade: {
          symbol: 'BTCUSDT',
          side: 'LONG',
          orderType: 'MARKET',
          entryPrice: 100,
          quantity: 1,
          leverage: 1,
          marginMode: 'cross',
          simulatedTime: Date.parse('2026-07-12T01:00:00.000Z'),
        },
      }, {
        id: 'campaign-event-1',
        type: 'campaign_reward',
        points: 1500,
        date: '2026-07-13',
        createdAt: Date.parse('2026-07-13T02:00:00.000Z'),
        label: '创建交易战役奖励',
        campaignId: 'campaign-1',
      }, {
        id: 'no-trade-event-1',
        type: 'no_trade_penalty',
        points: -2000,
        date: '2026-07-08',
        createdAt: Date.parse('2026-07-09T00:00:00.000Z'),
        label: '2026-07-08 未练习，执行力资产扣分',
      }, {
        id: 'campaign-missing-event-1',
        type: 'campaign_missing_penalty',
        points: -300,
        date: '2026-07-07',
        createdAt: Date.parse('2026-07-08T00:00:00.000Z'),
        label: '2026-07-07 SOLUSDT 未建战役，执行力资产扣分',
        campaignSymbol: 'SOLUSDT',
      }, {
        id: 'decision-event-1',
        type: 'decision_reward',
        points: 600,
        date: '2026-07-06',
        createdAt: Date.parse('2026-07-06T02:00:00.000Z'),
        label: '决策记录交易奖励',
      }],
      rewardedCampaignIds: ['campaign-1'],
      rewardedReviewJournalIds: ['journal-1'],
    },
    tradeHistory: mockTradeHistory,
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
  listJournalsByTradeRecordId: mockListJournalsByTradeRecordId,
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
      symbol: 'BTCUSDT',
      createdAt: '2026-07-10T00:00:00.000Z',
    }]);
    expect(mockReconcileReviewMissingPenalties).toHaveBeenCalledWith([{
      journalId: 'journal-1',
      reviewed: true,
      symbol: 'BTCUSDT',
      operationTime: Date.parse('2026-06-22T04:05:06.000Z'),
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

    const summaryCards = Array.from(screen.getByTestId('execution-summary-grid').children);
    expect(summaryCards.map(card => card.getAttribute('data-summary-key'))).toEqual([
      'penalty',
      'review_missing',
      'direct',
      'campaign_missing',
      'review',
      'decision',
      'campaign',
    ]);
    expect(summaryCards.map(card => card.textContent?.replace(/\s+/g, ''))).toEqual([
      '1未练习扣分日每天-2000点击查看明细',
      '1未做评价每笔-1000点击查看明细',
      '1直接交易每标的−600点击查看明细',
      '1未建战役每标的-300点击查看明细',
      '1平仓评价每次+1000点击查看明细',
      '1决策记录交易每次+600点击查看明细',
      '1建战役每次+300点击查看明细',
    ]);

    await waitFor(() => {
      const recentEvents = Array.from(screen.getByTestId('recent-execution-events').children);
      expect(recentEvents[0]).toHaveTextContent('BTCUSDT');
      expect(recentEvents[0]).toHaveTextContent('+99');
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

  it('opens a missing-campaign deduction with the exact symbol and operation date prefilled', async () => {
    render(
      <MemoryRouter initialEntries={['/execution-assets']}>
        <Routes>
          <Route path="/execution-assets" element={<ExecutionAssetsPage />} />
          <Route path="/journal/campaigns/classify" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('未建战役'));
    expect(await screen.findByText('未建交易战役明细')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /补建战役/ }));

    expect(await screen.findByTestId('review-destination')).toHaveTextContent(
      '/journal/campaigns/classify?symbol=SOLUSDT&dateFrom=2026-07-07&dateTo=2026-07-07',
    );
  });

  it('lets a direct-trade deduction open a required post-trade review as remediation', async () => {
    render(
      <MemoryRouter initialEntries={['/execution-assets']}>
        <Routes>
          <Route path="/execution-assets" element={<ExecutionAssetsPage />} />
          <Route path="/journal/:journalId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('直接交易'));
    expect(await screen.findByText('直接交易明细')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看 / 补做平仓评价' }));

    expect(await screen.findByTestId('review-destination')).toHaveTextContent(
      '/journal/journal-direct?review=required&from=execution-assets',
    );
  });

  it.each([
    {
      eventId: 'review-event-1',
      score: '+666',
      expected: '/journal/journal-1?review=edit&from=execution-assets',
      title: '点击查看、编辑并保存这笔平仓评价',
    },
    {
      eventId: 'review-missing-event-1',
      score: '-1,000',
      expected: '/journal/journal-missing?review=required&from=execution-assets',
      title: '点击开始并完成这笔平仓评价',
    },
  ])('opens the correct review mode for $eventId', async ({ eventId, score, expected, title }) => {
    render(
      <MemoryRouter initialEntries={['/execution-assets']}>
        <Routes>
          <Route path="/execution-assets" element={<ExecutionAssetsPage />} />
          <Route path="/journal/:journalId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const item = await waitFor(() => {
      const found = document.querySelector(`[data-event-id="${eventId}"]`);
      expect(found).not.toBeNull();
      expect(within(found as HTMLElement).getByRole('button')).toHaveAttribute('title', title);
      return found as HTMLElement;
    });
    fireEvent.click(within(item).getByText(score));

    expect(await screen.findByTestId('review-destination')).toHaveTextContent(expected);
  });
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="review-destination">{location.pathname}{location.search}</div>;
}
