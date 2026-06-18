import { describe, expect, it } from 'vitest';
import {
  buildSelectedLegVerticalLines,
  SELECTED_LEG_LONG_LINE_COLOR,
  SELECTED_LEG_SHORT_LINE_COLOR,
  SELECTED_LEG_VERTICAL_LINE_WIDTH,
} from '@/lib/campaignLegMarkers';
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
    side: 'long',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 1,
    exitPrice: 2,
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

describe('campaign selected leg markers', () => {
  it('只为选中的 leg 生成开仓实线和平仓虚线', () => {
    const lines = buildSelectedLegVerticalLines(
      [journal({ id: 'main', trade_record_id: 'record-1', leg_role: 'main_add_1' })],
      [record({ id: 'record-1', openTime: 111, closeTime: 222 })],
      ['main'],
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      time: 111,
      color: SELECTED_LEG_LONG_LINE_COLOR,
      width: SELECTED_LEG_VERTICAL_LINE_WIDTH,
      dashed: false,
      label: '加仓1·开仓',
    });
    expect(lines[1]).toMatchObject({
      time: 222,
      color: SELECTED_LEG_LONG_LINE_COLOR,
      width: SELECTED_LEG_VERTICAL_LINE_WIDTH,
      dashed: true,
      label: '加仓1·平仓',
    });
  });

  it('空单使用深紫色，并在没有 trade record 时回落到 journal 时间', () => {
    const closeIso = '2025-09-20T18:00:00.000Z';
    const lines = buildSelectedLegVerticalLines(
      [journal({
        id: 'hedge',
        direction: 'short',
        leg_role: 'hedge_rolling',
        pre_simulated_time: '2025-09-20T17:00:00.000Z',
        post_real_close_time: closeIso,
      })],
      [],
      ['hedge'],
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      color: SELECTED_LEG_SHORT_LINE_COLOR,
      dashed: false,
      label: '滚动对冲·开仓',
    });
    expect(lines[1]).toMatchObject({
      time: new Date(closeIso).getTime(),
      color: SELECTED_LEG_SHORT_LINE_COLOR,
      dashed: true,
      label: '滚动对冲·平仓',
    });
  });

  it('未选中的 leg 不生成盘面高亮线', () => {
    const lines = buildSelectedLegVerticalLines(
      [journal({ id: 'main', trade_record_id: 'record-1' })],
      [record({ id: 'record-1' })],
      [],
    );

    expect(lines).toEqual([]);
  });
});
