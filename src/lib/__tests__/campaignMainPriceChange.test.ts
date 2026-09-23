/**
 * 【用户要求】战役列表「涨幅」排序：涨幅按主力单的涨幅——就是详情页 Legs 表主力那一行「涨跌幅」格里的数。
 */
import { describe, expect, it } from 'vitest';
import {
  campaignMainLegPriceChangePct,
  computeAddEfficiency,
  computeMainPriceEfficiency,
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

  it('多笔主力时取名义最大的那一笔（pickPrimaryMainLeg），不看对冲腿', () => {
    const legs = [
      leg({ id: 'tiny', trade_record_id: 'r-tiny', pre_position_size: 100 }),
      leg({ id: 'main' }),
      leg({ id: 'hedge', leg_role: 'hedge_initial_a', direction: 'short', trade_record_id: 'r-hedge', pre_position_size: 99_999 }),
    ];
    const records = [
      record({ id: 'r-tiny', exitPrice: 200 }),
      record({}),
      record({ id: 'r-hedge', side: 'SHORT', exitPrice: 80 }),
    ];
    expect(campaignMainLegPriceChangePct(legs, records)).toBeCloseTo(12, 9);
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

  it('主力开平价没改：沿用真实「盈亏概览」的数（哪怕副本还原的开平价与 Legs 表那一行不是同一对）', () => {
    expect(counterfactualMainLegPriceChangePct([manual({})], { legId: 'main', pct: 9.98 })).toBe(9.98);
    expect(counterfactualMainLegPriceChangePct([manual({})], { legId: 'main', pct: null })).toBeNull();
  });

  it('改了平仓价：按副本里改后的开平价算（按方向计）', () => {
    expect(counterfactualMainLegPriceChangePct([manual({ exit_price: 120 })], { legId: 'main', pct: 12 })).toBeCloseTo(20, 9);
    const short = manual({ direction: 'short', exit_price: 90, actual: { ...manual({}).actual!, direction: 'short', exit_price: 95 } });
    expect(counterfactualMainLegPriceChangePct([short], { legId: 'main', pct: 5 })).toBeCloseTo(10, 9);
  });

  it('真实选中的主力被停用：在参与运行的主力里取「仓位」最大的那条；它实际未平仓、平仓价没改时不算', () => {
    const legs = [
      manual({ enabled: false }),
      manual({ id: 'small', size_usdt: 100, exit_price: 150 }),
      manual({ id: 'big', size_usdt: 5_000, exit_price: 110, actual: { ...manual({}).actual!, exit_price: 110 } }),
    ];
    expect(counterfactualMainLegPriceChangePct(legs, { legId: 'main', pct: 12 })).toBeCloseTo(10, 9);
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
