import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import { evaluateIsolatedLiquidation } from '@/lib/liquidationGuards';
import { removableMarginUsd } from '@/lib/positionGroupRisk';
import { getSettlementMarginParts } from '@/lib/tradingSettlement';
import { maxPositionAtLeverage, resolveSymbolTiers } from '@/lib/leverageTiers';
import {
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

  it('【G3】档位按该标的**总**敞口算，不是单笔——用的是 LUMIAUSDT 自己的币安分层', () => {
    // LUMIAUSDT 分层：0–1 万 10x、1–6 万 5x、6–7 万 4x、7–25 万 3x、25–250 万 2x……
    // 30 万名义落在 25–250 万那一档 → 最高 2x
    // 2x 开的仓：降回 2x 是走得通的，照币安的话说「请调低杠杆倍数至 2x 以下」
    const big = lumia({ quantity: 300_000 / E, leverage: 2, margin: 150_000, isolatedMargin: 150_000 });
    const exposure = symbolExposureNotionalUsd('LUMIAUSDT', [big], [], E);
    expect(exposure).toBeCloseTo(300_000, 0);

    const r = plan([big], 50, E, [], 2);
    expect(r.to).toBe(10);                     // 滑块之外的 50x 也被夹到合约最高 10x
    expect(r.ok).toBe(false);
    expect(r.refusal?.code).toBe('tier-cap');
    expect(r.refusal?.message).toContain('请调低杠杆倍数至 2x 以下');
    expect(r.tierMaxLeverage).toBe(2);
    expect(r.tierCap).toBe(10_000);            // 10x 最高可持有头寸
    expect(r.tierUnit).toBe('USDT');
  });

  it('【复核】同样 30 万、但仓位是 5x 开的：逐仓不能降到 2x——不再叫人「调低杠杆倍数至 2x」，而是说只能减仓', () => {
    const big = lumia({ quantity: 300_000 / E, margin: 60_000, isolatedMargin: 60_000 });
    const r = plan([big], 50);
    expect(r.ok).toBe(false);
    expect(r.refusal?.code).toBe('exposure-over-cap');
    expect(r.refusal?.message).not.toContain('请调低杠杆倍数至 2x');
    expect(r.refusal?.message).toContain('调整杠杆解决不了');
    expect(r.refusal?.message).toContain('5x 最高 60,000 USDT');
    expect(r.refusal?.message).toContain('逐仓有持仓时不能降杠杆（当前最低 5x）');
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
    // LUMIAUSDT 最高 10x（币安分层），所以两腿取 5x 与 8x、拉齐到 10x
    const a = lumia({ id: 'a', leverage: 5 });
    const b = lumia({ id: 'b', leverage: 8, margin: N / 8, isolatedMargin: N / 8 });
    const r = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [a, b], orders: [], markPrice: E,
      currentLeverage: 8, nextLeverage: 8,
    });
    // 8x 与当前一致 → no-change；换成 10x 看两腿都被拉齐
    const r2 = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [a, b], orders: [], markPrice: E,
      currentLeverage: 8, nextLeverage: 10,
    });
    expect(r.refusal?.code).toBe('no-change');
    expect(r2.ok).toBe(true);
    expect(r2.legs.map(l => l.next.leverage)).toEqual([10, 10]);
    expect(r2.floorLeverage).toBe(8);
  });

  it('档位反读：给定杠杆最多能持有多少——按合约分层，不再是一张通用表', () => {
    const lumiaTiers = resolveSymbolTiers('LUMIAUSDT', 'usdt').tiers;
    expect(maxPositionAtLeverage(lumiaTiers, 10)).toBe(10_000);
    expect(maxPositionAtLeverage(lumiaTiers, 5)).toBe(60_000);
    expect(maxPositionAtLeverage(lumiaTiers, 11)).toBe(0);
    const r = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [], orders: [], markPrice: E,
      currentLeverage: 3, nextLeverage: 5, settlementMode: 'usdt',
    });
    expect(r.ok).toBe(true);
    expect(r.symbolMaxLeverage).toBe(10);
    expect(r.tierCap).toBe(60_000);
    expect(r.tierMaxNotionalUsd).toBe(60_000);
  });
});

describe('旧版本留下的超上限挂单', () => {
  const kaitoOrder = (leverage: number): PendingOrder => ({
    id: `old-${leverage}`, side: 'LONG', type: 'LIMIT', price: 0.9, stopPrice: 0, quantity: 100, leverage,
    marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: 1,
  } as PendingOrder);
  const kaitoPlan = (orders: PendingOrder[], from: number, to: number) => planLeverageChange({
    symbol: 'KAITOUSDT', positions: [], orders, markPrice: 1, currentLeverage: from, nextLeverage: to, settlementMode: 'usdt',
  });

  it('保存的 125x 读成 75x、挂单还是 125x：在 75x 上确认不是「杠杆未变」，挂单被拉回 75x', () => {
    const r = kaitoPlan([kaitoOrder(125)], 75, 75);
    expect(r).toMatchObject({ ok: true, refusal: null, to: 75, restatedOrderIds: ['old-125'] });
  });

  it('挂单杠杆没超过合约上限时，杠杆没变仍是 no-change', () => {
    expect(kaitoPlan([kaitoOrder(50)], 75, 75).refusal?.code).toBe('no-change');
    expect(kaitoPlan([], 75, 75).refusal?.code).toBe('no-change');
  });

  it('只减仓的旧单不算（它不开仓，杠杆只是元数据）', () => {
    const reduce = { ...kaitoOrder(125), reduceOnly: true } as PendingOrder;
    expect(kaitoPlan([reduce], 75, 75).refusal?.code).toBe('no-change');
  });
});

describe('【复核】现有仓位已超过它自己杠杆的上限：对话框说清出路', () => {
  /** 更新前按 35x 开的 20,000 KAITO：旧通用表允许，新分层 35x 最多 10,000。没有分层戳。 */
  const legacyKaito = {
    id: 'k1', side: 'LONG', quantity: 20_000, entryPrice: 1, leverage: 35, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', margin: 20_000 / 35, isolatedMargin: 20_000 / 35, openTime: 1_000,
  } as Position;
  const kaito = (to: number, from = 35) => planLeverageChange({
    symbol: 'KAITOUSDT', positions: [legacyKaito], orders: [], markPrice: 1,
    currentLeverage: from, nextLeverage: to, settlementMode: 'usdt',
  });
  const stuck = '只能先减仓或撤单，把总量降到 10,000 USDT 以下再开新单';

  it('降到 25x：仍是「只能提高杠杆」，但补一句提高也没用、只能减仓', () => {
    const r = kaito(25);
    expect(r.refusal?.code).toBe('below-floor');
    expect(r.refusal?.message).toContain('逐仓有持仓时只能提高杠杆，当前最低 35x');
    expect(r.refusal?.message).toContain('调整杠杆解决不了');
    expect(r.refusal?.message).toContain(stuck);
  });

  it('提到 40x：不再叫人「调低杠杆倍数至 25x」（逐仓降不下去），而是只能减仓', () => {
    const r = kaito(40);
    expect(r.refusal?.code).toBe('exposure-over-cap');
    expect(r.refusal?.message).not.toContain('请调低杠杆倍数至 25x');
    expect(r.refusal?.message).toContain('（含更新前按旧规则开的仓位）');
    expect(r.refusal?.message).toContain(stuck);
  });

  it('停在当前的 35x：不是「杠杆未变」，而是把这个死局摆出来（确认键置灰）', () => {
    const r = kaito(35);
    expect(r.ok).toBe(false);
    expect(r.refusal?.code).toBe('exposure-over-cap');
    expect(r.refusal?.message).toContain(stuck);
  });

  it('仓位还在上限之内时，这几条都照旧', () => {
    const small = { ...legacyKaito, quantity: 5_000, margin: 5_000 / 35, isolatedMargin: 5_000 / 35 } as Position;
    const r = (to: number) => planLeverageChange({
      symbol: 'KAITOUSDT', positions: [small], orders: [], markPrice: 1,
      currentLeverage: 35, nextLeverage: to, settlementMode: 'usdt',
    });
    expect(r(35).refusal?.code).toBe('no-change');
    expect(r(25).refusal?.message).toBe('逐仓有持仓时只能提高杠杆，当前最低 35x');
    expect(r(40).ok).toBe(true);
  });

  it('LUMIAUSDT（最高 10x）上更新前按 35x 开的小仓位：说清平仓前杠杆调不了、新单最高 10x', () => {
    const legacyLumia = lumia({ leverage: 35, margin: N / 35, isolatedMargin: N / 35 });
    const r = planLeverageChange({
      symbol: 'LUMIAUSDT', positions: [legacyLumia], orders: [], markPrice: E,
      currentLeverage: 35, nextLeverage: 10, settlementMode: 'usdt',
    });
    expect(r.refusal?.code).toBe('below-floor');
    expect(r.refusal?.message).toBe(
      '逐仓有持仓时不能降杠杆：现有仓位按 35x 开（高于该合约现在的最高杠杆 10x，是更新前按旧规则开的），'
      + '平仓前无法调整杠杆；新单最高只能用 10x',
    );
  });
});
