import { describe, expect, it } from 'vitest';
import { buildCampaignChartContentTimeSpan, pickCampaignOverviewInterval } from '@/lib/campaignChartContentSpan';
import {
  CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER,
  CAMPAIGN_EDGE_PAD_MS,
  buildCampaignKlineTimeWindow,
  buildCampaignKlineVisibleRange,
} from '@/hooks/useCampaignKlines';
import type { CampaignCounterfactual, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const t = (iso: string) => Date.parse(iso);

function campaign(overrides: Partial<TradeCampaign> = {}): TradeCampaign {
  return {
    id: 'campaign-1',
    user_id: 'user-1',
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: 'BTCUSDT campaign',
    opened_at: '2026-01-02T00:00:00.000Z',
    closed_at: '2026-01-02T02:00:00.000Z',
    initial_main_size_usdt: null,
    initial_leverage: null,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-02T02:00:00.000Z',
    ...overrides,
  };
}

function leg(overrides: Partial<TradeJournal> = {}): TradeJournal {
  return {
    id: 'leg-1',
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
    pre_simulated_time: '2026-01-02T00:15:00.000Z',
    pre_real_time: '2026-01-02T00:15:00.000Z',
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
    post_real_close_time: null,
    created_at: '2026-01-02T00:15:00.000Z',
    updated_at: '2026-01-02T00:15:00.000Z',
    ...overrides,
  } as TradeJournal;
}

function record(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 'record-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 1,
    exitPrice: 2,
    quantity: 1,
    leverage: 5,
    pnl: 1,
    fee: 0,
    slippage: 0,
    openTime: t('2026-01-02T00:20:00.000Z'),
    closeTime: t('2026-01-02T01:00:00.000Z'),
    ...overrides,
  };
}

function counterfactual(overrides: Partial<CampaignCounterfactual> = {}): CampaignCounterfactual {
  return {
    id: 'cf-1',
    user_id: 'user-1',
    campaign_id: 'campaign-1',
    label: 'Pure SOP',
    branch_kind: 'pure_sop',
    source_deduction_id: null,
    params: {
      entry: {
        time: '2026-01-01T23:40:00.000Z',
        direction: 'long',
        price: 1,
        size_usdt: 100,
        leverage: 5,
      },
      hedge_a: { offset_pct: 1, size_pct: 50 },
      hedge_b: { offset_pct: 2, size_pct: 50 },
      mirror_tp: { offset_pct: 1, size_pct: 50 },
      rolling: {
        enabled: false,
        trigger_rise_pct: 0,
        min_interval_minutes: 0,
        new_hedge_offset_pct: 0,
        rolling_hedge_size_pct: 0,
      },
      exit_rule: 'manual_only',
    },
    result: {
      final_realized_pnl: 0,
      final_r_multiple: 0,
      peak_unrealized_pnl: 0,
      peak_drawdown: 0,
      profit_capture_ratio: 0,
      sop_score: 0,
      events: [{
        timestamp: '2026-01-02T03:30:00.000Z',
        event_type: 'main_fully_closed',
        leg_role: 'main_open',
        price: 2,
        size_usdt: 100,
        notes: '',
      }],
      legs_summary: [{
        leg_role: 'mirror_tp',
        placed_at: '2026-01-02T03:00:00.000Z',
        trigger_price: 2,
        status: 'cancelled',
        triggered_at: null,
        realized_pnl_usdt: 0,
      }],
      state_segments: [],
    },
    created_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildCampaignChartContentTimeSpan', () => {
  it('囊括战役边界、legs、委托空单和当前反事实层的时间', () => {
    const reverseOrder: CampaignReverseHedgeOrder = {
      id: 'reverse-1',
      side: 'SHORT',
      price: 1,
      status: 'triggered',
      createdAt: t('2026-01-01T23:30:00.000Z'),
      triggeredAt: t('2026-01-01T23:50:00.000Z'),
      cancelledAt: t('2026-01-02T03:10:00.000Z'),
      tradeRecordId: null,
    };

    const span = buildCampaignChartContentTimeSpan(
      campaign(),
      [leg({ trade_record_id: 'record-1' })],
      [record({ id: 'record-1' })],
      [reverseOrder],
      counterfactual(),
    );

    expect(span).toEqual({
      startMs: t('2026-01-01T23:30:00.000Z'),
      endMs: t('2026-01-02T03:30:00.000Z'),
    });
  });

  it('没有有效时间时返回空跨度', () => {
    expect(buildCampaignChartContentTimeSpan(null, [], [], [], null)).toEqual({
      startMs: null,
      endMs: null,
    });
  });
});

describe('pickCampaignOverviewInterval', () => {
  it('按内容跨度自动选择默认总览周期，避免长战役首屏塞不下', () => {
    expect(pickCampaignOverviewInterval({
      startMs: t('2026-01-01T00:00:00.000Z'),
      endMs: t('2026-01-01T06:00:00.000Z'),
    })).toBe('1m');

    expect(pickCampaignOverviewInterval({
      startMs: t('2026-01-01T00:00:00.000Z'),
      endMs: t('2026-01-03T00:00:00.000Z'),
    })).toBe('5m');

    expect(pickCampaignOverviewInterval({
      startMs: t('2026-01-01T00:00:00.000Z'),
      endMs: t('2026-01-08T00:00:00.000Z'),
    })).toBe('15m');

    expect(pickCampaignOverviewInterval({
      startMs: t('2026-01-01T00:00:00.000Z'),
      endMs: t('2026-02-10T00:00:00.000Z'),
    })).toBe('1h');
  });
});

describe('buildCampaignKlineTimeWindow', () => {
  it('默认显示三倍窗口，同时预载左右各二十五倍的完整五十一倍范围', () => {
    const openedAtMs = t('2026-01-02T00:00:00.000Z');
    const closedAtMs = t('2026-01-02T02:00:00.000Z');
    const window = buildCampaignKlineTimeWindow(
      openedAtMs,
      closedAtMs,
      t('2026-01-02T00:30:00.000Z'),
      t('2026-01-02T02:30:00.000Z'),
    );

    expect(window).toEqual({
      fromTime: t('2025-12-30T22:30:00.000Z'),
      toTime: t('2026-01-04T04:30:00.000Z'),
      defaultFromTime: t('2026-01-01T22:30:00.000Z'),
      defaultToTime: t('2026-01-02T04:30:00.000Z'),
      contentStartMs: t('2026-01-02T00:30:00.000Z'),
      contentEndMs: t('2026-01-02T02:30:00.000Z'),
      contextMs: 2 * 60 * 60_000,
      availableContextMs: 50 * 60 * 60_000,
    });
    expect(window.contentStartMs! - window.defaultFromTime).toBe(window.contextMs);
    expect(window.defaultToTime - window.contentEndMs!).toBe(window.contextMs);
    expect(window.contentStartMs! - window.fromTime).toBe(window.availableContextMs);
    expect(window.toTime - window.contentEndMs!).toBe(window.availableContextMs);
    expect(window.availableContextMs).toBe(window.contextMs! * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER);
  });

  it('各倍率都围绕战役内容居中，一倍只显示战役本身', () => {
    const window = buildCampaignKlineTimeWindow(
      t('2026-01-02T00:00:00.000Z'),
      t('2026-01-02T03:00:00.000Z'),
      t('2026-01-02T00:30:00.000Z'),
      t('2026-01-02T02:30:00.000Z'),
    );

    expect(buildCampaignKlineVisibleRange(window, 1)).toEqual({
      fromTime: t('2026-01-02T00:30:00.000Z'),
      toTime: t('2026-01-02T02:30:00.000Z'),
    });
    expect(buildCampaignKlineVisibleRange(window, 2)).toEqual({
      fromTime: t('2026-01-01T23:30:00.000Z'),
      toTime: t('2026-01-02T03:30:00.000Z'),
    });
    expect(buildCampaignKlineVisibleRange(window, 3)).toEqual({
      fromTime: window.defaultFromTime,
      toTime: window.defaultToTime,
    });
    expect(buildCampaignKlineVisibleRange(window, 51)).toEqual({
      fromTime: window.fromTime,
      toTime: window.toTime,
    });
  });

  it('默认总览周期按扩展后的三段窗口计算，老战役打开时也会重新撑开盘面', () => {
    const window = buildCampaignKlineTimeWindow(
      t('2026-01-02T00:00:00.000Z'),
      t('2026-01-02T15:00:00.000Z'),
      t('2026-01-02T00:00:00.000Z'),
      t('2026-01-02T15:00:00.000Z'),
    );

    expect(pickCampaignOverviewInterval({
      startMs: t('2026-01-02T00:00:00.000Z'),
      endMs: t('2026-01-02T15:00:00.000Z'),
    })).toBe('1m');
    expect(pickCampaignOverviewInterval({
      startMs: window.defaultFromTime,
      endMs: window.defaultToTime,
    })).toBe('5m');
  });

  it('单点内容区间用最小缓冲兜底，空区间保留旧宽松窗口', () => {
    const openedAtMs = t('2026-01-02T00:00:00.000Z');
    const closedAtMs = t('2026-01-02T02:00:00.000Z');
    const singlePoint = t('2026-01-02T00:30:00.000Z');

    expect(buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, singlePoint, singlePoint)).toEqual({
      fromTime: singlePoint - CAMPAIGN_EDGE_PAD_MS * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER,
      toTime: singlePoint + CAMPAIGN_EDGE_PAD_MS * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER,
      defaultFromTime: singlePoint - CAMPAIGN_EDGE_PAD_MS,
      defaultToTime: singlePoint + CAMPAIGN_EDGE_PAD_MS,
      contentStartMs: singlePoint,
      contentEndMs: singlePoint,
      contextMs: CAMPAIGN_EDGE_PAD_MS,
      availableContextMs: CAMPAIGN_EDGE_PAD_MS * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER,
    });

    expect(buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, null, null)).toEqual({
      fromTime: t('2026-01-01T18:00:00.000Z'),
      toTime: t('2026-01-02T04:00:00.000Z'),
      defaultFromTime: t('2026-01-01T18:00:00.000Z'),
      defaultToTime: t('2026-01-02T04:00:00.000Z'),
      contentStartMs: null,
      contentEndMs: null,
      contextMs: null,
      availableContextMs: null,
    });
  });
});
