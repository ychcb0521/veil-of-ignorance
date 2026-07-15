import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnreviewedJournalList } from '@/components/journal/UnreviewedJournalList';
import type { TradeJournal } from '@/types/journal';

const oldTime = Date.parse('2026-06-22T01:00:00.000Z');
const newTime = Date.parse('2026-06-24T01:00:00.000Z');

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradeHistory: [
      { id: 'old-record', symbol: 'BTCUSDT', closedRealAt: oldTime },
      { id: 'new-record', symbol: 'ETHUSDT', closedRealAt: newTime },
      { id: 'short-record', symbol: 'XRPUSDT', closedRealAt: newTime + 1000 },
    ],
  }),
}));

vi.mock('@/components/journal/PostTradeReviewSheet', () => ({
  PostTradeReviewSheet: () => null,
}));

vi.mock('@/components/journal/ExitMethodBadge', () => ({
  ExitMethodBadge: () => <span>—</span>,
}));

function journal(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'default',
    user_id: 'user-1',
    journal_kind: 'trade',
    order_kind: 'main',
    direction: 'long',
    symbol: 'BTCUSDT',
    trade_record_id: 'old-record',
    pre_mental_state: 3,
    post_reviewed_at: null,
    ...overrides,
  } as TradeJournal;
}

describe('UnreviewedJournalList', () => {
  it('只汇总主力多单，并可按客观操作时间双向排序', () => {
    render(<UnreviewedJournalList journals={[
      journal({ id: 'old' }),
      journal({ id: 'new', symbol: 'ETHUSDT', trade_record_id: 'new-record' }),
      journal({ id: 'short', symbol: 'XRPUSDT', direction: 'short', trade_record_id: 'short-record' }),
    ]} />);

    expect(screen.getByText('2 个标的 · 2 笔主力多单', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BTCUSDT 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ETHUSDT 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'XRPUSDT 1' })).not.toBeInTheDocument();

    const rowTimes = () => Array.from(document.querySelectorAll('[data-operation-time]'))
      .map(element => Number(element.getAttribute('data-operation-time')));
    expect(rowTimes()).toEqual([newTime, oldTime]);

    fireEvent.click(screen.getByTestId('unreviewed-operation-time-sort'));
    expect(rowTimes()).toEqual([oldTime, newTime]);
  });
});
