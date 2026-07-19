import { describe, expect, it } from 'vitest';
import type { TradeCampaign } from '@/types/journal';
import {
  computeCampaignExpectancies,
  formatArithmeticExpectancy,
  formatGeometricExpectancy,
  resolveCampaignOpportunityQuality,
} from '../campaignMetrics';

function campaign(overrides: Partial<TradeCampaign> = {}): TradeCampaign {
  return {
    id: 'campaign-1',
    user_id: 'user-1',
    campaign_code: 'C-TEST-1',
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: 'BTC campaign',
    opened_at: '2026-01-01T00:00:00.000Z',
    closed_at: '2026-01-01T01:00:00.000Z',
    initial_main_size_usdt: 1_000,
    initial_leverage: 1,
    final_realized_pnl: 200,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T01:00:00.000Z',
    ...overrides,
  };
}

describe('campaign metrics shared by list and detail pages', () => {
  it('机会质量取盈亏比绝对值：亏损战役也是正的量级', () => {
    const value = resolveCampaignOpportunityQuality(
      campaign({ status: 'closed_loss', final_realized_pnl: -80 }),
      -80,
      4,
    );

    expect(value).toBeCloseTo(0.2, 8); // |−80/100| ÷ 4 = 0.2
  });

  it('does not calculate opportunity quality for an active campaign', () => {
    expect(resolveCampaignOpportunityQuality(
      campaign({ status: 'active', closed_at: null, final_realized_pnl: null }),
      200,
      10,
    )).toBeNull();
  });

  it('uses the account win rate, signed payoff ratio and actual risk fraction', () => {
    const result = computeCampaignExpectancies(200, 0.5, 0.01);

    expect(result.arithmeticExpectancy).toBeCloseTo(0.5, 8);
    expect(result.geometricExpectancy).toBeCloseTo(Math.sqrt(1.02 * 0.99) - 1, 8);
    expect(formatArithmeticExpectancy(result.arithmeticExpectancy)).toBe('+0.50R');
    expect(formatGeometricExpectancy(result.geometricExpectancy)).toBe('+0.5%/笔');
  });

  it('allows a losing campaign to produce negative arithmetic and geometric expectancy', () => {
    const result = computeCampaignExpectancies(-100, 0.5, 0.1);

    expect(result.arithmeticExpectancy).toBeCloseTo(-1, 8);
    expect(result.geometricExpectancy).toBeCloseTo(-0.1, 8);
  });
});
