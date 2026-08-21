import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignBoardExportInput } from '@/lib/campaignLegsPngExport';
import { getCampaignFullData } from '@/lib/journalApi';
import type { CampaignCounterfactual, TradeCampaign, TradeJournal } from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return {
    ...actual,
    fetchLegExitPriceCorrections: vi.fn(async () => ({})),
  };
});

const scrollToMock = vi.fn();
const {
  exportCampaignBoardPngMock,
  exportCampaignPostReviewsTxtMock,
  listCounterfactualsMock,
  replayVisibleRanges,
  replayAnnotationSnapshots,
} = vi.hoisted(() => ({
  exportCampaignBoardPngMock: vi.fn(async (_input: CampaignBoardExportInput) => 'BTCUSDT campaign.png'),
  exportCampaignPostReviewsTxtMock: vi.fn(() => 'BTCUSDT review.txt'),
  listCounterfactualsMock: vi.fn(async () => [] as CampaignCounterfactual[]),
  replayVisibleRanges: [] as Array<{ start: number; end: number }>,
  replayAnnotationSnapshots: [] as Array<{
    markerLabels: string[];
    priceLineTitles: string[];
    verticalColors: string[];
  }>,
}));

beforeEach(() => {
  window.localStorage.clear();
  scrollToMock.mockClear();
  exportCampaignBoardPngMock.mockClear();
  exportCampaignPostReviewsTxtMock.mockClear();
  listCounterfactualsMock.mockReset();
  listCounterfactualsMock.mockResolvedValue([]);
  vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => detailsById[id]);
  replayVisibleRanges.length = 0;
  replayAnnotationSnapshots.length = 0;
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
      post_reviewed_at: '2026-07-19T11:05:00.000Z',
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
  listCounterfactuals: listCounterfactualsMock,
  listCampaignComments: vi.fn(async () => []),
  hasMutualFollow: vi.fn(async () => true),
}));

vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null),
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: (props: {
    initialVisibleStartTime: number;
    initialVisibleEndTime: number;
    markers?: Array<{ label?: string }>;
    timeBoundPriceLines?: Array<{ title?: string }>;
    verticalLines?: Array<{ color: string }>;
  }) => {
    replayVisibleRanges.push({
      start: props.initialVisibleStartTime,
      end: props.initialVisibleEndTime,
    });
    replayAnnotationSnapshots.push({
      markerLabels: (props.markers ?? []).map(marker => marker.label ?? ''),
      priceLineTitles: (props.timeBoundPriceLines ?? []).map(line => line.title ?? ''),
      verticalColors: (props.verticalLines ?? []).map(line => line.color),
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
vi.mock('@/lib/campaignReviewTxtExport', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignReviewTxtExport')>();
  return {
    ...actual,
    exportCampaignPostReviewsTxt: exportCampaignPostReviewsTxtMock,
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
    for (const multiplier of [1.1, 2, 3, 5, 11, 21, 31, 41, 51]) {
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
  }, 30_000);

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

  it('一键隐藏会同时移除反事实 marker、水平线和竖线', async () => {
    const branch = {
      id: 'counterfactual-1',
      user_id: 'user-1',
      campaign_id: 'winner',
      label: '测试反事实',
      branch_kind: 'custom_what_if',
      source_deduction_id: null,
      params: {
        entry: {
          time: '2026-01-01T00:10:00.000Z',
          price: 100,
          size_usdt: 1_000,
          direction: 'long',
          leverage: 1,
        },
        hedge_a: { offset_pct: 2, size_pct: 50 },
        hedge_b: { offset_pct: 4, size_pct: 50 },
        mirror_tp: { offset_pct: 2, size_pct: 50 },
        rolling: {
          enabled: false,
          trigger_rise_pct: 0,
          min_interval_minutes: 5,
          new_hedge_offset_pct: 2,
          rolling_hedge_size_pct: 50,
        },
        exit_rule: 'manual_only',
      },
      result: {
        final_realized_pnl: 10,
        final_r_multiple: 1,
        peak_unrealized_pnl: 20,
        peak_drawdown: 5,
        profit_capture_ratio: 50,
        events: [
          {
            timestamp: '2026-01-01T00:10:00.000Z',
            event_type: 'main_opened',
            leg_role: 'main_open',
            price: 100,
            size_usdt: 1_000,
            notes: '',
          },
          {
            timestamp: '2026-01-01T00:20:00.000Z',
            event_type: 'hedge_triggered',
            leg_role: 'hedge_initial_a',
            price: 98,
            size_usdt: 500,
            notes: '',
          },
        ],
        legs_summary: [{
          leg_role: 'hedge_initial_a',
          placed_at: '2026-01-01T00:10:00.000Z',
          trigger_price: 98,
          status: 'filled',
          triggered_at: '2026-01-01T00:20:00.000Z',
          realized_pnl_usdt: 0,
        }],
        state_segments: [],
        sop_score: 100,
      },
      created_at: '2026-01-01T02:00:00.000Z',
    } satisfies CampaignCounterfactual;
    listCounterfactualsMock.mockResolvedValue([branch]);

    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const hideButton = await screen.findByRole('button', { name: '隐藏测试反事实' });
    await waitFor(() => {
      const latest = replayAnnotationSnapshots.at(-1);
      expect(latest?.markerLabels.some(label => label.startsWith('CF-'))).toBe(true);
      expect(latest?.priceLineTitles.some(title => title.startsWith('CF-'))).toBe(true);
      expect(latest?.verticalColors.some(color => color.includes('176,128,255'))).toBe(true);
    });

    fireEvent.click(hideButton);

    await waitFor(() => {
      const latest = replayAnnotationSnapshots.at(-1);
      expect(latest?.markerLabels.some(label => label.startsWith('CF-'))).toBe(false);
      expect(latest?.priceLineTitles.some(title => title.startsWith('CF-'))).toBe(false);
      expect(latest?.verticalColors.some(color => color.includes('176,128,255'))).toBe(false);
    });
    expect(screen.getByRole('button', { name: '显示测试反事实' })).toHaveAttribute('aria-pressed', 'false');
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
    expect(screen.getByText('1000.00 USDT')).toBeInTheDocument();
    expect(screen.getByText('10000.00 USDT')).toBeInTheDocument();
    // 算术/几何期望与实时胜率依赖异步加载的 campaignPerformance（同账户有效战役），需等它落定。
    await waitFor(() => expect(screen.getByText('+0.50R')).toBeInTheDocument());
    expect(screen.getByText('+0.5%/笔')).toBeInTheDocument();
    expect(screen.getByText('USI · b²/n = 4.0000（组内 100.0%）')).toBeInTheDocument();
    expect(screen.getByText(/2 场有效战役，实时胜率 50.00%/)).toBeInTheDocument();
    expect(screen.queryByText('逐腿 P&L 对账')).not.toBeInTheDocument();
    expect(screen.queryByText(/逐腿 P&L 对账已校正/)).not.toBeInTheDocument();

    for (const label of [
      '已实现 P&L',
      '杠杆倍数',
      '主力开仓名义仓位',
      '峰值浮盈',
      '最大预期亏损',
      '预期回撤',
      '盈亏比',
      '本场 b 对 DSI/USI 的贡献',
      '机会质量',
      '算术期望',
      '几何期望',
      '今日账户总资产',
    ]) {
      expect(screen.getByRole('button', { name: `${label}说明` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: '最大回撤说明' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '机会质量说明' }));
    expect(await screen.findByText(/b\* = max（实际盈亏比 b, 1）；Q = b\* ÷ 预期回撤百分点 d/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
    await waitFor(() => expect(exportCampaignBoardPngMock).toHaveBeenCalledTimes(1));
    const exportInput = exportCampaignBoardPngMock.mock.calls[0][0];
    expect(exportInput.accountName).toBe('主账户');
    expect(exportInput.chartInterval).toBe('1m');
    expect(exportInput.pnlOverview.items.map(item => item.label)).toEqual([
      '已实现 P&L',
      '杠杆倍数',
      '主力开仓名义仓位',
      '峰值浮盈',
      '最大预期亏损',
      '预期回撤',
      '盈亏比',
      '本场 b 对 DSI/USI 的贡献',
      '机会质量',
      '算术期望',
      '几何期望',
      '今日账户总资产',
    ]);
    expect(exportInput.pnlOverview.note).toContain('2 场有效战役，实时胜率 50.00%');
    expect(exportInput.pnlOverview.note).not.toContain('逐腿 P&L 对账');

    fireEvent.click(screen.getByRole('button', { name: '评价 TXT' }));
    expect(exportCampaignPostReviewsTxtMock).toHaveBeenCalledTimes(1);
    expect(exportCampaignPostReviewsTxtMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'winner' }),
      expect.arrayContaining([expect.objectContaining({ id: 'winner-main' })]),
      '主账户',
      // 第四个参数是成交记录：导出的 TXT 必须与界面显示的战役盈亏同源
      expect.any(Array),
    );
  }, 10_000);

  it('keeps verified expectancy values when another campaign fails to load', async () => {
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => {
      if (id === 'loser') throw new Error('transient campaign load failure');
      return detailsById[id];
    });

    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('+2.00R')).toBeInTheDocument());
    expect(screen.getByText(/1 场有效战役，实时胜率 100.00%/)).toBeInTheDocument();
    expect(screen.queryByText(/期望口径加载失败/)).not.toBeInTheDocument();
  });

  it('shows the review export for a historical answer-only review without a timestamp', async () => {
    const winner = detailsById.winner;
    detailsById['legacy-review'] = {
      ...winner,
      campaign: {
        ...winner.campaign,
        id: 'legacy-review',
        campaign_code: 'C-legacy-review',
        title: 'legacy review campaign',
      },
      legs: [{
        ...winner.legs[0],
        id: 'legacy-review-main',
        campaign_id: 'legacy-review',
        post_reviewed_at: null,
        post_reflection: '历史评价答案',
      }],
    };

    try {
      render(
        <MemoryRouter initialEntries={['/journal/campaigns/legacy-review']}>
          <Routes>
            <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
          </Routes>
        </MemoryRouter>,
      );

      const button = await screen.findByRole('button', { name: '评价 TXT' });
      expect(button).toHaveAttribute('title', '导出本战役 1 条平仓评价为 TXT');
      fireEvent.click(button);
      expect(exportCampaignPostReviewsTxtMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'legacy-review' }),
        [expect.objectContaining({
          id: 'legacy-review-main',
          post_reflection: '历史评价答案',
        })],
        '主账户',
        expect.any(Array),
      );
    } finally {
      delete detailsById['legacy-review'];
    }
  });
});
