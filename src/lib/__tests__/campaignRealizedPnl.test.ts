import { describe, expect, it } from 'vitest';
import {
  campaignStatusFromRealizedPnl,
  computeCampaignRealizedPnl,
  hasMaterialDrift,
} from '@/lib/campaignRealizedPnl';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const campaign = (over: Partial<TradeCampaign> = {}): Pick<TradeCampaign, 'final_realized_pnl' | 'actual_evolution'> =>
  ({ final_realized_pnl: null, actual_evolution: [], ...over } as never);

const leg = (id: string, over: Partial<TradeJournal> = {}): TradeJournal =>
  ({ id, trade_record_id: null, post_realized_pnl: null, ...over } as TradeJournal);

const rec = (id: string, pnl: number, over: Partial<TradeRecord> = {}): TradeRecord =>
  ({ id, action: 'CLOSE', pnl, closeTime: 0, openTime: 0, ...over } as TradeRecord);

describe('computeCampaignRealizedPnl', () => {
  it('分批平仓的每一刀都计入——只算最后一刀是漏账，这正是三套口径分家的根源', () => {
    // 实时「记录决策」的腿把仓位 id 写进 trade_record_id；该仓位分三刀平掉。
    const legs = [leg('main', { trade_record_id: 'position-1' })];
    const records = [
      rec('fill-1', 400, { positionId: 'position-1', closeTime: 1 }),
      rec('fill-2', -150, { positionId: 'position-1', closeTime: 2 }),
      rec('fill-3', 50, { positionId: 'position-1', closeTime: 3 }),
    ];
    const settlement = computeCampaignRealizedPnl(campaign(), legs, records);
    expect(settlement.total).toBeCloseTo(300, 8);
    expect(settlement.byLeg.get('main')).toBeCloseTo(300, 8);
    expect(settlement.recordsByLeg.get('main')).toHaveLength(3);
  });

  it('精确 id 匹配优先于仓位匹配，且一条记录只被一条腿认领', () => {
    // 一条腿挂 record id、另一条挂同一个仓位 id：不能让后者把前者的记录抢走。
    const legs = [
      leg('a', { trade_record_id: 'fill-2' }),
      leg('b', { trade_record_id: 'position-1' }),
    ];
    const records = [
      rec('fill-1', 100, { positionId: 'position-1', closeTime: 1 }),
      rec('fill-2', 70, { positionId: 'position-1', closeTime: 2 }),
    ];
    const settlement = computeCampaignRealizedPnl(campaign(), legs, records);
    expect(settlement.byLeg.get('a')).toBeCloseTo(70, 8);
    expect(settlement.byLeg.get('b')).toBeCloseTo(100, 8);
    expect(settlement.total).toBeCloseTo(170, 8);
  });

  it('Σ(byLeg) 恒等于 total —— Legs 表合计与盈亏概览因此不可能分家', () => {
    const legs = [
      leg('main', { trade_record_id: 'r1' }),
      leg('hedge', { trade_record_id: 'r2' }),
      leg('mirror', { post_realized_pnl: 12.5 }),
    ];
    const records = [rec('r1', 66_647.85), rec('r2', -44_700.81)];
    const settlement = computeCampaignRealizedPnl(campaign(), legs, records);
    const sum = [...settlement.byLeg.values()].reduce<number>((acc, v) => acc + (v ?? 0), 0);
    expect(sum).toBeCloseTo(settlement.total as number, 8);
  });

  it('成交记录压过复盘快照——引擎撮合是事实，回填是人工填的', () => {
    const legs = [leg('main', { trade_record_id: 'r1', post_realized_pnl: 999 })];
    const settlement = computeCampaignRealizedPnl(campaign(), legs, [rec('r1', 120)]);
    expect(settlement.total).toBeCloseTo(120, 8);
    expect(settlement.basis).toBe('records');
  });

  it('无成交记录的腿才退到复盘快照', () => {
    const legs = [leg('main', { post_realized_pnl: 700 }), leg('hedge', { post_realized_pnl: -200 })];
    const settlement = computeCampaignRealizedPnl(campaign(), legs, []);
    expect(settlement.total).toBeCloseTo(500, 8);
    expect(settlement.basis).toBe('leg_snapshots');
  });

  it('资金费不进任何腿——FUNDING 不是结算记录，并入会凭空改变盈亏比的分子', () => {
    const legs = [leg('main', { trade_record_id: 'position-1' })];
    const records = [
      rec('fill-1', 500, { positionId: 'position-1' }),
      rec('funding-1', -120, { positionId: 'position-1', action: 'FUNDING' }),
    ];
    expect(computeCampaignRealizedPnl(campaign(), legs, records).total).toBeCloseTo(500, 8);
  });

  it('爆仓记录要计入', () => {
    const legs = [leg('main', { trade_record_id: 'position-1' })];
    const records = [rec('liq', -8_000, { positionId: 'position-1', action: 'LIQUIDATION' })];
    expect(computeCampaignRealizedPnl(campaign(), legs, records).total).toBeCloseTo(-8_000, 8);
  });

  it('一条腿只叠一次平仓价校正，不随刀数翻倍', () => {
    // 方向取自 record.side（校正算的是这条成交的毛盈亏差），不是腿的 direction
    const legs = [leg('main', { trade_record_id: 'position-1' })];
    const records = [
      rec('fill-1', 100, { positionId: 'position-1', closeTime: 1, side: 'LONG', entryPrice: 100, exitPrice: 110, quantity: 10 }),
      rec('fill-2', 100, { positionId: 'position-1', closeTime: 2, side: 'LONG', entryPrice: 100, exitPrice: 110, quantity: 10 }),
    ];
    const plain = computeCampaignRealizedPnl(campaign(), legs, records).total as number;
    const corrected = computeCampaignRealizedPnl(campaign(), legs, records, {
      main: { exitPrice: 105, originalExitPrice: 110, candleLow: 104, candleHigh: 106 },
    }).total as number;
    // 校正只作用在收盘那一刀（closeTime 更大的 fill-2），10 张 × 5 = 50
    expect(plain - corrected).toBeCloseTo(50, 8);
  });

  it('兜底链是「腿 → 事件 → 落库缓存」，一条腿都没结算时仍显示落库值而不是 0', () => {
    const legs = [leg('main'), leg('hedge')];
    const settlement = computeCampaignRealizedPnl(campaign({ final_realized_pnl: -300 }), legs, []);
    expect(settlement.total).toBeCloseTo(-300, 8);
    expect(settlement.basis).toBe('campaign_summary');
    expect(settlement.settled).toBe(false);
  });

  it('事件兜底按 event.id 去重，不会把同一笔钱算两次', () => {
    const events = [
      { id: 'e1', realized_pnl: 175 },
      { id: 'e1', realized_pnl: 175 },
      { id: 'e2', realized_pnl: -50 },
    ] as never;
    expect(computeCampaignRealizedPnl(campaign({ actual_evolution: events }), [], []).total)
      .toBeCloseTo(125, 8);
  });
});

describe('campaignStatusFromRealizedPnl', () => {
  it('状态与金额同源——「亏损结束」配一个正数在构造上不再可能', () => {
    const closed = '2026-06-17T22:09:00.000Z';
    expect(campaignStatusFromRealizedPnl({ total: 137_363.9, settled: true }, closed)).toBe('closed_profit');
    expect(campaignStatusFromRealizedPnl({ total: -22_531.01, settled: true }, closed)).toBe('closed_loss');
    expect(campaignStatusFromRealizedPnl({ total: 0, settled: true }, closed)).toBe('closed_breakeven');
  });

  it('未结算或未平仓一律 active，不拿半场数据定性', () => {
    expect(campaignStatusFromRealizedPnl({ total: 500, settled: false }, '2026-06-17T00:00:00Z')).toBe('active');
    expect(campaignStatusFromRealizedPnl({ total: 500, settled: true }, null)).toBe('active');
  });
});

describe('hasMaterialDrift', () => {
  it('落库缓存与现算值偏离时报真，浮点噪声不报', () => {
    const drifted = computeCampaignRealizedPnl(
      campaign({ final_realized_pnl: -22_531.01 }),
      [leg('main', { trade_record_id: 'r1' })],
      [rec('r1', 137_363.9)],
    );
    expect(hasMaterialDrift(drifted)).toBe(true);

    const clean = computeCampaignRealizedPnl(
      campaign({ final_realized_pnl: 600 }),
      [leg('main', { trade_record_id: 'r1' })],
      [rec('r1', 600.000000001)],
    );
    expect(hasMaterialDrift(clean)).toBe(false);
  });
});
