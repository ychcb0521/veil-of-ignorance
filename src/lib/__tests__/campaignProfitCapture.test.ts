import { describe, expect, it } from 'vitest';
import {
  computeDecisionAccuracy,
  computeInitialExpectedMaxLoss,
  computeProfitCaptureRatio,
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
  it('uses actual main entry/notional and the farther initial hedge A/B boundary', () => {
    const campaign = makeCampaign(600);
    const legs = [
      makeLeg('main', 'main_open', 100, 'main-record'),
      makeLeg('hedge-a', 'hedge_initial_a', 96),
      makeLeg('hedge-b', 'hedge_initial_b', 90),
    ];
    const records = [makeMainRecord()];

    // Actual main: 102 x 100 = 10,200 USDT; farthest hedge B is 12/102 away.
    expect(computeInitialExpectedMaxLoss(campaign, legs, records)).toBeCloseTo(1_200, 8);
    expect(computeDecisionAccuracy(campaign, legs, records, []).profit_capture_ratio).toBeCloseTo(50, 8);
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
    expect(computeDecisionAccuracy(campaign, legs, [], []).profit_capture_ratio).toBe(0);
  });
});
