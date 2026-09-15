/**
 * 列表卡片与详情页页眉必须给出同一个状态。
 *
 * 列表页首屏用空校正画卡片（盈利结束），后台拉齐平仓价校正后重建行——
 * 重建出来的状态必须与详情页 reconcileCampaignWithSettlement 推出的完全一致（亏损结束）。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { computeCampaignRealizedPnl, reconcileCampaignWithSettlement } from '@/lib/campaignRealizedPnl';
import {
  correctedLossCorrections,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';
import JournalCampaignsPage from '../JournalCampaignsPage';

const { mockUser } = vi.hoisted(() => ({
  /** 必须是稳定引用：页面的取数 effect 依赖 [user]。 */
  mockUser: { id: 'user-1', email: 'desk@example.com' },
}));

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  const fixture = await import('@/test/fixtures/correctedLossCampaign');
  return {
    ...actual,
    fetchLegExitPriceCorrections: vi.fn(async (symbol: string) => (
      symbol === 'TUTUSDT' ? fixture.correctedLossCorrections() : {}
    )),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, profile: { display_name: '主账户' } }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    balance: 50_000,
    positionsMap: {},
    priceMap: {},
    getEffectiveTime: () => Date.parse('2026-01-01T01:00:00.000Z'),
  }),
}));

vi.mock('@/lib/journalApi', async () => {
  const fixture = await import('@/test/fixtures/correctedLossCampaign');
  const campaign = fixture.correctedLossStoredCampaign();
  return {
    appendCampaignEvent: vi.fn(async () => undefined),
    closeCampaign: vi.fn(async () => undefined),
    deleteCampaign: vi.fn(),
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    // 列表页走共用缓存：本地快照读取器 + 远端原始行 + 纯本地装配（与 sort / bulkClose 测试同一套替身）。
    createUserLocalSnapshotReader: () => ({
      read: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {} }),
    }),
    fetchCampaignSourceRows: vi.fn(async () => ({ campaigns: [campaign], journals: [] })),
    assembleCampaignsWithLegs: (_userId: string, rows: { campaigns: typeof campaign[] }) => (
      rows.campaigns.map(item => ({ campaign: item, legs: fixture.correctedLossLegs() }))
    ),
    getCampaignFullData: vi.fn(async () => ({
      campaign,
      legs: fixture.correctedLossLegs(),
      tradeRecords: fixture.correctedLossTradeRecords(),
      pendingOrders: [],
      reverseHedgeOrders: [],
    })),
    listAllCampaigns: vi.fn(async () => [campaign]),
    listDeletedCampaigns: vi.fn(async () => []),
    permanentlyDeleteCampaign: vi.fn(),
    restoreCampaign: vi.fn(),
    updateCampaignImportance: vi.fn(),
  };
});

describe('战役列表 · 卡片状态与详情页同源', () => {
  it('后台拉齐平仓价校正后，卡片显示「亏损结束」，与详情页推出的状态一致', async () => {
    render(<MemoryRouter initialEntries={['/journal/campaigns']}><JournalCampaignsPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(1));
    const card = screen.getAllByTestId('campaign-card')[0];
    await waitFor(() => expect(within(card).getByText('亏损结束')).toBeInTheDocument());
    expect(within(card).queryByText('盈利结束')).not.toBeInTheDocument();

    // 详情页的派生规则，用同一份夹具算一遍：两处必须给同一个答案
    const settlement = computeCampaignRealizedPnl(
      correctedLossStoredCampaign(),
      correctedLossLegs(),
      correctedLossTradeRecords(),
      correctedLossCorrections(),
    );
    const detailStatus = reconcileCampaignWithSettlement(
      correctedLossStoredCampaign(),
      correctedLossLegs(),
      settlement,
    ).status;
    expect(detailStatus).toBe('closed_loss');
  });
});
