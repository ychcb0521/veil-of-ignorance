import { describe, expect, it } from 'vitest';
import {
  computeLegPositionShares,
  formatLegCoinQuantity,
  formatLegNotional,
  formatLegPositionSharePct,
  formatLegPositionShareTotal,
  type LegPositionShareInput,
} from '@/lib/legPositionShare';

/**
 * 【用户要求】Legs 表在「币量 / 仓位」后面加一列：币量 / 仓位各占总币量 / 总仓位的百分比。
 * 上行币量占比、下行名义仓位占比，两个分母各算各的；状态为「挂单中」的腿不进分母。
 */
const leg = (legId: string, coinQty: number | null, notional: number | null, counted = true): LegPositionShareInput => ({
  legId, coinQty, notional, counted,
});

// 用户截图里的四条腿：币量 / 名义仓位
const SCREENSHOT = [
  leg('a', 27_603_119.02, 3_015_630),
  leg('b', 10_128_701.13, 1_164_280),
  leg('c', 6_374_254.98, 751_560),
  leg('d', 34_936_760.27, 4_049_570),
];

describe('占比 helper', () => {
  it('截图里的四条腿：两个分母各自求和，逐腿百分比各自加起来是 100', () => {
    const shares = computeLegPositionShares(SCREENSHOT);
    expect(shares.totalCoins).toBeCloseTo(79_042_835.4, 4);
    expect(shares.totalNotional).toBe(8_981_040);
    const coin = SCREENSHOT.map(input => shares.byLeg.get(input.legId)!.coinSharePct!);
    const notional = SCREENSHOT.map(input => shares.byLeg.get(input.legId)!.notionalSharePct!);
    expect(coin.reduce((sum, pct) => sum + pct, 0)).toBeCloseTo(100, 9);
    expect(notional.reduce((sum, pct) => sum + pct, 0)).toBeCloseTo(100, 9);
    expect(coin.map(formatLegPositionSharePct)).toEqual(['34.9%', '12.8%', '8.1%', '44.2%']);
    // 各行分别取一位小数：33.578 / 12.964 / 8.368 / 45.090——印出来加总是 100.1，未平摊舍入误差
    expect(notional.map(formatLegPositionSharePct)).toEqual(['33.6%', '13.0%', '8.4%', '45.1%']);
    // 显示值原样带回：格子与分母读同一份
    expect(shares.byLeg.get('a')).toEqual(expect.objectContaining({ coinQty: 27_603_119.02, notional: 3_015_630, counted: true }));
  });

  it('各行分别取一位小数：腿越多，逐行相加离 100.0% 可能越远（不止 0.1），合计格照样是 100.0%', () => {
    const equal = (count: number) => computeLegPositionShares(
      Array.from({ length: count }, (_, index) => leg(`leg-${index}`, 1_000, 1_000)),
    );
    const printedSum = (shares: ReturnType<typeof computeLegPositionShares>) => Array.from(shares.byLeg.values())
      .map(entry => Number.parseFloat(formatLegPositionSharePct(entry.notionalSharePct)))
      .reduce((sum, pct) => sum + pct, 0);

    const six = equal(6);
    expect(Array.from(six.byLeg.values()).map(entry => formatLegPositionSharePct(entry.coinSharePct)))
      .toEqual(Array(6).fill('16.7%'));
    expect(printedSum(six)).toBeCloseTo(100.2, 6);
    expect(formatLegPositionShareTotal(six.totalNotional)).toBe('100.0%');

    const twelve = equal(12);
    expect(formatLegPositionSharePct(twelve.byLeg.get('leg-0')!.notionalSharePct)).toBe('8.3%');
    expect(printedSum(twelve)).toBeCloseTo(99.6, 6);
    expect(formatLegPositionShareTotal(twelve.totalCoins)).toBe('100.0%');

    // 五条腿、名义 1996 ×4 + 2016：印 20.0% ×4 + 20.2%，加起来 100.2
    const five = computeLegPositionShares([1996, 1996, 1996, 1996, 2016].map((value, index) => leg(`n${index}`, value, value)));
    expect(Array.from(five.byLeg.values()).map(entry => formatLegPositionSharePct(entry.notionalSharePct)))
      .toEqual(['20.0%', '20.0%', '20.0%', '20.0%', '20.2%']);
    expect(printedSum(five)).toBeCloseTo(100.2, 6);
  });

  it('挂单中（不计入）的腿：两行都是 null，分母里没有它', () => {
    const shares = computeLegPositionShares([...SCREENSHOT, leg('pending', 50_000_000, 9_000_000, false)]);
    expect(shares.totalCoins).toBeCloseTo(79_042_835.4, 4);
    expect(shares.totalNotional).toBe(8_981_040);
    expect(shares.byLeg.get('pending')).toEqual({
      coinQty: 50_000_000, notional: 9_000_000, counted: false, coinSharePct: null, notionalSharePct: null,
    });
    expect(formatLegPositionSharePct(shares.byLeg.get('a')!.coinSharePct)).toBe('34.9%');
  });

  it('缺开仓价（币量为 null）：只退出币量分母，名义仓位照样进下行的分母——两个合计各算各的', () => {
    const shares = computeLegPositionShares([leg('x', 30, 600), leg('no-price', null, 400)]);
    expect(shares.totalCoins).toBe(30);
    expect(shares.totalNotional).toBe(1_000);
    expect(shares.byLeg.get('x')!.coinSharePct).toBe(100);
    expect(shares.byLeg.get('x')!.notionalSharePct).toBe(60);
    expect(shares.byLeg.get('no-price')!.coinSharePct).toBeNull();
    expect(shares.byLeg.get('no-price')!.notionalSharePct).toBe(40);
  });

  it('名义为 null 或 0、币量为 0 或非有限数：不进分母，这一行显示「—」', () => {
    const shares = computeLegPositionShares([
      leg('x', 10, 100),
      leg('null-notional', 5, null),
      leg('zero', 0, 0),
      leg('nan', Number.NaN, Number.POSITIVE_INFINITY),
      leg('negative', -3, -30),
    ]);
    expect(shares.totalCoins).toBe(15);
    expect(shares.totalNotional).toBe(100);
    expect(shares.byLeg.get('null-notional')!.notionalSharePct).toBeNull();
    expect(formatLegPositionSharePct(shares.byLeg.get('null-notional')!.coinSharePct)).toBe('33.3%');
    for (const id of ['zero', 'nan', 'negative']) {
      expect(shares.byLeg.get(id)!.coinSharePct).toBeNull();
      expect(shares.byLeg.get(id)!.notionalSharePct).toBeNull();
    }
  });

  it('没有任何腿计入：两个合计都是 null，合计行印「—」而不是 100.0%', () => {
    const shares = computeLegPositionShares([leg('pending', 10, 100, false), leg('empty', null, null)]);
    expect(shares.totalCoins).toBeNull();
    expect(shares.totalNotional).toBeNull();
    expect(formatLegPositionShareTotal(shares.totalCoins)).toBe('—');
    expect(formatLegPositionShareTotal(shares.totalNotional)).toBe('—');
    expect(computeLegPositionShares([]).byLeg.size).toBe(0);
  });

  it('只有币量合计为正时上行才是 100.0%，下行同理——两行互不影响', () => {
    const shares = computeLegPositionShares([leg('no-price', null, 400)]);
    expect(formatLegPositionShareTotal(shares.totalCoins)).toBe('—');
    expect(formatLegPositionShareTotal(shares.totalNotional)).toBe('100.0%');
    expect(formatLegPositionShareTotal(0)).toBe('—');
    expect(formatLegPositionShareTotal(-5)).toBe('—');
  });

  it('格式：一位小数加百分号；取整为 0 的印「0.0%」；缺值「—」', () => {
    expect(formatLegPositionSharePct(34.921721722548426)).toBe('34.9%');
    expect(formatLegPositionSharePct(12.96)).toBe('13.0%');
    expect(formatLegPositionSharePct(100)).toBe('100.0%');
    expect(formatLegPositionSharePct(0.04)).toBe('0.0%');
    expect(formatLegPositionSharePct(0.05000001)).toBe('0.1%');
    expect(formatLegPositionSharePct(-0.01)).toBe('0.0%');   // 不印「-0.0%」
    expect(formatLegPositionSharePct(null)).toBe('—');
    expect(formatLegPositionSharePct(undefined)).toBe('—');
    expect(formatLegPositionSharePct(Number.NaN)).toBe('—');
    // 一条极小的腿：份额取整为 0，照样印 0.0%，不是「—」
    const tiny = computeLegPositionShares([leg('big', 1_000_000, 1_000_000), leg('tiny', 1, 1)]);
    expect(formatLegPositionSharePct(tiny.byLeg.get('tiny')!.coinSharePct)).toBe('0.0%');
  });

  it('「币量 / 仓位」格的数字格式：腿行与合计行共用', () => {
    expect(formatLegCoinQuantity(1_171_163_720.54)).toBe('1,171,163,720.54');
    expect(formatLegCoinQuantity(1013 / 113)).toBe('8.96');
    expect(formatLegCoinQuantity(79_042_835.4)).toBe('79,042,835.4');
    expect(formatLegCoinQuantity(null)).toBe('—');
    expect(formatLegNotional(1013)).toBe('1013.00');
    expect(formatLegNotional(8_981_040)).toBe('8981040.00');
    expect(formatLegNotional(undefined)).toBe('—');
  });

  it('分母按未舍入的原值相加：各行与合计行各自取两位小数，手工把各行印出的数加起来，末位可能对不上', () => {
    const shares = computeLegPositionShares([
      leg('a', 1.004, 10.004), leg('b', 1.004, 10.004), leg('c', 1.004, 10.004),
    ]);
    expect(['a', 'b', 'c'].map(id => formatLegCoinQuantity(shares.byLeg.get(id)!.coinQty))).toEqual(['1', '1', '1']);
    expect(formatLegCoinQuantity(shares.totalCoins)).toBe('3.01');       // 手工相加是 3
    expect(['a', 'b', 'c'].map(id => formatLegNotional(shares.byLeg.get(id)!.notional))).toEqual(['10.00', '10.00', '10.00']);
    expect(formatLegNotional(shares.totalNotional)).toBe('30.01');       // 手工相加是 30.00
  });
});
