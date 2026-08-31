import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import { evaluateIsolatedLiquidation } from '@/lib/liquidationGuards';
import { removableMarginUsd } from '@/lib/positionGroupRisk';
import { getSettlementMarginParts } from '@/lib/tradingSettlement';
import {
  maxNotionalForLeverage,
  maxSafeLeverageForPosition,
  planLeverageChange,
  symbolExposureNotionalUsd,
} from '@/lib/leverageRestatement';

/** 用户截图那笔 LUMIA：名义 26.247、开仓价 0.0873999、5x 逐仓。 */
const N = 26.247;
const E = 0.0873999;
const lumia = (over: Partial<Position> = {}): Position => ({
  id: 'p1', side: 'LONG', quantity: N / E, entryPrice: E, leverage: 5,
  marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: N / 5, isolatedMargin: N / 5, openTime: 1_000,
  ...over,
} as Position);

/** 币本位：7 张 × 100 USD 面值，开仓价 60000。 */
const inverse = (over: Partial<Position> = {}): Position => ({
  id: 'c1', side: 'LONG', quantity: 7, contracts: 7, contractSizeUsd: 100,
  settlementMode: 'coin', settlementAsset: 'BTC', entryPrice: 60_000, leverage: 5,
  marginMode: 'isolated', margin: 700 / 5, isolatedMargin: 700 / 5,
  marginCoin: 700 / (60_000 * 5), openTime: 1_000,
  ...over,
} as Position);

const plan = (positions: Position[], to: number, mark = E, orders: PendingOrder[] = [], from = 5) =>
  planLeverageChange({ symbol: 'LUMIAUSDT', positions, orders, markPrice: mark, currentLeverage: from, nextLeverage: to });

describe('提杠杆 = 降低保证金地板 = 释放保证金', () => {
  it('5x → 10x：保证金减半，强平价被拉向标记价，释放额回到余额', () => {
    const r = plan([lumia()], 10);
    expect(r.ok).toBe(true);
    const leg = r.legs[0];
    expect(leg.marginBefore).toBeCloseTo(5.2494, 6);
    expect(leg.marginAfter).toBeCloseTo(2.6247, 6);
    expect(leg.releaseUsd).toBeCloseTo(2.6247, 6);
    expect(leg.liqBefore).toBeCloseTo(0.0702695196, 9);
    expect(leg.liqAfter).toBeCloseTo(0.0790095096, 9);
    // 强平价确实靠近了标记价——这就是提杠杆的代价
    expect(leg.liqAfter!).toBeGreaterThan(leg.liqBefore!);
  });

  it('【回归】不得凭空造出「可减保证金」——只改 leverage 是最像样也最危险的实现', () => {
    // 只写 pos.leverage 而不动保证金：地板从 5.2494 掉到 2.6247，
    // 于是一笔从没追加过保证金的仓位凭空出现 2.6247 可以从调整保证金弹窗里提走，
    // 而且每提一档就再来一次。释放额与「可减额」是同一笔钱的两种说法。
    const naive = { ...lumia(), leverage: 10 };          // 错误实现
    expect(removableMarginUsd('LUMIAUSDT', naive)).toBeCloseTo(2.6247, 6);

    const correct = plan([lumia()], 10).legs[0].next;     // 正确实现
    expect(removableMarginUsd('LUMIAUSDT', correct)).toBe(0);
  });

  it('【回归】手动追加过的保证金原样留下——地板下降与释放额逐项抵消', () => {
    const S = 40;
    const topped = lumia({ isolatedMargin: N / 5 + S, margin: N / 5 + S });
    expect(removableMarginUsd('LUMIAUSDT', topped)).toBeCloseTo(S, 9);

    const next = plan([topped], 10).legs[0].next;
    expect(next.isolatedMargin).toBeCloseTo(N / 10 + S, 6);
    expect(removableMarginUsd('LUMIAUSDT', next)).toBeCloseTo(S, 9);   // 前后都是 40
  });

  it('币本位：币计保证金按**开仓价**折，不按标记价', () => {
    const r = planLeverageChange({
      symbol: 'BTCUSD', positions: [inverse()], orders: [],
      markPrice: 90_000, currentLeverage: 5, nextLeverage: 10,
    });
    const leg = r.legs[0];
    expect(leg.releaseUsd).toBeCloseTo(70, 9);
    expect(leg.releaseCoin).toBeCloseTo(70 / 60_000, 12);
    expect(leg.next.marginCoin).toBeCloseTo(700 / (60_000 * 10), 12);
    // 若按标记价 90000 折，marginCoin 会是另一个数，而币本位强平价只读它
    expect(leg.next.marginCoin).not.toBeCloseTo(700 / (60_000 * 5) - 70 / 90_000, 9);
    expect(calcLiquidationPrice(leg.next)).toBeCloseTo(54_763.63636363636, 6);
  });

  it('币本位的保证金与价无关——喂任何标记价都是同一个数', () => {
    const a = getSettlementMarginParts('BTCUSD', inverse(), 20_000).marginUsd;
    const b = getSettlementMarginParts('BTCUSD', inverse(), 91_234.5).marginUsd;
    expect(a).toBeCloseTo(140, 9);
    expect(b).toBeCloseTo(140, 9);
  });
});

describe('守卫', () => {
  it('【G1】提到会当场爆仓的杠杆必须拒绝', () => {
    // 标记价 0.075、5x 多单：亏损已经吃掉大半保证金，上限 6.88x
    const p = lumia();
    const cap = maxSafeLeverageForPosition('LUMIAUSDT', p, 0.075);
    expect(cap).toBeCloseTo(6.8819360782368335, 6);

    const r = plan([p], 10, 0.075);
    expect(r.ok).toBe(false);
    expect(r.refusal?.code).toBe('would-liquidate');
  });

  it('【G1】守卫只认 solvent —— 陈价那种「不强平」不是安全的证据', () => {
    // evaluateIsolatedLiquidation 在取不到新鲜价时返回 liquidate:false，
    // 那个偏向对引擎是对的（宁可不强平），对守卫却是**反的**。
    const doomed = plan([lumia()], 10, 0.075);
    const stale = evaluateIsolatedLiquidation({
      symbol: 'LUMIAUSDT', position: { ...lumia(), leverage: 10, isolatedMargin: N / 10, margin: N / 10 },
      price: 0.075, priceAsOf: 0, nowSim: 10_000_000, toleranceMs: 60_000,
    });
    expect(stale.liquidate).toBe(false);
    expect(stale.reason).toBe('stale_price');
    expect(doomed.ok).toBe(false);          // 计划仍然拒绝
  });

  it('【G2】有持仓时只能升不能降', () => {
    const held = lumia({ leverage: 10 });
    const down = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [held], orders: [], markPrice: E,
      currentLeverage: 10, nextLeverage: 5,
    });
    expect(down.ok).toBe(false);
    expect(down.refusal?.code).toBe('below-floor');
    expect(down.floorLeverage).toBe(10);
  });

  it('【G2】没有持仓时可以任意调', () => {
    const r = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [], orders: [], markPrice: E,
      currentLeverage: 10, nextLeverage: 3,
    });
    expect(r.ok).toBe(true);
    expect(r.floorLeverage).toBe(1);
  });

  it('【G3】档位按该标的**总**敞口算，不是单笔', () => {
    // 30 万名义 → 20x 上限
    const big = lumia({ quantity: 300_000 / E, margin: 60_000, isolatedMargin: 60_000 });
    const exposure = symbolExposureNotionalUsd('LUMIAUSDT', [big], [], E);
    expect(exposure).toBeCloseTo(300_000, 0);

    const r = plan([big], 50);
    expect(r.ok).toBe(false);
    expect(r.refusal?.code).toBe('tier-cap');
    expect(r.tierMaxLeverage).toBe(20);
  });

  it('【G3】挂单也计入总敞口——小仓位配大挂单不该放行高杠杆', () => {
    const order = {
      id: 'o1', side: 'LONG', type: 'LIMIT', price: E, stopPrice: 0,
      quantity: 300_000 / E, leverage: 5, marginMode: 'isolated',
      status: 'NEW', createdAt: 0,
    } as unknown as PendingOrder;
    const withOrder = symbolExposureNotionalUsd('LUMIAUSDT', [lumia()], [order], E);
    expect(withOrder).toBeGreaterThan(300_000);
    // 减仓单不计
    const reduce = { ...order, id: 'o2', reduceOnly: true } as PendingOrder;
    expect(symbolExposureNotionalUsd('LUMIAUSDT', [lumia()], [reduce], E)).toBeCloseTo(N, 3);
  });

  it('【G0】有持仓却拿不到价时拒绝——不在自己都不敢担保的价上重述风险', () => {
    const r = plan([lumia()], 10, 0);
    expect(r.ok).toBe(false);
    expect(r.refusal?.code).toBe('no-price');
  });

  it('杠杆没变时不产生任何动作', () => {
    expect(plan([lumia()], 5).refusal?.code).toBe('no-change');
  });
});

describe('全仓与多腿', () => {
  it('全仓仓位同样重述，强平价跟着动', () => {
    const cross = lumia({ marginMode: 'cross', isolatedMargin: undefined });
    const leg = plan([cross], 10).legs[0];
    expect(leg.marginAfter).toBeCloseTo(2.6247, 6);
    expect(leg.liqBefore).toBeCloseTo(0.0702695196, 9);
    expect(leg.liqAfter).toBeCloseTo(0.0790095096, 9);
  });

  it('【回归】混杠杆的旧仓位被一次拉齐——这正是让它们此后能合并的前提', () => {
    const a = lumia({ id: 'a', leverage: 5 });
    const b = lumia({ id: 'b', leverage: 10, margin: N / 10, isolatedMargin: N / 10 });
    const r = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [a, b], orders: [], markPrice: E,
      currentLeverage: 10, nextLeverage: 10,
    });
    // 10x 与当前一致 → no-change；换成 12x 看两腿都被拉齐
    const r2 = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [a, b], orders: [], markPrice: E,
      currentLeverage: 10, nextLeverage: 12,
    });
    expect(r).toBeDefined();
    expect(r2.ok).toBe(true);
    expect(r2.legs.map(l => l.next.leverage)).toEqual([12, 12]);
    expect(r2.floorLeverage).toBe(10);
  });

  it('档位反读：给定杠杆最多能开多少名义', () => {
    expect(maxNotionalForLeverage(125)).toBe(50_000);
    expect(maxNotionalForLeverage(20)).toBe(1_000_000);
  });
});
