import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { TradeRecord } from '@/types/trading';

/**
 * 「仓位历史记录部分有遗漏」最廉价、也最该先排除的一种解释：
 * 表格硬截断在最近 100 条，而 tab 上不显示条数——超过 100 笔之后，
 * 更早的记录在界面上永久不可见，且没有任何提示。记录都在，只是看不到。
 * 截断保留（几千行一次性渲染会卡），但必须说出来，并且给一个展开的出口。
 */
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: vi.fn(), tradingMode: 'direct',
    setTradeHistory: vi.fn(), setBalance: vi.fn(),
  }),
}));
vi.mock('@/lib/journalApi', () => ({
  findUnreviewedJournalForClose: vi.fn(async () => null),
  listJournals: vi.fn(async () => []),
  listJournalsByTradeRecordId: vi.fn(async () => []),
  backfillJournalFromRecord: vi.fn(),
  getJournalById: vi.fn(),
  syncTradeRecordCorrectionToJournals: vi.fn(async () => []),
}));

const closed = (i: number): TradeRecord => ({
  id: `r${i}`, symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice: 100, exitPrice: 110, quantity: 1, leverage: 1,
  pnl: 10, fee: 0, slippage: 0, openTime: 1_000 + i, closeTime: 2_000 + i,
} as TradeRecord);

function renderHistory(n: number, tab: 'positionHistory' | 'trades' = 'positionHistory') {
  const history = Array.from({ length: n }, (_, i) => closed(i));
  return render(
    <PositionPanel
      positionsMap={{}}
      ordersMap={{}}
      tradeHistory={history}
      priceMap={{ BTCUSDT: 110 }}
      activeSymbol="BTCUSDT"
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      activeTab={tab}
      onTabChange={vi.fn()}
    />,
  );
}

describe('仓位历史记录的截断必须说出来', () => {
  it('超过 100 条时给出「仅显示最近 100 条，共 N 条」，而不是静默吞掉', () => {
    renderHistory(105);
    const note = screen.getByTestId('history-truncation-note');
    expect(note).toHaveTextContent('仅显示最近 100 条');
    expect(note).toHaveTextContent('105');
  });

  // 用「历史成交」这个 6 列的简单表来验展开：仓位历史记录是 12 列还带按钮，
  // 渲染 100+ 行要 3 秒以上，全量跑并发时会撞 5s 超时——那是测试太重，不是功能问题。
  it('点「显示全部」后不再截断，最早那条也渲染出来', () => {
    renderHistory(105, 'trades');
    expect(screen.getByTestId('history-truncation-note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    expect(screen.queryByTestId('history-truncation-note')).not.toBeInTheDocument();
    // 截断时 r0（最早）在第 105 位，一定被截掉；展开后必须出现
    expect(screen.getAllByRole('row').length).toBeGreaterThan(105);
  });

  it('不足 100 条时不出现这条说明——不制造不存在的问题', () => {
    renderHistory(12);
    expect(screen.queryByTestId('history-truncation-note')).not.toBeInTheDocument();
  });

  it('历史成交 tab 同一套规则（两个 tab 读的是同一个数组）', () => {
    renderHistory(103, 'trades');
    expect(screen.getByTestId('history-truncation-note')).toHaveTextContent('103');
  });
});
