import { describe, expect, it } from 'vitest';
import type { TradeCampaign } from '@/types/journal';
import {
  computeAsymmetricRiskContribution,
  summarizeAsymmetricRiskMetrics,
} from '../asymmetricRiskMetrics';

function campaign(id: string, finalRealizedPnl: number): TradeCampaign {
  return {
    id,
    user_id: 'account-a',
    symbol: 'TESTUSDT',
    title: id,
    status: finalRealizedPnl > 0
      ? 'closed_profit'
      : finalRealizedPnl < 0 ? 'closed_loss' : 'closed_breakeven',
    final_realized_pnl: finalRealizedPnl,
  } as TradeCampaign;
}

function sample(id: string, b: number | null, pnl = b ?? 0) {
  return { campaign: campaign(id, pnl), payoffRatio: b };
}

describe('summarizeAsymmetricRiskMetrics', () => {
  it('keeps b below -1 and matches all asymmetric formulas and the Sortino identity', () => {
    const result = summarizeAsymmetricRiskMetrics([
      sample('w1', 2),
      sample('w2', 1),
      sample('w3', 4),
      sample('l1', -1),
      sample('l2', -1.2),
      sample('flat', 0, 0),
    ]);

    expect(result.sampleCount).toBe(6);
    expect(result.winCount).toBe(3);
    expect(result.lossCount).toBe(3);
    expect(result.dsi).toBeCloseTo(Math.sqrt((1 + 1.44) / 3), 12);
    expect(result.usi).toBeCloseTo(Math.sqrt(21 / 3) / (7 / 3), 12);
    expect(result.upsideStandardDeviation).toBeCloseTo(Math.sqrt(21 / 6), 12);
    expect(result.downsideStandardDeviation).toBeCloseTo(Math.sqrt(2.44 / 6), 12);
    expect(result.upsidePotential).toBeCloseTo(7 / 6, 12);
    expect(result.downsidePotential).toBeCloseTo(2.2 / 6, 12);
    expect(result.upr).toBeCloseTo((7 / 6) / Math.sqrt(2.44 / 6), 12);
    expect(result.omega).toBeCloseTo(7 / 2.2, 12);
    expect(result.sortino).toBeCloseTo(((7 - 2.2) / 6) / Math.sqrt(2.44 / 6), 12);
    expect(result.sortino).toBeCloseTo(result.sortinoIdentityRhs as number, 12);
  });

  it('excludes resolved null b values and ignores unresolved campaigns', () => {
    const active = { ...campaign('active', 3), status: 'active' as const };
    const result = summarizeAsymmetricRiskMetrics([
      sample('valid', 1),
      sample('missing', null, -1),
      { campaign: active, payoffRatio: 99 },
    ]);

    expect(result.sampleCount).toBe(1);
    expect(result.excludedPayoffCount).toBe(1);
  });

  it('returns null rather than zero or infinity when either side is absent', () => {
    const winsOnly = summarizeAsymmetricRiskMetrics([sample('w1', 1), sample('w2', 2)]);
    expect(winsOnly.dsi).toBeNull();
    expect(winsOnly.downsideStandardDeviation).toBeNull();
    expect(winsOnly.upr).toBeNull();
    expect(winsOnly.omega).toBeNull();
    expect(winsOnly.sortino).toBeNull();

    const lossesOnly = summarizeAsymmetricRiskMetrics([sample('l1', -1), sample('flat', 0, 0)]);
    expect(lossesOnly.usi).toBeNull();
    expect(lossesOnly.upsideStandardDeviation).toBeNull();
    expect(lossesOnly.upsidePotential).toBeNull();
    expect(lossesOnly.upr).toBeNull();
    expect(lossesOnly.omega).toBeNull();
  });

  it('guards zero downside denominators when the loss group only contains b = 0', () => {
    const result = summarizeAsymmetricRiskMetrics([
      sample('w1', 2),
      sample('flat', 0, 0),
    ]);

    expect(result.lossCount).toBe(1);
    expect(result.dsi).toBe(0);
    expect(result.downsideStandardDeviation).toBe(0);
    expect(result.downsidePotential).toBe(0);
    expect(result.upr).toBeNull();
    expect(result.omega).toBeNull();
    expect(result.sortino).toBeNull();
    expect(result.sortinoIdentityRhs).toBeNull();
  });

  it('computes the single-campaign b squared over group size contribution', () => {
    const summary = summarizeAsymmetricRiskMetrics([
      sample('w1', 3),
      sample('w2', 1),
      sample('l1', -0.5),
      sample('l2', -1.5),
    ]);

    expect(computeAsymmetricRiskContribution(3, summary)).toEqual({
      group: 'win',
      sampleCount: 2,
      meanSquareTerm: 4.5,
      meanSquareShare: 0.9,
    });
    expect(computeAsymmetricRiskContribution(-0.5, summary)).toEqual({
      group: 'loss',
      sampleCount: 2,
      meanSquareTerm: 0.125,
      meanSquareShare: 0.1,
    });
  });
});
