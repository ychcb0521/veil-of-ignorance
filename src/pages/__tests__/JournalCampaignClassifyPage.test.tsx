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

vi.mock('@/lib/journalApi', () => ({
  listUnclassifiedItems: mockListUnclassifiedItems,
  listAllCampaigns: vi.fn(async () => []),
  suggestLegRoles: vi.fn(() => []),
  detachJournalFromCampaign: vi.fn(),
}));

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
