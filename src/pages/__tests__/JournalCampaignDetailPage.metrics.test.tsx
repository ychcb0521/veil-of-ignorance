import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeInitialExpectedMaxLoss } from '@/lib/campaignAnalysis';
import type { CampaignBoardExportInput } from '@/lib/campaignLegsPngExport';
import { getCampaignFullData, saveCampaignDeviationNotes } from '@/lib/journalApi';
import { readCampaignReviewSummary, withCampaignReviewSummary } from '@/lib/campaignReviewSummary';
import type { CampaignCounterfactual, TradeCampaign, TradeJournal } from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

// 只包一层 spy、照常计算：用来确认最大预期亏损的输入里没有他场委托
vi.mock('@/lib/campaignAnalysis', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignAnalysis')>();
  return {
    ...actual,
    computeInitialExpectedMaxLoss: vi.fn(actual.computeInitialExpectedMaxLoss),
  };
});

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
  vi.mocked(saveCampaignDeviationNotes).mockReset();
  vi.mocked(saveCampaignDeviationNotes).mockResolvedValue(undefined);
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
      foreignLiveOrders: [],
      timelineDiagnostics: {
        mode: 'heuristic' as const,
        timelineIds: [],
        anchorTimelineIds: [],
        unstampedAnchors: 0,
        missingAnchorNodes: [],
        verdicts: {},
        disagreements: [],
      },
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

// 取景窗口固定返回；包一层 spy 是为了看页面递进去的内容跨度（他场委托的时刻也得在里面）
const klineWindowMock = vi.hoisted(() => ({
  build: vi.fn((..._args: unknown[]) => ({
    fromTime: Date.parse('2025-12-31T07:30:00.000Z'),
    toTime: Date.parse('2026-01-01T17:30:00.000Z'),
    defaultFromTime: Date.parse('2025-12-31T23:30:00.000Z'),
    defaultToTime: Date.parse('2026-01-01T01:30:00.000Z'),
    contentStartMs: Date.parse('2026-01-01T00:10:00.000Z'),
    contentEndMs: Date.parse('2026-01-01T00:50:00.000Z'),
    contextMs: 40 * 60_000,
    availableContextMs: 1_000 * 60_000,
  })),
}));
vi.mock('@/hooks/useCampaignKlines', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useCampaignKlines')>();
  return {
    ...actual,
    buildCampaignKlineTimeWindow: klineWindowMock.build,
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
  // 列表页共用一份本地快照，避免 147 场各解析一遍（实测 2~6 秒主线程阻塞）。
  readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
  getCampaignFullData: vi.fn(async (id: string) => detailsById[id]),
  saveCampaignDeviationNotes: vi.fn(async () => undefined),
  listAllCampaigns: vi.fn(async () => campaigns),
  listVisibleCampaigns: vi.fn(async () => campaigns),
  listCounterfactuals: listCounterfactualsMock,
  listCampaignComments: vi.fn(async () => []),
  hasMutualFollow: vi.fn(async () => true),
}));

vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null),
}));

type ReplayChartOrderLine = { title?: string; orderIds?: string[]; selectId?: string; selected?: boolean };
const replayChartLatest = vi.hoisted(() => ({
  lines: [] as Array<{ title?: string; orderIds?: string[]; selectId?: string; selected?: boolean }>,
  onSelectTimeBoundPriceLine: undefined as ((id: string) => void) | undefined,
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: (props: {
    initialVisibleStartTime: number;
    initialVisibleEndTime: number;
    markers?: Array<{ label?: string }>;
    timeBoundPriceLines?: ReplayChartOrderLine[];
    verticalLines?: Array<{ color: string }>;
    onSelectTimeBoundPriceLine?: (id: string) => void;
  }) => {
    replayChartLatest.lines = props.timeBoundPriceLines ?? [];
    replayChartLatest.onSelectTimeBoundPriceLine = props.onSelectTimeBoundPriceLine;
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
const legsListLatest = vi.hoisted(() => ({
  props: null as null | { reverseHedgeOrders?: Array<{ id: string }>; foreignLiveOrders?: Array<{ id: string }> },
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({
  CampaignLegsList: (props: { reverseHedgeOrders?: Array<{ id: string }>; foreignLiveOrders?: Array<{ id: string }> }) => {
    legsListLatest.props = props;
    return null;
  },
}));
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

  it('shows the same payoff and expectancy metrics as the campaign list', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('涨幅效率')).toBeInTheDocument());
    // 【用户要求】「机会质量」已删掉（涨幅效率更合理）
    expect(screen.queryByText('机会质量')).not.toBeInTheDocument();
    expect(screen.getByText('200.0% (2.00)')).toBeInTheDocument();
    // 主力开仓名义仓位；这场只有一笔主力多单，多方总名义仓位也是 1000
    expect(screen.getAllByText('1000.00 USDT').length).toBeGreaterThanOrEqual(1);
    // 【用户要求】「今日账户总资产」不在盈亏概览里显示
    expect(screen.queryByText('10000.00 USDT')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '今日账户总资产说明' })).not.toBeInTheDocument();
    // 算术期望胜率统一 50%：b = 2 → +0.50R，不等账户样本加载。
    await waitFor(() => expect(screen.getByText('+0.50R')).toBeInTheDocument());
    // 【用户要求】单场几何期望以 Gᵢ 呈现；这场 b = 2.00 → G = 1 + 2×0.1 = 1.20
    expect(screen.getByText('1.20')).toBeInTheDocument();
    // 【用户要求】DSI/USI 贡献简化：只写组与组内占比；底部「期望口径」脚注删掉
    expect(screen.getByText('USI 100.0%')).toBeInTheDocument();
    expect(screen.queryByText(/期望口径/)).not.toBeInTheDocument();
    expect(screen.queryByText('逐腿 P&L 对账')).not.toBeInTheDocument();
    expect(screen.queryByText(/逐腿 P&L 对账已校正/)).not.toBeInTheDocument();

    for (const label of [
      '已实现 P&L',
      '杠杆倍数',
      '主力开仓名义仓位',
      '峰值浮盈',
      '最大预期亏损',
      '多方总名义仓位',
      '预期回撤',
      '盈亏比',
      'DSI/USI 贡献',
      '算术期望',
      '几何期望',
    ]) {
      expect(screen.getByRole('button', { name: `${label}说明` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: '最大回撤说明' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
    await waitFor(() => expect(exportCampaignBoardPngMock).toHaveBeenCalledTimes(1));
    const exportInput = exportCampaignBoardPngMock.mock.calls[0][0];
    expect(exportInput.accountName).toBe('主账户');
    expect(exportInput.chartInterval).toBe('1m');
    // 导出图与页面同一份两栏次序：先左栏的递进链、再右栏的结果与仓位
    expect(exportInput.pnlOverview.items.map(item => item.label)).toEqual([
      '预期回撤',
      '涨幅',
      '涨幅效率',
      '盈亏比',
      '加仓效用',
      '几何期望',
      '算术期望',
      '最大预期亏损',
      '已实现 P&L',
      '峰值浮盈',
      '主力开仓名义仓位',
      '多方总名义仓位',
      '杠杆倍数',
      'DSI/USI 贡献',
    ]);
    // 【用户要求】脚注删掉：导出图也不再带；两栏次序随 rightColumn 带进导出图
    expect(exportInput.pnlOverview.note).toBeUndefined();
    expect(exportInput.pnlOverview.items.filter(item => item.rightColumn).map(item => item.label))
      .toEqual(['最大预期亏损', '已实现 P&L', '峰值浮盈', '主力开仓名义仓位', '多方总名义仓位', '杠杆倍数', 'DSI/USI 贡献']);

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

  it('【用户要求】情绪日记可以折叠，折叠后导出的 PNG 也只保留标题', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const card = await screen.findByTestId('campaign-emotion-diary');
    const toggle = screen.getByTestId('campaign-emotion-diary-toggle');
    // 默认展开
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(card.querySelector('#campaign-emotion-diary-body')).not.toBeNull());

    // 折叠：正文整块不渲染，标题还在，偏好记进本机
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(card.querySelector('#campaign-emotion-diary-body')).toBeNull();
    expect(card.textContent).toContain('操作日情绪日记');
    expect(card.textContent).toContain('已折叠，导出图片同样不显示内容');
    expect(window.localStorage.getItem('journal:campaign-emotion-diary-collapsed')).toBe('1');

    // 折叠态带进 PNG 导出
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
    await waitFor(() => expect(exportCampaignBoardPngMock).toHaveBeenCalledTimes(1));
    expect(exportCampaignBoardPngMock.mock.calls[0][0].emotionDiaryCollapsed).toBe(true);

    // 再点展开：正文回来，偏好清掉，导出也跟着展开
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(card.querySelector('#campaign-emotion-diary-body')).not.toBeNull();
    expect(window.localStorage.getItem('journal:campaign-emotion-diary-collapsed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
    await waitFor(() => expect(exportCampaignBoardPngMock).toHaveBeenCalledTimes(2));
    expect(exportCampaignBoardPngMock.mock.calls[1][0].emotionDiaryCollapsed).toBe(false);
  });

  it('折叠偏好跨刷新保留：导出前刷新一次，日记不会自己又摊开', async () => {
    window.localStorage.setItem('journal:campaign-emotion-diary-collapsed', '1');
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const card = await screen.findByTestId('campaign-emotion-diary');
    expect(screen.getByTestId('campaign-emotion-diary-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(card.querySelector('#campaign-emotion-diary-body')).toBeNull();
  });

  it('【用户要求】盘面点中委托线，管理区对应的委托用色块同步高亮；点色块也反向高亮盘面线', async () => {
    const at = (iso: string) => Date.parse(iso);
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id],
      reverseHedgeOrders: [
        { id: 'order-a', tradeRecordId: null, side: 'SHORT', price: 95, fillPrice: null, createdAt: at('2026-01-01T00:05:00.000Z'), triggeredAt: null, cancelledAt: at('2026-01-01T00:30:00.000Z'), status: 'cancelled' },
        { id: 'order-b', tradeRecordId: null, side: 'SHORT', price: 97, fillPrice: null, createdAt: at('2026-01-01T00:10:00.000Z'), triggeredAt: null, cancelledAt: null, status: 'pending' },
      ],
    }));
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const lineFor = (orderId: string) => replayChartLatest.lines.find(line => line.orderIds?.includes(orderId));
    await waitFor(() => expect(lineFor('order-a')?.selectId).toBeTruthy());
    // 管理区默认收起
    expect(screen.queryAllByTestId('reverse-order-chip')).toHaveLength(0);

    act(() => replayChartLatest.onSelectTimeBoundPriceLine?.(lineFor('order-a')!.selectId!));

    const chips = await screen.findAllByTestId('reverse-order-chip');
    expect(chips).toHaveLength(2);
    const chipFor = (price: string) => screen.getAllByTestId('reverse-order-chip').find(chip => chip.textContent?.includes(price))!;
    expect(chipFor('95')).toHaveAttribute('data-selected', 'true');
    expect(chipFor('95')).toHaveAttribute('aria-pressed', 'true');
    expect(chipFor('97')).toHaveAttribute('data-selected', 'false');
    await waitFor(() => expect(lineFor('order-a')?.selected).toBe(true));
    expect(lineFor('order-b')?.selected).toBe(false);

    // 点另一张的色块：选中切过去，盘面线跟着切
    fireEvent.click(chipFor('97'));
    expect(chipFor('97')).toHaveAttribute('data-selected', 'true');
    expect(chipFor('95')).toHaveAttribute('data-selected', 'false');
    await waitFor(() => expect(lineFor('order-b')?.selected).toBe(true));
    expect(lineFor('order-a')?.selected).toBe(false);

    // 盘面上再点已选中的那条线：取消选中，两边一起熄灭
    act(() => replayChartLatest.onSelectTimeBoundPriceLine?.(lineFor('order-b')!.selectId!));
    await waitFor(() => expect(chipFor('97')).toHaveAttribute('data-selected', 'false'));
    expect(chipFor('95')).toHaveAttribute('data-selected', 'false');
    await waitFor(() => expect(lineFor('order-b')?.selected).toBe(false));
  }, 30_000);

  it('手动对冲与委托列在同一系列：没有委托也能管理、点选、高亮、隐藏和恢复', async () => {
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id],
      legs: [detailsById[id].legs[0], {
        ...detailsById[id].legs[1],
        id: 'manual-hedge-leg',
        leg_role: 'hedge_rolling',
        hedge_order_method: 'market_chase',
      }],
    }));
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes><Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    const lineFor = () => replayChartLatest.lines.find(line => line.orderIds?.includes('manual-hedge:manual-hedge-leg'));
    const manager = await screen.findByRole('button', { name: '管理' });
    await waitFor(() => expect(lineFor()?.selectId).toBeTruthy());
    fireEvent.click(manager);
    const chip = screen.getByTestId('manual-hedge-chip');
    expect(chip).toHaveTextContent('手动对冲 1');
    expect(chip).toHaveTextContent('@ 90');
    expect(chip).toHaveTextContent('平 ');
    expect(screen.queryAllByTestId('reverse-order-chip')).toHaveLength(0);
    fireEvent.click(chip);
    await waitFor(() => expect(lineFor()?.selected).toBe(true));
    act(() => replayChartLatest.onSelectTimeBoundPriceLine?.(lineFor()!.selectId!));
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(chip).getByRole('button', { name: '从盘面隐藏这条手动对冲' }));
    expect(screen.queryByTestId('manual-hedge-chip')).toBeNull();
    await waitFor(() => expect(lineFor()).toBeUndefined());
    expect(JSON.parse(window.localStorage.getItem('campaign:winner:hidden-reverse-hedge-orders')!))
      .toEqual(['manual-hedge:manual-hedge-leg']);
    fireEvent.click(screen.getByRole('button', { name: '恢复 1' }));
    expect(screen.getByTestId('manual-hedge-chip')).toBeInTheDocument();
    await waitFor(() => expect(lineFor()).toBeDefined());
  });

  it('总结按战役保存并在刷新后回显，保留原备注与逐腿备注，不写进其他战役', async () => {
    const originalNotes = { leg1: { reason: '逐腿备注', fix: '原规则' } };
    const persisted = new Map([['winner', withCampaignReviewSummary(originalNotes, '原总结')], ['loser', withCampaignReviewSummary({}, '另一场')]]);
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id],
      campaign: { ...detailsById[id].campaign, notes: '原战役备注', deviation_notes: persisted.get(id)! },
    }));
    vi.mocked(saveCampaignDeviationNotes).mockImplementation(async (id, notes) => { persisted.set(id, notes); });
    const page = () => <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
      <Link to="/journal/campaigns/loser">另一战役</Link>
      <Routes><Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} /></Routes>
    </MemoryRouter>;
    const first = render(page());
    const field = await screen.findByRole('textbox', { name: '复盘总结' });
    expect(field).toHaveValue('原总结');
    fireEvent.change(field, { target: { value: '本场自己的结论' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    await waitFor(() => expect(within(screen.getByTestId('campaign-review-summary')).getByRole('status')).toHaveTextContent('已保存到本战役'));
    expect(persisted.get('winner')!.leg1).toEqual(originalNotes.leg1);
    expect(readCampaignReviewSummary(persisted.get('winner'))).toBe('本场自己的结论');
    first.unmount();
    render(page());
    expect(await screen.findByRole('textbox', { name: '复盘总结' })).toHaveValue('本场自己的结论');
    fireEvent.click(screen.getByRole('link', { name: '另一战役' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '复盘总结' })).toHaveValue('另一场'));
    expect(saveCampaignDeviationNotes).toHaveBeenCalledTimes(1);
    expect(saveCampaignDeviationNotes).toHaveBeenCalledWith('winner', expect.objectContaining(originalNotes));
  });

  it('切换战役时，上一场总结的慢保存不会改写新战役的总结', async () => {
    let finish!: () => void;
    vi.mocked(saveCampaignDeviationNotes).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id], campaign: { ...detailsById[id].campaign, deviation_notes: withCampaignReviewSummary({}, `${id} 总结`) },
    }));
    render(<MemoryRouter initialEntries={['/journal/campaigns/winner']}>
      <Link to="/journal/campaigns/loser">另一战役</Link>
      <Routes><Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} /></Routes>
    </MemoryRouter>);
    fireEvent.change(await screen.findByRole('textbox', { name: '复盘总结' }), { target: { value: 'winner 慢保存' } });
    fireEvent.click(screen.getByRole('button', { name: '保存总结' }));
    fireEvent.click(screen.getByRole('link', { name: '另一战役' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '复盘总结' })).toHaveValue('loser 总结'));
    await act(async () => finish());
    expect(screen.getByRole('textbox', { name: '复盘总结' })).toHaveValue('loser 总结');
  });

  it('被委托触发的对冲不重复生成手动色块，隐藏委托后也不会冒充手动对冲', async () => {
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id],
      reverseHedgeOrders: [{
        id: 'triggered-order', side: 'SHORT', price: 90, fillPrice: 90,
        createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
        triggeredAt: Date.parse('2026-01-01T00:01:00.000Z'),
        cancelledAt: Date.parse('2026-01-01T01:00:00.000Z'), status: 'triggered', tradeRecordId: null,
      }],
    }));
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes><Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '管理' }));
    expect(screen.queryAllByTestId('manual-hedge-chip')).toHaveLength(0);
    fireEvent.click(within(screen.getByTestId('reverse-order-chip')).getByRole('button', { name: '从盘面隐藏这条委托空单' }));
    expect(screen.queryAllByTestId('manual-hedge-chip')).toHaveLength(0);
    await waitFor(() => expect(replayChartLatest.lines.some(line => line.title === '手动空')).toBe(false));
  });

  it('【用户决定】他场委托：盘面灰色淡虚线、管理区排在本场之后单独压灰一组且可隐藏；Legs 与最大预期亏损都不算它', async () => {
    const at = (iso: string) => Date.parse(iso);
    vi.mocked(computeInitialExpectedMaxLoss).mockClear();
    legsListLatest.props = null;
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id],
      reverseHedgeOrders: [
        { id: 'order-a', tradeRecordId: null, side: 'SHORT', price: 95, fillPrice: null, createdAt: at('2026-01-01T00:05:00.000Z'), triggeredAt: null, cancelledAt: at('2026-01-01T00:30:00.000Z'), status: 'cancelled' },
      ],
      foreignLiveOrders: [
        { id: 'other-live', tradeRecordId: null, side: 'SHORT', price: 93, fillPrice: null, createdAt: at('2026-01-01T00:08:00.000Z'), triggeredAt: null, cancelledAt: null, status: 'pending', foreignReplay: true },
      ],
    }));
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const lineFor = (orderId: string) => replayChartLatest.lines.find(line => line.orderIds?.includes(orderId));
    await waitFor(() => expect(lineFor('other-live')).toBeTruthy());
    expect(lineFor('other-live')).toMatchObject({ title: '他场委托', color: '#848E9C', dashed: true, dim: true });
    expect(lineFor('order-a')?.title).toBe('委托空');
    expect(screen.getByTestId('foreign-replay-order-legend')).toHaveTextContent('他场委托');

    // Legs 表拿到的是两份：本场委托里没有他场那张
    expect(legsListLatest.props?.reverseHedgeOrders?.map(order => order.id)).toEqual(['order-a']);
    expect(legsListLatest.props?.foreignLiveOrders?.map(order => order.id)).toEqual(['other-live']);
    // 最大预期亏损（Δb 的分母）的输入只有本场委托
    const orderInputs = vi.mocked(computeInitialExpectedMaxLoss).mock.calls
      .flatMap(args => args.filter(Array.isArray) as Array<Array<{ id?: string }>>);
    expect(orderInputs.some(orders => orders.some(order => order?.id === 'order-a'))).toBe(true);
    expect(orderInputs.some(orders => orders.some(order => order?.id === 'other-live'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    const ownChips = screen.getAllByTestId('reverse-order-chip');
    expect(ownChips).toHaveLength(1);
    const group = screen.getByTestId('foreign-replay-order-group');
    expect(group).toHaveTextContent('来自另一次回放 · 仍挂着 1');
    expect(ownChips[0].compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const foreignChips = within(group).getAllByTestId('foreign-replay-order-chip');
    expect(foreignChips).toHaveLength(1);
    expect(foreignChips[0]).toHaveTextContent('他场');
    expect(within(group).queryAllByTestId('reverse-order-chip')).toHaveLength(0);

    // 同一个隐藏按钮：盘面线与色块一起消失，「恢复」能找回来
    fireEvent.click(within(foreignChips[0]).getByRole('button', { name: '从盘面隐藏这条他场委托' }));
    await waitFor(() => expect(lineFor('other-live')).toBeUndefined());
    expect(screen.queryByTestId('foreign-replay-order-group')).toBeNull();
    expect(lineFor('order-a')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复 1' }));
    await waitFor(() => expect(lineFor('other-live')).toBeTruthy());

    // 眼睛开关同样管它：说明里也点名他场委托，关掉后灰色那句同样标已隐藏
    const toggle = screen.getByRole('button', { name: /^隐藏.*他场委托$/ });
    expect(toggle).toHaveAttribute('title', expect.stringMatching(/^隐藏.*他场委托（黄色、灰色）$/));
    fireEvent.click(toggle);
    await waitFor(() => expect(lineFor('other-live')).toBeUndefined());
    expect(lineFor('order-a')).toBeUndefined();
    expect(screen.getByTestId('foreign-replay-order-legend')).toHaveTextContent('已隐藏');
  }, 30_000);

  it('【复核】只有他场委托、且挂在开主力前 3 分钟：取景跨度盖住它，眼睛开关的说明只写他场委托（灰色），关掉后标已隐藏', async () => {
    const preOpen = Date.parse('2025-12-31T23:57:00.000Z');
    klineWindowMock.build.mockClear();
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id],
      // 只留主力腿：盘上没有任何黄色层
      legs: detailsById[id].legs.filter(leg => leg.leg_role === 'main_open'),
      reverseHedgeOrders: [],
      foreignLiveOrders: [
        { id: 'other-prehedge', tradeRecordId: null, side: 'SHORT', price: 93, fillPrice: null, createdAt: preOpen, triggeredAt: null, cancelledAt: null, status: 'pending', foreignReplay: true },
      ],
    }));
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const lineFor = (orderId: string) => replayChartLatest.lines.find(line => line.orderIds?.includes(orderId));
    await waitFor(() => expect(lineFor('other-prehedge')).toBeTruthy());
    // 内容跨度从它的委托时刻（开主力前 3 分钟）之前开始：灰线不会落在 K 线窗口之外
    const lastSpanStart = () => klineWindowMock.build.mock.calls.at(-1)?.[2] as number | null | undefined;
    await waitFor(() => expect(lastSpanStart()).toBeLessThanOrEqual(preOpen));

    const toggle = screen.getByRole('button', { name: '隐藏他场委托' });
    expect(toggle).toHaveAttribute('title', '隐藏他场委托（灰色）');
    expect(screen.queryByText(/黄色水平线/)).toBeNull();
    const legend = screen.getByTestId('foreign-replay-order-legend');
    expect(legend).not.toHaveTextContent('已隐藏');

    fireEvent.click(toggle);
    await waitFor(() => expect(lineFor('other-prehedge')).toBeUndefined());
    expect(legend).toHaveTextContent('已隐藏');
    expect(screen.getByRole('button', { name: '显示他场委托' })).toHaveAttribute('title', '显示他场委托（灰色）');
  }, 30_000);

  it('【复核】他场一组的标题只数各自状态：本场期间撤掉 / 触发的不算「仍挂着」', async () => {
    const at = (iso: string) => Date.parse(iso);
    const foreign = (id: string, price: number, extra: Partial<{ triggeredAt: number | null; cancelledAt: number | null; status: 'pending' | 'cancelled' | 'triggered' }>) => ({
      id, tradeRecordId: null, side: 'SHORT' as const, price, fillPrice: null,
      createdAt: at('2026-01-01T00:08:00.000Z'), triggeredAt: null, cancelledAt: null, status: 'pending' as const, foreignReplay: true,
      ...extra,
    });
    vi.mocked(getCampaignFullData).mockImplementation(async (id: string) => ({
      ...detailsById[id],
      foreignLiveOrders: [
        foreign('other-live', 93, {}),
        foreign('other-cancelled', 92, { cancelledAt: at('2026-01-01T00:20:00.000Z'), status: 'cancelled' }),
        foreign('other-triggered', 91, { triggeredAt: at('2026-01-01T00:30:00.000Z'), status: 'triggered' }),
      ],
    }));
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/winner']}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('foreign-replay-order-legend')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    const group = screen.getByTestId('foreign-replay-order-group');
    expect(group).toHaveTextContent('来自另一次回放 · 仍挂着 1 · 已了结 2');
    expect(group).not.toHaveTextContent('仍挂着 3');
    expect(within(group).getAllByTestId('foreign-replay-order-chip')).toHaveLength(3);
  }, 30_000);

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

    // 【用户要求】胜率统一 50%：b = 2 → E = 0.5 × 2 − 0.5，不受别的战役加载成败影响
    await waitFor(() => expect(screen.getByText('+0.50R')).toBeInTheDocument());
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
