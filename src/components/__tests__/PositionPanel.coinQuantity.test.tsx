import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { Position } from '@/types/trading';

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

/** 复刻用户截图里那笔 RAVE 币本位持仓：13291 张 × 10 USD 面值，标记价 0.466839。 */
const coinPosition = (over: Partial<Position> = {}): Position => ({
  id: 'p1',
  side: 'LONG',
  symbol: 'RAVEUSD',
  quantity: 13_291,
  contracts: 13_291,
  entryPrice: 0.451043,
  leverage: 5,
  margin: 26_582,
  marginMode: 'isolated',
  settlementMode: 'coin',
  settlementAsset: 'RAVE',
  contractSizeUsd: 10,
  openTime: 0,
  ...over,
} as Position);

function renderPanel(position: Position, price: number) {
  return render(
    <PositionPanel
      positionsMap={{ [position.symbol]: [position] }}
      ordersMap={{}}
      tradeHistory={[]}
      priceMap={{ [position.symbol]: price }}
      activeSymbol={position.symbol}
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      activeTab="positions"
      onTabChange={vi.fn()}
    />,
  );
}

describe('币本位持仓的持币数量', () => {
  it('张数旁边给出按标记价折算的币量——只看张数得自己心算拿着多少币', () => {
    renderPanel(coinPosition(), 0.466839);
    // 名义 13291 × 10 = 132910 USD；132910 ÷ 0.466839 = 284702.0065 RAVE
    expect(screen.getByText(/13291 张 ≈ 284,702\.0065 RAVE/)).toBeInTheDocument();
  });

  it('币量随价格浮动——反向合约面值锁在 USD 上，这正是要显示它的原因', () => {
    const { unmount } = renderPanel(coinPosition(), 0.451043);
    // 同一笔仓位，按开仓价折算：132910 ÷ 0.451043 = 294672.5700
    expect(screen.getByText(/294,672\.5700 RAVE/)).toBeInTheDocument();
    unmount();
    renderPanel(coinPosition(), 0.60);
    // 价格涨到 0.60：132910 ÷ 0.6 = 221516.6667，币量变少
    expect(screen.getByText(/221,516\.6667 RAVE/)).toBeInTheDocument();
  });

  it('拿不到价格时只显示张数，不编一个币量出来', () => {
    renderPanel(coinPosition(), 0);
    // 只看「持仓数量」这一格：卡片别处（合约名、保证金）本来就有 RAVE 字样
    const cell = screen.getByText('持仓数量').parentElement!;
    expect(cell).toHaveTextContent('13291 张');
    expect(cell).not.toHaveTextContent('RAVE');
  });

  it('U 本位不受影响——它的数量本来就是币量，不该多出一个「张」', () => {
    const uPosition = coinPosition({
      symbol: 'BTCUSDT', settlementMode: 'usdt', settlementAsset: undefined,
      contracts: undefined, contractSizeUsd: undefined, quantity: 1.5, entryPrice: 60_000,
    });
    renderPanel(uPosition, 61_000);
    expect(screen.getByText('1.5000')).toBeInTheDocument();
    expect(screen.queryByText(/张/)).not.toBeInTheDocument();
  });
});
