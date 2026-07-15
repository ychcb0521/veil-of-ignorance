import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

let campaign: TradeCampaign;
let journals: TradeJournal[];
let campaignUpdates: Array<Record<string, unknown>>;
let campaignUpdateError: { code: string; message: string } | null;
let journalUpdateError: { code: string; message: string } | null;

const missingCampaignColumnError = {
  code: 'PGRST204',
  message: "Could not find the 'campaign_id' column of 'trade_journals' in the schema cache",
};

const missingCampaignTableError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.trade_campaigns' in the schema cache",
};

function baseCampaign(events: CampaignEvent[] = []): TradeCampaign {
  return {
    id: 'campaign-1',
    user_id: 'user-1',
    symbol: 'ASTERUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: 'ASTERUSDT 2025-09-20 多战役',
    opened_at: '2025-09-20T09:00:00.000Z',
    closed_at: '2025-09-20T10:10:00.000Z',
    initial_main_size_usdt: null,
    initial_leverage: null,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: events.length > 0 ? events : [{
      id: 'event-historical-created',
      timestamp: '2025-09-20T09:00:00.000Z',
      event_type: 'historical_classification_created',
      leg_role: null,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: null,
      size_usdt: null,
      notes: null,
      recorded_at: '2026-06-17T06:00:00.000Z',
    }],
    created_at: '2025-09-20T09:00:00.000Z',
    updated_at: '2025-09-20T09:00:00.000Z',
  };
}

function baseJournal(index: number, overrides: Partial<TradeJournal> = {}): TradeJournal {
  return {
    id: `journal-${index}`,
    user_id: 'user-1',
    trade_record_id: `record-${index}`,
    campaign_id: null,
    leg_role: null,
    leg_sequence: null,
    source: 'retroactive_from_record',
    symbol: 'ASTERUSDT',
    direction: 'long',
    leverage: 7,
    position_mode: 'isolated',
    order_kind: 'main',
    pre_simulated_time: '2025-09-20T09:00:00.000Z',
    pre_real_time: '2026-06-17T06:00:00.000Z',
    pre_entry_price: 1.0828,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: null,
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: 866_400,
    pre_max_loss_usdt: null,
    post_outcome: 'win',
    post_realized_pnl: 120,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    reason_was_rewritten: false,
    created_at: '2026-06-17T06:00:00.000Z',
    updated_at: '2026-06-17T06:00:00.000Z',
    ...overrides,
  };
}

function baseRecord(index: number, overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: `record-${index}`,
    symbol: 'ASTERUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 1.0828,
    exitPrice: 1.167,
    quantity: 800_000,
    leverage: 7,
    pnl: 120,
    fee: 0,
    slippage: 0,
    openTime: Date.parse('2025-09-20T09:00:00.000Z'),
    closeTime: Date.parse('2025-09-20T10:10:00.000Z'),
    ...overrides,
  };
}

vi.mock('@/integrations/supabase/client', () => {
  function from(table: string) {
    let updatePayload: Record<string, unknown> | null = null;
    let useInIds = false;
    let filters: Record<string, unknown> = {};

    const resolveResult = () => {
      if (table === 'trade_campaigns') {
        if (updatePayload) {
          if (campaignUpdateError) return { data: null, error: campaignUpdateError };
          campaignUpdates.push(updatePayload);
          campaign = { ...campaign, ...updatePayload, updated_at: '2026-06-17T06:00:00.000Z' };
        }
        return { data: campaign, error: null };
      }
      if (table === 'trade_journals') {
        if (updatePayload) return { data: null, error: journalUpdateError };
        if (useInIds) return { data: journals, error: null };
        if (filters.campaign_id && journalUpdateError) return { data: null, error: journalUpdateError };
        return { data: journals, error: null };
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
        return builder;
      },
      in() {
        useInIds = true;
        return builder;
      },
      order() { return builder; },
      single() { return Promise.resolve(resolveResult()); },
      maybeSingle() { return Promise.resolve(resolveResult()); },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
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

import { batchAttachToCampaign, getCampaignWithLegs } from '../journalApi';

describe('batchAttachToCampaign schema fallback', () => {
  beforeEach(() => {
    campaign = baseCampaign();
    journals = [
      baseJournal(1),
      baseJournal(2, {
        pre_entry_price: 1.167,
        pre_position_size: 1_633_000,
      }),
    ];
    campaignUpdates = [];
    campaignUpdateError = null;
    journalUpdateError = missingCampaignColumnError;
    localStorage.clear();
    localStorage.setItem('sim_user-1_trade_history', JSON.stringify([
      baseRecord(1),
      baseRecord(2, {
        entryPrice: 1.167,
        exitPrice: 1.2594,
        quantity: 1_400_000,
        openTime: Date.parse('2025-09-20T09:20:00.000Z'),
        closeTime: Date.parse('2025-09-20T10:10:00.000Z'),
      }),
    ]));
  });

  it('writes historical leg events when trade_journals campaign columns are absent', async () => {
    await expect(batchAttachToCampaign('campaign-1', [
      {
        journalId: 'journal-1',
        legRole: 'main_open',
        legSequence: 1,
        attachNote: 'classified retroactively',
      },
      {
        journalId: 'journal-2',
        legRole: 'main_add_1',
        legSequence: 2,
        attachNote: 'classified retroactively',
      },
    ])).resolves.toBeUndefined();

    expect(campaign.actual_evolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'historical_leg_attached',
          leg_role: 'main_open',
          leg_sequence: 1,
          journal_id: 'journal-1',
          trade_record_id: 'record-1',
          order_kind: 'main',
          exit_price: 1.167,
        }),
        expect.objectContaining({
          event_type: 'historical_leg_attached',
          leg_role: 'main_add_1',
          leg_sequence: 2,
          journal_id: 'journal-2',
          trade_record_id: 'record-2',
          order_kind: 'main',
          exit_price: 1.2594,
        }),
      ]),
    );
    expect(campaignUpdates.some(update => Array.isArray(update.actual_evolution))).toBe(true);
  });

  it('falls back to the local campaign mirror when trade_campaigns event update is absent from schema cache', async () => {
    journalUpdateError = null;
    campaignUpdateError = missingCampaignTableError;

    await expect(batchAttachToCampaign('campaign-1', [
      {
        journalId: 'journal-1',
        legRole: 'main_open',
        legSequence: 1,
        attachNote: 'classified retroactively',
      },
      {
        journalId: 'journal-2',
        legRole: 'main_add_1',
        legSequence: 2,
        attachNote: 'classified retroactively',
      },
    ])).resolves.toBeUndefined();

    const localCampaigns = JSON.parse(localStorage.getItem('sim_user-1_trade_campaigns') ?? '[]') as TradeCampaign[];
    expect(localCampaigns).toHaveLength(1);
    expect(localCampaigns[0]).toMatchObject({
      id: 'campaign-1',
      symbol: 'ASTERUSDT',
      status: 'closed_profit',
    });
    expect(localCampaigns[0].actual_evolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'historical_leg_attached',
          leg_role: 'main_open',
          journal_id: 'journal-1',
          trade_record_id: 'record-1',
        }),
        expect.objectContaining({
          event_type: 'historical_leg_attached',
          leg_role: 'main_add_1',
          journal_id: 'journal-2',
          trade_record_id: 'record-2',
        }),
      ]),
    );
  });

  it('does not block mixed historical batches when an executed main journal is assigned as a rolling hedge', async () => {
    journalUpdateError = null;
    campaignUpdateError = null;
    journals = [
      baseJournal(1, {
        source: 'live',
        order_kind: 'main',
        trade_record_id: 'record-1',
      }),
    ];

    await expect(batchAttachToCampaign('campaign-1', [
      {
        journalId: 'journal-1',
        legRole: 'hedge_rolling',
        legSequence: 1,
        attachNote: 'classified retroactively',
      },
    ])).resolves.toBeUndefined();

    expect(campaignUpdates.some(update => Array.isArray(update.actual_evolution))).toBe(true);
  });

  it('reconstructs shared campaign legs from owner campaign events when follower has no owner-local trade history', async () => {
    const openTime = '2025-09-20T09:00:00.000Z';
    const closeTime = '2025-09-20T10:10:00.000Z';
    campaign = baseCampaign([
      {
        id: 'event-created',
        timestamp: openTime,
        event_type: 'historical_classification_created',
        leg_role: null,
        journal_id: null,
        trade_record_id: null,
        pending_order_id: null,
        price: null,
        size_usdt: null,
        notes: null,
        recorded_at: '2026-06-17T06:00:00.000Z',
      },
      {
        id: 'event-owner-leg',
        timestamp: openTime,
        event_type: 'historical_leg_attached',
        leg_role: 'main_open',
        journal_id: null,
        trade_record_id: 'owner-record-only',
        pending_order_id: null,
        price: 1.0828,
        size_usdt: 866_400,
        notes: 'classified retroactively · 仓位历史记录',
        recorded_at: '2026-06-17T06:00:00.000Z',
        direction: 'long',
        leverage: 7,
        open_time: openTime,
        close_time: closeTime,
        entry_price: 1.0828,
        exit_price: 1.167,
        realized_pnl: 120,
        r_multiple: null,
      },
    ]);
    journals = [];
    localStorage.clear();

    const result = await getCampaignWithLegs('campaign-1');

    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]).toMatchObject({
      id: 'record-owner-record-only',
      user_id: 'user-1',
      campaign_id: 'campaign-1',
      trade_record_id: 'owner-record-only',
      leg_role: 'main_open',
      leg_sequence: 1,
      direction: 'long',
      leverage: 7,
      order_kind: 'main',
      pre_simulated_time: openTime,
      pre_entry_price: 1.0828,
      pre_position_size: 866_400,
      post_real_close_time: null,
      post_simulated_close_time: closeTime,
      post_realized_pnl: 120,
      post_outcome: 'win',
      post_exit_price_snapshot: 1.167,
    });
  });

  it('merges event-only historical legs into a partially persisted historical campaign', async () => {
    const firstOpen = '2025-09-20T09:00:00.000Z';
    const secondOpen = '2025-09-20T09:20:00.000Z';
    const closeTime = '2025-09-20T10:10:00.000Z';
    const historicalEvent = (
      id: string,
      recordId: string,
      role: 'main_open' | 'main_add_1',
      openTime: string,
      entryPrice: number,
    ): CampaignEvent => ({
      id,
      timestamp: openTime,
      event_type: 'historical_leg_attached',
      leg_role: role,
      journal_id: `journal-${recordId}`,
      trade_record_id: recordId,
      pending_order_id: null,
      price: entryPrice,
      size_usdt: 1000,
      notes: '历史归类',
      recorded_at: '2026-06-17T06:00:00.000Z',
      direction: 'long',
      leverage: 7,
      open_time: openTime,
      close_time: closeTime,
      entry_price: entryPrice,
      exit_price: 1.2,
      realized_pnl: 100,
      r_multiple: null,
    });
    campaign = baseCampaign([
      {
        id: 'event-created',
        timestamp: firstOpen,
        event_type: 'historical_classification_created',
        leg_role: null,
        journal_id: null,
        trade_record_id: null,
        pending_order_id: null,
        price: null,
        size_usdt: null,
        notes: null,
        recorded_at: '2026-06-17T06:00:00.000Z',
      },
      historicalEvent('event-first', 'record-1', 'main_open', firstOpen, 1.08),
      historicalEvent('event-second', 'record-2', 'main_add_1', secondOpen, 1.1),
    ]);
    journals = [baseJournal(1, {
      id: 'journal-record-1',
      campaign_id: 'campaign-1',
      leg_role: 'main_open',
      leg_sequence: 1,
      pre_simulated_time: firstOpen,
      post_exit_price_snapshot: null,
    })];
    localStorage.clear();

    const result = await getCampaignWithLegs('campaign-1');

    expect(result.legs).toHaveLength(2);
    expect(result.legs.map(leg => leg.trade_record_id)).toEqual(['record-1', 'record-2']);
    expect(result.legs[0].post_exit_price_snapshot).toBe(1.2);
    expect(result.legs[1]).toMatchObject({
      leg_sequence: 2,
      leg_role: 'main_add_1',
      pre_simulated_time: secondOpen,
      pre_entry_price: 1.1,
      post_exit_price_snapshot: 1.2,
    });
  });
});
