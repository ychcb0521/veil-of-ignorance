import { describe, expect, it } from 'vitest';
import { planBulkCampaignClose, type BulkCloseCandidate } from '@/lib/campaignBulkClose';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');

const campaign = (over: Partial<TradeCampaign> = {}): TradeCampaign =>
  ({ id: 'c1', title: 'RAVEUSDT 多战役', symbol: 'RAVEUSDT', status: 'active', closed_at: null, final_realized_pnl: null, actual_evolution: [], ...over } as TradeCampaign);

const leg = (id: string, over: Partial<TradeJournal> = {}): TradeJournal =>
  ({ id, trade_record_id: null, post_realized_pnl: null, pre_max_loss_usdt: null, ...over } as TradeJournal);

const rec = (id: string, pnl: number, over: Partial<TradeRecord> = {}): TradeRecord =>
  ({ id, action: 'CLOSE', pnl, openTime: 0, closeTime: 0, ...over } as TradeRecord);

function candidate(c: TradeCampaign, legs: TradeJournal[], records: TradeRecord[]): BulkCloseCandidate {
  return { campaign: c, legs, settlement: computeCampaignRealizedPnl(c, legs, records) };
}

describe('planBulkCampaignClose', () => {
  it('状态由已实现盈亏推出，不是选出来的', () => {
    const win = candidate(campaign({ id: 'win' }), [leg('a', { trade_record_id: 'r1' })], [rec('r1', 1_200)]);
    const lose = candidate(campaign({ id: 'lose' }), [leg('b', { trade_record_id: 'r2' })], [rec('r2', -340)]);
    const flat = candidate(campaign({ id: 'flat' }), [leg('c', { trade_record_id: 'r3' })], [rec('r3', 0)]);

    const plan = planBulkCampaignClose([win, lose, flat], NOW);
    expect(plan.map(item => item.verdict.status)).toEqual(['closed_profit', 'closed_loss', 'closed_breakeven']);
    // 写回的金额就是列表上显示的那个数
    expect(plan[0].realizedPnl).toBeCloseTo(1_200, 8);
    expect(plan[1].realizedPnl).toBeCloseTo(-340, 8);
  });

  it('结束时间取最后一笔结算成交，而不是此刻——否则旧战役会被盖上今天的时间戳', () => {
    const closeMs = Date.parse('2026-04-11T02:30:00.000Z');
    const [item] = planBulkCampaignClose([candidate(
      campaign(),
      [leg('a', { trade_record_id: 'position-1' })],
      [
        rec('f1', 100, { positionId: 'position-1', closeTime: closeMs - 60_000 }),
        rec('f2', 50, { positionId: 'position-1', closeTime: closeMs }),
      ],
    )], NOW);
    expect(item.closedAt).toBe(new Date(closeMs).toISOString());
    expect(item.closedAtSource).toBe('last_fill');
    expect(Date.parse(item.closedAt)).toBeLessThan(NOW);
  });

  it('没有成交记录时退到事件流，再退到时钟', () => {
    const eventMs = Date.parse('2026-04-09T08:00:00.000Z');
    const withEvents = candidate(
      campaign({ actual_evolution: [{ id: 'e1', timestamp: new Date(eventMs).toISOString() }] as never }),
      [leg('a', { post_realized_pnl: 42 })],
      [],
    );
    const bare = candidate(campaign(), [leg('a', { post_realized_pnl: 42 })], []);

    const [fromEvent, fromClock] = planBulkCampaignClose([withEvents, bare], NOW);
    expect(fromEvent.closedAtSource).toBe('last_event');
    expect(fromEvent.closedAt).toBe(new Date(eventMs).toISOString());
    expect(fromClock.closedAtSource).toBe('clock');
    expect(fromClock.closedAt).toBe(new Date(NOW).toISOString());
  });

  it('还有腿没结算的战役只能标成放弃，并报出还差几条腿', () => {
    const [item] = planBulkCampaignClose([candidate(
      campaign(),
      [leg('done', { trade_record_id: 'r1' }), leg('open1'), leg('open2')],
      [rec('r1', 500)],
    )], NOW);
    expect(item.verdict).toEqual({ kind: 'unsettled', status: 'abandoned', unsettledLegCount: 2 });
    // 半场的钱不冒充最终盈亏比，但金额本身照实给出
    expect(item.realizedPnl).toBeCloseTo(500, 8);
  });

  it('一条腿都没有的战役同样不判盈亏，归到放弃这一档', () => {
    const [item] = planBulkCampaignClose([candidate(campaign({ final_realized_pnl: 900 }), [], [])], NOW);
    expect(item.verdict.kind).toBe('unsettled');
    expect(item.verdict.status).toBe('abandoned');
  });

  it('R 倍数用 Σ 计划最大亏损，与单场「结束战役」对话框同一个口径', () => {
    const [item] = planBulkCampaignClose([candidate(
      campaign(),
      [leg('a', { trade_record_id: 'r1', pre_max_loss_usdt: 200 }), leg('b', { trade_record_id: 'r2', pre_max_loss_usdt: 300 })],
      [rec('r1', 800), rec('r2', 200)],
    )], NOW);
    expect(item.finalRMultiple).toBeCloseTo(2, 8); // 1000 / 500
  });

  it('没有计划最大亏损时 R 为 null，而不是 0 —— 0 会被读成「打平」', () => {
    const [item] = planBulkCampaignClose([candidate(
      campaign(), [leg('a', { trade_record_id: 'r1' })], [rec('r1', 800)],
    )], NOW);
    expect(item.finalRMultiple).toBeNull();
  });
});
