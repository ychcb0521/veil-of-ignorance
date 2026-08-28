import { describe, expect, it } from 'vitest';
import type { Position } from '@/types/trading';
import { allocateMarginUsd } from '@/lib/marginAllocation';

const FACE = 10;
const coin = (id: string, contracts: number, entryPrice: number, extraMargin = 0): Position => ({
  id, side: 'LONG', quantity: contracts, contracts, contractSizeUsd: FACE,
  settlementMode: 'coin', settlementAsset: 'RED', entryPrice, leverage: 10,
  marginMode: 'isolated', openTime: 0,
  margin: contracts * FACE / 10 + extraMargin,
  isolatedMargin: contracts * FACE / 10 + extraMargin,
  marginCoin: (contracts * FACE / 10 + extraMargin) / entryPrice,
} as Position);

const sum = (xs: { deltaUsd: number }[]) => xs.reduce((a, b) => a + b.deltaUsd, 0);

describe('把保证金摊到合并卡下的各腿', () => {
  const A = coin('a', 52_466, 0.138395);
  const B = coin('b', 52_467, 0.156118);

  it('单笔时原样给它，不做任何摊分', () => {
    expect(allocateMarginUsd({ symbol: 'REDUSD', positions: [A], deltaUsd: 100_000, markPrice: 0.1546 }))
      .toEqual([{ positionId: 'a', deltaUsd: 100_000 }]);
  });

  it('追加按名义等比——币本位名义 = 张 × 面值，与价无关', () => {
    const out = allocateMarginUsd({ symbol: 'REDUSD', positions: [A, B], deltaUsd: 100_000, markPrice: 0.1546 });
    expect(sum(out)).toBeCloseTo(100_000, 6);
    // 52466 vs 52467 张，几乎对半
    expect(out[0].deltaUsd).toBeCloseTo(100_000 * 52_466 / 104_933, 4);
    expect(out[1].deltaUsd).toBeCloseTo(100_000 * 52_467 / 104_933, 4);
  });

  it('【回归】总额必须精确等于请求值——残差由最后一笔吸收', () => {
    for (const n of [3, 7, 11]) {
      const legs = Array.from({ length: n }, (_, i) => coin(`p${i}`, 100 + i, 0.1 + i * 0.01));
      const out = allocateMarginUsd({ symbol: 'REDUSD', positions: legs, deltaUsd: 1_000_000 / 3, markPrice: 0.15 });
      expect(sum(out)).toBeCloseTo(1_000_000 / 3, 9);
    }
  });

  it('减少按各自「还能减多少」等比——贴着地板的那笔不该被要求多吐', () => {
    // A 没加过（可减 0），B 加过 50,000
    const B2 = coin('b', 52_467, 0.156118, 50_000);
    const out = allocateMarginUsd({ symbol: 'REDUSD', positions: [A, B2], deltaUsd: -30_000, markPrice: 0.1546 });
    expect(out).toHaveLength(1);
    expect(out[0].positionId).toBe('b');
    expect(out[0].deltaUsd).toBeCloseTo(-30_000, 6);
  });

  it('两笔都加过时，减少按各自余量的比例分', () => {
    const A2 = coin('a', 52_466, 0.138395, 10_000);
    const B2 = coin('b', 52_467, 0.156118, 30_000);
    const out = allocateMarginUsd({ symbol: 'REDUSD', positions: [A2, B2], deltaUsd: -20_000, markPrice: 0.1546 });
    expect(sum(out)).toBeCloseTo(-20_000, 6);
    expect(out[0].deltaUsd).toBeCloseTo(-20_000 * 10_000 / 40_000, 4);
    expect(out[1].deltaUsd).toBeCloseTo(-20_000 * 30_000 / 40_000, 4);
  });

  it('谁都没得减时返回空——由上层报「已达初始保证金下限」', () => {
    expect(allocateMarginUsd({ symbol: 'REDUSD', positions: [A, B], deltaUsd: -1, markPrice: 0.1546 })).toEqual([]);
  });

  it('0 / NaN / 空仓位列表都不产生动作', () => {
    expect(allocateMarginUsd({ symbol: 'REDUSD', positions: [A, B], deltaUsd: 0, markPrice: 0.15 })).toEqual([]);
    expect(allocateMarginUsd({ symbol: 'REDUSD', positions: [A, B], deltaUsd: NaN, markPrice: 0.15 })).toEqual([]);
    expect(allocateMarginUsd({ symbol: 'REDUSD', positions: [], deltaUsd: 100, markPrice: 0.15 })).toEqual([]);
  });

  it('名义算不出来时追加退回等分，不整笔丢掉', () => {
    const broken = [coin('x', 0, 0.1), coin('y', 0, 0.1)];
    const out = allocateMarginUsd({ symbol: 'REDUSD', positions: broken, deltaUsd: 1_000, markPrice: 0.15 });
    expect(sum(out)).toBeCloseTo(1_000, 9);
    expect(out).toHaveLength(2);
  });
});
