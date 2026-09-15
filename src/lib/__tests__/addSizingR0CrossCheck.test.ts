import { describe, expect, it } from 'vitest';

import {
  computeCushionAdd,
  computePlanBCoverageAtS1,
  crossCheckPostAddR0,
  evaluatePostAddCostLine,
  readHeldPosition,
} from '../addSizing';
import type { Position } from '@/types/trading';

/** 使用说明的例子：10 币 @100，止损上移到 110，价格到 120 加仓 */
const base = { side: 'LONG' as const, settlement: 'usdt' as const, sBar: 100, s1: 110, s2: 120, x1: 10 };

describe('crossCheckPostAddR0 · R0 由两套独立算法各算一遍再对账', () => {
  it('取满 Plan B 上限：两条路缺口都是 0，成本线越过 S₁ 的那一段折成钱恰好 = G → pass', () => {
    const plan = computePlanBCoverageAtS1({ ...base, g: 50 })!;
    const r = crossCheckPostAddR0({ ...base, g: 50, addCoins: plan.addCoinsMax })!;
    expect(r.verdict).toBe('pass');
    expect(r.disagrees).toEqual([]);
    expect(r.shortfall).toBe(0);
    expect(r.ledger.loss).toBeCloseTo(150, 9);
    expect(r.ledger.available).toBeCloseTo(150, 9);
    expect(r.ledger.shortfall).toBe(0);
    // C = (1000 + 1800) ÷ 25 = 112；(X₁ + X₂)(C − S₁) = 25 × 2 = 50 = G
    expect(r.costLine.blendedCost).toBeCloseTo(112, 9);
    expect(r.costLine.pastStop).toBe(true);
    expect(r.costLine.overshootLoss).toBeCloseTo(50, 9);
    expect(r.costLine.shortfall).toBe(0);
    // 没给持仓腿就不做逐笔式
    expect(r.fills).toBeNull();
  });

  it('超量：两条路各自算出同一个缺口 → violation，带越过幅度', () => {
    const r = crossCheckPostAddR0({ ...base, g: 50, addCoins: 20 })!;
    expect(r.verdict).toBe('violation');
    expect(r.disagrees).toEqual([]);
    // 亏损 200 vs 可用 150
    expect(r.shortfall).toBeCloseTo(50, 9);
    expect(r.ledger.shortfall).toBeCloseTo(50, 9);
    // C = 3400 ÷ 30；30 × (C − 110) − 50 = 50
    expect(r.costLine.blendedCost).toBeCloseTo(3400 / 30, 9);
    expect(r.costLine.shortfall).toBeCloseTo(50, 9);
    expect(r.overshootPct).toBeCloseTo(((3400 / 30 - 110) / 110) * 100, 9);
  });

  it('纯 A（G = 0）取满 x2Max：成本线恰好落在 S₁，两条路都是 0', () => {
    const { x2Max } = computeCushionAdd(base);
    const r = crossCheckPostAddR0({ ...base, g: 0, addCoins: x2Max })!;
    expect(r.verdict).toBe('pass');
    expect(r.costLine.blendedCost).toBeCloseTo(110, 12);
    expect(r.costLine.pastStop).toBe(false);
    expect(r.costLine.overshootLoss).toBeCloseTo(0, 9);
    expect(r.ledger.gap).toBeCloseTo(0, 9);
  });

  it('G 为负照扣：可用垫缩水，两条路仍一致', () => {
    // Y₁ 100 + G −20 = 80：加 8 币亏 80 恰好用完；加 9 币缺 10
    const ok = crossCheckPostAddR0({ ...base, g: -20, addCoins: 8 })!;
    expect(ok.verdict).toBe('pass');
    expect(ok.ledger.available).toBeCloseTo(80, 9);
    // 成本线还在 S₁ 安全侧（越过额为负），减掉负 G 后缺口正好 0
    expect(ok.costLine.pastStop).toBe(false);
    expect(ok.costLine.overshootLoss).toBeCloseTo(-20, 9);
    const over = crossCheckPostAddR0({ ...base, g: -20, addCoins: 9 })!;
    expect(over.verdict).toBe('violation');
    expect(over.shortfall).toBeCloseTo(10, 9);
    expect(over.costLine.shortfall).toBeCloseTo(10, 9);
  });

  it('Y₁ < 0（S₁ 还在成本线亏损侧）：先用 G 补旧仓缺口，两条路仍恒等', () => {
    const r = crossCheckPostAddR0({ ...base, sBar: 112, g: 50, addCoins: 3 })!;
    expect(r.ledger.cushion).toBeCloseTo(-20, 9);
    expect(r.ledger.available).toBeCloseTo(30, 9);
    expect(r.verdict).toBe('pass');
    expect(r.costLine.overshootLoss).toBeCloseTo(50, 9);
    expect(r.costLine.gap).toBeCloseTo(r.ledger.gap, 9);
  });

  it('币本位：三条路全按 S₁ 折成结算币，一分钱容差也折成币', () => {
    const r = crossCheckPostAddR0({
      ...base, settlement: 'coin', g: 1, addCoins: 21, fills: [{ entryPrice: 100, coins: 10 }],
    })!;
    expect(r.verdict).toBe('pass');
    expect(r.ledger.cushion).toBeCloseTo(100 / 110, 12);
    expect(r.ledger.loss).toBeCloseTo((21 * 10) / 110, 12);
    expect(r.costLine.overshootLoss).toBeCloseTo(1, 9);
    expect(r.fills!.cushion).toBeCloseTo(100 / 110, 12);
    expect(r.fills!.agrees).toBe(true);
    expect(r.tolerance).toBeCloseTo(0.01 / 110, 12);
  });

  it('主空镜像：S̄ > S₁ > S₂', () => {
    const short = { side: 'SHORT' as const, settlement: 'usdt' as const, sBar: 100, s1: 90, s2: 80, x1: 10 };
    const r = crossCheckPostAddR0({ ...short, g: 50, addCoins: 15 })!;
    expect(r.verdict).toBe('pass');
    expect(r.costLine.blendedCost).toBeCloseTo(88, 9);
    expect(r.costLine.pastStop).toBe(true);
    expect(r.costLine.overshootLoss).toBeCloseTo(50, 9);
    const over = crossCheckPostAddR0({ ...short, g: 50, addCoins: 20 })!;
    expect(over.verdict).toBe('violation');
    expect(over.shortfall).toBeCloseTo(50, 9);
    expect(over.costLine.shortfall).toBeCloseTo(50, 9);
  });

  describe('逐笔式：核对手填的 X₁ / S̄ 是不是这批腿的', () => {
    // RAVE 币本位两腿：100 张 @100、100 张 @120（面值 10）
    const legs = [{ entryPrice: 100, coins: 10 }, { entryPrice: 120, coins: 1000 / 120 }];
    const x1 = 10 + 1000 / 120;
    const sBar = 2000 / x1;
    const held = { side: 'LONG' as const, settlement: 'coin' as const, s1: 130, s2: 140, g: 1.2, addCoins: 10, fills: legs };

    it('手填值与持仓逐笔一致 → pass；显示舍入（X₁ 四位小数、S̄ 八位有效数字）不算不符', () => {
      const exact = crossCheckPostAddR0({ ...held, sBar, x1 })!;
      expect(exact.verdict).toBe('pass');
      expect(exact.fills!.agrees).toBe(true);
      expect(exact.fills!.x1Delta).toBeCloseTo(0, 12);
      expect(exact.fills!.cushionDelta).toBeCloseTo(0, 12);
      const typed = crossCheckPostAddR0({ ...held, sBar: Number(sBar.toPrecision(8)), x1: Number(x1.toFixed(4)) })!;
      expect(typed.verdict).toBe('pass');
      expect(typed.fills!.agrees).toBe(true);
      expect(typed.disagrees).toEqual([]);
    });

    it('【回归】X₁ / S̄ 只取了头仓那一笔（SCRT 那类错误）→ mismatch，指出是逐笔那条路不符', () => {
      const r = crossCheckPostAddR0({ ...held, sBar: 100, x1: 10 })!;
      expect(r.verdict).toBe('mismatch');
      expect(r.disagrees).toEqual(['fills']);
      expect(r.fills!.x1).toBeCloseTo(x1, 9);
      expect(r.fills!.x1Delta).toBeCloseTo(1000 / 120, 9);
      expect(r.fills!.agrees).toBe(false);
      // 垫子式与成本线式彼此仍一致——错的是输入，不是算法
      expect(Math.abs(r.ledger.gap - r.costLine.gap)).toBeLessThanOrEqual(r.tolerance);
    });

    it('X₁ 对、S̄ 拿了别的价 → Y₁ 对不上，同样 mismatch', () => {
      const r = crossCheckPostAddR0({ ...held, sBar: 100, x1 })!;
      expect(r.verdict).toBe('mismatch');
      expect(r.disagrees).toEqual(['fills']);
      expect(Math.abs(r.fills!.x1Delta)).toBeLessThan(1e-9);
      // 手填算得 18.33 × 30 ÷ 130，逐笔是 (300 + 83.33) ÷ 130
      expect(r.fills!.cushionDelta).toBeCloseTo((10 * 30 + (1000 / 120) * 10) / 130 - (x1 * 30) / 130, 9);
    });

    it('高价币的显示舍入不误报：0.0031 BTC 手填 vs 逐笔 0.0030888', () => {
      const coins = (3 * 100) / 97_123.45;
      const r = crossCheckPostAddR0({
        side: 'LONG', settlement: 'usdt', sBar: Number((97_123.45).toPrecision(8)), s1: 102_000, s2: 105_000,
        x1: Number(coins.toFixed(4)), g: 0, addCoins: 0.001, fills: [{ entryPrice: 97_123.45, coins }],
      })!;
      expect(r.fills!.agrees).toBe(true);
      expect(r.verdict).toBe('pass');
    });

    it('空数组 / 全是无效行 → 不做逐笔式', () => {
      expect(crossCheckPostAddR0({ ...held, sBar, x1, fills: [] })!.fills).toBeNull();
      expect(crossCheckPostAddR0({ ...held, sBar, x1, fills: [{ entryPrice: 100, coins: 0 }] })!.fills).toBeNull();
      expect(crossCheckPostAddR0({ ...held, sBar, x1, fills: null })!.fills).toBeNull();
    });
  });

  it('成本线被算坏（注入）→ mismatch，指出是成本线那条路，两个数都摆出来', () => {
    const r = crossCheckPostAddR0({
      ...base, g: 50, addCoins: 15, costLine: { blendedCost: 113, pastStop: true, overshootPct: 3 },
    })!;
    expect(r.verdict).toBe('mismatch');
    expect(r.disagrees).toEqual(['cost_line']);
    expect(r.ledger.shortfall).toBe(0);
    // 25 × (113 − 110) − 50 = 25
    expect(r.costLine.shortfall).toBeCloseTo(25, 9);
    expect(r.shortfall).toBe(0);
  });

  describe('容差只吸收浮点误差，不是余量', () => {
    it('缺口不到一分钱 → 视为 0；超过一分钱 → 非法', () => {
      // 每币险 10 USD：多加 0.0009 币亏损多 0.009 USD；多加 0.0011 币多 0.011 USD
      const ok = crossCheckPostAddR0({ ...base, g: 50, addCoins: 15 + 0.009 / 10 })!;
      expect(ok.verdict).toBe('pass');
      expect(ok.shortfall).toBe(0);
      const over = crossCheckPostAddR0({ ...base, g: 50, addCoins: 15 + 0.011 / 10 })!;
      expect(over.verdict).toBe('violation');
      expect(over.shortfall).toBeCloseTo(0.011, 6);
      expect(over.costLine.shortfall).toBeCloseTo(0.011, 6);
    });

    it('大仓位按较大者的百万分之一——与 Legs 校验同一条容差', () => {
      // 亏损 1.5 亿 USD → 容差 150 USD：超 100 USD 仍视为取满，超 200 USD 才非法
      const r = crossCheckPostAddR0({ ...base, x1: 1e7, g: 5e7, addCoins: 1.5e7 + 100 / 10 })!;
      expect(r.tolerance).toBeCloseTo(150, 2);
      expect(r.verdict).toBe('pass');
      const over = crossCheckPostAddR0({ ...base, x1: 1e7, g: 5e7, addCoins: 1.5e7 + 200 / 10 })!;
      expect(over.verdict).toBe('violation');
      expect(over.shortfall).toBeCloseTo(200, 3);
    });
  });

  describe('截断容差与 Legs 校验同一条式子：max(一分钱, 亏损 / 可用垫较大者的百万分之一)，|Y₁| 再大也不放宽', () => {
    // 旧仓在 S₁ 深度浮亏但被 G 补上：Y₁ = −50,000、G = 50,100 → 可用只有 100；加 500.1 币亏 100.02，缺两分钱
    const deep = { side: 'LONG' as const, settlement: 'usdt' as const, sBar: 1, s1: 0.5, s2: 0.7, x1: 100_000, g: 50_100, addCoins: 500.1 };

    it('【回归】|Y₁| ≫ 可用垫：缺两分钱仍是 violation——Legs 判 ✗ 的同一笔加仓，计算器不能说通过', () => {
      const r = crossCheckPostAddR0(deep)!;
      expect(r.ledger.cushion).toBeCloseTo(-50_000, 6);
      expect(r.ledger.available).toBeCloseTo(100, 6);
      expect(r.ledger.gap).toBeCloseTo(0.02, 6);
      // 截断容差只看亏损与可用垫，不看成本线越过额（≈ 5 万）——否则窗口会放宽到 0.05
      expect(r.tolerance).toBeCloseTo(Math.max(0.01, 1e-6 * Math.max(r.ledger.loss, Math.abs(r.ledger.available))), 12);
      expect(r.tolerance).toBeCloseTo(0.01, 12);
      expect(r.verdict).toBe('violation');
      expect(r.shortfall).toBeCloseTo(0.02, 6);
      expect(r.costLine.shortfall).toBeCloseTo(0.02, 6);
      expect(r.disagrees).toEqual([]);
      // 对账容差可以更宽（成本线越过额带来的浮点预算），但它只用来比两条路，不参与截断
      expect(r.routeTolerance).toBeGreaterThanOrEqual(r.tolerance);
    });

    it('同一场景缺口在一分钱以内才视为取满', () => {
      // 亏 100.008，缺 0.008 < 0.01
      const r = crossCheckPostAddR0({ ...deep, addCoins: 500.04 })!;
      expect(r.verdict).toBe('pass');
      expect(r.shortfall).toBe(0);
    });
  });

  it('冗余的覆盖边界：S₁ / S₂ / G 只有一个来源，错了单位或符号两条路照样一致——不会以 mismatch 拦下', () => {
    // 币本位 G 本应 1.2 币却填了 150（USD）；G 符号填反；S₂ 错 1%；S₁ 错 0.149%（SCRT 那次）——逐笔式与手填同源，也不会分开
    const coinBase = { ...base, settlement: 'coin' as const, fills: [{ entryPrice: 100, coins: 10 }] };
    for (const input of [
      { ...coinBase, g: 150, addCoins: 10 },
      { ...coinBase, g: -1.2, addCoins: 10 },
      { ...coinBase, g: 1.2, s2: 120 * 1.01, addCoins: 10 },
      { ...base, g: 50, s1: 110 * 1.00149, addCoins: 10, fills: [{ entryPrice: 100, coins: 10 }] },
    ]) {
      const r = crossCheckPostAddR0(input)!;
      expect(r.disagrees).toEqual([]);
      expect(r.verdict).not.toBe('mismatch');
    }
  });

  it('代数恒等：随机输入下垫子式与成本线式永远一致，verdict 永远不是 mismatch', () => {
    // 确定性线性同余，可复现
    let seed = 20260915;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 500; i += 1) {
      const side = rnd() < 0.5 ? 'LONG' : 'SHORT';
      const d = side === 'SHORT' ? -1 : 1;
      const settlement = rnd() < 0.5 ? 'usdt' : 'coin';
      const s1 = 10 ** (rnd() * 10 - 5);                       // 1e-5 … 1e5
      const sBar = s1 * (1 - d * (rnd() * 0.4 - 0.1));         // S₁ 两侧都取到（Y₁ 可负）
      const s2 = s1 * (1 + d * (rnd() * 0.5 + 0.001));         // 一定越过 S₁
      const x1 = 10 ** (rnd() * 8 - 2);
      const g = ((rnd() - 0.3) * x1 * s1 * 0.1) / (settlement === 'coin' ? s1 : 1);   // 带符号
      const addCoins = x1 * rnd() * 3 + 1e-6;
      const r = crossCheckPostAddR0({ side, settlement, sBar, s1, s2, x1, g, addCoins, fills: [{ entryPrice: sBar, coins: x1 }] });
      expect(r).not.toBeNull();
      expect(Math.abs(r!.ledger.gap - r!.costLine.gap)).toBeLessThanOrEqual(r!.tolerance);
      expect(r!.disagrees).toEqual([]);
      expect(r!.routeTolerance).toBeGreaterThanOrEqual(r!.tolerance);
      expect(r!.verdict).not.toBe('mismatch');
      expect(r!.verdict).toBe(r!.ledger.gap > r!.tolerance ? 'violation' : 'pass');
      expect(r!.ledger.shortfall).toBe(r!.shortfall);
    }
  });

  it('输入不成立时不给结论：S₂ 没越过 S₁、非正数、没有加仓量', () => {
    expect(crossCheckPostAddR0({ ...base, s2: 110, g: 0, addCoins: 1 })).toBeNull();
    expect(crossCheckPostAddR0({ ...base, s2: 100, g: 0, addCoins: 1 })).toBeNull();
    expect(crossCheckPostAddR0({ ...base, x1: 0, g: 0, addCoins: 1 })).toBeNull();
    expect(crossCheckPostAddR0({ ...base, g: 0, addCoins: 0 })).toBeNull();
    expect(crossCheckPostAddR0({ ...base, sBar: Number.NaN, g: 0, addCoins: 1 })).toBeNull();
    // G 不是数按 0：与 computePlanBCoverageAtS1 同规则
    expect(crossCheckPostAddR0({ ...base, g: Number.NaN, addCoins: 10 })!.ledger.banked).toBe(0);
  });

  it('evaluatePostAddCostLine：X₁ = 0（旧仓已全部平掉）时成本线就是 S₂；X₁ > 0 仍要求 S̄ 有效', () => {
    const post = evaluatePostAddCostLine({ side: 'LONG', sBar: Number.NaN, s1: 1.1, s2: 1.3, x1: 0, addCoins: 100 })!;
    expect(post.blendedCost).toBe(1.3);
    expect(post.pastStop).toBe(true);
    expect(evaluatePostAddCostLine({ side: 'LONG', sBar: Number.NaN, s1: 1.1, s2: 1.3, x1: 5, addCoins: 100 })).toBeNull();
    expect(evaluatePostAddCostLine({ side: 'LONG', sBar: 1, s1: 1.1, s2: 1.3, x1: -1, addCoins: 100 })).toBeNull();
  });

  it('readHeldPosition 把各腿的币量与开仓价一并交出，供逐笔式复核', () => {
    const positions: Position[] = [
      { id: 'p1', side: 'LONG', entryPrice: 100, quantity: 10, leverage: 5, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 100, margin: 200, openTime: 1_000 },
      { id: 'p2', side: 'LONG', entryPrice: 120, quantity: 8.33, leverage: 5, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 100, margin: 200, openTime: 2_000 },
    ];
    const held = readHeldPosition('RAVEUSDT', positions, 'LONG', 10)!;
    expect(held.legs).toHaveLength(2);
    expect(held.legs[0]).toEqual({ coins: 10, entryPrice: 100 });
    expect(held.legs[1].coins).toBeCloseTo(1000 / 120, 12);
    expect(held.legs[1].entryPrice).toBe(120);
    // 手填值就是从这份腿加总 / 加权出来的，逐笔式对它必然一致
    const r = crossCheckPostAddR0({
      side: 'LONG', settlement: 'coin', sBar: held.avgEntry, s1: 130, s2: 140, x1: held.coins, g: 1.2, addCoins: 10, fills: held.legs,
    })!;
    expect(r.fills!.agrees).toBe(true);
  });
});
