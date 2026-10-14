import { describe, expect, it } from 'vitest';
import { computeCampaignGeometricMetrics, payoffRatioHedgeWear } from '@/lib/campaignGeometricMetrics';
import { computeInitialExpectedMaxLoss } from '@/lib/campaignAnalysis';
import { correctedLossLegs, correctedLossStoredCampaign, correctedLossTradeRecords, CORRECTED_LOSS_CLOSED_AT } from '@/test/fixtures/correctedLossCampaign';

describe('【用户要求】盈亏比方法二：神奇的 b − 中途对冲空单的累积磨损值（−ΔR）', () => {
  it('两张中途对冲空单都在主力平仓前平掉：亏损之和 ÷ L₀ 为负的磨损', () => {
    const campaign = correctedLossStoredCampaign(), legs = correctedLossLegs(), records = correctedLossTradeRecords();
    const m = computeCampaignGeometricMetrics(campaign, legs, records);
    const L0 = computeInitialExpectedMaxLoss(campaign, legs, records);
    expect(L0).toBeGreaterThan(0);
    expect(m.hedgeWearLegCount).toBe(2);
    expect(m.hedgeWearUsd).toBeCloseTo(-1610.56 - 5764.39, 2);
    expect(m.hedgeWearR).toBeCloseTo((-1610.56 - 5764.39) / L0, 8);
  });

  it('参与相对涨幅计算的已触发空单（主力平仓时仍锁住行情）不算磨损', () => {
    const campaign = correctedLossStoredCampaign(), legs = correctedLossLegs();
    const records = correctedLossTradeRecords().map(record => record.id === 'r-hedge-b'
      ? { ...record, closeTime: Date.parse(CORRECTED_LOSS_CLOSED_AT) } : record);
    const m = computeCampaignGeometricMetrics(campaign, legs, records);
    expect(m.hedgeWearLegCount).toBe(1);
    expect(m.hedgeWearUsd).toBeCloseTo(-1610.56, 2);
  });

  it('括号读数：亏损写「−」并标红，盈利写「+」；没有中途对冲空单不加括号', () => {
    expect(payoffRatioHedgeWear(2.1, -0.345)).toEqual({ b: '2.10', wear: '−0.34', negative: true, text: '(2.10 −0.34)' });
    expect(payoffRatioHedgeWear(2.1, 0.5)?.text).toBe('(2.10 +0.50)');
    expect(payoffRatioHedgeWear(null, -0.5)?.text).toBe('(−0.50)');
    expect(payoffRatioHedgeWear(2.1, null)).toBeNull();
  });
});
