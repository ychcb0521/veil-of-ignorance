import { describe, expect, it } from 'vitest';

import {
  coinsToContracts,
  coinsToContractsFloor,
  computePlanBCoverageAtS1,
  evaluatePostFillAddSizing,
  expectedFillPrice,
  roundLimitPriceFavorable,
  sizeAddAtExpectedFill,
  type AddSide,
} from '../addSizing';
import type { SettlementMode } from '@/types/trading';
import { calcSlippage } from '@/types/trading';

/**
 * COMMONUSDT 2026-09 那一场（Legs 导出 PNG 上的数）：
 *   主力 1,034,640 张（10,346,400 USD）@0.006974 → X₁ = 1,483,567,536.56 COMMON
 *   镜像止盈1 落袋 55,994,538.50 COMMON（毛，pnlCoin，两边工具同一口径）
 *   加仓1 653,602 张（6,536,020 USD）成交 @0.0077123，S₁ = 0.007069 → Legs 判超限 +1.57%
 *   加仓2 1,380,961 张（13,809,610 USD）成交 @0.00808786，S₁ = 0.007487 → Legs 判超限 +3.70%
 * 引擎市价成交 = 基准价 × (1 + 0.0001 + 名义/5e9)，由成交价反解出下单前的基准价。
 */
const FACE = 10;
const S_BAR = 0.006974;
const X1 = 10_346_400 / S_BAR;
const G_COIN = 55_994_538.5;

const ADD1 = { s1: 0.007069, fill: 0.0077123, notional: 6_536_020, checkLimit: 834_391_899 };
const ADD2 = { s1: 0.007487, fill: 0.00808786, notional: 13_809_610, checkLimit: 1_646_579_922 };
const refOf = (add: { fill: number; notional: number }) => add.fill / (1 + 0.0001 + add.notional / 5e9);

/** 加仓2 时旧仓 = 主力 + 仍持有的加仓1（按其成交价折币），S̄ 为币量加权 */
const add1Coins = ADD1.notional / ADD1.fill;
const X1_AT_ADD2 = X1 + add1Coins;
const S_BAR_AT_ADD2 = (X1 * S_BAR + add1Coins * ADD1.fill) / X1_AT_ADD2;

const coverageOf = (sBar: number, x1: number, s1: number, s2: number) =>
  computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1, s2, x1, g: G_COIN })!.available;

describe('sizeAddAtExpectedFill · 按预计成交价定 Plan B 上限', () => {
  it('反解出的基准价经引擎 calcSlippage 回到成交价（模型与引擎同一个函数）', () => {
    for (const add of [ADD1, ADD2]) {
      expect(calcSlippage(refOf(add), add.notional, 'LONG')).toBeCloseTo(add.fill, 12);
    }
  });

  it('【回归】Legs 在实际成交价上的上限 834,391,899 / 1,646,579,922 由计算器同一条式子复现（< 0.01%）；实际下单超出 1.57% / 3.70%', () => {
    const at = (sBar: number, x1: number, add: typeof ADD1) =>
      computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1: add.s1, s2: add.fill, x1, g: G_COIN })!.addCoinsMax;
    const limit1 = at(S_BAR, X1, ADD1);
    const limit2 = at(S_BAR_AT_ADD2, X1_AT_ADD2, ADD2);
    expect(Math.abs(limit1 / ADD1.checkLimit - 1)).toBeLessThan(1e-4);
    expect(Math.abs(limit2 / ADD2.checkLimit - 1)).toBeLessThan(1e-4);
    expect(ADD1.notional / ADD1.fill / limit1 - 1).toBeCloseTo(0.0157, 3);
    expect(ADD2.notional / ADD2.fill / limit2 - 1).toBeCloseTo(0.0370, 3);
  });

  it('【回归】限价档（不计滑点）在基准价上给出的正是那一场按计算器下的张数：653,615 / 1,380,978', () => {
    const ref1 = refOf(ADD1);
    const plan1 = sizeAddAtExpectedFill({
      side: 'LONG', settlement: 'coin', coverage: coverageOf(S_BAR, X1, ADD1.s1, ref1),
      s1: ADD1.s1, s2Ref: ref1, orderKind: 'limit', contractFaceUsd: FACE,
    })!;
    expect(plan1.s2Fill).toBe(ref1);
    expect(plan1.slippagePct).toBe(0);
    expect(plan1.iterations).toBe(0);
    expect(plan1.contracts).toBe(653_615);
    // 这个量在引擎滑点下的成交价上，Legs 用同一条式子会判超限 ≈ 1.57%
    const fill = calcSlippage(ref1, plan1.contracts! * FACE, 'LONG');
    const limitAtFill = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: ADD1.s1, s2: fill, x1: X1, g: G_COIN })!.addCoinsMax;
    expect((plan1.contracts! * FACE) / fill / limitAtFill - 1).toBeCloseTo(0.0157, 3);

    const ref2 = refOf(ADD2);
    const plan2 = sizeAddAtExpectedFill({
      side: 'LONG', settlement: 'coin', coverage: coverageOf(S_BAR_AT_ADD2, X1_AT_ADD2, ADD2.s1, ref2),
      s1: ADD2.s1, s2Ref: ref2, orderKind: 'limit', contractFaceUsd: FACE,
    })!;
    expect(Math.abs(plan2.contracts! - 1_380_978)).toBeLessThanOrEqual(2);
  });

  it('市价档：二分收敛；S₂′ 就是上限名义的引擎成交价；上限在 S₂′ 上与 Plan B 式子一致；整张后在自己的成交价上仍在上限内', () => {
    for (const [add, sBar, x1] of [[ADD1, S_BAR, X1], [ADD2, S_BAR_AT_ADD2, X1_AT_ADD2]] as const) {
      const ref = refOf(add);
      const plan = sizeAddAtExpectedFill({
        side: 'LONG', settlement: 'coin', coverage: coverageOf(sBar, x1, add.s1, ref),
        s1: add.s1, s2Ref: ref, orderKind: 'market', contractFaceUsd: FACE,
      })!;
      expect(plan.converged).toBe(true);
      // 括号 [0, X₀] 与根同阶：五十几步收到相邻浮点数
      expect(plan.iterations).toBeGreaterThan(0);
      expect(plan.iterations).toBeLessThan(80);
      expect(plan.s2Fill).toBeGreaterThan(ref);
      // 返回括号下端：上限在它自己的成交价上跌回 S₁ 的亏损不超过垫子（币本位每币风险 = 险 ÷ S₁）
      const coverage = coverageOf(sBar, x1, add.s1, ref);
      expect(plan.addCoinsMax * ((plan.s2Fill - add.s1) / add.s1)).toBeLessThanOrEqual(coverage);
      // 自洽：S₂′ = calcSlippage(S₂, X·S₂′)，相对误差在收敛容差之内
      expect(Math.abs(calcSlippage(ref, plan.addCoinsMax * plan.s2Fill, 'LONG') / plan.s2Fill - 1)).toBeLessThan(1e-8);
      // 上限 = Plan B 在 S₂′ 上的同一条式子
      const atFill = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1: add.s1, s2: plan.s2Fill, x1, g: G_COIN })!;
      expect(Math.abs(atFill.addCoinsMax / plan.addCoinsMax - 1)).toBeLessThan(1e-9);
      expect(plan.notionalAtFill).toBeCloseTo(plan.addCoinsMax * plan.s2Fill, 6);
      // 整张向下取整：名义更小 → 滑点更小 → 每币风险更小，在它自己的成交价上仍不超上限
      const contracts = plan.contracts!;
      expect(contracts).toBe(Math.floor((plan.addCoinsMax * plan.s2Fill) / FACE + 1e-7));
      const ownFill = calcSlippage(ref, contracts * FACE, 'LONG');
      const ownLimit = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1: add.s1, s2: ownFill, x1, g: G_COIN })!.addCoinsMax;
      expect((contracts * FACE) / ownFill).toBeLessThanOrEqual(ownLimit);
      expect(Math.abs((contracts * FACE) / ownFill / ownLimit - 1)).toBeLessThan(1e-4);
    }
  });

  it('市价的上限严格小于限价的（多头 S₂′ > S₂ 险更大），差幅 ≈ 滑点 × S₁/(S₂−S₁)：加仓1 +0.14% → −1.6%、加仓2 +0.28% → −3.6%', () => {
    for (const [add, sBar, x1, slipPct, drop] of [[ADD1, S_BAR, X1, 0.14, 0.016], [ADD2, S_BAR_AT_ADD2, X1_AT_ADD2, 0.28, 0.036]] as const) {
      const ref = refOf(add);
      const coverage = coverageOf(sBar, x1, add.s1, ref);
      const base = { side: 'LONG' as const, settlement: 'coin' as const, coverage, s1: add.s1, s2Ref: ref, contractFaceUsd: FACE };
      const market = sizeAddAtExpectedFill({ ...base, orderKind: 'market' })!;
      const limit = sizeAddAtExpectedFill({ ...base, orderKind: 'limit' })!;
      expect(market.addCoinsMax).toBeLessThan(limit.addCoinsMax);
      expect(market.contracts!).toBeLessThan(limit.contracts!);
      expect(market.slippagePct).toBeCloseTo(slipPct, 2);
      expect(1 - market.addCoinsMax / limit.addCoinsMax).toBeCloseTo(drop, 2);
    }
  });

  it('敏感度：成交每不利 0.1%，上限少多少币按 S₂″ = S₂′ × 1.001 精确重算（同一块垫子在 S₂″ 上能买的量），不是一阶式', () => {
    const ref = refOf(ADD1);
    const coverage = coverageOf(S_BAR, X1, ADD1.s1, ref);
    const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1: ADD1.s1, s2Ref: ref, orderKind: 'market', contractFaceUsd: FACE })!;
    const worse = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: ADD1.s1, s2: plan.s2Fill * 1.001, x1: X1, g: G_COIN })!.addCoinsMax;
    const actualDrop = plan.addCoinsMax - worse;
    expect(Math.abs(plan.sensitivityCoinsPer0_1Pct / actualDrop - 1)).toBeLessThan(1e-9);
    // 一阶式 X·0.001·S₂′÷险 在这里只大 1.2%（倍数 ≈ 12），止损贴近时才大出几倍——见下一条
    const firstOrder = plan.addCoinsMax * 0.001 * plan.coinElasticity;
    expect(firstOrder / actualDrop - 1).toBeGreaterThan(0.005);
    expect(firstOrder / actualDrop - 1).toBeLessThan(0.02);
    // ≈ 上限 × 0.1% × S₂′/(S₂′−S₁) ≈ 上限 × 1.2%
    expect(plan.sensitivityCoinsPer0_1Pct / plan.addCoinsMax).toBeCloseTo(0.012, 3);
    expect(plan.coinElasticity).toBeCloseTo(plan.s2Fill / (plan.s2Fill - ADD1.s1), 9);
    expect(plan.contractElasticity).toBeCloseTo(ADD1.s1 / (plan.s2Fill - ADD1.s1), 9);
    expect(plan.coinElasticity - plan.contractElasticity).toBeCloseTo(1, 9);
  });

  it('【回归 · 三审】止损贴近（险距 0.1% / 0.01%）：一阶式是真实减少量的 1.9 / 6 倍、甚至大过整个上限；精确重算恒在 [0, 上限) 里', () => {
    for (const side of ['LONG', 'SHORT'] as const) {
      const d = side === 'SHORT' ? -1 : 1;
      for (const [frac, minRatio] of [[0.001, 1.4], [0.0001, 3]] as const) {
        const s1 = 100 * (1 - d * frac);
        // 垫子取小（50 USD / 0.5 币）：名义小、滑点只剩固定的 0.01%，险距就是止损距离本身
        for (const [settlement, face, coverage] of [['usdt', null, 50], ['coin', 10, 0.5]] as const) {
          const plan = sizeAddAtExpectedFill({ side, settlement, coverage, s1, s2Ref: 100, orderKind: 'market', contractFaceUsd: face })!;
          const label = `${side} ${frac} ${settlement}`;
          const worseFill = plan.s2Fill * (1 + 0.001 * d);
          const risk = (plan.s2Fill - s1) * d;
          const worseRisk = (worseFill - s1) * d;
          const exact = plan.addCoinsMax * (1 - risk / worseRisk);
          expect(Math.abs(plan.sensitivityCoinsPer0_1Pct / exact - 1), label).toBeLessThan(1e-9);
          expect(plan.sensitivityCoinsPer0_1Pct, label).toBeLessThan(plan.addCoinsMax);
          expect(plan.sensitivityCoinsPer0_1Pct, label).toBeGreaterThan(0);
          const firstOrder = plan.addCoinsMax * 0.001 * plan.coinElasticity;
          expect(firstOrder / exact, label).toBeGreaterThan(minRatio);
          if (frac === 0.0001) expect(firstOrder, label).toBeGreaterThan(plan.addCoinsMax);
          if (face != null) {
            // 张数：名义 − 同一块垫子在 S₂″ 上的名义，折张；同样不超过整张上限
            const contractsExact = (plan.addCoinsMax * plan.s2Fill - plan.addCoinsMax * (risk / worseRisk) * worseFill) / face;
            expect(Math.abs(plan.sensitivityContractsPer0_1Pct! - contractsExact), label).toBeLessThanOrEqual(1);
            expect(plan.sensitivityContractsPer0_1Pct!, label).toBeLessThanOrEqual(plan.contracts! + 1);
          }
        }
      }
    }
  });

  it('【回归 · 复审】张数敏感度按张数自己的量精确重算：与整张差 ≈ 6,991 只差取整，不是把币数按 S₂′ 折张的 7,718（多 10%）', () => {
    const ref = refOf(ADD1);
    const coverage = coverageOf(S_BAR, X1, ADD1.s1, ref);
    const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1: ADD1.s1, s2Ref: ref, orderKind: 'market', contractFaceUsd: FACE })!;
    const worseFill = plan.s2Fill * 1.001;
    const worseCoins = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1: ADD1.s1, s2: worseFill, x1: X1, g: G_COIN })!.addCoinsMax;
    const exactDrop = plan.contracts! - coinsToContractsFloor(worseCoins, worseFill, FACE);
    expect(exactDrop).toBeGreaterThan(6_900);
    expect(exactDrop).toBeLessThan(7_050);
    expect(Math.abs(plan.sensitivityContractsPer0_1Pct! - exactDrop)).toBeLessThanOrEqual(1);
    // 旧写法：币数敏感度按 S₂′ 折张，多算 S₂′/S₁ − 1
    const legacy = Math.round((plan.sensitivityCoinsPer0_1Pct * plan.s2Fill) / FACE);
    expect(legacy / exactDrop - 1).toBeGreaterThan(0.08);
    // 张数敏感度 ÷ 张数上限 = 1 − 1.001 · 险 ÷ 险″（精确），一阶近似是 0.1% × 张数倍数 ≈ 1.1%
    const risk = plan.s2Fill - ADD1.s1;
    const exactRatio = 1 - (1.001 * risk) / (worseFill - ADD1.s1);
    expect(Math.abs(plan.sensitivityContractsPer0_1Pct! / plan.contracts! - exactRatio)).toBeLessThan(2e-6);
    expect(Math.abs(exactRatio / (0.001 * plan.contractElasticity) - 1)).toBeLessThan(0.02);
  });

  it('roundLimitPriceFavorable：多头向下、空头向上取到价格精度；已在格上不动；浮点噪声不掉格', () => {
    expect(roundLimitPriceFavorable(0.0077015, 6, 'LONG')).toBe(0.007701);
    expect(roundLimitPriceFavorable(0.0077015, 6, 'SHORT')).toBe(0.007702);
    expect(roundLimitPriceFavorable(0.00770156, 6, 'LONG')).toBe(0.007701);
    expect(roundLimitPriceFavorable(0.007701, 6, 'LONG')).toBe(0.007701);
    expect(roundLimitPriceFavorable(0.007701, 6, 'SHORT')).toBe(0.007701);
    expect(roundLimitPriceFavorable(140, 4, 'LONG')).toBe(140);
    expect(roundLimitPriceFavorable(62_344.876, 2, 'LONG')).toBe(62_344.87);
    expect(roundLimitPriceFavorable(62_344.871, 2, 'SHORT')).toBe(62_344.88);
    expect(roundLimitPriceFavorable(Number.NaN, 6, 'LONG')).toBeNaN();
    expect(roundLimitPriceFavorable(1.23456, Number.NaN, 'LONG')).toBe(1.23456);
  });

  it('可用垫 ≤ 0 → 上限 0、0 张、敏感度 0；S₂′ 仍给出（只含固定的 0.01%）', () => {
    for (const coverage of [0, -5]) {
      const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1: 100, s2Ref: 110, orderKind: 'market', contractFaceUsd: 10 })!;
      expect(plan.addCoinsMax).toBe(0);
      expect(plan.contracts).toBe(0);
      expect(plan.notionalAtFill).toBe(0);
      expect(plan.sensitivityCoinsPer0_1Pct).toBe(0);
      expect(plan.s2Fill).toBeCloseTo(110 * 1.0001, 12);
      expect(plan.slippagePct).toBeCloseTo(0.01, 9);
      expect(plan.converged).toBe(true);
    }
  });

  it('空头对称：S₂′ 低于 S₂、滑点百分比为负、上限小于限价档', () => {
    // 主空：S̄ 120 > S₁ 110 > S₂ 100；可用垫 1,000 USD → 无滑点上限 100 币
    const base = { side: 'SHORT' as const, settlement: 'usdt' as const, coverage: 1_000, s1: 110, s2Ref: 100 };
    const market = sizeAddAtExpectedFill({ ...base, orderKind: 'market' })!;
    const limit = sizeAddAtExpectedFill({ ...base, orderKind: 'limit' })!;
    expect(limit.addCoinsMax).toBeCloseTo(100, 9);
    expect(market.s2Fill).toBeLessThan(100);
    expect(market.slippagePct).toBeLessThan(0);
    expect(market.addCoinsMax).toBeLessThan(limit.addCoinsMax);
    expect(market.converged).toBe(true);
    // U 本位：引擎按数量 × 基准价算名义
    expect(calcSlippage(100, market.addCoinsMax * 100, 'SHORT')).toBeCloseTo(market.s2Fill, 9);
    expect(market.contracts).toBeNull();
    expect(market.sensitivityContractsPer0_1Pct).toBeNull();
  });

  it('K 线波动 > 2% 时按引擎规则滑点翻倍（调用方给了才生效，默认不给）', () => {
    const base = { side: 'LONG' as const, settlement: 'usdt' as const, coverage: 1_000_000, s1: 100, s2Ref: 110, orderKind: 'market' as const };
    const calm = sizeAddAtExpectedFill(base)!;
    const wild = sizeAddAtExpectedFill({ ...base, klineVolatility: { high: 112, low: 108, close: 110 } })!;
    const quiet = sizeAddAtExpectedFill({ ...base, klineVolatility: { high: 110.5, low: 109.5, close: 110 } })!;
    expect(quiet.s2Fill).toBe(calm.s2Fill);
    expect(wild.s2Fill).toBeGreaterThan(calm.s2Fill);
    // 翻倍的是滑点率：在各自的上限名义上，平静 = 0.0001 + N/5e9，波动 = 2 × 同式（名义随之略小，所以不是整整两倍的成交价差）
    const rateCalm = calm.s2Fill / 110 - 1;
    const rateWild = wild.s2Fill / 110 - 1;
    // 二分收到相邻浮点数，率的自洽远在 1e-9 之内
    expect(rateCalm).toBeCloseTo(0.0001 + (calm.addCoinsMax * 110) / 5e9, 9);
    expect(rateWild).toBeCloseTo(2 * (0.0001 + (wild.addCoinsMax * 110) / 5e9), 9);
    expect(rateWild).toBeGreaterThan(1.9 * rateCalm);
    expect(wild.addCoinsMax).toBeLessThan(calm.addCoinsMax);
  });

  it('输入无效（缺价、S₂ 没越过 S₁）→ null', () => {
    expect(sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 1, s1: Number.NaN, s2Ref: 110, orderKind: 'market' })).toBeNull();
    expect(sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 1, s1: 110, s2Ref: 110, orderKind: 'market' })).toBeNull();
    expect(sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 1, s1: 110, s2Ref: 100, orderKind: 'market' })).toBeNull();
    expect(sizeAddAtExpectedFill({ side: 'SHORT', settlement: 'usdt', coverage: 1, s1: 100, s2Ref: 110, orderKind: 'market' })).toBeNull();
    expect(sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 1, s1: 100, s2Ref: 0, orderKind: 'market' })).toBeNull();
  });
});

describe('expectedFillPrice / coinsToContractsFloor', () => {
  it('expectedFillPrice：限价原价；市价零名义只含固定 0.01%；名义越大滑点越大；与 calcSlippage 同一个数', () => {
    expect(expectedFillPrice(100, 0, 'LONG', 'limit')).toBe(100);
    expect(expectedFillPrice(100, 1e9, 'LONG', 'limit')).toBe(100);
    expect(expectedFillPrice(100, 0, 'LONG', 'market')).toBeCloseTo(100.01, 12);
    expect(expectedFillPrice(100, 5e8, 'LONG', 'market')).toBe(calcSlippage(100, 5e8, 'LONG'));
    expect(expectedFillPrice(100, 5e8, 'SHORT', 'market')).toBeLessThan(100);
    expect(expectedFillPrice(Number.NaN, 0, 'LONG', 'market')).toBeNaN();
  });

  it('coinsToContractsFloor 向下取整、不足一张为 0；coinsToContracts 保持四舍五入至少 1 张', () => {
    // 38.33 币 × 140 ÷ 10 = 536.67 张
    expect(coinsToContractsFloor(38.33326, 140, 10)).toBe(536);
    expect(coinsToContracts(38.33326, 140, 10)).toBe(537);
    expect(coinsToContractsFloor(0.05, 140, 10)).toBe(0);
    expect(coinsToContracts(0.05, 140, 10)).toBe(1);
    // 浮点噪声 3.9999999… 不掉成 3
    expect(coinsToContractsFloor(0.39999999999, 100, 10)).toBe(4);
    expect(coinsToContractsFloor(Number.NaN, 140, 10)).toBe(0);
    expect(coinsToContractsFloor(10, 0, 10)).toBe(0);
  });
});

/**
 * 二审：10 步不动点在止损贴得近、名义又大时收不住，计算器把一个不是上限的数当上限
 * （BTC 险距 0.2%：显示 179 币，真上限 177.19，在它自己的成交价上超 1.67%）；
 * 空头名义过 50 亿时第一步的成交价就 ≤ 0，整个返回 null，计算器退回按不含滑点的 S₂ 定量。
 * 现在是二分：这里把它放到一张网格上——多空 × 币本位（两种面值）/ U 本位 × 三个价位 × 五档险距 × 垫子从极小到极大，
 * 名义一路推过空头成交价归零的那条线。每一格都要：
 *   · 收敛；返回的 S₂′ 就是这个上限在引擎里的成交价；
 *   · L(X) ≤ C ≤ L(X + 一个数量步长)（上一步不可成交——空头成交价归零——也算越界）；
 *   · 整张 / 按数量精度向下取整后，在**它自己的**成交价上按 Legs 的判据（evaluatePostFillAddSizing，与校验同一条式子）不超限。
 */
describe('sizeAddAtExpectedFill · 二分在整张网格上收敛、不越界', () => {
  /** 空头成交价归零的引擎名义：1 − 0.0001 − N ÷ 5e9 = 0。 */
  const SHORT_ZERO_FILL_NOTIONAL = 5e9 * (1 - 1e-4);

  interface GridCase {
    side: AddSide;
    settlement: SettlementMode;
    face: number | null;
    s2: number;
    /** 险距占 S₂ 的比例。 */
    frac: number;
    /** 垫子（USD）：一半来自旧仓浮盈垫，一半来自落袋 G。 */
    coverageUsd: number;
    /** U 本位的数量步长。 */
    qtyStep: number;
  }
  const grid: GridCase[] = [];
  for (const side of ['LONG', 'SHORT'] as const) {
    for (const [settlement, face] of [['coin', 10], ['coin', 100], ['usdt', null]] as const) {
      for (const s2 of [0.0077015, 3_500, 100_000]) {
        for (const frac of [0.0005, 0.002, 0.01, 0.08, 0.3]) {
          for (const coverageUsd of [1e-4, 1, 1e3, 1e6, 1e8, 1e10, 1e12, 1e15]) {
            grid.push({ side, settlement, face, s2, frac, coverageUsd, qtyStep: s2 >= 1_000 ? 1e-3 : 1 });
          }
        }
      }
    }
  }

  const setup = (c: GridCase) => {
    const d = c.side === 'SHORT' ? -1 : 1;
    const coin = c.settlement === 'coin';
    const s1 = c.s2 * (1 - d * c.frac);
    // 成本线在 S₁ 盈利侧 5%：旧仓垫 = X₁ × 0.05 × S₁（USD）
    const sBar = s1 * (1 - d * 0.05);
    const x1 = (c.coverageUsd / 2) / (0.05 * s1);
    const g = coin ? (c.coverageUsd / 2) / s1 : c.coverageUsd / 2;
    const coverage = computePlanBCoverageAtS1({ side: c.side, settlement: c.settlement, sBar, s1, s2: c.s2, x1, g })!.available;
    /** 跌回 S₁ 的亏损，与 coverage 同单位。 */
    const lossAt = (coins: number, fill: number) => coins * (((fill - s1) * d) / (coin ? s1 : 1));
    /** 引擎按这个量成交：币本位给张数，U 本位给币数。 */
    const execute = (qty: number) => {
      const notional = coin ? qty * c.face! : qty * c.s2;
      const fill = calcSlippage(c.s2, notional, c.side);
      return { notional, fill, coins: coin ? notional / fill : qty };
    };
    const legsCheck = (coins: number, fill: number) => evaluatePostFillAddSizing({
      side: c.side, settlement: c.settlement, sBar, s1, x1, g, s2Ref: c.s2, s2Fill: fill, addCoins: coins,
      contractFaceUsd: c.face,
    });
    return { d, coin, s1, sBar, x1, g, coverage, lossAt, execute, legsCheck };
  };

  it(`${grid.length} 格：收敛、S₂′ 自洽、L(X) ≤ C ≤ L(X + 一步)，取整后在自己的成交价上 Legs 判据不超限`, () => {
    let beyondShortBound = 0;
    let cappedAtShortBound = 0;
    let checkedByLegs = 0;
    for (const c of grid) {
      const label = JSON.stringify(c);
      const { coin, s1, coverage, lossAt, execute, legsCheck } = setup(c);
      const plan = sizeAddAtExpectedFill({
        side: c.side, settlement: c.settlement, coverage, s1, s2Ref: c.s2, orderKind: 'market',
        contractFaceUsd: c.face,
      });
      expect(plan, label).not.toBeNull();
      const p = plan!;
      expect(p.converged, label).toBe(true);
      expect(p.iterations, label).toBeLessThan(2_200);
      expect(p.s2Fill, label).toBeGreaterThan(0);
      expect(p.addCoinsMax, label).toBeGreaterThan(0);
      // 自洽：S₂′ 就是这个上限的引擎名义下的成交价
      const engineNotional = coin ? p.addCoinsMax * p.s2Fill : p.addCoinsMax * c.s2;
      expect(Math.abs(calcSlippage(c.s2, engineNotional, c.side) / p.s2Fill - 1), label).toBeLessThan(1e-9);
      // 括号下端：在自己的成交价上不超垫子——与求解同一条算式，不留容差（返回上端就会在这里露馅）
      expect(lossAt(p.addCoinsMax, p.s2Fill), label).toBeLessThanOrEqual(coverage);

      const noSlipNotional = (coverage / lossAt(1, c.s2)) * c.s2;
      if (c.side === 'SHORT' && noSlipNotional > SHORT_ZERO_FILL_NOTIONAL) beyondShortBound += 1;

      // 取整后的量与多一步的量
      const qty = coin
        ? p.contracts!
        : Math.floor(p.addCoinsMax / c.qtyStep + 1e-9) * c.qtyStep;
      if (coin) expect(p.contracts, label).toBe(Math.floor(engineNotional / c.face! + 1e-7));
      const own = execute(qty);
      if (qty > 0) {
        expect(own.fill, label).toBeGreaterThan(0);
        expect(lossAt(own.coins, own.fill), label).toBeLessThanOrEqual(coverage * (1 + 1e-9) + 1e-12);
        const verdict = legsCheck(own.coins, own.fill);
        expect(verdict, label).not.toBeNull();
        expect(verdict!.overLimit, label).toBe(false);
        checkedByLegs += 1;
      }
      // U 本位空头的亏损有上界（成交价归零时 ≈ 数量 × S₁）：垫子比它还大时，上限停在成交价仍为正的边上
      const capped = lossAt(p.addCoinsMax, p.s2Fill) < coverage * (1 - 1e-6);
      if (capped) {
        expect(c.side === 'SHORT' && !coin, label).toBe(true);
        expect(engineNotional, label).toBeGreaterThan(SHORT_ZERO_FILL_NOTIONAL * (1 - 1e-12));
        cappedAtShortBound += 1;
      }
      const next = execute(qty + (coin ? 1 : c.qtyStep));
      if (!(next.fill > 0)) {
        // 多一步就不可成交（空头成交价归零）：上限已是能成交的最大量
        expect(c.side, label).toBe('SHORT');
        continue;
      }
      expect(capped, label).toBe(false);
      expect(lossAt(next.coins, next.fill), label).toBeGreaterThanOrEqual(coverage * (1 - 1e-9));
    }
    // 网格确实推过了空头成交价归零那条线，也确实有格子被它截住
    expect(beyondShortBound).toBeGreaterThan(20);
    expect(cappedAtShortBound).toBeGreaterThan(0);
    expect(checkedByLegs).toBeGreaterThan(grid.length * 0.8);
  });

  it('限价档在同一张网格上：S₂′ = S₂、0 步，上限就是无滑点的 C ÷ 每币风险', () => {
    for (const c of grid) {
      const { coverage, lossAt, s1 } = setup(c);
      const p = sizeAddAtExpectedFill({
        side: c.side, settlement: c.settlement, coverage, s1, s2Ref: c.s2, orderKind: 'limit', contractFaceUsd: c.face,
      })!;
      expect(p.s2Fill).toBe(c.s2);
      expect(p.iterations).toBe(0);
      expect(p.converged).toBe(true);
      expect(Math.abs(lossAt(p.addCoinsMax, c.s2) / coverage - 1)).toBeLessThan(1e-12);
    }
  });

  it('【回归 · 二审】BTC 险距 0.2%（100 BTC @98,800，S₂ 100,000，S₁ 99,800，U 本位）：上限 = 二次方程的正根 177.19，不是 179；179 在自己的成交价上超限', () => {
    const coverage = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'usdt', sBar: 98_800, s1: 99_800, s2: 100_000, x1: 100, g: 0 })!.available;
    expect(coverage).toBeCloseTo(100_000, 6);
    const p = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage, s1: 99_800, s2Ref: 100_000, orderKind: 'market' })!;
    // X·(S₂(1 + 0.0001 + X·S₂/5e9) − S₁) = C  →  (S₂²/5e9)X² + (S₂·1.0001 − S₁)X − C = 0
    const a = 100_000 ** 2 / 5e9;
    const b = 100_000 * 1.0001 - 99_800;
    const root = (-b + Math.sqrt(b * b + 4 * a * coverage)) / (2 * a);
    expect(root).toBeCloseTo(177.19, 2);
    expect(p.converged).toBe(true);
    expect(Math.abs(p.addCoinsMax / root - 1)).toBeLessThan(1e-12);
    expect(p.addCoinsMax * (p.s2Fill - 99_800)).toBeLessThanOrEqual(coverage);
    expect(p.s2Fill).toBeCloseTo(calcSlippage(100_000, p.addCoinsMax * 100_000, 'LONG'), 9);
    const legs = (coins: number) => evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'usdt', sBar: 98_800, s1: 99_800, x1: 100, g: 0,
      s2Ref: 100_000, s2Fill: calcSlippage(100_000, coins * 100_000, 'LONG'), addCoins: coins,
    })!;
    expect(legs(Math.floor(p.addCoinsMax * 1_000) / 1_000).overLimit).toBe(false);
    const old = legs(179);
    expect(old.overLimit).toBe(true);
    expect(old.overshootPct).toBeGreaterThan(1);
  });

  it('【回归 · 二审】空头险距只剩 0.0001（1000 币 @110，S₂ 100，S₁ 100.0001，U 本位）：不返回 null，上限 ≈ 68,2xx 币而不是无滑点的 9,999.9 万', () => {
    const coverage = computePlanBCoverageAtS1({ side: 'SHORT', settlement: 'usdt', sBar: 110, s1: 100.0001, s2: 100, x1: 1_000, g: 0 })!.available;
    const p = sizeAddAtExpectedFill({ side: 'SHORT', settlement: 'usdt', coverage, s1: 100.0001, s2Ref: 100, orderKind: 'market' })!;
    expect(p).not.toBeNull();
    const a = 100 ** 2 / 5e9;
    const b = 100.0001 - 100 * (1 - 0.0001);
    const root = (-b + Math.sqrt(b * b + 4 * a * coverage)) / (2 * a);
    expect(root).toBeGreaterThan(68_200);
    expect(root).toBeLessThan(68_300);
    expect(Math.abs(p.addCoinsMax / root - 1)).toBeLessThan(1e-12);
    // 返回括号下端：在自己的成交价上的亏损不超过垫子（二次公式本身也有舍入，不拿它比大小）
    expect(p.addCoinsMax * (100.0001 - p.s2Fill)).toBeLessThanOrEqual(coverage);
    expect(p.s2Fill).toBeLessThan(100);
    expect(p.s2Fill).toBeGreaterThan(0);
    const limitKind = sizeAddAtExpectedFill({ side: 'SHORT', settlement: 'usdt', coverage, s1: 100.0001, s2Ref: 100, orderKind: 'limit' })!;
    expect(limitKind.addCoinsMax).toBeGreaterThan(9.9e7);
  });

  it('【回归 · 二审】COMMONUSDT 紧止损 S₁ 0.00768（S₂ 0.0077015，险距 0.28%）：旧迭代在 7.49e9 与 13.05e9 之间跳、没收敛；二分给 1.0186e10 币 / 7,970,72x 张，整张在自己的成交价上不超', () => {
    const s1 = 0.00768;
    const s2 = 0.0077015;
    const coverage = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: S_BAR, s1, s2, x1: X1, g: G_COIN })!.available;
    const p = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1, s2Ref: s2, orderKind: 'market', contractFaceUsd: FACE })!;
    expect(p.converged).toBe(true);
    expect(p.addCoinsMax).toBeGreaterThan(1.018e10);
    expect(p.addCoinsMax).toBeLessThan(1.019e10);
    expect(p.contracts).toBeGreaterThan(7_970_000);
    expect(p.contracts).toBeLessThan(7_971_000);
    // 上限（币）与张数是同一个量：张数 = 上限 × S₂′ ÷ 面值（向下取整）
    expect(p.contracts).toBe(Math.floor((p.addCoinsMax * p.s2Fill) / FACE + 1e-7));
    const execute = (contracts: number) => {
      const fill = calcSlippage(s2, contracts * FACE, 'LONG');
      const coins = (contracts * FACE) / fill;
      return {
        loss: coins * ((fill - s1) / s1),
        legs: evaluatePostFillAddSizing({
          side: 'LONG', settlement: 'coin', sBar: S_BAR, s1, x1: X1, g: G_COIN, s2Ref: s2, s2Fill: fill,
          addCoins: coins, contractFaceUsd: FACE,
        })!,
      };
    };
    const own = execute(p.contracts!);
    expect(own.legs.overLimit).toBe(false);
    expect(own.loss).toBeLessThanOrEqual(coverage);
    expect(execute(p.contracts! + 1).loss).toBeGreaterThan(coverage);
    // 旧迭代给出的两个数：界面大字 13.05e9 币、按钮 5,840,578 张——一个超 +50% 以上，一个少 27%
    const oldHero = execute(Math.floor((13_051_387_454 * 0.0077932015) / FACE));
    expect(oldHero.legs.overLimit).toBe(true);
    expect(oldHero.legs.overshootPct).toBeGreaterThan(50);
    expect(5_840_578 / p.contracts! - 1).toBeLessThan(-0.25);
  });

  it('【回归 · 二审】ETH 险距 10（X₁ 2,000 @3,400，S₂ 3,500，S₁ 3,490，U 本位）：旧迭代的 6,768.063 在自己的成交价上超 1.26%；二分的上限取到数量精度后不超', () => {
    const cov = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'usdt', sBar: 3_400, s1: 3_490, s2: 3_500, x1: 2_000, g: 0 })!.available;
    expect(cov).toBeCloseTo(180_000, 6);
    const p = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: cov, s1: 3_490, s2Ref: 3_500, orderKind: 'market' })!;
    expect(p.converged).toBe(true);
    const legs = (coins: number) => evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'usdt', sBar: 3_400, s1: 3_490, x1: 2_000, g: 0,
      s2Ref: 3_500, s2Fill: calcSlippage(3_500, coins * 3_500, 'LONG'), addCoins: coins,
    })!;
    const floored = Math.floor(p.addCoinsMax * 1_000) / 1_000;
    expect(legs(floored).overLimit).toBe(false);
    expect(p.addCoinsMax).toBeLessThan(6_768.063 * 0.995);
    const old = legs(6_768.063);
    expect(old.overLimit).toBe(true);
    expect(old.overshootPct).toBeGreaterThan(1);
  });
});

describe('sizeAddAtExpectedFill · 空头的两个弹性', () => {
  it('空头：张数弹性 S₁/(S₁ − S₂′) = 币数弹性 + 1（多头是 − 1）；两者都按精确重算的方向与量级给出', () => {
    const p = sizeAddAtExpectedFill({ side: 'SHORT', settlement: 'coin', coverage: 5_000, s1: 110, s2Ref: 100, orderKind: 'market', contractFaceUsd: 10 })!;
    expect(p.contractElasticity - p.coinElasticity).toBeCloseTo(1, 9);
    // 成交再不利 0.1%（空头更低）：币数上限少 ≈ 0.1% × 币数弹性，张数上限少 ≈ 0.1% × 张数弹性
    const worse = p.s2Fill * 0.999;
    const coinsWorse = 5_000 / ((110 - worse) / 110);
    expect(Math.abs((1 - coinsWorse / p.addCoinsMax) / (0.001 * p.coinElasticity) - 1)).toBeLessThan(0.02);
    const notional = p.addCoinsMax * p.s2Fill;
    const notionalWorse = coinsWorse * worse;
    expect(Math.abs((1 - notionalWorse / notional) / (0.001 * p.contractElasticity) - 1)).toBeLessThan(0.02);
  });
});
