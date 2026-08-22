import { describe, expect, it } from 'vitest';

import {
  coinsToContracts,
  computeBankedAdd,
  computeCushionAdd,
  legOpeningCoins,
  weightedEntryByCoins,
} from '../addSizing';

describe('computeCushionAdd · A 本账（浮盈垫）', () => {
  it('reproduces the guide example: 10 coins @100, stop to 110, add at 120 → b = 1, X₂ = 10', () => {
    const r = computeCushionAdd({ side: 'LONG', sBar: 100, s1: 110, s2: 120, x1: 10 });
    expect(r.ok).toBe(true);
    expect(r.b).toBeCloseTo(1, 12);
    expect(r.p0).toBeCloseTo(0.5, 12);
    expect(r.x2Max).toBeCloseTo(10, 12);
    expect(r.cushion).toBeCloseTo(100, 12);
    expect(r.hedgeCoinsAtS1).toBeCloseTo(20, 12);
    // 跌回 110：头仓 +100、新腿 −100，合计 0
    const pnlAtS1 = 10 * (110 - 100) - r.x2Max * (120 - 110);
    expect(pnlAtS1).toBeCloseTo(0, 9);
  });

  it('CHIP 04-22: the cushion is the main leg alone — banked mirror profit never enters this ledger', () => {
    // 主力 28,000 币 @0.0837985，K 上移到 0.0895200，加仓价 0.102492
    const r = computeCushionAdd({ side: 'LONG', sBar: 0.0837985, s1: 0.08952, s2: 0.102492, x1: 28000 });
    expect(r.ok).toBe(true);
    expect(r.cushion).toBeCloseTo(160.202, 2);
    expect(r.x2Max).toBeCloseTo(160.202 / 0.012972, 0);
    // 即使镜像已落袋 436.46，A 本账不变
    const again = computeCushionAdd({ side: 'LONG', sBar: 0.0837985, s1: 0.08952, s2: 0.102492, x1: 28000 });
    expect(again.x2Max).toBe(r.x2Max);
  });

  it('stop line not yet past the cost line → no cushion, cannot add', () => {
    const r = computeCushionAdd({ side: 'LONG', sBar: 100, s1: 95, s2: 120, x1: 10 });
    expect(r.ok).toBe(false);
    expect(r.problem).toBe('s1_not_past_cost');
    expect(r.x2Max).toBe(0);
  });

  it('add price not past the stop line → new leg has no risk distance; refuse', () => {
    const r = computeCushionAdd({ side: 'LONG', sBar: 100, s1: 110, s2: 110, x1: 10 });
    expect(r.ok).toBe(false);
    expect(r.problem).toBe('s2_not_past_s1');
  });

  it('mirrors cleanly for a short: S̄ > S₁ > S₂', () => {
    const r = computeCushionAdd({ side: 'SHORT', sBar: 100, s1: 90, s2: 80, x1: 10 });
    expect(r.ok).toBe(true);
    expect(r.b).toBeCloseTo(1, 12);
    expect(r.x2Max).toBeCloseTo(10, 12);
  });

  it('the closer the stop sits to the add price, the smaller b and the more can be added', () => {
    const near = computeCushionAdd({ side: 'LONG', sBar: 100, s1: 118, s2: 120, x1: 10 });
    const far = computeCushionAdd({ side: 'LONG', sBar: 100, s1: 102, s2: 120, x1: 10 });
    expect(near.b).toBeLessThan(far.b);
    expect(near.x2Max).toBeGreaterThan(far.x2Max);
    expect(far.x2Max).toBeCloseTo(10 * 2 / 18, 12);
  });

  it('rejects garbage', () => {
    expect(computeCushionAdd({ side: 'LONG', sBar: 0, s1: 110, s2: 120, x1: 10 }).problem).toBe('invalid_input');
    expect(computeCushionAdd({ side: 'LONG', sBar: 100, s1: NaN, s2: 120, x1: 10 }).problem).toBe('invalid_input');
    expect(computeCushionAdd({ side: 'LONG', sBar: 100, s1: 110, s2: 120, x1: -1 }).problem).toBe('invalid_input');
  });
});

describe('computeBankedAdd · B 本账（落袋镜像）', () => {
  it('K_B = S₁ spends the whole banked profit on the A line: floor at S₁ drops from +G to 0', () => {
    const r = computeBankedAdd({
      side: 'LONG', settlement: 'usdt', g: 436.46, s2: 0.102492, s1: 0.08952,
      knob: { kind: 'line', kB: 0.08952 },
    });
    expect(r.ok).toBe(true);
    expect(r.x2).toBeCloseTo(436.46 / 0.012972, 6);
    expect(r.consumedAtS1).toBeCloseTo(436.46, 6);
    expect(r.residualAtS1).toBeCloseTo(0, 6);
    expect(r.exposureAtS1).toBeCloseTo(1, 9);
    expect(r.kBBeyondS1).toBe(false);
  });

  it('a lower K_B buys breathing room: smaller X₂ᴮ, banked profit partly kept on the A line', () => {
    const r = computeBankedAdd({
      side: 'LONG', settlement: 'usdt', g: 436.46, s2: 0.102492, s1: 0.08952,
      knob: { kind: 'line', kB: 0.0837985 },
    });
    expect(r.ok).toBe(true);
    expect(r.kBBeyondS1).toBe(true);
    expect(r.x2).toBeCloseTo(436.46 / (0.102492 - 0.0837985), 6);
    expect(r.consumedAtS1).toBeLessThan(436.46);
    expect(r.residualAtS1).toBeGreaterThan(0);
    expect(r.exposureAtS1).toBeLessThan(1);
    // B 腿在 K_B 上恰好亏掉 G
    expect(r.x2 * (0.102492 - 0.0837985)).toBeCloseTo(436.46, 6);
  });

  it('size knob inverts the line knob exactly', () => {
    const line = computeBankedAdd({
      side: 'LONG', settlement: 'usdt', g: 1000, s2: 120, s1: 110, knob: { kind: 'line', kB: 105 },
    });
    const size = computeBankedAdd({
      side: 'LONG', settlement: 'usdt', g: 1000, s2: 120, s1: 110, knob: { kind: 'size', x2: line.x2 },
    });
    expect(size.ok).toBe(true);
    expect(size.kB).toBeCloseTo(105, 9);
  });

  it('coin-margined: G in coins valued at K_B; the two knobs stay mutual inverses', () => {
    // G = 2 RAVE 落袋，S₂ = 1.10，K_B = 0.95 → X₂ᴮ = 2 × 0.95 ÷ 0.15
    const line = computeBankedAdd({
      side: 'LONG', settlement: 'coin', g: 2, s2: 1.1, s1: 1.0, knob: { kind: 'line', kB: 0.95 },
    });
    expect(line.ok).toBe(true);
    expect(line.x2).toBeCloseTo(2 * 0.95 / 0.15, 9);
    // 以币计的亏损：N_B (1/K_B − 1/S₂) = X₂ᴮ S₂ (1/K_B − 1/S₂) 恰好等于 G_coin
    const lossCoin = line.x2 * 1.1 * (1 / 0.95 - 1 / 1.1);
    expect(lossCoin).toBeCloseTo(2, 9);
    const size = computeBankedAdd({
      side: 'LONG', settlement: 'coin', g: 2, s2: 1.1, s1: 1.0, knob: { kind: 'size', x2: line.x2 },
    });
    expect(size.kB).toBeCloseTo(0.95, 9);
    // 在 S₁ 上吃掉的落袋也以币计：X₂ᴮ (S₂ − S₁) ÷ S₁
    expect(line.consumedAtS1).toBeCloseTo(line.x2 * 0.1 / 1.0, 9);
  });

  it('short side mirrors: K_B above S₂', () => {
    const r = computeBankedAdd({
      side: 'SHORT', settlement: 'usdt', g: 100, s2: 80, s1: 90, knob: { kind: 'line', kB: 95 },
    });
    expect(r.ok).toBe(true);
    expect(r.x2).toBeCloseTo(100 / 15, 9);
    expect(r.kBBeyondS1).toBe(true);
    const size = computeBankedAdd({
      side: 'SHORT', settlement: 'usdt', g: 100, s2: 80, s1: 90, knob: { kind: 'size', x2: r.x2 },
    });
    expect(size.kB).toBeCloseTo(95, 9);
  });

  it('is disabled without banked profit or without a knob value, and refuses K_B on the profit side of S₂', () => {
    expect(computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: 0, s2: 120, s1: 110, knob: { kind: 'line', kB: 105 } }).problem).toBe('disabled');
    expect(computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: 10, s2: 120, s1: 110, knob: { kind: 'line', kB: NaN } }).problem).toBe('disabled');
    expect(computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: 10, s2: 120, s1: 110, knob: { kind: 'line', kB: 125 } }).problem).toBe('kB_not_below_s2');
    expect(computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: 10, s2: 120, s1: 110, knob: { kind: 'size', x2: -3 } }).problem).toBe('x2_not_positive');
  });
});

describe('reading X₁ off positions', () => {
  it('U-margined: quantity is already coins; coin-margined: contracts × face ÷ entry', () => {
    expect(legOpeningCoins({ settlementMode: 'usdt', quantity: 1234.5, entryPrice: 0.5 }, 10)).toBe(1234.5);
    // RAVE 持仓卡：11986 张 × 10 USD ÷ 0.999467 = 119,923.90
    expect(legOpeningCoins({ settlementMode: 'coin', contracts: 11986, contractSizeUsd: 10, entryPrice: 0.999467 }, 10))
      .toBeCloseTo(119923.90, 1);
    // 面值缺失时回退默认面值
    expect(legOpeningCoins({ settlementMode: 'coin', contracts: 100, entryPrice: 2 }, 10)).toBe(500);
  });

  it('weighted entry by coins', () => {
    expect(weightedEntryByCoins([{ coins: 10, entryPrice: 100 }, { coins: 30, entryPrice: 120 }])).toBeCloseTo(115, 9);
    expect(weightedEntryByCoins([])).toBe(0);
  });

  it('coins → contracts rounds to whole contracts, at least one', () => {
    expect(coinsToContracts(119923.9, 0.999467, 10)).toBe(11986);
    expect(coinsToContracts(0.4, 10, 10)).toBe(1);
    expect(coinsToContracts(0, 10, 10)).toBe(0);
  });
});
