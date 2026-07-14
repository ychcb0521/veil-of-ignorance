import { describe, expect, it } from 'vitest';

import {
  createDefaultExecutionAssetState,
  EXECUTION_CAMPAIGN_MISSING_PENALTY,
  EXECUTION_CAMPAIGN_REWARD,
  EXECUTION_DECISION_REWARD,
  EXECUTION_DIRECT_PENALTY,
  EXECUTION_NO_TRADE_PENALTY,
  EXECUTION_REVIEW_REWARD,
  EXECUTION_SCORING_VERSION,
  localDateKey,
  migrateExecutionAssetScoringV2,
  recordCampaignCreated,
  recordPostTradeReviewCompleted,
  recordPracticeLogged,
  reconcileCampaignRewards,
  reconcilePostTradeReviewRewards,
  recordExecutionTrade,
  settleCampaignMissingPenalties,
  settleNoTradePenalties,
} from '../executionAssets';

/** 造一笔带 symbol 的成交快照，仅填计分逻辑读取的字段。 */
const trade = (symbol: string) => ({
  symbol,
  side: 'LONG',
  orderType: 'MARKET',
  entryPrice: 100,
  quantity: 1,
  leverage: 1,
  marginMode: 'isolated',
});

const d = (iso: string) => new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);

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

  it('直接交易按标的扣分（负权重，同额反号于决策）', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordExecutionTrade(s0, 'direct', d('2026-06-03'), trade('BTCUSDT'));

    expect(s1.points).toBe(-EXECUTION_DIRECT_PENALTY);
    expect(s1.decisionTradeCount).toBe(0);
    expect(s1.directTradeCount).toBe(1);
    expect(s1.tradedDates['2026-06-03']).toBe(true);
    expect(s1.tradedSymbolsByDate['2026-06-03']).toEqual(['BTCUSDT']);
    expect(s1.events[0]).toMatchObject({ type: 'direct_reward', points: -EXECUTION_DIRECT_PENALTY, label: '直接交易扣分' });
  });

  it('直接交易同一标的当天只扣一次；不同标的各扣一次', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordExecutionTrade(s0, 'direct', d('2026-06-03'), trade('BTCUSDT'));
    const s2 = recordExecutionTrade(s1, 'direct', d('2026-06-03'), trade('BTCUSDT'));
    // 同标的第二笔：只算练习，不重复扣分、不新增事件、不增计数。
    expect(s2.points).toBe(-EXECUTION_DIRECT_PENALTY);
    expect(s2.directTradeCount).toBe(1);
    expect(s2.events.filter(e => e.type === 'direct_reward')).toHaveLength(1);

    const s3 = recordExecutionTrade(s2, 'direct', d('2026-06-03'), trade('ETHUSDT'));
    expect(s3.points).toBe(-EXECUTION_DIRECT_PENALTY * 2);
    expect(s3.directTradeCount).toBe(2);
    expect(s3.tradedSymbolsByDate['2026-06-03']).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('决策交易不按标的去重：同标的多笔各得满分', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordExecutionTrade(s0, 'decision', d('2026-06-03'), trade('BTCUSDT'));
    const s2 = recordExecutionTrade(s1, 'decision', d('2026-06-03'), trade('BTCUSDT'));
    expect(s2.points).toBe(EXECUTION_DECISION_REWARD * 2);
    expect(s2.decisionTradeCount).toBe(2);
    // 标的登记仍去重（供缺战役结算用）。
    expect(s2.tradedSymbolsByDate['2026-06-03']).toEqual(['BTCUSDT']);
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

describe('平仓评价 +666（按 journal ID 幂等 + 历史对账）', () => {
  it('首次完成评价 +666、计数 +1，并记录 journal ID', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordPostTradeReviewCompleted(s0, 'journal-1', d('2026-06-04'));

    expect(s1.points).toBe(EXECUTION_REVIEW_REWARD);
    expect(s1.reviewCount).toBe(1);
    expect(s1.rewardedReviewJournalIds).toEqual(['journal-1']);
    expect(s1.events[0]).toMatchObject({
      type: 'review_reward',
      points: EXECUTION_REVIEW_REWARD,
      journalId: 'journal-1',
      date: '2026-06-04',
    });
  });

  it('同一评价后续编辑不重复奖励', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordPostTradeReviewCompleted(s0, 'journal-1', d('2026-06-04'));
    const s2 = recordPostTradeReviewCompleted(s1, 'journal-1', d('2026-06-05'));

    expect(s2.points).toBe(EXECUTION_REVIEW_REWARD);
    expect(s2.reviewCount).toBe(1);
    expect(s2.events).toHaveLength(1);
  });

  it('对账会按原评价时间补齐历史评价，并保持流水从新到旧', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-10'));
    const s1 = reconcilePostTradeReviewRewards(s0, [
      { journalId: 'journal-a', reviewedAt: '2026-06-02T01:00:00.000Z' },
      { journalId: 'journal-b', reviewedAt: '2026-06-04T01:00:00.000Z' },
      { journalId: 'journal-a', reviewedAt: '2026-06-02T01:00:00.000Z' },
    ], d('2026-06-10'));

    expect(s1.points).toBe(EXECUTION_REVIEW_REWARD * 2);
    expect(s1.reviewCount).toBe(2);
    expect(new Set(s1.rewardedReviewJournalIds)).toEqual(new Set(['journal-a', 'journal-b']));
    expect(s1.events.map(event => event.journalId)).toEqual(['journal-b', 'journal-a']);

    const s2 = reconcilePostTradeReviewRewards(s1, [
      { journalId: 'journal-a', reviewedAt: '2026-06-02T01:00:00.000Z' },
      { journalId: 'journal-b', reviewedAt: '2026-06-04T01:00:00.000Z' },
    ], d('2026-06-11'));
    expect(s2.points).toBe(EXECUTION_REVIEW_REWARD * 2);
    expect(s2.events).toHaveLength(2);
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

  it('给旧版无 ID 的奖励流水按真实创建时间回填对应战役，且不重复计分', () => {
    const firstTime = d('2026-06-03T09:10:00+08:00');
    const secondTime = d('2026-06-04T11:20:00+08:00');
    const legacy = {
      ...createDefaultExecutionAssetState(d('2026-06-05')),
      points: EXECUTION_CAMPAIGN_REWARD * 2,
      campaignCount: 2,
      rewardedCampaignIds: ['campaign-b', 'campaign-a'],
      events: [
        {
          id: 'legacy-b',
          type: 'campaign_reward',
          points: EXECUTION_CAMPAIGN_REWARD,
          date: localDateKey(secondTime),
          createdAt: secondTime.getTime(),
          label: '创建交易战役奖励',
        },
        {
          id: 'legacy-a',
          type: 'campaign_reward',
          points: EXECUTION_CAMPAIGN_REWARD,
          date: localDateKey(firstTime),
          createdAt: firstTime.getTime(),
          label: '创建交易战役奖励',
        },
      ],
    } as ReturnType<typeof createDefaultExecutionAssetState>;

    const reconciled = reconcileCampaignRewards(legacy, [
      { id: 'campaign-b', createdAt: d('2026-06-04T11:20:02+08:00') },
      { id: 'campaign-new', createdAt: d('2026-06-05T12:00:00+08:00') },
      { id: 'campaign-a', createdAt: d('2026-06-03T09:10:01+08:00') },
    ], d('2026-06-05T13:00:00+08:00'));

    expect(reconciled.points).toBe(EXECUTION_CAMPAIGN_REWARD * 3);
    expect(reconciled.campaignCount).toBe(3);
    expect(Object.fromEntries(reconciled.events.map(event => [event.id, event.campaignId]))).toMatchObject({
      'legacy-a': 'campaign-a',
      'legacy-b': 'campaign-b',
    });
    const newEvent = reconciled.events.find(event => event.campaignId === 'campaign-new');
    expect(newEvent).toMatchObject({
      type: 'campaign_reward',
      date: '2026-06-05',
      createdAt: d('2026-06-05T12:00:00+08:00').getTime(),
    });

    const rerun = reconcileCampaignRewards(reconciled, [
      { id: 'campaign-a', createdAt: firstTime },
      { id: 'campaign-b', createdAt: secondTime },
      { id: 'campaign-new', createdAt: d('2026-06-05T12:00:00+08:00') },
    ], d('2026-06-06'));
    expect(rerun.points).toBe(reconciled.points);
    expect(rerun.events).toHaveLength(reconciled.events.length);
  });
});

describe('缺战役结算 −300（当天必须新建，按标的累计，永久）', () => {
  // 06-03 直接交易 BTC + ETH（当天不建战役），今天 06-04 结算。
  const twoSymbolsTraded = () => {
    let s = recordExecutionTrade(createDefaultExecutionAssetState(d('2026-06-03')), 'direct', d('2026-06-03'), trade('BTCUSDT'));
    s = recordExecutionTrade(s, 'direct', d('2026-06-03'), trade('ETHUSDT'));
    return s;
  };

  it('两个交易过的标的都没当天建战役 → 各扣 300（按标的累计）', () => {
    const s = twoSymbolsTraded();
    const settled = settleCampaignMissingPenalties(s, [], d('2026-06-04'));
    expect(settled.campaignMissingCount).toBe(2);
    expect(settled.points).toBe(s.points - EXECUTION_CAMPAIGN_MISSING_PENALTY * 2);
    expect(settled.events.filter(e => e.type === 'campaign_missing_penalty')).toHaveLength(2);
  });

  it('当天为某标的建了战役则该标的免罚', () => {
    const s = twoSymbolsTraded();
    const settled = settleCampaignMissingPenalties(s, [{ symbol: 'BTCUSDT', createdAt: d('2026-06-03') }], d('2026-06-04'));
    expect(settled.campaignMissingCount).toBe(1); // 只有 ETH 缺
  });

  it('战役建在别的日子不算「当天新建」→ 仍罚', () => {
    const s = twoSymbolsTraded();
    const settled = settleCampaignMissingPenalties(s, [{ symbol: 'BTCUSDT', createdAt: d('2026-06-04') }], d('2026-06-05'));
    expect(settled.campaignMissingCount).toBe(2); // BTC 的战役建在 06-04，非交易日 06-03
  });

  it('永久幂等：再次结算不重复扣、已过去的日子不回访', () => {
    const s = twoSymbolsTraded();
    const once = settleCampaignMissingPenalties(s, [], d('2026-06-04'));
    const twice = settleCampaignMissingPenalties(once, [], d('2026-06-05'));
    expect(twice.campaignMissingCount).toBe(2);
    expect(twice.points).toBe(once.points);
  });

  it('没有交易标的的日子（含历史迁移日）不误罚', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03')); // tradedSymbolsByDate 为空
    const settled = settleCampaignMissingPenalties(s0, [], d('2026-06-06'));
    expect(settled.campaignMissingCount).toBe(0);
    expect(settled.points).toBe(0);
  });
});

describe('Option A：弃单 / 复盘算当天练习，清「未交易 −1000」', () => {
  it('recordPracticeLogged 标记当天已练习 → 次日结算不扣未交易', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordPracticeLogged(s0, d('2026-06-03'));
    expect(s1.tradedDates['2026-06-03']).toBe(true);
    const settled = settleNoTradePenalties(s1, d('2026-06-04'));
    expect(settled.penaltyDays).toBe(0);
    expect(settled.points).toBe(0);
  });

  it('完成复盘给评价当天打练习标记 → 不扣未交易（Option A）', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-03'));
    const s1 = recordPostTradeReviewCompleted(s0, 'j1', d('2026-06-03'));
    expect(s1.tradedDates['2026-06-03']).toBe(true);
    const settled = settleNoTradePenalties(s1, d('2026-06-04'));
    expect(settled.penaltyDays).toBe(0);
    expect(settled.points).toBe(EXECUTION_REVIEW_REWARD);
  });

  it('对账补发复盘绝不打练习标记（守永久不回填）', () => {
    const s0 = createDefaultExecutionAssetState(d('2026-06-10'));
    const s1 = reconcilePostTradeReviewRewards(s0, [
      { journalId: 'old', reviewedAt: d('2026-06-02') },
    ], d('2026-06-10'));
    expect(s1.tradedDates['2026-06-02']).toBeUndefined();
  });
});

describe('历史重算迁移 v1→v2（按新权重重算已有事件，缺战役不追溯）', () => {
  // 旧权重下记录的历史事件（新在前）：决策999 / 直接99×2(同标的同日) / 未交易-500 / 建战役1500 / 复盘666
  const legacyState = () => ({
    ...createDefaultExecutionAssetState(d('2026-06-10')),
    scoringVersion: undefined,
    points: 999 + 99 + 99 - 500 + 1500 + 666,
    directTradeCount: 2,
    events: [
      { id: 'e6', type: 'review_reward', points: 666, date: '2026-06-05', createdAt: 6, label: '完成平仓评价奖励', journalId: 'j1' },
      { id: 'e5', type: 'campaign_reward', points: 1500, date: '2026-06-04', createdAt: 5, label: '创建交易战役奖励', campaignId: 'c1' },
      { id: 'e4', type: 'no_trade_penalty', points: -500, date: '2026-06-03', createdAt: 4, label: 'x' },
      { id: 'e3', type: 'direct_reward', points: 99, date: '2026-06-02', createdAt: 3, label: '直接交易奖励', trade: trade('BTCUSDT') },
      { id: 'e2', type: 'direct_reward', points: 99, date: '2026-06-02', createdAt: 2, label: '直接交易奖励', trade: trade('BTCUSDT') },
      { id: 'e1', type: 'decision_reward', points: 999, date: '2026-06-01', createdAt: 1, label: '决策记录交易奖励', trade: trade('ETHUSDT') },
    ],
  }) as unknown as ReturnType<typeof createDefaultExecutionAssetState>;

  it('按新权重重算并重求和；直接交易按当日标的去重', () => {
    const m = migrateExecutionAssetScoringV2(legacyState());
    // 决策+600, 直接BTC(两笔→一笔)-600, 未练习-1000, 建战役+300, 复盘+1000
    expect(m.points).toBe(600 - 600 - 1000 + 300 + 1000);
    expect(m.directTradeCount).toBe(1);
    expect(m.scoringVersion).toBe(EXECUTION_SCORING_VERSION);
    const byId = Object.fromEntries(m.events.map(e => [e.id, e.points]));
    expect(byId.e1).toBe(600);   // decision
    expect(byId.e4).toBe(-1000); // no_trade
    expect(byId.e5).toBe(300);   // campaign
    expect(byId.e6).toBe(1000);  // review
    // 两笔同标的同日直接交易：最早一笔留 -600，重复的被并笔丢弃（流水每条=一次计分动作）
    expect(byId.e2).toBe(-600);
    expect(byId.e3).toBeUndefined();
    expect(m.events).toHaveLength(5);
  });

  it('幂等：已迁移(v2)状态再迁移不变', () => {
    const once = migrateExecutionAssetScoringV2(legacyState());
    const twice = migrateExecutionAssetScoringV2(once);
    expect(twice.points).toBe(once.points);
    expect(twice.events.map(e => e.points)).toEqual(once.events.map(e => e.points));
  });

  it('全新状态(默认已是 v2)：迁移为空操作', () => {
    const fresh = createDefaultExecutionAssetState(d('2026-06-10'));
    const m = migrateExecutionAssetScoringV2(fresh);
    expect(m.points).toBe(0);
    expect(m.scoringVersion).toBe(EXECUTION_SCORING_VERSION);
  });
});
