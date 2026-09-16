import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attributeAddExcess, computePlanBCoverageAtS1, evaluatePostFillAddSizing, sizeAddAtExpectedFill } from '@/lib/addSizing';
import { evaluateMarketAddFill, judgeMarketAddFill, judgePlannedAddFill } from '@/lib/addSizingFillGuard';
import { executeSettlementFill } from '@/lib/tradingSettlement';
import {
  ADD_SIZING_PLAN_TTL_MS,
  __resetAddSizingPlanForTests,
  consumeAddSizingPlan,
  consumeAddSizingPrefill,
  getAddSizingPlan,
  getFreshAddSizingPlan,
  peekAddSizingSnapshotForOrder,
  publishAddSizingPlan,
  requestAddSizingPrefill,
  restoreAddSizingPlan,
  takeAddSizingSnapshotForOrder,
  touchAddSizingPlan,
  clearAddSizingPlan as clearAddSizingPlanFor,
} from '@/lib/addSizingPlan';
import { __resetNotificationCenterForTests, getNotificationSnapshot } from '@/lib/notificationCenter';
import { calcSlippage, type AddSizingSnapshot, type PendingOrder, type Position, type TradeRecord } from '@/types/trading';

/**
 * COMMONUSDT 加仓 1（PNG 上的数）：主力 10,346,400 USD @0.006974，镜像止盈落袋 55,994,538.5 COMMON，
 * S₁ 0.007069；用户按计算器上限下了 653,602 张，引擎按 0.01% + 名义/50亿 成交在 0.0077123（+0.14%），
 * Legs 判超限 1.57%。成交那一刻就该说出来，而不是等到战役页。
 */
const FACE = 10;
const S_BAR = 0.006974;
const X1 = 10_346_400 / S_BAR;
const G_COIN = 55_994_538.5;
const S1 = 0.007069;
const FILL = 0.0077123;
const NOTIONAL = 6_536_020;
const REF = FILL / (1 + 0.0001 + NOTIONAL / 5e9);
const ADD_COINS = NOTIONAL / FILL;
const T0 = Date.parse('2026-09-01T10:00:00+08:00');
const MIN = 60_000;

/** 计算器在基准价 REF 上的两档计划：市价（含滑点）643,648 张 / 限价（旧版行为）653,615 张。 */
const COVERAGE = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, s2: REF, x1: X1, g: G_COIN })!.available;
const MARKET_PLAN = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage: COVERAGE, s1: S1, s2Ref: REF, orderKind: 'market', contractFaceUsd: FACE })!;
const LIMIT_PLAN = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage: COVERAGE, s1: S1, s2Ref: REF, orderKind: 'limit', contractFaceUsd: FACE })!;
const snapshotOf = (plan: typeof MARKET_PLAN, over: Partial<AddSizingSnapshot> = {}): AddSizingSnapshot => ({
  at: T0, plan: 'B', side: 'LONG', settlement: 'coin', s1: S1, s2Ref: REF, s2Fill: plan.s2Fill, slippagePct: plan.slippagePct,
  x1: X1, sBar: S_BAR, g: G_COIN, gUnit: 'COMMON', addCoinsMax: plan.addCoinsMax, contracts: plan.contracts, orderKind: plan.orderKind,
  ...over,
});
/** 按张下单 → 引擎在基准价上按名义加滑点成交。 */
const marketFill = (contracts: number, base = REF) => {
  const notional = contracts * FACE;
  const fill = calcSlippage(base, notional, 'LONG');
  return { fill, addCoins: notional / fill };
};

describe('evaluatePostFillAddSizing · 按实际成交价复判', () => {
  it('【回归】COMMONUSDT 加仓 1（没有计划 = 按参考价、不计滑点定的量）：按成交价上限 834,391,899，超出 +1.57%，超出部分全部来自滑点 +0.14%', () => {
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: REF, s2Fill: FILL, addCoins: ADD_COINS, contractFaceUsd: FACE,
    })!;
    expect(v.overLimit).toBe(true);
    expect(Math.abs(v.limitAtFill / 834_391_899 - 1)).toBeLessThan(1e-4);
    expect(v.overshootPct).toBeCloseTo(1.57, 2);
    expect(v.slippagePct).toBeCloseTo(0.1407, 3);
    expect(v.excessCoins).toBeCloseTo(ADD_COINS - v.limitAtFill, 6);
    // 减掉这么多张就回到上限之内：进一，绝不少减
    expect(v.excessContracts).toBe(Math.ceil((v.excessCoins * FILL) / FACE - 1e-9));
    expect(v.excessContracts! * FACE / FILL).toBeGreaterThanOrEqual(v.excessCoins - 1e-6);
    expect(v.excessContracts).toBeGreaterThan(10_000);
    expect(v.excessContracts).toBeLessThan(10_200);
    // 参考价上限 ≈ 848.7M 容得下实际的 847.5M：超出的那一截全部来自成交滑点
    expect(v.limitAtRef).toBeGreaterThan(ADD_COINS);
    expect(v.attribution?.cause).toBe('slippage');
    expect(v.attribution?.unexpectedSlippagePct).toBeCloseTo(0.1407, 3);
    expect(v.attribution?.priceDriftPct).toBe(0);
    expect(v.slippageOvershootPct).toBeCloseTo((v.limitAtRef / v.limitAtFill - 1) * 100, 9);
    expect(v.slippageOvershootPct).toBeGreaterThan(1.5);
    expect(v.amplification).toBeCloseTo(S1 / (FILL - S1), 9);
    // 与计算器同一条式子：成交价上的上限就是 computePlanBCoverageAtS1 在成交价上的 addCoinsMax
    const plan = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, s2: FILL, x1: X1, g: G_COIN })!;
    expect(v.limitAtFill).toBe(plan.addCoinsMax);
  });

  it('量在上限之内：不超限，超出为 0，张数为 0', () => {
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: REF, s2Fill: FILL, addCoins: 834_391_899 * 0.99, contractFaceUsd: FACE,
    })!;
    expect(v.overLimit).toBe(false);
    expect(v.overshootPct).toBe(0);
    expect(v.excessCoins).toBe(0);
    expect(v.excessContracts).toBe(0);
  });

  it('实际量超过参考价的上限：超出不只是滑点，归因为量本身', () => {
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: REF, s2Fill: FILL, addCoins: ADD_COINS * 1.1, contractFaceUsd: FACE,
    })!;
    expect(v.overLimit).toBe(true);
    expect(v.attribution?.cause).toBe('oversize');
  });

  /**
   * 【回归 · 复审】带着市价计划（已按 S₂′ 计入 +0.14% 的滑点、上限 643,648 张）下单时，
   * 「全部来自滑点」必须对照**计划的价**判，不能对照不含滑点的参考价——否则多下的量全被算成滑点。
   */
  it('【回归】市价计划 643,648 张，实际下 650,084 张（+1%）：成交只比预计差 0.0013%，归因是量超了计划 +1.00%，不是滑点', () => {
    expect(MARKET_PLAN.contracts).toBe(643_648);
    const { fill, addCoins } = marketFill(650_084);
    expect(Math.abs(fill / MARKET_PLAN.s2Fill - 1)).toBeLessThan(2e-5);
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: REF, s2Fill: fill, addCoins, contractFaceUsd: FACE, plan: snapshotOf(MARKET_PLAN),
    })!;
    expect(v.overLimit).toBe(true);
    expect(v.overshootPct).toBeCloseTo(1.01, 2);
    expect(v.attribution!.cause).toBe('oversize');
    expect(v.attribution!.planOvershootPct).toBeCloseTo(1.0, 2);
    // 同一笔量，若计划是限价档（不计滑点，上限 653,615 张），那超出确实全部来自市价单的滑点
    const limitPlan = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: REF, s2Fill: fill, addCoins, contractFaceUsd: FACE, plan: snapshotOf(LIMIT_PLAN),
    })!;
    expect(limitPlan.attribution!.cause).toBe('slippage');
    expect(limitPlan.attribution!.unexpectedSlippagePct).toBeCloseTo(0.14, 2);
  });

  /**
   * 【回归 · 三审】下单前基准价朝有利方向走了 0.3%，用户却下了比计划多 3.4% 的量：按下单价、计入计划预计的滑点，
   * 这个量恰好还容得下（anchor 上的上限跟着变宽），但它比计算器的上限大——多下的量自己把滑点推高，
   * 超出来自量，不是滑点。旧判据只看 anchor，会说「超出部分全部来自成交滑点」。
   */
  it('【回归 · 三审】有利价格变动后下了比计划大的量：归因是量超了计算器的上限 +3.39%，不点名滑点', () => {
    const base = REF * 0.997;
    const { fill, addCoins } = marketFill(665_500, base);
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: base, s2Fill: fill, addCoins, contractFaceUsd: FACE, plan: snapshotOf(MARKET_PLAN),
    })!;
    expect(v.overLimit).toBe(true);
    const a = v.attribution!;
    // 旧判据的前提仍在：按下单价 × 计划预计的滑点，这个量是合规的
    expect(a.priceDriftPct).toBeCloseTo(-0.3, 9);
    expect(a.limitAtAnchor).toBeGreaterThan(a.coinsAtPlan * (MARKET_PLAN.s2Fill / a.anchorPrice));
    expect(a.withinPlanLimit).toBe(false);
    expect(a.cause).toBe('oversize');
    // 按计算器自己的上限（计划价上的币数）报超出：665,500 ÷ 643,648.x 张
    expect(a.planOvershootPct).toBeCloseTo((a.coinsAtPlan / MARKET_PLAN.addCoinsMax - 1) * 100, 9);
    expect(a.planOvershootPct).toBeCloseTo(3.39, 2);
    // 同样的有利变动、按计划整张下：在自己的成交价上合规，没有归因
    const ok = marketFill(MARKET_PLAN.contracts!, base);
    expect(evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: base, s2Fill: ok.fill, addCoins: ok.addCoins, contractFaceUsd: FACE, plan: snapshotOf(MARKET_PLAN),
    })!.overLimit).toBe(false);
  });

  it('按市价计划的整张下单、基准价在下单前又涨了 0.2%：归因是计算后的价格变动，不是滑点', () => {
    const base = REF * 1.002;
    const { fill, addCoins } = marketFill(MARKET_PLAN.contracts!, base);
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: base, s2Fill: fill, addCoins, contractFaceUsd: FACE, plan: snapshotOf(MARKET_PLAN),
    })!;
    expect(v.overLimit).toBe(true);
    expect(v.overshootPct).toBeCloseTo(2.19, 2);
    expect(v.attribution!.cause).toBe('price_drift');
    expect(v.attribution!.priceDriftPct).toBeCloseTo(0.2, 9);
    // 这张单自己的滑点与计划预计的一致
    expect(Math.abs(v.attribution!.unexpectedSlippagePct)).toBeLessThan(1e-4);
    expect(v.attribution!.limitAtAnchor).toBeLessThan(MARKET_PLAN.addCoinsMax);
  });

  it('按市价计划的整张下单、基准价没动：在自己的成交价上合规，没有归因', () => {
    const { fill, addCoins } = marketFill(MARKET_PLAN.contracts!);
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: REF, s2Fill: fill, addCoins, contractFaceUsd: FACE, plan: snapshotOf(MARKET_PLAN),
    })!;
    expect(v.overLimit).toBe(false);
    expect(v.attribution).toBeNull();
  });

  it('量在计算器的上限之内、按这里读到的输入却超了：归因为输入不一致', () => {
    // 计算器当时按一条更宽的 S₁ 给了更大的上限；成交时盘口线是 S1
    const wide = snapshotOf(LIMIT_PLAN, { addCoinsMax: LIMIT_PLAN.addCoinsMax * 1.2 });
    const addCoins = LIMIT_PLAN.addCoinsMax * 1.1;
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, x1: X1, g: G_COIN,
      s2Ref: REF, s2Fill: REF, addCoins, contractFaceUsd: FACE, plan: wide,
    })!;
    expect(v.overLimit).toBe(true);
    expect(v.attribution!.cause).toBe('inputs');
  });

  it('【回归 · 复审】Y₁ + G 为负时与 Legs 同一判据：缺口 = 最大亏损 − (Y₁ + G)，小额加仓也判超限', () => {
    // 主多 10 @100、S₁ 99（旧仓在 S₁ 亏 10）、G = 0 → 可用 −10；加 0.001 币 @110，最大亏损只有 0.011
    const v = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'usdt', sBar: 100, s1: 99, x1: 10, g: 0, s2Ref: 110, s2Fill: 110, addCoins: 0.001,
    })!;
    expect(v.limitAtFill).toBe(0);
    expect(v.overLimit).toBe(true);
    expect(v.overshootPct).toBe(Number.POSITIVE_INFINITY);
    expect(v.excessCoins).toBeCloseTo(0.001, 12);
  });

  it('attributeAddExcess：价不全返回 null；限价计划的下单价是挂单价 S₂′，市价计划的是 S₂', () => {
    const always = { coinsAt: () => 1, limitAt: () => 1, fitsAt: () => true };
    expect(attributeAddExcess({ plan: { s2Ref: 0, s2Fill: 1, orderKind: 'market' }, fillPrice: 1, ...always })).toBeNull();
    const limit = attributeAddExcess({ plan: { s2Ref: 100.4, s2Fill: 100, orderKind: 'limit' }, fillPrice: 100.2, ...always })!;
    expect(limit.planOrderPrice).toBe(100);
    expect(limit.anchorPrice).toBe(100);
    expect(limit.cause).toBe('slippage');
    const market = attributeAddExcess({ plan: { s2Ref: 100, s2Fill: 100.2, orderKind: 'market', s2AtOrder: 101 }, fillPrice: 101.3, ...always })!;
    expect(market.planOrderPrice).toBe(100);
    expect(market.anchorPrice).toBeCloseTo(101 * 1.002, 9);
    expect(market.priceDriftPct).toBeCloseTo(1, 9);
    // 计划带着计算器的上限：量在上限之内才点名滑点；比上限大就是量超了，超出按计算器的上限报（判定方的上限再宽也不拿它算）
    const planned = { s2Ref: 100, s2Fill: 100.2, orderKind: 'market' as const, addCoinsMax: 100 };
    const within = attributeAddExcess({ plan: planned, fillPrice: 100.5, ...always, coinsAt: () => 100 })!;
    expect(within.withinPlanLimit).toBe(true);
    expect(within.cause).toBe('slippage');
    const bigger = attributeAddExcess({ plan: planned, fillPrice: 100.5, ...always, coinsAt: () => 105, limitAt: () => 200 })!;
    expect(bigger.withinPlanLimit).toBe(false);
    expect(bigger.cause).toBe('oversize');
    expect(bigger.planOvershootPct).toBeCloseTo(5, 9);
    // 没带上限：按判定方在计划价上的上限
    const noMax = attributeAddExcess({ plan: { ...planned, addCoinsMax: null }, fillPrice: 100.5, ...always, coinsAt: () => 105, limitAt: () => 100 })!;
    expect(noMax.cause).toBe('slippage');
    expect(noMax.planOvershootPct).toBeCloseTo(5, 9);
  });

  it('U 本位：张数为 null；主空符号翻转；没有风险距离或无效输入返回 null', () => {
    const long = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'usdt', sBar: 100, s1: 110, x1: 10, g: 0, s2Ref: 120, s2Fill: 120.5, addCoins: 12,
    })!;
    expect(long.excessContracts).toBeNull();
    // Y₁ = 10 × 10 = 100；每币风险 10.5 → 上限 9.52；实际 12 超限
    expect(long.limitAtFill).toBeCloseTo(100 / 10.5, 9);
    expect(long.overLimit).toBe(true);
    const short = evaluatePostFillAddSizing({
      side: 'SHORT', settlement: 'usdt', sBar: 120, s1: 110, x1: 10, g: 0, s2Ref: 100, s2Fill: 99.5, addCoins: 9,
    })!;
    expect(short.limitAtFill).toBeCloseTo(100 / 10.5, 9);
    expect(short.slippagePct).toBeLessThan(0);
    expect(short.overLimit).toBe(false);
    expect(evaluatePostFillAddSizing({ side: 'LONG', settlement: 'usdt', sBar: 100, s1: 110, x1: 10, g: 0, s2Ref: 120, s2Fill: 105, addCoins: 1 })).toBeNull();
    expect(evaluatePostFillAddSizing({ side: 'LONG', settlement: 'usdt', sBar: 100, s1: 110, x1: 10, g: 0, s2Ref: 120, s2Fill: 121, addCoins: 0 })).toBeNull();
  });
});

/** 盘面：COMMONUSDT 币本位主力 1,034,640 张 @0.006974，镜像止盈 12 分钟后落袋，空单对冲线挂在 0.007069。 */
const heldMain = (over: Partial<Position> = {}): Position => ({
  id: 'main', side: 'LONG', entryPrice: S_BAR, quantity: 1_034_640, contracts: 1_034_640, leverage: 5, marginMode: 'isolated',
  settlementMode: 'coin', settlementAsset: 'COMMON', contractSizeUsd: FACE, margin: 2_069_280, openTime: T0,
  ...over,
});
const hedgeLine = (price: number, over: Partial<PendingOrder> = {}): PendingOrder => ({
  id: `hedge-${price}`, side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: price, quantity: 1_000_000, contracts: 1_000_000,
  leverage: 5, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'COMMON', contractSizeUsd: FACE,
  status: 'PENDING', createdAt: T0 + 60 * MIN,
  ...over,
});
const mirrorTp: TradeRecord = {
  id: 'tp1', symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: S_BAR, exitPrice: 0.00715401,
  quantity: 1_551_960, contracts: 1_551_960, leverage: 5, pnl: G_COIN * 0.00715401, pnlCoin: G_COIN, fee: 0, slippage: 0,
  openTime: T0, closeTime: T0 + 12 * MIN, exit_method: 'tp1', settlementMode: 'coin', settlementAsset: 'COMMON', contractSizeUsd: FACE,
};
/** 默认：计算器在限价档（旧版行为，不计滑点）给出 653,615 张的计划，用户按它下了 653,602 张市价单。 */
const guardInput = (over: Partial<Parameters<typeof evaluateMarketAddFill>[0]> = {}) => ({
  symbol: 'COMMONUSDT', side: 'LONG' as const, fillPrice: FILL, referencePrice: REF, addCoins: ADD_COINS,
  heldBefore: [heldMain()], ordersMap: { COMMONUSDT: [hedgeLine(S1)] }, tradeHistory: [mirrorTp], settlement: 'coin' as const,
  snapshot: snapshotOf(LIMIT_PLAN) as AddSizingSnapshot | null,
  ...over,
});

describe('addSizingFillGuard · 市价加仓成交后的复判', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetNotificationCenterForTests();
  });
  afterEach(() => {
    __resetNotificationCenterForTests();
  });

  it('【回归】COMMONUSDT 加仓 1（限价档计划、市价成交）：读盘口线 S₁ 0.007069、本场 G、成交前的 X₁ / S̄，判超限 +1.57%，话里写成交价 / 参考价 / 滑点 / 超出币与张', () => {
    const v = evaluateMarketAddFill(guardInput())!;
    expect(v).not.toBeNull();
    expect(v.s1).toBe(S1);
    expect(v.s1Source).toBe('book');
    expect(v.x1).toBeCloseTo(X1, 3);
    expect(v.sBar).toBeCloseTo(S_BAR, 12);
    expect(v.g).toBeCloseTo(G_COIN, 6);
    expect(v.gUnit).toBe('COMMON');
    expect(v.overLimit).toBe(true);
    expect(v.overshootPct).toBeCloseTo(1.57, 2);
    expect(v.message).not.toBeNull();
    expect(v.message!.title).toContain('超出 Plan B 上限 +1.57%');
    const text = v.message!.description;
    expect(text).toContain('成交 0.00771230');
    expect(text).toContain('参考价 0.00770146');
    expect(text).toContain('滑点 +0.14%');
    expect(text).toMatch(/超出 13,0\d\d,\d{3}(\.\d+)? COMMON（10,\d{3} 张）——减掉这么多即回到上限之内/);
    // 限价计划配吃单成交：点名滑点，并说清这类单子该用哪一档定量（市价单、条件委托触发后都是吃单）
    expect(text).toContain('超出部分全部来自成交滑点 +0.14%（计划按限价 @S₂、不计滑点，这张却是吃单成交——市价单、条件委托触发后都按市价成交；这类单子该用计算器的「市价」或「条件单 @S₂」档定量）');
    expect(text).toContain('S₁ 0.00706900（盘口对冲线）');
  });

  it('【回归 · 复审】市价计划 643,648 张、实际 650,084 张：成交与预计只差 0.0013%，话里说量超了计划 +1.00%，不说滑点', () => {
    const { fill, addCoins } = marketFill(650_084);
    const v = evaluateMarketAddFill(guardInput({ fillPrice: fill, addCoins, snapshot: snapshotOf(MARKET_PLAN) }))!;
    expect(v.overLimit).toBe(true);
    expect(v.message!.title).toBe('加仓成交后复判：超出 Plan B 上限 +1.01%');
    expect(v.message!.description).toContain('实际加仓比计算器的上限多 +1.00%——超出来自仓位本身，不是滑点。');
    expect(v.message!.description).not.toContain('全部来自成交滑点');
    // 按计划整张下：不发消息
    const ok = marketFill(MARKET_PLAN.contracts!);
    expect(evaluateMarketAddFill(guardInput({ fillPrice: ok.fill, addCoins: ok.addCoins, snapshot: snapshotOf(MARKET_PLAN) }))!.message).toBeNull();
  });

  it('【回归 · 三审】基准价先跌 0.3%、再下比计划多 3.4% 的量：话里说量超了计算器的上限，不说「全部来自成交滑点」', () => {
    const base = REF * 0.997;
    const { fill, addCoins } = marketFill(665_500, base);
    const v = evaluateMarketAddFill(guardInput({ fillPrice: fill, referencePrice: base, addCoins, snapshot: snapshotOf(MARKET_PLAN) }))!;
    expect(v.overLimit).toBe(true);
    const text = v.message!.description;
    expect(text).toMatch(/实际加仓比计算器的上限多 \+3\.39%——超出来自仓位本身，不是滑点。/);
    expect(text).not.toContain('全部来自成交滑点');
    expect(text).not.toContain('计算后的价格变动');
  });

  it('按计划整张下单、但基准价在关掉计算器后涨了 0.2%：话里说计算后的价格变动，不说滑点', () => {
    const base = REF * 1.002;
    const { fill, addCoins } = marketFill(MARKET_PLAN.contracts!, base);
    const v = evaluateMarketAddFill(guardInput({ fillPrice: fill, referencePrice: base, addCoins, snapshot: snapshotOf(MARKET_PLAN) }))!;
    expect(v.message!.description).toContain('超出来自计算后的价格变动 +0.20%（计算时 0.00770146）');
    expect(v.message!.description).toContain('下单前该按新价重算');
    expect(v.message!.description).not.toContain('全部来自成交滑点');
  });

  it('【回归 · 复审】只判计算器那一侧：没有计划、或计划方向不同（对冲侧加码 / 镜像腿），一律静默', () => {
    expect(evaluateMarketAddFill(guardInput({ snapshot: null }))).toBeNull();
    expect(evaluateMarketAddFill(guardInput({ snapshot: undefined }))).toBeNull();
    // 主多持仓 + 空头对冲：再市价加空，带着的是多头计划 → 不判
    const hedgeAdd = guardInput({
      side: 'SHORT', heldBefore: [heldMain(), heldMain({ id: 'hedge', side: 'SHORT' })],
      ordersMap: { COMMONUSDT: [hedgeLine(0.0079, { side: 'LONG' })] },
    });
    expect(evaluateMarketAddFill(hedgeAdd)).toBeNull();
    judgeMarketAddFill(hedgeAdd);
    judgeMarketAddFill(guardInput({ snapshot: null }));
    expect(getNotificationSnapshot().entries).toHaveLength(0);
  });

  it('上限为 0 时标题说「上限为 0」，不写「超出 +∞%」', () => {
    // S₁ 挂在成本线下方且没有落袋：可用垫为负，上限 0
    const v = evaluateMarketAddFill(guardInput({ ordersMap: { COMMONUSDT: [hedgeLine(0.0069)] }, tradeHistory: [] }))!;
    expect(v.limitAtFill).toBe(0);
    expect(v.message!.title).toBe('加仓成交后复判：Plan B 上限为 0，这一刀没有覆盖');
    expect(v.message!.title).not.toContain('∞');
  });

  it('首笔开仓 / 只有反向持仓：没有同向持仓就静默，连盘面都不读（带着计划也一样）', () => {
    expect(evaluateMarketAddFill(guardInput({ heldBefore: [] }))).toBeNull();
    expect(evaluateMarketAddFill(guardInput({ heldBefore: [heldMain({ side: 'SHORT' })] }))).toBeNull();
    expect(evaluateMarketAddFill(guardInput({ heldBefore: undefined }))).toBeNull();
  });

  it('量在上限之内：有判定、没有消息', () => {
    const v = evaluateMarketAddFill(guardInput({ addCoins: 834_391_899 * 0.98 }))!;
    expect(v.overLimit).toBe(false);
    expect(v.message).toBeNull();
  });

  it('盘口没有亏损侧的反向委托：退到计划里的 S₁；计划里也没有就不判', () => {
    const snapshot = snapshotOf(LIMIT_PLAN);
    expect(evaluateMarketAddFill(guardInput({ ordersMap: {}, snapshot: { ...snapshot, s1: 0 } }))).toBeNull();
    const v = evaluateMarketAddFill(guardInput({ ordersMap: {}, snapshot }))!;
    expect(v.s1).toBe(S1);
    expect(v.s1Source).toBe('snapshot');
    expect(v.message!.description).toContain('（计划里的 S₁）');
    // 盘口线离成交价更近的那条优先（与 Legs 校验同规则）
    const nearer = evaluateMarketAddFill(guardInput({ ordersMap: { COMMONUSDT: [hedgeLine(S1), hedgeLine(0.0072)] }, snapshot }))!;
    expect(nearer.s1).toBe(0.0072);
    expect(nearer.s1Source).toBe('book');
  });

  it('judgeMarketAddFill：超限进消息中心（warning 一级）；不超限、没持仓时什么都不发', () => {
    judgeMarketAddFill(guardInput({ heldBefore: [] }));
    judgeMarketAddFill(guardInput({ addCoins: 834_391_899 * 0.98 }));
    expect(getNotificationSnapshot().entries).toHaveLength(0);
    const verdict = judgeMarketAddFill(guardInput())!;
    const entries = getNotificationSnapshot().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warning');
    expect(entries[0].title).toBe(verdict.message!.title);
    expect(entries[0].description).toBe(verdict.message!.description);
  });

  it('judgeMarketAddFill 从不抛错：盘面坏了也只记一条 console.error，单子不受影响', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = guardInput({ heldBefore: [heldMain({ entryPrice: Number.NaN })] });
    expect(() => judgeMarketAddFill(bad)).not.toThrow();
    spy.mockRestore();
  });
});

/**
 * 【回归 · 三审】条件委托触发后在触发价上按 Taker 滑点成交（Index.createTriggeredConditionalPosition 与后台撮合都传 isMaker = false）。
 * 以前复判只挂在市价 / 最优价上：按「限价 @S₂」定量的突破条件单触发后超限，成交那一刻没人说，要到 Legs 才见红叉。
 * 现在三条吃单成交路径都走 judgePlannedAddFill，参考价取触发价。
 */
describe('addSizingFillGuard · 条件委托触发后的复判（judgePlannedAddFill）', () => {
  const TRIGGER = 0.0077015;
  const coverageAtTrigger = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, s2: TRIGGER, x1: X1, g: G_COIN })!.available;
  const planAt = (kind: 'limit' | 'conditional') =>
    sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage: coverageAtTrigger, s1: S1, s2Ref: TRIGGER, orderKind: kind, contractFaceUsd: FACE })!;
  const snapAt = (kind: 'limit' | 'conditional'): AddSizingSnapshot => {
    const p = planAt(kind);
    return snapshotOf(p, { s2Ref: TRIGGER, s2AtOrder: TRIGGER });
  };
  /** 一张带着计划的条件单在触发价上被引擎成交（与 Index 的条件单触发同一个调用）。 */
  const trigger = (contracts: number, snapshot: AddSizingSnapshot) => executeSettlementFill('COMMONUSDT', TRIGGER, {
    side: 'LONG', quantity: contracts, contracts, leverage: 5, marginMode: 'isolated',
    settlementMode: 'coin', settlementAsset: 'COMMON', contractSizeUsd: FACE, addSizingSnapshot: snapshot,
  }, false, T0 + 90 * MIN, T0 + 90 * MIN).position;
  const input = (position: Position, snapshot: AddSizingSnapshot | null) => ({
    symbol: 'COMMONUSDT', position, referencePrice: TRIGGER, heldBefore: [heldMain()],
    ordersMap: { COMMONUSDT: [hedgeLine(S1)] }, tradeHistory: [mirrorTp], snapshot,
  });

  beforeEach(() => {
    localStorage.clear();
    __resetNotificationCenterForTests();
  });
  afterEach(() => { __resetNotificationCenterForTests(); });

  it('COMMONUSDT：按「限价 @S₂」定的 653,579 张挂成条件单，触发后成交 0.0077123（+0.14%）→ 超 +1.57%、多 ≈10,1xx 张，点名滑点并进消息中心', () => {
    const limit = planAt('limit');
    expect(limit.contracts).toBe(653_579);
    const snapshot = snapAt('limit');
    const position = trigger(limit.contracts!, snapshot);
    expect(position.entryPrice).toBeCloseTo(0.0077123372, 9);
    expect(position.addSizingSnapshot).toBe(snapshot);
    const v = judgePlannedAddFill(input(position, snapshot))!;
    expect(v.overLimit).toBe(true);
    expect(v.overshootPct).toBeCloseTo(1.57, 2);
    expect(v.excessContracts!).toBeGreaterThan(10_050);
    expect(v.excessContracts!).toBeLessThan(10_150);
    expect(v.attribution!.cause).toBe('slippage');
    expect(v.referencePrice).toBe(TRIGGER);
    const entries = getNotificationSnapshot().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warning');
    expect(entries[0].title).toBe('加仓成交后复判：超出 Plan B 上限 +1.57%');
    expect(entries[0].description).toContain('参考价 0.00770150');
    expect(entries[0].description).toContain('「条件单 @S₂」档定量');
  });

  it('按「条件单 @S₂」定的 643,61x 张：触发后在自己的成交价上不超，不发消息；多挂 1% 就说量超了计划、不说滑点', () => {
    const cond = planAt('conditional');
    expect(Math.abs(cond.contracts! - 643_614)).toBeLessThanOrEqual(1);
    const snapshot = snapAt('conditional');
    const ok = judgePlannedAddFill(input(trigger(cond.contracts!, snapshot), snapshot))!;
    expect(ok.overLimit).toBe(false);
    expect(ok.message).toBeNull();
    expect(getNotificationSnapshot().entries).toHaveLength(0);

    const over = judgePlannedAddFill(input(trigger(Math.round(cond.contracts! * 1.01), snapshot), snapshot))!;
    expect(over.overLimit).toBe(true);
    expect(over.attribution!.cause).toBe('oversize');
    expect(over.message!.description).toContain('超出来自仓位本身，不是滑点');
    // 触发价改了（挂在比计划更高的价上）：说触发价偏离计划触发价
    const moved = { ...snapshot, s2AtOrder: TRIGGER * 1.002 };
    const drifted = executeSettlementFill('COMMONUSDT', TRIGGER * 1.002, {
      side: 'LONG', quantity: cond.contracts!, contracts: cond.contracts!, leverage: 5, marginMode: 'isolated',
      settlementMode: 'coin', settlementAsset: 'COMMON', contractSizeUsd: FACE, addSizingSnapshot: moved,
    }, false).position;
    const dv = judgePlannedAddFill({ ...input(drifted, moved), referencePrice: TRIGGER * 1.002 })!;
    expect(dv.attribution!.cause).toBe('price_drift');
    expect(dv.message!.description).toContain('超出来自触发价偏离计划触发价 +0.20%');
  });

  it('U 本位 BTC 突破：限价档 500 个挂成条件单，触发后 101,010 成交、超 +505%；没有计划 / 首笔开仓 / 反向计划一律静默', () => {
    const held: Position = {
      id: 'btc', side: 'LONG', entryPrice: 98_800, quantity: 100, leverage: 5, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', margin: 1_976_000, openTime: T0,
    };
    const snapshot: AddSizingSnapshot = {
      at: T0, plan: 'A', side: 'LONG', settlement: 'usdt', s1: 99_800, s2Ref: 100_000, s2Fill: 100_000, slippagePct: 0,
      s2AtOrder: 100_000, x1: 100, sBar: 98_800, g: 0, gUnit: 'USD', addCoinsMax: 500, contracts: null, orderKind: 'limit',
    };
    const position = executeSettlementFill('BTCUSDT', 100_000, {
      side: 'LONG', quantity: 500, leverage: 5, marginMode: 'isolated', settlementMode: 'usdt', addSizingSnapshot: snapshot,
    }, false).position;
    expect(position.entryPrice).toBeCloseTo(101_010, 6);
    const base = {
      symbol: 'BTCUSDT', position, referencePrice: 100_000, heldBefore: [held],
      ordersMap: { BTCUSDT: [{ ...hedgeLine(99_800), settlementMode: 'usdt' as const, contracts: undefined, quantity: 600 }] },
      tradeHistory: [], snapshot,
    };
    const v = judgePlannedAddFill(base)!;
    expect(v.s1).toBe(99_800);
    expect(v.overLimit).toBe(true);
    expect(v.overshootPct).toBeGreaterThan(500);
    expect(v.excessContracts).toBeNull();
    expect(getNotificationSnapshot().entries).toHaveLength(1);

    expect(judgePlannedAddFill({ ...base, snapshot: null })).toBeNull();
    expect(judgePlannedAddFill({ ...base, heldBefore: [] })).toBeNull();
    expect(judgePlannedAddFill({ ...base, heldBefore: [{ ...held, side: 'SHORT' }] })).toBeNull();
    expect(judgePlannedAddFill({ ...base, snapshot: { ...snapshot, side: 'SHORT' } })).toBeNull();
    expect(getNotificationSnapshot().entries).toHaveLength(1);
  });
});

describe('addSizingPlan · 计算器 → 下单面板 / 下单入口的计划通道', () => {
  const snap = (over: Partial<Omit<AddSizingSnapshot, 'at'>> = {}): Omit<AddSizingSnapshot, 'at'> => ({
    plan: 'B', side: 'LONG', settlement: 'coin', s1: S1, s2Ref: REF, s2Fill: FILL, slippagePct: 0.14,
    x1: X1, sBar: S_BAR, g: G_COIN, gUnit: 'COMMON', addCoinsMax: 834_590_798, contracts: 643_660, orderKind: 'market',
    ...over,
  });
  beforeEach(() => {
    __resetAddSizingPlanForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetAddSizingPlanForTests();
  });

  it('发布 → 同标的同方向的开仓单取走即消费；方向 / 标的 / 类型 / 结算方式不匹配不给也不消费', () => {
    publishAddSizingPlan('COMMONUSDT', snap());
    expect(getAddSizingPlan()?.snapshot.at).toBe(T0);
    expect(takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'SHORT', type: 'MARKET' })).toBeNull();
    expect(takeAddSizingSnapshotForOrder({ symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET' })).toBeNull();
    expect(takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'TWAP' })).toBeNull();
    // 币本位的计划不钉在 U 本位的单子上（那是另一张合约）
    expect(takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET', settlement: 'usdt' })).toBeNull();
    expect(getAddSizingPlan()).not.toBeNull();
    const taken = takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET', settlement: 'coin' })!;
    expect(taken).toMatchObject({ ...snap(), at: T0 });
    expect(getAddSizingPlan()).toBeNull();
    expect(takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET' })).toBeNull();
  });

  it('先看后消费：看不消费；消费只清掉那一份——期间计算器发布了新的就不动', () => {
    publishAddSizingPlan('COMMONUSDT', snap());
    const seen = peekAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET' })!;
    expect(seen).not.toBeNull();
    expect(getAddSizingPlan()?.snapshot).toBe(seen);
    // 计算器又发布了一份新的（内容变了）：旧的那份再来消费不动新的
    publishAddSizingPlan('COMMONUSDT', snap({ s1: 0.0071 }));
    consumeAddSizingPlan(seen);
    expect(getAddSizingPlan()?.snapshot.s1).toBe(0.0071);
    const latest = peekAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'LIMIT' })!;
    consumeAddSizingPlan(latest);
    expect(getAddSizingPlan()).toBeNull();
  });

  it('保鲜期：过了 30 分钟的计划不钉，并被清掉', () => {
    publishAddSizingPlan('COMMONUSDT', snap());
    expect(takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'LIMIT', now: T0 + ADD_SIZING_PLAN_TTL_MS + 1 })).toBeNull();
    expect(getAddSizingPlan()).toBeNull();
  });

  it('内容没变时重复发布不换对象、不续期；发 null 清掉；限价 / 只做 Maker / 条件委托都可钉', () => {
    publishAddSizingPlan('COMMONUSDT', snap());
    const first = getAddSizingPlan();
    publishAddSizingPlan('COMMONUSDT', snap());
    expect(getAddSizingPlan()).toBe(first);
    vi.setSystemTime(T0 + 2 * MIN);
    publishAddSizingPlan('COMMONUSDT', snap());
    expect(getAddSizingPlan()).toBe(first);
    expect(getAddSizingPlan()?.snapshot.at).toBe(T0);
    publishAddSizingPlan('COMMONUSDT', snap({ orderKind: 'limit' }));
    expect(getAddSizingPlan()?.snapshot.orderKind).toBe('limit');
    for (const type of ['LIMIT', 'POST_ONLY', 'CONDITIONAL'] as const) {
      publishAddSizingPlan('COMMONUSDT', snap());
      expect(takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type })).not.toBeNull();
    }
    publishAddSizingPlan('COMMONUSDT', snap());
    publishAddSizingPlan('COMMONUSDT', null);
    expect(getAddSizingPlan()).toBeNull();
  });

  it('【回归 · 复审】保鲜期从计算器关闭时算起：弹窗开了 31 分钟、价没动，关掉之后仍能钉上', () => {
    publishAddSizingPlan('COMMONUSDT', snap());
    vi.setSystemTime(T0 + 31 * MIN);
    // 计算器关闭：续期（换一个对象，内容不变）
    touchAddSizingPlan('COMMONUSDT');
    expect(getAddSizingPlan('COMMONUSDT')?.snapshot.at).toBe(T0 + 31 * MIN);
    touchAddSizingPlan('NOPEUSDT');
    expect(getAddSizingPlan('NOPEUSDT')).toBeNull();
    expect(peekAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET' })).not.toBeNull();
    vi.setSystemTime(T0 + 62 * MIN);
    expect(peekAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET' })).toBeNull();
  });

  it('【回归 · 复审】按标的各存一份：B 的计划不挤掉 A 的计划与未应用的预填', () => {
    requestAddSizingPrefill('AAAUSDT', snap(), { contracts: 7, coins: 1, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    publishAddSizingPlan('BBBUSDT', snap({ s1: 0.0071 }));
    expect(getAddSizingPlan('AAAUSDT')?.prefill?.contracts).toBe(7);
    expect(getAddSizingPlan('BBBUSDT')?.snapshot.s1).toBe(0.0071);
    expect(peekAddSizingSnapshotForOrder({ symbol: 'AAAUSDT', side: 'LONG', type: 'MARKET' })?.s1).toBe(S1);
    // 消费 A 的预填只动 A
    consumeAddSizingPrefill(getAddSizingPlan('AAAUSDT')!.prefillSeq, 'AAAUSDT');
    expect(getAddSizingPlan('AAAUSDT')?.prefill).toBeNull();
    // 取走 B 的计划不动 A
    expect(takeAddSizingSnapshotForOrder({ symbol: 'BBBUSDT', side: 'LONG', type: 'LIMIT' })).not.toBeNull();
    expect(getAddSizingPlan('BBBUSDT')).toBeNull();
    expect(getAddSizingPlan('AAAUSDT')).not.toBeNull();
    publishAddSizingPlan('AAAUSDT', null);
    expect(getAddSizingPlan()).toBeNull();
  });

  it('「按上限下单」：带预填请求发布；面板消费一次预填后计划仍留给下单入口', () => {
    requestAddSizingPrefill('COMMONUSDT', snap(), { contracts: 643_660, coins: 834_590_798, orderType: 'MARKET', limitPrice: null, side: 'LONG', settlement: 'coin' });
    const entry = getAddSizingPlan()!;
    expect(entry.prefill?.contracts).toBe(643_660);
    consumeAddSizingPrefill(entry.prefillSeq);
    expect(getAddSizingPlan()?.prefill).toBeNull();
    expect(takeAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET' })).not.toBeNull();
  });

  it('参考：按计算器市价档的上限（整张）下单 → calcSlippage 成交 → 复判在上限之内，不发消息', () => {
    const coverage = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: S1, s2: REF, x1: X1, g: G_COIN })!;
    const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage: coverage.available, s1: S1, s2Ref: REF, orderKind: 'market', contractFaceUsd: FACE })!;
    expect(plan.converged).toBe(true);
    const notional = plan.contracts! * FACE;
    const fill = calcSlippage(REF, notional, 'LONG');
    const v = evaluateMarketAddFill(guardInput({ fillPrice: fill, addCoins: notional / fill }))!;
    expect(v.overLimit).toBe(false);
    expect(v.message).toBeNull();
    // 而按旧版（限价档 = 基准价上的上限）下的那 653,615 张就会被判超限
    const legacy = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage: coverage.available, s1: S1, s2Ref: REF, orderKind: 'limit', contractFaceUsd: FACE })!;
    const legacyFill = calcSlippage(REF, legacy.contracts! * FACE, 'LONG');
    const bad = evaluateMarketAddFill(guardInput({ fillPrice: legacyFill, addCoins: (legacy.contracts! * FACE) / legacyFill }))!;
    expect(bad.overLimit).toBe(true);
    expect(bad.attribution?.cause).toBe('slippage');
  });
  it('【回归 · 二审】消费按「同一份计划」认：续期换了对象、s2AtOrder 不同都算同一份；内容不同的新计划不动', () => {
    publishAddSizingPlan('COMMONUSDT', snap());
    const captured = getAddSizingPlan('COMMONUSDT')!.snapshot;
    vi.setSystemTime(T0 + MIN);
    touchAddSizingPlan('COMMONUSDT');
    expect(getAddSizingPlan('COMMONUSDT')!.snapshot).not.toBe(captured);
    consumeAddSizingPlan({ ...captured, s2AtOrder: REF * 1.01 });
    expect(getAddSizingPlan('COMMONUSDT')).toBeNull();

    publishAddSizingPlan('COMMONUSDT', snap({ s1: 0.00707 }));
    consumeAddSizingPlan(captured);
    expect(getAddSizingPlan('COMMONUSDT')?.snapshot.s1).toBe(0.00707);
  });

  it('【回归 · 二审】撤单放回：保鲜期内且没有同样新或更新的计划才放回；去掉 s2AtOrder、不续期、不带预填；更旧的计划会被更新的顶掉', () => {
    const placed: AddSizingSnapshot = { ...snap(), at: T0, s2AtOrder: REF * 1.002 };
    vi.setSystemTime(T0 + 10 * MIN);
    expect(restoreAddSizingPlan('COMMONUSDT', placed)).toBe(true);
    const back = getAddSizingPlan('COMMONUSDT')!;
    expect(back.snapshot).toEqual({ ...snap(), at: T0 });
    expect('s2AtOrder' in back.snapshot).toBe(false);
    expect(back.prefill).toBeNull();
    expect(peekAddSizingSnapshotForOrder({ symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET' })).toBe(back.snapshot);

    // 同一时刻的另一份不覆盖；更新的计划不被更旧的覆盖
    expect(restoreAddSizingPlan('COMMONUSDT', { ...placed, s1: 0.00701 })).toBe(false);
    publishAddSizingPlan('COMMONUSDT', snap({ s1: 0.00708 }));
    expect(restoreAddSizingPlan('COMMONUSDT', placed)).toBe(false);
    expect(getAddSizingPlan('COMMONUSDT')?.snapshot.s1).toBe(0.00708);
    // 仓库里那份更旧（或已过期）：放回更新的那份
    const newerPlaced: AddSizingSnapshot = { ...snap({ s1: 0.00709 }), at: T0 + 11 * MIN };
    expect(restoreAddSizingPlan('COMMONUSDT', newerPlaced)).toBe(true);
    expect(getAddSizingPlan('COMMONUSDT')?.snapshot.s1).toBe(0.00709);

    // 过了保鲜期不放回；空的不放回（仓库按计算器发 null 清空，不是分场，不留分场水位）
    publishAddSizingPlan('COMMONUSDT', null);
    vi.setSystemTime(T0 + ADD_SIZING_PLAN_TTL_MS + MIN);
    expect(restoreAddSizingPlan('COMMONUSDT', placed)).toBe(false);
    expect(restoreAddSizingPlan('COMMONUSDT', null)).toBe(false);
    expect(getAddSizingPlan('COMMONUSDT')).toBeNull();
    // 仓库里那份过期了：放回仍在保鲜期的一份
    publishAddSizingPlan('BBBUSDT', snap());
    vi.setSystemTime(T0 + ADD_SIZING_PLAN_TTL_MS + 2 * MIN + ADD_SIZING_PLAN_TTL_MS);
    const late: AddSizingSnapshot = { ...snap({ s1: 0.0071 }), at: T0 + ADD_SIZING_PLAN_TTL_MS + 2 * MIN + ADD_SIZING_PLAN_TTL_MS - MIN };
    expect(restoreAddSizingPlan('BBBUSDT', late)).toBe(true);
    expect(getAddSizingPlan('BBBUSDT')?.snapshot.s1).toBe(0.0071);
  });

  /**
   * 【回归 · 三审】跳到信号时刻会把旧挂单带进新的一场，随后 clearAddSizingPlan 清掉计划。
   * 撤掉那张旧挂单时，它钉着的是上一场的计划——分场之前（含同一毫秒）的计划一律不放回，保鲜期内也不行。
   */
  it('【回归 · 三审】分场之后不放回：清除之前的计划撤单时不放回；只清别的标的不影响；全局清除管所有标的；分场之后的新计划照常放回', () => {
    const placed: AddSizingSnapshot = { ...snap(), at: T0, s2AtOrder: REF };
    vi.setSystemTime(T0 + MIN);
    clearAddSizingPlanFor('OTHERUSDT');
    expect(restoreAddSizingPlan('COMMONUSDT', placed)).toBe(true);
    publishAddSizingPlan('COMMONUSDT', null);

    // 隔离模式跳到信号时刻：只清这个币，并记下分场水位
    vi.setSystemTime(T0 + 2 * MIN);
    clearAddSizingPlanFor('COMMONUSDT');
    expect(restoreAddSizingPlan('COMMONUSDT', placed)).toBe(false);
    expect(restoreAddSizingPlan('COMMONUSDT', { ...placed, at: T0 + 2 * MIN })).toBe(false);
    expect(getAddSizingPlan('COMMONUSDT')).toBeNull();
    // 别的标的不受影响
    expect(restoreAddSizingPlan('BBBUSDT', placed)).toBe(true);

    // 分场之后算出来的计划照常放回
    vi.setSystemTime(T0 + 3 * MIN);
    const after: AddSizingSnapshot = { ...snap({ s1: 0.00708 }), at: T0 + 2 * MIN + 1 };
    expect(restoreAddSizingPlan('COMMONUSDT', after)).toBe(true);
    expect(getAddSizingPlan('COMMONUSDT')?.snapshot.s1).toBe(0.00708);

    // 同步模式分场（不给标的）：所有标的在此之前的计划都不放回
    vi.setSystemTime(T0 + 4 * MIN);
    clearAddSizingPlanFor();
    expect(getAddSizingPlan()).toBeNull();
    expect(restoreAddSizingPlan('COMMONUSDT', after)).toBe(false);
    expect(restoreAddSizingPlan('BBBUSDT', { ...snap(), at: T0 + 3 * MIN })).toBe(false);
    vi.setSystemTime(T0 + 5 * MIN);
    expect(restoreAddSizingPlan('BBBUSDT', { ...snap(), at: T0 + 4 * MIN + 1 })).toBe(true);
    // 测试重置连水位一起清掉
    __resetAddSizingPlanForTests();
    expect(restoreAddSizingPlan('COMMONUSDT', after)).toBe(true);
  });

  it('getFreshAddSizingPlan：保鲜期内给出、过期给 null 且不清理', () => {
    publishAddSizingPlan('COMMONUSDT', snap());
    expect(getFreshAddSizingPlan('COMMONUSDT')).toBe(getAddSizingPlan('COMMONUSDT')!.snapshot);
    expect(getFreshAddSizingPlan('NOPEUSDT')).toBeNull();
    expect(getFreshAddSizingPlan('COMMONUSDT', T0 + ADD_SIZING_PLAN_TTL_MS + 1)).toBeNull();
    expect(getAddSizingPlan('COMMONUSDT')).not.toBeNull();
  });
});
