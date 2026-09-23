import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { PendingOrder, Position } from '@/types/trading';

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
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

/**
 * 【复核 r7】持仓卡上的「止盈/止损」按**整张卡**生效。
 *
 * 此前它只作用于 children[0]：拖到 100% 也只盖住第一笔。分组键只有 symbol_side，
 * 混杠杆 / 混保证金模式的组本来就可能有两笔；分层上线之后「加仓不并进更新前的仓位」
 * 让这种卡成了主线流程的常态——先死的恰恰是新加的那一笔（强平价离现价更近），
 * 而它在面板里拿不到任何止损，卡上的止损条也看不出只盖了 40,000 里的 30,000。
 */
const SYMBOL = 'KAITOUSDT';
const TIERED = { riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL } as const;

const usdtPos = (id: string, quantity: number, entryPrice: number, over: Partial<Position> = {}): Position => ({
  id, side: 'LONG', quantity, entryPrice, leverage: 20, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: (quantity * entryPrice) / 20, isolatedMargin: (quantity * entryPrice) / 20, openTime: 1,
  ...over,
} as Position);

function renderPanel(positions: Position[], onPlaceTpSl = vi.fn(), orders: PendingOrder[] = []) {
  render(
    <PositionPanel
      positionsMap={{ [SYMBOL]: positions }}
      ordersMap={{ [SYMBOL]: orders }}
      tradeHistory={[]}
      priceMap={{ [SYMBOL]: 0.96 }}
      activeSymbol={SYMBOL}
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      onPlaceTpSl={onPlaceTpSl}
      availableBalance={1_000_000}
      activeTab="positions"
      onTabChange={vi.fn()}
    />,
  );
  return onPlaceTpSl;
}

/** 弹窗里填一个止损价并确认（止盈、止损两个输入框都以「触发价格」为占位符，止损是第二个）。 */
function setStopLossAndConfirm(price: string) {
  const inputs = screen.getAllByPlaceholderText('触发价格');
  fireEvent.change(inputs[1], { target: { value: price } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
}

describe('【复核 r7】合并卡的「止盈/止损」覆盖卡上每一笔', () => {
  it('更新前 30,000 + 分层加仓 10,000（两笔不合并、同一张卡）：一次确认给两笔各挂一张，弹窗写明是几笔', () => {
    const legacy = usdtPos('pre-update', 30_000, 1);
    const add = usdtPos('tiered-add', 10_000, 0.96, TIERED);
    const onPlaceTpSl = renderPanel([legacy, add]);
    fireEvent.click(screen.getByRole('button', { name: '止盈/止损' }));
    expect(screen.getByTestId('tpsl-leg-note')).toHaveTextContent('这张卡上的 2 笔仓位各挂一张');
    setStopLossAndConfirm('0.95');
    expect(onPlaceTpSl).toHaveBeenCalledTimes(2);
    expect(onPlaceTpSl.mock.calls.map(c => [c[0], (c[1] as Position).id, c[2], c[3], c[4]])).toEqual([
      [SYMBOL, 'pre-update', null, 0.95, 100],
      [SYMBOL, 'tiered-add', null, 0.95, 100],
    ]);
  });

  it('两笔各挂一张同价止损：卡上的止损条只写一次这个价，不是「0.9500 / 0.9500」', () => {
    const sl = (id: string, linkedPositionId: string): PendingOrder => ({
      id, side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0.95, quantity: 1_000, leverage: 20,
      marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: 0,
      reduceOnly: true, reduceKind: 'SL', reducePercentage: 100, linkedPositionId,
    } as PendingOrder);
    renderPanel(
      [usdtPos('pre-update', 30_000, 1), usdtPos('tiered-add', 10_000, 0.96, TIERED)],
      vi.fn(),
      [sl('sl-1', 'pre-update'), sl('sl-2', 'tiered-add')],
    );
    const strip = screen.getByText('止损').parentElement!;
    expect(strip.textContent).toBe('止损0.950000');
  });

  it('只有一笔时照旧只挂一张，也不写那句说明', () => {
    const onlyOne = usdtPos('solo', 30_000, 1);
    const onPlaceTpSl = renderPanel([onlyOne]);
    fireEvent.click(screen.getByRole('button', { name: '止盈/止损' }));
    expect(screen.queryByTestId('tpsl-leg-note')).toBeNull();
    setStopLossAndConfirm('0.95');
    expect(onPlaceTpSl).toHaveBeenCalledTimes(1);
    expect((onPlaceTpSl.mock.calls[0][1] as Position).id).toBe('solo');
  });
});
