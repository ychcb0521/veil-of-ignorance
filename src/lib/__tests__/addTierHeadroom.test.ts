import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';
import { addTierHeadroom, type AddTierHeadroomInput } from '@/lib/addTierHeadroom';
import {
  checkOrderPositionLimit,
  checkPlacementPositionLimit,
  newlyDoomedTriggerOrders,
  placementAftermath,
  placementSizingRemainingUsd,
  restingTriggerCheck,
} from '@/lib/positionLimit';

/**
 * 加仓计算器的分层余量：单看这一单与下单面板「可开」同一个数；
 * 给了计划的对冲（S₁ 上合计 X₁ + X₂）时，加仓与要补挂的对冲都得放得下，也不让已挂的触发单注定被拒。
 * KAITOUSDT：15x 最高 50,000 USDT，20x 最高 50,000，按现价估值会漂时留 0.2%（100 USDT）。
 */

const TIERED = { riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' } as const;
const usdtPos = (side: 'LONG' | 'SHORT', quantity: number, entryPrice: number, over: Partial<Position> = {}): Position => ({
  id: `${side}-${quantity}-${entryPrice}`, side, quantity, entryPrice, leverage: 15, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT', margin: (quantity * entryPrice) / 15, openTime: 1,
  ...TIERED, ...over,
} as Position);
const usdtConditional = (side: 'LONG' | 'SHORT', quantity: number, stopPrice: number, over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: `cond-${side}-${stopPrice}`, side, type: 'CONDITIONAL', price: 0, stopPrice, quantity, leverage: 15,
  marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'PENDING', createdAt: 1,
  ...TIERED, ...over,
} as PendingOrder);

const kaito = (over: Partial<AddTierHeadroomInput>): ReturnType<typeof addTierHeadroom> => addTierHeadroom({
  symbol: 'KAITOUSDT', settlement: 'usdt', side: 'LONG', storedLeverage: 15, positions: [], orders: [],
  markPrice: 1, orderKind: 'market', orderPrice: 1, fillPrice: 1.0001, contractFaceUsd: null,
  ...over,
});

/** 这一单（或对冲）下出去之后，引擎的下单判定过不过得去。 */
const placeable = (args: {
  positions: Position[]; orders: PendingOrder[]; side: 'LONG' | 'SHORT'; qty: number; price: number; trigger?: boolean;
}) => checkPlacementPositionLimit({
  symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: args.positions, orders: args.orders, markPrice: 1,
  orderNotionalUsd: args.qty * args.price, orderPrice: args.price, side: args.side, triggerPrice: args.trigger ? args.price : 0,
}).ok;

describe('【复核 v1】计划的对冲也占分层上限', () => {
  it('KAITOUSDT 15x、多 10,000 @1.0、S₁ = 0.9 还没挂对冲：可下单量 16,263 而不是 39,900；加完之后 X₁ + X₂ 的对冲放得下', () => {
    const positions = [usdtPos('LONG', 10_000, 1)];
    const alone = kaito({ positions })!;
    expect(alone.coins).toBeCloseTo(39_900, 6);
    expect(alone.hedge).toBeNull();
    // 只按加仓算的旧口径：加满 39,900 之后，连 X₁ 的对冲都挂不上
    const afterAlone = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: 39_900, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(placeable({ positions: [...positions, ...afterAlone.positions], orders: [], side: 'SHORT', qty: 10_000, price: 0.9, trigger: true })).toBe(false);

    const r = kaito({ positions, hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 0 } })!;
    // 现价那一道：10,000 + X + 0.9 × (10,000 + X) ≤ 49,900 → X = 30,900 ÷ 1.9
    expect(r.coins).toBeCloseTo(30_900 / 1.9, 3);
    expect(r.alone.coins).toBeCloseTo(39_900, 6);
    expect(r.hedge).toMatchObject({ price: 0.9, binds: true, blocked: false });
    expect(r.hedge!.coins).toBeCloseTo(10_000 + 30_900 / 1.9, 3);
    const add = Math.floor(r.coins * 100) / 100;
    const after = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: add, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(placeable({ positions, orders: [], side: 'LONG', qty: add, price: 1 })).toBe(true);
    expect(placeable({ positions: [...positions, ...after.positions], orders: [], side: 'SHORT', qty: 10_000 + add, price: 0.9, trigger: true })).toBe(true);
  });

  it('多 10,000 @0.8 + 已挂空头对冲 10,000 @0.9、现价 1.0：只补 X₂，可下单量约 16,263（不是 30,900），补挂的对冲放得下', () => {
    const positions = [usdtPos('LONG', 10_000, 0.8)];
    const orders = [usdtConditional('SHORT', 10_000, 0.9)];
    expect(kaito({ positions, orders })!.coins).toBeCloseTo(30_900, 6);
    const r = kaito({ positions, orders, hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 10_000 } })!;
    // 19,000 + X + 0.9X ≤ 49,900
    expect(r.coins).toBeCloseTo(30_900 / 1.9, 3);
    expect(r.coins).toBeGreaterThan(16_000);
    expect(r.coins).toBeLessThan(16_320);
    expect(r.hedge!.coins).toBeCloseTo(r.coins, 6);
    const add = Math.floor(r.coins * 100) / 100;
    const after = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: add, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(placeable({ positions: [...positions, ...after.positions], orders, side: 'SHORT', qty: add, price: 0.9, trigger: true })).toBe(true);
  });

  it('空 20,000 @1.0 + 带戳的多头止损对冲 20,000 @1.2：可下单量 833（不是 5,900），加完不让那张对冲在触发时注定被拒', () => {
    const positions = [usdtPos('SHORT', 20_000, 1)];
    const orders = [usdtConditional('LONG', 20_000, 1.2)];
    const alone = kaito({ side: 'SHORT', positions, orders })!;
    expect(alone.coins).toBeCloseTo(5_900, 6);
    const doomedByAlone = newlyDoomedTriggerOrders({
      symbol: 'KAITOUSDT', positions, orders,
      added: placementAftermath({ type: 'MARKET', side: 'SHORT', leverage: 15, quantity: 5_900, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true }),
    });
    expect(doomedByAlone.map(d => d.order.id)).toEqual([orders[0].id]);

    const r = kaito({ side: 'SHORT', positions, orders, hedge: { price: 1.2, mainCoins: 20_000, existingCoins: 20_000 } })!;
    // 触发价 1.2 那一道：1.2 × (20,000 + X) + 24,000 + 1.2X ≤ 50,000 → X = 2,000 ÷ 2.4
    expect(r.coins).toBeCloseTo(2_000 / 2.4, 4);
    const add = Math.floor(r.coins * 100) / 100;
    const added = placementAftermath({ type: 'MARKET', side: 'SHORT', leverage: 15, quantity: add, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(newlyDoomedTriggerOrders({ symbol: 'KAITOUSDT', positions, orders, added })).toEqual([]);
    expect(placeable({ positions: [...positions, ...added.positions], orders, side: 'LONG', qty: add, price: 1.2, trigger: true })).toBe(true);
  });

  it('主空还没挂对冲、S₁ = 1.2 在现价上方：对冲按触发价那一道更紧（持仓到 1.2 也变大），可下单量 833 而不是 2,682', () => {
    const positions = [usdtPos('SHORT', 20_000, 1)];
    const r = kaito({ side: 'SHORT', positions, hedge: { price: 1.2, mainCoins: 20_000, existingCoins: 0 } })!;
    // 现价那一道：20,000 + X + 1.2 × (20,000 + X) ≤ 49,900 → 2,682；触发价那一道：2.4 × (20,000 + X) ≤ 50,000 → 833
    expect(r.coins).toBeCloseTo(50_000 / 2.4 - 20_000, 3);
    const add = Math.floor(r.coins * 100) / 100;
    const added = placementAftermath({ type: 'MARKET', side: 'SHORT', leverage: 15, quantity: add, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(placeable({ positions: [...positions, ...added.positions], orders: [], side: 'LONG', qty: 20_000 + add, price: 1.2, trigger: true })).toBe(true);
    const greedy = placementAftermath({ type: 'MARKET', side: 'SHORT', leverage: 15, quantity: 2_682, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(placeable({ positions: [...positions, ...greedy.positions], orders: [], side: 'LONG', qty: 22_682, price: 1.2, trigger: true })).toBe(false);
  });

  it('另一条线上带戳的突破加仓单（多 10,000 @1.5）：加仓与对冲都放得下还不够，还不能让它到 1.5 触发时注定被拒——两种先后都算', () => {
    const positions = [usdtPos('LONG', 10_000, 1)];
    const hedge = usdtConditional('SHORT', 10_000, 0.9);
    const breakout = { ...usdtConditional('LONG', 10_000, 1.5), id: 'breakout' };
    const orders = [hedge, breakout];
    const r = kaito({ positions, orders, hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 10_000 } })!;
    // 现价那一道 1.9X ≤ 15,900（8,368）、对冲触发那一道 1.8X ≤ 17,000（9,444）；
    // 突破单直接涨到 1.5 触发：1.5 × (10,000 + X) + 0.9 × (10,000 + X) + 15,000 ≤ 50,000 → X ≤ 11,000 ÷ 2.4；
    // 先跌到 0.9、两张对冲成交（锁住），再涨到 1.5：1.5 × (10,000 + X) × 2 + 15,000 ≤ 50,000 → X ≤ 5,000 ÷ 3（更紧）
    expect(r.coins).toBeCloseTo(5_000 / 3, 3);
    const doomed = (add: number) => {
      const added = placementAftermath({ type: 'MARKET', side: 'LONG', leverage: 15, quantity: add, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
      const increment = placementAftermath({ type: 'CONDITIONAL', side: 'SHORT', leverage: 15, quantity: add, stopPrice: 0.9, settlementMode: 'usdt' }, { markPrice: 1, immediate: false });
      return newlyDoomedTriggerOrders({
        symbol: 'KAITOUSDT', positions, orders, added: { positions: added.positions, orders: increment.orders }, markPrice: 1,
      }).map(d => [d.order.id, d.check.via]);
    };
    expect(doomed(Math.floor(r.coins * 100) / 100)).toEqual([]);
    // 只看直接涨到 1.5 的 4,583：先跌到 0.9 再涨回来时突破单被拒
    expect(doomed(4_583)).toEqual([['breakout', 0.9]]);
    // 只看加仓与对冲的 8,368：直接涨到 1.5 就被拒
    expect(doomed(8_368)).toEqual([['breakout', null]]);
  });

  it('连不加仓时的对冲都放不下（多 30,000、S₁ = 0.9 要挂 30,000）：可下单量 0，给出对冲这一侧还剩多少', () => {
    const positions = [usdtPos('LONG', 30_000, 1)];
    const r = kaito({ positions, hedge: { price: 0.9, mainCoins: 30_000, existingCoins: 0 } })!;
    expect(r.coins).toBe(0);
    expect(r.alone.coins).toBeCloseTo(19_900, 6);
    expect(r.hedge).toMatchObject({ blocked: true, binds: true });
    expect(r.hedge!.coins).toBeCloseTo(30_000, 6);
    // 面板对 S₁ 上那张空头条件单给的「可开」：(50,000 − 30,000 − 100) ÷ 0.9
    expect(r.hedge!.roomCoins).toBeCloseTo(19_900 / 0.9, 6);
  });

  it('已有的对冲盖得住 X₁ + X₂：不另占位置，可下单量就是单看这一单的余量', () => {
    const positions = [usdtPos('LONG', 1_000, 1)];
    const orders = [usdtConditional('SHORT', 100_000, 0.1)];
    const r = kaito({ positions, orders, hedge: { price: 0.1, mainCoins: 1_000, existingCoins: 100_000 } })!;
    expect(r.coins).toBeCloseTo(r.alone.coins, 9);
    expect(r.hedge).toMatchObject({ binds: false, blocked: false, coins: 0 });
  });

  it('币本位（合成 KAITOUSD，按面值计、不留余量）：对冲按 S₁ 折整张、向上取整', () => {
    const coinPos = {
      id: 'c1', side: 'LONG', quantity: 1_000, contracts: 1_000, contractSizeUsd: 10, settlementMode: 'coin',
      settlementAsset: 'KAITO', entryPrice: 1, leverage: 15, marginMode: 'isolated', margin: 666.67, openTime: 1, ...TIERED,
    } as unknown as Position;
    const r = addTierHeadroom({
      symbol: 'KAITOUSD', settlement: 'coin', side: 'LONG', storedLeverage: 15, positions: [coinPos], orders: [],
      markPrice: 1, orderKind: 'market', orderPrice: 1, fillPrice: 1.0001, contractFaceUsd: 10,
      hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 0 },
    })!;
    // 10,000 + 10a + 10h ≤ 50,000，h = ⌈(10,000 + 10a ÷ 1.0001) × 0.9 ÷ 10⌉
    const hedgeLots = (a: number) => Math.ceil(((10_000 + (a * 10) / 1.0001) * 0.9) / 10 - 1e-9);
    const fits = (a: number) => 10_000 + 10 * a + 10 * hedgeLots(a) <= 50_000;
    expect(fits(r.contracts!)).toBe(true);
    expect(fits(r.contracts! + 1)).toBe(false);
    expect(r.hedge!.contracts).toBe(hedgeLots(r.contracts!));
    expect(r.coins).toBeCloseTo((r.contracts! * 10) / 1.0001, 9);
  });
});

describe('【复核 v1】单看这一单的余量：与下单面板同一个判定', () => {
  it('条件单（突破加仓）按触发价再判那一道更紧时，取那一道', () => {
    // 空 20,000 @1.0（持仓按触发价估值会变大），多头突破加仓触发价 1.2
    const positions = [usdtPos('SHORT', 20_000, 1)];
    const r = kaito({ positions, orderKind: 'conditional', orderPrice: 1.2 })!;
    const atMarkOnly = placementSizingRemainingUsd(checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, orders: [], markPrice: 1,
      orderNotionalUsd: 0, orderPrice: 1.2, side: 'LONG',
    }), 1, { orderAtMarket: false, hasOpenPositions: true });
    // 现价：(50,000 − 20,000 − 100) ÷ 1.2；触发价：(50,000 − 24,000) ÷ 1.2 → 取后者
    expect(atMarkOnly / 1.2).toBeCloseTo(29_900 / 1.2, 6);
    expect(r.coins).toBeCloseTo(26_000 / 1.2, 6);
    expect(placeable({ positions, orders: [], side: 'LONG', qty: r.coins, price: 1.2, trigger: true })).toBe(true);
    expect(placeable({ positions, orders: [], side: 'LONG', qty: r.coins + 1, price: 1.2, trigger: true })).toBe(false);
  });

  it('保存的 125x（KAITO 最高 75x）按 75x 算，不会因为超过最高杠杆给出 0', () => {
    const r = kaito({ storedLeverage: 125 })!;
    expect(r.leverage).toBe(75);
    expect(r.coins).toBeCloseTo(5_000 * 0.998, 6);
  });

  it('更新前的空仓（没有戳）超过上限：开多（对冲它）有豁免额度，开空（往它那边加）为 0', () => {
    const legacyShort = usdtPos('SHORT', 200_000, 1, { leverage: 20, riskModel: undefined, riskSymbol: undefined });
    const long = kaito({ side: 'LONG', storedLeverage: 20, positions: [legacyShort] })!;
    expect(long.coins).toBeCloseTo(200_000 * 0.998, 6);
    const short = kaito({ side: 'SHORT', storedLeverage: 20, positions: [legacyShort] })!;
    expect(short.coins).toBe(0);
  });
});

// ───────────────────────── 复核第五轮 ─────────────────────────

type Side = 'LONG' | 'SHORT';
type Settlement = 'usdt' | 'coin';

/**
 * 按引擎的判定把计划走一遍：先挂加仓、再补挂对冲（下单闸门），然后按给定的先后让两张单成交 / 触发——
 * 条件单触发那一刻按 settleFillDebit 的判法（持仓按触发价、其余挂单按各自的价、排除自己），
 * 分层限价单成交时不再判；每一步成交之后，这一刻的持仓与挂单都要在当前杠杆的上限之内（不会卡死）。
 */
function walkPlan(args: {
  symbol: string;
  settlement: Settlement;
  leverage: number;
  positions: Position[];
  orders?: PendingOrder[];
  markPrice: number;
  add: { type: 'LIMIT' | 'CONDITIONAL'; side: Side; units: number; price: number };
  hedge: { units: number; price: number };
  face?: number;
  sequence: 'add-first' | 'hedge-first';
}) {
  const coin = args.settlement === 'coin';
  const face = args.face ?? 0;
  const usdOf = (units: number, price: number) => (coin ? units * face : units * price);
  const hedgeSide: Side = args.add.side === 'LONG' ? 'SHORT' : 'LONG';
  const draft = (type: 'LIMIT' | 'CONDITIONAL', side: Side, units: number, price: number) => ({
    type, side, leverage: args.leverage, quantity: units, contracts: coin ? units : undefined,
    contractSizeUsd: coin ? face : undefined, settlementMode: args.settlement,
    price: type === 'LIMIT' ? price : 0, stopPrice: type === 'CONDITIONAL' ? price : 0,
  });
  const base = { symbol: args.symbol, settlement: args.settlement, leverage: args.leverage };
  const resting = args.orders ?? [];
  const addPlaced = checkPlacementPositionLimit({
    ...base, positions: args.positions, orders: resting, markPrice: args.markPrice,
    orderNotionalUsd: usdOf(args.add.units, args.add.price), orderPrice: args.add.price, side: args.add.side,
    triggerPrice: args.add.price, triggerKind: args.add.type === 'LIMIT' ? 'limit' : 'trigger',
  });
  const addOrder = { ...placementAftermath(draft(args.add.type, args.add.side, args.add.units, args.add.price), { markPrice: args.markPrice, immediate: false }).orders[0], id: 'plan-add' };
  const hedgePlaced = checkPlacementPositionLimit({
    ...base, positions: args.positions, orders: [...resting, addOrder], markPrice: args.markPrice,
    orderNotionalUsd: usdOf(args.hedge.units, args.hedge.price), orderPrice: args.hedge.price, side: hedgeSide,
    triggerPrice: args.hedge.price,
  });
  const hedgeOrder = { ...placementAftermath(draft('CONDITIONAL', hedgeSide, args.hedge.units, args.hedge.price), { markPrice: args.markPrice, immediate: false }).orders[0], id: 'plan-hedge' };
  const filledFrom = (order: PendingOrder, price: number): Position => ({
    ...(args.positions[0]), id: `${order.id}-filled`, side: order.side, quantity: order.quantity,
    contracts: coin ? order.quantity : undefined, entryPrice: price, riskModel: 'binance-tiers-v1',
  } as Position);

  let positions = [...args.positions];
  let orders: PendingOrder[] = [...resting, addOrder, hedgeOrder];
  const steps: Array<{ order: string; gate: boolean; withinCap: boolean; exposure: number }> = [];
  const plan = args.sequence === 'add-first'
    ? [[addOrder, args.add.price], [hedgeOrder, args.hedge.price]] as const
    : [[hedgeOrder, args.hedge.price], [addOrder, args.add.price]] as const;
  for (const [order, price] of plan) {
    const rest = orders.filter(o => o.id !== order.id);
    const gate = order.type === 'LIMIT' ? null : restingTriggerCheck(args.symbol, order, { positions, orders: rest, markPrice: price });
    positions = [...positions, filledFrom(order, price)];
    orders = rest;
    const now = checkOrderPositionLimit({ ...base, positions, orders, markPrice: price, orderNotionalUsd: 0 });
    steps.push({ order: order.id, gate: gate ? gate.ok : true, withinCap: now.ok, exposure: now.exposureBefore });
  }
  const ok = addPlaced.ok && hedgePlaced.ok && steps.every(s => s.gate && s.withinCap);
  return { ok, addPlaced, hedgePlaced, steps };
}

const btcMain = (contracts: number, entryPrice = 100_000): Position => ({
  id: 'btc-main', side: 'LONG', quantity: contracts, contracts, contractSizeUsd: 100, settlementMode: 'coin',
  settlementAsset: 'BTC', entryPrice, leverage: 125, marginMode: 'isolated', margin: (contracts * 100) / 125, openTime: 1,
  riskModel: 'binance-tiers-v1', riskSymbol: 'BTCUSD',
} as unknown as Position);

describe('【复核 r5】限价加仓：对冲按「价格走到 S₁」判，那时加仓已是按 S₁ 估值的持仓', () => {
  it('【F1 复现】BTCUSD 125x（最高 5 BTC）、多 1,000 张、回调限价 @98,000、S₁ 90,000：可下单量不到 1,415 张；加仓成交、对冲触发都放得下', () => {
    const positions = [btcMain(1_000)];
    const r = addTierHeadroom({
      symbol: 'BTCUSD', settlement: 'coin', side: 'LONG', storedLeverage: 125, positions, orders: [],
      markPrice: 100_000, orderKind: 'limit', orderPrice: 98_000, fillPrice: 98_000, contractFaceUsd: 100,
      hedge: { price: 90_000, mainCoins: 1, existingCoins: 0 },
    })!;
    // 到 90,000：(1,000 + a + h) × 100 ÷ 90,000 ≤ 5，h = ⌈(1 + a × 100 ÷ 98,000) × 900⌉
    const hedgeLots = (a: number) => Math.ceil((1 + (a * 100) / 98_000) * 900 - 1e-9);
    const fits = (a: number) => 1_000 + a + hedgeLots(a) <= 4_500;
    expect(fits(r.contracts!)).toBe(true);
    expect(fits(r.contracts! + 1)).toBe(false);
    expect(r.contracts!).toBeLessThan(1_415);
    expect(r.hedge!.contracts).toBe(hedgeLots(r.contracts!));
    const walk = (units: number) => walkPlan({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 125, positions, markPrice: 100_000, face: 100,
      add: { type: 'LIMIT', side: 'LONG', units, price: 98_000 },
      hedge: { units: hedgeLots(units), price: 90_000 }, sequence: 'add-first',
    });
    expect(walk(r.contracts!).ok).toBe(true);
    expect(walk(r.contracts!).steps.at(-1)!.exposure).toBeLessThanOrEqual(5);
    // 旧口径给的 1,415 张：对冲到 90,000 时被拒
    expect(walk(1_415).steps.map(s => s.gate)).toEqual([true, false]);
  });

  it('【F1 复现】KAITOUSDT 15x、空 10,000、回调卖出限价 @1.05、S₁ 1.15：可下单量 = 50,000 ÷ 2.3 − 10,000（不是 12,272），走完两道都放得下', () => {
    const positions = [usdtPos('SHORT', 10_000, 1)];
    const r = kaito({
      side: 'SHORT', positions, orderKind: 'limit', orderPrice: 1.05, fillPrice: 1.05,
      hedge: { price: 1.15, mainCoins: 10_000, existingCoins: 0 },
    })!;
    // 到 1.15：1.15 × (10,000 + X) × 2 ≤ 50,000
    expect(r.coins).toBeCloseTo(50_000 / 2.3 - 10_000, 3);
    expect(r.hedge).toMatchObject({ binds: true, blocked: false });
    const walk = (units: number) => walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, markPrice: 1,
      add: { type: 'LIMIT', side: 'SHORT', units, price: 1.05 },
      hedge: { units: 10_000 + units, price: 1.15 }, sequence: 'add-first',
    });
    expect(walk(Math.floor(r.coins * 100) / 100).ok).toBe(true);
    expect(walk(12_272).steps.map(s => s.gate)).toEqual([true, false]);
  });

  it('【F1 复现】穿价的限价加仓（卖出 @0.95、现价 1.0）当作立即成交、按现价估值：可下单量 = 50,000 ÷ 2.2 − 10,000（不是 13,658）', () => {
    const positions = [usdtPos('SHORT', 10_000, 1)];
    const r = kaito({
      side: 'SHORT', positions, orderKind: 'limit', orderPrice: 0.95, fillPrice: 0.95,
      hedge: { price: 1.1, mainCoins: 10_000, existingCoins: 0 },
    })!;
    // 单看加仓：按现价估值、留余量 → 39,900 个币
    expect(r.alone.coins).toBeCloseTo(39_900, 6);
    // 对冲到 1.1：2.2 × (10,000 + X) ≤ 50,000
    expect(r.coins).toBeCloseTo(50_000 / 2.2 - 10_000, 3);
    const added = placementAftermath({ type: 'MARKET', side: 'SHORT', leverage: 15, quantity: r.coins, stopPrice: 0, settlementMode: 'usdt' }, { markPrice: 1, immediate: true });
    expect(placeable({ positions: [...positions, ...added.positions], orders: [], side: 'LONG', qty: 10_000 + r.coins, price: 1.1, trigger: true })).toBe(true);
  });

  it('BTCUSD 穿价买入限价 @102,000、S₁ 95,000：可下单量小于 1,503 张，成交后对冲下得出去、到 95,000 放得下', () => {
    const positions = [btcMain(1_000)];
    const r = addTierHeadroom({
      symbol: 'BTCUSD', settlement: 'coin', side: 'LONG', storedLeverage: 125, positions, orders: [],
      markPrice: 100_000, orderKind: 'limit', orderPrice: 102_000, fillPrice: 102_000, contractFaceUsd: 100,
      hedge: { price: 95_000, mainCoins: 1, existingCoins: 0 },
    })!;
    expect(r.contracts!).toBeLessThan(1_503);
    expect(r.contracts!).toBeGreaterThan(1_400);
    // 成交后（持仓按现价 100,000）挂对冲：两道都放得下
    const filled = { ...positions[0], id: 'filled', quantity: r.contracts!, contracts: r.contracts!, entryPrice: 102_000 } as Position;
    const hedge = checkPlacementPositionLimit({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 125, positions: [...positions, filled], orders: [], markPrice: 100_000,
      orderNotionalUsd: r.hedge!.contracts! * 100, orderPrice: 95_000, side: 'SHORT', triggerPrice: 95_000,
    });
    expect(hedge.ok).toBe(true);
  });
});

describe('【复核 r5 · 二】挂着的限价加仓：补挂对冲之后，它在 S₂ 成交那一刻也要放得下', () => {
  it('【复现】空 10,000、卖出限价 @1.2、S₁ = 1.1 夹在现价与 S₂ 之间：涨到 1.2 时对冲已经触发、是按 1.2 估值的持仓 → 12,000 + 1.2X + 1.2 × (10,000 + X) ≤ 50,000', () => {
    const positions = [usdtPos('SHORT', 10_000, 1)];
    const r = kaito({
      side: 'SHORT', positions, orderKind: 'limit', orderPrice: 1.2, fillPrice: 1.2,
      hedge: { price: 1.1, mainCoins: 10_000, existingCoins: 0 },
    })!;
    expect(r.coins).toBeCloseTo(26_000 / 2.4, 3);
    const add = Math.floor(r.coins * 100) / 100;
    const hedge = placementAftermath({ type: 'CONDITIONAL', side: 'LONG', leverage: 15, quantity: 10_000 + add, stopPrice: 1.1, settlementMode: 'usdt' }, { markPrice: 1, immediate: false });
    const fillGate = (coins: number) => checkPlacementPositionLimit({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, orders: hedge.orders, markPrice: 1,
      orderNotionalUsd: coins * 1.2, orderPrice: 1.2, side: 'SHORT', triggerPrice: 1.2, triggerKind: 'limit',
    });
    expect(fillGate(add).ok).toBe(true);
    // 旧口径（对冲按挂在 1.1 的委托算）给的 11,739.13：成交那一刻 52,173.91 > 50,000，账户卡死
    expect(fillGate(11_739.13).ok).toBe(false);
    // 引擎的先后：先涨到 1.1 对冲触发，再涨到 1.2 加仓成交——每一步都放得下
    const walk = (units: number) => walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, markPrice: 1,
      add: { type: 'LIMIT', side: 'SHORT', units, price: 1.2 },
      hedge: { units: 10_000 + units, price: 1.1 }, sequence: 'hedge-first',
    });
    expect(walk(add).ok).toBe(true);
    const greedy = walk(11_739.13);
    expect(greedy.steps.map(s => s.withinCap)).toEqual([true, false]);
    expect(greedy.steps[1].exposure).toBeCloseTo(52_173.912, 2);
  });
});

describe('【复核 r5 · 二】条件单加仓：两张单谁先到都算', () => {
  it('【复现】BTCUSD 125x、多 1,000 张 @100,000、突破加仓 @110,000、S₁ 95,000：可下单量 ≤ 1,502 张（不是 1,621）；两种先后都不被拒', () => {
    const positions = [btcMain(1_000)];
    const r = addTierHeadroom({
      symbol: 'BTCUSD', settlement: 'coin', side: 'LONG', storedLeverage: 125, positions, orders: [],
      markPrice: 100_000, orderKind: 'conditional', orderPrice: 110_000, fillPrice: 110_000, contractFaceUsd: 100,
      hedge: { price: 95_000, mainCoins: 1, existingCoins: 0 },
    })!;
    // 先突破：到 95,000 时 (1,000 + a + h) × 100 ÷ 95,000 ≤ 5，h = ⌈(1 + a × 100 ÷ 110,000) × 950⌉
    const hedgeLots = (a: number) => Math.ceil((1 + (a * 100) / 110_000) * 950 - 1e-9);
    const fits = (a: number) => 1_000 + a + hedgeLots(a) <= 4_750;
    expect(fits(r.contracts!)).toBe(true);
    expect(fits(r.contracts! + 1)).toBe(false);
    expect(r.contracts!).toBeLessThanOrEqual(1_502);
    expect(r.hedge).toMatchObject({ binds: true, blocked: false, contracts: hedgeLots(r.contracts!) });
    const walk = (units: number, sequence: 'add-first' | 'hedge-first') => walkPlan({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 125, positions, markPrice: 100_000, face: 100,
      add: { type: 'CONDITIONAL', side: 'LONG', units, price: 110_000 },
      hedge: { units: hedgeLots(units), price: 95_000 }, sequence,
    });
    expect(walk(r.contracts!, 'add-first').ok).toBe(true);
    expect(walk(r.contracts!, 'hedge-first').ok).toBe(true);
    // 旧口径的 1,621 张：先突破之后，对冲在 95,000 被拒（5.2326 BTC）
    const greedy = walk(1_621, 'add-first');
    expect(greedy.steps.map(s => s.gate)).toEqual([true, false]);
    // 两张单挂上时，预警就说出这一种先后
    const add = { ...placementAftermath({ type: 'CONDITIONAL', side: 'LONG', leverage: 125, quantity: 1_621, contracts: 1_621, contractSizeUsd: 100, stopPrice: 110_000, settlementMode: 'coin' }, { markPrice: 100_000, immediate: false }).orders[0], id: 'add' };
    const hedge = placementAftermath({ type: 'CONDITIONAL', side: 'SHORT', leverage: 125, quantity: 2_350, contracts: 2_350, contractSizeUsd: 100, stopPrice: 95_000, settlementMode: 'coin' }, { markPrice: 100_000, immediate: false });
    const risks = newlyDoomedTriggerOrders({ symbol: 'BTCUSD', positions, orders: [add], added: hedge, markPrice: 100_000 });
    expect(risks.map(x => [x.order.id, x.added ?? false, x.check.via])).toEqual([[hedge.orders[0].id, true, 110_000]]);
    expect(risks[0].check.exposureAfter).toBeCloseTo((2_621 * 100 + 2_350 * 100) / 95_000, 6);
  });

  it('【复现】KAITOUSDT 15x、空 10,000、跌破加仓（卖出条件单）@0.8、S₁ 1.1：可下单量 = 50,000 ÷ 2.2 − 10,000 = 12,727.27（不是 14,736.84）', () => {
    const positions = [usdtPos('SHORT', 10_000, 1)];
    const r = kaito({
      side: 'SHORT', positions, orderKind: 'conditional', orderPrice: 0.8, fillPrice: 0.8,
      hedge: { price: 1.1, mainCoins: 10_000, existingCoins: 0 },
    })!;
    expect(r.coins).toBeCloseTo(50_000 / 2.2 - 10_000, 3);
    const walk = (units: number, sequence: 'add-first' | 'hedge-first') => walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, markPrice: 1,
      add: { type: 'CONDITIONAL', side: 'SHORT', units, price: 0.8 },
      hedge: { units: 10_000 + units, price: 1.1 }, sequence,
    });
    const add = Math.floor(r.coins * 100) / 100;
    expect(walk(add, 'add-first').ok).toBe(true);
    expect(walk(add, 'hedge-first').ok).toBe(true);
    // 旧口径的 14,736.84：先跌破、加仓成交，再涨到 1.1 时对冲被拒（27,210.52 × 2 = 54,421.05）
    const greedy = walk(14_736.84, 'add-first');
    expect(greedy.steps.map(s => s.gate)).toEqual([true, false]);
  });

  it('【复现】落在路上的条件加仓（空 10,000、卖出条件单 @1.05、S₁ 1.1）：到 1.1 时加仓已触发 → 12,727.27（不是 13,023.26）', () => {
    const positions = [usdtPos('SHORT', 10_000, 1)];
    const r = kaito({
      side: 'SHORT', positions, orderKind: 'conditional', orderPrice: 1.05, fillPrice: 1.05,
      hedge: { price: 1.1, mainCoins: 10_000, existingCoins: 0 },
    })!;
    expect(r.coins).toBeCloseTo(50_000 / 2.2 - 10_000, 3);
    const add = Math.floor(r.coins * 100) / 100;
    expect(walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, markPrice: 1,
      add: { type: 'CONDITIONAL', side: 'SHORT', units: add, price: 1.05 },
      hedge: { units: 10_000 + add, price: 1.1 }, sequence: 'add-first',
    }).ok).toBe(true);
    // 直接走到 1.1 的预判里，1.05 的加仓条件单已经触发（按 1.1 估值的持仓）
    const addOrder = placementAftermath({ type: 'CONDITIONAL', side: 'SHORT', leverage: 15, quantity: 13_023.26, stopPrice: 1.05, settlementMode: 'usdt' }, { markPrice: 1, immediate: false });
    const hedgeOrder = placementAftermath({ type: 'CONDITIONAL', side: 'LONG', leverage: 15, quantity: 23_023.26, stopPrice: 1.1, settlementMode: 'usdt' }, { markPrice: 1, immediate: false }).orders[0];
    const direct = restingTriggerCheck('KAITOUSDT', hedgeOrder, { positions, orders: [...addOrder.orders, hedgeOrder], markPrice: 1 })!;
    expect(direct.ok).toBe(false);
    expect(direct.exposureAfter).toBeCloseTo(23_023.26 * 1.1 * 2, 4);
  });

  it('【复现】KAITOUSDT 5x、空 100,000、跌破加仓 @0.8、S₁ 1.05：可下单量 = 250,000 ÷ 2.1 − 100,000 = 19,047.62（不是 21,621.62）', () => {
    const positions = [usdtPos('SHORT', 100_000, 1, { leverage: 5 })];
    const r = kaito({
      side: 'SHORT', storedLeverage: 5, positions, orderKind: 'conditional', orderPrice: 0.8, fillPrice: 0.8,
      hedge: { price: 1.05, mainCoins: 100_000, existingCoins: 0 },
    })!;
    expect(r.coins).toBeCloseTo(250_000 / 2.1 - 100_000, 3);
    const walk = (units: number) => walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 5, positions, markPrice: 1,
      add: { type: 'CONDITIONAL', side: 'SHORT', units, price: 0.8 },
      hedge: { units: 100_000 + units, price: 1.05 }, sequence: 'add-first',
    });
    expect(walk(Math.floor(r.coins * 100) / 100).ok).toBe(true);
    const greedy = walk(21_621.62);
    expect(greedy.steps.map(s => s.gate)).toEqual([true, false]);
    expect(greedy.steps[1].exposure + 0).toBeGreaterThan(0);
  });

  it('【复现】真币本位 AAVE 10x（最高 750 AAVE）、多 3,000 张 @100、突破加仓 @105、S₁ 97：可下单量 709 张（不是 738）', () => {
    const positions = [{
      id: 'aave-main', side: 'LONG', quantity: 3_000, contracts: 3_000, contractSizeUsd: 10, settlementMode: 'coin',
      settlementAsset: 'AAVE', entryPrice: 100, leverage: 10, marginMode: 'isolated', margin: 3_000, openTime: 1,
      riskModel: 'binance-tiers-v1', riskSymbol: 'AAVEUSDT',
    } as unknown as Position];
    const r = addTierHeadroom({
      symbol: 'AAVEUSDT', settlement: 'coin', side: 'LONG', storedLeverage: 10, positions, orders: [],
      markPrice: 100, orderKind: 'conditional', orderPrice: 105, fillPrice: 105, contractFaceUsd: 10,
      hedge: { price: 97, mainCoins: 300, existingCoins: 0 },
    })!;
    // 先突破：到 97 时 (3,000 + a + h) × 10 ÷ 97 ≤ 750，h = ⌈(300 + a × 10 ÷ 105) × 97 ÷ 10⌉
    const hedgeLots = (a: number) => Math.ceil(((300 + (a * 10) / 105) * 97) / 10 - 1e-9);
    expect(r.contracts).toBe(709);
    expect(3_000 + 709 + hedgeLots(709)).toBeLessThanOrEqual(7_275);
    expect(3_000 + 710 + hedgeLots(710)).toBeGreaterThan(7_275);
    const walk = (units: number, sequence: 'add-first' | 'hedge-first') => walkPlan({
      symbol: 'AAVEUSDT', settlement: 'coin', leverage: 10, positions, markPrice: 100, face: 10,
      add: { type: 'CONDITIONAL', side: 'LONG', units, price: 105 },
      hedge: { units: hedgeLots(units), price: 97 }, sequence,
    });
    expect(walk(709, 'add-first').ok).toBe(true);
    expect(walk(709, 'hedge-first').ok).toBe(true);
    expect(walk(738, 'add-first').steps.map(s => s.gate)).toEqual([true, false]);
  });

  it('【复现】U 本位多 10,000、突破加仓 @1.2、S₁ 0.9：先跌到 0.9、对冲成交再涨到 1.2 那一种更紧 → 10,833.33（只算先突破是 13,809.52）', () => {
    const positions = [usdtPos('LONG', 10_000, 1)];
    const r = kaito({ positions, orderKind: 'conditional', orderPrice: 1.2, fillPrice: 1.2, hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 0 } })!;
    // 先跌到 0.9：到 1.2 时 12,000 + 1.2 × (10,000 + X) + 1.2X ≤ 50,000
    expect(r.coins).toBeCloseTo(26_000 / 2.4, 3);
    const walk = (units: number, sequence: 'add-first' | 'hedge-first') => walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, markPrice: 1,
      add: { type: 'CONDITIONAL', side: 'LONG', units, price: 1.2 },
      hedge: { units: 10_000 + units, price: 0.9 }, sequence,
    });
    const add = Math.floor(r.coins * 100) / 100;
    expect(walk(add, 'add-first').ok).toBe(true);
    expect(walk(add, 'hedge-first').ok).toBe(true);
    // 只算先突破的 13,809.52：先跌到 0.9 时对冲成交（锁住），再涨到 1.2 加仓被拒——账户净空 13,809.52 一路涨
    const shakeout = walk(13_809.52, 'hedge-first');
    expect(shakeout.steps.map(s => s.gate)).toEqual([true, false]);
    expect(walk(13_809.52, 'add-first').ok).toBe(true);
    // 旧口径的 14,714.28：先突破也不行（补挂对冲之后，加仓到 1.2 触发时被拒）
    expect(walk(14_714.28, 'add-first').steps[0].gate).toBe(false);
  });

  it('X₁ 的对冲已经挂在 S₁ 上：结果相同（只补 X₂），已挂的那张在两种先后下也都放得下', () => {
    const positions = [usdtPos('LONG', 10_000, 1)];
    const orders = [usdtConditional('SHORT', 10_000, 0.9)];
    const r = kaito({ positions, orders, orderKind: 'conditional', orderPrice: 1.2, fillPrice: 1.2, hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 10_000 } })!;
    expect(r.coins).toBeCloseTo(26_000 / 2.4, 3);
    expect(r.hedge!.coins).toBeCloseTo(r.coins, 6);
    const add = Math.floor(r.coins * 100) / 100;
    for (const sequence of ['add-first', 'hedge-first'] as const) {
      const walk = walkPlan({
        symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, orders, markPrice: 1,
        add: { type: 'CONDITIONAL', side: 'LONG', units: add, price: 1.2 },
        hedge: { units: add, price: 0.9 }, sequence,
      });
      expect(walk.addPlaced.ok && walk.hedgePlaced.ok).toBe(true);
      expect(walk.steps.every(s => s.gate && s.withinCap)).toBe(true);
    }
    // 已挂的 X₁ 对冲：先突破之后到 0.9 也放得下
    const added = placementAftermath({ type: 'CONDITIONAL', side: 'LONG', leverage: 15, quantity: add, stopPrice: 1.2, settlementMode: 'usdt' }, { markPrice: 1, immediate: false });
    const inc = placementAftermath({ type: 'CONDITIONAL', side: 'SHORT', leverage: 15, quantity: add, stopPrice: 0.9, settlementMode: 'usdt' }, { markPrice: 1, immediate: false });
    expect(newlyDoomedTriggerOrders({
      symbol: 'KAITOUSDT', positions, orders, added: { positions: [], orders: [...added.orders, ...inc.orders] }, markPrice: 1, checkAdded: true,
    })).toEqual([]);
  });

  it('镜像：真币本位空仓跌破加仓 / U 本位多仓回调加仓也走完两种先后（同一侧的限价加仓只有一种先后）', () => {
    // BTCUSD 125x 空 1,000 张、跌破加仓（卖出条件单）@90,000、S₁ 105,000
    const short = [{ ...btcMain(1_000), side: 'SHORT' } as Position];
    const r = addTierHeadroom({
      symbol: 'BTCUSD', settlement: 'coin', side: 'SHORT', storedLeverage: 125, positions: short, orders: [],
      markPrice: 100_000, orderKind: 'conditional', orderPrice: 90_000, fillPrice: 90_000, contractFaceUsd: 100,
      hedge: { price: 105_000, mainCoins: 1, existingCoins: 0 },
    })!;
    const hedgeLots = (a: number) => Math.ceil((1 + (a * 100) / 90_000) * 1_050 - 1e-9);
    const walk = (units: number, sequence: 'add-first' | 'hedge-first') => walkPlan({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 125, positions: short, markPrice: 100_000, face: 100,
      add: { type: 'CONDITIONAL', side: 'SHORT', units, price: 90_000 },
      hedge: { units: hedgeLots(units), price: 105_000 }, sequence,
    });
    expect(walk(r.contracts!, 'add-first').ok).toBe(true);
    expect(walk(r.contracts!, 'hedge-first').ok).toBe(true);
    // 卡住的是「先涨到 105,000、对冲成交，再跌到 90,000」：到 90,000 时 (1,000 + h + a) × 100 ÷ 90,000 ≤ 5
    expect(1_000 + hedgeLots(r.contracts!) + r.contracts!).toBeLessThanOrEqual(4_500);
    expect(1_000 + hedgeLots(r.contracts! + 1) + r.contracts! + 1).toBeGreaterThan(4_500);
    expect(walk(r.contracts! + 1, 'hedge-first').steps.map(s => s.gate)).toEqual([true, false]);
    expect(walk(r.contracts! + 1, 'add-first').ok).toBe(true);

    // U 本位多 10,000、回调买入限价 @0.95、S₁ 0.9：S₂ 在路上，只有「先成交再跌到 S₁」一种先后
    const long = [usdtPos('LONG', 10_000, 1)];
    const lim = kaito({ positions: long, orderKind: 'limit', orderPrice: 0.95, fillPrice: 0.95, hedge: { price: 0.9, mainCoins: 10_000, existingCoins: 0 } })!;
    // 现价那一道（留余量）：10,000 + 0.95X + 0.9 × (10,000 + X) ≤ 49,900；到 0.9：1.8 × (10,000 + X) ≤ 50,000
    expect(lim.coins).toBeCloseTo(Math.min(30_900 / 1.85, 50_000 / 1.8 - 10_000), 3);
    expect(walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions: long, markPrice: 1,
      add: { type: 'LIMIT', side: 'LONG', units: Math.floor(lim.coins * 100) / 100, price: 0.95 },
      hedge: { units: 10_000 + Math.floor(lim.coins * 100) / 100, price: 0.9 }, sequence: 'add-first',
    }).ok).toBe(true);
  });
});

describe('【复核 r5 · 二】挂着的限价加仓：另一侧的开仓挂单先成交、价格再折回 S₂ 那一刻也要放得下', () => {
  it('BTCUSD 125x：多 1,000 张 + 已成交的空头 1,000 张 + 卖出限价 400 张 @110,000；回调买入限价 @95,510 → 先涨到 110,000 再跌回来：(2,400 + a) × 100 ÷ 95,510 ≤ 5 → 2,375 张（直接走是 2,428）', () => {
    const positions = [btcMain(1_000), { ...btcMain(1_000), id: 'btc-short', side: 'SHORT' } as Position];
    const sellLimit = {
      id: 'sell-limit', side: 'SHORT', type: 'LIMIT', price: 110_000, stopPrice: 0, quantity: 400, contracts: 400,
      contractSizeUsd: 100, settlementMode: 'coin', leverage: 125, marginMode: 'isolated', status: 'NEW', createdAt: 0,
      riskModel: 'binance-tiers-v1', riskSymbol: 'BTCUSD',
    } as unknown as PendingOrder;
    const offer = (orders: PendingOrder[]) => addTierHeadroom({
      symbol: 'BTCUSD', settlement: 'coin', side: 'LONG', storedLeverage: 125, positions, orders,
      markPrice: 100_000, orderKind: 'limit', orderPrice: 95_510, fillPrice: 95_510, contractFaceUsd: 100,
      // 对冲已经足额（这里只看加仓自己成交的那一刻，不让补挂的对冲来卡）
      hedge: { price: 90_000, mainCoins: 1, existingCoins: 100 },
    })!;
    // 直接跌到 95,510：卖出限价按自己的价 → (2,000 + a) × 100 ÷ 95,510 + 400 × 100 ÷ 110,000 ≤ 5
    const direct = offer([sellLimit]);
    expect(direct.alone.contracts).toBe(2_428);
    // 先涨到 110,000（卖单成交），再跌回 95,510：那一刻它是按 95,510 估值的空仓
    expect(direct.contracts).toBe(2_375);
    expect(direct.hedge).toMatchObject({ contracts: 0, binds: true, blocked: false });
    const fillGate = (a: number, via: number[] | undefined) => checkPlacementPositionLimit({
      symbol: 'BTCUSD', settlement: 'coin', leverage: 125, positions, orders: [sellLimit], markPrice: 100_000,
      orderNotionalUsd: a * 100, orderPrice: 95_510, side: 'LONG', triggerPrice: 95_510, triggerKind: 'limit', pathVia: via,
    });
    expect(fillGate(2_375, [110_000]).ok).toBe(true);
    expect(fillGate(2_376, [110_000]).ok).toBe(false);
    expect(fillGate(2_428, undefined).ok).toBe(true);
    // 另一侧没有挂单时只有一种先后
    expect(offer([]).contracts).toBe(offer([]).alone.contracts);
  });
});

describe('【复核 r5 · 二】条件单加仓在 S₁ 之外：先到 S₁、对冲成交，加仓触发那一刻也要放得下', () => {
  it('KAITOUSDT 15x、空 10,000、卖出条件单 @1.15、S₁ 1.1：涨到 1.15 时对冲已是持仓 → 1.15 × (10,000 + (10,000 + X) + X) ≤ 50,000 → 11,739.13', () => {
    const positions = [usdtPos('SHORT', 10_000, 1)];
    const r = kaito({
      side: 'SHORT', positions, orderKind: 'conditional', orderPrice: 1.15, fillPrice: 1.15,
      hedge: { price: 1.1, mainCoins: 10_000, existingCoins: 0 },
    })!;
    // 对冲到 1.1（加仓还按 1.15 挂着）：22,000 + 2.25X ≤ 50,000 → 12,444；加仓到 1.15（对冲已成交）更紧
    expect(r.coins).toBeCloseTo(27_000 / 2.3, 3);
    const add = Math.floor(r.coins * 100) / 100;
    const walk = (units: number) => walkPlan({
      symbol: 'KAITOUSDT', settlement: 'usdt', leverage: 15, positions, markPrice: 1,
      add: { type: 'CONDITIONAL', side: 'SHORT', units, price: 1.15 },
      hedge: { units: 10_000 + units, price: 1.1 }, sequence: 'hedge-first',
    });
    expect(walk(add).ok).toBe(true);
    expect(walk(12_444).steps.map(s => s.gate)).toEqual([true, false]);
  });
});
