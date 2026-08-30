import { describe, expect, it } from 'vitest';
import { detectBankedMirrorProfit, evaluatePostAddCostLine } from '@/lib/addSizing';
import type { TradeRecord } from '@/types/trading';

/**
 * 实盘 SAGAUSDT 2026-05-12：同一笔落袋 84,742.24 被两次加仓各花了一遍。
 *   主力 12,053,122.94 币 @0.0447220
 *   镜像止盈 23:19 落袋 +84,742.24            ← G 从这一刻起才存在
 *   加仓1 23:49  30,759,267.56 币 @0.0481123  ← ≈ B 账本给的 30,381,185
 *   加仓2 01:00  29,413,587.27 币 @0.0493925  ← ≈ B 账本又给的 30,843,399（同一个 G）
 */
const T = (iso: string) => Date.parse(iso);
const tp = (closeAt: string, pnl: number): TradeRecord => ({
  symbol: 'SAGAUSDT', side: 'LONG', action: 'CLOSE', exit_method: 'tp1',
  closeTime: T(closeAt), pnl, exitPrice: 0.0494271,
} as unknown as TradeRecord);

const MAIN_OPEN = T('2026-05-12T21:42:00Z');
const HISTORY = [tp('2026-05-12T23:19:00Z', 84_742.24)];

describe('落袋是否已经被花掉', () => {
  it('落袋当下还没有新开仓——第一次加仓可以用 B', () => {
    const positions = [{ side: 'LONG' as const, openTime: MAIN_OPEN }];
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions);
    expect(b.usd).toBeCloseTo(84_742.24, 2);
    expect(b.lastBankedAt).toBe(T('2026-05-12T23:19:00Z'));
    expect(b.addsSinceBanked).toBe(0);
  });

  it('【回归】落袋之后已经加过一笔——第二次不能再原样用同一个 G', () => {
    const positions = [
      { side: 'LONG' as const, openTime: MAIN_OPEN },
      { side: 'LONG' as const, openTime: T('2026-05-12T23:49:00Z') },   // 加仓1
    ];
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions);
    expect(b.addsSinceBanked).toBe(1);
  });

  it('同一刻开出的主仓与镜像不算加仓——数持仓条数会误判', () => {
    // 主仓与镜像是同一刻的两条腿；若按「持仓 > 1 条」判断，第一次加仓就会被误拦。
    const positions = [
      { side: 'LONG' as const, openTime: MAIN_OPEN },
      { side: 'LONG' as const, openTime: MAIN_OPEN },
    ];
    expect(detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions).addsSinceBanked).toBe(0);
  });

  it('反方向的仓位不算数', () => {
    const positions = [{ side: 'SHORT' as const, openTime: T('2026-05-13T00:00:00Z') }];
    expect(detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN, positions).addsSinceBanked).toBe(0);
  });

  it('不传持仓时不做这项判断，行为与旧版一致', () => {
    const b = detectBankedMirrorProfit('SAGAUSDT', 'LONG', HISTORY, MAIN_OPEN);
    expect(b.usd).toBeCloseTo(84_742.24, 2);
    expect(b.addsSinceBanked).toBe(0);
  });
});

describe('加仓后的综合成本线（R0 复核）', () => {
  const X1 = 12_053_122.94, SBAR = 0.0447220, S1 = 0.0453230, S2 = 0.0481123;

  it('【实盘】加仓 3,076 万币之后成本线越过止损线 4.05%', () => {
    const r = evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: 30_759_267.56 })!;
    expect(r.blendedCost).toBeCloseTo(0.0471578, 7);
    expect(r.pastStop).toBe(true);
    expect(r.overshootPct).toBeCloseTo(4.05, 1);
  });

  it('只加 A 账本的量时，成本线**恰好落在**止损线上——那正是 A 的定义', () => {
    const cushion = X1 * (S1 - SBAR);
    const xA = cushion / (S2 - S1);
    const r = evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: xA })!;
    expect(r.blendedCost).toBeCloseTo(S1, 9);
    expect(r.pastStop).toBe(false);
    expect(r.overshootPct).toBe(0);
  });

  it('所以任何超出 A 的加量都必然越线——B 账本按定义就会越', () => {
    const cushion = X1 * (S1 - SBAR);
    const xA = cushion / (S2 - S1);
    const r = evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: xA * 1.01 })!;
    expect(r.pastStop).toBe(true);
  });

  it('空单方向相反：成本线低于止损线才算越过', () => {
    const r = evaluatePostAddCostLine({
      side: 'SHORT', sBar: 0.05, s1: 0.049, s2: 0.047, x1: 1_000_000, addCoins: 5_000_000,
    })!;
    expect(r.blendedCost).toBeLessThan(0.049);
    expect(r.pastStop).toBe(true);
  });

  it('参数不合法时返回 null，不编数', () => {
    expect(evaluatePostAddCostLine({ side: 'LONG', sBar: 0, s1: S1, s2: S2, x1: X1, addCoins: 1 })).toBeNull();
    expect(evaluatePostAddCostLine({ side: 'LONG', sBar: SBAR, s1: S1, s2: S2, x1: X1, addCoins: 0 })).toBeNull();
  });
});
