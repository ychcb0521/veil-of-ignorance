import { describe, expect, it } from 'vitest';
import type { Position } from '@/types/trading';
import {
  buildTpSlOrders, keepValidTpSlLegs, replaceTpSlOrders, tpSlCloseUnits,
  validateTpSlLegs, validateTpSlLevels,
} from '@/lib/tpSlOrders';

let seq = 0;
const newId = () => `id-${++seq}`;

const coinPos = (over: Partial<Position> = {}): Position => ({
  id: 'p1', side: 'LONG', symbol: 'NOMUSD',
  quantity: 100, contracts: 100, contractSizeUsd: 10,
  settlementMode: 'coin', settlementAsset: 'NOM',
  entryPrice: 0.011199, leverage: 3, margin: 333.33,
  marginMode: 'isolated', openTime: 0,
  ...over,
} as Position);

describe('止盈止损减仓单', () => {
  it('造出的是**减仓条件单**，不是会开仓的单子', () => {
    const [tp, sl] = buildTpSlOrders({
      symbol: 'NOMUSD', position: coinPos(), levels: { tp: 0.015, sl: 0.009, percentage: 100 },
      now: 1_000, newId,
    });
    for (const o of [tp, sl]) {
      expect(o.type).toBe('CONDITIONAL');
      expect(o.reduceOnly).toBe(true);
      expect(o.linkedPositionId).toBe('p1');
      expect(o.side).toBe('SHORT');          // 多单的平仓方向
      expect(o.price).toBe(0);
    }
    expect(tp.reduceKind).toBe('TP');
    expect(tp.stopPrice).toBe(0.015);
    expect(sl.reduceKind).toBe('SL');
    expect(sl.stopPrice).toBe(0.009);
  });

  it('触发方向由**仓位方向**决定，与平仓单自身方向无关', () => {
    const long = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos({ side: 'LONG' }),
      levels: { tp: 0.015, sl: 0.009, percentage: 100 }, now: 0, newId });
    expect(long.map(o => o.operator)).toEqual(['>=', '<=']);

    const short = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos({ side: 'SHORT' }),
      levels: { tp: 0.009, sl: 0.015, percentage: 100 }, now: 0, newId });
    expect(short.map(o => o.operator)).toEqual(['<=', '>=']);
    expect(short.every(o => o.side === 'LONG')).toBe(true);
  });

  it('币本位的平仓量是整数张，且不足一张时至少一张', () => {
    expect(tpSlCloseUnits(coinPos({ contracts: 100 }), 33)).toBe(33);
    expect(tpSlCloseUnits(coinPos({ contracts: 100 }), 33.4)).toBe(33);
    expect(tpSlCloseUnits(coinPos({ contracts: 2 }), 10)).toBe(1);      // 0.2 张 → 1 张
    expect(tpSlCloseUnits(coinPos({ contracts: 0 }), 100)).toBe(0);     // 空仓不造单
  });

  it('U 本位的平仓量不取整', () => {
    const linear = coinPos({ settlementMode: 'usdt', settlementAsset: 'USDT', contracts: undefined, quantity: 3 });
    expect(tpSlCloseUnits(linear, 50)).toBeCloseTo(1.5, 9);
  });

  it('只填一边也成立', () => {
    expect(buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos(),
      levels: { tp: 0.015, sl: null, percentage: 50 }, now: 0, newId }))
      .toHaveLength(1);
    expect(buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos(),
      levels: { tp: null, sl: 0.009, percentage: 50 }, now: 0, newId })[0].reduceKind)
      .toBe('SL');
  });

  it('成数写在单子上——那是委托列表里唯一能一眼定性的数', () => {
    const [tp] = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos(),
      levels: { tp: 0.015, sl: null, percentage: 40 }, now: 0, newId });
    expect(tp.reducePercentage).toBe(40);
    expect(tp.quantity).toBe(40);
  });

  it('同一笔仓位改价是替换不是叠加，否则会留下两张止盈', () => {
    const first = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos(),
      levels: { tp: 0.015, sl: null, percentage: 100 }, now: 0, newId });
    const second = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos(),
      levels: { tp: 0.016, sl: null, percentage: 100 }, now: 0, newId });
    const merged = replaceTpSlOrders(first, 'p1', second);
    expect(merged).toHaveLength(1);
    expect(merged[0].stopPrice).toBe(0.016);
  });

  it('别的仓位的减仓单不受牵连', () => {
    const mine = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos({ id: 'p1' }),
      levels: { tp: 0.015, sl: null, percentage: 100 }, now: 0, newId });
    const theirs = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos({ id: 'p2' }),
      levels: { tp: 0.02, sl: null, percentage: 100 }, now: 0, newId });
    const merged = replaceTpSlOrders([...mine, ...theirs], 'p1', []);
    expect(merged).toHaveLength(1);
    expect(merged[0].linkedPositionId).toBe('p2');
  });
});

describe('止盈止损方向校验', () => {
  it('参照价是**开仓价**，不是此刻的盘口', () => {
    // 一张挂在 0.0100 的限价买单配 0.0105 的止盈，是完全合理的；
    // 拿此刻 0.0112 的盘口去校验会把它判成方向错误，而它根本还没成交。
    expect(validateTpSlLevels('LONG', { tp: 0.0105, sl: 0.0095, percentage: 100 }, 0.0100)).toBeNull();
    expect(validateTpSlLevels('LONG', { tp: 0.0105, sl: 0.0095, percentage: 100 }, 0.0112)?.field).toBe('tp');
  });

  it('多单：止盈在上、止损在下；空单相反', () => {
    expect(validateTpSlLevels('LONG', { tp: 0.009, sl: null, percentage: 100 }, 0.011)?.field).toBe('tp');
    expect(validateTpSlLevels('LONG', { tp: null, sl: 0.013, percentage: 100 }, 0.011)?.field).toBe('sl');
    expect(validateTpSlLevels('SHORT', { tp: 0.013, sl: null, percentage: 100 }, 0.011)?.field).toBe('tp');
    expect(validateTpSlLevels('SHORT', { tp: null, sl: 0.009, percentage: 100 }, 0.011)?.field).toBe('sl');
  });

  it('两边都空是错的；参照价拿不到时不瞎拦', () => {
    expect(validateTpSlLevels('LONG', { tp: null, sl: null, percentage: 100 }, 0.011)?.field).toBe('levels');
    expect(validateTpSlLevels('LONG', { tp: 0.001, sl: 0.99, percentage: 100 }, 0)).toBeNull();
  });

  it('【回归】止盈填反不得连累止损——那一支才是封住亏损的', () => {
    // 早先一发现坏腿就整体 return:止盈框里一个笔误会把完全合法的止损单一起吞掉,
    // 用户拿到一个已经开着的杠杆仓位、零保护、零提示。
    const levels = { tp: 0.009, sl: 0.0095, percentage: 100 };   // 多单:tp 填反了,sl 合法
    const legs = validateTpSlLegs('LONG', levels, 0.011199);
    expect(legs.tp?.field).toBe('tp');
    expect(legs.sl).toBeNull();

    const kept = keepValidTpSlLegs('LONG', levels, 0.011199);
    expect(kept.levels.tp).toBeNull();
    expect(kept.levels.sl).toBe(0.0095);
    expect(kept.dropped).toHaveLength(1);

    const orders = buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos(), levels: kept.levels, now: 0, newId });
    expect(orders).toHaveLength(1);
    expect(orders[0].reduceKind).toBe('SL');
  });

  it('两腿都合法时一腿都不丢', () => {
    const kept = keepValidTpSlLegs('LONG', { tp: 0.015, sl: 0.009, percentage: 100 }, 0.011199);
    expect(kept.dropped).toHaveLength(0);
    expect(kept.levels).toEqual({ tp: 0.015, sl: 0.009, percentage: 100 });
  });

  it('两腿都填反时两腿都丢，并且报得出两条原因', () => {
    const kept = keepValidTpSlLegs('LONG', { tp: 0.009, sl: 0.015, percentage: 100 }, 0.011199);
    expect(kept.dropped.map(d => d.field)).toEqual(['tp', 'sl']);
    expect(buildTpSlOrders({ symbol: 'NOMUSD', position: coinPos(), levels: kept.levels, now: 0, newId })).toHaveLength(0);
  });
});
