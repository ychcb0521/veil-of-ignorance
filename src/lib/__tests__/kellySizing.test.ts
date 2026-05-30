import { describe, expect, it } from 'vitest';

import type { TradeJournal } from '@/types/journal';
import type { TradeCampaign } from '@/types/journal';
import {
  computeBetSizing,
  estimateCampaignSizingStats,
  estimatePayoffRatio,
  RUIN_PROBABILITY_TARGET,
  DEFAULT_PAYOFF_RATIO,
} from '../kellySizing';

function journal(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    journal_kind: 'trade',
    post_realized_pnl: null,
    ...overrides,
  } as TradeJournal;
}

function campaign(overrides: Partial<TradeCampaign>): TradeCampaign {
  return {
    status: 'closed_profit',
    final_realized_pnl: 100,
    ...overrides,
  } as TradeCampaign;
}

describe('computeBetSizing', () => {
  it('flags a negative-edge bet as no_edge with zero recommended size', () => {
    const r = computeBetSizing({ winProb: 0.3, payoffRatio: 1, equity: 10_000, plannedMaxLossUsdt: 100 });
    expect(r.verdict).toBe('no_edge');
    expect(r.kellyFraction).toBeLessThan(0);
    expect(r.recommendedMaxLossUsdt).toBe(0);
  });

  it('caps a positive-edge bet by ruin probability below the raw half-Kelly size', () => {
    const r = computeBetSizing({ winProb: 0.6, payoffRatio: 2, equity: 10_000, plannedMaxLossUsdt: null });
    expect(r.kellyFraction).toBeGreaterThan(0);
    expect(r.recommendedMaxLossUsdt).toBeGreaterThan(0);
    // ruin cap is the binding constraint here, so recommended < raw half-Kelly
    expect(r.recommendedMaxLossUsdt).toBeLessThan(r.halfKellyMaxLossUsdt);
    expect(r.recommendedMaxLossUsdt).toBeLessThanOrEqual(r.ruinCapMaxLossUsdt + 1e-6);
    // by construction the recommended size keeps ruin within target
    expect(r.ruinProbabilityAtRecommended).toBeLessThanOrEqual(RUIN_PROBABILITY_TARGET + 0.02);
  });

  it('marks an oversized plan as over_ruin_cap (capped by ruin, not confidence)', () => {
    const r = computeBetSizing({ winProb: 0.6, payoffRatio: 2, equity: 10_000, plannedMaxLossUsdt: 9_000 });
    expect(r.verdict).toBe('over_ruin_cap');
    expect(r.ruinProbabilityAtPlanned).not.toBeNull();
    expect(r.ruinProbabilityAtPlanned as number).toBeGreaterThan(RUIN_PROBABILITY_TARGET);
  });

  it('accepts a tiny plan as within the recommended cap', () => {
    const r = computeBetSizing({ winProb: 0.6, payoffRatio: 2, equity: 10_000, plannedMaxLossUsdt: 5 });
    expect(r.verdict).toBe('within');
  });

  it('returns zeros for non-positive equity', () => {
    const r = computeBetSizing({ winProb: 0.7, payoffRatio: 2, equity: 0, plannedMaxLossUsdt: 100 });
    expect(r.halfKellyMaxLossUsdt).toBe(0);
    expect(r.ruinCapMaxLossUsdt).toBe(0);
    expect(r.recommendedMaxLossUsdt).toBe(0);
  });
});

describe('estimatePayoffRatio', () => {
  it('returns null when there are too few win or loss samples', () => {
    const journals = [
      journal({ post_realized_pnl: 100 }),
      journal({ post_realized_pnl: -50 }),
    ];
    expect(estimatePayoffRatio(journals)).toBeNull();
  });

  it('computes avg-win / avg-loss when enough samples exist', () => {
    const journals: TradeJournal[] = [];
    for (let i = 0; i < 5; i++) journals.push(journal({ post_realized_pnl: 200 }));
    for (let i = 0; i < 5; i++) journals.push(journal({ post_realized_pnl: -100 }));
    expect(estimatePayoffRatio(journals)).toBeCloseTo(2, 5);
  });

  it('ignores no_trade journals', () => {
    const journals: TradeJournal[] = [];
    for (let i = 0; i < 5; i++) journals.push(journal({ post_realized_pnl: 300 }));
    for (let i = 0; i < 5; i++) journals.push(journal({ post_realized_pnl: -100 }));
    // a pile of no_trade rows with absurd pnl must not move the ratio
    for (let i = 0; i < 20; i++) journals.push(journal({ journal_kind: 'no_trade', post_realized_pnl: 99_999 }));
    expect(estimatePayoffRatio(journals)).toBeCloseTo(3, 5);
  });
});

describe('estimateCampaignSizingStats', () => {
  it('returns null win rate when closed-campaign samples are too few', () => {
    const campaigns = [
      campaign({ final_realized_pnl: 100, status: 'closed_profit' }),
      campaign({ final_realized_pnl: -50, status: 'closed_loss' }),
    ];
    const result = estimateCampaignSizingStats(campaigns);
    expect(result.winRate).toBeNull();
    expect(result.payoffRatio).toBeNull();
  });

  it('computes campaign-level win rate and payoff ratio from resolved campaigns only', () => {
    const campaigns: TradeCampaign[] = [];
    for (let i = 0; i < 6; i++) campaigns.push(campaign({ final_realized_pnl: 200, status: 'closed_profit' }));
    for (let i = 0; i < 5; i++) campaigns.push(campaign({ final_realized_pnl: -100, status: 'closed_loss' }));
    campaigns.push(campaign({ status: 'active', final_realized_pnl: null }));

    const result = estimateCampaignSizingStats(campaigns);
    expect(result.winRate).toBeCloseTo(6 / 11, 5);
    expect(result.payoffRatio).toBeCloseTo(2, 5);
    expect(result.winRateSampleCount).toBe(11);
  });
});

describe('exported constants', () => {
  it('uses a conservative ruin target and default payoff', () => {
    expect(RUIN_PROBABILITY_TARGET).toBeGreaterThan(0);
    expect(RUIN_PROBABILITY_TARGET).toBeLessThan(0.2);
    expect(DEFAULT_PAYOFF_RATIO).toBeGreaterThan(0);
  });
});
