/**
 * 列表页的重渲染边界。
 *
 * 用户报告：散点图加载出来之后稍有操作就重新加载、而且很慢。根源有三：
 *   · auth 每次刷新 token 都换一个 user 对象，取数 effect 跟着重跑；
 *   · 行情每个 tick 都让整页重渲染，237 张卡片与整张 SVG 一起重画；
 *   · 详情返回没有缓存，从 0/237 重来。
 * 这里用三个计数器盯住：页面自己（账户权益每 tick 都要算）、散点图元件、每张卡片。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCampaignListCaches, waitForCampaignListHeal } from '@/lib/campaignListCache';
import { deleteCampaign, fetchCampaignSourceRows, getCampaignFullData } from '@/lib/journalApi';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import JournalCampaignsPage from '../JournalCampaignsPage';

const counters = vi.hoisted(() => ({ page: 0, scatter: 0, card: 0 }));

/** 行情 tick：换一个 priceMap 引用并通知订阅者，成交 / 委托 / 仓位引用保持不变。 */
const trading = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const stable = { positionsMap: {}, tradeHistory: [], ordersMap: {}, filledOrders: [] };
  let value = {
    balance: 100_000, priceMap: { BTCUSDT: 100 } as Record<string, number>, ...stable,
    getEffectiveTime: () => Date.parse('2026-08-23T12:00:00.000Z'),
  };
  return {
    get: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    tick: () => {
      value = { ...value, priceMap: { BTCUSDT: value.priceMap.BTCUSDT + 1 } };
      listeners.forEach(listener => listener());
    },
    /** 成交 / 委托变了：换那一份引用（时间机器里的一笔成交）。 */
    set: (patch: Partial<typeof stable>) => {
      value = { ...value, ...patch };
      listeners.forEach(listener => listener());
    },
  };
});

vi.mock('@/contexts/TradingContext', async () => {
  const React = await import('react');
  return { useTradingContext: () => React.useSyncExternalStore(trading.subscribe, trading.get) };
});

// 每次渲染都是新的 user 对象：与 AuthContext 在 TOKEN_REFRESHED / SIGNED_IN 时的行为一致
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'desk@example.com' }, profile: { display_name: '主账户' } }),
}));

vi.mock('@/lib/accountEquity', () => ({
  // 每次都给一个新数：账户权益随行情变，下游按值 memo 的地方一律失效，只有按引用保留的行才不重画
  computeCurrentAccountEquity: () => { counters.page += 1; return 100_000 + counters.page; },
}));

vi.mock('@/lib/campaignCode', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignCode')>();
  return {
    ...actual,
    // 每张卡片每次渲染恰好调用一次：拿它当卡片渲染计数
    formatCampaignDisplayCode: (...args: Parameters<typeof actual.formatCampaignDisplayCode>) => {
      counters.card += 1;
      return actual.formatCampaignDisplayCode(...args);
    },
  };
});

vi.mock('@/components/journal/CampaignOddsScatterPlot', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/journal/CampaignOddsScatterPlot')>();
  const React = await import('react');
  return {
    ...actual,
    CampaignMetricScatterPlot: (props: Parameters<typeof actual.CampaignMetricScatterPlot>[0]) => {
      counters.scatter += 1;
      return React.createElement(actual.CampaignMetricScatterPlot, props);
    },
  };
});

vi.mock('@/lib/campaignLegExecution', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignLegExecution')>(),
  fetchLegExitPriceCorrections: vi.fn(async () => ({})),
  // 列表读的是带完整性标记的版本：无校正、已拉齐
  fetchLegExitPriceCorrectionsResult: vi.fn(async () => ({ corrections: {}, complete: true })),
}));

const campaigns: TradeCampaign[] = [
  makeCampaign({ id: 'high-importance', title: 'High Importance', opened_at: '2026-01-01T00:00:00.000Z', closed_at: '2026-01-02T00:00:00.000Z', initial_main_size_usdt: 100, initial_leverage: 3, final_realized_pnl: 30, importance_weight: 5 }),
  makeCampaign({ id: 'newest', title: 'Newest Operation', opened_at: '2026-03-01T00:00:00.000Z', closed_at: '2026-03-02T00:00:00.000Z', initial_main_size_usdt: 1000, initial_leverage: 20, final_realized_pnl: 50, importance_weight: 1 }),
  makeCampaign({ id: 'best-pnl', title: 'Best PnL', opened_at: '2026-02-01T00:00:00.000Z', closed_at: '2026-02-02T00:00:00.000Z', initial_main_size_usdt: 100000, initial_leverage: 10, final_realized_pnl: 1000, importance_weight: 0 }),
];

const legsByCampaign: Record<string, TradeJournal[]> = {
  'high-importance': [makeLeg({ id: 'high-importance-leg', trade_record_id: 'high-importance-record', pre_real_time: '2026-04-03T00:00:00.000Z', pre_account_equity_usdt: 100 })],
  newest: [makeLeg({ id: 'newest-leg', trade_record_id: 'newest-record', pre_real_time: '2026-01-10T00:00:00.000Z', pre_account_equity_usdt: 10_000 })],
  'best-pnl': [
    makeLeg({ id: 'best-pnl-leg', trade_record_id: 'best-pnl-record', pre_real_time: '2026-03-02T00:00:00.000Z', pre_account_equity_usdt: 40_000 }),
    makeLeg({ id: 'best-pnl-hedge', leg_role: 'hedge_initial_a', pre_entry_price: 98 }),
  ],
};

const tradeHistory: TradeRecord[] = [
  makeRecord('high-importance-record', '2026-04-03T00:00:00.000Z', 1, 30),
  makeRecord('newest-record', '2026-01-10T00:00:00.000Z', 10, 50),
  makeRecord('best-pnl-record', '2026-03-02T00:00:00.000Z', 1_000, 1_000),
];

// 后台自愈的让出闸：默认沿用真实实现，个别用例把它换成手动放行
vi.mock('@/lib/campaignListCache', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignListCache')>();
  return { ...actual, waitForCampaignListHeal: vi.fn(actual.waitForCampaignListHeal) };
});

vi.mock('@/lib/journalApi', () => ({
  appendCampaignEvent: vi.fn(async () => undefined),
  closeCampaign: vi.fn(async () => undefined),
  deleteCampaign: vi.fn(),
  createUserLocalSnapshotReader: () => ({
    // 与真实读取器同一约定：页面给的内存数据优先
    read: (overrides: Record<string, unknown> = {}) => ({
      tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {}, ...overrides,
    }),
  }),
  getCampaignFullData: vi.fn(async (id: string, options?: { local?: { tradeHistory: TradeRecord[] } }) => ({
    campaign: campaigns.find(campaign => campaign.id === id),
    legs: legsByCampaign[id] ?? [],
    // 内存里多了 newest 那个仓位的一条资金费记录：只有 newest 的成交列表变（别的战役不变）
    tradeRecords: [
      ...tradeHistory.filter(record => (legsByCampaign[id] ?? []).some(leg => leg.trade_record_id === record.id)),
      ...(options?.local?.tradeHistory ?? []).filter(record => id === 'newest' && record.positionId === 'newest-record'),
    ],
    pendingOrders: [],
    reverseHedgeOrders: id === 'high-importance' ? [{ id: 'high-importance-hedge', side: 'SHORT', price: 90, createdAt: 1, status: 'pending' }] : [],
  })),
  fetchCampaignSourceRows: vi.fn(async () => ({ campaigns, journals: [] })),
  assembleCampaignsWithLegs: (_userId: string, rows: { campaigns: TradeCampaign[] }) => (
    rows.campaigns.map(campaign => ({ campaign, legs: legsByCampaign[campaign.id] ?? [] }))
  ),
  listDeletedCampaigns: vi.fn(async () => []),
  permanentlyDeleteCampaign: vi.fn(),
  restoreCampaign: vi.fn(),
  updateCampaignImportance: vi.fn(async (_id: string, weight: number) => weight),
}));

function makeRecord(id: string, objectiveTime: string, quantity: number, pnl = 10): TradeRecord {
  return {
    id, symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: 100, exitPrice: 110,
    quantity, leverage: 1, pnl, fee: 0, slippage: 0,
    openTime: Date.parse('2025-01-01T00:00:00.000Z'), closeTime: Date.parse('2025-01-01T01:00:00.000Z'),
    closedRealAt: Date.parse(objectiveTime),
  };
}

function makeCampaign(overrides: Partial<TradeCampaign>): TradeCampaign {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: overrides.id ?? 'campaign', user_id: 'user-1', campaign_code: `C-${overrides.id ?? 'campaign'}`, symbol: 'BTCUSDT',
    direction: 'main_long', status: overrides.status ?? 'closed_profit', strategy_template: 'custom', title: overrides.title ?? 'Campaign',
    opened_at: overrides.opened_at ?? now, closed_at: overrides.closed_at ?? null,
    initial_main_size_usdt: overrides.initial_main_size_usdt ?? null, initial_leverage: overrides.initial_leverage ?? null,
    final_realized_pnl: overrides.final_realized_pnl ?? null, final_r_multiple: null, peak_unrealized_pnl: null, peak_drawdown: null,
    importance_weight: overrides.importance_weight ?? 0, notes: null, actual_evolution: [], deviation_notes: {},
    deleted_at: null, created_at: now, updated_at: now,
  };
}

function makeLeg(overrides: Partial<TradeJournal>): TradeJournal {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: overrides.id ?? 'leg', user_id: 'user-1', trade_record_id: overrides.trade_record_id ?? null, campaign_id: null,
    leg_role: overrides.leg_role ?? 'main_open', leg_sequence: null, source: 'post_review', symbol: 'BTCUSDT', direction: 'long',
    leverage: null, position_mode: null, order_kind: 'main', pre_simulated_time: now, pre_real_time: overrides.pre_real_time ?? now,
    pre_entry_price: overrides.pre_entry_price ?? null, pre_planned_stop_loss: null, pre_planned_take_profit: null,
    pre_entry_reason: null, pre_mental_state: 3, pre_mental_trigger: null, pre_risk_awareness: null, pre_risk_management: null,
    pre_checklist_items: null, pre_checklist_passed: null, pre_position_size: null, pre_max_loss_usdt: null,
    pre_account_equity_usdt: overrides.pre_account_equity_usdt ?? null,
    post_outcome: null, post_realized_pnl: null, post_r_multiple: null, post_reflection: null, post_correct_action: null,
    post_reviewed_at: null, post_real_close_time: null, created_at: now, updated_at: now,
  } as unknown as TradeJournal;
}

const CHART_URL = '/journal/campaigns?chart=geometricExpectancyDistribution';
const SUMMARY_ID = 'campaign-metric-summary-geometricExpectancyDistribution';

function renderPage(url = CHART_URL) {
  return render(<MemoryRouter initialEntries={[url]}><JournalCampaignsPage /></MemoryRouter>);
}

beforeEach(() => {
  clearCampaignListCaches();
  vi.clearAllMocks();
  counters.page = 0;
  counters.scatter = 0;
  counters.card = 0;
});

describe('JournalCampaignsPage rendering boundaries', () => {
  it('a new auth user object on every render does not restart the first load', async () => {
    let resolveRows!: (rows: Awaited<ReturnType<typeof fetchCampaignSourceRows>>) => void;
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(new Promise(resolve => { resolveRows = resolve; }));
    renderPage();
    expect(screen.getByTestId('campaign-metric-loading')).toBeInTheDocument();
    // 首载还没回来，页面已经因为行情 tick（每次都拿到新的 user 对象）重渲染了三次
    for (let i = 0; i < 3; i += 1) act(() => trading.tick());
    expect(counters.page).toBeGreaterThanOrEqual(4);
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
    await act(async () => { resolveRows({ campaigns, journals: [] }); });
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(3));
    await screen.findByTestId(SUMMARY_ID);
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
    expect(getCampaignFullData).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('campaign-metric-loading')).not.toBeInTheDocument();
  });

  it('coming back to the page shows the finished list and chart synchronously, without the progress bar', async () => {
    const first = renderPage();
    await screen.findByTestId(SUMMARY_ID);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(3));
    first.unmount();

    // 回来时远端核对还没返回：图与卡片必须已经在
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(new Promise(() => {}));
    renderPage();
    expect(screen.getAllByTestId('campaign-card')).toHaveLength(3);
    expect(screen.getByTestId(SUMMARY_ID)).toBeInTheDocument();
    expect(screen.queryByTestId('campaign-metric-loading')).not.toBeInTheDocument();
    expect(getCampaignFullData).toHaveBeenCalledTimes(3);
  });

  it('price ticks re-render the page but neither the scatter plot nor a single card', async () => {
    renderPage();
    await screen.findByTestId(SUMMARY_ID);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(3));
    // 等首载的后台收尾（价格校正）过去，再开始数
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const before = { ...counters };
    expect(before.scatter).toBeGreaterThan(0);
    expect(before.card).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < 5; i += 1) act(() => trading.tick());
    expect(counters.page - before.page).toBe(5);
    expect(counters.scatter).toBe(before.scatter);
    expect(counters.card).toBe(before.card);

    // 计数器不是摆设：展开一张卡片只重画那一张
    fireEvent.click(screen.getAllByLabelText('展开战役详情')[0]);
    expect(counters.card).toBe(before.card + 1);
    expect(counters.scatter).toBe(before.scatter);
  });

  it('a funding record on one campaign re-renders that card and the scatter once; the other cards keep their objects', async () => {
    renderPage();
    await screen.findByTestId(SUMMARY_ID);
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(3));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const before = { ...counters };
    const calls = vi.mocked(getCampaignFullData).mock.calls.length;

    // 时间机器结算了一笔资金费（金额 0：全表统计一个数都不变）：合并窗口过后本地核对，只有 newest 的行换了对象
    const funding: TradeRecord = {
      ...makeRecord('newest-funding', '2026-01-11T00:00:00.000Z', 10, 0),
      action: 'FUNDING', type: 'FUNDING' as never, exitPrice: 0, positionId: 'newest-record',
    };
    act(() => trading.set({ tradeHistory: [funding] }));
    // 资金费不进回放事件流：只有持有那个仓位的 newest 重算，另外两场连算都不算
    await waitFor(() => expect(vi.mocked(getCampaignFullData).mock.calls.length).toBe(calls + 1), { timeout: 3_000 });
    expect(vi.mocked(getCampaignFullData).mock.calls[calls][0]).toBe('newest');
    await waitFor(() => expect(counters.card).toBe(before.card + 1));
    expect(counters.scatter).toBe(before.scatter + 1);
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(counters.card).toBe(before.card + 1);
    expect(counters.scatter).toBe(before.scatter + 1);
    expect(screen.getAllByTestId('campaign-card')).toHaveLength(3);
  });
});

describe('JournalCampaignsPage · writes wait for the background heal', () => {
  it('delete removes the card at once but calls the API only after an in-flight heal has landed', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(3));
    let release!: () => void;
    vi.mocked(waitForCampaignListHeal).mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByTitle('删除战役')[0]);
    // 乐观更新照旧即时
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(2));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(deleteCampaign).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(deleteCampaign).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });
});
