/**
 * 【用户要求】战役列表「涨幅」排序：涨幅按主力单的涨幅——就是详情页 Legs 表主力那一行「涨跌幅」格里的数。
 */
import { describe, expect, it } from 'vitest';
import { campaignMainLegPriceChangePct } from '@/lib/campaignMainPriceChange';
import type { TradeJournal } from '@/types/journal';
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
