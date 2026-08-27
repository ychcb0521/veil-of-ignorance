import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { PendingOrder } from '@/types/trading';

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

/**
 * 「当前委托」里那一格币数，要按**这单会成交的价**折算。
 * 截图那一单：NOM/USD 条件单，触发价 0.010344，表里写的是 892.960966 ——
 * 反解出来是 0.0111987（当时的市价，屏幕上四舍五入显示成 0.011199），
 * 而这单成交在 0.010344 上。下面一律用显示价 0.011199，
 * 所以市价折出来的数是 892.936869，与截图的 892.960966 只差那点舍入。
 */
const MARKET = 0.011199;
const TRIGGER = 0.010344;

const coinOrder = (over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'o1', side: 'LONG', type: 'CONDITIONAL',
  price: 0, stopPrice: TRIGGER,
  quantity: 1, contracts: 1,
  leverage: 3, marginMode: 'isolated', status: 'PENDING', createdAt: 0,
  settlementMode: 'coin', settlementAsset: 'NOM', contractSizeUsd: 10,
  ...over,
} as PendingOrder);

function renderOrders(order: PendingOrder, price = MARKET) {
  return render(
    <PositionPanel
      positionsMap={{}}
      ordersMap={{ NOMUSD: [order] }}
      tradeHistory={[]}
      priceMap={{ NOMUSD: price }}
      activeSymbol="NOMUSD"
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      activeTab="pending"
      onTabChange={vi.fn()}
    />,
  );
}

describe('当前委托的币数按挂单自己的价折算', () => {
  it('【回归】条件单按触发价：966.744006 NOM，不是市价折出来的 892.94', () => {
    renderOrders(coinOrder());
    expect(screen.getByTestId('order-qty-coin')).toHaveTextContent('966.744006 NOM');
    expect(screen.getByTestId('order-qty-coin')).not.toHaveTextContent('892.9');
  });

  it('折算口径写在数旁边——同一张单在不同价下是不同的币数，不说按哪个价算才是错的', () => {
    renderOrders(coinOrder());
    expect(screen.getByText(/1 张 · ≈ .* USD · 按触发价折算/)).toBeInTheDocument();
  });

  it('行情跳动不改条件单的币数——它折的是触发价', () => {
    const { unmount } = renderOrders(coinOrder(), MARKET);
    expect(screen.getByTestId('order-qty-coin')).toHaveTextContent('966.744006 NOM');
    unmount();
    renderOrders(coinOrder(), 0.009);
    expect(screen.getByTestId('order-qty-coin')).toHaveTextContent('966.744006 NOM');
  });

  it('限价单按委托价（本来就对，这条是防回归）', () => {
    renderOrders(coinOrder({ type: 'LIMIT', price: 0.0100, stopPrice: 0, status: 'NEW' }));
    expect(screen.getByTestId('order-qty-coin')).toHaveTextContent('1000.000000 NOM');
    expect(screen.getByText(/按委托价折算/)).toBeInTheDocument();
  });

  it('跟踪委托退回现价并如实标注——那行是激活价，不是成交价', () => {
    renderOrders(coinOrder({ type: 'TRAILING_STOP', price: 0, stopPrice: 0.0125, status: 'NEW' }));
    // 按激活价折会得到 800，而可达成交区间是 526–842 —— 800 根本不在里面
    expect(screen.getByTestId('order-qty-coin')).toHaveTextContent('892.936869 NOM');
    expect(screen.getByText(/按现价折算/)).toBeInTheDocument();
  });

  it('【回归】取不到自有价时张数那一行不许跟着消失', () => {
    // 张数写在币数那一支里；折算价返回 null 会把整支抹掉，用户反而少看到信息。
    renderOrders(coinOrder({ type: 'TWAP', price: 0, stopPrice: 0, quantity: 7, contracts: 7, status: 'ACTIVE' }));
    expect(screen.getByText(/7 张/)).toBeInTheDocument();
    expect(screen.getByTestId('order-qty-coin')).toHaveTextContent('NOM');
  });

  it('【回归】U 本位挂单同样标注口径——它的名义也跟着这次改动移动了', () => {
    // U 本位名义 = 数量 × 折算价：条件单从现价 60000 挪到触发价 50000，差 17%，
    // 只给币本位挂标签等于对另一半用户重犯「不说按哪个价算」。
    render(
      <PositionPanel
        positionsMap={{}}
        ordersMap={{ BTCUSDT: [coinOrder({
          settlementMode: 'usdt', settlementAsset: undefined, contractSizeUsd: undefined,
          contracts: undefined, quantity: 1, price: 0, stopPrice: 50_000,
        })] }}
        tradeHistory={[]}
        priceMap={{ BTCUSDT: 60_000 }}
        activeSymbol="BTCUSDT"
        onClosePosition={vi.fn()}
        onCancelOrder={vi.fn()}
        activeTab="pending"
        onTabChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/50,000\.00 USDT/)).toBeInTheDocument();
    expect(screen.getByText(/按触发价折算/)).toBeInTheDocument();
  });

  it('【回归】减仓单写出成数——否则 100% 止盈那一行看着像部分平仓', () => {
    // 止盈按触发价折币，主读数比按标记价折的持仓卡小 25%（0.015 对 0.011199）。
    // 张数与 USD 名义其实都对得上，但它们是 10px 小字；能一眼定性的只有成数。
    renderOrders(coinOrder({
      reduceOnly: true, reduceKind: 'TP', reducePercentage: 100,
      linkedPositionId: 'p1', price: 0, stopPrice: 0.015,
    }));
    expect(screen.getByTestId('order-reduce-percentage')).toHaveTextContent('100% 仓位');
  });

  it('市价单勾选止盈止损：列表与面板一样按现价，不拿止盈价折', () => {
    // 引擎确实成交在那个止盈价上（那是另一个更重的缺陷，已单独立项），
    // 但面板此刻还认为自己在下市价单。跟着引擎走会让两屏差 25%。
    renderOrders(coinOrder({ type: 'MARKET_TP_SL', price: 0, stopPrice: 0.015, status: 'NEW' }));
    expect(screen.getByTestId('order-qty-coin')).toHaveTextContent('892.936869 NOM');
    expect(screen.getByText(/按现价折算/)).toBeInTheDocument();
  });

  it('【回归】走完九成的 TWAP 要显示剩余量，不是最初的总量', () => {
    renderOrders(coinOrder({
      type: 'TWAP', price: 0, stopPrice: 0, status: 'ACTIVE',
      quantity: 100, contracts: 100, twapTotalQty: 100, twapFilledQty: 90,
    }));
    expect(screen.getByTestId('order-remaining-units')).toHaveTextContent('剩余 10.0000 / 总 100.0000 张');
    expect(screen.getByText(/10 张/)).toBeInTheDocument();      // 张数跟着剩余走
    expect(screen.queryByText(/100 张/)).not.toBeInTheDocument();
  });

  it('没走过片的 TWAP 不显示「剩余」那一行', () => {
    renderOrders(coinOrder({
      type: 'TWAP', price: 0, stopPrice: 0, status: 'ACTIVE',
      quantity: 100, contracts: 100, twapTotalQty: 100, twapFilledQty: 0,
    }));
    expect(screen.queryByTestId('order-remaining-units')).not.toBeInTheDocument();
    expect(screen.getByText(/100 张/)).toBeInTheDocument();
  });
});
