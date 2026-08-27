import { describe, expect, it } from 'vitest';
import type { PendingOrder } from '@/types/trading';
import { restingOrderSize, withRemainingUnits } from '@/lib/restingOrderSize';

const order = (over: Partial<PendingOrder>): PendingOrder => ({
  id: 'o1', side: 'LONG', type: 'LIMIT', price: 0.01, stopPrice: 0,
  quantity: 100, leverage: 3, marginMode: 'isolated', status: 'NEW', createdAt: 0,
  ...over,
} as PendingOrder);

const coin = (over: Partial<PendingOrder>): PendingOrder => order({
  settlementMode: 'coin', settlementAsset: 'NOM', contractSizeUsd: 10,
  quantity: 100, contracts: 100, ...over,
});

describe('挂单的剩余量', () => {
  it('非 TWAP 的挂单要么全成要么还在，剩余就是全部', () => {
    expect(restingOrderSize(coin({ type: 'CONDITIONAL' })))
      .toEqual({ units: 100, totalUnits: 100, filledUnits: 0, partial: false });
  });

  it('【回归】TWAP 成交九成后，剩余是 10 而不是 100', () => {
    // 切片引擎只累加 twapFilledQty，从不递减 quantity/contracts。
    // 直接读 order 的话，走完九成的单子与还没开始的长得一模一样。
    const t = coin({ type: 'TWAP', quantity: 100, contracts: 100, twapTotalQty: 100, twapFilledQty: 90 });
    expect(restingOrderSize(t)).toEqual({ units: 10, totalUnits: 100, filledUnits: 90, partial: true });
    expect(withRemainingUnits(t).contracts).toBe(10);
    expect(withRemainingUnits(t).quantity).toBe(10);
  });

  it('还没走过任何一片的 TWAP 不标「部分成交」', () => {
    const t = coin({ type: 'TWAP', twapTotalQty: 100, twapFilledQty: 0 });
    expect(restingOrderSize(t).partial).toBe(false);
    expect(withRemainingUnits(t)).toBe(t);   // 原样返回，不多造一个对象
  });

  it('币本位的量是整数张——半张以下的浮点噪声不算部分成交', () => {
    const t = coin({ type: 'TWAP', twapTotalQty: 100, twapFilledQty: 1e-9 });
    expect(restingOrderSize(t).partial).toBe(false);
  });

  it('U 本位的 TWAP 同样按剩余读，且门槛更细', () => {
    const t = order({ type: 'TWAP', quantity: 5, twapTotalQty: 5, twapFilledQty: 1.25 });
    expect(restingOrderSize(t)).toEqual({ units: 3.75, totalUnits: 5, filledUnits: 1.25, partial: true });
    expect(withRemainingUnits(t).quantity).toBeCloseTo(3.75, 9);
  });

  it('已成交量超过总量时钳到 0，不给出负的剩余', () => {
    const t = coin({ type: 'TWAP', twapTotalQty: 100, twapFilledQty: 140 });
    expect(restingOrderSize(t).units).toBe(0);
    expect(restingOrderSize(t).filledUnits).toBe(100);
  });

  it('缺 twapTotalQty 的老单子退回 quantity，不返回 0', () => {
    const t = coin({ type: 'TWAP', quantity: 80, contracts: 80, twapTotalQty: undefined, twapFilledQty: 30 });
    expect(restingOrderSize(t)).toEqual({ units: 50, totalUnits: 80, filledUnits: 30, partial: true });
  });
});
