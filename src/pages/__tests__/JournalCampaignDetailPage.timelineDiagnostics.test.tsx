import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignTimelineDiagnostics } from '@/lib/campaignTimelineScope';
import { getCampaignFullData } from '@/lib/journalApi';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

/**
 * 回放时间线的影子比对（Phase 1）：详情页只在精确判定与启发式**有分歧**时记一条 console.info，
 * 界面照旧按启发式显示；没有分歧（或老战役根本没开工）时一条都不记。
 */
vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return {
    ...actual,
    fetchLegExitPriceCorrections: vi.fn(async () => ({})),
  };
});

const { campaign, legs, detailsById } = vi.hoisted(() => {
  const campaign: TradeCampaign = {
    id: 'shadow',
    user_id: 'user-1',
    campaign_code: 'C-shadow',
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: 'shadow campaign',
    opened_at: '2026-01-01T00:00:00.000Z',
    closed_at: '2026-01-01T01:00:00.000Z',
    initial_main_size_usdt: 1_000,
    initial_leverage: 1,
    final_realized_pnl: 200,
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
  } as TradeCampaign;
  const legs: TradeJournal[] = [{
    id: 'shadow-main',
    user_id: 'user-1',
    campaign_id: 'shadow',
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
    post_reviewed_at: '2026-07-19T11:05:00.000Z',
  } as unknown as TradeJournal];
  return {
    campaign,
    legs,
    detailsById: {} as Record<string, {
      campaign: TradeCampaign;
      legs: TradeJournal[];
      tradeRecords: never[];
      pendingOrders: never[];
      reverseHedgeOrders: never[];
      foreignLiveOrders: never[];
      timelineDiagnostics: CampaignTimelineDiagnostics;
    }>,
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'desk@example.com' },
    profile: { display_name: '主账户' },
  }),
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
      klines: [{ time: Date.parse('2026-01-01T00:00:00.000Z'), open: 100, high: 101, low: 99, close: 100, volume: 1 }],
      loading: false,
      error: null,
      reload: vi.fn(),
      fromTime: Date.parse('2025-12-31T07:30:00.000Z'),
      toTime: Date.parse('2026-01-01T17:30:00.000Z'),
    }),
  };
});

vi.mock('@/lib/journalApi', () => ({
  readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
  getCampaignFullData: vi.fn(async (id: string) => detailsById[id]),
  listAllCampaigns: vi.fn(async () => [campaign]),
  listVisibleCampaigns: vi.fn(async () => [campaign]),
  listCounterfactuals: vi.fn(async () => []),
  listCampaignComments: vi.fn(async () => []),
  hasMutualFollow: vi.fn(async () => true),
}));

vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null),
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: () => <div data-testid="campaign-chart" />,
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/CampaignWhatIfEditor', () => ({ CampaignWhatIfEditor: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));

const heuristicOnly: CampaignTimelineDiagnostics = {
  mode: 'heuristic',
  timelineIds: [],
  anchorTimelineIds: [],
  unstampedAnchors: 0,
  missingAnchorNodes: [],
  verdicts: {},
  disagreements: [],
};
const SHADOW_PREFIX = '[JournalCampaignDetailPage] 回放时间线影子比对';

const setDiagnostics = (timelineDiagnostics: CampaignTimelineDiagnostics) => {
  detailsById.shadow = { campaign, legs, tradeRecords: [], pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [], timelineDiagnostics };
};
const renderPage = () => render(
  <MemoryRouter initialEntries={['/journal/campaigns/shadow']}>
    <Routes>
      <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
    </Routes>
  </MemoryRouter>,
);
const shadowLogs = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter(call => typeof call[0] === 'string' && call[0].startsWith(SHADOW_PREFIX));

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => detailsById[id]);
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});

afterEach(() => {
  infoSpy.mockRestore();
});

describe('JournalCampaignDetailPage 回放时间线影子比对', () => {
  it('精确判定与启发式有分歧：记一条 console.info 汇总（战役 / 模式 / 时间线 / 分歧），界面仍按启发式', async () => {
    setDiagnostics({
      mode: 'exact',
      timelineIds: ['A', 'B'],
      anchorTimelineIds: ['A'],
      unstampedAnchors: 0,
      missingAnchorNodes: [],
      verdicts: {
        'passA-late': { heuristic: true, exact: 'out' },
        'passB': { heuristic: true, exact: 'in' },
        'ghost': { heuristic: true, exact: 'defer' },
      },
      disagreements: [{ orderId: 'passA-late', heuristic: true, exact: 'out' }],
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('shadow campaign')).toBeInTheDocument());
    await waitFor(() => expect(shadowLogs(infoSpy)).toHaveLength(1));
    expect(shadowLogs(infoSpy)[0][1]).toEqual({
      campaignId: 'shadow',
      mode: 'exact',
      timelineIds: ['A', 'B'],
      anchorTimelineIds: ['A'],
      unstampedAnchors: 0,
      missingAnchorNodes: [],
      disagreements: [{ orderId: 'passA-late', heuristic: true, exact: 'out' }],
    });
  }, 30_000);

  it('没有分歧（老战役只有启发式、或精确判定全部一致 / defer）：一条都不记', async () => {
    setDiagnostics(heuristicOnly);
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText('shadow campaign')).toBeInTheDocument());
    expect(shadowLogs(infoSpy)).toHaveLength(0);
    unmount();

    setDiagnostics({
      ...heuristicOnly,
      mode: 'mixed',
      timelineIds: ['A'],
      anchorTimelineIds: ['A'],
      unstampedAnchors: 1,
      verdicts: { 'on-a': { heuristic: true, exact: 'in' }, 'unstamped': { heuristic: true, exact: 'defer' } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('shadow campaign')).toBeInTheDocument());
    expect(shadowLogs(infoSpy)).toHaveLength(0);
  }, 30_000);
});
