import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import { __resetNotificationCenterForTests, beginCloseReviewQuiet, beginHistoryOnlyNotifications, getNotificationSnapshot, setNotificationPopupsEnabled } from '@/lib/notificationCenter';
import type { TradeRecord } from '@/types/trading';
import type { TradeJournal } from '@/types/journal';
const state = vi.hoisted(() => ({ mode: 'direct', user: { id: 'user-1' }, lookup: vi.fn(), backfill: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({ setSymbolLeverage: vi.fn(), tradingMode: state.mode, setTradeHistory: vi.fn(), setBalance: vi.fn() }) }));
vi.mock('@/lib/journalApi', () => ({ findUnreviewedJournalForClose: state.lookup, listJournals: vi.fn(async () => []), listJournalsByTradeRecordId: vi.fn(async () => []), backfillJournalFromRecord: state.backfill, getJournalById: vi.fn(), syncTradeRecordCorrectionToJournals: vi.fn(async () => []) }));
vi.mock('@/components/journal/PostTradeReviewSheet', () => ({ PostTradeReviewSheet: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="review-sheet"/> : null }));
vi.mock('@/components/journal/ExitMethodBadge', () => ({ ExitMethodBadge: () => <span>手动</span> }));
const trade = (id: string, side: 'LONG' | 'SHORT' = 'LONG'): TradeRecord => ({ id, positionId: `p-${id}`, symbol: 'ERAUSDT', side, type: 'MARKET', action: 'CLOSE', entryPrice: 100, exitPrice: 99, quantity: 1, leverage: 1, pnl: -299071.89, fee: 0, slippage: 0, openTime: 1792900000000, closeTime: 1792903600000, exit_method: 'manual' });
const panel = (rows: TradeRecord[]) => <PositionPanel positionsMap={{}} ordersMap={{}} tradeHistory={rows} priceMap={{}} activeSymbol="ERAUSDT" onClosePosition={vi.fn()} onCancelOrder={vi.fn()} activeTab="positionHistory" onTabChange={vi.fn()}/>;
beforeEach(() => { localStorage.clear(); __resetNotificationCenterForTests(); setNotificationPopupsEnabled(true); state.mode = 'direct'; state.lookup.mockReset().mockResolvedValue(null); state.backfill.mockReset().mockResolvedValue({ id: 'journal-1' }); });
afterEach(() => { cleanup(); __resetNotificationCenterForTests(); });
it('records every new long close in the message list during quality work, without opening a review or creating journals, and does not replay afterwards', async () => {
  const old = trade('old'), h = render(panel([old])); let end!: () => void;
  await act(async () => { end = beginHistoryOnlyNotifications(); });
  const rows = [old, trade('a'), trade('short', 'SHORT'), trade('b')]; h.rerender(panel(rows));
  await waitFor(() => expect(getNotificationSnapshot().entries).toHaveLength(2));
  expect(screen.queryByText('刚平了一笔 — 要现在做平仓评价吗？')).toBeNull(); expect(screen.queryByTestId('review-sheet')).toBeNull();
  expect(getNotificationSnapshot().entries[0]).toMatchObject({ title: '平仓待评价 · ERAUSDT', description: expect.stringContaining('-299,071.89 USDT') });
  expect(state.backfill).not.toHaveBeenCalled(); expect(state.lookup).not.toHaveBeenCalled();
  await act(async () => { end(); }); h.rerender(panel([...rows]));
  expect(getNotificationSnapshot().entries).toHaveLength(2); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getAllByTitle('补做这笔平仓评价')[0]); expect(await screen.findByTestId('review-sheet')).toBeVisible(); // explicit user action remains available
});
it('moves an already-open direct-trade reminder into history when quality work starts, and ordinary future reminders still work afterwards', async () => {
  const old = trade('old'), recent = trade('a'), h = render(panel([old]));
  h.rerender(panel([old, recent])); expect(await screen.findByText('刚平了一笔 — 要现在做平仓评价吗？')).toBeVisible();
  let end!: () => void; await act(async () => { end = beginHistoryOnlyNotifications(); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(getNotificationSnapshot().entries).toHaveLength(1);
  await act(async () => { end(); }); expect(screen.queryByRole('dialog')).toBeNull();
  h.rerender(panel([old, recent, trade('b')])); expect(await screen.findByText('刚平了一笔 — 要现在做平仓评价吗？')).toBeVisible();
});
it('does not pop an automatic full review when an earlier journal lookup resolves after the quiet task has already finished', async () => {
  state.mode = 'decision'; let resolve!: (j: TradeJournal) => void; state.lookup.mockImplementation(() => new Promise<TradeJournal>(r => { resolve = r; }));
  const old = trade('old'), h = render(panel([old])); h.rerender(panel([old, trade('a')])); await waitFor(() => expect(state.lookup).toHaveBeenCalledTimes(1));
  await act(async () => { const end = beginHistoryOnlyNotifications(); end(); });
  await act(async () => { resolve({ id: 'journal-1' } as TradeJournal); });
  expect(screen.queryByTestId('review-sheet')).toBeNull(); expect(getNotificationSnapshot().entries).toHaveLength(1);
});
// 【用户要求】2026-10-26 打开「渔」时不要平仓评价弹窗，只记进消息列表
it('keeps the close-review dialog quiet while the fish panel is open, then pops again once it is closed', async () => {
  const old = trade('old'), h = render(panel([old])); let end!: () => void;
  await act(async () => { end = beginCloseReviewQuiet(); });
  h.rerender(panel([old, trade('a')]));
  await waitFor(() => expect(getNotificationSnapshot().entries).toHaveLength(1));
  expect(screen.queryByText('刚平了一笔 — 要现在做平仓评价吗？')).toBeNull();
  await act(async () => { end(); });
  h.rerender(panel([old, trade('a'), trade('b')])); expect(await screen.findByText('刚平了一笔 — 要现在做平仓评价吗？')).toBeVisible();
});
