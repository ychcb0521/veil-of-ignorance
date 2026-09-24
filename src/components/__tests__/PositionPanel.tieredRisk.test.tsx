import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { PendingOrder, Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import { formatPrice } from '@/lib/formatters';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: vi.fn(), tradingMode: 'direct',
    // 「触发时将超限」只在「币安标准」持仓限制模式下标（默认是无限制）
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

/**
 * 持仓卡与委托列表上的分层口径（复核第三轮）：
 *   · 带分层戳的仓位，保证金比率与合并卡（全仓合成）的强平价按币安分层算，旧仓位仍按 0.4%；
 *   · 带戳的触发类开仓单按此刻的持仓与挂单一触发就会被拒 → 委托列表标「触发时将超限」。
 * KAITOUSDT U 本位：10x 最高 125,000，15x 最高 50,000；60,000 落在 50,000–125,000 那一档（5%，速算 1,450）。
 */
const SYMBOL = 'KAITOUSDT';
const TIERED = { riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL } as const;

const usdtPos = (id: string, side: 'LONG' | 'SHORT', quantity: number, leverage: number, over: Partial<Position> = {}): Position => ({
  id, side, quantity, entryPrice: 1, leverage, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: quantity / leverage, isolatedMargin: quantity / leverage, openTime: 1,
  ...over,
} as Position);

function renderPanel(positions: Position[], orders: PendingOrder[], activeTab: 'positions' | 'pending') {
  return render(
    <PositionPanel
      positionsMap={{ [SYMBOL]: positions }}
      ordersMap={{ [SYMBOL]: orders }}
      tradeHistory={[]}
      priceMap={{ [SYMBOL]: 1 }}
      activeSymbol={SYMBOL}
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      availableBalance={1_000_000}
      activeTab={activeTab}
      onTabChange={vi.fn()}
    />,
  );
}

/** 卡片上的明细格（DetailCell：标签 div 带 truncate，下面紧跟着数值）；表头里同名的格子不算。 */
const cellValue = (label: string) => screen.getAllByText(label)
  .find(el => el.tagName === 'DIV' && el.classList.contains('truncate'))
  ?.nextElementSibling?.textContent;
/** 同一个明细格上的悬停说明（title 挂在外层 div 上）。 */
const cellTitle = (label: string) => screen.getAllByText(label)
  .find(el => el.tagName === 'DIV' && el.classList.contains('truncate'))
  ?.parentElement?.getAttribute('title') ?? null;

describe('持仓卡：分层仓位按币安分层算维持保证金', () => {
  it('保证金比率：分层 1,550 ÷ 6,000 = 25.83%；旧仓位 240 ÷ 6,000 = 4.00%', () => {
    const tiered = renderPanel([usdtPos('t', 'LONG', 60_000, 10, TIERED)], [], 'positions');
    expect(cellValue('保证金比率')).toBe('25.83%');
    tiered.unmount();
    renderPanel([usdtPos('l', 'LONG', 60_000, 10)], [], 'positions');
    expect(cellValue('保证金比率')).toBe('4.00%');
  });

  it('全仓合并卡的强平价：成员都是分层仓位才按分层算合成价，混着旧仓位按旧模型', () => {
    const cross = (id: string, over: Partial<Position> = {}) =>
      usdtPos(id, 'LONG', 30_000, 10, { marginMode: 'cross', isolatedMargin: undefined, ...over });
    const synthetic = (stamp: Partial<Position>): Position => ({
      id: 'merged', side: 'LONG', entryPrice: 1, quantity: 60_000, leverage: 10, marginMode: 'cross',
      margin: 6_000, settlementMode: 'usdt', settlementAsset: 'USDT', openTime: 1, ...stamp,
    } as Position);
    const tieredLiq = calcLiquidationPrice(synthetic(TIERED), SYMBOL);
    const legacyLiq = calcLiquidationPrice(synthetic({}), SYMBOL);
    // (60,000 − 6,000 − 1,450) ÷ (60,000 × 0.95) = 0.921930
    expect(tieredLiq).toBeCloseTo(52_550 / 57_000, 9);
    expect(formatPrice(tieredLiq, SYMBOL)).not.toBe(formatPrice(legacyLiq, SYMBOL));

    const both = renderPanel([cross('a', TIERED), cross('b', TIERED)], [], 'positions');
    expect(cellValue('强平价格')).toBe(formatPrice(tieredLiq, SYMBOL));
    // 口径一致（都是分层）：不挂那句「偏乐观」的悬停
    expect(cellTitle('强平价格')).toBeNull();
    both.unmount();
    renderPanel([cross('a', TIERED), cross('b')], [], 'positions');
    expect(cellValue('强平价格')).toBe(formatPrice(legacyLiq, SYMBOL));
    /**
     * 【复核 r7】混口径的合成价按旧模型算整组，比逐笔各按自己模型加总的真实强平价偏乐观
     * （实测 0.19%–1.27%）。数暂不改，但悬停里必须说出来——本文件开头那次事故就是把余量显示得比实际多。
     */
    expect(cellTitle('强平价格')).toContain('偏乐观');
  });
});

describe('当前委托：带戳的触发类开仓单此刻一触发就会被拒 → 「触发时将超限」', () => {
  const longStop = (id: string, quantity: number, over: Partial<PendingOrder> = {}): PendingOrder => ({
    id, side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 1.2, quantity, leverage: 15, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: 0, ...TIERED,
    ...over,
  } as PendingOrder);
  /** 空 25,000（带戳）@15x：到 1.2 时 30,000。 */
  const short = usdtPos('s', 'SHORT', 25_000, 15, TIERED);

  it('多头条件单 20,000 @1.2：触发时 30,000 + 24,000 = 54,000 > 50,000 → 标出，悬停说明原因', () => {
    renderPanel([short], [longStop('doomed', 20_000)], 'pending');
    const tag = screen.getByTestId('order-trigger-limit-risk');
    expect(tag).toHaveTextContent('触发时将超限');
    expect(tag.getAttribute('title')).toContain(`触发价 ${formatPrice(1.2, SYMBOL)} 上`);
    expect(tag.getAttribute('title')).toContain('15x 最高 50,000 USDT');
  });

  it('放得下的（16,000 → 49,200）、更新前挂的（没有戳）、只减仓的止盈止损：都不标', () => {
    for (const order of [
      longStop('fits', 16_000),
      longStop('legacy', 20_000, { riskModel: undefined }),
      longStop('tp', 20_000, { reduceOnly: true, reduceKind: 'TP', side: 'SHORT', stopPrice: 0.8 }),
    ]) {
      const view = renderPanel([short], [order], 'pending');
      expect(screen.queryByTestId('order-trigger-limit-risk')).toBeNull();
      view.unmount();
    }
  });

  it('更新前挂的单照样算进别的单的敞口：旧单 20,000 + 放得下的 16,000 一起挂着，后者就放不下了', () => {
    renderPanel([short], [longStop('fits', 16_000), longStop('legacy', 20_000, { riskModel: undefined })], 'pending');
    expect(screen.getAllByTestId('order-trigger-limit-risk')).toHaveLength(1);
  });

  it('【复核 r5】靠对冲豁免挂出的单：旧仓位还在不标；旧仓位平掉之后标出（到时会被撤）', () => {
    const exempt = longStop('exempt', 200_000, { riskModel: 'legacy-hedge-v1', leverage: 20 });
    const legacyShort = usdtPos('legacy', 'SHORT', 200_000, 20);
    const covered = renderPanel([legacyShort], [exempt], 'pending');
    expect(screen.queryByTestId('order-trigger-limit-risk')).toBeNull();
    covered.unmount();
    renderPanel([], [exempt], 'pending');
    expect(screen.getByTestId('order-trigger-limit-risk')).toHaveTextContent('触发时将超限');
  });

  it('【复核 r5】价格走到触发价的路上会成交的限价单算作持仓：卖出限价 1.1 在去 1.2 的路上成交', () => {
    // 空 25,000 + 卖出限价 5,000 @1.1 + 多头条件单 12,000 @1.2：到 1.2 时 36,000 + 14,400 = 50,400 > 50,000
    // （限价单按自己的价只算 5,500：30,000 + 5,500 + 14,400 = 49,900，看不出来）
    const sellLimit = {
      id: 'sell-limit', side: 'SHORT', type: 'LIMIT', price: 1.1, stopPrice: 0, quantity: 5_000, leverage: 15, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: 0, ...TIERED,
    } as PendingOrder;
    renderPanel([short], [sellLimit, longStop('stop', 12_000)], 'pending');
    expect(screen.getAllByTestId('order-trigger-limit-risk')).toHaveLength(1);
  });

  it('【复核 r5 · 二】先到另一侧再折回来：突破加仓 12,000 @1.2 在「先跌到 0.9、对冲成交」之后放不下 → 标出并说明是哪一种走法', () => {
    const main = usdtPos('main', 'LONG', 10_000, 15, TIERED);
    const hedge = longStop('hedge', 24_000, { side: 'SHORT', stopPrice: 0.9, triggerDirection: 'DOWN' });
    // 直接涨到 1.2：12,000 + 21,600 + 14,400 = 48,000；先跌到 0.9：12,000 + 28,800 + 14,400 = 55,200
    renderPanel([main], [longStop('add', 12_000), hedge], 'pending');
    const tags = screen.getAllByTestId('order-trigger-limit-risk');
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute('title')).toContain(`价格先到 ${formatPrice(0.9, SYMBOL)} 再回到触发价 ${formatPrice(1.2, SYMBOL)} 上：`);
    expect(tags[0].getAttribute('title')).toContain('15x 最高 50,000 USDT');
  });

  it('【复核 r5 · 二】路的起点是现价：已经穿价的买入限价 20,000 @1.1 到 1.2 时是持仓（24,000），多头条件单 22,000 @1.2 标出', () => {
    const crossedBuy = {
      id: 'crossed-buy', side: 'LONG', type: 'LIMIT', price: 1.1, stopPrice: 0, quantity: 20_000, leverage: 15, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: 0, ...TIERED,
    } as PendingOrder;
    // 按现价 1.0 出发：24,000 + 26,400 = 50,400；若不知道现价、只看 1.2 那一刻：22,000 + 26,400 = 48,400，看不出来
    renderPanel([], [crossedBuy, longStop('stop', 22_000)], 'pending');
    expect(screen.getAllByTestId('order-trigger-limit-risk')).toHaveLength(1);
  });

  it('【复核 r5 · 二】靠对冲豁免挂出的限价单：旧仓位还在不标；旧仓位平掉之后标「成交时将超限」', () => {
    const exemptLimit = {
      id: 'exempt-limit', side: 'LONG', type: 'LIMIT', price: 0.9, stopPrice: 0, quantity: 200_000, leverage: 20, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: 0, riskModel: 'legacy-hedge-v1', riskSymbol: SYMBOL,
    } as PendingOrder;
    const covered = renderPanel([usdtPos('legacy', 'SHORT', 200_000, 20)], [exemptLimit], 'pending');
    expect(screen.queryByTestId('order-trigger-limit-risk')).toBeNull();
    covered.unmount();
    renderPanel([], [exemptLimit], 'pending');
    const tag = screen.getByTestId('order-trigger-limit-risk');
    expect(tag).toHaveTextContent('成交时将超限');
    expect(tag.getAttribute('title')).toContain(`委托价 ${formatPrice(0.9, SYMBOL)} 成交时：`);
    expect(tag.getAttribute('title')).toContain('20x 最高 50,000 USDT');
  });

  it('跟踪委托按激活价判', () => {
    renderPanel([short], [longStop('trail', 20_000, { type: 'TRAILING_STOP', stopPrice: 1.2, callbackRate: 0.01 })], 'pending');
    expect(screen.getByTestId('order-trigger-limit-risk')).toHaveTextContent('触发时将超限');
  });
});
