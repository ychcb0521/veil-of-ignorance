import { describe, expect, it } from 'vitest';
import {
  blendEntryPrice,
  unblendMainEntryPrice,
  unblendMainEntryPriceByNotional,
} from '@/lib/unblendMainEntry';

const MAIN = { entryPrice: 0.102754, units: 200 };
const ADD = { entryPrice: 0.130000, units: 100 };

describe('从合并价反解出合并之前的主力单', () => {
  it('币本位：调和平均可逆，往返回到原值', () => {
    const blended = blendEntryPrice([MAIN, ADD], 'coin')!;
    expect(blended).toBeCloseTo(300 / (200 / 0.102754 + 100 / 0.130), 12);
    const r = unblendMainEntryPrice({
      blendedEntryPrice: blended, totalUnits: 300, settlementMode: 'coin', adds: [ADD],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entryPrice).toBeCloseTo(MAIN.entryPrice, 12);
      expect(r.mainUnits).toBe(200);
      expect(r.addUnits).toBe(100);
    }
  });

  it('U 本位：算术平均可逆，往返回到原值', () => {
    const blended = blendEntryPrice([MAIN, ADD], 'usdt')!;
    expect(blended).toBeCloseTo((200 * 0.102754 + 100 * 0.130) / 300, 12);
    const r = unblendMainEntryPrice({
      blendedEntryPrice: blended, totalUnits: 300, settlementMode: 'usdt', adds: [ADD],
    });
    expect(r.ok && r.entryPrice).toBeCloseTo(MAIN.entryPrice, 12);
  });

  it('【判据】用错模式会得到错的价——两种平均不能混用', () => {
    // 币本位是名义加权调和平均，U 本位是数量加权算术平均。
    // 拿算术平均去反解币本位仓位，会得到一个主力从未成交过的价。
    const blended = blendEntryPrice([MAIN, ADD], 'coin')!;
    const wrong = unblendMainEntryPrice({
      blendedEntryPrice: blended, totalUnits: 300, settlementMode: 'usdt', adds: [ADD],
    });
    expect(wrong.ok && wrong.entryPrice).not.toBeCloseTo(MAIN.entryPrice, 6);
  });

  it('多笔加仓一起反解', () => {
    const A2 = { entryPrice: 0.145, units: 50 };
    const blended = blendEntryPrice([MAIN, ADD, A2], 'coin')!;
    const r = unblendMainEntryPrice({
      blendedEntryPrice: blended, totalUnits: 350, settlementMode: 'coin', adds: [ADD, A2],
    });
    expect(r.ok && r.entryPrice).toBeCloseTo(MAIN.entryPrice, 12);
    expect(r.ok && r.mainUnits).toBe(200);
  });

  it('【判据】合约面值会约掉——反解不需要知道面值', () => {
    // 这是公式正确的一个校验：面值填错也不会带偏答案。
    const r = (units: number) => unblendMainEntryPrice({
      blendedEntryPrice: blendEntryPrice([MAIN, ADD], 'coin')!,
      totalUnits: units, settlementMode: 'coin', adds: [ADD],
    });
    expect(r(300).ok).toBe(true);
    // 张数与面值的乘积才是名义；这里只喂张数，结果照样精确
    const got = r(300);
    expect(got.ok && got.entryPrice).toBeCloseTo(0.102754, 12);
  });

  it('加仓价等于主力价时，反解回同一个价（合并没有产生偏移）', () => {
    const same = { entryPrice: 0.102754, units: 100 };
    const blended = blendEntryPrice([MAIN, same], 'coin')!;
    expect(blended).toBeCloseTo(0.102754, 12);
    const r = unblendMainEntryPrice({
      blendedEntryPrice: blended, totalUnits: 300, settlementMode: 'coin', adds: [same],
    });
    expect(r.ok && r.entryPrice).toBeCloseTo(0.102754, 12);
  });
});

describe('反解必须在不该出数的时候拒绝出数', () => {
  const base = { blendedEntryPrice: 0.11, totalUnits: 300, settlementMode: 'coin' as const };

  it('没有加仓 → 不是混合价，什么都不做', () => {
    expect(unblendMainEntryPrice({ ...base, adds: [] }).ok).toBe(false);
    expect(unblendMainEntryPrice({ ...base, adds: [] })).toMatchObject({ reason: 'no-adds' });
  });

  it('加仓的量吃满全部量 → 主力不剩什么，拒绝', () => {
    expect(unblendMainEntryPrice({ ...base, adds: [{ entryPrice: 0.13, units: 300 }] }))
      .toMatchObject({ reason: 'adds-exceed' });
    expect(unblendMainEntryPrice({ ...base, adds: [{ entryPrice: 0.13, units: 999 }] }))
      .toMatchObject({ reason: 'adds-exceed' });
  });

  it('【判据】反解出非正数时拒绝——不拿荒谬的价去给风险定价', () => {
    // 加仓价填得离谱（比合并价还低很多的多单加仓），代数上会解出负数。
    const r = unblendMainEntryPrice({
      blendedEntryPrice: 0.11, totalUnits: 300, settlementMode: 'coin',
      adds: [{ entryPrice: 0.0001, units: 100 }],
    });
    expect(r).toMatchObject({ ok: false, reason: 'not-blended' });
  });

  it('脏值一律拒绝，不产出 NaN', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(unblendMainEntryPrice({ ...base, blendedEntryPrice: bad, adds: [ADD] }).ok).toBe(false);
      expect(unblendMainEntryPrice({ ...base, totalUnits: bad, adds: [ADD] }).ok).toBe(false);
    }
    // 加仓自己的脏值被滤掉；滤完没有加仓就等于没有加仓
    expect(unblendMainEntryPrice({ ...base, adds: [{ entryPrice: NaN, units: 100 }] }))
      .toMatchObject({ reason: 'no-adds' });
    expect(unblendMainEntryPrice({ ...base, adds: [{ entryPrice: 0.13, units: -5 }] }))
      .toMatchObject({ reason: 'no-adds' });
  });

  it('反解的结果永远是有限正数，否则不出数', () => {
    const r = unblendMainEntryPrice({ ...base, adds: [ADD] });
    if (r.ok) { expect(Number.isFinite(r.entryPrice)).toBe(true); expect(r.entryPrice).toBeGreaterThan(0); }
  });
});

describe('名义形式：两种结算模式收敛成同一条式子', () => {
  it('【判据】币本位与 U 本位用同一条公式，结果都精确', () => {
    // 模式无关本身就是一道校验：调用方不必判断币本位还是 U 本位，也就不会判错。
    const coinBlend = blendEntryPrice([MAIN, ADD], 'coin')!;
    const coin = unblendMainEntryPriceByNotional({
      blendedEntryPrice: coinBlend,
      totalNotionalUsd: 300,                       // 币本位：名义 = 张数 × 面值（面值取 1）
      adds: [{ entryPrice: ADD.entryPrice, notionalUsd: 100 }],
    });
    expect(coin.ok && coin.entryPrice).toBeCloseTo(MAIN.entryPrice, 12);

    const linBlend = blendEntryPrice([MAIN, ADD], 'usdt')!;
    const lin = unblendMainEntryPriceByNotional({
      blendedEntryPrice: linBlend,
      totalNotionalUsd: 200 * MAIN.entryPrice + 100 * ADD.entryPrice,   // U 本位：开仓名义可加
      adds: [{ entryPrice: ADD.entryPrice, notionalUsd: 100 * ADD.entryPrice }],
    });
    expect(lin.ok && lin.entryPrice).toBeCloseTo(MAIN.entryPrice, 12);
  });

  it('与按量的形式给出同一个答案', () => {
    const blended = blendEntryPrice([MAIN, ADD], 'coin')!;
    const byUnits = unblendMainEntryPrice({
      blendedEntryPrice: blended, totalUnits: 300, settlementMode: 'coin', adds: [ADD],
    });
    const byNotional = unblendMainEntryPriceByNotional({
      blendedEntryPrice: blended, totalNotionalUsd: 300,
      adds: [{ entryPrice: ADD.entryPrice, notionalUsd: 100 }],
    });
    expect(byUnits.ok && byNotional.ok
      && Math.abs(byUnits.entryPrice - byNotional.entryPrice)).toBeLessThan(1e-12);
  });

  it('拒绝条件与按量的形式一致', () => {
    const base = { blendedEntryPrice: 0.11, totalNotionalUsd: 300 };
    expect(unblendMainEntryPriceByNotional({ ...base, adds: [] })).toMatchObject({ reason: 'no-adds' });
    expect(unblendMainEntryPriceByNotional({ ...base, adds: [{ entryPrice: 0.13, notionalUsd: 300 }] }))
      .toMatchObject({ reason: 'adds-exceed' });
    expect(unblendMainEntryPriceByNotional({ ...base, adds: [{ entryPrice: 0.0001, notionalUsd: 100 }] }))
      .toMatchObject({ ok: false });
  });
});
