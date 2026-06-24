import { describe, expect, it } from 'vitest';
import {
  buildCampaignMainOrderPriceLines,
  isMainStartLeg,
  MAIN_LONG_ORDER_LINE_COLOR,
  MAIN_SHORT_ORDER_LINE_COLOR,
} from '@/lib/campaignMainOrderLines';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

function journal(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'journal-1',
    user_id: 'user-1',
    trade_record_id: null,
    campaign_id: 'campaign-1',
    leg_role: 'main_open',
    leg_sequence: 1,
    source: 'snapshot',
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: 5,
    position_mode: 'isolated',
    order_kind: 'trade',
    pre_simulated_time: '2025-09-20T17:00:00.000Z',
    pre_real_time: '2026-06-18T01:17:00.000Z',
    pre_entry_price: 1,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: null,
    pre_mental_state: 4,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: true,
    pre_position_size: null,
    pre_max_loss_usdt: null,
    post_result: null,
    post_pnl: null,
    post_r_multiple: null,
    post_review_text: null,
    post_next_action: null,
    post_error_tags: null,
    post_deep_review: null,
    post_real_close_time: null,
    created_at: '2026-06-18T01:17:00.000Z',
    updated_at: '2026-06-18T01:17:00.000Z',
    ...overrides,
  } as TradeJournal;
}

function record(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: 'record-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 10,
    exitPrice: 11,
    quantity: 1,
    leverage: 5,
    pnl: 1,
    fee: 0,
    slippage: 0,
    openTime: 1000,
    closeTime: 2000,
    ...overrides,
  };
}

describe('campaign main order price lines', () => {
  it('只为主力开仓生成盘面主力开始线，并优先使用成交记录时间和价格', () => {
    const lines = buildCampaignMainOrderPriceLines(
      [
        journal({ id: 'main', trade_record_id: 'record-1', pre_entry_price: 9 }),
        journal({ id: 'add', leg_role: 'main_add_1', pre_entry_price: 12 }),
        journal({ id: 'hedge', leg_role: 'hedge_rolling', direction: 'short', pre_entry_price: 8 }),
      ],
      [record({ id: 'record-1', entryPrice: 10, openTime: 111, closeTime: 222 })],
      999,
    );

    expect(lines).toEqual([{
      price: 10,
      color: MAIN_LONG_ORDER_LINE_COLOR,
      startTime: 111,
      endTime: 222,
      dashed: false,
      endMarker: null,
      title: '主力开仓',
    }]);
  });

  it('再入场主力也生成开始线；空单用红色并在没有成交记录时回落到 journal 时间', () => {
    const openTime = Date.parse('2025-09-20T17:00:00.000Z');
    const closeTime = Date.parse('2025-09-20T18:00:00.000Z');
    const lines = buildCampaignMainOrderPriceLines(
      [journal({
        leg_role: 'reentry_main',
        direction: 'short',
        pre_entry_price: 7,
        post_real_close_time: '2025-09-20T18:00:00.000Z',
      })],
      [],
      999,
    );

    expect(lines).toEqual([{
      price: 7,
      color: MAIN_SHORT_ORDER_LINE_COLOR,
      startTime: openTime,
      endTime: closeTime,
      dashed: false,
      endMarker: null,
      title: '再入主力',
    }]);
  });

  it('识别主力开始 leg，但不把加仓当成开始', () => {
    expect(isMainStartLeg({ leg_role: 'main_open' })).toBe(true);
    expect(isMainStartLeg({ leg_role: 'reentry_main' })).toBe(true);
    expect(isMainStartLeg({ leg_role: 'main_add_1' })).toBe(false);
  });
});
