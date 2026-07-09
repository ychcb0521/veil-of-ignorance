import { describe, expect, it } from 'vitest';
import { buildCampaignEventStream } from '@/lib/campaignAnalysis';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const iso = (ms: number) => new Date(ms).toISOString();

describe('buildCampaignEventStream canonical trade times', () => {
  it('uses TradeRecord closeTime and drops stale close events for the same leg', () => {
    const openMs = Date.parse('2026-07-08T00:00:00.000Z');
    const staleCloseMs = Date.parse('2026-07-08T00:30:00.000Z');
    const correctedCloseMs = Date.parse('2026-07-08T01:10:00.000Z');

    const staleAttached: CampaignEvent = {
      id: 'attached-old',
      timestamp: iso(openMs),
      event_type: 'historical_leg_attached',
      leg_role: 'main_open',
      journal_id: 'journal-1',
      trade_record_id: 'record-1',
      pending_order_id: null,
      price: 1,
      size_usdt: 1000,
      notes: null,
      recorded_at: iso(openMs),
      open_time: iso(openMs),
      close_time: iso(staleCloseMs),
      entry_price: 1,
      exit_price: 1.1,
      realized_pnl: 100,
    };
    const staleClose: CampaignEvent = {
      id: 'close-old',
      timestamp: iso(staleCloseMs),
      event_type: 'main_fully_closed',
      leg_role: 'main_open',
      journal_id: 'journal-1',
      trade_record_id: 'record-1',
      pending_order_id: null,
      price: 1.1,
      size_usdt: 1100,
      notes: null,
      recorded_at: iso(staleCloseMs),
    };
    const campaign = {
      id: 'campaign-1',
      user_id: 'user-1',
      campaign_code: 'C-1',
      symbol: 'TESTUSDT',
      direction: 'main_long',
      status: 'closed_profit',
      strategy_template: 'main_dual_hedge_mirror_tp',
      title: 'test',
      opened_at: iso(openMs),
      closed_at: iso(correctedCloseMs),
      initial_main_size_usdt: 1000,
      initial_leverage: 1,
      final_realized_pnl: 200,
      final_r_multiple: null,
      peak_unrealized_pnl: null,
      peak_drawdown: null,
      importance_weight: 0,
      notes: null,
      actual_evolution: [staleAttached, staleClose],
      deviation_notes: {},
      created_at: iso(openMs),
      updated_at: iso(openMs),
    } satisfies TradeCampaign;
    const leg = {
      id: 'journal-1',
      trade_record_id: 'record-1',
      leg_role: 'main_open',
      pre_simulated_time: iso(openMs),
      pre_entry_price: 1,
      pre_position_size: 1000,
      direction: 'long',
    } as TradeJournal;
    const record = {
      id: 'record-1',
      symbol: 'TESTUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1,
      exitPrice: 1.2,
      quantity: 1000,
      leverage: 1,
      pnl: 200,
      fee: 0,
      slippage: 0,
      openTime: openMs,
      closeTime: correctedCloseMs,
    } satisfies TradeRecord;

    const events = buildCampaignEventStream(campaign, [leg], [record]);
    const closeEvents = events.filter(event => event.event_type === 'main_fully_closed');
    const attachedEvent = events.find(event => event.id === 'attached-old');

    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].timestamp).toBe(iso(correctedCloseMs));
    expect(closeEvents[0].price).toBe(1.2);
    expect(events.some(event => event.id === 'close-old')).toBe(false);
    expect(attachedEvent?.close_time).toBe(iso(correctedCloseMs));
    expect(attachedEvent?.exit_price).toBe(1.2);
  });
});
