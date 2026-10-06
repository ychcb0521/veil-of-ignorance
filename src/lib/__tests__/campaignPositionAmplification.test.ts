import { describe, expect, it } from 'vitest';
import { computeCampaignPositionAmplification, computePositionAmplification } from '@/lib/campaignPositionAmplification';
import { buildCampaignPnlOverviewItems } from '@/lib/campaignPnlOverview';
import { rowPositionAmplification, type CampaignSortRow } from '@/lib/campaignListSort';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const NOW = '2026-06-25T15:58:00.000Z';
const campaign = (over: Partial<TradeCampaign> = {}): TradeCampaign => ({
  id: 'c1', user_id: 'u', campaign_code: 'C-1', symbol: 'HEIUSDT', direction: 'main_long', status: 'closed_profit',
  strategy_template: 'custom', title: 'HEI', opened_at: NOW, closed_at: NOW, initial_main_size_usdt: null,
  initial_leverage: 10, final_realized_pnl: 0, actual_evolution: [], deviation_notes: {}, deleted_at: null,
  created_at: NOW, updated_at: NOW, ...over,
} as unknown as TradeCampaign);
const leg = (id: string, role: TradeJournal['leg_role'], notional: number | null, over: Partial<TradeJournal> = {}): TradeJournal => ({
  id, user_id: 'u', campaign_id: 'c1', trade_record_id: `${id}-record`, leg_role: role, leg_sequence: null, source: 'post_review',
  symbol: 'HEIUSDT', direction: 'long', leverage: 10, order_kind: 'main', pre_simulated_time: NOW, pre_real_time: NOW,
  pre_entry_price: 0.16, pre_position_size: notional, post_real_close_time: NOW, created_at: NOW, updated_at: NOW, ...over,
} as unknown as TradeJournal);
/** 成交记录与腿对得上：数量 = 名义 ÷ 开仓价。 */
const record = (id: string, notional = 100_000): TradeRecord => ({
  id: `${id}-record`, symbol: 'HEIUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: 0.16, exitPrice: 0.17,
  quantity: notional / 0.16, leverage: 10, pnl: 1, fee: 0, slippage: 0, openTime: 1, closeTime: 2,
} as unknown as TradeRecord);

describe('仓位放大 = 主方向总名义仓位 ÷ 主力开仓名义仓位', () => {
  it('算式：两项都要读得出，主力开仓名义仓位要为正', () => {
    expect(computePositionAmplification(100_000, 350_000)).toBe(3.5);
    expect(computePositionAmplification(100_000, 100_000)).toBe(1);
    expect(computePositionAmplification(0, 100_000)).toBeNull();
    expect(computePositionAmplification(-5, 100_000)).toBeNull();
    expect(computePositionAmplification(null, 100_000)).toBeNull();
    expect(computePositionAmplification(100_000, null)).toBeNull();
    expect(computePositionAmplification(100_000, Number.NaN)).toBeNull();
    expect(computePositionAmplification(Number.POSITIVE_INFINITY, 1)).toBeNull();
  });

  it('只有主力：1.00；加仓两次：累计名义 ÷ 主力开仓名义；反向对冲不计', () => {
    const main = leg('main', 'main_open', 100_000);
    const only = computeCampaignPositionAmplification(campaign(), [main], [record('main')]);
    expect(only).toBe(1);
    const legs = [
      main,
      leg('add1', 'main_add_1', 150_000),
      leg('add2', 'main_add_2', 100_000),
      leg('hedge', 'hedge_rolling_1' as TradeJournal['leg_role'], 80_000, { direction: 'short' }),
    ];
    const records = [record('main'), record('add1', 150_000), record('add2', 100_000), record('hedge', 80_000)];
    expect(computeCampaignPositionAmplification(campaign(), legs, records)).toBeCloseTo(3.5, 10);
  });

  it('读不出主力开仓名义仓位时算不出', () => {
    expect(computeCampaignPositionAmplification(campaign(), [leg('main', 'main_open', null)], [record('main')])).toBeNull();
    expect(computeCampaignPositionAmplification(campaign(), [], [])).toBeNull();
  });

  it('封面 / 排序 / 导出读的那个数：建卡时算好的优先，没有这个字段的行按腿现算一次', () => {
    const legs = [leg('main', 'main_open', 100_000), leg('add1', 'main_add_1', 150_000)];
    const records = [record('main'), record('add1', 150_000)];
    const base = { campaign: campaign(), legs, tradeRecords: records } as unknown as CampaignSortRow;
    expect(rowPositionAmplification(base)).toBeCloseTo(2.5, 10);
    // 同一个行对象不重算（把腿改掉也仍是那次的结果）
    base.legs.push(leg('add2', 'main_add_2', 100_000));
    expect(rowPositionAmplification(base)).toBeCloseTo(2.5, 10);
    // 建卡时算好的读数优先；null = 建卡时就算不出，不再按腿去猜
    expect(rowPositionAmplification({ ...base, positionAmplification: 7.66 })).toBe(7.66);
    expect(rowPositionAmplification({ ...base, positionAmplification: null })).toBeNull();
  });

  it('详情页盈亏概览同名项读的是同一个算式', () => {
    const items = buildCampaignPnlOverviewItems({
      realizedPnl: 0, mainLeverage: 10, initialMainExposureNotional: 100_000, initialExpectedMaxLoss: 100,
      mainSideNotional: { side: 'long', total: 766_000 }, expectedMaxDrawdownPct: 2, payoffRatio: null,
      mainPriceChangePct: null, hasMainAdd: true,
    } as unknown as Parameters<typeof buildCampaignPnlOverviewItems>[0]);
    expect(items.find(item => item.key === 'positionAmplification')?.value).toBe('7.66x');
    expect(computePositionAmplification(100_000, 766_000)).toBeCloseTo(7.66, 10);
  });
});
