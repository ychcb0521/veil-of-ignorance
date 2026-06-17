import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeJournal } from '@/types/journal';

// Regression for the "归类为新战役" submit toast:
//   "main_dual_hedge_mirror_tp 模板必须包含 main_open 角色；
//    角色 hedge_rolling 与 journal <id> 的 order_kind 不兼容"
// Both clauses were false positives: the user HAD assigned main_open, and the
// hedge_rolling leg was a record-backed (retroactive) history item. The current
// validation must (a) honour an assigned main_open and (b) skip the order_kind
// compatibility check for retroactive_from_record legs (a backfilled record
// always carries order_kind 'main' regardless of the role it is classified as).

let journals: TradeJournal[];

function journal(id: string, overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id,
    user_id: 'user-1',
    trade_record_id: null,
    campaign_id: null,
    leg_role: null,
    leg_sequence: null,
    source: 'live',
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
    pre_position_size: 800_000,
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

vi.mock('@/integrations/supabase/client', () => {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    in() { return Promise.resolve({ data: journals, error: null }); },
    order() { return builder; },
    then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
      return Promise.resolve({ data: journals, error: null }).then(resolve);
    },
  };
  return {
    supabase: {
      from: () => builder,
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
    },
  };
});

import { validateClassification } from '../journalApi';

describe('validateClassification — hedge_rolling on a retroactive (record-backed) leg', () => {
  beforeEach(() => {
    journals = [];
  });

  it('does not false-positive when main_open is assigned and a retroactive leg is hedge_rolling', async () => {
    journals = [
      journal('main-live', { source: 'live', order_kind: 'main' }),
      journal('add-retro', { source: 'retroactive_from_record', order_kind: 'main', trade_record_id: 'rec-add' }),
      journal('hedge-retro', { source: 'retroactive_from_record', order_kind: 'main', trade_record_id: 'rec-hedge', direction: 'short' }),
    ];

    const result = await validateClassification({
      strategyTemplate: 'main_dual_hedge_mirror_tp',
      legs: [
        { journalId: 'main-live', legRole: 'main_open' },
        { journalId: 'add-retro', legRole: 'main_add_1' },
        { journalId: 'hedge-retro', legRole: 'hedge_rolling' },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('still flags a genuine mismatch: a live (non-retroactive) main journal classified as hedge_rolling', async () => {
    journals = [
      journal('main-live', { source: 'live', order_kind: 'main' }),
      journal('hedge-live', { source: 'live', order_kind: 'main', trade_record_id: null }),
    ];

    const result = await validateClassification({
      strategyTemplate: 'main_dual_hedge_mirror_tp',
      legs: [
        { journalId: 'main-live', legRole: 'main_open' },
        { journalId: 'hedge-live', legRole: 'hedge_rolling' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some(message => message.includes('order_kind 不兼容'))).toBe(true);
  });
});
