import { describe, expect, it } from 'vitest';
import { buildCampaignReverseOrderLegMap } from '@/lib/campaignReverseOrderAttribution';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';

function leg(
  id: string,
  role: TradeJournal['leg_role'],
  openedAt: string,
  tradeRecordId: string | null = null,
): TradeJournal {
  return {
    id,
    leg_role: role,
    trade_record_id: tradeRecordId,
    pre_simulated_time: openedAt,
    order_kind: role === 'mirror_tp' ? 'tp' : role?.startsWith('hedge_') ? 'hedge' : 'main',
  } as TradeJournal;
}

function order(
  id: string,
  createdAt: string,
  tradeRecordId: string | null = null,
  overrides: Partial<CampaignReverseHedgeOrder> = {},
): CampaignReverseHedgeOrder {
  return {
    id,
    tradeRecordId,
    side: 'SHORT',
    price: 1,
    createdAt: Date.parse(createdAt),
    triggeredAt: null,
    cancelledAt: null,
    status: 'pending',
    ...overrides,
  };
}

describe('campaign reverse-order attribution', () => {
  it('共享成交标识时仍归属主力，不归属镜像止盈', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z', 'shared-record'),
      leg('mirror', 'mirror_tp', '2026-07-14T01:00:00.000Z', 'shared-record'),
    ];
    const reverseOrder = order('reverse-1', '2026-07-14T01:01:00.000Z', 'shared-record');

    const attribution = buildCampaignReverseOrderLegMap(legs, [reverseOrder]);

    expect(attribution.get(reverseOrder.id)).toBe('main');
    expect([...attribution.values()]).not.toContain('mirror');
  });

  it('历史委托缺少直接关联时也统一汇总到主力开仓腿', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z'),
      leg('mirror', 'mirror_tp', '2026-07-14T01:05:00.000Z'),
      leg('hedge', 'hedge_rolling', '2026-07-14T01:08:00.000Z'),
      leg('add', 'main_add_1', '2026-07-14T01:10:00.000Z'),
    ];
    const beforeAdd = order('before-add', '2026-07-14T01:06:00.000Z');
    const afterAdd = order('after-add', '2026-07-14T01:12:00.000Z');

    const attribution = buildCampaignReverseOrderLegMap(legs, [beforeAdd, afterAdd]);

    expect(attribution.get(beforeAdd.id)).toBe('main');
    expect(attribution.get(afterAdd.id)).toBe('main');
    expect([...attribution.values()]).not.toContain('mirror');
    expect([...attribution.values()]).not.toContain('hedge');
  });

  it('已触发反向委托归到对应的对冲腿', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z'),
      leg('mirror', 'mirror_tp', '2026-07-14T01:00:00.000Z', 'shared-record'),
      leg('hedge-a', 'hedge_initial_a', '2026-07-14T01:05:00.000Z', 'hedge-record'),
    ];
    const triggered = order(
      'triggered-hedge',
      '2026-07-14T01:01:00.000Z',
      'hedge-record',
      {
        status: 'triggered',
        triggeredAt: Date.parse('2026-07-14T01:05:00.000Z'),
        fillPrice: 0.95,
      },
    );

    const attribution = buildCampaignReverseOrderLegMap(legs, [triggered]);

    expect(attribution.get(triggered.id)).toBe('hedge-a');
  });

  it('历史触发委托缺少关联 ID 时按触发时间和价格匹配对应对冲腿', () => {
    const legs = [
      { ...leg('main', 'main_open', '2026-07-14T01:00:00.000Z'), pre_entry_price: 1 },
      { ...leg('hedge-a', 'hedge_initial_a', '2026-07-14T01:05:00.000Z'), pre_entry_price: 0.95 },
      { ...leg('hedge-b', 'hedge_initial_b', '2026-07-14T01:15:00.000Z'), pre_entry_price: 0.9 },
    ];
    const triggered = order(
      'legacy-triggered',
      '2026-07-14T01:01:00.000Z',
      null,
      {
        status: 'triggered',
        triggeredAt: Date.parse('2026-07-14T01:15:00.000Z'),
        fillPrice: 0.9,
      },
    );

    const attribution = buildCampaignReverseOrderLegMap(legs, [triggered]);

    expect(attribution.get(triggered.id)).toBe('hedge-b');
  });

  it('尚未触发的委托即使关联对冲记录也仍归主力', () => {
    const legs = [
      leg('main', 'main_open', '2026-07-14T01:00:00.000Z'),
      leg('hedge-a', 'hedge_initial_a', '2026-07-14T01:05:00.000Z', 'hedge-record'),
    ];
    const pending = order('pending-hedge', '2026-07-14T01:01:00.000Z', 'hedge-record');

    const attribution = buildCampaignReverseOrderLegMap(legs, [pending]);

    expect(attribution.get(pending.id)).toBe('main');
  });

  it('多笔主仓时，未触发的反向委托挂在名义金额最大的那笔名下', () => {
    // 实盘反例：1769.83 的残仓 leg_sequence 在前，真正的主力是 17775439.86
    const dust = { ...leg('dust', 'main_open', '2026-08-05T04:02:00Z'), pre_position_size: 1769.83 } as TradeJournal;
    const real = { ...leg('real', 'main_open', '2026-08-05T04:02:30Z'), pre_position_size: 17775439.86 } as TradeJournal;
    const map = buildCampaignReverseOrderLegMap([dust, real], [order('o1', '2026-08-05T04:03:00Z')]);
    expect(map.get('o1')).toBe('real');
  });
});
