import { describe, expect, it } from 'vitest';
import { LEG_ROW_STATUS_HINTS, LEG_ROW_STATUS_LABELS, legRowStatus } from '@/lib/legRowStatus';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/** Legs 表（页面与导出 PNG）共用的腿状态规则：已平仓 / 爆仓 / 挂单中 / 进行中。 */
describe('legRowStatus', () => {
  const leg = (over: Partial<TradeJournal>) => ({ leg_role: 'main_open', ...over }) as TradeJournal;
  const record = { id: 'r' } as TradeRecord;

  it('有成交记录，或腿上记着平仓时间 / 结果：已平仓', () => {
    expect(legRowStatus(leg({ leg_role: 'hedge_initial_a' }), record)).toBe('closed');
    expect(legRowStatus(leg({ post_simulated_close_time: '2026-08-07T01:00:00Z' }), null)).toBe('closed');
    expect(legRowStatus(leg({ leg_role: 'mirror_tp', post_real_close_time: '2026-08-07T01:00:00Z' }), null)).toBe('closed');
    expect(legRowStatus(leg({ leg_role: 'hedge_rolling', post_outcome: 'win' }), null)).toBe('closed');
  });

  it('成交记录是强平：爆仓（页面与导出 PNG 都据此画红色的「爆仓」）', () => {
    const liquidation = { id: 'r', action: 'LIQUIDATION' } as TradeRecord;
    expect(legRowStatus(leg({}), liquidation)).toBe('liquidated');
    // 老记录没有 action，只有 exit_method
    expect(legRowStatus(leg({}), { id: 'r', exit_method: 'liquidation' } as TradeRecord)).toBe('liquidated');
    // 全仓强平不带 bankruptcy 标记，同样是爆仓
    expect(legRowStatus(leg({ leg_role: 'mirror_tp' }), { id: 'r', action: 'LIQUIDATION' } as TradeRecord)).toBe('liquidated');
    expect(legRowStatus(leg({}), { id: 'r', action: 'CLOSE', exit_method: 'sl' } as TradeRecord)).toBe('closed');
  });

  it('没平仓、腿上也没有任何成交 id 的对冲 / 镜像腿：挂单中（没有成交凭据）', () => {
    for (const role of ['hedge_initial_a', 'hedge_initial_b', 'hedge_rolling', 'mirror_tp'] as const) {
      expect(legRowStatus(leg({ leg_role: role }), null)).toBe('pending');
    }
  });

  describe('【用户要求】挂单中按成交判定：已成交、还没平仓的对冲 / 镜像腿是进行中', () => {
    const hedge = leg({ id: 'h', leg_role: 'hedge_initial_a', trade_record_id: 'order-1' });
    const order = (status: CampaignReverseHedgeOrder['status'], over: Partial<CampaignReverseHedgeOrder> = {}) => ({
      id: 'order-1', side: 'SHORT', price: 90, createdAt: 1, cancelledAt: null, status, ...over,
    }) as CampaignReverseHedgeOrder;

    it('腿上存的是某张反向委托的 id：已触发 → 进行中；仍挂着 / 已撤 → 挂单中', () => {
      expect(legRowStatus(hedge, null, { orders: [order('triggered')] })).toBe('open');
      expect(legRowStatus(hedge, null, { orders: [order('pending')] })).toBe('pending');
      expect(legRowStatus(hedge, null, { orders: [order('cancelled')] })).toBe('pending');
      // 别的回放留下的委托不作证据
      expect(legRowStatus(hedge, null, { orders: [order('pending', { foreignReplay: true })] })).toBe('open');
    });

    it('本地委托证明从未成交（还挂着或撤了）：挂单中，优先于其它证据', () => {
      expect(legRowStatus(hedge, null, { unfilledOrderIds: new Set(['order-1']), orders: [order('triggered')] })).toBe('pending');
    });

    it('有成交 id、又查不到没成交的证据（立即成交的仓位 id、换了浏览器）：进行中', () => {
      expect(legRowStatus(hedge, null)).toBe('open');
      expect(legRowStatus(leg({ leg_role: 'mirror_tp', trade_record_id: 'fill-9' }), null, { orders: [], unfilledOrderIds: new Set() })).toBe('open');
    });

    it('腿上没有 id：事件流里有它的触发事件 → 进行中，否则挂单中', () => {
      const bare = leg({ id: 'm', leg_role: 'mirror_tp', trade_record_id: null });
      const triggered = { journal_id: 'm', event_type: 'mirror_tp_triggered' } as CampaignEvent;
      expect(legRowStatus(bare, null, { events: [triggered] })).toBe('open');
      expect(legRowStatus(bare, null, { events: [{ ...triggered, journal_id: 'other' }] })).toBe('pending');
      expect(legRowStatus(bare, null, { events: [{ ...triggered, event_type: 'mirror_tp_placed' }] })).toBe('pending');
    });

    it('平仓记录与爆仓仍然先判，成交凭据不改已平仓的腿', () => {
      expect(legRowStatus(hedge, record, { orders: [order('pending')] })).toBe('closed');
    });
  });

  it('没平仓的主力、加仓、回场腿、独立单、未归类：进行中', () => {
    for (const role of ['main_open', 'main_add_3', 'reentry_main', 'reentry_hedge', 'standalone', null] as const) {
      expect(legRowStatus(leg({ leg_role: role }), null)).toBe('open');
    }
  });

  it('状态名与悬停说明', () => {
    expect(LEG_ROW_STATUS_LABELS).toEqual({ liquidated: '爆仓', pending: '挂单中', open: '进行中' });
    expect(LEG_ROW_STATUS_HINTS).toEqual({
      liquidated: '爆仓：交易所强制平仓。逐仓按破产价结算——亏损恰为这笔仓位的保证金，与平仓价上的价差无关；全仓强平没有保证金封顶',
      pending: '挂单中：还没有成交（委托仍挂着、已撤单，或这条腿没有任何成交凭据），不计入多单 / 空单合计',
      open: '进行中：还没有平仓',
    });
  });
});
