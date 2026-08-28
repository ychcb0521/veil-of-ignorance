import { describe, expect, it } from 'vitest';
import type { Position } from '@/types/trading';
import { calcLiquidationPrice } from '@/types/trading';
import {
  currentMarginUsd, firstLiquidationPrice, groupRemovableMarginUsd,
  initialMarginUsd, positionLiquidationPrice, removableMarginUsd,
} from '@/lib/positionGroupRisk';

const FACE = 10;

/** 币本位仓位；marginCoin 默认按 名义÷(开仓价×杠杆) 给，即开仓那一刻的值。 */
const coin = (over: Partial<Position> & { contracts: number; entryPrice: number }): Position => {
  const notional = over.contracts * FACE;
  const lev = over.leverage ?? 10;
  return {
    id: `p${over.contracts}-${over.entryPrice}`, side: 'LONG', symbol: 'REDUSD',
    quantity: over.contracts, contracts: over.contracts, contractSizeUsd: FACE,
    settlementMode: 'coin', settlementAsset: 'RED',
    leverage: lev, marginMode: 'isolated', openTime: 0,
    marginCoin: notional / (over.entryPrice * lev),
    margin: notional / lev,
    isolatedMargin: notional / lev,
    ...over,
  } as Position;
};

describe('合并持仓的强平价：先死的那一笔', () => {
  // 用户截图那张卡：104933 张、均价 0.147257、保证金 715173.97 RED、现价 0.154646。
  // Σn·E 与 Σn/E 一起唯一确定了两腿(50/50 时)：0.138395 / 0.156118。
  const A = coin({ contracts: 52_466, entryPrice: 0.138395 });
  const B = coin({ contracts: 52_467, entryPrice: 0.156118 });

  it('【回归】卡上那个合成强平价能被精确复现——问题不在算错，在算的是别的东西', () => {
    const synthetic = coin({
      contracts: 104_933, entryPrice: 0.147257,
      marginCoin: 715173.97032366,
    });
    expect(calcLiquidationPrice(synthetic)).toBeCloseTo(0.134361, 6);
  });

  it('【回归】多单先死的是强平价最高的那一腿，不是"平均那一腿"', () => {
    expect(positionLiquidationPrice(A)).toBeCloseTo(0.126317, 5);
    expect(positionLiquidationPrice(B)).toBeCloseTo(0.142494, 5);
    expect(firstLiquidationPrice([A, B], 'LONG')).toBeCloseTo(0.142494, 5);
  });

  it('【回归】合成价低估的余量是现价的 5.26% —— 那是扛不扛得住一根针的区别', () => {
    const mark = 0.154646;
    const shown = 0.134361;
    const real = firstLiquidationPrice([A, B], 'LONG')!;
    expect((real - shown) / mark).toBeCloseTo(0.0526, 3);
    expect((mark - shown) / mark).toBeCloseTo(0.131, 2);   // 卡说还有 13.1%
    expect((mark - real) / mark).toBeCloseTo(0.079, 2);    // 实际只有 7.9%
  });

  it('空单方向相反：先撞线的是强平价最低的那一笔', () => {
    const s1 = coin({ contracts: 100, entryPrice: 0.10, side: 'SHORT' });
    const s2 = coin({ contracts: 100, entryPrice: 0.12, side: 'SHORT' });
    const l1 = positionLiquidationPrice(s1)!, l2 = positionLiquidationPrice(s2)!;
    expect(firstLiquidationPrice([s1, s2], 'SHORT')).toBeCloseTo(Math.min(l1, l2), 9);
    expect(firstLiquidationPrice([s1, s2], 'LONG')).toBeCloseTo(Math.max(l1, l2), 9);
  });

  it('单笔仓位时就是它自己——合并逻辑不得改变单笔的读数', () => {
    expect(firstLiquidationPrice([A], 'LONG')).toBeCloseTo(positionLiquidationPrice(A)!, 9);
  });

  it('算不出来的一律跳过；全都算不出来返回 null，不编数', () => {
    const broken = coin({ contracts: 0, entryPrice: 0.1 });
    expect(positionLiquidationPrice(broken)).toBeNull();
    expect(firstLiquidationPrice([broken, A], 'LONG')).toBeCloseTo(positionLiquidationPrice(A)!, 9);
    expect(firstLiquidationPrice([broken], 'LONG')).toBeNull();
    expect(firstLiquidationPrice([], 'LONG')).toBeNull();
  });
});

describe('可减保证金的地板', () => {
  it('【回归】币本位的初始保证金 = 名义 ÷ 杠杆，与价无关', () => {
    const p = coin({ contracts: 104_933, entryPrice: 0.147257, leverage: 10 });
    expect(initialMarginUsd('REDUSD', p)).toBeCloseTo(104_933 * FACE / 10, 6);
    // 换个开仓价，同一张数同一杠杆，地板不动
    const q = coin({ contracts: 104_933, entryPrice: 0.30, leverage: 10 });
    expect(initialMarginUsd('REDUSD', q)).toBeCloseTo(initialMarginUsd('REDUSD', p), 6);
  });

  it('【回归】币本位从开仓那一刻起就该能减 0、追加之后就该能减回去', () => {
    // 旧实现拿 pos.margin 当地板，而 margin 在追加时跟着一起涨 → 可减恒为 0，
    // 币本位仓位从开出来起就一分钱都减不掉。
    const opened = coin({ contracts: 104_933, entryPrice: 0.147257, leverage: 10 });
    expect(removableMarginUsd('REDUSD', opened)).toBeCloseTo(0, 6);

    const added = { ...opened, margin: opened.margin + 50_000, isolatedMargin: opened.isolatedMargin! + 50_000 };
    expect(currentMarginUsd(added)).toBeCloseTo(104_933 + 50_000, 6);
    expect(removableMarginUsd('REDUSD', added)).toBeCloseTo(50_000, 6);   // 旧实现这里是 0
  });

  it('U 本位的地板是 数量 × 开仓价 ÷ 杠杆', () => {
    const linear = {
      id: 'l1', side: 'LONG', quantity: 3, entryPrice: 60_000, leverage: 10,
      marginMode: 'isolated', margin: 18_000, isolatedMargin: 20_000, openTime: 0,
      settlementMode: 'usdt', settlementAsset: 'USDT',
    } as Position;
    expect(initialMarginUsd('BTCUSDT', linear)).toBeCloseTo(18_000, 6);
    expect(removableMarginUsd('BTCUSDT', linear)).toBeCloseTo(2_000, 6);
  });

  it('整组可减是逐笔可减之和', () => {
    const a = coin({ contracts: 100, entryPrice: 0.1 });
    const b = { ...coin({ contracts: 200, entryPrice: 0.1 }), isolatedMargin: 200 * FACE / 10 + 77 };
    expect(groupRemovableMarginUsd('REDUSD', [a, b])).toBeCloseTo(77, 6);
  });

  it('【回归】浮点残渣不得冒充「可减」', () => {
    // 币本位地板走 名义÷(价×杠杆)×价 这条来回，52466 会算成 52465.99999999999。
    // 不吸住这 7.3e-12，一笔从没加过保证金的仓位就会显示「可减」，
    // 并在等比摊分里分到一份皮克级的钱。
    const p = coin({ contracts: 52_466, entryPrice: 0.138395, leverage: 10 });
    expect(initialMarginUsd('REDUSD', p)).not.toBe(currentMarginUsd(p));   // 确实不相等
    expect(removableMarginUsd('REDUSD', p)).toBe(0);                        // 但可减必须是 0
  });

  it('真实的一分钱仍然算数——ε 不是宽容额度', () => {
    const p = coin({ contracts: 100, entryPrice: 0.1, leverage: 10 });
    const withCent = { ...p, isolatedMargin: p.isolatedMargin! + 0.01 };
    expect(removableMarginUsd('REDUSD', withCent)).toBeCloseTo(0.01, 6);
  });
});
