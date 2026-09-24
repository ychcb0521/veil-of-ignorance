import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { PendingOrder, Position } from '@/types/trading';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: vi.fn(), tradingMode: 'direct',
    // 单笔上限只在「币安标准」持仓限制模式下生效（默认是无限制）
    positionLimitMode: 'binance',
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

vi.setConfig({ testTimeout: 30_000 });

/**
 * 持仓卡与委托列表上的币安单笔市价上限：
 *   · 「平仓」弹窗：一次市价平仓超过上限就置灰、说明，并给「按上限平」——不替用户拆单，也不悄悄只平一部分；
 *   · 「止盈/止损」弹窗：按成数（不足 100%）挂的那一截超过上限就挂不出去，100% 不受限；
 *   · 委托列表：到触发 / 执行时会被单笔上限拒掉的挂单提前标「触发时将超单笔上限」。
 */
const SYMBOL = 'KAITOUSDT';

const usdtPos = (id: string, quantity: number, over: Partial<Position> = {}): Position => ({
  id, side: 'LONG', quantity, entryPrice: 1, leverage: 5, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: quantity / 5, isolatedMargin: quantity / 5, openTime: 1,
  ...over,
} as Position);

function renderPanel({ positions = [], orders = [], tab = 'positions', price = 1, symbol = SYMBOL }: {
  positions?: Position[]; orders?: PendingOrder[]; tab?: 'positions' | 'pending'; price?: number; symbol?: string;
}) {
  const onClosePosition = vi.fn();
  const onPlaceTpSl = vi.fn();
  render(
    <PositionPanel
      positionsMap={{ [symbol]: positions }}
      ordersMap={{ [symbol]: orders }}
      tradeHistory={[]}
      priceMap={{ [symbol]: price }}
      activeSymbol={symbol}
      onClosePosition={onClosePosition}
      onCancelOrder={vi.fn()}
      onCloseAllPositions={vi.fn()}
      onPlaceTpSl={onPlaceTpSl}
      availableBalance={1_000_000}
      activeTab={tab}
      onTabChange={vi.fn()}
    />,
  );
  return { onClosePosition, onPlaceTpSl };
}

const confirmClose = () => screen.getByRole('button', { name: /^确认平仓/ }) as HTMLButtonElement;

afterEach(() => { vi.restoreAllMocks(); });

describe('「平仓」弹窗：市价平仓也是一笔市价单', () => {
  it('300,000 KAITO 的卡：100% 超过 200,000 → 置灰并说明；「按上限平」把数量改成 200,000，确认后按 2/3 平', () => {
    const { onClosePosition } = renderPanel({ positions: [usdtPos('big', 300_000)] });
    fireEvent.click(screen.getByRole('button', { name: '平仓' }));
    const warning = screen.getByTestId('close-lot-size-warning');
    expect(warning).toHaveTextContent('单笔市价单最多 200,000 KAITO，这一单 300,000 KAITO');
    expect(warning).toHaveTextContent('请分几次平（每次不超过上限），或在持仓卡上设 100% 的止盈止损');
    expect(confirmClose().disabled).toBe(true);

    fireEvent.click(within(warning).getByTestId('close-lot-size-fill-max'));
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    expect(confirmClose().disabled).toBe(false);
    fireEvent.click(confirmClose());
    expect(onClosePosition).toHaveBeenCalledTimes(1);
    expect(onClosePosition.mock.calls[0][2] as number).toBeCloseTo(2 / 3, 6);
  });

  it('按钮上写的就是上限，与标题同一种写法：「按上限平 200,000 KAITO」；50% 本来就放得下，不出警告', () => {
    renderPanel({ positions: [usdtPos('big', 300_000)] });
    fireEvent.click(screen.getByRole('button', { name: '平仓' }));
    expect(screen.getByTestId('close-lot-size-fill-max')).toHaveTextContent(/^按上限平 200,000 KAITO$/);
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    expect(confirmClose().disabled).toBe(false);
  });

  it('两笔的卡（150,000 + 100,000）在币安是同一个仓位：100% 合计 250,000 超限', () => {
    renderPanel({ positions: [usdtPos('a', 150_000), usdtPos('b', 100_000, { leverage: 10 })] });
    fireEvent.click(screen.getByRole('button', { name: '平仓' }));
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('这一单 250,000 KAITO');
  });

  it('仓位是上限的 100 多倍（CYPH 250,000，一笔最多 2,000）：「按上限平 2,000 CYPH」，确认后引擎按 0.8% 平（不被 1% 的下限顶成 2,500）', () => {
    const { onClosePosition } = renderPanel({ symbol: 'CYPHUSDT', positions: [usdtPos('big', 250_000)] });
    fireEvent.click(screen.getByRole('button', { name: '平仓' }));
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('单笔市价单最多 2,000 CYPH，这一单 250,000 CYPH');
    fireEvent.click(screen.getByTestId('close-lot-size-fill-max'));
    fireEvent.click(confirmClose());
    expect(onClosePosition).toHaveBeenCalledTimes(1);
    expect(onClosePosition.mock.calls[0][2] as number).toBeCloseTo(0.008, 9);
  });

  it('上限以内的卡：一切照旧', () => {
    const { onClosePosition } = renderPanel({ positions: [usdtPos('ok', 150_000)] });
    fireEvent.click(screen.getByRole('button', { name: '平仓' }));
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    fireEvent.click(confirmClose());
    expect(onClosePosition).toHaveBeenCalledTimes(1);
    expect(onClosePosition.mock.calls[0][2] as number).toBeCloseTo(1, 6);
  });
});

describe('「止盈/止损」弹窗：按成数的那一截按市价上限判，100% 不受限', () => {
  function openTpSl() {
    const out = renderPanel({ positions: [usdtPos('big', 300_000)] });
    fireEvent.click(screen.getByRole('button', { name: '止盈/止损' }));
    fireEvent.change(screen.getAllByPlaceholderText('触发价格')[1], { target: { value: '0.9' } });
    return out;
  }
  const confirm = () => screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
  const stepDown = (times: number) => {
    const thumb = screen.getByRole('slider');
    for (let i = 0; i < times; i++) fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
  };

  it('100%：300,000 的仓位照挂（平掉整个仓位，相当于 closePosition）', () => {
    const { onPlaceTpSl } = openTpSl();
    expect(screen.queryByTestId('tpsl-lot-size-warning')).toBeNull();
    fireEvent.click(confirm());
    expect(onPlaceTpSl).toHaveBeenCalledTimes(1);
    expect(onPlaceTpSl.mock.calls[0][4]).toBe(100);
  });

  it('70%（210,000）超过上限：说明并置灰；60%（180,000）放行', () => {
    const { onPlaceTpSl } = openTpSl();
    stepDown(3);
    const warning = screen.getByTestId('tpsl-lot-size-warning');
    expect(warning).toHaveTextContent('止损（70% 仓位）：单笔市价单最多 200,000 KAITO，这一单 210,000 KAITO');
    expect(warning).toHaveTextContent('把成数调小到不超过上限，或选 100%');
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    expect(onPlaceTpSl).not.toHaveBeenCalled();
    stepDown(1);
    expect(screen.queryByTestId('tpsl-lot-size-warning')).toBeNull();
    fireEvent.click(confirm());
    expect(onPlaceTpSl).toHaveBeenCalledTimes(1);
    expect(onPlaceTpSl.mock.calls[0][4]).toBe(60);
  });
});

describe('委托列表：「触发时将超单笔上限」', () => {
  const stampedCoinConditional = (over: Partial<PendingOrder> = {}): PendingOrder => ({
    id: 'cond', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 0.95, quantity: 20_000, contracts: 20_000,
    contractSizeUsd: 10, leverage: 2, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO',
    status: 'PENDING', createdAt: 0, triggerDirection: 'DOWN', operator: '<=', lotSizeRule: 'binance-lot-size-v1',
    ...over,
  } as PendingOrder);

  it('合成币本位条件单 20,000 张、触发价 0.95（那里一笔最多 19,000 张）：标出来，悬停看原因', () => {
    renderPanel({ tab: 'pending', orders: [stampedCoinConditional()], price: 1.1 });
    const badge = screen.getByTestId('order-lot-size-risk');
    expect(badge).toHaveTextContent('触发时将超单笔上限');
    expect(badge.getAttribute('title')).toContain('单笔市价单最多 19,000 张，这一单 20,000 张');
    expect(badge.getAttribute('title')).toContain('按价 0.950000、面值 10 USD 折成张');
  });

  it('按成数（50%）挂的止损 20,001 张、触发价 1.0（那里一笔最多 20,000 张）：标出来，悬停说清到时仓位没有这张止损的保护', () => {
    renderPanel({
      tab: 'pending',
      price: 1.1,
      orders: [stampedCoinConditional({
        id: 'half-sl', side: 'SHORT', stopPrice: 1.0, quantity: 20_001, contracts: 20_001,
        reduceOnly: true, reduceKind: 'SL', reducePercentage: 50,
        linkedPositionId: 'p', reduceSymbol: SYMBOL, reducePositionSide: 'LONG',
      })],
    });
    const badge = screen.getByTestId('order-lot-size-risk');
    expect(badge).toHaveTextContent('触发时将超单笔上限');
    const title = badge.getAttribute('title') ?? '';
    expect(title).toContain('单笔市价单最多 20,000 张，这一单 20,001 张');
    expect(title).toContain('仓位就没有它的保护');
    expect(title).toContain('改成 100%');
  });

  it('开仓条件单的悬停写明出路：撤单后拆成几张条件单重挂——不叫人改用限价单（S₁ 下方卖出的对冲换成限价单会立刻成交）', () => {
    renderPanel({ tab: 'pending', orders: [stampedCoinConditional({ side: 'SHORT' })], price: 1.1 });
    const title = screen.getByTestId('order-lot-size-risk').getAttribute('title') ?? '';
    expect(title).toContain('请撤单后拆成几张条件单重挂（每张不超过上限）');
    expect(title).not.toContain('限价单');
  });

  it('放得下、更新前挂出的（没有戳）、平掉整个仓位的止盈止损：都不标', () => {
    renderPanel({
      tab: 'pending',
      price: 1.1,
      orders: [
        stampedCoinConditional({ id: 'fits', stopPrice: 1.0 }),
        stampedCoinConditional({ id: 'legacy', lotSizeRule: undefined }),
        stampedCoinConditional({
          id: 'whole', side: 'SHORT', reduceOnly: true, reduceKind: 'SL', reducePercentage: 100,
          linkedPositionId: 'p', reduceSymbol: SYMBOL, reducePositionSide: 'LONG',
        }),
      ],
    });
    expect(screen.queryByTestId('order-lot-size-risk')).toBeNull();
  });

  it('合成币本位的卖出跟踪委托：按回调线标（未激活 1.1 × 0.99 = 1.089 上最多 21,780 张；已激活峰值 1.105 → 1.09395 上 21,879 张）', () => {
    const trailing = stampedCoinConditional({
      id: 'trail', side: 'SHORT', type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01, quantity: 22_000, contracts: 22_000,
      triggerDirection: undefined, operator: undefined, trailingActivated: false,
    });
    renderPanel({ tab: 'pending', orders: [trailing], price: 1.0905 });
    const badge = screen.getByTestId('order-lot-size-risk');
    expect(badge).toHaveTextContent('触发时将超单笔上限');
    expect(badge.getAttribute('title')).toContain('单笔市价单最多 21,780 张，这一单 22,000 张');
    cleanup();
    renderPanel({ tab: 'pending', orders: [{ ...trailing, trailingActivated: true, peakPrice: 1.105 }], price: 1.105 });
    expect(screen.getByTestId('order-lot-size-risk').getAttribute('title')).toContain('单笔市价单最多 21,879 张，这一单 22,000 张');
  });

  it('TWAP 的每一片超过上限：标「执行时将超单笔上限」', () => {
    renderPanel({
      tab: 'pending',
      price: 0.1,
      orders: [{
        id: 'twap', side: 'LONG', type: 'TWAP', price: 0, stopPrice: 0, quantity: 4_400_000, leverage: 1, marginMode: 'isolated',
        settlementMode: 'usdt', settlementAsset: 'USDT', status: 'ACTIVE', createdAt: 0, twapTotalQty: 4_400_000, twapFilledQty: 0,
        twapInterval: 180_000, twapNextExecTime: 0, twapEndTime: 3_600_000, lotSizeRule: 'binance-lot-size-v1',
      } as PendingOrder],
    });
    expect(screen.getByTestId('order-lot-size-risk')).toHaveTextContent('执行时将超单笔上限');
    expect(screen.getByTestId('order-lot-size-risk').getAttribute('title')).toContain('这一片 220,000 KAITO');
  });
});
