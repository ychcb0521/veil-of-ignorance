/**
 * 【用户要求】战役列表「涨幅」排序：涨幅按主力单的涨幅——就是详情页 Legs 表主力那一行「涨跌幅」格里的数。
 */
import { describe, expect, it } from 'vitest';
import {
  campaignHasMainAdd,
  campaignMainLegPriceChangePct,
  campaignMainLegPriceChanges,
  computeAddEfficiency,
  computeMainPriceEfficiency,
  counterfactualHasMainAdd,
  counterfactualMainLegPriceChangePct,
  formatEfficiency,
} from '@/lib/campaignMainPriceChange';
import type { CampaignCounterfactualManualLeg, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const leg = (over: Partial<TradeJournal>): TradeJournal => ({
  id: 'main', leg_role: 'main_open', direction: 'long', trade_record_id: 'r-main',
  pre_simulated_time: '2026-01-01T00:00:00.000Z', pre_entry_price: 100, pre_position_size: 10_000,
  ...over,
} as TradeJournal);

const record = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'r-main', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice: 100, exitPrice: 112, quantity: 100, leverage: 10, pnl: 1200, fee: 0, slippage: 0,
  openTime: Date.parse('2026-01-01T00:00:00.000Z'), closeTime: Date.parse('2026-01-02T00:00:00.000Z'),
  ...over,
});

describe('主力涨幅（战役列表「涨幅」排序）', () => {
  it('多单：（平仓价 − 开仓价）÷ 开仓价', () => {
    expect(campaignMainLegPriceChangePct([leg({})], [record({})])).toBeCloseTo(12, 9);
  });

  it('主空战役：按主力方向计，价格跌了是正数（与 Legs 表同号规则）', () => {
    const short = leg({ direction: 'short' });
    expect(campaignMainLegPriceChangePct([short], [record({ side: 'SHORT', exitPrice: 90 })])).toBeCloseTo(10, 9);
    expect(campaignMainLegPriceChangePct([short], [record({ side: 'SHORT', exitPrice: 105 })])).toBeCloseTo(-5, 9);
  });

  it('主力还没平仓：没有平仓价，返回 null（Legs 表显示「—」）', () => {
    expect(campaignMainLegPriceChangePct([leg({ trade_record_id: null })], [])).toBeNull();
    expect(campaignMainLegPriceChangePct([], [])).toBeNull();
  });

  it('用与 Legs 表同一份平仓价校正：错记的平仓价按 K 线校正后的价算', () => {
    const corrections = { main: { exitPrice: 104, originalExitPrice: 160, candleLow: 99, candleHigh: 105 } };
    expect(campaignMainLegPriceChangePct([leg({})], [record({ exitPrice: 160 })], corrections)).toBeCloseTo(4, 9);
  });

  it('【用户要求】多笔主力时取涨幅最大的那一笔（不看名义大小），不看对冲腿、加仓腿', () => {
    // NEARUSDT 那场：主力开仓 1 +14.43%、主力开仓 2 +4.39%、主力开仓 3（名义最大）+0.79% → 取 +14.43%
    const legs = [
      leg({ id: 'main-1', trade_record_id: 'r-1', pre_position_size: 85_136 }),
      leg({ id: 'main-2', trade_record_id: 'r-2', pre_position_size: 74_975 }),
      leg({ id: 'main-3', trade_record_id: 'r-3', pre_position_size: 240_171 }),
      leg({ id: 'add', leg_role: 'main_add_1', trade_record_id: 'r-add', pre_position_size: 50_000 }),
      leg({ id: 'hedge', leg_role: 'hedge_initial_a', direction: 'short', trade_record_id: 'r-hedge', pre_position_size: 99_999 }),
    ];
    const records = [
      record({ id: 'r-1', exitPrice: 114.43 }),
      record({ id: 'r-2', exitPrice: 104.39 }),
      record({ id: 'r-3', exitPrice: 100.79 }),
      record({ id: 'r-add', exitPrice: 150 }),
      record({ id: 'r-hedge', side: 'SHORT', exitPrice: 80 }),
    ];
    expect(campaignMainLegPriceChangePct(legs, records)).toBeCloseTo(14.43, 9);
    expect(Object.fromEntries(campaignMainLegPriceChanges(legs, records))).toEqual({
      'main-1': expect.closeTo(14.43, 9), 'main-2': expect.closeTo(4.39, 9), 'main-3': expect.closeTo(0.79, 9),
    });
  });

  it('多笔主力都亏：取亏得最少的那笔（最大值）；还没平仓的主力不参与，全没平仓才是 null', () => {
    const legs = [
      leg({ id: 'a', trade_record_id: 'r-a' }),
      leg({ id: 'b', trade_record_id: 'r-b' }),
      leg({ id: 'open', trade_record_id: null }),
    ];
    const records = [record({ id: 'r-a', exitPrice: 90 }), record({ id: 'r-b', exitPrice: 97 })];
    expect(campaignMainLegPriceChangePct(legs, records)).toBeCloseTo(-3, 9);
    expect(campaignMainLegPriceChangePct([leg({ id: 'open', trade_record_id: null })], [])).toBeNull();
  });

  it('没有 main_open 时才退到 reentry_main（与主力的角色分档一致）', () => {
    const legs = [
      leg({ id: 're', leg_role: 'reentry_main', trade_record_id: 'r-re' }),
    ];
    expect(campaignMainLegPriceChangePct(legs, [record({ id: 'r-re', exitPrice: 108 })])).toBeCloseTo(8, 9);
    // 有 main_open 时 reentry_main 不参与
    const mixed = [leg({ id: 'main' }), ...legs];
    expect(campaignMainLegPriceChangePct(mixed, [record({}), record({ id: 'r-re', exitPrice: 150 })])).toBeCloseTo(12, 9);
  });
});

describe('涨幅效率 / 加仓效率', () => {
  it('涨幅效率 = 主力涨幅 ÷ 预期回撤；加仓效率 = 盈亏比 ÷ 涨幅效率', () => {
    expect(computeMainPriceEfficiency(12, 4)).toBeCloseTo(3, 9);
    expect(computeAddEfficiency(6, 3)).toBeCloseTo(2, 9);
    // 只拿主力不加仓：b 就是涨幅效率，加仓效率恰为 1
    expect(computeAddEfficiency(3, computeMainPriceEfficiency(12, 4))).toBeCloseTo(1, 9);
  });

  it('算不出就是 null：主力未平仓、预期回撤不为正、涨幅效率为 0', () => {
    expect(computeMainPriceEfficiency(null, 4)).toBeNull();
    expect(computeMainPriceEfficiency(12, 0)).toBeNull();
    expect(computeAddEfficiency(null, 3)).toBeNull();
    expect(computeAddEfficiency(2, 0)).toBeNull();
    expect(computeAddEfficiency(2, null)).toBeNull();
  });

  it('读数带符号、两位小数，取整为 0 写 0.00，缺值「—」', () => {
    expect(formatEfficiency(3)).toBe('+3.00');
    expect(formatEfficiency(-0.754)).toBe('-0.75');
    expect(formatEfficiency(0.001)).toBe('0.00');
    expect(formatEfficiency(null)).toBe('—');
  });
});

describe('反事实里的主力涨幅', () => {
  const manual = (over: Partial<CampaignCounterfactualManualLeg>): CampaignCounterfactualManualLeg => ({
    id: 'main', leg_role: 'main_open', direction: 'long',
    open_time: '2026-01-01T00:00:00.000Z', close_time: '2026-01-02T00:00:00.000Z',
    entry_price: 100, exit_price: 112, size_usdt: 10_000, leverage: 10, enabled: true,
    actual: {
      source: 'records', direction: 'long',
      open_time: '2026-01-01T00:00:00.000Z', close_time: '2026-01-02T00:00:00.000Z',
      entry_price: 100, exit_price: 112, size_usdt: 10_000, realized_pnl_usdt: 1200,
      close_fee_usdt: 0, open_fee_usdt: 0,
    },
    ...over,
  } as CampaignCounterfactualManualLeg);

  it('主力开平价没改：沿用真实一侧这条腿的数（哪怕副本还原的开平价与 Legs 表那一行不是同一对）', () => {
    expect(counterfactualMainLegPriceChangePct([manual({})], { byLegId: { main: 9.98 }, pct: 9.98 })).toBe(9.98);
    expect(counterfactualMainLegPriceChangePct([manual({})], { byLegId: { main: null }, pct: null })).toBeNull();
  });

  it('改了平仓价：按副本里改后的开平价算（按方向计）', () => {
    expect(counterfactualMainLegPriceChangePct([manual({ exit_price: 120 })], { byLegId: { main: 12 }, pct: 12 })).toBeCloseTo(20, 9);
    const short = manual({ direction: 'short', exit_price: 90, actual: { ...manual({}).actual!, direction: 'short', exit_price: 95 } });
    expect(counterfactualMainLegPriceChangePct([short], { byLegId: { main: 5 }, pct: 5 })).toBeCloseTo(10, 9);
  });

  it('【用户要求】多笔主力取涨幅最大：没改的沿用真实值、改过的重算，停用的不参与', () => {
    const actual = { byLegId: { 'main-1': 14.43, 'main-2': 4.39, 'main-3': 0.79 }, pct: 14.43 };
    const three = [manual({ id: 'main-1' }), manual({ id: 'main-2' }), manual({ id: 'main-3' })];
    // 原样重跑：逐腿沿用真实值，取最大 → 与真实「盈亏概览」逐位相同
    expect(counterfactualMainLegPriceChangePct(three, actual)).toBe(14.43);
    // 停用涨幅最大的那笔：换成剩下里最大的
    expect(counterfactualMainLegPriceChangePct([{ ...three[0], enabled: false }, three[1], three[2]], actual)).toBe(4.39);
    // 改了第三笔的平仓价（+25%）：它按副本重算，成为最大
    expect(counterfactualMainLegPriceChangePct([three[0], three[1], { ...three[2], exit_price: 125 }], actual)).toBeCloseTo(25, 9);
  });

  it('真实一侧没有的主力按副本算；实际未平仓、平仓价没改时不算', () => {
    const legs = [
      manual({ enabled: false }),
      manual({ id: 'small', size_usdt: 100, exit_price: 150, actual: { ...manual({}).actual!, exit_price: 150 } }),
      manual({ id: 'big', size_usdt: 5_000, exit_price: 110, actual: { ...manual({}).actual!, exit_price: 110 } }),
    ];
    // 停用了真实的主力，剩下两条真实一侧都没记 → 各按副本算，取最大（+50%，不按仓位挑）
    expect(counterfactualMainLegPriceChangePct(legs, { byLegId: { main: 12 }, pct: 12 })).toBeCloseTo(50, 9);
    const stillOpen = [
      manual({ id: 'big', exit_price: 105, actual: { ...manual({}).actual!, exit_price: 105, still_open: true } }),
    ];
    expect(counterfactualMainLegPriceChangePct(stillOpen, null)).toBeNull();
    // 用户给这条未平仓的主力定了平仓价：按改后的价算
    expect(counterfactualMainLegPriceChangePct([{ ...stillOpen[0], exit_price: 130 }], null)).toBeCloseTo(30, 9);
  });

  it('没有主力：null', () => {
    expect(counterfactualMainLegPriceChangePct([manual({ leg_role: 'hedge_initial_a' })], null)).toBeNull();
    expect(counterfactualMainLegPriceChangePct([], null)).toBeNull();
  });
});

describe('【用户要求】加仓效率只算做过加仓的战役', () => {
  const journal = (over: Partial<TradeJournal>) => ({ leg_role: 'main_open', trade_record_id: null, ...over } as TradeJournal);

  it('有成交过的加仓腿（带成交 id 或已有结算结果）才算做过加仓', () => {
    expect(campaignHasMainAdd([journal({}), journal({ leg_role: 'main_add_1', trade_record_id: 'r-add' })])).toBe(true);
    expect(campaignHasMainAdd([journal({ leg_role: 'main_add_2', post_realized_pnl: 12 })])).toBe(true);
    expect(campaignHasMainAdd([journal({ leg_role: 'main_add_1', post_real_close_time: '2026-01-02T00:00:00.000Z' })])).toBe(true);
  });

  it('只有主力 / 对冲 / 镜像，或加仓腿连成交 id 都没有：不算', () => {
    expect(campaignHasMainAdd([journal({}), journal({ leg_role: 'hedge_initial_a', trade_record_id: 'h' }), journal({ leg_role: 'mirror_tp', trade_record_id: 'm' })])).toBe(false);
    expect(campaignHasMainAdd([journal({ leg_role: 'main_add_1' })])).toBe(false);
    expect(campaignHasMainAdd([])).toBe(false);
  });

  it('反事实：参与运行、成交了的加仓腿才算', () => {
    const add = { leg_role: 'main_add_1', enabled: true } as CampaignCounterfactualManualLeg;
    expect(counterfactualHasMainAdd([add])).toBe(true);
    expect(counterfactualHasMainAdd([{ ...add, enabled: false }])).toBe(false);
    expect(counterfactualHasMainAdd([{ ...add, filled: false }])).toBe(false);
    expect(counterfactualHasMainAdd([{ ...add, leg_role: 'main_open' }])).toBe(false);
  });
});

describe('【用户要求】加仓效率门槛：涨幅效率为正才算', () => {
  it('涨幅效率为负：不算（亏损战役负负得正不再排到最前）', () => {
    expect(computeAddEfficiency(-0.68, -0.05)).toBeNull();
    expect(computeAddEfficiency(2, -1)).toBeNull();
  });
  it('涨幅效率显示为 0.00（接近 0）：不算，分母过小不再把比值放大成十几倍', () => {
    expect(computeAddEfficiency(0.59, 0.004)).toBeNull();
    expect(computeAddEfficiency(0.59, 0)).toBeNull();
  });
  it('涨幅效率为正：照算，盈亏比为负时读数为负', () => {
    expect(computeAddEfficiency(0.59, 0.04)).toBeCloseTo(14.75, 9);
    expect(computeAddEfficiency(-1, 2)).toBeCloseTo(-0.5, 9);
  });
});
