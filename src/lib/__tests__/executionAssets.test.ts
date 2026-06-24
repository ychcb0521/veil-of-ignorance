import { describe, expect, it } from 'vitest';

import {
  createDefaultExecutionAssetState,
  EXECUTION_CAMPAIGN_REWARD,
  EXECUTION_DECISION_REWARD,
  EXECUTION_DIRECT_REWARD,
  EXECUTION_NO_TRADE_PENALTY,
  recordCampaignCreated,
  reconcileCampaignRewards,
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

  it('stores the trade snapshot on rewarded trade events', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordExecutionTrade(s0, 'decision', d('2026-06-03'), {
      symbol: 'BTCUSDT',
      side: 'LONG',
      orderType: 'MARKET',
      entryPrice: 105000,
      quantity: 0.2,
      leverage: 5,
      marginMode: 'isolated',
      margin: 4200,
      notional: 21000,
      simulatedTime: d('2026-06-03').getTime(),
      positionId: 'pos-1',
    });

    expect(s1.events[0].trade).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'LONG',
      orderType: 'MARKET',
      entryPrice: 105000,
      quantity: 0.2,
      leverage: 5,
      positionId: 'pos-1',
    });
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

describe('建战役 +1500（按 ID 幂等 + 对账自愈）', () => {
  it('每创建一次 +1500、计数+1、记一笔带 campaignId 的事件', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordCampaignCreated(s0, 'camp-1', d('2026-06-03'));

    expect(s1.points).toBe(EXECUTION_CAMPAIGN_REWARD);
    expect(s1.campaignCount).toBe(1);
    expect(s1.rewardedCampaignIds).toEqual(['camp-1']);
    expect(s1.events[0]).toMatchObject({ type: 'campaign_reward', points: EXECUTION_CAMPAIGN_REWARD, campaignId: 'camp-1' });
  });

  it('同一战役 ID 不重复加分（幂等）', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordCampaignCreated(s0, 'camp-1', d('2026-06-03'));
    const s2 = recordCampaignCreated(s1, 'camp-1', d('2026-06-03'));

    expect(s2.points).toBe(EXECUTION_CAMPAIGN_REWARD);
    expect(s2.campaignCount).toBe(1);
    expect(s2.rewardedCampaignIds).toEqual(['camp-1']);
  });

  it('对账：把漏记的战役全部补 +1500（修复「创建后没加分」）', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03')); // points 0, count 0
    const s1 = reconcileCampaignRewards(s0, ['a', 'b', 'c'], d('2026-06-03'));

    expect(s1.points).toBe(EXECUTION_CAMPAIGN_REWARD * 3);
    expect(s1.campaignCount).toBe(3);
    expect(new Set(s1.rewardedCampaignIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('对账幂等：再跑一次不重复加分', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = reconcileCampaignRewards(s0, ['a', 'b'], d('2026-06-03'));
    const s2 = reconcileCampaignRewards(s1, ['a', 'b'], d('2026-06-03'));

    expect(s2.points).toBe(EXECUTION_CAMPAIGN_REWARD * 2);
    expect(s2.campaignCount).toBe(2);
  });

  it('对账会去重重复传入的战役 ID，避免重复加分', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = reconcileCampaignRewards(s0, ['a', 'a', 'b'], d('2026-06-03'));

    expect(s1.points).toBe(EXECUTION_CAMPAIGN_REWARD * 2);
    expect(s1.campaignCount).toBe(2);
    expect(new Set(s1.rewardedCampaignIds)).toEqual(new Set(['a', 'b']));
  });

  it('对账只补差额：已奖励 a，新增 b 只补 1 笔', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordCampaignCreated(s0, 'a', d('2026-06-03'));
    const s2 = reconcileCampaignRewards(s1, ['a', 'b'], d('2026-06-03'));

    expect(s2.points).toBe(EXECUTION_CAMPAIGN_REWARD * 2);
    expect(s2.campaignCount).toBe(2);
  });

  it('迁移安全：旧状态已计分但没记 ID，对账不重复加分；之后新增照常补', () => {
    // 模拟旧版：3 场已通过事件计过分，但没记 rewardedCampaignIds
    const legacy = {
      ...createDefaultExecutionAssetState(d('2026-06-03')),
      points: EXECUTION_CAMPAIGN_REWARD * 3,
      campaignCount: 3,
    } as ReturnType<typeof createDefaultExecutionAssetState>;
    delete (legacy as { rewardedCampaignIds?: string[] }).rewardedCampaignIds;

    const s1 = reconcileCampaignRewards(legacy, ['a', 'b', 'c'], d('2026-06-03'));
    expect(s1.points).toBe(EXECUTION_CAMPAIGN_REWARD * 3); // 不重复
    expect(s1.campaignCount).toBe(3);

    const s2 = reconcileCampaignRewards(s1, ['a', 'b', 'c', 'd'], d('2026-06-03'));
    expect(s2.points).toBe(EXECUTION_CAMPAIGN_REWARD * 4);
    expect(s2.campaignCount).toBe(4);
  });
});
