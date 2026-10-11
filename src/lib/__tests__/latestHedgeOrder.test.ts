import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exactPriceDecimals, latestHedgeOrder, latestHedgeOrderPrice } from '@/lib/latestHedgeOrder';
import type { PendingOrder } from '@/types/trading';

const order = (over: Partial<PendingOrder>): PendingOrder => ({
  id: 'o', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0, quantity: 1, leverage: 10, marginMode: 'isolated',
  status: 'PENDING', createdAt: 1_000, ...over,
} as PendingOrder);

describe('【用户要求】最新委托空单的价格（加仓 / 减仓计算器的 K 缺省值）', () => {
  it('主多看空单：取最新挂的那一张；条件单看触发价，限价单看委托价', () => {
    const orders = [
      order({ id: 'old', stopPrice: 1.2615, createdAt: 1_000, createdRealAt: 10 }),
      order({ id: 'new', stopPrice: 1.3728, createdAt: 2_000, createdRealAt: 20 }),
      order({ id: 'limit', type: 'LIMIT', status: 'NEW', price: 1.31, createdAt: 1_500, createdRealAt: 15 }),
    ];
    expect(latestHedgeOrderPrice(orders, 'LONG')).toBe(1.3728);
    expect(latestHedgeOrder(orders, 'LONG')).toEqual({ price: 1.3728, placedRealAt: 20 });
    // 最新的那张是限价单：看委托价
    expect(latestHedgeOrderPrice([...orders, order({ id: 'newest', type: 'LIMIT', status: 'NEW', price: 1.4012, createdAt: 3_000, createdRealAt: 30 })], 'LONG')).toBe(1.4012);
  });

  it('【复核】限价单读委托价，不读面板残留在它身上的触发价；条件单读触发价，不读残留的委托价', () => {
    // 面板的触发价输入框不清空：之前挂过条件单（触发价 1.55），再挂限价空单 @1.60，存下来的限价单带着 stopPrice 1.55
    expect(latestHedgeOrderPrice([order({ type: 'LIMIT', status: 'NEW', price: 1.6, stopPrice: 1.55 })], 'LONG')).toBe(1.6);
    expect(latestHedgeOrderPrice([order({ type: 'POST_ONLY', status: 'NEW', price: 1.61, stopPrice: 1.55 })], 'LONG')).toBe(1.61);
    // 反过来：条件单带着切标签前在限价框里填过的残值
    expect(latestHedgeOrderPrice([order({ type: 'CONDITIONAL', price: 1.9, stopPrice: 1.3728 })], 'LONG')).toBe(1.3728);
  });

  it('【复核】只在亏损侧找：挂在加仓线上方的限价空单是高位锁仓，不是支撑线，跳过它取下方最新的那张', () => {
    const orders = [
      order({ id: 'hedge', stopPrice: 1.3728, createdAt: 1_000, createdRealAt: 10 }),
      order({ id: 'lock-above', type: 'LIMIT', status: 'NEW', price: 1.6, createdAt: 2_000, createdRealAt: 20 }),
    ];
    // 不给加仓线时不分侧：最新的就是那张限价单
    expect(latestHedgeOrderPrice(orders, 'LONG')).toBe(1.6);
    expect(latestHedgeOrderPrice(orders, 'LONG', { referencePrice: 1.4907 })).toBe(1.3728);
    // 恰好等于加仓线的不算亏损侧（每币风险为 0）；亏损侧一张都没有时为 null
    expect(latestHedgeOrderPrice([order({ stopPrice: 1.4907 })], 'LONG', { referencePrice: 1.4907 })).toBeNull();
    expect(latestHedgeOrderPrice([orders[1]], 'LONG', { referencePrice: 1.4907 })).toBeNull();
    // 主空：亏损侧在加仓线上方
    const longs = [
      order({ id: 'below', side: 'LONG', stopPrice: 1.2, createdAt: 3_000, createdRealAt: 30 }),
      order({ id: 'above', side: 'LONG', stopPrice: 1.52, createdAt: 2_000, createdRealAt: 20 }),
    ];
    expect(latestHedgeOrderPrice(longs, 'SHORT', { referencePrice: 1.4 })).toBe(1.52);
  });

  it('只认还挂着、会开出反向仓位的委托：已撤 / 已成交 / 已触发的不算，平仓性质的止盈止损不算，同方向的加仓单不算', () => {
    const orders = [
      order({ id: 'hedge', stopPrice: 1.3728, createdAt: 1_000, createdRealAt: 10 }),
      order({ id: 'cancelled', stopPrice: 1.45, status: 'CANCELED', createdAt: 5_000, createdRealAt: 50 }),
      order({ id: 'filled', stopPrice: 1.46, status: 'FILLED', createdAt: 5_100, createdRealAt: 51 }),
      order({ id: 'triggered', stopPrice: 1.47, status: 'TRIGGERED', createdAt: 5_200, createdRealAt: 52 }),
      order({ id: 'take-profit', type: 'LIMIT', status: 'NEW', price: 1.9, reduceOnly: true, createdAt: 6_000, createdRealAt: 60 }),
      // 仓位卡上挂的止盈止损：条件单 + 关联仓位，没有 reduceOnly 字段的旧写法也认得出
      { ...order({ id: 'linked-sl', stopPrice: 1.3, createdAt: 6_500, createdRealAt: 65 }), linkedPositionId: 'p1' } as PendingOrder,
      order({ id: 'add', side: 'LONG', type: 'LIMIT', status: 'NEW', price: 1.4907, createdAt: 7_000, createdRealAt: 70 }),
    ];
    expect(latestHedgeOrderPrice(orders, 'LONG')).toBe(1.3728);
    // 主空：看多单
    expect(latestHedgeOrderPrice(orders, 'SHORT')).toBe(1.4907);
  });

  it('「最新」按真实挂单时刻：回放倒带之后模拟时间更早的那张才是后挂的；没盖真实时刻的老委托排在盖了的之前', () => {
    const orders = [
      order({ id: 'before-rewind', stopPrice: 1.5, createdAt: 9_000, createdRealAt: 100 }),
      order({ id: 'after-rewind', stopPrice: 1.3728, createdAt: 4_000, createdRealAt: 200 }),
    ];
    expect(latestHedgeOrderPrice(orders, 'LONG')).toBe(1.3728);
    // 【复核】老委托没有真实时刻、模拟时间却更晚（6 月行情里挂的，现在回放 4 月）：刚挂的那张才是最新的
    const legacy = order({ id: 'legacy', stopPrice: 0.52, createdAt: 99_000 });
    const fresh = order({ id: 'fresh', stopPrice: 0.61, createdAt: 4_000, createdRealAt: 300 });
    expect(latestHedgeOrderPrice([legacy, fresh], 'LONG')).toBe(0.61);
    expect(latestHedgeOrderPrice([fresh, legacy], 'LONG')).toBe(0.61);
    // 都没有真实时刻：比模拟时间；交回的真实时刻为 null
    expect(latestHedgeOrder([legacy, order({ id: 'older', stopPrice: 0.5, createdAt: 1_000 })], 'LONG')).toEqual({ price: 0.52, placedRealAt: null });
    // 同一时刻挂的两张：取排在后面的
    expect(latestHedgeOrderPrice([
      order({ id: 'a', stopPrice: 1.1, createdAt: 1_000, createdRealAt: 10 }),
      order({ id: 'b', stopPrice: 1.2, createdAt: 1_000, createdRealAt: 10 }),
    ], 'LONG')).toBe(1.2);
  });

  it('属于本场：早于主力开仓 5 分钟之前的挂单是上一场留下的，不算', () => {
    const opened = 10 * 60_000;
    const orders = [
      order({ id: 'previous-campaign', stopPrice: 1.5, createdAt: opened - 5 * 60_000 - 1, createdRealAt: 900 }),
      order({ id: 'this-round', stopPrice: 1.3728, createdAt: opened - 60_000, createdRealAt: 100 }),
    ];
    expect(latestHedgeOrderPrice(orders, 'LONG')).toBe(1.5);
    expect(latestHedgeOrderPrice(orders, 'LONG', { heldSinceMs: opened })).toBe(1.3728);
  });

  it('跟踪委托与 TWAP 没有事前确定的价位，不当作止损线；读不出正价格的那张跳过；一张都没有时为 null', () => {
    const orders = [
      order({ id: 'hedge', stopPrice: 1.3728, createdAt: 1_000, createdRealAt: 10 }),
      // 跟踪委托带着激活价、TWAP 带着限价，也都不算
      order({ id: 'trailing', type: 'TRAILING_STOP', status: 'ACTIVE', price: 0, stopPrice: 1.44, createdAt: 2_000, createdRealAt: 20 }),
      order({ id: 'twap', type: 'TWAP', status: 'ACTIVE', price: 1.43, stopPrice: 0, createdAt: 2_100, createdRealAt: 21 }),
      order({ id: 'priceless', type: 'CONDITIONAL', price: 0, stopPrice: 0, createdAt: 2_200, createdRealAt: 22 }),
    ];
    expect(latestHedgeOrderPrice(orders, 'LONG')).toBe(1.3728);
    expect(latestHedgeOrderPrice([], 'LONG')).toBeNull();
    expect(latestHedgeOrderPrice(undefined, 'LONG')).toBeNull();
    expect(latestHedgeOrderPrice([null, undefined], 'LONG')).toBeNull();
    expect(latestHedgeOrderPrice([order({ side: 'LONG', type: 'LIMIT', status: 'NEW', price: 1.2 })], 'LONG')).toBeNull();
  });

  it('委托价原样写出来要几位小数；浮点尾差不算进位数', () => {
    expect(exactPriceDecimals(1.3728)).toBe(4);
    expect(exactPriceDecimals(0.15955)).toBe(5);
    expect(exactPriceDecimals(95000)).toBe(0);
    expect(exactPriceDecimals(0.000012345678)).toBe(12);
    expect(exactPriceDecimals(Number.NaN)).toBe(0);
    expect(exactPriceDecimals(0.1 + 0.2)).toBe(1);
    expect(exactPriceDecimals(1.1 * 3)).toBe(1);
  });

  it('减仓计算器的 K 走同一个函数：现价下方、最新挂着的对冲空单', () => {
    const controls = readFileSync(join(process.cwd(), 'src/components/SessionModeControls.tsx'), 'utf8');
    expect(controls).toContain("latestHedgeOrderPrice(ctx.ordersMap[activeSymbol], 'LONG', { referencePrice: activeFillBasePrice || activePrice })");
    expect(controls).not.toContain(".sort((a, b) => b.createdAt - a.createdAt)");
  });
});
