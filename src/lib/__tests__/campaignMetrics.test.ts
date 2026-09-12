import { describe, expect, it } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import {
  campaignGrowthFactor,
  computeCampaignExpectancies,
  formatArithmeticExpectancy,
  formatCampaignLeverage,
  formatGeometricExpectancy,
  resolveCampaignMainLeverage,
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
  it('resolves main leverage from live and historical campaign sources', () => {
    const mainLeg = {
      id: 'main-leg',
      leg_role: 'main_open',
      trade_record_id: 'record-1',
      leverage: 6,
    } as TradeJournal;
    const linkedRecord = { id: 'record-1', leverage: 7 } as TradeRecord;

    expect(resolveCampaignMainLeverage(campaign(), [mainLeg], [linkedRecord])).toBe(6);
    expect(resolveCampaignMainLeverage(
      campaign({ initial_leverage: null }),
      [{ ...mainLeg, leverage: null }],
      [linkedRecord],
    )).toBe(7);
    expect(resolveCampaignMainLeverage(campaign({
      initial_leverage: null,
      actual_evolution: [{
        event_type: 'main_opened',
        leverage: 5,
      } as TradeCampaign['actual_evolution'][number]],
    }), [], [])).toBe(5);
    expect(formatCampaignLeverage(6)).toBe('6x');
    expect(formatCampaignLeverage(6.5)).toBe('6.5x');
    expect(formatCampaignLeverage(null)).toBe('—');
  });

  it('战役机会质量将小于 1 的实际盈亏比统一按 1 计算', () => {
    const value = resolveCampaignOpportunityQuality(
      campaign({ status: 'closed_loss', final_realized_pnl: -80 }),
      -80,
      4,
    );

    expect(value).toBeCloseTo(0.25, 8); // max（−80/100, 1） ÷ 4 = 0.25
  });

  it('does not calculate opportunity quality for an active campaign', () => {
    expect(resolveCampaignOpportunityQuality(
      campaign({ status: 'active', closed_at: null, final_realized_pnl: null }),
      200,
      10,
    )).toBeNull();
  });

  it('【用户要求】Gᵢ = 1 + bᵢ·x，x 固定 0.1，bᵢ 用当场战役的 b', () => {
    // b = +2 → G = 1.20 → 几何期望 +20%
    expect(campaignGrowthFactor(2)).toBeCloseTo(1.2, 12);
    const result = computeCampaignExpectancies(200, 0.5);
    expect(result.geometricExpectancy).toBeCloseTo(0.2, 12);
    expect(formatGeometricExpectancy(result.geometricExpectancy)).toBe('+20.0%/笔');
    // 算术期望仍按账户胜率加权，两者是不同的量
    expect(result.arithmeticExpectancy).toBeCloseTo(0.5, 8);
    expect(formatArithmeticExpectancy(result.arithmeticExpectancy)).toBe('+0.50R');
  });

  it('【用户要求】不乘胜率：同一个 b 换个胜率，几何期望一模一样', () => {
    const low = computeCampaignExpectancies(150, 0.2).geometricExpectancy;
    const high = computeCampaignExpectancies(150, 0.9).geometricExpectancy;
    expect(low).toBeCloseTo(0.15, 12);
    expect(high).toBeCloseTo(0.15, 12);
    // 连胜率都没有时也算得出来（算术期望才需要胜率）
    expect(computeCampaignExpectancies(150, null).geometricExpectancy).toBeCloseTo(0.15, 12);
    expect(computeCampaignExpectancies(150, null).arithmeticExpectancy).toBeNull();
  });

  it('【用户要求】不再看该场真实的 Lᵢ ÷ Aᵢ：没有开仓资产快照的老战役同样算得出来', () => {
    expect(computeCampaignExpectancies(150, 0.6).geometricExpectancy).not.toBeNull();
    // 缺少 bᵢ 才算不出来
    expect(computeCampaignExpectancies(null, 0.6).geometricExpectancy).toBeNull();
  });

  it('allows a losing campaign to produce negative arithmetic and geometric expectancy', () => {
    const result = computeCampaignExpectancies(-100, 0.5);

    expect(result.arithmeticExpectancy).toBeCloseTo(-1, 8);
    // b = −1 → G = 0.9 → −10%
    expect(result.geometricExpectancy).toBeCloseTo(-0.1, 8);
  });

  it('bᵢ ≤ −10 时 1+bᵢ·x ≤ 0，本金被打穿，因子记 0、几何期望记 −100%', () => {
    expect(campaignGrowthFactor(-10)).toBe(0);
    expect(campaignGrowthFactor(-25)).toBe(0);
    expect(computeCampaignExpectancies(-1000, 0.5).geometricExpectancy).toBeCloseTo(-1, 8);
    expect(computeCampaignExpectancies(-2500, 0.5).geometricExpectancy).toBeCloseTo(-1, 8);
  });
});
