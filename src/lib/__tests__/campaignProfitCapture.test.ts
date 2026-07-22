import { describe, expect, it } from 'vitest';
import {
  computeDecisionAccuracy,
  computeCampaignInitialRiskFraction,
  computeInitialExpectedMaxDrawdownPct,
  computeInitialExpectedMaxLoss,
  computeProfitCaptureRatio,
  formatCampaignPayoffRatio,
  resolveCampaignInitialRiskFraction,
} from '@/lib/campaignAnalysis';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const openedAt = '2026-07-15T00:00:00.000Z';
const closedAt = '2026-07-15T01:00:00.000Z';

function makeCampaign(finalRealizedPnl: number): TradeCampaign {
  return {
    id: 'campaign-risk-ratio',
    user_id: 'user-1',
    campaign_code: 'C-RISK',
    symbol: 'TESTUSDT',
    direction: 'main_long',
    status: finalRealizedPnl >= 0 ? 'closed_profit' : 'closed_loss',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: 'risk ratio test',
    opened_at: openedAt,
    closed_at: closedAt,
    initial_main_size_usdt: 10_000,
    initial_leverage: 1,
    final_realized_pnl: finalRealizedPnl,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    created_at: openedAt,
    updated_at: openedAt,
  };
}

function makeLeg(
  id: string,
  role: TradeJournal['leg_role'],
  price: number,
  tradeRecordId: string | null = null,
): TradeJournal {
  return {
    id,
    trade_record_id: tradeRecordId,
    leg_role: role,
    pre_simulated_time: openedAt,
    pre_entry_price: price,
    pre_position_size: role === 'main_open' ? 10_000 : 5_000,
    direction: role === 'main_open' ? 'long' : 'short',
  } as TradeJournal;
}

function makeMainRecord(): TradeRecord {
  return {
    id: 'main-record',
    symbol: 'TESTUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 102,
    exitPrice: 108,
    quantity: 100,
    leverage: 1,
    pnl: 600,
    fee: 0,
    slippage: 0,
    openTime: Date.parse(openedAt),
    closeTime: Date.parse(closedAt),
  };
}

function markAsHistorical(campaign: TradeCampaign) {
  campaign.actual_evolution = [{
    id: 'historical-created',
    timestamp: openedAt,
    event_type: 'historical_classification_created',
    leg_role: null,
    journal_id: null,
    trade_record_id: null,
    pending_order_id: null,
    price: null,
    size_usdt: null,
    notes: null,
    recorded_at: openedAt,
  }];
}

describe('campaign profit capture ratio', () => {
  it('formats the percentage with its numeric multiple', () => {
    expect(formatCampaignPayoffRatio(150)).toBe('150.0%（1.50）');
    expect(formatCampaignPayoffRatio(-50)).toBe('-50.0%（-0.50）');
  });

  it('uses actual main entry/notional and the farther initial hedge A/B boundary', () => {
    const campaign = makeCampaign(600);
    const legs = [
      makeLeg('main', 'main_open', 100, 'main-record'),
      makeLeg('hedge-a', 'hedge_initial_a', 96),
      makeLeg('hedge-b', 'hedge_initial_b', 90),
    ];
    const records = [makeMainRecord()];

    // Actual main: 102 x 100 = 10,200 USDT; farthest hedge B is 12/102 away.
    expect(computeInitialExpectedMaxDrawdownPct(campaign, legs, records)).toBeCloseTo((12 / 102) * 100, 8);
    expect(computeInitialExpectedMaxLoss(campaign, legs, records)).toBeCloseTo(1_200, 8);
    const accuracy = computeDecisionAccuracy(campaign, legs, records, []);
    expect(accuracy.initial_expected_max_loss).toBeCloseTo(1_200, 8);
    expect(accuracy.profit_capture_ratio).toBeCloseTo(50, 8);
  });

  it('uses every long position including TP and additions for a long campaign', () => {
    const campaign = makeCampaign(600);
    const legs = [
      makeLeg('main', 'main_open', 100, 'main-record'),
      { ...makeLeg('tp', 'mirror_tp', 112), direction: 'long' as const, pre_position_size: 5_000 },
      { ...makeLeg('add-1', 'main_add_1', 106), direction: 'long' as const, pre_position_size: 3_000 },
      { ...makeLeg('hedge-a', 'hedge_initial_a', 96), pre_position_size: 20_000 },
      { ...makeLeg('hedge-b', 'hedge_initial_b', 90), pre_position_size: 20_000 },
    ];
    campaign.actual_evolution = [
      {
        id: 'duplicate-main-event',
        timestamp: openedAt,
        event_type: 'main_opened',
        leg_role: 'main_open',
        journal_id: 'main',
        trade_record_id: 'main-record',
        pending_order_id: null,
        price: 102,
        size_usdt: 10_200,
        notes: null,
        recorded_at: openedAt,
        direction: 'long',
      },
      {
        id: 'duplicate-tp-event',
        timestamp: openedAt,
        event_type: 'mirror_tp_placed',
        leg_role: 'mirror_tp',
        journal_id: 'tp',
        trade_record_id: null,
        pending_order_id: 'tp-order',
        price: 112,
        size_usdt: 5_000,
        notes: null,
        recorded_at: openedAt,
        direction: 'long',
      },
    ];

    // M 10,200 + TP 5,000 + A1 3,000 = 18,200; reverse hedges are excluded.
    const expectedLoss = 18_200 * (12 / 102);
    expect(computeInitialExpectedMaxLoss(campaign, legs, [makeMainRecord()])).toBeCloseTo(expectedLoss, 8);
    expect(computeProfitCaptureRatio(campaign, legs, [makeMainRecord()])).toBeCloseTo((600 / expectedLoss) * 100, 8);
  });

  it('applies the same all-main-side rule to short campaigns', () => {
    const campaign = makeCampaign(-300);
    campaign.direction = 'main_short';
    const legs = [
      { ...makeLeg('main', 'main_open', 100), direction: 'short' as const, pre_position_size: 10_000 },
      { ...makeLeg('tp', 'mirror_tp', 88), direction: 'short' as const, pre_position_size: 5_000 },
      { ...makeLeg('hedge-a', 'hedge_initial_a', 110), direction: 'long' as const, pre_position_size: 30_000 },
    ];

    expect(computeInitialExpectedMaxLoss(campaign, legs, [])).toBeCloseTo(1_500, 8);
  });

  it('reconstructs every main-side position from event-only historical campaigns', () => {
    const campaign = makeCampaign(450);
    campaign.initial_main_size_usdt = null;
    campaign.actual_evolution = [
      {
        id: 'historical-main',
        timestamp: openedAt,
        event_type: 'historical_leg_attached',
        leg_role: 'main_open',
        journal_id: 'main-journal',
        trade_record_id: 'main-history-record',
        pending_order_id: null,
        price: 100,
        size_usdt: 5_000,
        notes: null,
        recorded_at: openedAt,
        direction: 'long',
      },
      {
        id: 'historical-tp',
        timestamp: openedAt,
        event_type: 'historical_leg_attached',
        leg_role: 'mirror_tp',
        journal_id: 'tp-journal',
        trade_record_id: 'tp-history-record',
        pending_order_id: null,
        price: 108,
        size_usdt: 2_500,
        notes: null,
        recorded_at: openedAt,
        direction: 'long',
      },
      {
        id: 'historical-tp-duplicate',
        timestamp: openedAt,
        event_type: 'mirror_tp_placed',
        leg_role: 'mirror_tp',
        journal_id: 'legacy-tp-journal-copy',
        trade_record_id: 'tp-history-record',
        pending_order_id: null,
        price: 108,
        size_usdt: 2_500,
        notes: null,
        recorded_at: openedAt,
        direction: 'long',
      },
      {
        id: 'historical-add',
        timestamp: openedAt,
        event_type: 'historical_leg_attached',
        leg_role: 'main_add_1',
        journal_id: 'add-journal',
        trade_record_id: 'add-history-record',
        pending_order_id: null,
        price: 103,
        size_usdt: 1_500,
        notes: null,
        recorded_at: openedAt,
        direction: 'long',
      },
      {
        id: 'historical-hedge',
        timestamp: openedAt,
        event_type: 'historical_leg_attached',
        leg_role: 'hedge_initial_a',
        journal_id: 'hedge-journal',
        trade_record_id: 'hedge-history-record',
        pending_order_id: null,
        price: 95,
        size_usdt: 50_000,
        notes: null,
        recorded_at: openedAt,
        direction: 'short',
      },
    ];

    // Historical M 5,000 + TP 2,500 + A1 1,500 = 9,000; 5% risk boundary.
    expect(computeInitialExpectedMaxLoss(campaign, [], [])).toBeCloseTo(450, 8);
    expect(computeProfitCaptureRatio(campaign, [], [])).toBeCloseTo(100, 8);
  });

  it('uses the initial main-entry equity snapshot to compute the campaign risk fraction', () => {
    const legs = [
      { ...makeLeg('main', 'main_open', 100), pre_account_equity_usdt: 80_000 },
      { ...makeLeg('hedge-a', 'hedge_initial_a', 94), pre_account_equity_usdt: 70_000 },
    ];

    const risk = computeCampaignInitialRiskFraction(1_200, legs);
    expect(risk).toEqual({
      initialExpectedMaxLoss: 1_200,
      accountEquityAtMainOpen: 80_000,
      drawdownFraction: 0.015,
    });
  });

  it('does not substitute a later-leg or current equity when the main snapshot is missing', () => {
    const legs = [
      makeLeg('main', 'main_open', 100),
      { ...makeLeg('hedge-a', 'hedge_initial_a', 94), pre_account_equity_usdt: 70_000 },
    ];

    expect(computeCampaignInitialRiskFraction(1_200, legs)).toBeNull();
    expect(computeCampaignInitialRiskFraction(0, legs)).toBeNull();
  });

  it('prefers the immutable main-entry snapshot over a current-account fallback', () => {
    const legs = [
      { ...makeLeg('main', 'main_open', 100), pre_account_equity_usdt: 80_000 },
    ];

    expect(resolveCampaignInitialRiskFraction(1_200, legs, 40_000)).toEqual({
      initialExpectedMaxLoss: 1_200,
      accountEquityAtMainOpen: 80_000,
      drawdownFraction: 0.015,
      source: 'main_open_snapshot',
    });
  });

  it('uses current total account equity when a legacy campaign has no main-entry snapshot', () => {
    const legs = [makeLeg('main', 'main_open', 100)];

    expect(resolveCampaignInitialRiskFraction(1_200, legs, 40_000)).toEqual({
      initialExpectedMaxLoss: 1_200,
      accountEquityAtMainOpen: 40_000,
      drawdownFraction: 0.03,
      source: 'current_account_fallback',
    });
    expect(resolveCampaignInitialRiskFraction(1_200, legs, 80_000)?.drawdownFraction).toBe(0.015);
  });

  it('rejects a fallback when expected loss or current account equity is unavailable', () => {
    const legs = [makeLeg('main', 'main_open', 100)];

    expect(resolveCampaignInitialRiskFraction(1_200, legs, null)).toBeNull();
    expect(resolveCampaignInitialRiskFraction(1_200, legs, 0)).toBeNull();
    expect(resolveCampaignInitialRiskFraction(0, legs, 40_000)).toBeNull();
  });

  it('preserves the minus sign when realized P&L is negative', () => {
    const campaign = makeCampaign(-300);
    const legs = [
      makeLeg('main', 'main_open', 100),
      makeLeg('hedge-a', 'hedge_initial_a', 94),
    ];

    expect(computeInitialExpectedMaxLoss(campaign, legs, [])).toBeCloseTo(600, 8);
    expect(computeDecisionAccuracy(campaign, legs, [], []).profit_capture_ratio).toBeCloseTo(-50, 8);
  });

  it('fills historical campaigns from saved leg snapshots when the campaign summary and local records are absent', () => {
    const campaign = makeCampaign(0);
    campaign.final_realized_pnl = null;
    campaign.initial_main_size_usdt = 5_000;
    const legs = [
      { ...makeLeg('main', 'main_open', 200), pre_position_size: 5_000, post_realized_pnl: 175 },
      { ...makeLeg('hedge-b', 'hedge_initial_b', 190), pre_position_size: 2_500, post_realized_pnl: -50 },
    ];

    expect(computeInitialExpectedMaxLoss(campaign, legs, [])).toBeCloseTo(250, 8);
    expect(computeDecisionAccuracy(campaign, legs, [], []).profit_capture_ratio).toBeCloseTo(50, 8);
  });

  it('fills event-only historical campaigns without requiring local trade records', () => {
    const campaign = makeCampaign(0);
    campaign.final_realized_pnl = null;
    campaign.initial_main_size_usdt = 5_000;
    campaign.actual_evolution = [
      {
        id: 'main-event',
        timestamp: openedAt,
        event_type: 'historical_leg_attached',
        leg_role: 'main_open',
        journal_id: 'main-journal',
        trade_record_id: 'main-history-record',
        pending_order_id: null,
        price: 200,
        size_usdt: 5_000,
        notes: null,
        recorded_at: openedAt,
        realized_pnl: 175,
      },
      {
        id: 'hedge-event',
        timestamp: openedAt,
        event_type: 'historical_leg_attached',
        leg_role: 'hedge_initial_b',
        journal_id: 'hedge-journal',
        trade_record_id: 'hedge-history-record',
        pending_order_id: null,
        price: 190,
        size_usdt: 2_500,
        notes: null,
        recorded_at: openedAt,
        realized_pnl: -50,
      },
    ];

    expect(computeInitialExpectedMaxLoss(campaign, [], [])).toBeCloseTo(250, 8);
    expect(computeDecisionAccuracy(campaign, [], [], []).profit_capture_ratio).toBeCloseTo(50, 8);
  });

  it('replaces a legacy historical zero placeholder with preserved leg P&L', () => {
    const campaign = makeCampaign(0);
    markAsHistorical(campaign);
    const legs = [
      { ...makeLeg('main', 'main_open', 100), post_realized_pnl: 700 },
      { ...makeLeg('hedge-a', 'hedge_initial_a', 90), post_realized_pnl: -200 },
    ];

    expect(computeDecisionAccuracy(campaign, legs, [], []).profit_capture_ratio).toBeCloseTo(50, 8);
  });

  it('recomputes historical P&L from preserved trades instead of a stale non-zero campaign summary', () => {
    const campaign = makeCampaign(999);
    markAsHistorical(campaign);
    const legs = [
      { ...makeLeg('main', 'main_open', 100), post_realized_pnl: 700 },
      { ...makeLeg('hedge-a', 'hedge_initial_a', 90), post_realized_pnl: -200 },
    ];

    expect(computeProfitCaptureRatio(campaign, legs, [])).toBeCloseTo(50, 8);
  });

  it('uses the original historical trigger price instead of the slipped hedge fill', () => {
    const campaign = makeCampaign(500);
    markAsHistorical(campaign);
    const legs = [
      { ...makeLeg('main', 'main_open', 100), post_realized_pnl: 500 },
      makeLeg('hedge-a', 'hedge_initial_a', 94),
    ];
    const reverseOrders = [{
      id: 'initial-a',
      side: 'SHORT' as const,
      price: 95,
      fillPrice: 94,
      createdAt: 1,
      triggeredAt: 2,
      cancelledAt: 3,
      status: 'triggered' as const,
    }];

    expect(computeInitialExpectedMaxLoss(campaign, legs, [], reverseOrders)).toBeCloseTo(500, 8);
    expect(computeInitialExpectedMaxDrawdownPct(campaign, legs, [], reverseOrders)).toBeCloseTo(5, 8);
    expect(computeProfitCaptureRatio(campaign, legs, [], reverseOrders)).toBeCloseTo(100, 8);
  });

  it('deduplicates legacy position IDs and current record IDs for the same historical trade', () => {
    const campaign = makeCampaign(999);
    markAsHistorical(campaign);
    campaign.actual_evolution.push({
      id: 'legacy-main-event',
      timestamp: closedAt,
      event_type: 'historical_leg_attached',
      leg_role: 'main_open',
      journal_id: 'main',
      trade_record_id: 'legacy-position-id',
      pending_order_id: null,
      price: 100,
      size_usdt: 10_000,
      notes: null,
      recorded_at: closedAt,
      realized_pnl: 500,
    });
    const legs = [
      { ...makeLeg('main', 'main_open', 100, 'legacy-position-id'), post_realized_pnl: 500 },
      makeLeg('hedge-a', 'hedge_initial_a', 90),
    ];
    const records = [{
      ...makeMainRecord(),
      id: 'current-close-record-id',
      positionId: 'legacy-position-id',
      entryPrice: 100,
      quantity: 100,
      pnl: 500,
    }];

    expect(computeProfitCaptureRatio(campaign, legs, records)).toBeCloseTo(50, 8);
  });

  it('recovers missing historical A/B prices from the earliest reverse-order snapshots', () => {
    const campaign = makeCampaign(500);
    const legs = [makeLeg('main', 'main_open', 100)];
    const reverseOrders = [
      { id: 'a', side: 'SHORT', price: 96, createdAt: 1, cancelledAt: 2, status: 'cancelled' as const },
      { id: 'b', side: 'SHORT', price: 90, createdAt: 2, cancelledAt: 3, status: 'cancelled' as const },
      { id: 'rolling', side: 'SHORT', price: 80, createdAt: 3, cancelledAt: 4, status: 'cancelled' as const },
    ];

    expect(computeInitialExpectedMaxLoss(campaign, legs, [], reverseOrders)).toBeCloseTo(1_000, 8);
    expect(computeDecisionAccuracy(campaign, legs, [], [], reverseOrders).profit_capture_ratio).toBeCloseTo(50, 8);
  });

  it('returns zero when no initial hedge price is available', () => {
    const campaign = makeCampaign(500);
    const legs = [makeLeg('main', 'main_open', 100)];

    expect(computeInitialExpectedMaxLoss(campaign, legs, [])).toBe(0);
    expect(computeInitialExpectedMaxDrawdownPct(campaign, legs, [])).toBe(0);
    expect(computeDecisionAccuracy(campaign, legs, [], []).profit_capture_ratio).toBe(0);
  });
});
