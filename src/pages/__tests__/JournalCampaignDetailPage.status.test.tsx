/**
 * 详情页上「到底是盈利还是亏损」只能有一个答案。
 *
 * 事故：TUTUSDT 2026-08-09 的页眉写「盈利结束」、导出图标题带 profit，
 * 而已实现 P&L / Legs 合计 / 盈亏比都是校正后的 −1756.64。
 * 页眉读的是落库的 campaign.status（未校正），盈亏概览读的是叠了平仓价校正的现算值。
 *
 * 这条测试把页眉、导出 PNG 的输入、DSI/USI 归组、已实现 P&L 钉在同一份校正后的结算上。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCampaignBoardOverview,
  campaignKlineTitleName,
  type CampaignBoardExportInput,
} from '@/lib/campaignLegsPngExport';
import { getCampaignFullData } from '@/lib/journalApi';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import {
  CORRECTED_TOTAL,
  PLANNED_MAX_LOSS_TOTAL,
  activeVariant,
} from '@/test/fixtures/correctedLossCampaign';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

const { exportCampaignBoardPngMock } = vi.hoisted(() => ({
  exportCampaignBoardPngMock: vi.fn(async (_input: CampaignBoardExportInput) => 'TUTUSDT campaign.png'),
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

vi.mock('@/lib/journalApi', async () => {
  const fixture = await import('@/test/fixtures/correctedLossCampaign');
  const loss = {
    campaign: fixture.correctedLossStoredCampaign(),
    legs: fixture.correctedLossLegs(),
    tradeRecords: fixture.correctedLossTradeRecords(),
    pendingOrders: [],
    reverseHedgeOrders: [],
  };
  const active = { ...fixture.activeVariant(), pendingOrders: [], reverseHedgeOrders: [] };
  // 一场纯盈利的对照样本，让账户级 DSI/USI 同时有上行组与下行组。
  const winner: TradeCampaign = fixture.correctedLossStoredCampaign({
    id: 'winner',
    campaign_code: 'C-WIN',
    title: 'winner campaign',
    final_realized_pnl: 200,
    final_r_multiple: null,
  }, 'BTCUSDT');
  const winnerLegs = [
    {
      id: 'winner-main', user_id: 'user-1', campaign_id: 'winner', trade_record_id: null,
      leg_role: 'main_open', source: 'post_review', symbol: 'BTCUSDT', direction: 'long', order_kind: 'main',
      pre_simulated_time: '2026-01-01T00:00:00.000Z', pre_real_time: '2026-07-19T10:00:00.000Z',
      pre_entry_price: 100, pre_position_size: 1_000, pre_account_equity_usdt: 10_000, post_realized_pnl: null,
    },
    {
      id: 'winner-hedge', user_id: 'user-1', campaign_id: 'winner', trade_record_id: null,
      leg_role: 'hedge_initial_a', source: 'post_review', symbol: 'BTCUSDT', direction: 'short', order_kind: 'hedge',
      pre_simulated_time: '2026-01-01T00:01:00.000Z', pre_real_time: '2026-07-19T10:01:00.000Z',
      pre_entry_price: 90, pre_position_size: 1_000, post_realized_pnl: null,
    },
  ] as unknown as TradeJournal[];
  const detailsById: Record<string, typeof loss> = {
    [loss.campaign.id]: loss,
    [active.campaign.id]: active,
    winner: { campaign: winner, legs: winnerLegs, tradeRecords: [], pendingOrders: [], reverseHedgeOrders: [] },
  };
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    // 与真实 API 同形：自愈路径（heal !== false）附带校正；列表 / 样本路径不带。
    getCampaignFullData: vi.fn(async (id: string, options?: { heal?: boolean }) => ({
      ...detailsById[id],
      ...(options?.heal === false
        ? {}
        : { legExitPriceCorrections: id === 'tut-1' ? fixture.correctedLossCorrections() : {} }),
    })),
    listAllCampaigns: vi.fn(async () => [loss.campaign, winner]),
    listVisibleCampaigns: vi.fn(async () => [loss.campaign, winner]),
    listCounterfactuals: vi.fn(async () => []),
    listCampaignComments: vi.fn(async () => []),
    hasMutualFollow: vi.fn(async () => true),
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
    balance: 50_000,
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
      contentStartMs: Date.parse('2026-01-01T00:00:00.000Z'),
      contentEndMs: Date.parse('2026-01-01T01:00:00.000Z'),
      contextMs: 60 * 60_000,
      availableContextMs: 1_000 * 60_000,
    }),
    useCampaignKlines: () => ({
      klines: [{
        time: Date.parse('2026-01-01T00:00:00.000Z'),
        open: 0.085,
        high: 0.0916,
        low: 0.0849,
        close: 0.09,
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

vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null),
}));
vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: () => <div data-testid="campaign-chart" />,
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/CampaignWhatIfEditor', () => ({ CampaignWhatIfEditor: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));
vi.mock('@/lib/campaignLegsPngExport', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegsPngExport')>();
  return { ...actual, exportCampaignBoardPng: exportCampaignBoardPngMock };
});

beforeEach(() => {
  window.localStorage.clear();
  exportCampaignBoardPngMock.mockClear();
  vi.mocked(getCampaignFullData).mockClear();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});

function renderDetail(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/journal/campaigns/${id}`]}>
      <Routes>
        <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('战役详情页 · 状态与已实现盈亏同源', () => {
  it('页眉状态由校正后的结算推出：红色「亏损结束」配 −1756.65 USDT', async () => {
    renderDetail('tut-1');

    const chip = await screen.findByTestId('campaign-status-chip');
    await waitFor(() => expect(chip).toHaveTextContent('亏损结束'));
    expect(chip.className).toContain('text-[#F6465D]');
    expect(chip.className).not.toContain('text-[#0ECB81]');
    expect(chip).toHaveAttribute('title', 'closed_loss');
    // 已实现 P&L 与页眉是同一份数
    expect(CORRECTED_TOTAL.toFixed(2)).toBe('-1756.65');
    expect(screen.getByText('-1756.65 USDT')).toBeInTheDocument();
    // 已结束的战役没有「结束战役」按钮
    expect(screen.queryByRole('button', { name: '结束战役' })).not.toBeInTheDocument();
  });

  it('本场 b < 0 进入 DSI 下行组，账户级样本只读、不触发回写', async () => {
    renderDetail('tut-1');

    await waitFor(() => expect(screen.getByText(/^DSI · b²\/n = /)).toBeInTheDocument());
    // 页面自身的加载走自愈路径（默认 heal），账户级样本一律 heal: false
    const calls = vi.mocked(getCampaignFullData).mock.calls;
    expect(calls.some(([id, options]) => id === 'tut-1' && options === undefined)).toBe(true);
    expect(calls.some(([id, options]) => id === 'winner' && options?.heal === false)).toBe(true);
    expect(calls.some(([id, options]) => id === 'winner' && options?.heal !== false)).toBe(false);
  });

  it('导出 PNG 的战役原数据、标题 slug 与最终 R 读的是同一份派生状态', async () => {
    renderDetail('tut-1');
    await waitFor(() => expect(screen.getByTestId('campaign-status-chip')).toHaveTextContent('亏损结束'));

    fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
    await waitFor(() => expect(exportCampaignBoardPngMock).toHaveBeenCalledTimes(1));

    const input = exportCampaignBoardPngMock.mock.calls[0][0];
    expect(input.campaign.status).toBe('closed_loss');
    expect(input.campaign.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(input.campaign.final_r_multiple).toBeCloseTo(CORRECTED_TOTAL / PLANNED_MAX_LOSS_TOTAL, 8);
    expect(campaignKlineTitleName(input.campaign)).toBe('TUTUSDT 2026-01-01 loss');
    const metadata = Object.fromEntries(
      buildCampaignBoardOverview(input).metadataItems.map(item => [item.label, item.value]),
    );
    expect(metadata['方向 / 状态']).toBe('主多 / 亏损结束');
    expect(metadata['最终 R']).toBe((CORRECTED_TOTAL / PLANNED_MAX_LOSS_TOTAL).toFixed(2));
    // 图里的已实现 P&L 与页眉状态同一份
    const realized = input.pnlOverview.items.find(item => item.key === 'realizedPnl');
    expect(realized?.value).toBe('-1756.65 USDT');
  });

  it('进行中的战役（有腿未结算）保留落库的 active，不用半场数据定性', async () => {
    const active = activeVariant();
    expect(active.campaign.status).toBe('active');
    renderDetail(active.campaign.id);

    const chip = await screen.findByTestId('campaign-status-chip');
    await waitFor(() => expect(chip).toHaveAttribute('title', 'active'));
    expect(chip).toHaveTextContent('进行中');
    expect(chip.className).toContain('text-[#F0B90B]');
    expect(await screen.findByRole('button', { name: '结束战役' })).toBeInTheDocument();
  });
});
