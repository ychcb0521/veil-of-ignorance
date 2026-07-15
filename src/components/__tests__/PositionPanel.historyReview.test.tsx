import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const {
  journalState,
  mockAuthUser,
  mockBackfillJournalFromRecord,
  mockGetJournalById,
  mockListJournals,
  mockListJournalsByTradeRecordId,
  mockSetBalance,
  mockSetSymbolLeverage,
  mockSetTradeHistory,
} = vi.hoisted(() => {
  const state = { rows: [] as TradeJournal[] };
  return {
    journalState: state,
    mockAuthUser: { id: 'user-1' },
    mockBackfillJournalFromRecord: vi.fn(),
    mockGetJournalById: vi.fn(),
    mockListJournals: vi.fn(async () => state.rows),
    mockListJournalsByTradeRecordId: vi.fn(async () => [] as TradeJournal[]),
    mockSetBalance: vi.fn(),
    mockSetSymbolLeverage: vi.fn(),
    mockSetTradeHistory: vi.fn(),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: mockSetSymbolLeverage,
    tradingMode: 'direct',
    setTradeHistory: mockSetTradeHistory,
    setBalance: mockSetBalance,
  }),
}));

vi.mock('@/lib/journalApi', () => ({
  findUnreviewedJournalForClose: vi.fn(async () => null),
  listJournals: mockListJournals,
  listJournalsByTradeRecordId: mockListJournalsByTradeRecordId,
  backfillJournalFromRecord: mockBackfillJournalFromRecord,
  getJournalById: mockGetJournalById,
  syncTradeRecordCorrectionToJournals: vi.fn(async () => []),
}));

vi.mock('@/components/journal/PostTradeReviewSheet', () => ({
  PostTradeReviewSheet: ({ isOpen, journal, tradeRecord }: {
    isOpen: boolean;
    journal: TradeJournal | null;
    tradeRecord: TradeRecord | null;
  }) => isOpen ? (
    <div data-testid="history-review-open">
      {journal?.id}:{tradeRecord?.id}:{journal?.post_reflection ?? ''}
    </div>
  ) : null,
}));

vi.mock('@/components/journal/ExitMethodBadge', () => ({
  ExitMethodBadge: () => <span>手动</span>,
}));

function tradeRecord(): TradeRecord {
  return {
    id: 'close-1',
    positionId: 'position-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    leverage: 5,
    pnl: 10,
    fee: 0,
    slippage: 0,
    openTime: Date.parse('2026-07-14T01:00:00Z'),
    closeTime: Date.parse('2026-07-14T02:00:00Z'),
    closedRealAt: Date.parse('2026-07-14T03:00:00Z'),
    exit_method: 'manual',
  };
}

function journal(overrides: Partial<TradeJournal> = {}): TradeJournal {
  return {
    id: 'journal-1',
    user_id: 'user-1',
    trade_record_id: 'position-1',
    campaign_id: null,
    leg_role: null,
    leg_sequence: null,
    source: 'retroactive_from_record',
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: 5,
    position_mode: 'isolated',
    order_kind: 'main',
    pre_simulated_time: '2026-07-14T01:00:00Z',
    pre_real_time: '2026-07-14T03:00:00Z',
    pre_entry_price: 100,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: null,
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: 1,
    pre_max_loss_usdt: null,
    post_reviewed_at: null,
    ...overrides,
  } as TradeJournal;
}

function renderHistory(record = tradeRecord()) {
  return render(
    <PositionPanel
      positionsMap={{}}
      ordersMap={{}}
      tradeHistory={[record]}
      priceMap={{}}
      activeSymbol="BTCUSDT"
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      activeTab="positionHistory"
      onTabChange={vi.fn()}
    />,
  );
}

describe('PositionPanel history review entry', () => {
  beforeEach(() => {
    journalState.rows = [];
    vi.clearAllMocks();
    mockListJournals.mockImplementation(async () => journalState.rows);
    mockListJournalsByTradeRecordId.mockResolvedValue([]);
    mockBackfillJournalFromRecord.mockImplementation(async () => journal({
      id: 'generated-journal',
      trade_record_id: 'close-1',
    }));
    mockGetJournalById.mockResolvedValue(null);
  });

  it('误点跳过后可从历史记录回填一次并打开评价', async () => {
    renderHistory();
    const button = await screen.findByTitle('补做这笔平仓评价');
    fireEvent.click(button);

    expect(await screen.findByTestId('history-review-open')).toHaveTextContent('generated-journal:close-1');
    expect(mockBackfillJournalFromRecord).toHaveBeenCalledTimes(1);
  });

  it('旧 positionId 关联的已评价记录可直接打开且不会重复回填', async () => {
    const completeReview = journal({
      post_reviewed_at: '2026-07-15T01:00:00Z',
      post_reflection: '原评价的完整事实复盘',
    });
    journalState.rows = [journal({ post_reviewed_at: '2026-07-15T01:00:00Z' })];
    mockGetJournalById.mockResolvedValue(completeReview);
    renderHistory();

    const button = await screen.findByTitle('打开已完成的平仓评价');
    expect(button).toHaveTextContent('查看评价');
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByTestId('history-review-open')).toHaveTextContent(
      'journal-1:close-1:原评价的完整事实复盘',
    ));
    expect(mockGetJournalById).toHaveBeenCalledWith('journal-1');
    expect(mockBackfillJournalFromRecord).not.toHaveBeenCalled();
  });
});
