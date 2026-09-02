import { describe, expect, it } from 'vitest';
import { computeBankedAdd, computeCushionAdd, evaluatePostAddCostLine } from '@/lib/addSizing';

/**
 * 实盘 AIOTUSDT 2025-05-03(用户导出图)。这一场是 R0 死代码的学费单:
 * 计算器的数学层全对,但「加仓后成本线越过止损线即当场非法」的复核函数
 * 从没接进界面,于是一笔 4.71 倍于合法上限的加仓没有收到任何警告。
 *
 * 委托时间线(全部来自导出):保护线 0.370(13:10) → 0.387(14:56) → 0.395868(15:56)
 * → 0.406286(17:15 挂出,17:16 加仓)。线先挂、仓后加,纪律动作没错;错的只有量。
 */
const X1 = 1_994_272.78;      // 镜像止盈后剩余主力(币)
const SBAR = 0.401610;
const S1 = 0.406286;          // 加仓时刻盘口挂着的对冲线
const S2 = 0.419353;          // 加仓价
const G = 46_401.50;          // 镜像落袋
const ACTUAL_ADD = 20_066_005.46;   // 实际加仓(币)= 名义 8,414,740

describe('AIOTUSDT 2025-05-03:量是唯一的违规项', () => {
  it('A 本账上限 ≈ 71.4 万币——公式没错', () => {
    const a = computeCushionAdd({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1 });
    expect(a.ok).toBe(true);
    expect(a.x2Max).toBeCloseTo(713_647, -1);
    expect(a.b).toBeCloseTo(2.7945, 3);
    // A 的定义:取满后成本线恰好落在 S₁
    expect(a.blendedCostAfter).toBeCloseTo(S1, 9);
  });

  it('B 本账上限 ≈ 355 万币(K_B = S₁)', () => {
    const b = computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: G, s2: S2, s1: S1, knob: { kind: 'line', kB: S1 } });
    expect(b.ok).toBe(true);
    expect(b.x2).toBeCloseTo(3_551_045, -1);
    expect(b.exposureAtS1).toBeCloseTo(1, 6);     // 在 S₁ 恰好花光 G
  });

  it('【判据】实际加仓是 A+B 合法上限的 4.71 倍', () => {
    const a = computeCushionAdd({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1 });
    const b = computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: G, s2: S2, s1: S1, knob: { kind: 'line', kB: S1 } });
    expect(ACTUAL_ADD / (a.x2Max + b.x2)).toBeCloseTo(4.705, 2);
  });

  it('【回归】R0 复核对实际量必须报「越界」,而且缺口要给出金额', () => {
    const post = evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: ACTUAL_ADD })!;
    expect(post.pastStop).toBe(true);
    expect(post.blendedCost).toBeCloseTo(0.417749, 5);
    expect(post.overshootPct).toBeCloseTo(2.82, 1);

    // 按实际量灌进 B:S₁ 处吃掉 26.2 万,G 只有 4.6 万——缺口 21.6 万由本金支付。
    // 实际全场亏 25.4 万(再加越过 S₁ 的滑点与手续费),对得上。
    const sized = computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: G, s2: S2, s1: S1, knob: { kind: 'size', x2: ACTUAL_ADD } });
    expect(sized.consumedAtS1).toBeCloseTo(262_202, -1);
    expect(sized.exposureAtS1).toBeCloseTo(5.65, 1);
    expect(-sized.residualAtS1).toBeCloseTo(215_801, -1);
  });

  it('合法量下同一场的结局是 ≈ 打平——损失全部来自超量', () => {
    // 合法 A+B 加仓在实际出场价 0.404205 的亏损
    const a = computeCushionAdd({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1 });
    const b = computeBankedAdd({ side: 'LONG', settlement: 'usdt', g: G, s2: S2, s1: S1, knob: { kind: 'line', kB: S1 } });
    const legalCoins = a.x2Max + b.x2;
    const exitPx = 0.404205;
    const addLoss = (S2 - exitPx) * legalCoins;               // ≈ 64,600
    const mainPnl = (exitPx - SBAR) * X1;                     // ≈ +5,175(毛)
    const net = G + mainPnl - addLoss;                        // 镜像 + 主力 − 加仓
    expect(net).toBeGreaterThan(-15_000);                     // ≈ 打平(滑点吃掉一点)
    expect(net).toBeLessThan(0);
    // 实际净亏 −254,248:差额 ≈ 24 万,全部由 4.71× 的超量制造
  });
});
