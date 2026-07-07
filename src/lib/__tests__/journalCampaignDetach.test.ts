import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignEvent, TradeCampaign } from '@/types/journal';

let campaign: TradeCampaign;
let campaignUpdates: Array<Record<string, unknown>>;
let journalIdQueries: string[];

function buildCampaign(events: CampaignEvent[]): TradeCampaign {
  return {
    id: 'campaign-1',
    user_id: 'user-1',
    campaign_code: 'C00000001',
    symbol: 'TSTUSDT',
    direction: 'main_long',
    status: 'closed_loss',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: 'TSTUSDT 2026-05-04 多战役',
    opened_at: '2026-05-04T13:10:00.000Z',
    closed_at: '2026-05-04T14:40:00.000Z',
    initial_main_size_usdt: null,
    initial_leverage: null,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: events,
    deviation_notes: {},
    created_at: '2026-05-04T13:10:00.000Z',
    updated_at: '2026-05-04T14:40:00.000Z',
  };
}

function event(id: string, recordId: string, timestamp: string): CampaignEvent {
  return {
    id,
    timestamp,
    event_type: 'historical_leg_attached',
    leg_role: id === 'e1' ? 'main_open' : 'standalone',
    journal_id: null,
    trade_record_id: recordId,
    pending_order_id: null,
    price: 1,
    size_usdt: 100,
    notes: null,
    recorded_at: timestamp,
  };
}

vi.mock('@/integrations/supabase/client', () => {
  function from(table: string) {
    let updatePayload: Record<string, unknown> | null = null;
    let filters: Record<string, unknown> = {};

    const resolveResult = () => {
      if (table === 'trade_campaigns') {
        return { data: campaign, error: null };
      }
      if (table === 'trade_journals') {
        if (typeof filters.id === 'string') journalIdQueries.push(filters.id);
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };

    const builder = {
      select() { return builder; },
      update(payload: Record<string, unknown>) {
        updatePayload = { ...payload };
        return builder;
      },
      eq(column: string, value: unknown) {
        filters = { ...filters, [column]: value };
        if (table === 'trade_campaigns' && column === 'id' && value === campaign.id && updatePayload) {
          campaignUpdates.push(updatePayload);
          campaign = { ...campaign, ...updatePayload };
        }
        return builder;
      },
      order() { return builder; },
      single() { return Promise.resolve(resolveResult()); },
      maybeSingle() { return Promise.resolve(resolveResult()); },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolveResult()).then(resolve);
      },
    };

    return builder;
  }

  return {
    supabase: {
      from,
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
      },
    },
  };
});

import { detachCampaignLegFromCampaign } from '../journalApi';

describe('detachCampaignLegFromCampaign', () => {
  beforeEach(() => {
    campaignUpdates = [];
    journalIdQueries = [];
    campaign = buildCampaign([
      event('e1', '2234ec9d-71db-49d1-870d-acb21c1bfa4e', '2026-05-04T13:10:00.000Z'),
      event('e2', 'bb34ec9d-71db-49d1-870d-acb21c1bfa4e', '2026-05-04T14:40:00.000Z'),
    ]);
  });

  it('解除历史 record leg 时按 trade_record_id 修改战役事件流，不把 record-* 当 journal UUID 查询', async () => {
    await detachCampaignLegFromCampaign(campaign.id, {
      id: 'record-2234ec9d-71db-49d1-870d-acb21c1bfa4e',
      trade_record_id: '2234ec9d-71db-49d1-870d-acb21c1bfa4e',
      leg_role: 'main_open',
      pre_entry_price: 1,
      pre_position_size: 100,
      source: 'retroactive_from_record',
    });

    expect(journalIdQueries).not.toContain('record-2234ec9d-71db-49d1-870d-acb21c1bfa4e');
    expect(campaign.actual_evolution.some(item => item.trade_record_id === '2234ec9d-71db-49d1-870d-acb21c1bfa4e')).toBe(false);
    expect(campaign.actual_evolution.some(item => item.trade_record_id === 'bb34ec9d-71db-49d1-870d-acb21c1bfa4e')).toBe(true);

    const detachNote = campaign.actual_evolution.find(item => item.event_type === 'note');
    expect(detachNote).toMatchObject({
      journal_id: null,
      trade_record_id: null,
      leg_role: 'main_open',
    });
    expect(campaignUpdates.some(update => Array.isArray(update.actual_evolution))).toBe(true);
  });

  it('历史 record leg 缺少 record id 时给出明确错误，不回退到 journal UUID 查询', async () => {
    await expect(detachCampaignLegFromCampaign(campaign.id, {
      id: 'retro-leg-without-record-id',
      trade_record_id: null,
      leg_role: 'standalone',
      pre_entry_price: 1,
      pre_position_size: 100,
      source: 'retroactive_from_record',
    })).rejects.toThrow('trade_record_id');

    expect(journalIdQueries).toEqual([]);
  });
});
