import { describe, expect, it } from 'vitest';
import { addRealizedMirrorProfit, calculateAddPosition, calculateAddRiskBudget, initialAddPositionState } from '../addPositionCoverage';

describe('coin-denominated add sizing', () => {
  it('shares a signed coverage budget with campaign checks, including realized losses', () => {
    for (const [cushion, banked] of [[100, 50], [-100, 300], [-100, 100], [100, -50], [100, -200], [-100, -50]]) {
      const budget = calculateAddRiskBudget(cushion, banked, 10)!;
      expect(budget.available).toBe(cushion + banked);
      expect(budget.maxAddCoins).toBeCloseTo(Math.max(0, cushion + banked) / 10, 12);
    }
    expect(calculateAddRiskBudget(100, Number.NaN, 10)).toBeNull();
    expect(calculateAddRiskBudget(100, 0, 0)).toBeNull();
  });

  it('sizes from price distances and keeps full precision', () => {
    const result = calculateAddPosition({ currentPrice: 150, support: 120, state: initialAddPositionState(100, 1) });
    expect(result.error).toBeNull();
    expect(result.baseCoins).toBeCloseTo(2 / 3, 12);
    expect(result.mirrorCoins).toBe(0);
    expect(result.addCoins).toBeCloseTo(2 / 3, 12);
    expect(result.newCoins).toBeCloseTo(5 / 3, 12);
    expect(result.strategyCost).toBe(120);
    expect(result.coverageGap).toBeCloseTo(0, 12);
  });

  it('carries all six unrounded results to 580.740740741 coins', () => {
    let state = initialAddPositionState(100, 1);
    for (const [currentPrice, support] of [[150, 120], [200, 180], [250, 220], [300, 280], [350, 320], [400, 380]]) {
      const result = calculateAddPosition({ currentPrice, support, state });
      expect(result.error).toBeNull();
      state = result.next!;
    }
    expect(state.coins).toBeCloseTo(580.740740741, 8);
    expect(state.strategyCost).toBe(380);
  });

  it('splits mirror risk, keeps the real average separate, and spends P once', () => {
    const first = calculateAddPosition({ currentPrice: 150, support: 120, state: initialAddPositionState(100, 1, 30) });
    expect(first.baseCoins).toBeCloseTo(2 / 3, 12);
    expect(first.mirrorCoins).toBe(1);
    expect(first.addCoins).toBeCloseTo(5 / 3, 12);
    expect(first.newCoins).toBeCloseTo(8 / 3, 12);
    expect(first.realAverage).toBe(131.25);
    expect(first.strategyCost).toBe(120);
    expect(first.next?.mirrorProfitAvailable).toBe(0);
    expect(first.next?.mirrorProfitAllocated).toBe(30);
    const second = calculateAddPosition({ currentPrice: 200, support: 180, state: first.next! });
    expect(second.mirrorCoins).toBe(0);
    expect(second.baseCoins).toBeCloseTo(8, 12);
    const withNewProfit = addRealizedMirrorProfit(first.next!, 10);
    expect(calculateAddPosition({ currentPrice: 200, support: 180, state: withNewProfit }).mirrorCoins).toBe(0.5);
  });

  it('allows pure mirror sizing when K equals S', () => {
    const result = calculateAddPosition({ currentPrice: 150, support: 120, state: initialAddPositionState(120, 1, 30) });
    expect(result.baseCoins).toBe(0);
    expect(result.mirrorCoins).toBe(1);
  });

  it('blocks an uncovered old loss and does not change the strategy line', () => {
    const result = calculateAddPosition({ currentPrice: 150, support: 100, state: initialAddPositionState(120, 1, 10) });
    expect(result.error).toBe('mirror_profit_insufficient');
    expect(result.oldLossShortfall).toBe(10);
    expect(result.addCoins).toBe(0);
    expect(result.next).toBeNull();
    expect(result.strategyCost).toBe(120);
  });

  it('covers the old loss first and sizes only from remaining P', () => {
    const result = calculateAddPosition({ currentPrice: 150, support: 100, state: initialAddPositionState(120, 1, 50) });
    expect(result.error).toBeNull();
    expect(result.baseCoins).toBe(0);
    expect(result.mirrorCoins).toBe(0.6);
    expect(result.addCoins).toBe(0.6);
    expect(result.coverageGap).toBeCloseTo(0, 12);
    expect(result.next?.mirrorProfitAvailable).toBe(0);
  });

  it('uses the same coin-distance coverage for a short without inverse-contract PnL', () => {
    const result = calculateAddPosition({ currentPrice: 50, support: 80,
      state: initialAddPositionState(100, 1, 30), side: 'SHORT' });
    expect(result.error).toBeNull();
    expect(result.safeDistance).toBe(20);
    expect(result.riskDistance).toBe(30);
    expect(result.baseCoins).toBeCloseTo(2 / 3, 12);
    expect(result.mirrorCoins).toBe(1);
    expect(result.realAverage).toBe(68.75);
    expect(result.strategyCost).toBe(80);
    expect(result.coverageGap).toBeCloseTo(0, 12);
  });

  it('rejects zero risk distance, absent positions and negative P', () => {
    expect(calculateAddPosition({ currentPrice: 120, support: 120, state: initialAddPositionState(100, 1) }).error).toBe('price_not_above_support');
    expect(calculateAddPosition({ currentPrice: 150, support: 120, state: initialAddPositionState(100, 0) }).error).toBe('invalid_input');
    expect(calculateAddPosition({ currentPrice: 150, support: 120, state: initialAddPositionState(100, 1, -1) }).error).toBe('invalid_input');
  });
});
