import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCampaignListCaches } from '@/lib/campaignListCache';
import { fetchCampaignSourceRows, getCampaignFullData } from '@/lib/journalApi';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import JournalCampaignsPage from '../JournalCampaignsPage';

beforeEach(() => {
  clearCampaignListCaches();
  restoredIds.clear();
});

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return {
    ...actual,
    fetchLegExitPriceCorrections: vi.fn(async () => ({})),
    // 列表读的是带完整性标记的版本：无校正、已拉齐
    fetchLegExitPriceCorrectionsResult: vi.fn(async () => ({ corrections: {}, complete: true })),
  };
});

const { mockUser, mockListDeletedCampaigns, mockRestoreCampaign, mockPermanentlyDeleteCampaign, restoredIds } = vi.hoisted(() => {
  /** 已恢复的战役：恢复之后的远端核对要读得到它，像真的 Supabase 一样。 */
  const restoredIds = new Set<string>();
  return {
    mockUser: { id: 'user-1', email: 'desk@example.com' },
    mockListDeletedCampaigns: vi.fn(async () => []),
    mockRestoreCampaign: vi.fn(async (id: string) => { restoredIds.add(id); }),
    mockPermanentlyDeleteCampaign: vi.fn(async () => undefined),
    restoredIds,
  };
});
const mockTrading = vi.hoisted(() => ({
  balance: 100_000, positionsMap: {}, priceMap: {},
  getEffectiveTime: () => Date.parse('2026-08-23T12:00:00.000Z'),
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
    user: { ...mockUser },
    profile: { display_name: '主账户' },
  }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => mockTrading,
}));

vi.mock('@/lib/journalApi', () => ({
  appendCampaignEvent: vi.fn(async () => undefined),
  closeCampaign: vi.fn(async () => undefined),
  deleteCampaign: vi.fn(),
  // 列表页共用一份本地快照，避免 147 场各解析一遍（实测 2~6 秒主线程阻塞）。
  createUserLocalSnapshotReader: () => ({
    read: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {} }),
  }),
  getCampaignFullData: vi.fn(async (id: string) => ({
    campaign: [...campaigns, deletedCampaign].find(campaign => campaign.id === id),
    legs: legsByCampaign[id] ?? [],
    tradeRecords: tradeHistory.filter(record => (legsByCampaign[id] ?? []).some(leg => leg.trade_record_id === record.id)),
    pendingOrders: [],
    reverseHedgeOrders: reverseOrdersByCampaign[id as keyof typeof reverseOrdersByCampaign] ?? [],
  })),
  listAllCampaigns: vi.fn(async () => campaigns),
  // 远端只给原始行，装配是纯本地的一步；这里的装配只是把 fixture 的 legs 接回去。
  fetchCampaignSourceRows: vi.fn(async () => ({
    campaigns: [...campaigns, ...(restoredIds.has(deletedCampaign.id) ? [{ ...deletedCampaign, deleted_at: null }] : [])],
    journals: [],
  })),
  assembleCampaignsWithLegs: (_userId: string, rows: { campaigns: TradeCampaign[] }) => (
    rows.campaigns.map(campaign => ({ campaign, legs: legsByCampaign[campaign.id] ?? [] }))
  ),
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

/** 封面指标格读作「名称：数值」：上一行 dt 是指标名、下一行 dd 是数值（格子里不写冒号）。 */
function metricReading(cell: Element): string {
  return `${cell.querySelector('dt')?.textContent ?? ''}：${cell.querySelector('dd')?.textContent ?? ''}`;
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

function DetailReturn() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>返回战役图</button>;
}

describe('JournalCampaignsPage sorting', () => {
  it('详情返回立即复用散点图；后台核对期间不显示加载屏，且不重复计算未变的战役', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?chart=geometricExpectancyDistribution']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<DetailReturn />} />
        </Routes>
      </MemoryRouter>,
    );
    const summaryId = 'campaign-metric-summary-geometricExpectancyDistribution';
    const summary = await screen.findByTestId(summaryId);
    const text = summary.textContent;
    const detailCalls = vi.mocked(getCampaignFullData).mock.calls.length;
    const batchCalls = vi.mocked(fetchCampaignSourceRows).mock.calls.length;
    fireEvent.click(screen.getAllByTestId('campaign-card')[0]);
    let resolve!: (value: Awaited<ReturnType<typeof fetchCampaignSourceRows>>) => void;
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(new Promise(res => { resolve = res; }));
    fireEvent.click(screen.getByText('返回战役图'));
    expect(screen.getByTestId(summaryId).textContent).toBe(text);
    expect(screen.queryByTestId('campaign-metric-loading')).not.toBeInTheDocument();
    const returnedSummary = screen.getByTestId(summaryId);
    await act(async () => {
      resolve({ campaigns, journals: [] });
    });
    await waitFor(() => expect(screen.queryByText('正在更新数据…')).not.toBeInTheDocument());
    expect(screen.getByTestId(summaryId)).toBe(returnedSummary);
    expect(vi.mocked(getCampaignFullData).mock.calls.length).toBe(detailCalls);
    expect(vi.mocked(fetchCampaignSourceRows).mock.calls.length).toBe(batchCalls + 1);
  });

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

  it('【用户要求】涨跌幅 / 涨跌幅倍数 / 加仓效用三档排序：读数亮在卡片上、按它排、算不出的战役不进入这一档', async () => {
    // 四场主力的平仓价拉开：+30% / +5% / −10% / +20%
    const exits: Record<string, number> = {
      'high-importance-record': 130, 'newest-record': 105, 'best-pnl-record': 90, 'late-close-record': 120,
    };
    const originals = tradeHistory.map(record => record.exitPrice);
    tradeHistory.forEach(record => { record.exitPrice = exits[record.id] ?? record.exitPrice; });
    // 【用户要求】加仓效用只算做过加仓的战役：给 High Importance 补一条已结算的加仓腿（盈亏 0，不改 b）
    const hiLegs = legsByCampaign['high-importance'];
    legsByCampaign['high-importance'] = [...hiLegs, makeLeg({
      id: 'high-importance-add', campaign_id: 'high-importance', leg_role: 'main_add_1',
      post_real_close_time: '2025-12-01T00:00:00.000Z',
    } as Partial<TradeJournal>)];
    legsByCampaign['high-importance'][1].post_realized_pnl = 0;
    try {
      render(
        <MemoryRouter initialEntries={['/journal/campaigns']}>
          <JournalCampaignsPage />
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
      // 【用户要求】封面常驻显示涨跌幅、涨跌幅倍数、加仓效用：默认排序下每张卡片都有这三格，算不出的写「—」
      expect(screen.getAllByTestId('campaign-main-price-change')).toHaveLength(4);
      expect(screen.getAllByTestId('campaign-main-price-efficiency')).toHaveLength(4);
      expect(screen.getAllByTestId('campaign-add-efficiency')).toHaveLength(4);
      const newest = screen.getAllByTestId('campaign-card').find(card => card.textContent?.includes('Newest Operation'))!;
      expect(newest.querySelector('[data-testid="campaign-main-price-change-value"]')?.textContent).toBe('+5.00%');
      // 这场没有对冲边界、算不出预期回撤：涨跌幅倍数、加仓效用两格是「—」
      expect(newest.querySelector('[data-testid="campaign-main-price-efficiency-value"]')?.textContent).toBe('—');
      expect(newest.querySelector('[data-testid="campaign-add-efficiency-value"]')?.textContent).toBe('—');
      // 没有加仓的战役：涨跌幅倍数照算，加仓效用不算
      const bestPnl = screen.getAllByTestId('campaign-card').find(card => card.textContent?.includes('Best PnL'))!;
      expect(bestPnl.querySelector('[data-testid="campaign-main-price-efficiency-value"]')?.textContent).not.toBe('—');
      expect(bestPnl.querySelector('[data-testid="campaign-add-efficiency-value"]')?.textContent).toBe('—');
      expect(bestPnl.querySelector('[data-testid="campaign-add-efficiency"]')?.getAttribute('title')).toContain('没有加仓');
      // 杠杆旁不再另挂一枚重复的涨跌幅标签
      expect(newest.querySelectorAll('[data-testid="campaign-main-price-change"]')).toHaveLength(1);

      fireEvent.click(screen.getByTestId('campaign-sort-mainPriceChange'));
      await waitFor(() => expect(cardOrder()).toEqual(['High Importance', 'Late Close', 'Newest Operation', 'Best PnL']));
      expect(screen.getAllByTestId('campaign-main-price-change-value').map(node => node.textContent))
        .toEqual(['+30.00%', '+20.00%', '+5.00%', '-10.00%']);
      fireEvent.click(screen.getByTestId('campaign-sort-mainPriceChange'));
      await waitFor(() => expect(cardOrder()).toEqual(['Best PnL', 'Newest Operation', 'Late Close', 'High Importance']));

      const cardNumber = (card: HTMLElement, testId: string) => {
        const text = card.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
        const match = /[-+]?\d+(?:\.\d+)?/.exec(text.replace(/,/g, ''));
        return match ? Number(match[0]) : Number.NaN;
      };
      const pctOf: Record<string, number> = { 'High Importance': 30, 'Late Close': 20, 'Newest Operation': 5, 'Best PnL': -10 };

      // 涨跌幅倍数 = 主力涨跌幅 ÷ 预期回撤；预期回撤为「—」的战役（没有对冲边界）不进入这一档
      fireEvent.click(screen.getByTestId('campaign-sort-mainPriceEfficiency'));
      await waitFor(() => expect(screen.getAllByTestId('campaign-card').length).toBeLessThan(4));
      const effCards = screen.getAllByTestId('campaign-card');
      const effValues = effCards.map(card => cardNumber(card, 'campaign-main-price-efficiency'));
      expect(effValues.every(Number.isFinite)).toBe(true);
      expect([...effValues].sort((a, b) => b - a)).toEqual(effValues);
      for (const card of effCards) {
        const title = cardOrder()[effCards.indexOf(card)];
        const drawdown = cardNumber(card, 'campaign-expected-drawdown-pct');
        expect(drawdown).toBeGreaterThan(0);
        expect(cardNumber(card, 'campaign-main-price-efficiency')).toBeCloseTo(pctOf[title] / drawdown, 1);
      }
      expect(effCards.length).toBeLessThan(4);
      expect(screen.getAllByTestId('campaign-main-price-efficiency')[0].getAttribute('title')).toContain('÷ 预期回撤');

      // 加仓效用 = 盈亏比 ÷ 涨跌幅倍数
      fireEvent.click(screen.getByTestId('campaign-sort-addEfficiency'));
      await waitFor(() => expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveAttribute('data-sort-direction', 'desc'));
      const addCards = screen.getAllByTestId('campaign-card');
      const addValues = addCards.map(card => cardNumber(card, 'campaign-add-efficiency'));
      expect([...addValues].sort((a, b) => b - a)).toEqual(addValues);
      for (const card of addCards) {
        const title = cardOrder()[addCards.indexOf(card)];
        const efficiency = pctOf[title] / cardNumber(card, 'campaign-expected-drawdown-pct');
        // 卡片上盈亏比写作「300.00%（3.00）」：括号里才是 b
        const payoffText = card.querySelector('[data-testid="campaign-payoff-ratio"]')?.textContent ?? '';
        const payoff = Number(/（([-+]?\d+(?:\.\d+)?)）/.exec(payoffText)?.[1]);
        expect(cardNumber(card, 'campaign-add-efficiency')).toBeCloseTo(payoff / efficiency, 1);
      }
      // 只有做过加仓的战役进这一档：夹具里只有 High Importance（加仓腿盈亏 0，b 仍等于它的涨跌幅倍数 → 恰为 1）
      expect(cardOrder().slice(0, addCards.length)).toEqual(['High Importance']);
      const withAdd = addCards.find(card => card.textContent?.includes('High Importance'))!;
      expect(withAdd.querySelector('[data-testid="campaign-add-efficiency-value"]')?.textContent).toBe('+1.00');
      expect(screen.getAllByTestId('campaign-add-efficiency')[0].getAttribute('title')).toContain('盈亏比');
    } finally {
      tradeHistory.forEach((record, index) => { record.exitPrice = originals[index]; });
      legsByCampaign['high-importance'] = hiLegs;
    }
  }, 20_000);

  it('【用户要求】排序行左对齐依次排开（两条分隔线分出三组）；封面指标行左对齐、按读数定宽、顺序与排序行一致，当前排序项高亮', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <JournalCampaignsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));

    const sortRow = screen.getByTestId('campaign-sort-controls');
    // 「排序方式这里不美观。这里还是用左对齐吧」：不再读封面的列模板，按钮依次排开、间距均匀
    expect([...sortRow.classList].some(cls => cls.startsWith('xl:grid'))).toBe(false);
    expect(sortRow).toHaveClass('flex', 'flex-wrap', 'gap-x-1');
    // 行首与封面左缘对齐：同一套内边距 + 一条透明 1px 边框抵掉卡片外框
    expect(sortRow).toHaveClass('px-4', 'sm:px-5', 'border-x', 'border-transparent');
    // 子节点：标签，然后按钮与分隔线按次序排开，没有按列分组的外壳
    const children = [...sortRow.children];
    expect(children[0]).toHaveTextContent('排序方式');
    const sequence = children.slice(1).map(node => node.getAttribute('data-testid')!.replace('campaign-sort-', ''));
    // 【用户要求】操作时间、镜像止盈 ┆ 预期回撤 … 算术期望 ┆ DSI 贡献 … 字母
    expect(sequence).toEqual([
      'time', 'mirrorTp',
      'divider-expectedDrawdownPct',
      'expectedDrawdownPct', 'mainPriceChange', 'mainPriceEfficiency', 'captureRate', 'addEfficiency',
      'geometricExpectancy', 'arithmeticExpectancy',
      'divider-dsiContribution',
      'dsiContribution', 'usiContribution', 'leverage', 'importance', 'alpha',
    ]);
    expect(screen.getByTestId('campaign-sort-divider-expectedDrawdownPct')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('campaign-sort-lead')).not.toBeInTheDocument();

    // 【用户要求】「封面上的指标做成左对齐，要美观，不需要均匀分布」：手机两列网格，≥ 640px 左对齐依次排开、每项按读数定宽，
    // 每张卡同一套类名——上下各张卡的同名项在同一条竖线上
    const metricRows = screen.getAllByTestId('campaign-card-metrics');
    expect(metricRows).toHaveLength(4);
    expect(metricRows[0].tagName).toBe('DL');
    expect(metricRows[0]).toHaveClass('grid', 'grid-cols-2', 'sm:flex', 'sm:flex-wrap');
    expect(metricRows[0]).not.toHaveClass('xl:grid-cols-8');
    for (const row of metricRows) expect(row.className).toBe(metricRows[0].className);
    // 【用户要求】指标顺序与排序行一致：镜像止盈、预期回撤，之后涨跌幅…几何期望、算术期望（操作时间留在标题行）
    const cardCells = [...metricRows[0].children].map(node => node.getAttribute('data-testid'));
    expect(cardCells).toEqual([
      'campaign-mirror-tp-status',
      'campaign-expected-drawdown-pct',
      'campaign-main-price-change',
      'campaign-main-price-efficiency',
      'campaign-payoff-ratio',
      'campaign-add-efficiency',
      'campaign-geometric-expectancy',
      'campaign-arithmetic-expectancy',
    ]);
    // 每格：上面指标名（dt，不带冒号）、下面数值（dd）；八格同一套格子类名，没有给首格另开的特例
    const cells = [...metricRows[0].children];
    expect(cells.map(cell => cell.querySelector('dt')?.textContent)).toEqual([
      '镜像止盈', '预期回撤', '涨跌幅', '涨跌幅倍数', '盈亏比', '加仓效用', '几何期望', '算术期望',
    ]);
    for (const cell of cells) {
      expect(cell.children).toHaveLength(2);
      expect(cell.children[0].tagName).toBe('DT');
      expect(cell.children[1].tagName).toBe('DD');
      expect(cell).toHaveClass('flex-col', 'px-2.5', 'shrink-0');
      expect([...cell.classList].some(cls => /^sm:w-\[\d+px\]$/.test(cls))).toBe(true);
    }
    // 各张卡的同名项宽度类相同
    for (const row of metricRows) {
      expect([...row.children].map(cell => [...cell.classList].find(cls => cls.startsWith('sm:w-'))))
        .toEqual(cells.map(cell => [...cell.classList].find(cls => cls.startsWith('sm:w-'))));
    }

    // 【用户要求】「选中排序功能的时候，交易战役封面上对应的模块高亮显示」：默认按操作时间排——每张卡的操作时间亮，指标项都不亮
    const lit = (card: HTMLElement) => [...card.querySelectorAll('[data-sort-highlight="true"]')];
    const cards = screen.getAllByTestId('campaign-card');
    for (const card of cards) {
      expect(lit(card)).toHaveLength(1);
      expect(within(card).getByTestId('campaign-operation-time')).toContainElement(lit(card)[0] as HTMLElement);
    }
    // 切到盈亏比：每张卡只有盈亏比那一项亮，指标名换成琥珀色；高亮不改内边距
    fireEvent.click(screen.getByTestId('campaign-sort-captureRate'));
    await waitFor(() => expect(screen.getAllByTestId('campaign-payoff-ratio')[0]).toHaveAttribute('data-sort-highlight', 'true'));
    for (const card of screen.getAllByTestId('campaign-card')) {
      expect(lit(card).map(node => node.getAttribute('data-testid'))).toEqual(['campaign-payoff-ratio']);
    }
    const payoffCell = screen.getAllByTestId('campaign-payoff-ratio')[0];
    expect(payoffCell).toHaveClass('ring-1', 'px-2.5', 'py-1.5');
    expect(payoffCell.querySelector('dt')).toHaveClass('text-[#B7860B]');
    expect(screen.getAllByTestId('campaign-expected-drawdown-pct')[0]).not.toHaveClass('ring-1');
    // 切到字母：比的是标题，标题亮（琥珀下划线）；DSI 贡献不在封面上，没有可亮的
    fireEvent.click(screen.getByTestId('campaign-sort-alpha'));
    await waitFor(() => expect(lit(screen.getAllByTestId('campaign-card')[0]).map(node => node.tagName)).toEqual(['H2']));
    expect(lit(screen.getAllByTestId('campaign-card')[0])[0]).toHaveClass('underline');
    fireEvent.click(screen.getByTestId('campaign-sort-dsiContribution'));
    await waitFor(() => {
      for (const card of screen.getAllByTestId('campaign-card')) expect(lit(card)).toHaveLength(0);
    });

    // 图标位宽度固定：有公式的档平时是 Σ，选中那一档换成方向箭头；没有公式的档平时也留同宽空位，切换排序整行不重排
    expect(screen.getByTestId('campaign-sort-mainPriceChange-icon')).toHaveClass('w-3');
    expect(screen.getByTestId('campaign-sort-time-icon')).toHaveClass('w-3');
    expect(screen.getByTestId('campaign-sort-leverage-icon')).toHaveClass('w-3');
    expect(screen.getByTestId('campaign-sort-leverage-icon')).not.toHaveClass('xl:hidden');
    expect(screen.getByTestId('campaign-sort-leverage-icon')).toBeEmptyDOMElement();
  }, 15_000);

  it('【用户要求】涨跌幅 / 涨跌幅倍数 / 加仓效用：双击或右键看公式与例子，浮层里「查看散点图」默认打开分布图（同盈亏比），「时序」仍在', async () => {
    // 四场主力的平仓价拉开：+30% / +5% / −10% / +20%（与三档排序那条用例同一组）
    const exits: Record<string, number> = {
      'high-importance-record': 130, 'newest-record': 105, 'best-pnl-record': 90, 'late-close-record': 120,
    };
    const originals = tradeHistory.map(record => record.exitPrice);
    tradeHistory.forEach(record => { record.exitPrice = exits[record.id] ?? record.exitPrice; });
    const hiLegs = legsByCampaign['high-importance'];
    legsByCampaign['high-importance'] = [...hiLegs, makeLeg({
      id: 'high-importance-add', campaign_id: 'high-importance', leg_role: 'main_add_1',
      post_real_close_time: '2025-12-01T00:00:00.000Z',
    } as Partial<TradeJournal>)];
    legsByCampaign['high-importance'][1].post_realized_pnl = 0;
    try {
      render(
        <MemoryRouter initialEntries={['/journal/campaigns']}>
          <Routes>
            <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
      const plotIds = () => [...screen.getByTestId('campaign-metric-scatter-plot')
        .querySelectorAll('button[data-campaign-id]')]
        .map(node => node.getAttribute('data-campaign-id'))
        .sort();

      // —— 涨跌幅：双击打开公式浮层，排序方向不因为看说明而变 ——
      fireEvent.doubleClick(screen.getByTestId('campaign-sort-mainPriceChange'));
      expect(screen.getByText('主力涨跌幅计算公式')).toBeInTheDocument();
      expect(screen.getByText('涨跌幅ᵢ = s ×（平仓价 − 开仓价）÷ 开仓价 × 100%')).toBeInTheDocument();
      expect(screen.getByText(/s = \+1（主多）\/ −1（主空）/)).toBeInTheDocument();
      expect(screen.getByText(/主多 100 → 112/)).toBeInTheDocument();
      expect(screen.getByText(/主力都还没平仓（没有平仓价）的战役显示「—」，不参与排序与散点图/)).toBeInTheDocument();
      // 【用户要求】开仓价取主力最有利的一笔；主力平仓时有对冲锁住行情就按对冲开仓价——
      // 滚动对冲仍持有或同平；已触发的初始对冲 A/B、回场对冲只认与主力同一次操作里平掉
      expect(screen.getByText(/开仓价取主力（main_open，没有才取 reentry_main）各笔里最有利的那个/)).toBeInTheDocument();
      expect(screen.getByText(/取其中最早开的那张对冲的开仓价/)).toBeInTheDocument();
      expect(screen.getByText(/已触发的初始对冲 A\/B、回场对冲与主力同一次操作里平掉，都算锁住/)).toBeInTheDocument();
      expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-pressed', 'true');
      const priceToggle = screen.getByTestId('campaign-mainPriceChange-chart-toggle');
      expect(priceToggle).toHaveAttribute('aria-expanded', 'false');
      expect(priceToggle).toHaveAccessibleName('查看涨跌幅散点图，共 4 场');
      expect(priceToggle).toHaveTextContent('查看散点图');
      fireEvent.click(priceToggle);
      // 【用户要求】默认落在分布视图，像盈亏比那样；「时序 | 分布」切换键在面板右上角
      expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mainPriceChangeDistribution');
      expect(screen.getByTestId('location-probe-search')).toHaveTextContent('chart=mainPriceChangeDistribution');
      expect(screen.getByTestId('campaign-mainPriceChange-view-distribution')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('campaign-mainPriceChange-view-time')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('campaign-mainPriceChange-view-switch')).toHaveTextContent('时序分布');
      expect(plotIds()).toEqual(['best-pnl', 'high-importance', 'late-close', 'newest']);
      // 分布图按数值从左到右：−10% → +5% → +20% → +30%
      const priceButtons = [...screen.getByTestId('campaign-metric-scatter-plot')
        .querySelectorAll<HTMLElement>('button[data-campaign-id]')];
      expect(priceButtons.map(node => node.dataset.campaignId)).toEqual(['best-pnl', 'newest', 'late-close', 'high-importance']);
      const priceLefts = priceButtons.map(node => Number.parseFloat(node.style.left));
      expect([...priceLefts].sort((a, b) => a - b)).toEqual(priceLefts);
      // 分布里同样正绿负红、绿圆红菱
      expect(screen.getByTestId('campaign-metric-point-mainPriceChangeDistribution-best-pnl')).toHaveAttribute('data-series-token', 'loss');
      expect(screen.getByTestId('campaign-metric-point-mainPriceChangeDistribution-best-pnl')).toHaveAttribute('data-marker-shape', 'diamond');
      expect(screen.getByTestId('campaign-metric-point-mainPriceChangeDistribution-high-importance')).toHaveAttribute('data-series-token', 'profit');
      // 0 线用本指标的读法：不涨不跌，不是「盈亏平衡」；盈亏比专属的止损墙、右尾不出现
      const priceZero = screen.getByTestId('campaign-metric-break-even-mainPriceChangeDistribution');
      expect(priceZero).toHaveAttribute('data-reference-axis', 'x');
      expect(priceZero).toHaveAttribute('data-reference-kind', 'zero');
      expect(screen.getByTestId('campaign-metric-break-even-mainPriceChangeDistribution-label')).toHaveTextContent('0% 不涨不跌');
      expect(screen.queryByTestId('campaign-metric-loss-wall-mainPriceChangeDistribution')).toBeNull();
      expect(screen.queryByTestId('campaign-metric-tail-count-mainPriceChangeDistribution')).toBeNull();
      expect(screen.getByTestId('campaign-metric-density-curve-mainPriceChangeDistribution').tagName.toLowerCase()).toBe('path');
      const priceSummary = screen.getByTestId('campaign-metric-summary-mainPriceChangeDistribution');
      expect(priceSummary).toHaveTextContent('范围 -10.00% – +30.00%');
      expect(priceSummary).toHaveTextContent('中位数 +12.50%');
      expect(priceSummary).toHaveTextContent('均值 +11.25%');
      expect(screen.getByTestId('campaign-metric-win-rate-mainPriceChangeDistribution')).toHaveTextContent('顺向 75% (3/4)');
      expect(screen.getByText(/横轴 涨跌幅（%） · 纵轴 场数 · 不按时间排列/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-mainPriceChangeDistribution'));
      const priceDistGuide = screen.getByTestId('campaign-metric-guide-mainPriceChangeDistribution');
      for (const text of ['横轴就是涨跌幅本身（单位 %）', '涨跌分界 0 圈在窗口内', 'Legs 表「涨跌幅」列', '灰色 0% 竖线', '「顺向」是涨跌幅 > 0 的场数占比', '核密度']) {
        expect(priceDistGuide).toHaveTextContent(text);
      }
      expect(priceDistGuide).not.toHaveTextContent('盈亏比 b 本身');
      expect(priceDistGuide).not.toHaveTextContent('按客观操作时间从早到晚等距排列');

      // 「时序」切回原来那张图：URL 改成 chart=mainPriceChange，时序图的一切照旧
      fireEvent.click(screen.getByTestId('campaign-mainPriceChange-view-time'));
      expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mainPriceChange');
      expect(screen.getByTestId('location-probe-search')).toHaveTextContent('chart=mainPriceChange');
      expect(screen.getByTestId('location-probe-search')).not.toHaveTextContent('chart=mainPriceChangeDistribution');
      expect(screen.getByTestId('campaign-mainPriceChange-view-time')).toHaveAttribute('aria-pressed', 'true');
      expect(plotIds()).toEqual(['best-pnl', 'high-importance', 'late-close', 'newest']);
      // 带方向：正绿负红，与盈亏比同一套（形状也跟着：绿圆、红菱）
      expect(screen.getByTestId('campaign-metric-point-mainPriceChange-best-pnl')).toHaveAttribute('data-series-token', 'loss');
      expect(screen.getByTestId('campaign-metric-point-mainPriceChange-best-pnl')).toHaveAttribute('data-marker-shape', 'diamond');
      expect(screen.getByTestId('campaign-metric-point-mainPriceChange-high-importance')).toHaveAttribute('data-series-token', 'profit');
      expect(screen.getByTestId('campaign-metric-point-mainPriceChange-high-importance')).toHaveAttribute('data-marker-shape', 'circle');
      // 说明面板与其他图同一结构：纵轴 / 颜色 / 点位 / 参考线
      fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-mainPriceChange'));
      const priceGuide = screen.getByTestId('campaign-metric-guide-mainPriceChange');
      for (const text of ['纵轴', '颜色', '点位', '参考线', 'Legs 表「涨跌幅」列', '绿色：涨跌幅 > 0', '红色：涨跌幅 < 0', '灰色零线']) {
        expect(priceGuide).toHaveTextContent(text);
      }

      // —— 涨跌幅倍数：右键打开；算不出预期回撤的 Newest Operation 不进图 ——
      fireEvent.contextMenu(screen.getByTestId('campaign-sort-mainPriceEfficiency'));
      expect(screen.getByText('涨跌幅倍数计算公式')).toBeInTheDocument();
      expect(screen.getByText('ηᵢ = 涨跌幅ᵢ ÷ 预期回撤ᵢ')).toBeInTheDocument();
      expect(screen.getByText(/dᵢ = max（\|主力开仓价 − 初始对冲 A 价\|/)).toBeInTheDocument();
      expect(screen.getByText(/ηᵢ = 12 ÷ 4 =/)).toBeInTheDocument();
      expect(screen.getByText(/算不出预期回撤）的战役不参与排序与散点图/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('campaign-mainPriceEfficiency-chart-toggle'));
      expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mainPriceEfficiencyDistribution');
      expect(screen.getByTestId('campaign-mainPriceEfficiency-view-distribution')).toHaveAttribute('aria-pressed', 'true');
      expect(plotIds()).toEqual(['best-pnl', 'high-importance', 'late-close']);
      // 点上的数与卡片同一个函数：High Importance 涨跌幅 +30%、预期回撤 10% → +3.00
      expect(Number(screen.getByTestId('campaign-metric-point-mainPriceEfficiencyDistribution-high-importance').dataset.metricValue)).toBeCloseTo(3, 6);
      expect(screen.getByTestId('campaign-metric-point-mainPriceEfficiencyDistribution-best-pnl')).toHaveAttribute('data-series-token', 'loss');
      expect(screen.getByTestId('campaign-metric-break-even-mainPriceEfficiencyDistribution-label')).toHaveTextContent('0.00 不涨不跌');
      expect(screen.getByTestId('campaign-metric-win-rate-mainPriceEfficiencyDistribution')).toHaveTextContent('顺向 67% (2/3)');
      // 算不出的场数照样写在图下脚注里
      expect(screen.getByText(/无涨跌幅倍数 1 场/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('campaign-mainPriceEfficiency-view-time'));
      expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mainPriceEfficiency');
      expect(Number(screen.getByTestId('campaign-metric-point-mainPriceEfficiency-high-importance').dataset.metricValue)).toBeCloseTo(3, 6);
      expect(screen.getByText(/无涨跌幅倍数 1 场/)).toBeInTheDocument();

      // —— 加仓效用：只画做过加仓的战役 ——
      fireEvent.contextMenu(screen.getByTestId('campaign-sort-addEfficiency'));
      expect(screen.getByText('加仓效用计算公式')).toBeInTheDocument();
      expect(screen.getByText('加仓效用ᵢ = bᵢ ÷ ηᵢ')).toBeInTheDocument();
      // 两个式子各自不断行，只在「；」之后换行：「涨跌幅ᵢ」不会被拆成「涨跌幅」和另起一行的「ᵢ」
      const addPopover = screen.getByText('加仓效用计算公式').closest('[role="dialog"]')!;
      expect([...addPopover.querySelectorAll('span.whitespace-nowrap')].map(node => node.textContent))
        .toEqual(['bᵢ = 已实现盈亏ᵢ ÷ 初始最大预期亏损ᵢ；', 'ηᵢ = 涨跌幅ᵢ ÷ 预期回撤ᵢ']);
      expect(screen.getByText(/加仓效用 = 6 ÷ 3 =/)).toBeInTheDocument();
      expect(screen.getByText(/只算做过加仓（有一条成交过的加仓腿）/)).toBeInTheDocument();
      const addToggle = screen.getByTestId('campaign-addEfficiency-chart-toggle');
      expect(addToggle).toHaveAccessibleName('查看加仓效用散点图，共 1 场');
      fireEvent.click(addToggle);
      expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'addEfficiencyDistribution');
      expect(screen.getByTestId('campaign-addEfficiency-view-distribution')).toHaveAttribute('aria-pressed', 'true');
      expect(plotIds()).toEqual(['high-importance']);
      expect(Number(screen.getByTestId('campaign-metric-point-addEfficiencyDistribution-high-importance').dataset.metricValue)).toBeCloseTo(1, 6);
      expect(screen.getByText(/无加仓效用 3 场/)).toBeInTheDocument();
      // 加仓效用另有 1.00 参照线：琥珀色虚线「加仓没有额外放大」，与灰色 0 线（盈亏平衡）并存
      const addReference = screen.getByTestId('campaign-metric-reference-addEfficiencyDistribution-1');
      expect(addReference).toHaveAttribute('data-reference-axis', 'x');
      expect(addReference).toHaveAttribute('data-reference-kind', 'threshold');
      expect(addReference).toHaveAttribute('data-reference-value', '1');
      expect(addReference.getAttribute('stroke-dasharray')).toBeTruthy();
      expect(screen.getByTestId('campaign-metric-reference-addEfficiencyDistribution-1-label')).toHaveTextContent('1.00 加仓没有额外放大');
      expect(screen.getByTestId('campaign-metric-break-even-addEfficiencyDistribution-label')).toHaveTextContent('0.00 盈亏平衡');
      expect(Number(screen.getByTestId('campaign-metric-break-even-addEfficiencyDistribution').getAttribute('x1')))
        .toBeLessThan(Number(addReference.getAttribute('x1')));
      expect(screen.getByTestId('campaign-metric-win-rate-addEfficiencyDistribution')).toHaveTextContent('盈利 100% (1/1)');
      expect(screen.getByTestId('campaign-metric-reference-share-addEfficiencyDistribution-1')).toHaveTextContent(/放大（> 1） (0|100)% \([01]\/1\)/);
      fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-addEfficiencyDistribution'));
      const addGuide = screen.getByTestId('campaign-metric-guide-addEfficiencyDistribution');
      for (const text of ['盈亏分界 0 与参照值 1.00 圈在窗口内', '1.00 也是档边界', '琥珀色 1.00 虚线：加仓没有额外放大', '没有加仓、或涨跌幅倍数不为正的战役不进图']) {
        expect(addGuide).toHaveTextContent(text);
      }
      // 时序那张图原样保留：1 仍只是读数参照、不画线
      fireEvent.click(screen.getByTestId('campaign-addEfficiency-view-time'));
      expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'addEfficiency');
      expect(screen.queryByTestId('campaign-metric-reference-addEfficiency-1')).toBeNull();
      fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-addEfficiency'));
      expect(screen.getByTestId('campaign-metric-guide-addEfficiency')).toHaveTextContent('且涨跌幅倍数为正的战役，其余不进图');

      // 散点图开着时点排序按钮：排序照改，图跟着切到这一项——落在它的默认视图（分布）
      fireEvent.click(screen.getByTestId('campaign-sort-mainPriceChange'));
      await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
        .toHaveAttribute('data-metric-key', 'mainPriceChangeDistribution'));
      expect(screen.getByTestId('campaign-sort-mainPriceChange')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('location-probe-search')).toHaveTextContent('sort=mainPriceChange');

      // 「收起散点图」
      fireEvent.contextMenu(screen.getByTestId('campaign-sort-mainPriceChange'));
      const collapse = screen.getByTestId('campaign-mainPriceChange-chart-toggle');
      expect(collapse).toHaveTextContent('收起散点图');
      expect(collapse).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(collapse);
      expect(screen.queryByTestId('campaign-odds-scatter-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('location-probe-search')).not.toHaveTextContent('chart=');
    } finally {
      tradeHistory.forEach((record, index) => { record.exitPrice = originals[index]; });
      legsByCampaign['high-importance'] = hiLegs;
    }
  }, 30_000);

  it('?chart=mainPriceEfficiency / ?chart=mainPriceChange 从 URL 恢复新增的散点图', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/journal/campaigns?chart=mainPriceEfficiency']}>
        <JournalCampaignsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mainPriceEfficiency');
    unmount();
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=mainPriceChange&direction=asc&chart=mainPriceChange']}>
        <JournalCampaignsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mainPriceChange');
    expect(screen.getByTestId('campaign-sort-mainPriceChange')).toHaveAttribute('data-sort-direction', 'asc');
  }, 15_000);

  it('【用户要求】?chart=…Distribution 从 URL 恢复四张新分布图；「时序 | 分布」互切写回 URL，排序行按钮把分布图当作同一张图收起', async () => {
    // 与三档排序那条用例同一组夹具：主力平仓价拉开，High Importance 补一条加仓腿，四张图都有点
    const exits: Record<string, number> = {
      'high-importance-record': 130, 'newest-record': 105, 'best-pnl-record': 90, 'late-close-record': 120,
    };
    const originals = tradeHistory.map(record => record.exitPrice);
    tradeHistory.forEach(record => { record.exitPrice = exits[record.id] ?? record.exitPrice; });
    const hiLegs = legsByCampaign['high-importance'];
    legsByCampaign['high-importance'] = [...hiLegs, makeLeg({
      id: 'high-importance-add', campaign_id: 'high-importance', leg_role: 'main_add_1',
      post_real_close_time: '2025-12-01T00:00:00.000Z',
    } as Partial<TradeJournal>)];
    legsByCampaign['high-importance'][1].post_realized_pnl = 0;
    const families = ['mainPriceChange', 'mainPriceEfficiency', 'addEfficiency', 'arithmeticExpectancy'] as const;
    try {
      for (const family of families) {
        const { unmount } = render(
          <MemoryRouter initialEntries={[`/journal/campaigns?chart=${family}Distribution`]}>
            <Routes>
              <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
            </Routes>
          </MemoryRouter>,
        );
        // 恢复的是分布视图本身，不是被默认视图覆盖掉的时序
        expect(await screen.findByTestId('campaign-metric-scatter-plot'))
          .toHaveAttribute('data-metric-key', `${family}Distribution`);
        expect(screen.getByTestId(`campaign-${family}-view-distribution`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId(`campaign-${family}-view-time`)).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId(`campaign-metric-break-even-${family}Distribution`)).toHaveAttribute('data-reference-axis', 'x');

        fireEvent.click(screen.getByTestId(`campaign-${family}-view-time`));
        expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', family);
        expect(screen.getByTestId('location-probe-search')).toHaveTextContent(`chart=${family}`);
        expect(screen.getByTestId('location-probe-search')).not.toHaveTextContent('Distribution');
        fireEvent.click(screen.getByTestId(`campaign-${family}-view-distribution`));
        expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', `${family}Distribution`);
        expect(screen.getByTestId('location-probe-search')).toHaveTextContent(`chart=${family}Distribution`);

        // 分布图开着时，排序行上同一指标的按钮读作「收起散点图」
        fireEvent.contextMenu(screen.getByTestId(`campaign-sort-${family}`));
        const toggle = await screen.findByTestId(`campaign-${family}-chart-toggle`);
        expect(toggle).toHaveTextContent('收起散点图');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(toggle);
        expect(screen.queryByTestId('campaign-odds-scatter-panel')).not.toBeInTheDocument();
        expect(screen.getByTestId('location-probe-search')).not.toHaveTextContent('chart=');
        unmount();
      }
    } finally {
      tradeHistory.forEach((record, index) => { record.exitPrice = originals[index]; });
      legsByCampaign['high-importance'] = hiLegs;
    }
  }, 30_000);

  it('【用户要求】算术期望默认看分布：0R 是盈亏平衡，摘要报「正期望」占比，不套盈亏比的止损墙', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=captureRate&direction=desc&chart=oddsDistribution']}>
        <Routes>
          <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'oddsDistribution'));

    // 散点图开着时点「算术期望」排序：图跟着切过去，落在它的默认视图（分布）
    fireEvent.click(screen.getByTestId('campaign-sort-arithmeticExpectancy'));
    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'arithmeticExpectancyDistribution'));
    expect(screen.getByTestId('campaign-arithmeticExpectancy-view-distribution')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('sort=arithmeticExpectancy');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('chart=arithmeticExpectancyDistribution');

    // Eᵢ = 50% × bᵢ − 50%：b = −0.8 / +0.5 / +3 → −0.90R / −0.25R / +1.00R，按数值从左到右
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    const buttons = [...plot.querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(buttons.map(node => node.dataset.campaignId)).toEqual(['late-close', 'best-pnl', 'high-importance']);
    expect(buttons.map(node => Number(node.dataset.metricValue))).toEqual([-0.9, -0.25, 1].map(value => expect.closeTo(value, 6)));
    expect(screen.getByTestId('campaign-metric-point-arithmeticExpectancyDistribution-late-close')).toHaveAttribute('data-series-token', 'loss');
    expect(screen.getByTestId('campaign-metric-point-arithmeticExpectancyDistribution-high-importance')).toHaveAttribute('data-series-token', 'profit');
    const breakEven = screen.getByTestId('campaign-metric-break-even-arithmeticExpectancyDistribution');
    expect(breakEven).toHaveAttribute('data-reference-kind', 'zero');
    expect(breakEven.getAttribute('stroke-dasharray')).toBeNull();
    expect(screen.getByTestId('campaign-metric-break-even-arithmeticExpectancyDistribution-label')).toHaveTextContent('0R 盈亏平衡');
    // 零线两侧的点不混档
    const zeroX = Number(breakEven.getAttribute('x1'));
    const lefts = buttons.map(node => Number.parseFloat(node.style.left));
    expect(lefts[0]).toBeLessThan(zeroX);
    expect(lefts[1]).toBeLessThan(zeroX);
    expect(lefts[2]).toBeGreaterThan(zeroX);
    expect(screen.queryByTestId('campaign-metric-loss-wall-arithmeticExpectancyDistribution')).toBeNull();
    expect(screen.queryByTestId('campaign-metric-tail-count-arithmeticExpectancyDistribution')).toBeNull();
    expect(screen.queryByTestId('campaign-metric-capital-ruin-count-arithmeticExpectancyDistribution')).toBeNull();
    const summary = screen.getByTestId('campaign-metric-summary-arithmeticExpectancyDistribution');
    expect(summary).toHaveTextContent('范围 -0.90R – +1.00R');
    expect(summary).toHaveTextContent('中位数 -0.25R');
    expect(screen.getByTestId('campaign-metric-win-rate-arithmeticExpectancyDistribution')).toHaveTextContent('正期望 33% (1/3)');
    expect(summary).not.toHaveTextContent('胜率');
    // 刻度紧凑：「+1R」而不是「+1.00R」，0 不带正号
    const ticks = [...plot.querySelectorAll('span')].map(node => node.textContent ?? '');
    expect(ticks).toContain('0R');
    expect(ticks.some(text => /^[-+]?\d+(\.\d*[1-9])?R$/.test(text))).toBe(true);
    expect(ticks.filter(text => /^[-+]\d+\.\d*0R$/.test(text))).toEqual([]);
    // 提示框照例补上这一场的 b
    expect(buttons.some(node => /· b [+-]\d+\.\d{2}R/.test(node.getAttribute('aria-label') ?? ''))).toBe(true);

    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-arithmeticExpectancyDistribution'));
    const guide = screen.getByTestId('campaign-metric-guide-arithmeticExpectancyDistribution');
    for (const text of [
      '横轴就是算术期望本身（单位 R）', '盈亏分界 0 圈在窗口内', 'Eᵢ = 50% × bᵢ − 50%', '胜率统一取 50%',
      'Eᵢ = 0R 对应 bᵢ = +1R', '灰色 0R 竖线：盈亏平衡', '「正期望」是 Eᵢ > 0 的场数占比', '核密度',
    ]) {
      expect(guide).toHaveTextContent(text);
    }
    expect(guide).toHaveTextContent('−1R 止损墙与 +10R 封顶在这里不适用');

    // 切回时序：原来那张算术期望时序图
    fireEvent.click(screen.getByTestId('campaign-arithmeticExpectancy-view-time'));
    expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'arithmeticExpectancy');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('chart=arithmeticExpectancy');
  }, 15_000);

  it('打平结束的战役在封面状态胶囊上写「打平结束」，不露出 closed_breakeven 这样的原始枚举', async () => {
    const record = tradeHistory.find(item => item.id === 'best-pnl-record')!;
    const campaign = campaigns.find(item => item.id === 'best-pnl')!;
    const original = { pnl: record.pnl, final: campaign.final_realized_pnl, status: campaign.status };
    record.pnl = 0;
    campaign.final_realized_pnl = 0;
    campaign.status = 'closed_breakeven';
    try {
      render(
        <MemoryRouter initialEntries={['/journal/campaigns']}>
          <JournalCampaignsPage />
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
      const card = screen.getAllByTestId('campaign-card').find(node => node.textContent?.includes('Best PnL'))!;
      await waitFor(() => expect(card).toHaveTextContent('打平结束'));
      expect(card).not.toHaveTextContent('closed_breakeven');
    } finally {
      record.pnl = original.pnl;
      campaign.final_realized_pnl = original.final;
      campaign.status = original.status;
    }
  });

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

    // 【评审发现】柱状图的说明面板不能说「按客观操作时间从早到晚等距排列」——它按档位分柱
    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-mirrorTpBars'));
    const barsGuide = await screen.findByTestId('campaign-metric-guide-mirrorTpBars');
    expect(barsGuide.textContent).toContain('档位分柱');
    expect(barsGuide.textContent).not.toContain('按客观操作时间从早到晚等距排列');
    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-mirrorTpBars'));

    // 【用户要求】六个档位都在轴上：成交与否 × 盈亏的交叉表，一场都没有的档位留空柱。
    // 中间那档写「持平/进行中」——卡片上未结束的战役显示「已实现·进行中」，两处不能各说各的。
    const summary = screen.getByTestId('campaign-metric-summary-mirrorTpBars');
    for (const label of [
      '未实现·亏损', '未实现·持平/进行中', '未实现·盈利',
      '已实现·亏损', '已实现·持平/进行中', '已实现·盈利',
    ]) {
      expect(summary.textContent).toContain(label);
    }
    // 这批战役都没有成交的镜像止盈腿，所以已实现那三档全是空柱——「0 场」本身就是结论
    for (const rank of [3, 4, 5]) {
      expect(screen.getByTestId(`campaign-metric-bar-count-mirrorTpBars-${rank}`)).toHaveTextContent('0 场');
    }

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

    // 【用户要求】每根柱的柱脚各写自己的场数——柱高只读得出大概，精确值要就地可读。
    // 而且写的必须就是这一柱真正画出来的点数，不能是另算的一份。
    for (const value of [0, 1, 2, 3, 4, 5]) {
      const drawn = buttons.filter(node => Number(node.dataset.metricValue) === value).length;
      expect(screen.getByTestId(`chart-category-count-${value}`).textContent).toBe(`${drawn} 场`);
    }

    // 【用户要求】点开一个点要读得到这一场的 b：档位只有四种，b 才说明赚亏了多少个 R
    const labelled = buttons.map(node => node.getAttribute('aria-label') ?? '');
    expect(labelled.some(label => /· b [+-]\d+\.\d{2}R/.test(label))).toBe(true);

    // 【用户要求】颜色报盈亏而不是档位：同一根柱里盈利的绿、亏损的红
    const tokensByColumn = new Map<number, Set<string>>();
    for (const node of buttons) {
      const value = Number(node.dataset.metricValue);
      const token = node.dataset.seriesToken ?? '';
      tokensByColumn.set(value, (tokensByColumn.get(value) ?? new Set()).add(token));
    }
    // 未实现那一侧现在按盈亏拆成三柱：亏损柱只有红点、盈利柱只有绿点
    expect(tokensByColumn.get(0)).toEqual(new Set(['loss']));
    expect(tokensByColumn.get(2)).toEqual(new Set(['profit']));

    // 【用户要求】柱内自底向上按 |b| 从小到大：底下是小赚小亏，越往上越极端
    const byColumnPoints = new Map<number, { top: number; magnitude: number }[]>();
    for (const node of buttons) {
      const value = Number(node.dataset.metricValue);
      const match = /· b ([+-]\d+\.\d{2})R/.exec(node.getAttribute('aria-label') ?? '');
      if (!match) continue;
      byColumnPoints.set(value, [
        ...(byColumnPoints.get(value) ?? []),
        { top: Number.parseFloat(node.style.top), magnitude: Math.abs(Number(match[1])) },
      ]);
    }
    for (const [, column] of byColumnPoints) {
      if (column.length < 2) continue;
      // top% 越小越靠上；按 top 降序（自底向上）读出来的 |b| 必须不减
      const bottomUp = [...column].sort((a, b) => b.top - a.top);
      for (let index = 1; index < bottomUp.length; index += 1) {
        expect(bottomUp[index].magnitude).toBeGreaterThanOrEqual(bottomUp[index - 1].magnitude);
      }
    }
    const profitPoint = buttons.find(node => node.dataset.seriesToken === 'profit')!;
    expect(profitPoint.dataset.pnlSign).toBe('positive');
    const lossPoint = buttons.find(node => node.dataset.seriesToken === 'loss')!;
    expect(lossPoint.dataset.pnlSign).toBe('negative');
    // 图例次序必须与 series 下标一一对应，否则绿红会整体错位（改色那天就栽在这上面）：
    // 形状是跟着下标发的，所以「绿=圆、红=菱」同时成立才说明 token 与下标没有错位
    expect(profitPoint.dataset.markerShape).toBe('circle');
    expect(lossPoint.dataset.markerShape).toBe('diamond');
  }, 15_000);

  it('【用户要求】操作时间段：默认全选，框定范围后统计与卡片一起收窄', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns']}>
        <Routes>
          <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    // 默认全选：四场全在，徽标写「全部」，URL 里没有 from/to
    const chip = await screen.findByTestId('campaign-operation-range');
    expect(chip).toHaveTextContent('操作时间 全部');
    expect(chip).not.toHaveAttribute('data-range-active');
    expect(screen.getAllByTestId('campaign-card')).toHaveLength(4);
    expect(screen.getByTestId('campaign-valid-count')).toHaveTextContent('有效战役 3');
    expect(screen.getByTestId('location-probe-search')).not.toHaveTextContent('from=');

    // 框到 2 月~3 月：只剩那一段的两场，统计跟着变，URL 记下范围
    fireEvent.click(chip);
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-03-31' } });

    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(2));
    expect(screen.getAllByTestId('campaign-operation-time').map(node => node.textContent)).toEqual([
      '操作时间：2026-03-02 08:00',
      '操作时间：2026-02-01 08:00',
    ]);
    expect(screen.getByTestId('campaign-operation-range')).toHaveTextContent('2026-02-01 ~ 2026-03-31');
    expect(screen.getByTestId('campaign-operation-range')).toHaveAttribute('data-range-active', 'true');
    expect(screen.getByTestId('campaign-valid-count')).toHaveTextContent('有效战役 2');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('from=2026-02-01');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('to=2026-03-31');

    // 「恢复全部」回到默认，URL 也清干净
    fireEvent.click(screen.getByTestId('campaign-range-clear'));
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
    expect(screen.getByTestId('campaign-operation-range')).toHaveTextContent('操作时间 全部');
    expect(screen.getByTestId('location-probe-search')).not.toHaveTextContent('from=');
  }, 15_000);

  it('【用户要求】?from/?to 进来就按该范围渲染；范围内一场都没有时说清是时间段筛空的', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?from=2020-01-01&to=2020-12-31']}>
        <Routes>
          <Route path="/journal/campaigns" element={<JournalCampaignsPage />} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const empty = await screen.findByTestId('campaign-empty-range');
    expect(empty).toHaveTextContent('2020-01-01 ~ 2020-12-31 内没有战役');
    expect(screen.queryByTestId('campaign-card')).toBeNull();
    // 不能说成「尚无战役」——整表是有的，只是被时间段挡住了
    expect(screen.queryByText('尚无战役')).toBeNull();
    expect(screen.getByText(/整表共 4 场/)).toBeInTheDocument();
  }, 15_000);

  it('【用户要求】几何期望多一种「分布」看法并设为默认：看形状偏不偏，且不套盈亏比的止损墙', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=geometricExpectancy&direction=desc']}>
        <Routes>
          <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.contextMenu(await screen.findByTestId('campaign-sort-geometricExpectancy'));
    fireEvent.click(await screen.findByTestId('campaign-geometricExpectancy-chart-toggle'));

    // 默认落在分布视图
    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'geometricExpectancyDistribution'));
    expect(screen.getByTestId('campaign-geometricExpectancy-view-distribution'))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-geometricExpectancy-view-time'))
      .toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('location-probe-search'))
      .toHaveTextContent('chart=geometricExpectancyDistribution');

    // 盈亏平衡线按本指标的读数写成 1.00，而盈亏比专属的 −1R 止损墙不该出现
    expect(screen.getByTestId('campaign-metric-break-even-geometricExpectancyDistribution-label'))
      .toHaveTextContent('1.00 盈亏平衡');
    expect(screen.queryByTestId('campaign-metric-loss-wall-geometricExpectancyDistribution')).toBeNull();
    // 右尾那一项按 +5R 计数，只有盈亏比读得出意思
    expect(screen.queryByTestId('campaign-metric-tail-count-geometricExpectancyDistribution')).toBeNull();
    // 密度曲线在，说明走的是同一套分布机制
    expect(screen.getByTestId('campaign-metric-density-curve-geometricExpectancyDistribution')).toBeInTheDocument();

    // 【用户要求】b 很重要：镜像止盈之外的散点图，悬停 / 聚焦也要报得出这一场的 b
    const geoPoints = [...screen.getByTestId('campaign-metric-scatter-plot')
      .querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(geoPoints.length).toBeGreaterThan(0);
    expect(geoPoints.some(node => /· b [+-]\d+\.\d{2}R/.test(node.getAttribute('aria-label') ?? ''))).toBe(true);

    // 【评审发现】说明面板的「横轴」一行必须说这张图自己的事，
    // 不能照抄盈亏比那套（单位 R、+10R 封顶、−1R 止损墙——这里一样都不成立）
    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-geometricExpectancyDistribution'));
    const guide = await screen.findByTestId('campaign-metric-guide-geometricExpectancyDistribution');
    expect(guide.textContent).toContain('横轴按 ln(Gᵢ) 对数刻度排布');
    expect(guide.textContent).toContain('0.5 → 1 → 2 等距');
    expect(guide.textContent).not.toContain('单位 R');
    expect(guide.textContent).not.toContain('封顶在 +10R');       // 盈亏比才有的封顶
    expect(guide.textContent).not.toContain('落在墙外');           // 这里根本不画止损墙
    expect(guide.textContent).toContain('−1R 止损墙与 +10R 封顶在这里不适用');
    expect(guide.textContent).not.toContain('按客观操作时间从早到晚等距排列');
    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-geometricExpectancyDistribution'));

    // 切回时序仍然可用
    fireEvent.click(screen.getByTestId('campaign-geometricExpectancy-view-time'));
    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'geometricExpectancy'));
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

  it('散点图模式下点击排序项会跳到对应指标图，并保留排序切换', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns?sort=captureRate&direction=desc&chart=oddsDistribution']}>
        <Routes>
          <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
          <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'oddsDistribution'));
    expect(screen.getByTestId('campaign-sort-captureRate')).toHaveAttribute('data-sort-direction', 'desc');

    fireEvent.click(screen.getByTestId('campaign-sort-geometricExpectancy'));

    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'geometricExpectancyDistribution'));
    expect(screen.getByTestId('campaign-geometricExpectancy-view-distribution'))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('sort=geometricExpectancy');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('chart=geometricExpectancyDistribution');

    fireEvent.click(screen.getByTestId('campaign-sort-geometricExpectancy'));
    expect(screen.getByTestId('campaign-sort-geometricExpectancy')).toHaveAttribute('data-sort-direction', 'asc');
    expect(screen.getByTestId('campaign-metric-scatter-plot'))
      .toHaveAttribute('data-metric-key', 'geometricExpectancyDistribution');
    expect(screen.getByTestId('location-probe-search')).toHaveTextContent('direction=asc');
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
      // 【用户要求】操作时间、镜像止盈 ┆ 预期回撤 … 算术期望 ┆ DSI 贡献 … 字母；重要性放在后面（字母之前）
      'campaign-sort-time',
      'campaign-sort-mirrorTp',
      'campaign-sort-expectedDrawdownPct',
      'campaign-sort-mainPriceChange',
      'campaign-sort-mainPriceEfficiency',
      'campaign-sort-captureRate',
      'campaign-sort-addEfficiency',
      'campaign-sort-geometricExpectancy',
      'campaign-sort-arithmeticExpectancy',
      'campaign-sort-dsiContribution',
      'campaign-sort-usiContribution',
      'campaign-sort-leverage',
      'campaign-sort-importance',
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
      // 与排序行同序：镜像止盈、预期回撤，之后涨跌幅…几何期望、算术期望
      'campaign-mirror-tp-status',
      'campaign-expected-drawdown-pct',
      'campaign-main-price-change',
      'campaign-main-price-efficiency',
      'campaign-payoff-ratio',
      'campaign-add-efficiency',
      'campaign-geometric-expectancy',
      'campaign-arithmetic-expectancy',
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
    expect(screen.getAllByTestId('campaign-payoff-ratio').map(metricReading)).toEqual([
      '盈亏比：300.00%（3.00）',
      '盈亏比：50.00%（0.50）',
      '盈亏比：-80.00%（-0.80）',
      '盈亏比：—',
    ]);
    const payoffRatioValues = screen.getAllByTestId('campaign-payoff-ratio-value');
    // 正绿负红：深色主题币安绿 / 红，浅色主题换成与散点图同一对更深的绿 / 红（浅底上才读得清）
    expect(payoffRatioValues[0]).toHaveClass('text-[#00875A]', 'dark:text-[#0ECB81]');
    expect(payoffRatioValues[1]).toHaveClass('text-[#00875A]', 'dark:text-[#0ECB81]');
    expect(payoffRatioValues[2]).toHaveClass('text-[#DE350B]', 'dark:text-[#F6465D]');
    expect(payoffRatioValues[3]).toHaveClass('text-foreground/85');
    expect(screen.getAllByTestId('campaign-expected-drawdown-pct').map(metricReading)).toEqual([
      '预期回撤：10.00%',
      '预期回撤：2.00%',
      '预期回撤：50.00%',
      '预期回撤：—',
    ]);
    // 【用户要求】「机会质量」删掉（涨跌幅倍数更合理）：卡片上不再有这一格
    expect(screen.queryByTestId('campaign-opportunity-quality-value')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('campaign-arithmetic-expectancy').map(metricReading)).toEqual([
      // 【用户要求】胜率统一 50%：E = 0.5 × b − 0.5
      '算术期望：+1.00R',   // b = +3.00
      '算术期望：-0.25R',   // b = +0.50
      '算术期望：-0.90R',   // b = −0.80
      '算术期望：—',
    ]);
    // 【用户要求】单场几何期望以 Gᵢ = 1 + bᵢ×0.1 呈现；1.00 是本金不增不减的分界
    expect(screen.getAllByTestId('campaign-geometric-expectancy').map(metricReading)).toEqual([
      '几何期望：1.30',   // b = +3.00
      '几何期望：1.05',   // b = +0.50
      '几何期望：0.92',   // b = −0.80，亏损场落在 1.00 以下
      '几何期望：—',      // 没有有效 bᵢ
    ]);
    expect(screen.queryByText(/峰值浮盈/)).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('data-sort-direction', 'desc');
    expect(screen.getByTestId('campaign-sort-time')).toHaveAttribute('aria-label', '操作时间，从大到小排序');
    const sortControls = screen.getByTestId('campaign-sort-controls');
    const metricsStrip = screen.getByTestId('campaign-metrics-strip');
    expect(screen.getByTestId('campaign-sticky-controls')).toHaveClass('sticky');
    expect(screen.getByTestId('campaign-sticky-controls')).toHaveClass('top-[57px]');
    expect(screen.getByTestId('campaign-sticky-controls')).toContainElement(metricsStrip);
    expect(screen.getByTestId('campaign-sticky-controls')).toContainElement(sortControls);
    expect(sortControls).not.toContainElement(screen.getByTestId('campaign-valid-count'));
    expect(metricsStrip).toContainElement(screen.getByTestId('campaign-valid-count'));
    expect(screen.queryByTestId('campaign-opportunity-quality')).not.toBeInTheDocument();
    expect(metricsStrip).toContainElement(screen.getByTestId('campaign-asymmetric-risk'));
    expect(metricsStrip).toContainElement(screen.getByTestId('campaign-geometric-edge'));
    expect(screen.getByTestId('campaign-valid-count')).toHaveTextContent('有效战役 3');
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
    expect(screen.getByTestId('campaign-win-rate')).toHaveTextContent('胜率 66.67%');
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
    expect(payoffChip.textContent).toMatch(/平均盈亏比 \+\d+\.\d{2}R/);
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
    expect(screen.getByTestId('campaign-expected-value')).toHaveTextContent('期望值 +0.90R');
    // 统计概览每一项写成「名称 + 数值」：名称淡、数值用等宽数字；带方向的期望值按正负着色
    const expectedValueNumber = screen.getByTestId('campaign-expected-value').querySelector('.font-mono');
    expect(expectedValueNumber).toHaveTextContent('+0.90R');
    expect(expectedValueNumber).toHaveClass('text-[#00875A]', 'dark:text-[#0ECB81]');
    expect(screen.getByTestId('campaign-valid-count').querySelector('.font-mono')).toHaveTextContent('3');
    expect(screen.getByTestId('campaign-win-rate').querySelector('.font-mono')).toHaveTextContent('66.67%');
    fireEvent.click(screen.getByTestId('campaign-expected-value'));
    expect(screen.getByText('E = Σ bᵢ ÷ N')).toBeInTheDocument();
    expect(screen.getByText('= (n赢 × b̄赢 + n亏 × b̄亏) ÷ N')).toBeInTheDocument();
    // 理论公式仍并列展示，注明它假设亏损恰为 −1R、b 取赢时均值
    expect(screen.getByText('E = P(赢) × b − (1 − P(赢))')).toBeInTheDocument();
    expect(screen.getByText('= +0.90R')).toBeInTheDocument();
    expect(screen.getByText('P(赢) 仅统计设置了最大预期亏损的有效战役')).toBeInTheDocument();
    // 【用户要求】复合战役增长率撤掉：几何期望的 W = G^n 已经表达了同一件事
    expect(screen.queryByTestId('campaign-compound-growth-rate')).not.toBeInTheDocument();
    expect(screen.queryByText('复合战役增长率计算公式')).not.toBeInTheDocument();

    // 【用户要求】几何期望：x 固定 10%、b 取盈利战役均值、p 取胜率、n 取有效战役数，并报 W = G^n
    fireEvent.click(screen.getByTestId('campaign-geometric-edge'));
    // 【用户要求】浮层分成两块：上半是理论推演，下半是实际复利结果
    expect(screen.getByText('几何期望 · 两个口径')).toBeInTheDocument();
    expect(screen.getByText('几何期望（每笔复利率）')).toBeInTheDocument();
    expect(screen.getByText('实际复利结果')).toBeInTheDocument();
    expect(screen.getByText(/G = \(1\+b·x\)\^p[\s\S]*W = G\^n/)).toBeInTheDocument();
    expect(screen.getByText(/∏（1\+bᵢ·x），bᵢ = 每场真实盈亏比/)).toBeInTheDocument();
    // 公式行里代入的 b 就是概览那一项显示的盈利侧均值，x 是 10%
    const winMeanText = screen.getByTestId('campaign-average-payoff-ratio')
      .textContent!.match(/\+(\d+\.\d{2})R/)![1];
    expect(screen.getByText(new RegExp(`G = \\(1 \\+ ${winMeanText} × 10%\\)`))).toBeInTheDocument();
    expect(screen.getByText(/W = G\^3 = ×/)).toBeInTheDocument();
    expect(screen.getByText(/b = 盈利战役的平均实际盈亏比（.*2 场）/)).toBeInTheDocument();
    expect(screen.getByText(/n = 有效战役数（3 场）/)).toBeInTheDocument();
    // 【用户要求】另一种统计口径：把每场的 (1+bᵢ·x) 连乘起来，并给出每场几何平均
    expect(screen.getByText(/∏（1\+bᵢ·x）= ×/)).toBeInTheDocument();
    expect(screen.getByText(/3 场逐场连乘/)).toBeInTheDocument();
    // 「每场几何平均」那一行按要求撤掉了
    expect(screen.queryByText(/每场几何平均/)).not.toBeInTheDocument();
    // 【用户要求】最优仓位 x* 那一行不再显示
    expect(screen.queryByText(/最优仓位 x\*/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-geometric-edge'));

    // 【用户要求】卡片上不再显示策略模板名
    expect(screen.queryByText('主仓 + 双对冲 + 镜像止盈')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-asymmetric-risk')).toHaveTextContent('不对称风险 UPR 2.53 · Ω 4.38');
    fireEvent.click(screen.getByTestId('campaign-asymmetric-risk'));
    // 概览那一项自己也有「不对称风险」字样，浮层以它的副标题为准
    expect(screen.getByText('上行与下行分开计量，完整保留右尾贡献')).toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId('campaign-win-rate'));
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
