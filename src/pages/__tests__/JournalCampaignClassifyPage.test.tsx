import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import JournalCampaignClassifyPage from '../JournalCampaignClassifyPage';

const { mockListUnclassifiedItems, mockTradeHistory, mockUser } = vi.hoisted(() => ({
  mockUser: { id: 'user-1' },
  mockTradeHistory: [
    { id: 'btc-close', symbol: 'BTCUSDT', action: 'CLOSE' },
    { id: 'sol-close', symbol: 'SOLUSDT', action: 'CLOSE' },
    { id: 'open-record', symbol: 'OPENUSDT', action: 'OPEN' },
  ],
  mockListUnclassifiedItems: vi.fn(async () => ({
    journals: [{ symbol: 'SOLUSDT' }],
    orphanRecords: [{ symbol: 'ETHUSDT' }],
  })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({ tradeHistory: mockTradeHistory }),
}));

vi.mock('@/lib/journalApi', () => ({
  listUnclassifiedItems: mockListUnclassifiedItems,
}));

describe('JournalCampaignClassifyPage', () => {
  it('only renders the page header and symbol search input', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify?symbol=raveusdt']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '归类历史交易' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看所有战役' })).toBeInTheDocument();

    const input = screen.getByRole('combobox', { name: '标的名称' });
    expect(input).toHaveValue('RAVEUSDT');
    fireEvent.change(input, { target: { value: 'btcusdt' } });
    expect(input).toHaveValue('BTCUSDT');
    await screen.findByRole('option', { name: 'BTCUSDT' });

    expect(screen.queryByText('筛选归类项')).not.toBeInTheDocument();
    expect(screen.queryByText('归类为新战役')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows every available historical symbol on hover and filters after typing', async () => {
    render(
      <MemoryRouter initialEntries={['/journal/campaigns/classify']}>
        <JournalCampaignClassifyPage />
      </MemoryRouter>,
    );

    const input = screen.getByRole('combobox', { name: '标的名称' });
    fireEvent.mouseEnter(input.parentElement!);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'BTCUSDT' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'ETHUSDT' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'SOLUSDT' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: 'OPENUSDT' })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'eth' } });
    expect(screen.getByRole('option', { name: 'ETHUSDT' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'BTCUSDT' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'ETHUSDT' }));
    expect(input).toHaveValue('ETHUSDT');
    expect(screen.queryByRole('listbox', { name: '可选标的' })).not.toBeInTheDocument();
  });
});
