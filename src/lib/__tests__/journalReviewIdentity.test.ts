import { describe, expect, it } from 'vitest';

import {
  coalesceJournalRecords,
  hasCompletedJournalReview,
  hydrateJournalReviews,
} from '@/lib/journalReviewIdentity';
import type { TradeJournal } from '@/types/journal';

function journal(
  id: string,
  overrides: Partial<TradeJournal> = {},
): TradeJournal {
  return {
    id,
    user_id: 'user-1',
    trade_record_id: null,
    campaign_id: null,
    symbol: 'HIFIUSDT',
    direction: 'long',
    order_kind: 'main',
    journal_kind: 'trade',
    pre_simulated_time: '2025-09-12T10:00:00.000Z',
    pre_real_time: '2026-07-12T10:00:00.000Z',
    post_outcome: null,
    post_realized_pnl: null,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    created_at: '2026-07-12T10:00:00.000Z',
    updated_at: '2026-07-12T10:00:00.000Z',
    ...overrides,
  } as TradeJournal;
}

describe('historical journal review identity', () => {
  it('recognizes legacy reviews with saved answers even when the completion timestamp is missing', () => {
    expect(hasCompletedJournalReview(journal('legacy-review', {
      post_reviewed_at: null,
      post_reflection: '历史评价里已经保存的完整答案',
    }))).toBe(true);
  });

  it('recognizes a saved first-question percentage, including an explicit 0%', () => {
    expect(hasCompletedJournalReview(journal('percentage-only-review', {
      post_reviewed_at: null,
      post_every_ball_pct: 0,
    }))).toBe(true);
  });

  it('does not treat automatically backfilled close facts as a completed review', () => {
    expect(hasCompletedJournalReview(journal('close-facts-only', {
      post_outcome: 'win',
      post_realized_pnl: 123.45,
      post_r_multiple: 1.2,
      post_real_close_time: '2026-07-15T08:00:00.000Z',
      post_simulated_close_time: '2025-09-12T08:00:00.000Z',
    }))).toBe(false);
  });

  it('projects the latest completed review onto an older campaign leg with the same trade record', () => {
    const campaignLeg = journal('campaign-leg', {
      trade_record_id: 'trade-7',
      campaign_id: 'campaign-3',
    });
    const reviewedBackfill = journal('review-backfill', {
      trade_record_id: 'trade-7',
      post_reviewed_at: '2026-07-15T08:00:00.000Z',
      post_outcome: 'win',
      post_decision_quality: 'good',
      post_emo_disturbance: '一开始担心回吐，但遵守了结构信号',
      post_entry_payoff_basis_review: '目标空间来自上方真空区',
      updated_at: '2026-07-15T08:00:00.000Z',
    });

    const [hydratedLeg] = hydrateJournalReviews([campaignLeg, reviewedBackfill]);

    expect(hydratedLeg.id).toBe('campaign-leg');
    expect(hydratedLeg.campaign_id).toBe('campaign-3');
    expect(hydratedLeg.post_reviewed_at).toBe('2026-07-15T08:00:00.000Z');
    expect(hydratedLeg.post_decision_quality).toBe('good');
    expect(hydratedLeg.post_emo_disturbance).toBe('一开始担心回吐，但遵守了结构信号');
    expect(hydratedLeg.post_entry_payoff_basis_review).toBe('目标空间来自上方真空区');
  });

  it('uses the newest completed review when a historical trade was edited more than once', () => {
    const leg = journal('leg', { trade_record_id: 'trade-9' });
    const oldReview = journal('old-review', {
      trade_record_id: 'trade-9',
      post_reviewed_at: '2026-07-14T08:00:00.000Z',
      post_reflection: '旧答案',
    });
    const editedReview = journal('edited-review', {
      trade_record_id: 'trade-9',
      post_reviewed_at: '2026-07-16T08:00:00.000Z',
      post_reflection: '修改后的完整答案',
    });

    const hydrated = hydrateJournalReviews([leg, oldReview, editedReview]);
    expect(hydrated[0].post_reflection).toBe('修改后的完整答案');
  });

  it('projects a legacy answer-only review onto its campaign leg', () => {
    const campaignLeg = journal('campaign-leg', {
      trade_record_id: 'trade-legacy',
      campaign_id: 'campaign-legacy',
    });
    const legacyReview = journal('legacy-review', {
      trade_record_id: 'trade-legacy',
      post_reviewed_at: null,
      post_entry_payoff_basis_review: '旧版数据库保存了答案，但漏了评价完成时间',
      updated_at: '2026-07-15T08:00:00.000Z',
    });

    const [hydratedLeg] = hydrateJournalReviews([campaignLeg, legacyReview]);

    expect(hydratedLeg.post_reviewed_at).toBeNull();
    expect(hydratedLeg.post_entry_payoff_basis_review)
      .toBe('旧版数据库保存了答案，但漏了评价完成时间');
    expect(hasCompletedJournalReview(hydratedLeg)).toBe(true);
  });

  it('counts duplicate database rows for one trade record only once in the error catalog', () => {
    const campaignLeg = journal('campaign-leg', {
      trade_record_id: 'trade-11',
      campaign_id: 'campaign-11',
      pre_entry_price: 0.105,
    });
    const reviewedBackfill = journal('review-backfill', {
      trade_record_id: 'trade-11',
      post_reviewed_at: '2026-07-15T08:00:00.000Z',
      post_decision_quality: 'bad',
      post_reflection: '不该在量能衰竭时继续追价',
    });
    const anotherTrade = journal('another-trade', {
      trade_record_id: 'trade-12',
      symbol: 'BTCUSDT',
    });

    const coalesced = coalesceJournalRecords([
      campaignLeg,
      reviewedBackfill,
      anotherTrade,
    ]);

    expect(coalesced).toHaveLength(2);
    const hifi = coalesced.find(item => item.trade_record_id === 'trade-11');
    expect(hifi?.post_reviewed_at).toBe('2026-07-15T08:00:00.000Z');
    expect(hifi?.post_decision_quality).toBe('bad');
    expect(hifi?.campaign_id).toBe('campaign-11');
    expect(hifi?.pre_entry_price).toBe(0.105);
  });

  it('never merges reviews from different trade records even when symbol and entry time match', () => {
    const reviewed = journal('reviewed', {
      trade_record_id: 'trade-a',
      post_reviewed_at: '2026-07-15T08:00:00.000Z',
      post_reflection: '只属于 A',
    });
    const unrelated = journal('unrelated', {
      trade_record_id: 'trade-b',
    });

    const hydrated = hydrateJournalReviews([reviewed, unrelated]);
    expect(hydrated[1].post_reviewed_at).toBeNull();
    expect(hydrated[1].post_reflection).toBeNull();
  });
});
