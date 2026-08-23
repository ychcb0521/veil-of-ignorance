/**
 * 列表页顶部那条黄色提醒「不要让它无限期 active」现在是可以按的：
 * 按下去就把进行中的战役一次结束掉。这条测试守两件事——
 *
 *   1. 状态是**算出来**的，不是选出来的：确认框里显示什么，就往数据库写什么；
 *   2. 结束时间取该场最后一笔成交，不是此刻，也不是当前时钟。
 *
 * 还有一档不能一刀切：仍有未结算腿的战役只能被标成「放弃」，
 * 而且必须由用户额外勾选——默认不动它。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import JournalCampaignsPage from '../JournalCampaignsPage';

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return { ...actual, fetchLegExitPriceCorrections: vi.fn(async () => ({})) };
});

const { mockUser, mockCloseCampaign, mockAppendCampaignEvent } = vi.hoisted(() => ({
  /**
   * 必须是同一个对象引用。页面的取数 effect 依赖 [user]，
   * 每次渲染都新建一个 user 会让它每帧重跑一次 setRows —— 页面看似正常，
   * 实则永不停歇地重渲染，测试进程会一直挂着。真实的 AuthContext 给的是稳定引用。
   */
  mockUser: { id: 'user-1', email: 'desk@example.com' },
  // closeCampaign 的返回值现在参与判定：handler 拿它回读 closed_at，
  // 确认这次结束真的落库了。mock 必须像真的一样把写回的那一行还回来。
  mockCloseCampaign: vi.fn(async (_id: string, patch: ClosePatch) => ({ closed_at: patch.closed_at } as unknown)),
  mockAppendCampaignEvent: vi.fn(async (_id: string, _event: { event_type: string }) => undefined),
}));

/** closeCampaign 的补丁形状，只列这条测试要断言的字段。 */
interface ClosePatch {
  status: string;
  final_realized_pnl: number | null;
  final_r_multiple: number | null;
  closed_at: string;
}

const WIN_FILL_MS = Date.parse('2026-04-11T02:30:00.000Z');
const LOSE_FILL_MS = Date.parse('2026-04-10T09:00:00.000Z');
/** 兜底时钟，比任何一笔成交都晚——用来证明结束时间没有偷偷取「此刻」。 */
const CLOCK_MS = Date.parse('2026-08-23T12:00:00.000Z');

function makeCampaign(over: Partial<TradeCampaign>): TradeCampaign {
  return {
    id: 'c', user_id: 'user-1', campaign_code: `C-${over.id}`, symbol: 'BTCUSDT',
    direction: 'main_long', status: 'active', strategy_template: 'custom', title: 'Campaign',
    opened_at: '2026-04-01T00:00:00.000Z', closed_at: null, initial_main_size_usdt: 1_000,
    initial_leverage: null, final_realized_pnl: null, final_r_multiple: null,
    peak_unrealized_pnl: 12, peak_drawdown: 34, importance_weight: 0, notes: null,
    actual_evolution: [], deviation_notes: {}, deleted_at: null,
    created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
    ...over,
  } as TradeCampaign;
}

function makeLeg(over: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'leg', user_id: 'user-1', trade_record_id: null, campaign_id: null, leg_role: 'main_open',
    source: 'post_review', symbol: 'BTCUSDT', direction: 'long', order_kind: 'main',
    pre_simulated_time: '2026-04-01T00:00:00.000Z', pre_real_time: '2026-04-01T00:00:00.000Z',
    pre_mental_state: 3, pre_max_loss_usdt: 100, post_realized_pnl: null,
    created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
    ...over,
  } as TradeJournal;
}

function makeRecord(id: string, pnl: number, closeTime: number): TradeRecord {
  return {
    id, symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
    entryPrice: 100, exitPrice: 110, quantity: 1, leverage: 1, pnl, fee: 0, slippage: 0,
    openTime: closeTime - 3_600_000, closeTime,
  } as TradeRecord;
}

const campaigns: TradeCampaign[] = [
  makeCampaign({ id: 'win', title: '赢的那场' }),
  makeCampaign({ id: 'lose', title: '亏的那场' }),
  makeCampaign({ id: 'running', title: '还在跑的那场' }),
  makeCampaign({ id: 'done', title: '早就结束的那场', status: 'closed_profit', closed_at: '2026-04-05T00:00:00.000Z', final_realized_pnl: 88 }),
];

const legsByCampaign: Record<string, TradeJournal[]> = {
  win: [makeLeg({ id: 'win-leg', trade_record_id: 'win-r' })],
  lose: [makeLeg({ id: 'lose-leg', trade_record_id: 'lose-r' })],
  // 一条已结算 + 一条还开着：这场是真的还在跑
  running: [
    makeLeg({ id: 'running-leg', trade_record_id: 'running-r' }),
    makeLeg({ id: 'running-hedge', leg_role: 'hedge_initial_a' }),
  ],
  done: [makeLeg({ id: 'done-leg', trade_record_id: 'done-r' })],
};

const records: Record<string, TradeRecord> = {
  'win-r': makeRecord('win-r', 1_200, WIN_FILL_MS),
  'lose-r': makeRecord('lose-r', -340, LOSE_FILL_MS),
  'running-r': makeRecord('running-r', 500, LOSE_FILL_MS),
  'done-r': makeRecord('done-r', 88, LOSE_FILL_MS),
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, profile: { display_name: '主账户' } }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    balance: 100_000,
    positionsMap: {},
    priceMap: {},
    getEffectiveTime: () => CLOCK_MS,
  }),
}));

vi.mock('@/lib/journalApi', () => ({
  appendCampaignEvent: mockAppendCampaignEvent,
  closeCampaign: mockCloseCampaign,
  deleteCampaign: vi.fn(),
  getCampaignFullData: vi.fn(async (id: string) => ({
    campaign: campaigns.find(campaign => campaign.id === id),
    legs: legsByCampaign[id] ?? [],
    tradeRecords: (legsByCampaign[id] ?? [])
      .map(leg => leg.trade_record_id && records[leg.trade_record_id])
      .filter(Boolean),
    pendingOrders: [],
    reverseHedgeOrders: [],
  })),
  listAllCampaigns: vi.fn(async () => campaigns),
  listDeletedCampaigns: vi.fn(async () => []),
  permanentlyDeleteCampaign: vi.fn(),
  restoreCampaign: vi.fn(),
  updateCampaignImportance: vi.fn(),
}));

async function openBulkCloseDialog() {
  render(<MemoryRouter initialEntries={['/journal/campaigns']}><JournalCampaignsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
  fireEvent.click(screen.getByTestId('active-campaigns-banner'));
  return screen.getByTestId('bulk-close-dialog');
}

/** 取出写给某场战役的补丁；没写到就直接判红，而不是让断言在 undefined 上静默通过。 */
function closedPatches(): Record<string, ClosePatch> {
  return Object.fromEntries(mockCloseCampaign.mock.calls.map(call => [call[0], call[1]]));
}

function patchFor(id: string): ClosePatch {
  const patch = closedPatches()[id];
  if (!patch) throw new Error(`没有为战役 ${id} 写入结束状态`);
  return patch;
}

function rowByCampaign(id: string): HTMLElement {
  const row = screen.getAllByTestId('bulk-close-row').find(el => el.dataset.campaignId === id);
  expect(row).toBeTruthy();
  return row as HTMLElement;
}

describe('战役列表 · 一键结束进行中的战役', () => {
  it('黄条本身就是按钮，点开后逐场摊出「会变成什么」', async () => {
    mockCloseCampaign.mockClear();
    const dialog = await openBulkCloseDialog();
    expect(screen.getByTestId('active-campaigns-banner').tagName).toBe('BUTTON');
    // 只收进行中的三场，已结束的那场不进来
    expect(screen.getAllByTestId('bulk-close-row')).toHaveLength(3);

    expect(rowByCampaign('win')).toHaveTextContent('盈利结束');
    expect(rowByCampaign('win')).toHaveTextContent('+1200.00');
    expect(rowByCampaign('lose')).toHaveTextContent('亏损结束');
    expect(rowByCampaign('lose')).toHaveTextContent('-340.00');
    // 还有腿没结算的那场只能是「放弃」，且默认不选中
    expect(rowByCampaign('running')).toHaveTextContent('放弃');
    expect(rowByCampaign('running')).toHaveTextContent('还有 1 条腿未结算');
    expect(rowByCampaign('running').dataset.included).toBe('false');
    expect(dialog).toHaveTextContent('结束这 2 场');
  });

  it('写库的状态与金额就是确认框上显示的那一份，时间取最后一笔成交', async () => {
    mockCloseCampaign.mockClear();
    mockAppendCampaignEvent.mockClear();
    await openBulkCloseDialog();
    fireEvent.click(screen.getByTestId('bulk-close-confirm'));

    await waitFor(() => expect(mockCloseCampaign).toHaveBeenCalledTimes(2));
    expect(patchFor('win').status).toBe('closed_profit');
    expect(patchFor('win').final_realized_pnl).toBeCloseTo(1_200, 8);
    expect(patchFor('win').final_r_multiple).toBeCloseTo(12, 8); // 1200 / 100 计划最大亏损
    expect(patchFor('win').closed_at).toBe(new Date(WIN_FILL_MS).toISOString());

    expect(patchFor('lose').status).toBe('closed_loss');
    expect(patchFor('lose').closed_at).toBe(new Date(LOSE_FILL_MS).toISOString());

    for (const patch of Object.values(closedPatches())) {
      // 结束时间不是「此刻」，也不是当前时钟
      expect(Date.parse(patch.closed_at)).toBeLessThan(CLOCK_MS);
      // 峰值字段一律不写：批量路径没有权益曲线，补 null 会抹掉单场对话框算出的值
      expect(patch).not.toHaveProperty('peak_unrealized_pnl');
      expect(patch).not.toHaveProperty('peak_drawdown');
    }
    // 事件流补上 campaign_closed，与单场路径同一种数据形状
    expect(mockAppendCampaignEvent).toHaveBeenCalledTimes(2);
    expect(mockAppendCampaignEvent.mock.calls[0]?.[1].event_type).toBe('campaign_closed');

    // 未结算的那场一个字都没动
    expect(closedPatches().running).toBeUndefined();
  });

  it('结束之后卡片当场翻面，黄条只剩下还在跑的那一场', async () => {
    mockCloseCampaign.mockClear();
    await openBulkCloseDialog();
    fireEvent.click(screen.getByTestId('bulk-close-confirm'));

    await waitFor(() => expect(screen.queryByTestId('bulk-close-dialog')).not.toBeInTheDocument());
    const banner = screen.getByTestId('active-campaigns-banner');
    expect(banner).toHaveTextContent('你有 1 个进行中的战役');
    const winCard = screen.getAllByTestId('campaign-card').find(card => card.textContent?.includes('赢的那场'));
    expect(winCard).toHaveTextContent('盈利结束');
  });

  it('事件流写失败不推翻已经落库的结束——那是审计副产物，不是这场的成败', async () => {
    // 曾经两次写入被绑在同一个 try 里：closeCampaign 成功、appendCampaignEvent 抛错时，
    // 数据库其实已经结束了，界面却一行不改、还报「失败」。刷新才发现其实成了——
    // 症状与「完全没写进去」一模一样，结论却相反。
    mockCloseCampaign.mockClear();
    mockAppendCampaignEvent.mockClear();
    mockAppendCampaignEvent.mockRejectedValueOnce(new Error('事件流写失败'));
    await openBulkCloseDialog();
    fireEvent.click(screen.getByTestId('bulk-close-confirm'));

    await waitFor(() => expect(screen.queryByTestId('bulk-close-dialog')).not.toBeInTheDocument());
    // 两场都算结束了，一场只是事件流没写上
    expect(mockCloseCampaign).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('bulk-close-failures')).not.toBeInTheDocument();
    const winCard = screen.getAllByTestId('campaign-card').find(c => c.textContent?.includes('赢的那场'));
    expect(winCard).toHaveTextContent('盈利结束');
  });

  it('结束失败时对话框不关，逐场把原因摆在原地——不是一条停两秒半的 toast', async () => {
    mockCloseCampaign.mockClear();
    mockCloseCampaign.mockRejectedValueOnce(new Error('云端 0 行被更新'));
    await openBulkCloseDialog();
    fireEvent.click(screen.getByTestId('bulk-close-confirm'));

    const panel = await screen.findByTestId('bulk-close-failures');
    expect(panel).toHaveTextContent('1 场没能结束');
    expect(panel).toHaveTextContent('云端 0 行被更新');
    // mockRejectedValueOnce 打的是第一次调用，也就是「赢的那场」
    expect(panel).toHaveTextContent('赢的那场');
    // 对话框必须还开着，按钮改口成「重试」
    expect(screen.getByTestId('bulk-close-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-close-confirm')).toHaveTextContent('重试');
    // 失败的那一场不动，成功的那一场照样当场翻面——一场失败不该拖累另一场
    const cards = screen.getAllByTestId('campaign-card');
    expect(cards.find(c => c.textContent?.includes('赢的那场'))).toHaveTextContent('进行中');
    expect(cards.find(c => c.textContent?.includes('亏的那场'))).toHaveTextContent('亏损结束');
  });

  it('写完回读不到 closed_at 就算失败——不许把没落库的写入报告成成功', async () => {
    // 这是「点了没反应」最难判的那一种：写请求没报错，但一行都没更新。
    mockCloseCampaign.mockClear();
    mockCloseCampaign.mockResolvedValueOnce({} as never);   // 回来的行没有 closed_at
    await openBulkCloseDialog();
    fireEvent.click(screen.getByTestId('bulk-close-confirm'));

    const panel = await screen.findByTestId('bulk-close-failures');
    expect(panel).toHaveTextContent('回读不到结束时间');
  });

  it('勾选之后未结算的那场才被标成放弃', async () => {
    mockCloseCampaign.mockClear();
    const dialog = await openBulkCloseDialog();
    fireEvent.click(screen.getByTestId('bulk-close-include-unsettled').querySelector('input') as HTMLInputElement);
    expect(rowByCampaign('running').dataset.included).toBe('true');
    expect(dialog).toHaveTextContent('结束这 3 场');

    fireEvent.click(screen.getByTestId('bulk-close-confirm'));
    await waitFor(() => expect(mockCloseCampaign).toHaveBeenCalledTimes(3));
    expect(patchFor('running').status).toBe('abandoned');
    // 半场的钱照实写回，但状态没有冒充盈利
    expect(patchFor('running').final_realized_pnl).toBeCloseTo(500, 8);
  });
});
