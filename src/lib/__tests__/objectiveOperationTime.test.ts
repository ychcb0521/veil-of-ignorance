import { describe, expect, it } from 'vitest';
import {
  buildTradeRecordLookup,
  campaignOperationTime,
  journalCloseOperationTime,
  journalOperationTime,
  journalSimulatedCloseTime,
  tradeRecordOperationTime,
} from '@/lib/objectiveOperationTime';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

function record(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 'record-1',
    positionId: 'position-1',
    symbol: 'HIFIUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 0.1,
    exitPrice: 0.2,
    quantity: 1,
    leverage: 1,
    pnl: 1,
    fee: 0,
    slippage: 0,
    openTime: Date.parse('2025-09-12T10:13:00.000Z'),
    closeTime: Date.parse('2025-09-12T17:46:00.000Z'),
    closedRealAt: Date.parse('2026-07-11T03:52:00.000Z'),
    ...overrides,
  };
}

function journal(overrides: Partial<TradeJournal> = {}): TradeJournal {
  return {
    id: 'journal-1',
    user_id: 'user-1',
    trade_record_id: 'record-1',
    campaign_id: 'campaign-1',
    leg_role: 'main_open',
    leg_sequence: 1,
    source: 'retroactive_from_record',
    symbol: 'HIFIUSDT',
    direction: 'long',
    leverage: 1,
    position_mode: 'isolated',
    order_kind: 'main',
    pre_simulated_time: '2025-09-12T10:13:00.000Z',
    pre_real_time: '2026-07-11T03:50:00.000Z',
    pre_entry_price: 0.1,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: null,
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: 1,
    pre_max_loss_usdt: null,
    post_outcome: 'win',
    post_realized_pnl: 1,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    post_real_close_time: '2025-09-12T17:46:00.000Z',
    post_simulated_close_time: '2025-09-12T17:46:00.000Z',
    created_at: '2026-07-11T03:50:00.000Z',
    updated_at: '2026-07-11T03:50:00.000Z',
    ...overrides,
  } as TradeJournal;
}

describe('objective operation time', () => {
  it('uses the unshifted TradeRecord clock instead of the simulated campaign close', () => {
    const trade = record();
    const leg = journal();

    expect(tradeRecordOperationTime(trade)).toBe(trade.closedRealAt);
    expect(journalCloseOperationTime(leg, trade)).toBe(trade.closedRealAt);
    expect(journalOperationTime(leg, trade)).toBe(trade.closedRealAt);
    expect(journalSimulatedCloseTime(leg)).toBe(trade.closeTime);
  });

  it('never treats a legacy retroactive simulated close as objective time', () => {
    const shifted = journal({ post_simulated_close_time: undefined });

    expect(journalCloseOperationTime(shifted, null)).toBeNull();
    expect(journalOperationTime(shifted, null)).toBeNull();
    expect(journalSimulatedCloseTime(shifted)).toBe(Date.parse(shifted.post_real_close_time as string));
  });

  it('resolves live journals linked by position id and keeps the latest real close', () => {
    const first = record({ id: 'partial-1', closedRealAt: 1000, closeTime: 100 });
    const last = record({ id: 'partial-2', closedRealAt: 2000, closeTime: 200 });
    const lookup = buildTradeRecordLookup([first, last]);

    expect(lookup.get('position-1')?.id).toBe('partial-2');
    expect(lookup.get('partial-1')?.id).toBe('partial-1');
  });

  it('sorts a campaign by its latest objective operation only', () => {
    const earlier = record({ id: 'record-1', closedRealAt: 1000 });
    const later = record({ id: 'record-2', positionId: 'position-2', closedRealAt: 3000 });
    const legs = [journal(), journal({ id: 'journal-2', trade_record_id: 'record-2' })];

    expect(campaignOperationTime(legs, [earlier, later])).toBe(3000);
  });
});
