import { describe, expect, it } from 'vitest';
import { buildCampaignLegTheoreticalFactors } from '@/lib/campaignLegGeometricFactor';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';

const T0 = Date.parse('2026-09-01T10:00:00+08:00');
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const leg = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: ++seq,
  source: 'retroactive_from_record', symbol: 'TESTUSDT', direction: 'long', leverage: 10,
  position_mode: 'isolated', order_kind: 'main', pre_simulated_time: iso(T0),
  created_at: iso(T0), updated_at: iso(T0), ...over,
} as TradeJournal);
const stop = (price: number, createdAt: number): CampaignReverseHedgeOrder => ({
  id: `stop-${price}-${createdAt}`, side: 'SHORT', price, createdAt, triggeredAt: null, cancelledAt: null, status: 'pending',
});

/** 主多 10,000 币 @1；加仓1 在 t1（K 1.1、T 1.3），加仓2 在 t2（K 1.2、T 1.4）。 */
function run(hedgeBeforeAdd1: number, hedgeBetweenAdds: number) {
  const t1 = T0 + 120 * MIN, t2 = T0 + 240 * MIN;
  const legs = [
    leg({ id: 'main', pre_entry_price: 1, pre_position_size: 10_000, post_simulated_close_time: iso(t2 + 600 * MIN) }),
    leg({ id: 'mirror', leg_role: 'mirror_tp', pre_entry_price: 1, pre_position_size: 5_000,
      post_simulated_close_time: iso(T0 + 60 * MIN), post_realized_pnl: 500 }),
    leg({ id: 'hedge-a', leg_role: 'hedge_initial_a', direction: 'short', pre_simulated_time: iso(T0 + 30 * MIN),
      pre_entry_price: 1.05, pre_position_size: 2_000, post_simulated_close_time: iso(T0 + 90 * MIN), post_realized_pnl: hedgeBeforeAdd1 }),
    leg({ id: 'add1', leg_role: 'main_add_1', pre_simulated_time: iso(t1), pre_entry_price: 1.3, pre_position_size: 1_000 * 1.3, post_simulated_close_time: iso(t2 + 600 * MIN) }),
    leg({ id: 'hedge-b', leg_role: 'hedge_rolling', direction: 'short', pre_simulated_time: iso(t1 + 30 * MIN),
      pre_entry_price: 1.35, pre_position_size: 2_000, post_simulated_close_time: iso(t1 + 90 * MIN), post_realized_pnl: hedgeBetweenAdds }),
    leg({ id: 'add2', leg_role: 'main_add_2', pre_simulated_time: iso(t2), pre_entry_price: 1.4, pre_position_size: 500 * 1.4, post_simulated_close_time: iso(t2 + 600 * MIN) }),
  ];
  return buildCampaignLegTheoreticalFactors({ legs, tradeRecords: [], reverseHedgeOrders: [stop(1.1, t1 - MIN), stop(1.2, t2 - MIN)] });
}

describe('【用户要求】几何仓位（理论）：中途对冲空单的盈亏与加仓计算器「空单盈亏」同一口径', () => {
  it('首次加仓：空单盈利加进 G，亏损带「−」扣掉', () => {
    expect(run(0, 0).get('add1')!.bankedProfit).toBeCloseTo(500, 6);
    expect(run(120, 0).get('add1')!.bankedProfit).toBeCloseTo(620, 6);
    expect(run(-120, 0).get('add1')!.bankedProfit).toBeCloseTo(380, 6);
    const gain = run(120, 0).get('add1')!, loss = run(-120, 0).get('add1')!;
    expect(gain.alpha).toBeGreaterThan(loss.alpha);
  });

  it('之后的加仓只计上一次加仓之后才平掉的空单盈亏，前面那笔不重复计', () => {
    expect(run(120, 0).get('add2')!.bankedProfit).toBeCloseTo(0, 6);
    expect(run(120, 80).get('add2')!.bankedProfit).toBeCloseTo(80, 6);
    expect(run(120, -80).get('add2')!.bankedProfit).toBeCloseTo(-80, 6);
    const plain = run(120, 0).get('add2')!, loss = run(120, -80).get('add2')!;
    expect(loss.adjustedSupport).toBeCloseTo(plain.support - 80 / plain.beforeCoins, 9);
    expect(loss.alpha).toBeLessThan(plain.alpha);
  });
});
