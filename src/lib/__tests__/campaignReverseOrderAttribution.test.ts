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
});
