import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';
import { availableUsd, crossMarginUsed, evaluateFillAffordability, fillCostUsd } from '@/lib/fillAffordability';
import { orderReferencePrice } from '@/lib/orderReferencePrice';

const coinOrder = (over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'o1', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 0.012,
  quantity: 100, contracts: 100, contractSizeUsd: 10,
  settlementMode: 'coin', settlementAsset: 'NOM',
  leverage: 10, marginMode: 'isolated', status: 'PENDING', createdAt: 0,
  ...over,
} as PendingOrder);

const linearOrder = (over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: 'o2', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 0.012,
  quantity: 100, leverage: 10, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT',
  status: 'PENDING', createdAt: 0,
  ...over,
} as PendingOrder);

const pos = (over: Partial<Position>): Position => ({
  id: 'p', side: 'LONG', quantity: 1, entryPrice: 1, leverage: 10,
  margin: 100, marginMode: 'cross', openTime: 0, ...over,
} as Position);

describe('币本位的保证金与价无关——这条是承重的', () => {
  it('喂什么价都得出同一个数', () => {
    // marginCoin = 名义 ÷(价 × 杠杆),再乘回同一个价 → 名义 ÷ 杠杆。价精确约掉。
    // 谁要是「顺手把 estPrice 也给币本位修一下」，这条会立刻响。
    const a = fillCostUsd('NOMUSD', coinOrder(), 0.010);
    const b = fillCostUsd('NOMUSD', coinOrder(), 0.020);
    expect(a.marginUsd).toBeCloseTo(b.marginUsd, 12);
    expect(a.feeUsd).toBeCloseTo(b.feeUsd, 12);
    expect(a.marginUsd).toBeCloseTo(1000 / 10, 9);      // 100 张 × 10 USD ÷ 10x
    expect(a.feeUsd).toBeCloseTo(1000 * 0.0004, 9);     // taker
  });

  it('【回归】按 taker 估，不是 maker——成交点全都是 taker', () => {
    expect(fillCostUsd('NOMUSD', coinOrder(), 0.012).feeUsd)
      .toBeCloseTo(2 * fillCostUsd('NOMUSD', coinOrder(), 0.012, true).feeUsd, 9);
  });
});

describe('U 本位按成交价估，不是按下单那刻的盘口', () => {
  it('【回归】条件单的价在 stopPrice 上，price 恒为 0', () => {
    const o = linearOrder({ price: 0, stopPrice: 0.012 });
    // 旧写法 price>0?price:市价 → 一路兜到 0.010；折算价解析出 0.012
    expect(orderReferencePrice(o, 0.010).price).toBeCloseTo(0.012, 9);
    expect(fillCostUsd('XUSDT', o, 0.010).marginUsd).toBeCloseTo(0.10, 9);
    expect(fillCostUsd('XUSDT', o, 0.012).marginUsd).toBeCloseTo(0.12, 9);
    // 按 0.010 放行、按 0.012 扣款 —— 少查 20%
  });

  it('反方向也成立：触发价低于市价时旧写法是过严，会误拒', () => {
    const o = linearOrder({ price: 0, stopPrice: 0.008 });
    expect(fillCostUsd('XUSDT', o, 0.008).marginUsd)
      .toBeLessThan(fillCostUsd('XUSDT', o, 0.010).marginUsd);
  });
});

describe('可用余额与逐笔判定', () => {
  it('只减全仓——逐仓的保证金开仓时就已经从余额里扣走了', () => {
    const map = { A: [pos({ marginMode: 'cross', margin: 100 })], B: [pos({ marginMode: 'isolated', margin: 500 })] };
    expect(crossMarginUsed(map)).toBe(100);
    expect(availableUsd(1000, map)).toBe(900);
  });

  it('【回归】连续扣款：第三笔必须被拦下', () => {
    // 挂单不预留保证金，所以三条各自过得了下单检查的腿会一起扣款。
    // 余额 100,000，每笔 60,240：前两笔加起来已经 120,480。
    let balance = 100_000;
    const each = 60_240;
    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const r = evaluateFillAffordability({ availableUsd: balance, marginUsd: 60_000, feeUsd: 240 });
      results.push(r.ok);
      if (r.ok) balance -= each;
    }
    expect(results).toEqual([true, false, false]);
    expect(balance).toBeGreaterThanOrEqual(0);   // 旧行为在这里是 −20,480
  });

  it('缺口按 USD 报出来，好让提示说得出差多少', () => {
    const r = evaluateFillAffordability({ availableUsd: 100, marginUsd: 150, feeUsd: 0.5 });
    expect(r.ok).toBe(false);
    expect(r.shortfallUsd).toBeCloseTo(50.5, 9);
  });

  it('恰好够用要放行；ε 只吸浮点毛刺，不是宽容额度', () => {
    expect(evaluateFillAffordability({ availableUsd: 100, marginUsd: 100, feeUsd: 0 }).ok).toBe(true);
    expect(evaluateFillAffordability({ availableUsd: 100, marginUsd: 100, feeUsd: 1e-9 }).ok).toBe(true);
    expect(evaluateFillAffordability({ availableUsd: 100, marginUsd: 100, feeUsd: 0.01 }).ok).toBe(false);
  });

  it('数字坏掉时按 0 算，绝不因为 NaN 就放行', () => {
    expect(evaluateFillAffordability({ availableUsd: NaN, marginUsd: 10, feeUsd: 0 }).ok).toBe(false);
    expect(evaluateFillAffordability({ availableUsd: 100, marginUsd: NaN, feeUsd: NaN }).ok).toBe(true);
  });
});
