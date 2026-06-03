import { describe, expect, it } from 'vitest';

import {
  createDefaultExecutionAssetState,
  EXECUTION_DECISION_REWARD,
  EXECUTION_DIRECT_REWARD,
  EXECUTION_NO_TRADE_PENALTY,
  recordExecutionTrade,
  settleNoTradePenalties,
} from '../executionAssets';

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe('execution assets', () => {
  it('rewards decision-record trades with the accelerator weight', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordExecutionTrade(s0, 'decision', d('2026-06-03'));

    expect(s1.points).toBe(EXECUTION_DECISION_REWARD);
    expect(s1.decisionTradeCount).toBe(1);
    expect(s1.directTradeCount).toBe(0);
    expect(s1.tradedDates['2026-06-03']).toBe(true);
    expect(s1.events[0]).toMatchObject({ type: 'decision_reward', points: EXECUTION_DECISION_REWARD });
  });

  it('rewards direct trades with the smaller execution weight', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordExecutionTrade(s0, 'direct', d('2026-06-03'));

    expect(s1.points).toBe(EXECUTION_DIRECT_REWARD);
    expect(s1.decisionTradeCount).toBe(0);
    expect(s1.directTradeCount).toBe(1);
    expect(s1.events[0]).toMatchObject({ type: 'direct_reward', points: EXECUTION_DIRECT_REWARD });
  });

  it('charges the previous day when no trade was recorded', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = settleNoTradePenalties(s0, d('2026-06-04'));

    expect(s1.points).toBe(-EXECUTION_NO_TRADE_PENALTY);
    expect(s1.penaltyDays).toBe(1);
    expect(s1.lastDailyCheckDate).toBe('2026-06-04');
    expect(s1.events[0]).toMatchObject({ type: 'no_trade_penalty', points: -EXECUTION_NO_TRADE_PENALTY });
  });

  it('does not penalize a day that had at least one trade', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordExecutionTrade(s0, 'decision', d('2026-06-03'));
    const s2 = settleNoTradePenalties(s1, d('2026-06-04'));

    expect(s2.points).toBe(EXECUTION_DECISION_REWARD);
    expect(s2.penaltyDays).toBe(0);
  });
});
