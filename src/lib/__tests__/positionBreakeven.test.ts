import { describe, expect, it } from 'vitest';
import { positionBreakevenPrice } from '@/lib/positionBreakeven';

/**
 * 【用户要求】仓位卡的保本线：镜像止盈已落袋的利润摊回这副仓位之后的成本线。
 * 「数学上的均价应该与委托空单的价格一致」——按上限加满时它正好落在对冲线上。
 */
describe('positionBreakevenPrice', () => {
  const linear = { inverse: false, mirrorCoin: 0 } as const;

  it('没有镜像利润：保本线就是开仓均价', () => {
    expect(positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: 100, avgEntry: 2.5, mirrorUsd: 0 })).toBe(2.5);
    expect(positionBreakevenPrice({ inverse: true, side: 'SHORT', coinsAtEntry: 100, avgEntry: 2.5, mirrorUsd: 0, mirrorCoin: 0 })).toBe(2.5);
    // 负数（不会出现，防御）同样不动
    expect(positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: 100, avgEntry: 2.5, mirrorUsd: -10 })).toBe(2.5);
  });

  it('U 本位：多单往下让、空单往上让，幅度 = 利润 ÷ 币数；价格到保本线时浮动盈亏与落袋利润正好相抵', () => {
    const long = positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: 1_000, avgEntry: 100, mirrorUsd: 5_000 })!;
    expect(long).toBe(95);
    expect(1_000 * (long - 100) + 5_000).toBeCloseTo(0, 9);
    const short = positionBreakevenPrice({ ...linear, side: 'SHORT', coinsAtEntry: 1_000, avgEntry: 100, mirrorUsd: 5_000 })!;
    expect(short).toBe(105);
    expect(1_000 * (100 - short) + 5_000).toBeCloseTo(0, 9);
  });

  it('【HEIUSDT 2026-06-25】镜像落袋 +220,831.21：减仓后保本线 0.15358，加仓 1 之后 0.15901——都在各自那条对冲空单的安全一侧', () => {
    // 减仓后只剩主力 2,730 万币 @0.161673；当时对冲空单挂在 0.153144
    const afterMirror = positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: 27_300_000, avgEntry: 0.161673, mirrorUsd: 220_831.21 })!;
    expect(afterMirror).toBeCloseTo(0.161673 - 220_831.21 / 27_300_000, 12);
    expect(afterMirror).toBeGreaterThan(0.1535);
    expect(afterMirror).toBeLessThan(0.1537);
    // 加仓 1（1,100 万币 @0.172473）之后：真实均价 0.164775，对冲空单 0.159550
    const coins = 27_300_000 + 11_000_000;
    const avgEntry = (27_300_000 * 0.161673 + 11_000_000 * 0.172473) / coins;
    const afterAdd = positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: coins, avgEntry, mirrorUsd: 220_831.21 })!;
    expect(avgEntry).toBeCloseTo(0.164775, 6);
    expect(afterAdd).toBeCloseTo(0.159009, 6);
    expect(afterAdd).toBeLessThan(0.159550);   // 没加满：保本线在空单价下方
  });

  it('按上限加满：保本线正好等于对冲线 K（加仓计算那套逻辑里的「数学均价」）', () => {
    const Q = 1_000, S = 100, P = 2_000, K = 101, T = 105;
    const X = (Q * (K - S) + P) / (T - K);            // 总可加币数
    const coins = Q + X;
    const avgEntry = (Q * S + X * T) / coins;
    expect(positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: coins, avgEntry, mirrorUsd: P })).toBeCloseTo(K, 9);
  });

  it('币本位（反向合约）：按币算——多 = 名义 ÷（币数 + 利润币），空 = 名义 ÷（币数 − 利润币）；到线时以币计的盈亏相抵', () => {
    // 名义 28,450 USD（2,845 张 × 10），均价 2.8489 → 9,986.3105 币；镜像落袋 150 币
    const notional = 28_450;
    const avgEntry = 2.8489;
    const coinsAtEntry = notional / avgEntry;
    const long = positionBreakevenPrice({ inverse: true, side: 'LONG', coinsAtEntry, avgEntry, mirrorUsd: 0, mirrorCoin: 150 })!;
    expect(long).toBeCloseTo(notional / (coinsAtEntry + 150), 12);
    expect(long).toBeLessThan(avgEntry);
    expect(notional * (1 / avgEntry - 1 / long) + 150).toBeCloseTo(0, 9);
    const short = positionBreakevenPrice({ inverse: true, side: 'SHORT', coinsAtEntry, avgEntry, mirrorUsd: 0, mirrorCoin: 150 })!;
    expect(short).toBeGreaterThan(avgEntry);
    expect(notional * (1 / short - 1 / avgEntry) + 150).toBeCloseTo(0, 9);
    // 币本位只看利润币：USD 那一份不参与
    expect(positionBreakevenPrice({ inverse: true, side: 'LONG', coinsAtEntry, avgEntry, mirrorUsd: 9_999, mirrorCoin: 0 })).toBe(avgEntry);
  });

  it('算不出就是 null：币数 / 均价无效；落袋利润已经超过全部成本（价格走到哪都不亏）', () => {
    expect(positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: 0, avgEntry: 100, mirrorUsd: 10 })).toBeNull();
    expect(positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: 10, avgEntry: Number.NaN, mirrorUsd: 10 })).toBeNull();
    expect(positionBreakevenPrice({ ...linear, side: 'LONG', coinsAtEntry: 10, avgEntry: 100, mirrorUsd: 1_000 })).toBeNull();   // 100 − 100 = 0
    expect(positionBreakevenPrice({ inverse: true, side: 'SHORT', coinsAtEntry: 10, avgEntry: 100, mirrorUsd: 0, mirrorCoin: 10 })).toBeNull();
  });
});
