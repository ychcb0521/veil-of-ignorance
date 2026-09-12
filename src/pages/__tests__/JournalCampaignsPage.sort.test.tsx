import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import JournalCampaignsPage from '../JournalCampaignsPage';

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return {
    ...actual,
    fetchLegExitPriceCorrections: vi.fn(async () => ({})),
  };
});

const { mockUser, mockListDeletedCampaigns, mockRestoreCampaign, mockPermanentlyDeleteCampaign } = vi.hoisted(() => ({
  mockUser: { id: 'user-1', email: 'desk@example.com' },
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
    initial_leverage: 3,
    final_realized_pnl: 30,
    importance_weight: 5,
  }),
  makeCampaign({
    id: 'newest',
    title: 'Newest Operation',
    opened_at: '2026-03-01T00:00:00.000Z',
    closed_at: '2026-03-02T00:00:00.000Z',
    initial_main_size_usdt: 1000,
    initial_leverage: 20,
    final_realized_pnl: 50,
    importance_weight: 1,
  }),
  makeCampaign({
    id: 'best-pnl',
    title: 'Best PnL',
    opened_at: '2026-02-01T00:00:00.000Z',
    closed_at: '2026-02-02T00:00:00.000Z',
    initial_main_size_usdt: 100000,
    initial_leverage: 10,
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
      pre_account_equity_usdt: 100,
      pre_opportunity_quality_payoff_ratio: 5,
      pre_opportunity_quality_drawdown_pct: 2,
    }),
  ],
  newest: [
    makeLeg({
      id: 'newest-leg',
      trade_record_id: 'newest-record',
      pre_real_time: '2026-01-10T00:00:00.000Z',
      post_real_close_time: '2026-12-01T00:00:00.000Z',
      pre_account_equity_usdt: 10_000,
      pre_opportunity_quality_payoff_ratio: 5,
      pre_opportunity_quality_drawdown_pct: 5,
      post_opportunity_quality_payoff_ratio: 9,
      post_opportunity_quality_drawdown_pct: 3,
    }),
  ],
  'best-pnl': [
    makeLeg({
      id: 'best-pnl-leg',
      trade_record_id: 'best-pnl-record',
      pre_real_time: '2026-03-02T00:00:00.000Z',
      pre_account_equity_usdt: 40_000,
      post_opportunity_quality_drawdown_pct: 1,
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
      pre_account_equity_usdt: 500,
      pre_opportunity_quality_drawdown_pct: 4,
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
  makeRecord('high-importance-record', '2026-04-03T00:00:00.000Z', 1, 30),
  makeRecord('newest-record', '2026-01-10T00:00:00.000Z', 10, 50),
  makeRecord('best-pnl-record', '2026-03-02T00:00:00.000Z', 1_000, 1_000),
  makeRecord('late-close-record', '2026-02-01T00:00:00.000Z', 0.5, -20),
];

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    profile: { display_name: '主账户' },
  }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    balance: 100_000,
    positionsMap: {},
    priceMap: {},
    // 一键结束用它当「没有成交也没有事件」时的兜底时间戳。
    getEffectiveTime: () => Date.parse('2026-08-23T12:00:00.000Z'),
  }),
}));

vi.mock('@/lib/journalApi', () => ({
  appendCampaignEvent: vi.fn(async () => undefined),
  closeCampaign: vi.fn(async () => undefined),
  deleteCampaign: vi.fn(),
  // 列表页共用一份本地快照，避免 147 场各解析一遍（实测 2~6 秒主线程阻塞）。
  readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
  getCampaignFullData: vi.fn(async (id: string) => ({
    campaign: [...campaigns, deletedCampaign].find(campaign => campaign.id === id),
    legs: legsByCampaign[id] ?? [],
    tradeRecords: tradeHistory.filter(record => (legsByCampaign[id] ?? []).some(leg => leg.trade_record_id === record.id)),
    pendingOrders: [],
    reverseHedgeOrders: reverseOrdersByCampaign[id as keyof typeof reverseOrdersByCampaign] ?? [],
  })),
  listAllCampaigns: vi.fn(async () => campaigns),
  listDeletedCampaigns: mockListDeletedCampaigns,
  permanentlyDeleteCampaign: mockPermanentlyDeleteCampaign,
  restoreCampaign: mockRestoreCampaign,
  updateCampaignImportance: vi.fn(async (_id: string, weight: number) => weight),
}));

/**
 * pnl 必须与所属战役的 final_realized_pnl 对得上。
 * 这些 fixture 曾经把每条记录的 pnl 都写死成 10、而战役声称 30/50/1000/−20——
 * 落库值本就是由 legs + records 推导出来的缓存，二者不一致在真实数据里不成立，
 * 也让「缓存与重算谁优先」这个问题被 fixture 悄悄预设了答案。
 */
function makeRecord(id: string, objectiveTime: string, quantity: number, pnl = 10): TradeRecord {
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
    pnl,
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
    campaign_code: overrides.campaign_code ?? `C-${overrides.id ?? 'campaign'}`,
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: overrides.status ?? 'closed_profit',
    strategy_template: 'custom',
    title: overrides.title ?? 'Campaign',
    opened_at: overrides.opened_at ?? now,
    closed_at: overrides.closed_at ?? null,
    initial_main_size_usdt: overrides.initial_main_size_usdt ?? null,
    initial_leverage: overrides.initial_leverage ?? null,
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
    pre_opportunity_quality_payoff_ratio: overrides.pre_opportunity_quality_payoff_ratio ?? null,
    pre_opportunity_quality_drawdown_pct: overrides.pre_opportunity_quality_drawdown_pct ?? null,
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
    pre_account_equity_usdt: overrides.pre_account_equity_usdt ?? null,
    post_outcome: null,
    post_realized_pnl: null,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    post_opportunity_quality_payoff_ratio: overrides.post_opportunity_quality_payoff_ratio ?? null,
    post_opportunity_quality_drawdown_pct: overrides.post_opportunity_quality_drawdown_pct ?? null,
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

function LocationProbe() {
  const location = useLocation();
  const state = location.state as { fromCampaignList?: boolean } | null;
  return (
    <div data-testid="location-probe">
      {location.pathname}{location.search}|{state?.fromCampaignList ? 'from-list' : 'direct'}
    </div>
  );
}

/** 挂在列表路由旁边、只读 search 的探针：切换视图后不离开列表也能断言 URL。 */
function SearchProbe() {
  const location = useLocation();
  return <div data-testid="location-probe-search">{location.search}</div>;
}

describe('JournalCampaignsPage sorting', () => {
  it('【用户要求】按杠杆倍数排序：默认从大到小，再点一次切到从小到大，没记杠杆的战役不进入这一档', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
    fireEvent.click(screen.getByTestId('campaign-sort-leverage'));

    // 20x → 10x → 3x；Late Close 没记杠杆，各腿也没有，被排除在这一档之外
    await waitFor(() => expect(cardOrder()).toEqual(['Newest Operation', 'Best PnL', 'High Importance']));
    expect(screen.getByTestId('campaign-sort-leverage')).toHaveAttribute('data-sort-direction', 'desc');

    fireEvent.click(screen.getByTestId('campaign-sort-leverage'));
    await waitFor(() => expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Newest Operation']));
    expect(screen.getByTestId('campaign-sort-leverage')).toHaveAttribute('data-sort-direction', 'asc');
    // 封面上就能核对排序：每张卡片自己写着杠杆
    expect(screen.getAllByTestId('campaign-leverage').map(node => node.textContent))
      .toEqual(['3x', '10x', '20x']);
  }, 15_000);

  it('【用户要求】战役封面显示杠杆倍数；没有记录杠杆的战役不显示这枚标签', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <JournalCampaignsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
    // 默认按操作时间排：四张卡片里三张有杠杆，Late Close 没记、各腿也没有
    expect(screen.getAllByTestId('campaign-leverage')).toHaveLength(3);
    const card = screen.getAllByTestId('campaign-card')
      .find(node => node.textContent?.includes('Newest Operation'))!;
    expect(card.querySelector('[data-testid="campaign-leverage"]')?.textContent).toBe('20x');
    expect(card.querySelector('[data-testid="campaign-leverage"]')?.getAttribute('title'))
      .toContain('主力开仓那一刻记录的初始杠杆');
  }, 15_000);

  it('removes the legacy mutual scope while preserving sort parameters and detail navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?scope=mutual&sort=importance&direction=asc']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
    expect(screen.getAllByTestId('campaign-card')[0])
      .toHaveTextContent('C-主账户-BEST-PNL');
    expect(screen.queryByRole('button', { name: '我的战役' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '互关可见' })).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-sort-importance')).toHaveAttribute('data-sort-direction', 'asc');
    expect(cardOrder()).toEqual(['Best PnL', 'Newest Operation', 'Late Close', 'High Importance']);

    expect(screen.queryByTestId('campaign-odds-scatter-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-metric-chart-toggles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-odds-chart-toggle')).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('campaign-sort-captureRate'));
    const oddsChartToggle = await screen.findByTestId('campaign-odds-chart-toggle');
    expect(oddsChartToggle).toHaveAttribute('aria-expanded', 'false');
    expect(oddsChartToggle).toHaveTextContent('查看散点图');
    fireEvent.click(oddsChartToggle);

    expect(screen.getByTestId('campaign-odds-scatter-panel')).toBeInTheDocument();
    // 盈亏比默认打开的是**分布**：要判断的是形状（右尾多长、亏损有没有被止损墙挡住），
    // 与战役先后无关。时序是第二个问题，用面板右上角的切换键取回。
    expect(screen.getByTestId('campaign-odds-view-distribution')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-odds-view-time')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute(
      'data-metric-key',
      'oddsDistribution',
    );
    // 分布图不是时序图：时序专属的 legacy testid 此刻不该存在。
    expect(screen.queryByTestId('campaign-odds-scroll-area')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('campaign-odds-view-time'));
    expect(screen.getByTestId('campaign-odds-view-time')).toHaveAttribute('aria-pressed', 'true');

    const oddsScrollArea = screen.getByTestId('campaign-odds-scroll-area');
    expect(oddsScrollArea).toHaveClass('aspect-[8/5]');
    expect(oddsScrollArea).toHaveAttribute('data-layout', 'campaign-scatter-landscape');
    // 点位尺寸不再随点数缩小（旧 data-marker-max-size 在 N=192 时给出 4px，正是模糊病根），
    // 改为固定 8px 实心 + 由布局决定 fit / scroll。
    expect(oddsScrollArea).toHaveAttribute('data-mark-size', '8');
    expect(['fit', 'scroll']).toContain(oddsScrollArea.getAttribute('data-fit-mode'));
    const oddsBandCounts = screen.getAllByTestId('campaign-odds-band-count');
    expect(
      oddsBandCounts.reduce((sum, node) => sum + Number(node.getAttribute('data-count')), 0),
    ).toBe(3);
    expect(oddsBandCounts.every(node => node.classList.contains('text-[8px]'))).toBe(true);
    expect(
      [...screen.getByTestId('campaign-odds-scatter-plot').querySelectorAll('[data-campaign-id]')]
        .map(node => node.getAttribute('data-campaign-id')),
    ).toEqual(['late-close', 'best-pnl', 'high-importance']);
    expect(screen.getByTestId('campaign-odds-point-late-close')).toHaveAttribute('data-odds-sign', 'negative');
    expect(screen.getByTestId('campaign-odds-point-best-pnl')).toHaveAttribute('data-odds-sign', 'positive');
    expect(screen.getByTestId('campaign-odds-point-high-importance')).toHaveAttribute('data-odds-sign', 'positive');
    expect(screen.getByTestId('campaign-odds-point-late-close')).toHaveAttribute(
      'data-marker-shape',
      'diamond',
    );
    expect(screen.getByTestId('campaign-odds-point-best-pnl')).toHaveAttribute(
      'data-marker-shape',
      'circle',
    );
    // 点位改为真实 SVG 图形、颜色走 CSS 变量，身份改由 data-series-token 断言；
    // 原来锁定的十六进制值移交 src/lib/__tests__/chartTokens.contract.test.ts 继续覆盖。
    expect(screen.getByTestId('campaign-odds-point-late-close'))
      .toHaveAttribute('data-series-token', 'loss');
    expect(screen.getByTestId('campaign-odds-point-best-pnl'))
      .toHaveAttribute('data-series-token', 'profit');
    fireEvent.mouseEnter(screen.getByTestId('campaign-odds-point-best-pnl'));
    expect(screen.getByTestId('campaign-odds-scatter-plot')).toHaveTextContent('Best PnL');
    expect(screen.getByTestId('campaign-odds-point-best-pnl')).toHaveAttribute('aria-pressed', 'true');
    const oddsTickLabels = screen.getAllByTestId('campaign-odds-y-tick');
    expect(oddsTickLabels.length).toBeGreaterThan(0);
    expect(
      oddsTickLabels.every(label => (
        Number.isInteger(Number(label.getAttribute('data-tick-value')))
        && !label.textContent?.includes('.')
      )),
    ).toBe(true);
    const oddsGridLines = screen.getAllByTestId('campaign-odds-integer-grid-line');
    expect(oddsGridLines.length).toBeGreaterThan(0);
    // 网格线由 div 的 border-t-[0.5px]（浏览器只能反锯齿成灰雾）换成 1px 实线 SVG hairline。
    expect(
      oddsGridLines.every(line => (
        Number.isInteger(Number(line.getAttribute('data-grid-value')))
        && line.tagName.toLowerCase() === 'line'
        && (line as unknown as SVGLineElement).style.stroke === 'var(--chart-grid)'
        && (line as unknown as SVGLineElement).style.strokeWidth === '1'
        && !line.getAttribute('stroke-dasharray')
      )),
    ).toBe(true);
    expect(screen.getByTestId('campaign-odds-loss-boundary-label')).toHaveTextContent('-1R');
    expect(screen.getByTestId('campaign-odds-loss-boundary-line')).toHaveAttribute(
      'data-reference-value',
      '-1',
    );
    // 只有阈值线配虚线：网格是实线，-1R 是 threshold。
    const lossBoundaryLine = screen.getByTestId('campaign-odds-loss-boundary-line') as unknown as SVGLineElement;
    expect(lossBoundaryLine).toHaveAttribute('data-reference-kind', 'threshold');
    expect(lossBoundaryLine.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(lossBoundaryLine.style.stroke).toBe('var(--chart-threshold)');
    const oddsGuideToggle = screen.getByTestId('campaign-metric-guide-toggle-odds');
    expect(oddsGuideToggle).toHaveAccessibleName('查看盈亏比散点图说明');
    expect(oddsGuideToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('campaign-metric-guide-odds')).not.toBeInTheDocument();
    fireEvent.click(oddsGuideToggle);
    expect(oddsGuideToggle).toHaveAccessibleName('收起盈亏比散点图说明');
    expect(oddsGuideToggle).toHaveAttribute('aria-expanded', 'true');
    const oddsGuide = screen.getByTestId('campaign-metric-guide-odds');
    expect(oddsGuide).toHaveTextContent('横轴');
    expect(oddsGuide).toHaveTextContent('纵轴');
    expect(oddsGuide).toHaveTextContent('颜色');
    expect(oddsGuide).toHaveTextContent('点位');
    expect(oddsGuide).toHaveTextContent('黄色 -1R 虚线');
    fireEvent.click(oddsGuideToggle);
    expect(screen.queryByTestId('campaign-metric-guide-odds')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-metric-chart-back')).toHaveAccessibleName(
      '收起盈亏比散点图并返回战役列表',
    );
    fireEvent.click(screen.getByTestId('campaign-metric-chart-back'));
    expect(screen.queryByTestId('campaign-odds-scatter-panel')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('campaign-card')).toHaveLength(4);

    expect(screen.queryByTestId('campaign-metric-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-expectedDrawdownPct-chart-toggle')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('campaign-sort-expectedDrawdownPct'));
    const drawdownChartToggle = await screen.findByTestId('campaign-expectedDrawdownPct-chart-toggle');
    expect(drawdownChartToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(drawdownChartToggle);

    expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute(
      'data-metric-key',
      'expectedDrawdownPct',
    );
    expect(screen.queryByTestId('campaign-odds-loss-boundary-line')).not.toBeInTheDocument();
    const metricScrollArea = screen.getByTestId('campaign-metric-scroll-area');
    expect(metricScrollArea).toHaveClass('aspect-[8/5]');
    expect(metricScrollArea).toHaveAttribute('data-layout', 'campaign-scatter-landscape');
    const metricBandCounts = screen.getAllByTestId('campaign-metric-band-count');
    expect(
      metricBandCounts.reduce((sum, node) => sum + Number(node.getAttribute('data-count')), 0),
    ).toBe(3);
    expect(
      [...screen.getByTestId('campaign-metric-scatter-plot').querySelectorAll('[data-campaign-id]')]
        .map(node => node.getAttribute('data-campaign-id')),
    ).toEqual(['late-close', 'best-pnl', 'high-importance']);
    const drawdownTicks = screen.getAllByTestId(
      'campaign-metric-y-tick-expectedDrawdownPct',
    );
    const drawdownTickValues = drawdownTicks.map(node =>
      Number(node.getAttribute('data-tick-value')),
    );
    expect(drawdownTickValues[0]).toBe(0);
    expect(drawdownTickValues.every(value => value <= 0)).toBe(true);

    // 预期回撤只表达风险距离，颜色改由战役盈亏决定：盈利绿、亏损红。
    expect(screen.getByTestId('campaign-metric-point-expectedDrawdownPct-late-close'))
      .toHaveAttribute('data-pnl-sign', 'negative');
    expect(screen.getByTestId('campaign-metric-point-expectedDrawdownPct-best-pnl'))
      .toHaveAttribute('data-pnl-sign', 'positive');
    expect(screen.getByTestId('campaign-metric-point-expectedDrawdownPct-high-importance'))
      .toHaveAttribute('data-pnl-sign', 'positive');

    const drawdownPlot = screen.getByTestId('campaign-metric-scatter-plot');
    const drawdownPointNodes = Array.from(
      drawdownPlot.querySelectorAll<HTMLElement>('button[data-campaign-id]'),
    );
    expect(drawdownPointNodes.length).toBeGreaterThan(0);
    expect(
      drawdownPointNodes.every(node => Number(node.dataset.metricValue) < 0),
    ).toBe(true);
    const shallowDrawdownPoint = drawdownPointNodes.reduce((best, node) =>
      Number(node.dataset.metricValue) > Number(best.dataset.metricValue) ? node : best,
    );
    const deepDrawdownPoint = drawdownPointNodes.reduce((best, node) =>
      Number(node.dataset.metricValue) < Number(best.dataset.metricValue) ? node : best,
    );
    expect(Number.parseFloat(deepDrawdownPoint.style.top)).toBeGreaterThan(
      Number.parseFloat(shallowDrawdownPoint.style.top),
    );
    const drawdownGuideToggle = screen.getByTestId(
      'campaign-metric-guide-toggle-expectedDrawdownPct',
    );
    fireEvent.click(drawdownGuideToggle);
    const drawdownGuide = screen.getByTestId('campaign-metric-guide-expectedDrawdownPct');
    expect(drawdownGuide).toHaveTextContent('占主力开仓价的百分比');
    expect(drawdownGuide).toHaveTextContent('绿色：该战役最终盈利');
    expect(drawdownGuide).toHaveTextContent('红色：该战役最终亏损');
    expect(drawdownGuide).toHaveTextContent('0%');
    expect(drawdownGuide).toHaveTextContent('纵轴向下');

    fireEvent.contextMenu(screen.getByTestId('campaign-sort-captureRate'));
    fireEvent.click(await screen.findByTestId('campaign-odds-chart-toggle'));
    // 再次打开仍落在默认的分布视图，而不是记住上一次切过去的时序。
    expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute(
      'data-metric-key',
      'oddsDistribution',
    );

    // 散点图的选中指标随 URL 带入详情页，返回时才能落回同一张图。
    fireEvent.click(screen.getByTestId('campaign-metric-point-oddsDistribution-best-pnl'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/journal/campaigns/best-pnl?sort=importance&direction=asc&chart=oddsDistribution|from-list',
    );
  }, 15_000);

  it('从 URL 的 chart 参数恢复散点图，使详情页返回后仍停在图上', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=importance&direction=asc&chart=expectedDrawdownPct']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    // 首帧即恢复散点图面板，而不是掉回只有卡片列表的状态。
    const plot = await screen.findByTestId('campaign-metric-scatter-plot');
    expect(plot).toHaveAttribute('data-metric-key', 'expectedDrawdownPct');
    expect(screen.getByTestId('campaign-odds-scatter-panel')).toBeInTheDocument();
  }, 15_000);

  it('【用户要求】镜像止盈多一种「柱状」看法：同一档的战役堆成一根柱，空档保留，切换写回 URL', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?chart=mirrorTp']}>
        <Routes>
          <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const timePlot = await screen.findByTestId('campaign-metric-scatter-plot');
    expect(timePlot).toHaveAttribute('data-metric-key', 'mirrorTp');
    // 时序视图下切换键已经在，且停在「时序」
    expect(screen.getByTestId('campaign-mirrorTp-view-time')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-mirrorTp-view-bars')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('campaign-mirrorTp-view-bars'));

    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'mirrorTpBars'));
    expect(screen.getByTestId('campaign-mirrorTp-view-bars')).toHaveAttribute('aria-pressed', 'true');
    // 切换写回地址栏：从散点图点进详情再返回时，落回的是同一张图
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('chart=mirrorTpBars');

    // 四个结果档位都在轴上——一场都没有的档位留空柱，「持平 0 场」本身就是结论
    const summary = screen.getByTestId('campaign-metric-summary-mirrorTpBars');
    for (const label of ['未实现', '亏损', '持平', '盈利']) {
      expect(summary.textContent).toContain(label);
    }
    expect(screen.getByTestId('campaign-metric-bar-count-mirrorTpBars-2')).toHaveTextContent('持平 0 场');

    // 同一档的点聚在自己那根柱里（档内允许蜂群展开，避免同一点位互相盖住），
    // 档与档之间沿横轴按结果等级递增排开
    const barsPlot = screen.getByTestId('campaign-metric-scatter-plot');
    const buttons = [...barsPlot.querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(buttons.length).toBeGreaterThan(0);
    const byColumn = new Map<number, number[]>();
    for (const node of buttons) {
      const value = Number(node.dataset.metricValue);
      byColumn.set(value, [...(byColumn.get(value) ?? []), Number.parseFloat(node.style.left)]);
    }
    const columns = [...byColumn.entries()]
      .map(([value, lefts]) => ({
        value,
        center: lefts.reduce((sum, left) => sum + left, 0) / lefts.length,
        spread: Math.max(...lefts) - Math.min(...lefts),
      }))
      .sort((a, b) => a.value - b.value);
    // jsdom 没有布局，宽度都是 0，所以只断言相对次序（档与档的排布留给浏览器里的实测）
    for (let index = 1; index < columns.length; index += 1) {
      expect(columns[index].center).toBeGreaterThan(columns[index - 1].center);
    }
    // 柱状视图不画时序视图那套右侧档位计数，也没有密度曲线
    expect(screen.queryByTestId('campaign-metric-band-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-metric-density-curve-mirrorTpBars')).not.toBeInTheDocument();

    // 【用户要求】四根柱的柱脚各写自己的场数——柱高只读得出大概，精确值要就地可读。
    // 而且写的必须就是这一柱真正画出来的点数，不能是另算的一份。
    for (const value of [0, 1, 2, 3]) {
      const drawn = buttons.filter(node => Number(node.dataset.metricValue) === value).length;
      expect(screen.getByTestId(`chart-category-count-${value}`).textContent).toBe(`${drawn} 场`);
    }

    // 【用户要求】点开一个点要读得到这一场的 b：档位只有四种，b 才说明赚亏了多少个 R
    const labelled = buttons.map(node => node.getAttribute('aria-label') ?? '');
    expect(labelled.some(label => /· b [+-]\d+\.\d{2}R/.test(label))).toBe(true);
  }, 15_000);

  it('【用户要求】镜像止盈默认就开柱状视图，不必再手动切', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=mirrorTp&direction=desc']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.contextMenu(await screen.findByTestId('campaign-sort-mirrorTp'));
    fireEvent.click(await screen.findByTestId('campaign-mirrorTp-chart-toggle'));

    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'mirrorTpBars'));
    expect(screen.getByTestId('campaign-mirrorTp-view-bars')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-mirrorTp-view-time')).toHaveAttribute('aria-pressed', 'false');
  }, 15_000);

  it('?chart=oddsDistribution 恢复分布图，「时序 | 分布」互切并写回 URL，排序行按钮把它当作盈亏比图收起', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=importance&direction=asc&chart=oddsDistribution']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const plot = await screen.findByTestId('campaign-metric-scatter-plot');
    expect(plot).toHaveAttribute('data-metric-key', 'oddsDistribution');
    expect(screen.queryByTestId('campaign-odds-scatter-plot')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-odds-view-distribution')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-odds-view-time')).toHaveAttribute('aria-pressed', 'false');
    // 竖向参考线：止损墙虚线琥珀、盈亏平衡实线；标签用墨色。
    const wall = screen.getByTestId('campaign-metric-loss-wall-oddsDistribution') as unknown as SVGLineElement;
    expect(wall).toHaveAttribute('data-reference-axis', 'x');
    expect(wall).toHaveAttribute('data-reference-kind', 'threshold');
    expect(wall.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(wall.style.stroke).toBe('var(--chart-threshold)');
    expect(screen.getByTestId('campaign-metric-loss-wall-oddsDistribution-label')).toHaveTextContent('-1R 止损');
    const breakEven = screen.getByTestId('campaign-metric-break-even-oddsDistribution') as unknown as SVGLineElement;
    expect(breakEven).toHaveAttribute('data-reference-axis', 'x');
    expect(breakEven.getAttribute('stroke-dasharray')).toBeNull();
    // 点位按 b 升序排（late-close −0.8 → best-pnl +0.5 → high-importance +3），横向位置递增。
    const distributionButtons = [...plot.querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(distributionButtons.map(node => node.dataset.campaignId)).toEqual(['late-close', 'best-pnl', 'high-importance']);
    const lefts = distributionButtons.map(node => Number.parseFloat(node.style.left));
    expect(lefts[0]).toBeLessThan(lefts[1]);
    expect(lefts[1]).toBeLessThan(lefts[2]);
    expect(distributionButtons.every(node => node.style.top.endsWith('%'))).toBe(true);
    expect(screen.getByTestId('campaign-metric-point-oddsDistribution-late-close')).toHaveAttribute('data-marker-shape', 'diamond');
    expect(screen.getByTestId('campaign-metric-density-curve-oddsDistribution').tagName.toLowerCase()).toBe('path');
    expect(screen.getByTestId('campaign-metric-win-rate-oddsDistribution')).toHaveTextContent('胜率 67% (2/3)');
    expect(screen.getByTestId('campaign-metric-tail-count-oddsDistribution')).toHaveTextContent('右尾 >+5R 0 场');
    expect(screen.queryByTestId('campaign-metric-band-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-metric-scroll-area')).toHaveAttribute('data-fit-mode', 'fit');
    expect(screen.getByTestId('campaign-metric-scroll-area')).toHaveClass('aspect-[8/5]');
    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-oddsDistribution'));
    const guide = screen.getByTestId('campaign-metric-guide-oddsDistribution');
    expect(guide).toHaveTextContent('盈亏比 b 本身');
    expect(guide).toHaveTextContent('止损墙');
    expect(guide).toHaveTextContent('核密度');

    // 切回时序：URL 改成 chart=odds，旧的 campaign-odds-* testid 原样回来。
    fireEvent.click(screen.getByTestId('campaign-odds-view-time'));
    expect(screen.getByTestId('campaign-odds-scatter-plot')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-odds-loss-boundary-line')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-odds-loss-boundary-label')).toHaveTextContent('-1R');
    expect(screen.queryByTestId('campaign-metric-scatter-plot')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-odds-view-time')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('campaign-odds-point-best-pnl'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/journal/campaigns/best-pnl?sort=importance&direction=asc&chart=odds|from-list',
    );
  }, 15_000);

  it('分布图打开时排序行按钮读作「收起散点图」并能直接收起', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=importance&direction=asc&chart=odds']}>
        <Routes>
          <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId('campaign-odds-scatter-plot');
    fireEvent.click(screen.getByTestId('campaign-odds-view-distribution'));
    expect(await screen.findByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'oddsDistribution');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('chart=oddsDistribution');

    fireEvent.contextMenu(screen.getByTestId('campaign-sort-captureRate'));
    const toggle = await screen.findByTestId('campaign-odds-chart-toggle');
    expect(toggle).toHaveTextContent('收起散点图');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.getAttribute('aria-label')).not.toContain('时序');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('campaign-odds-scatter-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-odds-view-switch')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe-search')).not.toHaveTextContent('chart=');
  }, 15_000);

  it('DSI / USI 贡献率各自只收一侧样本，且组内合计 100%', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));

    // DSI 贡献：只有亏损战役 late-close 参与，独占 100%。
    fireEvent.contextMenu(screen.getByTestId('campaign-sort-dsiContribution'));
    fireEvent.click(await screen.findByTestId('campaign-dsiContribution-chart-toggle'));
    const dsiPlot = screen.getByTestId('campaign-metric-scatter-plot');
    expect(dsiPlot).toHaveAttribute('data-metric-key', 'dsiContribution');
    const dsiPoints = Array.from(dsiPlot.querySelectorAll<HTMLElement>('button[data-campaign-id]'));
    expect(dsiPoints.map(node => node.dataset.campaignId)).toEqual(['late-close']);
    expect(Number(dsiPoints[0].dataset.metricValue)).toBeCloseTo(100, 6);

    // USI 贡献：只有盈利战役参与，彼此合计 100%。
    fireEvent.contextMenu(screen.getByTestId('campaign-sort-usiContribution'));
    fireEvent.click(await screen.findByTestId('campaign-usiContribution-chart-toggle'));
    const usiPlot = screen.getByTestId('campaign-metric-scatter-plot');
    expect(usiPlot).toHaveAttribute('data-metric-key', 'usiContribution');
    const usiPoints = Array.from(usiPlot.querySelectorAll<HTMLElement>('button[data-campaign-id]'));
    expect(usiPoints.length).toBeGreaterThan(1);
    expect(usiPoints.map(node => node.dataset.campaignId)).not.toContain('late-close');
    expect(
      usiPoints.reduce((sum, node) => sum + Number(node.dataset.metricValue), 0),
    ).toBeCloseTo(100, 6);
  }, 15_000);

  it('关闭散点图会移除 chart 参数', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?chart=expectedDrawdownPct']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('campaign-metric-scatter-plot');
    fireEvent.click(screen.getByTestId('campaign-metric-chart-back'));
    await waitFor(() => expect(screen.getAllByTestId('campaign-card').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('campaign-metric-scatter-plot')).not.toBeInTheDocument();
  }, 15_000);

  it('defaults to operation time and toggles sort direction for each field', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <JournalCampaignsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));

    expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Late Close', 'Newest Operation']);
    expect(
      [...screen.getByTestId('campaign-sort-controls').querySelectorAll('button[data-testid^="campaign-sort-"]')]
        .map(node => node.getAttribute('data-testid')),
    ).toEqual([
      'campaign-sort-importance',
      'campaign-sort-time',
      'campaign-sort-expectedDrawdownPct',
      'campaign-sort-opportunityQuality',
      'campaign-sort-captureRate',
      'campaign-sort-arithmeticExpectancy',
      'campaign-sort-geometricExpectancy',
      'campaign-sort-mirrorTp',
      'campaign-sort-dsiContribution',
      'campaign-sort-usiContribution',
      'campaign-sort-leverage',
      'campaign-sort-alpha',
    ]);
    expect(screen.getAllByTestId('campaign-operation-time').map(node => node.textContent)).toEqual([
      '操作时间：2026-04-03 08:00',
      '操作时间：2026-03-02 08:00',
      '操作时间：2026-02-01 08:00',
      '操作时间：2026-01-10 08:00',
    ]);
    expect(screen.queryByTestId('campaign-card-details')).not.toBeInTheDocument();
    expect(
      [...screen.getAllByTestId('campaign-expected-drawdown-pct')[0].parentElement!.children]
        .map(node => node.getAttribute('data-testid')),
    ).toEqual([
      'campaign-expected-drawdown-pct',
      'campaign-opportunity-quality-value',
      'campaign-payoff-ratio',
      'campaign-arithmetic-expectancy',
      'campaign-geometric-expectancy',
      'campaign-mirror-tp-status',
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: '展开战役详情' })[0]);
    const expandedDetails = screen.getByTestId('campaign-card-details');
    expect(expandedDetails).toHaveClass('flex');
    expect(expandedDetails).not.toHaveClass('grid');
    expect(expandedDetails).toHaveTextContent('战役时间：');
    expect(expandedDetails).toHaveTextContent('结构与时长：');
    expect(expandedDetails).toHaveTextContent('已实现 P&L：');
    expect(expandedDetails).toHaveTextContent('Legs：');
    fireEvent.click(screen.getByRole('button', { name: '收起战役详情' }));
    expect(screen.queryByTestId('campaign-card-details')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('campaign-payoff-ratio').map(node => node.textContent)).toEqual([
      '盈亏比：300.00%（3.00）',
      '盈亏比：50.00%（0.50）',
      '盈亏比：-80.00%（-0.80）',
      '盈亏比：—',
    ]);
    const payoffRatioValues = screen.getAllByTestId('campaign-payoff-ratio-value');
    expect(payoffRatioValues[0]).toHaveClass('text-[#0ECB81]');
    expect(payoffRatioValues[1]).toHaveClass('text-[#0ECB81]');
    expect(payoffRatioValues[2]).toHaveClass('text-[#F6465D]');
    expect(payoffRatioValues[3]).toHaveClass('text-foreground/85');
    expect(screen.getAllByTestId('campaign-expected-drawdown-pct').map(node => node.textContent)).toEqual([
      '预期回撤：10.00%',
      '预期回撤：2.00%',
      '预期回撤：50.00%',
      '预期回撤：—',
    ]);
    expect(screen.getAllByTestId('campaign-opportunity-quality-value').map(node => node.textContent)).toEqual([
      '机会质量：0.30',
      '机会质量：0.50', // max（0.50, 1） ÷ 2% = 0.50
      '机会质量：0.02', // max（−0.80, 1） ÷ 50% = 0.02
      '机会质量：—',
    ]);
    expect(screen.getAllByTestId('campaign-arithmetic-expectancy').map(node => node.textContent)).toEqual([
      '算术期望：+1.67R',
      '算术期望：+0.00R',
      '算术期望：-0.87R',
      '算术期望：—',
    ]);
    // 【用户要求】单场几何期望 = Gᵢ − 1 = bᵢ × 0.1；bᵢ 为负时它也为负
    expect(screen.getAllByTestId('campaign-geometric-expectancy').map(node => node.textContent)).toEqual([
      '几何期望：+30.0%/笔',   // b = +3.00
      '几何期望：+5.0%/笔',    // b = +0.50
      '几何期望：-8.0%/笔',    // b = −0.80，负 b 给负值
      '几何期望：—',           // 没有有效 bᵢ
    ]);
    expect(screen.queryByText(/峰值浮盈/)).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-label', '操作时间，从大到小排序');
    const sortControls = screen.getByTestId('campaign-sort-controls');
    const metricsStrip = screen.getByTestId('campaign-metrics-strip');
    expect(sortControls).not.toContainElement(screen.getByTestId('campaign-valid-count'));
    expect(metricsStrip).toContainElement(screen.getByTestId('campaign-valid-count'));
    expect(metricsStrip).toContainElement(screen.getByTestId('campaign-opportunity-quality'));
    expect(metricsStrip).toContainElement(screen.getByTestId('campaign-asymmetric-risk'));
    expect(metricsStrip).toContainElement(screen.getByTestId('campaign-geometric-edge'));
    expect(screen.getByTestId('campaign-valid-count')).toHaveTextContent('有效战役（3）');
    expect(screen.getByTestId('campaign-valid-count')).toHaveAttribute(
      'aria-label',
      '有效战役 3 场，其中盈利 2 场，亏损 1 场，点击查看最大预期亏损计算说明',
    );
    fireEvent.click(screen.getByTestId('campaign-valid-count'));
    expect(screen.getByText('有效战役与最大预期亏损')).toBeInTheDocument();
    expect(screen.getByText(/Lᵢ = 主力开仓名义仓位 × max/)).toBeInTheDocument();
    expect(screen.getByText(/主力开仓名义仓位按初始 M 与镜像 Legs 去重求和/)).toBeInTheDocument();
    expect(screen.getByText(/历史战役优先使用保存的原始委托价/)).toBeInTheDocument();
    expect(screen.getByText(/只有战役已结束/)).toBeInTheDocument();
    expect(screen.getByText('盈利').parentElement).toHaveTextContent('盈利2');
    expect(screen.getByText('亏损').parentElement).toHaveTextContent('亏损1');
    fireEvent.click(screen.getByTestId('campaign-valid-count'));
    expect(screen.queryByText('有效战役与最大预期亏损')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-win-rate')).toHaveTextContent('胜率（66.67%）');
    expect(screen.getByTestId('campaign-win-rate')).toHaveAttribute(
      'aria-label',
      '盈利战役 2 场，亏损战役 1 场，胜率 66.67%',
    );
    fireEvent.click(screen.getByTestId('campaign-win-rate'));
    expect(screen.getByText('胜率计算公式')).toBeInTheDocument();
    expect(screen.getByText('P(赢) = 盈利战役数 ÷（盈利战役数 + 亏损战役数）')).toBeInTheDocument();
    expect(screen.getByText('= 2 ÷（2 + 1）')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-win-rate'));
    expect(screen.queryByText('胜率计算公式')).not.toBeInTheDocument();
    // 【用户要求】概览那一项只报盈利战役的平均 b（赢的时候平均赢多少 R），不报混合均值 0.90
    const payoffChip = screen.getByTestId('campaign-average-payoff-ratio');
    expect(payoffChip.textContent).toMatch(/平均盈亏比（\+\d+\.\d{2}R）/);
    expect(payoffChip.textContent).not.toContain('0.90');
    expect(payoffChip.getAttribute('aria-label')).toContain('盈利战役 2 场');
    expect(payoffChip.getAttribute('aria-label')).toContain('亏损战役平均');
    fireEvent.click(payoffChip);
    // 浮层里盈利侧的数就是概览那一项显示的数
    expect(payoffChip.textContent)
      .toContain(screen.getByTestId('campaign-win-payoff-ratio').textContent!);
    expect(screen.getByText('平均盈亏比计算公式')).toBeInTheDocument();
    expect(screen.getByText('b̄赢 = Σ 盈利战役 bᵢ ÷ 盈利战役数')).toBeInTheDocument();
    // 【用户要求】亏损侧也要看得到
    expect(screen.getByText('盈利战役（2 场）')).toBeInTheDocument();
    expect(screen.getByText('亏损战役（1 场）')).toBeInTheDocument();
    const winMean = Number(screen.getByTestId('campaign-win-payoff-ratio').textContent!.replace(/[+R]/g, ''));
    const lossMean = Number(screen.getByTestId('campaign-loss-payoff-ratio').textContent!.replace(/[R]/g, ''));
    expect(winMean).toBeGreaterThan(0);
    expect(lossMean).toBeLessThan(0);
    // 混合均值降级成脚注但不能消失：期望值读的就是它，恒等式仍然成立
    expect(screen.getByTestId('campaign-mixed-payoff-ratio')).toHaveTextContent('0.90');
    expect(screen.getByText('= 2.70 ÷ 3（亏损以负值原样参与求和）')).toBeInTheDocument();
    expect((2 * winMean + 1 * lossMean) / 3).toBeCloseTo(0.9, 2);
    fireEvent.click(screen.getByTestId('campaign-average-payoff-ratio'));
    // 期望值就是有效战役 b 的平均值（0.90），不再是 P×b̄ − (1−P) = 0.27——那会把亏损扣两遍。
    expect(screen.getByTestId('campaign-expected-value')).toHaveTextContent('期望值（+0.90R）');
    fireEvent.click(screen.getByTestId('campaign-expected-value'));
    expect(screen.getByText('E = Σ bᵢ ÷ N')).toBeInTheDocument();
    expect(screen.getByText('= (n赢 × b̄赢 + n亏 × b̄亏) ÷ N')).toBeInTheDocument();
    // 理论公式仍并列展示，注明它假设亏损恰为 −1R、b 取赢时均值
    expect(screen.getByText('E = P(赢) × b − (1 − P(赢))')).toBeInTheDocument();
    expect(screen.getByText('= +0.90R')).toBeInTheDocument();
    expect(screen.getByText('P(赢) 仅统计设置了最大预期亏损的有效战役')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-opportunity-quality')).toHaveTextContent('机会质量（0.27）');
    expect(screen.getByTestId('campaign-opportunity-quality')).toHaveAttribute(
      'aria-label',
      '机会质量 0.27，3 场有效战役，点击查看计算公式',
    );
    fireEvent.click(screen.getByTestId('campaign-opportunity-quality'));
    expect(screen.getByText('机会质量计算公式')).toBeInTheDocument();
    expect(screen.getByText('bᵢ* = max（bᵢ, 1），Qᵢ = bᵢ* ÷ dᵢ，Q̄ = ΣQᵢ ÷ N')).toBeInTheDocument();
    expect(screen.getByText('实际盈亏比 bᵢ 小于 1（包括等于 0 或为负数）时统一按 1 计算；不取绝对值。')).toBeInTheDocument();
    expect(screen.getByText(/dᵢ = max（\|主力开仓价 − 初始对冲 A 价\|/)).toBeInTheDocument();
    expect(screen.getByText('当前 N = 3 场。')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-opportunity-quality'));
    // 【用户要求】复合战役增长率撤掉：几何期望的 W = G^n 已经表达了同一件事
    expect(screen.queryByTestId('campaign-compound-growth-rate')).not.toBeInTheDocument();
    expect(screen.queryByText('复合战役增长率计算公式')).not.toBeInTheDocument();

    // 【用户要求】几何期望：x 固定 10%、b 取盈利战役均值、p 取胜率、n 取有效战役数，并报 W = G^n
    fireEvent.click(screen.getByTestId('campaign-geometric-edge'));
    expect(screen.getByText(/W = \(1\+b·x\)\^\(n·p\).*= G\^n/)).toBeInTheDocument();
    // 公式行里代入的 b 就是概览那一项显示的盈利侧均值，x 是 10%
    const winMeanText = screen.getByTestId('campaign-average-payoff-ratio')
      .textContent!.match(/\+(\d+\.\d{2})R/)![1];
    expect(screen.getByText(new RegExp(`G = \\(1 \\+ ${winMeanText} × 10%\\)`))).toBeInTheDocument();
    expect(screen.getByText(/W = G\^3 = ×/)).toBeInTheDocument();
    expect(screen.getByText(/b = 盈利战役的平均实际盈亏比（.*2 场）/)).toBeInTheDocument();
    expect(screen.getByText(/n = 有效战役数（3 场）/)).toBeInTheDocument();
    // 【用户要求】另一种统计口径：把每场的 (1+bᵢ·x) 连乘起来，并给出每场几何平均
    expect(screen.getByText(/∏（1\+bᵢ·x）= ×/)).toBeInTheDocument();
    expect(screen.getByText(/3 场实测连乘/)).toBeInTheDocument();
    expect(screen.getByText(/每场几何平均 = ∏\^\(1\/3\) − 1 = [+-]\d+\.\d%\/笔/)).toBeInTheDocument();
    // 【用户要求】最优仓位 x* 那一行不再显示
    expect(screen.queryByText(/最优仓位 x\*/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-geometric-edge'));

    // 【用户要求】卡片上不再显示策略模板名
    expect(screen.queryByText('主仓 + 双对冲 + 镜像止盈')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-asymmetric-risk')).toHaveTextContent('不对称风险 · UPR 2.53 · Ω 4.38');
    fireEvent.click(screen.getByTestId('campaign-asymmetric-risk'));
    expect(screen.getByText('不对称风险')).toBeInTheDocument();
    expect(screen.getByText('2.526')).toBeInTheDocument();
    expect(screen.getByText('4.375')).toBeInTheDocument();
    expect(screen.getByText('0.800')).toHaveClass('text-[#0ECB81]');
    expect(screen.getByText('1.229')).toHaveClass('text-[#F6465D]');
    expect(screen.getByText('1.756')).toBeInTheDocument();
    expect(screen.getByText('0.462')).toBeInTheDocument();
    expect(screen.getByText('口径：3 场有效战役，其中盈利 2 场 / 亏损 1 场')).toBeInTheDocument();
    expect(screen.getByText('另有 1 场已结束战役因盈亏比未回填而排除。')).toBeInTheDocument();
    expect(screen.getByText('校验：Sortino = UPR − D1/σ_d（通过）')).toBeInTheDocument();
    expect(screen.getByText('U1 1.167')).toBeInTheDocument();
    expect(screen.getByText('D1 0.267')).toBeInTheDocument();
    expect(screen.getByText('Sortino 1.949')).toBeInTheDocument();
    expect(screen.getAllByText('盈利样本不足 n=2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('亏损样本不足 n=1').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('asymmetric-risk-help-toggle'));
    expect(screen.getByTestId('asymmetric-risk-help')).toHaveAttribute('open');
    expect(screen.getByText('DSI = √[Σ(bᵢ² | bᵢ ≤ 0) ÷ n_loss]')).toBeInTheDocument();
    expect(screen.getByText('USI = √[Σ(bᵢ² | bᵢ > 0) ÷ n_win] ÷ [Σ(bᵢ | bᵢ > 0) ÷ n_win]')).toBeInTheDocument();
    expect(screen.getByText('σ_u = √[Σ max(bᵢ, 0)² ÷ N]')).toBeInTheDocument();
    expect(screen.getByText('σ_d = √[Σ min(bᵢ, 0)² ÷ N]')).toBeInTheDocument();
    expect(screen.getByText('U1 = Σ max(bᵢ, 0) ÷ N；UPR = U1 ÷ σ_d')).toBeInTheDocument();
    expect(screen.getByText('D1 = Σ max(−bᵢ, 0) ÷ N；Omega = U1 ÷ D1')).toBeInTheDocument();
    expect(screen.getByText('Sortino = (U1 − D1) ÷ σ_d')).toBeInTheDocument();
    expect(screen.getByText(/无亏损样本时，DSI、σ_d、UPR、Omega、Sortino/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-asymmetric-risk'));
    expect(screen.queryByText('口径：3 场有效战役，其中盈利 2 场 / 亏损 1 场')).not.toBeInTheDocument();

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
    expect(screen.queryByText('单场盈亏比计算公式')).not.toBeInTheDocument();
    expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Late Close']);

    fireEvent.click(screen.getByTestId('campaign-sort-captureRate'));
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('aria-label', '盈亏比，从小到大排序');
    expect(screen.queryByText('单场盈亏比计算公式')).not.toBeInTheDocument();
    fireEvent.doubleClick(screen.getByTestId('campaign-sort-captureRate'));
    expect(screen.getByText('单场盈亏比计算公式')).toBeInTheDocument();
    expect(screen.getByText('bᵢ = 已实现盈亏ᵢ ÷ 初始最大预期亏损ᵢ')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('data-sort-direction', 'asc');
    expect(cardOrder()).toEqual(['Late Close', 'Best PnL', 'High Importance']);

    fireEvent.click(screen.getByTestId('campaign-sort-expectedDrawdownPct'));
    expect(screen.getByTestId('campaign-sort-expectedDrawdownPct')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-expectedDrawdownPct')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-expectedDrawdownPct')).toHaveAttribute(
      'aria-label',
      '预期回撤，从大到小排序',
    );
    expect(screen.queryByText('预期回撤计算公式')).not.toBeInTheDocument();
    expect(cardOrder()).toEqual(['Late Close', 'High Importance', 'Best PnL']);

    fireEvent.click(screen.getByTestId('campaign-sort-expectedDrawdownPct'));
    expect(screen.getByTestId('campaign-sort-expectedDrawdownPct')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-expectedDrawdownPct')).toHaveAttribute(
      'aria-label',
      '预期回撤，从小到大排序',
    );
    fireEvent.contextMenu(screen.getByTestId('campaign-sort-expectedDrawdownPct'));
    expect(screen.getByText('预期回撤计算公式')).toBeInTheDocument();
    expect(screen.getByText(/dᵢ = max（\|主力开仓价 − 初始对冲 A 价\|/)).toBeInTheDocument();
    expect(screen.getByTestId('campaign-sort-expectedDrawdownPct')).toHaveAttribute('data-sort-direction', 'asc');
    expect(cardOrder()).toEqual(['Best PnL', 'High Importance', 'Late Close']);

    fireEvent.click(screen.getByTestId('campaign-sort-opportunityQuality'));
    expect(screen.getByTestId('campaign-sort-opportunityQuality')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-opportunityQuality')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-opportunityQuality')).toHaveAttribute('aria-label', '机会质量，从大到小排序');
    expect(screen.queryByText('单场机会质量计算公式')).not.toBeInTheDocument();
    expect(cardOrder()).toEqual(['Best PnL', 'High Importance', 'Late Close']);

    fireEvent.click(screen.getByTestId('campaign-sort-opportunityQuality'));
    expect(screen.getByTestId('campaign-sort-opportunityQuality')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-opportunityQuality')).toHaveAttribute('aria-label', '机会质量，从小到大排序');
    expect(cardOrder()).toEqual(['Late Close', 'High Importance', 'Best PnL']);

    fireEvent.click(screen.getByTestId('campaign-win-rate'));
    expect(screen.queryByText('单场机会质量计算公式')).not.toBeInTheDocument();
    expect(screen.getByText('胜率计算公式')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('campaign-average-payoff-ratio'));
    expect(screen.queryByText('胜率计算公式')).not.toBeInTheDocument();
    expect(screen.getByText('平均盈亏比计算公式')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('campaign-sort-arithmeticExpectancy'));
    expect(screen.getByTestId('campaign-sort-arithmeticExpectancy')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-arithmeticExpectancy')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-arithmeticExpectancy')).toHaveAttribute('aria-label', '算术期望，从大到小排序');
    expect(screen.queryByText('单场算术期望计算公式')).not.toBeInTheDocument();
    expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Late Close']);

    fireEvent.click(screen.getByTestId('campaign-sort-arithmeticExpectancy'));
    expect(screen.getByTestId('campaign-sort-arithmeticExpectancy')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-arithmeticExpectancy')).toHaveAttribute('aria-label', '算术期望，从小到大排序');
    expect(cardOrder()).toEqual(['Late Close', 'Best PnL', 'High Importance']);

    fireEvent.click(screen.getByTestId('campaign-sort-geometricExpectancy'));
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('aria-label', '几何期望，从大到小排序');
    expect(screen.queryByText('单场几何期望计算公式')).not.toBeInTheDocument();
    expect(cardOrder()).toEqual(['High Importance', 'Best PnL', 'Late Close']);

    fireEvent.click(screen.getByTestId('campaign-sort-geometricExpectancy'));
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('aria-label', '几何期望，从小到大排序');
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
  }, 15_000);

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
