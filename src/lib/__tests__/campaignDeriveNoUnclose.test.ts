/**
 * 「已结束的战役时不时冒出来变成进行中」的回归守卫。
 *
 * 机制（2026-08 定位）：getCampaignFullData 每次读战役都会跑
 * healCampaignSummarySnapshots → deriveCampaignPatchFromLegs → **UPDATE 回数据库**。
 * 而 derive 里的 closed_at 是从 localStorage 的 trade_history 里查 closeTime 拼出来的：
 *
 *   const closeTimes = ordered.map(leg => tradeRecordMap.get(leg.trade_record_id)?.closeTime ?? null).filter(...)
 *   const closedAt = allHaveTradeRecord && closeTimes.length === ordered.length ? ... : null;
 *
 * 于是只要本地 trade_history 里查不到那几条成交（用户在「历史成交」里删过、
 * 换了浏览器、云端水化还没跑完、或者腿上存的是仓位 id 而记录已被清理），
 * derive 就会得出 closed_at = null / status = 'active' 并**写回库**——
 * 一场早就打完的战役被永久改回「进行中」。这也正是「一键结束点了没作用」的原因：
 * 结束写进去了，下一次打开列表页又被 heal 改回来。
 *
 * 本地成交历史是**缓存**，不是真相。查不到记录只能说明「算不出来」，
 * 绝不等于「这场还没结束」。derive 因此永远不许把已有的结束状态降级。
 */
import { describe, expect, it } from 'vitest';
import { deriveCampaignPatchFromLegs } from '@/lib/journalApi';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const CLOSED_AT = '2026-04-11T02:30:00.000Z';

const campaign = (over: Partial<TradeCampaign> = {}): TradeCampaign =>
  ({
    id: 'c1', user_id: 'u1', symbol: 'RAVEUSDT', direction: 'main_long',
    status: 'closed_profit', strategy_template: 'custom', title: 'RAVEUSDT 多战役',
    opened_at: '2026-04-10T00:00:00.000Z', closed_at: CLOSED_AT,
    final_realized_pnl: 1200, final_r_multiple: null,
    actual_evolution: [], ...over,
  } as TradeCampaign);

const leg = (id: string, over: Partial<TradeJournal> = {}): TradeJournal =>
  ({
    id, user_id: 'u1', symbol: 'RAVEUSDT', direction: 'long', order_kind: 'main',
    leg_role: 'main_open', trade_record_id: null, post_realized_pnl: null,
    pre_simulated_time: '2026-04-10T00:00:00.000Z', pre_max_loss_usdt: null,
    ...over,
  } as TradeJournal);

const rec = (id: string, pnl: number): TradeRecord =>
  ({ id, symbol: 'RAVEUSDT', side: 'LONG', action: 'CLOSE', pnl,
     openTime: Date.parse('2026-04-10T00:00:00.000Z'),
     closeTime: Date.parse(CLOSED_AT) } as TradeRecord);

describe('deriveCampaignPatchFromLegs 不许把已结束的战役降级', () => {
  it('本地成交历史被删空时，不把 closed_at 抹成 null', () => {
    // 腿上有 trade_record_id，但本地 trade_history 已经查不到那条记录了
    const legs = [leg('main', { trade_record_id: 'r1', post_realized_pnl: 1200 })];
    const patch = deriveCampaignPatchFromLegs(campaign(), legs, []);
    expect(patch.closed_at).toBe(CLOSED_AT);
    expect(patch.status).not.toBe('active');
  });

  it('本地成交历史被删空时，不把 status 打回 active', () => {
    const legs = [
      leg('main', { trade_record_id: 'r1', post_realized_pnl: 900 }),
      leg('hedge', { trade_record_id: 'r2', post_realized_pnl: 300, leg_role: 'hedge_initial_a' }),
    ];
    const patch = deriveCampaignPatchFromLegs(campaign({ status: 'closed_profit' }), legs, []);
    expect(patch.status).toBe('closed_profit');
    expect(patch.closed_at).toBe(CLOSED_AT);
  });

  it('腿上根本没有 trade_record_id（纯回填战役）也不许被降级', () => {
    // 这类战役只有 post_realized_pnl，是用「结束战役」对话框手工结束的
    const legs = [leg('main', { post_realized_pnl: 500 })];
    const patch = deriveCampaignPatchFromLegs(campaign({ status: 'closed_profit' }), legs, []);
    expect(patch.closed_at).toBe(CLOSED_AT);
    expect(patch.status).toBe('closed_profit');
  });

  it('成交记录齐全时照常算出 closed_at 与状态——修法不能把正常推导也一起关掉', () => {
    const legs = [leg('main', { trade_record_id: 'r1' })];
    const patch = deriveCampaignPatchFromLegs(
      campaign({ status: 'active', closed_at: null, final_realized_pnl: null }),
      legs,
      [rec('r1', 1200)],
    );
    expect(patch.closed_at).toBe(CLOSED_AT);
    expect(patch.status).toBe('closed_profit');
    expect(patch.final_realized_pnl).toBeCloseTo(1200, 8);
  });

  it('本来就还在进行中的战役，不会被这条保护误判成已结束', () => {
    // closed_at 本来就是 null，腿也没结算 —— 保护的是「已有的结束状态」，不是凭空造一个
    const legs = [leg('main', { trade_record_id: 'r1' }), leg('open2')];
    const patch = deriveCampaignPatchFromLegs(
      campaign({ status: 'active', closed_at: null, final_realized_pnl: null }),
      legs,
      [rec('r1', 100)],
    );
    expect(patch.closed_at).toBeNull();
    expect(patch.status).toBe('active');
  });
});
