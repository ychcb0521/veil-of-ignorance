import { describe, expect, it } from 'vitest';
import { resolveMirrorTpOrderTiming } from '@/lib/campaignMirrorTpOrderTiming';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const leg = {
  id: 'mirror-leg',
  leg_role: 'mirror_tp',
  leg_sequence: 3,
  trade_record_id: 'mirror-record',
  pre_simulated_time: '2026-07-14T01:00:00.000Z',
  post_simulated_close_time: '2026-07-14T02:00:00.000Z',
} as TradeJournal;

const record = {
  id: 'mirror-record',
  openTime: Date.parse('2026-07-14T01:00:00.000Z'),
  closeTime: Date.parse('2026-07-14T02:00:00.000Z'),
} as TradeRecord;

function event(
  id: string,
  eventType: CampaignEvent['event_type'],
  timestamp: string,
  overrides: Partial<CampaignEvent> = {},
): CampaignEvent {
  return {
    id,
    timestamp,
    event_type: eventType,
    leg_role: 'mirror_tp',
    journal_id: leg.id,
    trade_record_id: leg.trade_record_id,
    pending_order_id: null,
    price: null,
    size_usdt: null,
    notes: null,
    recorded_at: timestamp,
    ...overrides,
  };
}

describe('resolveMirrorTpOrderTiming', () => {
  it('优先使用对应镜像止盈事件中的挂单时间与触发时间', () => {
    const timing = resolveMirrorTpOrderTiming(leg, record, [
      event('placed', 'mirror_tp_placed', '2026-07-14T01:05:00.000Z'),
      event('triggered', 'mirror_tp_triggered', '2026-07-14T01:55:00.000Z'),
    ]);

    expect(timing).toEqual({
      placedAt: Date.parse('2026-07-14T01:05:00.000Z'),
      triggeredAt: Date.parse('2026-07-14T01:55:00.000Z'),
    });
  });

  it('历史战役缺少镜像事件时使用成交记录开仓和平仓时间回填', () => {
    expect(resolveMirrorTpOrderTiming(leg, record, [])).toEqual({
      placedAt: record.openTime,
      triggeredAt: record.closeTime,
    });
  });

  it('不会把其他镜像腿的具名事件串到当前镜像腿', () => {
    const timing = resolveMirrorTpOrderTiming(leg, record, [
      event('other-placed', 'mirror_tp_placed', '2026-07-14T01:10:00.000Z', {
        journal_id: 'other-leg',
        trade_record_id: 'other-record',
      }),
      event('other-triggered', 'mirror_tp_triggered', '2026-07-14T01:20:00.000Z', {
        journal_id: 'other-leg',
        trade_record_id: 'other-record',
      }),
    ]);

    expect(timing).toEqual({
      placedAt: record.openTime,
      triggeredAt: record.closeTime,
    });
  });

  it('未触发镜像腿不会把战役关闭时间误当作触发时间', () => {
    expect(resolveMirrorTpOrderTiming(leg, null, [])).toEqual({
      placedAt: Date.parse('2026-07-14T01:00:00.000Z'),
      triggeredAt: null,
    });
  });

  it('非镜像止盈腿不生成镜像委托时间', () => {
    expect(resolveMirrorTpOrderTiming(
      { ...leg, leg_role: 'main_open' } as TradeJournal,
      record,
      [],
    )).toBeNull();
  });
});
