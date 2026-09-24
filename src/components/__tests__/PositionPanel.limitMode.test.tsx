import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { PositionLimitMode } from '@/lib/positionLimitMode';
import type { PendingOrder, Position } from '@/types/trading';

/**
 * 持仓卡与委托列表按此刻的持仓限制模式：
 *   无限制——不标「触发时将超限」「触发时将超单笔上限」，市价平仓不受单笔上限，杠杆对话框到 150x；
 *   币安标准——照旧（同一批数据，标记与限制都在）。
 */
const ctx = vi.hoisted(() => ({ mode: 'unlimited' as PositionLimitMode }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: vi.fn(), tradingMode: 'direct', positionLimitMode: ctx.mode,
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

const SYMBOL = 'KAITOUSDT';
const TIERED = { riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL } as const;

const usdtPos = (id: string, side: 'LONG' | 'SHORT', quantity: number, leverage: number, over: Partial<Position> = {}): Position => ({
  id, side, quantity, entryPrice: 1, leverage, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: quantity / leverage, isolatedMargin: quantity / leverage, openTime: 1,
  ...over,
} as Position);

/** 带分层戳、带 lotSizeRule 戳的多头条件单 @1.2、15x：空 25,000 旁边挂 20,000 → 币安标准下触发时 54,000 > 50,000。 */
const longStop = (quantity: number): PendingOrder => ({
  id: `stop-${quantity}`, side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 1.2, quantity, leverage: 15,
  marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: 0,
  ...TIERED, lotSizeRule: 'binance-lot-size-v1',
} as PendingOrder);

function renderPanel(positions: Position[], orders: PendingOrder[], activeTab: 'positions' | 'pending') {
  const onClosePosition = vi.fn();
  const view = render(
    <PositionPanel
      positionsMap={{ [SYMBOL]: positions }}
      ordersMap={{ [SYMBOL]: orders }}
      tradeHistory={[]}
      priceMap={{ [SYMBOL]: 1 }}
      activeSymbol={SYMBOL}
      onClosePosition={onClosePosition}
      onCancelOrder={vi.fn()}
      onApplySymbolLeverage={vi.fn()}
      availableBalance={1_000_000}
      activeTab={activeTab}
      onTabChange={vi.fn()}
    />,
  );
  return { ...view, onClosePosition };
}

beforeEach(() => { ctx.mode = 'unlimited'; });
afterEach(() => { vi.restoreAllMocks(); });

describe('委托列表的预判标记', () => {
  const short = usdtPos('s', 'SHORT', 25_000, 15, TIERED);

  it('币安标准：「触发时将超限」与「触发时将超单笔上限」（300,000 KAITO > 200,000）都标', () => {
    ctx.mode = 'binance';
    renderPanel([short], [longStop(20_000), longStop(300_000)], 'pending');
    expect(screen.getAllByTestId('order-trigger-limit-risk').length).toBeGreaterThan(0);
    expect(screen.getByTestId('order-lot-size-risk')).toHaveTextContent('触发时将超单笔上限');
  });

  it('无限制：同一批挂单一个都不标（触发 / 成交那一刻不再判）', () => {
    renderPanel([short], [longStop(20_000), longStop(300_000)], 'pending');
    expect(screen.queryByTestId('order-trigger-limit-risk')).toBeNull();
    expect(screen.queryByTestId('order-lot-size-risk')).toBeNull();
  });
});

describe('持仓卡的市价平仓', () => {
  const confirmClose = () => screen.getByRole('button', { name: /^确认平仓/ }) as HTMLButtonElement;

  it('无限制：300,000 KAITO 的卡一次平光，不出单笔上限警告', () => {
    const { onClosePosition } = renderPanel([usdtPos('big', 'LONG', 300_000, 5)], [], 'positions');
    fireEvent.click(screen.getByRole('button', { name: '平仓' }));
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    expect(confirmClose().disabled).toBe(false);
    fireEvent.click(confirmClose());
    expect(onClosePosition).toHaveBeenCalledTimes(1);
    expect(onClosePosition.mock.calls[0][2] as number).toBeCloseTo(1, 6);
  });

  it('币安标准：同一张卡超过单笔市价上限 200,000 → 置灰并给「按上限平」', () => {
    ctx.mode = 'binance';
    renderPanel([usdtPos('big', 'LONG', 300_000, 5)], [], 'positions');
    fireEvent.click(screen.getByRole('button', { name: '平仓' }));
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('单笔市价单最多 200,000 KAITO');
    expect(confirmClose().disabled).toBe(true);
  });
});

describe('持仓卡的「杠杆」对话框', () => {
  it('无限制：KAITOUSDT 的滑块到 150x；币安标准到 75x', () => {
    const open = () => fireEvent.click(screen.getByRole('button', { name: /^杠杆/ }));
    const first = renderPanel([usdtPos('p', 'LONG', 10_000, 5)], [], 'positions');
    open();
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('150x');
    first.unmount();

    ctx.mode = 'binance';
    renderPanel([usdtPos('p', 'LONG', 10_000, 5)], [], 'positions');
    open();
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('75x');
  });
});
