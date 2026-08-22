import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JournalCampaignClassifyPage from '../JournalCampaignClassifyPage';

const { mockListUnclassifiedItems, mockTradeHistory, mockUser } = vi.hoisted(() => ({
  mockUser: { id: 'user-1' },
  mockTradeHistory: [
    {
      id: 'btc-close',
      symbol: 'BTCUSDT',
      action: 'CLOSE',
      side: 'LONG',
      leverage: 5,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 2,
      pnl: 20,
      openTime: Date.parse('2026-07-01T01:00:00Z'),
      closeTime: Date.parse('2026-07-01T02:00:00Z'),
      operationTime: Date.parse('2026-07-21T02:00:00Z'),
      exit_method: 'manual',
    },
    {
      id: 'sol-close',
      symbol: 'SOLUSDT',
      action: 'CLOSE',
      side: 'SHORT',
      leverage: 3,
      entryPrice: 20,
      exitPrice: 18,
      quantity: 5,
      pnl: 10,
      openTime: Date.parse('2026-07-02T01:00:00Z'),
      closeTime: Date.parse('2026-07-02T02:00:00Z'),
    },
    {
      id: 'ace-close',
      symbol: 'ACEUSDT',
      action: 'CLOSE',
      side: 'LONG',
      leverage: 4,
      entryPrice: 1,
      exitPrice: 1.1,
      quantity: 100,
      pnl: 10,
      openTime: Date.parse('2026-07-04T01:00:00Z'),
      closeTime: Date.parse('2026-07-04T02:00:00Z'),
    },
    {
      id: 'coai-close',
      symbol: 'COAIUSDT',
      action: 'CLOSE',
      side: 'LONG',
      leverage: 4,
      entryPrice: 1,
      exitPrice: 1.1,
      quantity: 100,
      pnl: 10,
      openTime: Date.parse('2026-07-05T01:00:00Z'),
      closeTime: Date.parse('2026-07-05T02:00:00Z'),
    },
    { id: 'open-record', symbol: 'OPENUSDT', action: 'OPEN' },
  ],
  mockListUnclassifiedItems: vi.fn(async () => ({
    journals: [],
    orphanRecords: [
      {
        id: 'eth-close',
        symbol: 'ETHUSDT',
        action: 'CLOSE',
        side: 'LONG',
        leverage: 2,
        entryPrice: 2000,
        exitPrice: 2100,
        quantity: 1,
        pnl: 100,
        openTime: Date.parse('2026-07-03T01:00:00Z'),
        closeTime: Date.parse('2026-07-03T02:00:00Z'),
      },
    ],
  })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradeHistory: mockTradeHistory,
    recordCampaignCreated: vi.fn(),
  }),
}));

vi.mock('@/lib/journalApi', async () => {
  const real = await vi.importActual<typeof import('@/lib/legRoleSuggestion')>('@/lib/legRoleSuggestion');
  return {
    listUnclassifiedItems: mockListUnclassifiedItems,
    listAllCampaigns: vi.fn(async () => []),
    suggestLegRoles: real.suggestLegRoles,
    suggestOrphanRecordRoles: real.suggestOrphanRecordRoles,
    detachJournalFromCampaign: vi.fn(),
  };
});

describe('JournalCampaignClassifyPage', () => {
  beforeEach(() => {
    mockListUnclassifiedItems.mockClear();
  });

  it('keeps the initial page reduced to the header and symbol search', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '归类历史交易' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看所有战役' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '标的名称' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('筛选归类项')).not.toBeInTheDocument();

    await waitFor(() => expect(mockListUnclassifiedItems).toHaveBeenCalled());
  });

  it('restores the classification workspace after choosing a symbol', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    const input = screen.getByRole('combobox', { name: '标的名称' });
    fireEvent.mouseEnter(input.parentElement!);

    const btcOption = await screen.findByRole('option', { name: 'BTCUSDT' });
    fireEvent.click(btcOption);

    expect(input).toHaveValue('BTCUSDT');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('BTC/USDT')).toBeInTheDocument();
    expect(screen.queryByText('SOL/USDT')).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    expect(screen.getByRole('button', { name: '加入现有战役' })).toBeInTheDocument();
    const createButton = screen.getByRole('button', { name: '归类为新战役' });
    expect(createButton).toBeInTheDocument();

    fireEvent.click(createButton);
    expect(await screen.findByRole('heading', { name: '归类为新战役' })).toBeInTheDocument();
    expect(screen.getByText('1 个归类项 · BTCUSDT')).toBeInTheDocument();
  });

  it('shows remote orphan records in the symbol list and result table', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=ethusdt']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('ETH/USDT')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('narrows symbols and records from the first typed character without resetting on hover', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    const input = screen.getByRole('combobox', { name: '标的名称' });
    fireEvent.change(input, { target: { value: 'a' } });

    expect(input).toHaveValue('A');
    expect(await screen.findByRole('option', { name: 'ACEUSDT' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'COAIUSDT' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'BTCUSDT' })).not.toBeInTheDocument();
    expect(await screen.findByText('ACE/USDT')).toBeInTheDocument();
    expect(screen.queryByText('COAI/USDT')).not.toBeInTheDocument();

    fireEvent.mouseEnter(input.parentElement!);
    expect(input).toHaveValue('A');
    expect(screen.getByRole('option', { name: 'ACEUSDT' })).toBeInTheDocument();
  });

  it('supports keyboard selection and closes the options on outside pointer input', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    const input = screen.getByRole('combobox', { name: '标的名称' });
    fireEvent.change(input, { target: { value: 'b' } });
    expect(await screen.findByRole('option', { name: 'BTCUSDT' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('BTCUSDT');
    expect(screen.queryByRole('option', { name: 'BTCUSDT' })).not.toBeInTheDocument();

    fireEvent.focus(input);
    expect(await screen.findByRole('option', { name: 'BTCUSDT' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('option', { name: 'BTCUSDT' })).not.toBeInTheDocument();
  });
});

/** 造一条 journal：默认未归类、无成交、post_realized_pnl 落库为 0（老数据常见形态）。 */
function journalFixture(id: string, over: Record<string, unknown>) {
  return {
    id, user_id: 'user-1', campaign_id: null, leg_role: null, trade_record_id: null,
    leverage: 5, post_realized_pnl: 0, post_outcome: null,
    post_simulated_close_time: null, post_real_close_time: null, ...over,
  };
}

describe('归类历史交易表格', () => {
  beforeEach(() => {
    mockListUnclassifiedItems.mockResolvedValueOnce({
      journals: [
        // RAVE：主力（有成交引用但本地没载入）+ 两张未触发的对冲 + 一张挂单中的主力
        journalFixture('r-main', { symbol: 'RAVEUSDT', order_kind: 'main', direction: 'long', pre_simulated_time: '2026-04-10T03:48:07+08:00', pre_entry_price: 0.6354, trade_record_id: 'rave-close-missing' }),
        journalFixture('r-h1', { symbol: 'RAVEUSDT', order_kind: 'hedge', direction: 'short', pre_simulated_time: '2026-04-10T04:35:14+08:00', pre_entry_price: 0.6698 }),
        journalFixture('r-add', { symbol: 'RAVEUSDT', order_kind: 'main', direction: 'long', pre_simulated_time: '2026-04-10T07:47:55+08:00', pre_entry_price: 1.0098 }),
        // BLUR 在时间上更晚：主力 + 一笔加仓。若建议跨标的累加，这笔会被标成「加仓2」
        journalFixture('b-main', { symbol: 'BLURUSDT', order_kind: 'main', direction: 'long', pre_simulated_time: '2026-05-02T10:00:00+08:00', pre_entry_price: 0.016 }),
        journalFixture('b-add', { symbol: 'BLURUSDT', order_kind: 'main', direction: 'long', pre_simulated_time: '2026-05-02T11:00:00+08:00', pre_entry_price: 0.0165 }),
      ],
      orphanRecords: [],
    });
  });

  it('未平仓的行不显示 +0.00——0 是「没有数据」不是「打平」', async () => {
    render(<MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=raveusdt']}><JournalCampaignClassifyPage /></MemoryRouter>);
    await screen.findByRole('table');
    expect(screen.queryByText(/\+0\.00/)).not.toBeInTheDocument();
  });

  it('无成交的行把平仓侧折成一句话，措辞复用下一屏的三态', async () => {
    render(<MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=raveusdt']}><JournalCampaignClassifyPage /></MemoryRouter>);
    await screen.findByRole('table');
    expect(screen.getByText('未触发取消 · 无成交')).toBeInTheDocument();   // 对冲挂单，从未触发
    expect(screen.getByText('挂单中 · 尚未平仓')).toBeInTheDocument();     // 主力挂单
    expect(screen.getByText('已成交 · 成交记录未载入')).toBeInTheDocument(); // 有引用但本地没有这条成交
    const folded = screen.getByText('未触发取消 · 无成交').closest('td')!;
    expect(folded).toHaveAttribute('colspan', '5');
  });

  it('时间单行 MM-DD HH:mm:ss，秒留在列内——加仓腿常同一分钟连开两刀，先后只能靠秒', async () => {
    render(<MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=raveusdt']}><JournalCampaignClassifyPage /></MemoryRouter>);
    await screen.findByRole('table');
    const cell = screen.getByText('04-10 03:48:07');
    expect(cell.textContent).not.toContain('\n');
    expect(cell).toHaveAttribute('title', '2026-04-10 03:48:07'); // 年份进 title
  });

  it('合约格里标出主力 / 对冲——决定角色的字段不该是表里唯一看不见的', async () => {
    render(<MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=raveusdt']}><JournalCampaignClassifyPage /></MemoryRouter>);
    await screen.findByRole('table');
    expect(screen.getAllByText('主力').length).toBeGreaterThan(0);
    expect(screen.getAllByText('对冲').length).toBeGreaterThan(0);
  });

  it('建议按标的分组：别的币的加仓不会把这个币的计数推高', async () => {
    // 先渲染 BLUR：它在时间上晚于 RAVE 的主力与加仓。若 mainAddCount 跨标的累加，
    // BLUR 的那笔加仓会被标成「加仓2」（RAVE 已用掉加仓1）。
    render(<MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=blurusdt']}><JournalCampaignClassifyPage /></MemoryRouter>);
    await screen.findByRole('table');
    expect(screen.getByText('加仓1')).toBeInTheDocument();
    expect(screen.queryByText('加仓2')).not.toBeInTheDocument();
    // 建议全称与理由在 title 里可达
    expect(screen.getByText('加仓1').closest('[title]')).toHaveAttribute('title', expect.stringContaining('加仓1'));
  });
});
