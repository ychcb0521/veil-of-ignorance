import { describe, expect, it } from 'vitest';
import {
  computeLegPositionShares,
  describeLegPositionShare,
  describeLegPositionDenominators,
  describeLegPositionSideTotal,
  formatLegCoinQuantity,
  formatLegNotional,
  formatLegPositionSharePct,
  formatLegPositionShareTotal,
  legPositionShareSortValue,
  legPositionShareTagSide,
  legPositionSideFromDirection,
  describeLegPositionShareSort,
  nextLegPositionShareSort,
  sortByLegPositionShare,
  LEG_POSITION_SHARE_COLUMN_TITLES,
  LEG_POSITION_SIDE_COLORS,
  LEG_POSITION_SIDE_LABELS,
  type LegPositionShareInput,
  type LegPositionShareSort,
  type LegPositionSide,
} from '@/lib/legPositionShare';

/**
 * 【用户要求】Legs 表在「币量 / 仓位」后面加一列：币量 / 仓位各占总币量 / 总仓位的百分比。
 * 上行币量占比、下行名义仓位占比，两个分母各算各的；状态为「挂单中」的腿不进分母。
 *
 * 【用户要求 · 续】对冲的要单独算——多单与空单分开，各自 100%，按腿实际的持仓方向分组。
 */
const leg = (
  legId: string,
  coinQty: number | null,
  notional: number | null,
  counted = true,
  side: LegPositionSide = 'long',
): LegPositionShareInput => ({
  legId, side, coinQty, notional, counted,
});
const short = (legId: string, coinQty: number | null, notional: number | null, counted = true) => (
  leg(legId, coinQty, notional, counted, 'short')
);

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
    expect(shares.bySide.long.totalCoins).toBeCloseTo(79_042_835.4, 4);
    expect(shares.bySide.long.totalNotional).toBe(8_981_040);
    const coin = SCREENSHOT.map(input => shares.byLeg.get(input.legId)!.coinSharePct!);
    const notional = SCREENSHOT.map(input => shares.byLeg.get(input.legId)!.notionalSharePct!);
    expect(coin.reduce((sum, pct) => sum + pct, 0)).toBeCloseTo(100, 9);
    expect(notional.reduce((sum, pct) => sum + pct, 0)).toBeCloseTo(100, 9);
    expect(coin.map(formatLegPositionSharePct)).toEqual(['34.9%', '12.8%', '8.1%', '44.2%']);
    // 各行分别取一位小数：33.578 / 12.964 / 8.368 / 45.090——印出来加总是 100.1，未平摊舍入误差
    expect(notional.map(formatLegPositionSharePct)).toEqual(['33.6%', '13.0%', '8.4%', '45.1%']);
    // 显示值原样带回：格子与分母读同一份
    expect(shares.byLeg.get('a')).toEqual(expect.objectContaining({ side: 'long', coinQty: 27_603_119.02, notional: 3_015_630, counted: true }));
    // 全是多单：合计行只列多单一组，空单两个分母都是 null
    expect(shares.sides.map(totals => totals.side)).toEqual(['long']);
    expect(shares.bySide.short).toEqual({ side: 'short', totalCoins: null, totalNotional: null });
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
    expect(formatLegPositionShareTotal(six.bySide.long.totalNotional)).toBe('100.0%');

    const twelve = equal(12);
    expect(formatLegPositionSharePct(twelve.byLeg.get('leg-0')!.notionalSharePct)).toBe('8.3%');
    expect(printedSum(twelve)).toBeCloseTo(99.6, 6);
    expect(formatLegPositionShareTotal(twelve.bySide.long.totalCoins)).toBe('100.0%');

    // 五条腿、名义 1996 ×4 + 2016：印 20.0% ×4 + 20.2%，加起来 100.2
    const five = computeLegPositionShares([1996, 1996, 1996, 1996, 2016].map((value, index) => leg(`n${index}`, value, value)));
    expect(Array.from(five.byLeg.values()).map(entry => formatLegPositionSharePct(entry.notionalSharePct)))
      .toEqual(['20.0%', '20.0%', '20.0%', '20.0%', '20.2%']);
    expect(printedSum(five)).toBeCloseTo(100.2, 6);
  });

  it('挂单中（不计入）的腿：两行都是 null，分母里没有它', () => {
    const shares = computeLegPositionShares([...SCREENSHOT, leg('pending', 50_000_000, 9_000_000, false)]);
    expect(shares.bySide.long.totalCoins).toBeCloseTo(79_042_835.4, 4);
    expect(shares.bySide.long.totalNotional).toBe(8_981_040);
    expect(shares.byLeg.get('pending')).toEqual({
      side: 'long', coinQty: 50_000_000, notional: 9_000_000, counted: false, coinSharePct: null, notionalSharePct: null,
    });
    expect(formatLegPositionSharePct(shares.byLeg.get('a')!.coinSharePct)).toBe('34.9%');
  });

  it('缺开仓价（币量为 null）：只退出币量分母，名义仓位照样进下行的分母——两个合计各算各的', () => {
    const shares = computeLegPositionShares([leg('x', 30, 600), leg('no-price', null, 400)]);
    expect(shares.bySide.long.totalCoins).toBe(30);
    expect(shares.bySide.long.totalNotional).toBe(1_000);
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
    expect(shares.bySide.long.totalCoins).toBe(15);
    expect(shares.bySide.long.totalNotional).toBe(100);
    expect(shares.byLeg.get('null-notional')!.notionalSharePct).toBeNull();
    expect(formatLegPositionSharePct(shares.byLeg.get('null-notional')!.coinSharePct)).toBe('33.3%');
    for (const id of ['zero', 'nan', 'negative']) {
      expect(shares.byLeg.get(id)!.coinSharePct).toBeNull();
      expect(shares.byLeg.get(id)!.notionalSharePct).toBeNull();
    }
  });

  it('没有任何腿计入：两个合计都是 null，合计行印「—」而不是 100.0%', () => {
    const shares = computeLegPositionShares([leg('pending', 10, 100, false), leg('empty', null, null)]);
    expect(shares.bySide.long.totalCoins).toBeNull();
    expect(shares.bySide.long.totalNotional).toBeNull();
    expect(formatLegPositionShareTotal(shares.bySide.long.totalCoins)).toBe('—');
    expect(formatLegPositionShareTotal(shares.bySide.long.totalNotional)).toBe('—');
    // 两个方向都没有可加的腿：合计行不列任何一组（照旧印「—」）
    expect(shares.sides).toEqual([]);
    expect(computeLegPositionShares([]).byLeg.size).toBe(0);
    expect(computeLegPositionShares([]).sides).toEqual([]);
  });

  it('只有币量合计为正时上行才是 100.0%，下行同理——两行互不影响', () => {
    const shares = computeLegPositionShares([leg('no-price', null, 400)]);
    expect(formatLegPositionShareTotal(shares.bySide.long.totalCoins)).toBe('—');
    expect(formatLegPositionShareTotal(shares.bySide.long.totalNotional)).toBe('100.0%');
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
    expect(formatLegCoinQuantity(shares.bySide.long.totalCoins)).toBe('3.01');       // 手工相加是 3
    expect(['a', 'b', 'c'].map(id => formatLegNotional(shares.byLeg.get(id)!.notional))).toEqual(['10.00', '10.00', '10.00']);
    expect(formatLegNotional(shares.bySide.long.totalNotional)).toBe('30.01');       // 手工相加是 30.00
  });
});

/** 腿的「涨跌幅」方向来源：direction === 'short' 为空单，其余一律多单。 */
describe('占比 · 多单与空单分开算', () => {
  const pcts = (shares: ReturnType<typeof computeLegPositionShares>, ids: string[], key: 'coinSharePct' | 'notionalSharePct') => (
    ids.map(id => formatLegPositionSharePct(shares.byLeg.get(id)![key]))
  );
  const printedSum = (printed: string[]) => printed.reduce((sum, pct) => sum + Number.parseFloat(pct), 0);

  // 用户截图的形状（KAITOUSDT，主多）：主力多单、镜像止盈多单、滚动对冲空单、加仓多单
  const USER_SHAPE = [
    leg('main', 3_000, 3_000),
    leg('mirror', 3_000, 3_000),
    short('hedge', 2_000 / 1.1, 2_000),
    leg('add', 1_250, 1_500),
  ];

  it('【用户要求】用户截图的形状：三条多单在多单合计里加起来 100.0%，唯一的空单对冲独占空单的 100.0%', () => {
    const shares = computeLegPositionShares(USER_SHAPE);
    const longs = ['main', 'mirror', 'add'];
    expect(pcts(shares, longs, 'coinSharePct')).toEqual(['41.4%', '41.4%', '17.2%']);
    expect(pcts(shares, longs, 'notionalSharePct')).toEqual(['40.0%', '40.0%', '20.0%']);
    expect(printedSum(pcts(shares, longs, 'coinSharePct'))).toBeCloseTo(100, 6);
    expect(printedSum(pcts(shares, longs, 'notionalSharePct'))).toBeCloseTo(100, 6);
    expect(pcts(shares, ['hedge'], 'coinSharePct')).toEqual(['100.0%']);
    expect(pcts(shares, ['hedge'], 'notionalSharePct')).toEqual(['100.0%']);

    // 对冲不进多单的分母：多单合计只有三条多单
    expect(shares.bySide.long).toEqual({ side: 'long', totalCoins: 7_250, totalNotional: 7_500 });
    expect(shares.bySide.short.totalCoins).toBeCloseTo(1_818.18, 2);
    expect(shares.bySide.short.totalNotional).toBe(2_000);
    // 合计行先多后空，两组都列
    expect(shares.sides.map(totals => totals.side)).toEqual(['long', 'short']);
    expect(shares.byLeg.get('hedge')!.side).toBe('short');
    expect(legPositionShareTagSide(shares.byLeg.get('hedge'))).toBe('short');
    expect(legPositionShareTagSide(shares.byLeg.get('main'))).toBe('long');

    // 反证：还是一个分母时主力只有 33.1%，四条腿一起凑 100%
    const oneDenominator = computeLegPositionShares(USER_SHAPE.map(input => ({ ...input, side: 'long' as const })));
    expect(formatLegPositionSharePct(oneDenominator.byLeg.get('main')!.coinSharePct)).toBe('33.1%');
  });

  it('分组跟方向走、不跟角色走：主空战役里的多单对冲进多单那一组，主力空单独占空单', () => {
    // helper 只认方向；从 leg.direction 取方向的规则与「涨跌幅」列相同
    expect(legPositionSideFromDirection('short')).toBe('short');
    expect(legPositionSideFromDirection('long')).toBe('long');
    expect(legPositionSideFromDirection(null)).toBe('long');
    expect(legPositionSideFromDirection(undefined)).toBe('long');
    const shares = computeLegPositionShares([
      { legId: 'main-short', side: legPositionSideFromDirection('short'), coinQty: 5_000, notional: 5_000, counted: true },
      { legId: 'add-short', side: legPositionSideFromDirection('short'), coinQty: 3_000, notional: 3_000, counted: true },
      { legId: 'hedge-long', side: legPositionSideFromDirection('long'), coinQty: 2_000, notional: 2_000, counted: true },
    ]);
    expect(pcts(shares, ['main-short', 'add-short'], 'coinSharePct')).toEqual(['62.5%', '37.5%']);
    expect(pcts(shares, ['hedge-long'], 'coinSharePct')).toEqual(['100.0%']);
    expect(pcts(shares, ['hedge-long'], 'notionalSharePct')).toEqual(['100.0%']);
    expect(shares.sides.map(totals => [totals.side, totals.totalCoins])).toEqual([['long', 2_000], ['short', 8_000]]);
  });

  it('两条空单平分空单那一组；多单那一组不受影响', () => {
    const shares = computeLegPositionShares([
      leg('main', 10, 1_000),
      short('hedge-a', 4, 300),
      short('hedge-b', 12, 900),
    ]);
    expect(pcts(shares, ['hedge-a', 'hedge-b'], 'coinSharePct')).toEqual(['25.0%', '75.0%']);
    expect(pcts(shares, ['hedge-a', 'hedge-b'], 'notionalSharePct')).toEqual(['25.0%', '75.0%']);
    expect(pcts(shares, ['main'], 'coinSharePct')).toEqual(['100.0%']);
    expect(shares.bySide.short).toEqual({ side: 'short', totalCoins: 16, totalNotional: 1_200 });
    expect(shares.bySide.long).toEqual({ side: 'long', totalCoins: 10, totalNotional: 1_000 });
  });

  it('某一方向只有一条挂单中的腿：那一方向不列进合计，那条腿两行「—」、不挂标签', () => {
    const shares = computeLegPositionShares([
      leg('main', 10, 1_000),
      leg('add', 30, 3_000),
      short('pending-hedge', 50, 5_000, false),
    ]);
    expect(shares.sides.map(totals => totals.side)).toEqual(['long']);
    expect(shares.bySide.short).toEqual({ side: 'short', totalCoins: null, totalNotional: null });
    const pending = shares.byLeg.get('pending-hedge')!;
    expect(pending).toEqual(expect.objectContaining({ side: 'short', counted: false, coinSharePct: null, notionalSharePct: null }));
    expect(legPositionShareTagSide(pending)).toBeNull();
    expect(pcts(shares, ['main', 'add'], 'coinSharePct')).toEqual(['25.0%', '75.0%']);
    // 反过来：只有多单那一方向挂单中时，多单那组不列、空单照常
    const flipped = computeLegPositionShares([leg('pending-tp', 5, 500, false), short('hedge', 2, 200)]);
    expect(flipped.sides.map(totals => totals.side)).toEqual(['short']);
    expect(pcts(flipped, ['hedge'], 'coinSharePct')).toEqual(['100.0%']);
  });

  it('缺开仓价只退出本方向的币量分母；一个方向全缺开仓价时那组上行是「—」、下行照常 100.0%', () => {
    const shares = computeLegPositionShares([
      leg('main', 10, 1_000),
      short('hedge-no-price', null, 400),
      short('hedge-priced', 2, 600),
    ]);
    expect(pcts(shares, ['hedge-no-price'], 'coinSharePct')).toEqual(['—']);
    expect(pcts(shares, ['hedge-no-price'], 'notionalSharePct')).toEqual(['40.0%']);
    expect(pcts(shares, ['hedge-priced'], 'coinSharePct')).toEqual(['100.0%']);
    expect(shares.bySide.short).toEqual({ side: 'short', totalCoins: 2, totalNotional: 1_000 });
    // 只有名义有数：上行「—」下行 100.0%，那一组仍列出、那条腿仍挂标签
    const onlyNotional = computeLegPositionShares([leg('main', 10, 1_000), short('no-price', null, 400)]);
    expect(onlyNotional.sides.map(totals => totals.side)).toEqual(['long', 'short']);
    expect(formatLegPositionShareTotal(onlyNotional.bySide.short.totalCoins)).toBe('—');
    expect(formatLegPositionShareTotal(onlyNotional.bySide.short.totalNotional)).toBe('100.0%');
    expect(legPositionShareTagSide(onlyNotional.byLeg.get('no-price'))).toBe('short');
  });

  it('标签的字与颜色：「多」#0ECB81、「空」#F6465D（币安仓位方向色）', () => {
    expect(LEG_POSITION_SIDE_LABELS).toEqual({ long: '多', short: '空' });
    expect(LEG_POSITION_SIDE_COLORS).toEqual({ long: '#0ECB81', short: '#F6465D' });
  });

  it('tooltip：「空单合计里的占比：…」/「多单合计里的占比：…」；挂单中的说明不计入；缺值不给', () => {
    const shares = computeLegPositionShares([...USER_SHAPE, short('pending', 1, 1, false), leg('empty', null, null)]);
    expect(describeLegPositionShare(shares.byLeg.get('hedge'))).toBe('空单合计里的占比：币量 100.0%，名义仓位 100.0%');
    expect(describeLegPositionShare(shares.byLeg.get('main'))).toBe('多单合计里的占比：币量 41.4%，名义仓位 40.0%');
    expect(describeLegPositionShare(shares.byLeg.get('pending'))).toBe('状态为「挂单中」（还没有成交或平仓记录），不计入多单 / 空单合计');
    expect(describeLegPositionShare(shares.byLeg.get('empty'))).toBeUndefined();
    expect(legPositionShareTagSide(shares.byLeg.get('empty'))).toBeNull();
    expect(describeLegPositionShare(undefined)).toBeUndefined();
  });

  it('合计行「币量 / 仓位」格的 tooltip 只列出实际有的那几组，逐组说明：多单那组是「多单占比」的分母，空单那组只是合计；一组都没有时不给', () => {
    // 【用户要求】「空单仓位的占比也不需要」：空单那组不再叫「分母」
    expect(describeLegPositionDenominators(computeLegPositionShares(USER_SHAPE).sides))
      .toBe('多单一组是「多单占比」的分母，空单一组是空单各腿的合计（只看总量，不算占比）；上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）');
    expect(describeLegPositionDenominators(computeLegPositionShares([leg('main', 10, 1_000)]).sides))
      .toBe('多单一组是「多单占比」的分母；上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）');
    expect(describeLegPositionDenominators(computeLegPositionShares([short('only-short', 2, 300)]).sides))
      .toBe('空单一组是空单各腿的合计（只看总量，不算占比）；上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）');
    expect(describeLegPositionDenominators(computeLegPositionShares([short('pending', 1, 1, false)]).sides)).toBeUndefined();
  });

  it('合计行「占比」格的 tooltip：一个方向一句，只说有分母的那一行（上行「—」时不说「各腿合计为 100%」）', () => {
    const both = computeLegPositionShares(USER_SHAPE);
    expect(both.sides.map(describeLegPositionSideTotal)).toEqual(['多单各腿合计为 100%', '空单各腿合计为 100%']);
    // 空单计入的腿都缺开仓价：上行「—」、下行 100.0%
    const noPrice = computeLegPositionShares([leg('main', 10, 1_000), short('no-price', null, 400)]);
    expect(noPrice.sides.map(describeLegPositionSideTotal)).toEqual([
      '多单各腿合计为 100%',
      '空单各腿的名义仓位合计为 100%（币量缺开仓价，没有分母）',
    ]);
    // 反过来（helper 不排除这种输入）：只有币量有分母
    const noNotional = computeLegPositionShares([leg('coins-only', 5, null)]);
    expect(formatLegPositionShareTotal(noNotional.bySide.long.totalCoins)).toBe('100.0%');
    expect(formatLegPositionShareTotal(noNotional.bySide.long.totalNotional)).toBe('—');
    expect(noNotional.sides.map(describeLegPositionSideTotal)).toEqual([
      '多单各腿的币量合计为 100%（名义仓位缺值，没有分母）',
    ]);
    // 没有计入腿的方向不进 sides，合计行不会为它写 tooltip；直接问 bySide 时也不说 100%
    expect(noNotional.sides.map(totals => totals.side)).toEqual(['long']);
    expect(describeLegPositionSideTotal(noNotional.bySide.short)).toBe('空单没有计入的腿');
  });
});

/**
 * 【用户要求】「仓位占比分成两列呈现，多和空分成两列。并且还要做成能够点击之后排序的」：点表头排序——降序 → 升序 → 默认顺序。
 * 【用户要求 · 续】「空单仓位的占比也不需要」：页面与 PNG 只剩「多单占比」一列（只按 long 排）；
 * helper 仍按方向对称（side 参数），这里把两个方向都钉住，保证多单那一侧不受空单影响。
 */
describe('占比 · 按方向排序', () => {
  const INPUTS = [
    leg('main', 3_000, 3_000),
    short('hedge-a', 300, 300),
    leg('add-small', 500, 1_000),
    short('hedge-pending', 9_000, 9_000, false),
    leg('add-big', 5_000, 5_000),
    short('hedge-b', 900, 900),
    leg('no-values', null, null),
    // 缺开仓价：没有币量占比，按名义仓位占比排
    leg('no-price', null, 2_000),
  ];
  const shares = computeLegPositionShares(INPUTS);
  const ids = INPUTS.map(input => input.legId);
  const sortIds = (sort: LegPositionShareSort | null) => sortByLegPositionShare(ids, id => shares.byLeg.get(id), sort);

  it('按方向的列名：页面与 PNG 只用多单的「多单占比」', () => {
    expect(LEG_POSITION_SHARE_COLUMN_TITLES).toEqual({ long: '多单占比', short: '空单占比' });
  });

  it('排序键：本方向的腿取上行币量占比，没有币量占比时取下行名义仓位占比；别的方向、挂单中、两行都没有的腿没有键', () => {
    const value = (id: string, side: LegPositionSide) => legPositionShareSortValue(shares.byLeg.get(id), side);
    // 多单币量合计 3,000 + 500 + 5,000 = 8,500
    expect(value('main', 'long')).toBeCloseTo((3_000 / 8_500) * 100, 9);
    expect(value('add-big', 'long')).toBeCloseTo((5_000 / 8_500) * 100, 9);
    // 名义合计 3,000 + 1,000 + 5,000 + 2,000 = 11,000
    expect(value('no-price', 'long')).toBeCloseTo((2_000 / 11_000) * 100, 9);
    expect(value('main', 'short')).toBeNull();
    expect(value('hedge-a', 'long')).toBeNull();
    expect(value('hedge-a', 'short')).toBeCloseTo(25, 9);
    expect(value('hedge-pending', 'short')).toBeNull();
    expect(value('no-values', 'long')).toBeNull();
    expect(legPositionShareSortValue(undefined, 'long')).toBeNull();
    // 占比取整为 0 也是有值的键，不当成缺值
    const tiny = computeLegPositionShares([leg('big', 1e9, 1e9), leg('tiny', 1, 1)]);
    expect(formatLegPositionSharePct(tiny.byLeg.get('tiny')!.coinSharePct)).toBe('0.0%');
    expect(legPositionShareSortValue(tiny.byLeg.get('tiny'), 'long')).toBeGreaterThan(0);
  });

  it('多单占比降序：大的在上；没有值的行（空单、挂单中、两行都是「—」）按原来的先后留在最下面', () => {
    // 58.8%（币量）、35.3%（币量）、18.2%（名义，缺开仓价）、5.9%（币量）
    expect(sortIds({ side: 'long', direction: 'desc' })).toEqual([
      'add-big', 'main', 'no-price', 'add-small',
      'hedge-a', 'hedge-pending', 'hedge-b', 'no-values',
    ]);
  });

  it('多单占比升序：小的在上；没有值的行仍在最下面、仍按原来的先后', () => {
    expect(sortIds({ side: 'long', direction: 'asc' })).toEqual([
      'add-small', 'no-price', 'main', 'add-big',
      'hedge-a', 'hedge-pending', 'hedge-b', 'no-values',
    ]);
  });

  it('按空单方向排（helper 对称，页面不用）：只有已计入的空单有值，挂单中的空单与所有多单沉底', () => {
    expect(sortIds({ side: 'short', direction: 'desc' })).toEqual([
      'hedge-b', 'hedge-a',
      'main', 'add-small', 'hedge-pending', 'add-big', 'no-values', 'no-price',
    ]);
    expect(sortIds({ side: 'short', direction: 'asc' })).toEqual([
      'hedge-a', 'hedge-b',
      'main', 'add-small', 'hedge-pending', 'add-big', 'no-values', 'no-price',
    ]);
  });

  it('默认顺序：原样返回传入的先后（新数组，不改动入参）', () => {
    const sorted = sortIds(null);
    expect(sorted).toEqual(ids);
    expect(sorted).not.toBe(ids);
    const before = [...ids];
    sortIds({ side: 'long', direction: 'desc' });
    expect(ids).toEqual(before);
  });

  it('并列时保持原来的先后（稳定排序），升降序都一样', () => {
    const tie = computeLegPositionShares([leg('first', 3_000, 3_000), leg('small', 1_000, 1_000), leg('second', 3_000, 3_000)]);
    const tieIds = ['first', 'small', 'second'];
    expect(sortByLegPositionShare(tieIds, id => tie.byLeg.get(id), { side: 'long', direction: 'desc' }))
      .toEqual(['first', 'second', 'small']);
    expect(sortByLegPositionShare(tieIds, id => tie.byLeg.get(id), { side: 'long', direction: 'asc' }))
      .toEqual(['small', 'first', 'second']);
  });

  it('等额不同价的腿算并列：币量 = 名义 ÷ 开仓价带出的浮点尾差不打乱原来的先后', () => {
    // 三笔各 1,000 币的滚动对冲，开在 1.3 / 1.1 / 0.7：算出来是 1000、999.9999999999999、1000.0000000000001，
    // 页面上都印 1,000 与 33.3%——读者眼里是并列，排序也必须当并列
    const coins = [['h1', 1_300, 1.3], ['h2', 1_100, 1.1], ['h3', 700, 0.7]] as const;
    const noisy = computeLegPositionShares([
      ...coins.map(([id, notional, price]) => short(id, notional / price, notional)),
      leg('main', 3_000, 3_000),
    ]);
    // 前提：原值确实不相等（尾差真实存在），显示却一样
    const pcts = coins.map(([id]) => noisy.byLeg.get(id)!.coinSharePct!);
    expect(new Set(pcts).size).toBeGreaterThan(1);
    expect(new Set(pcts.map(formatLegPositionSharePct))).toEqual(new Set(['33.3%']));
    const noisyIds = ['h1', 'h2', 'h3', 'main'];
    for (const direction of ['desc', 'asc'] as const) {
      expect(sortByLegPositionShare(noisyIds, id => noisy.byLeg.get(id), { side: 'short', direction }))
        .toEqual(['h1', 'h2', 'h3', 'main']);
    }
    // 真正不同的数仍按大小排（哪怕只差一点点）
    const close = computeLegPositionShares([short('a', 1_000, 1_000), short('b', 1_001, 1_001), short('c', 999, 999)]);
    expect(sortByLegPositionShare(['a', 'b', 'c'], id => close.byLeg.get(id), { side: 'short', direction: 'desc' }))
      .toEqual(['b', 'a', 'c']);
    expect(sortByLegPositionShare(['a', 'b', 'c'], id => close.byLeg.get(id), { side: 'short', direction: 'asc' }))
      .toEqual(['c', 'a', 'b']);
  });

  it('点击循环：降序 → 升序 → 默认顺序；点另一列从降序开始', () => {
    expect(nextLegPositionShareSort(null, 'long')).toEqual({ side: 'long', direction: 'desc' });
    expect(nextLegPositionShareSort({ side: 'long', direction: 'desc' }, 'long')).toEqual({ side: 'long', direction: 'asc' });
    expect(nextLegPositionShareSort({ side: 'long', direction: 'asc' }, 'long')).toBeNull();
    expect(nextLegPositionShareSort({ side: 'long', direction: 'asc' }, 'short')).toEqual({ side: 'short', direction: 'desc' });
    expect(nextLegPositionShareSort({ side: 'short', direction: 'desc' }, 'long')).toEqual({ side: 'long', direction: 'desc' });
  });

  it('表头按钮的说明：写明当前状态与下一次点击做什么', () => {
    expect(describeLegPositionShareSort('long', null)).toBe('按多单占比排序：当前默认顺序，点击改为降序');
    expect(describeLegPositionShareSort('long', { side: 'long', direction: 'desc' })).toBe('按多单占比排序：当前降序，点击改为升序');
    expect(describeLegPositionShareSort('long', { side: 'long', direction: 'asc' })).toBe('按多单占比排序：当前升序，点击恢复默认顺序');
    expect(describeLegPositionShareSort('short', { side: 'long', direction: 'asc' })).toBe('按空单占比排序：当前按多单占比排序，点击改为按空单占比降序');
    expect(describeLegPositionShareSort('short', { side: 'short', direction: 'desc' })).toBe('按空单占比排序：当前降序，点击改为升序');
  });
});
