import { describe, expect, it } from 'vitest';
import {
  buildCampaignPostReviewsTxt,
  campaignPostReviewsTxtFileName,
  reviewedCampaignLegs,
} from '@/lib/campaignReviewTxtExport';
import {
  buildCloseReviewReflectionText,
  emptyCloseReviewAuditAnswers,
} from '@/lib/reflectionFacts';
import type { TradeCampaign, TradeJournal } from '@/types/journal';

const campaign = {
  id: 'campaign-1',
  campaign_code: 'C-REVIEW001',
  symbol: 'BTCUSDT',
  title: 'BTCUSDT 复盘战役',
  opened_at: '2026-07-20T02:00:00.000Z',
  status: 'closed_profit',
} as TradeCampaign;

function makeLeg(overrides: Partial<TradeJournal>): TradeJournal {
  return {
    id: 'leg-1',
    symbol: 'BTCUSDT',
    direction: 'long',
    leg_role: 'main_open',
    post_reviewed_at: '2026-07-21T03:04:05.000Z',
    ...overrides,
  } as TradeJournal;
}

describe('campaignReviewTxtExport', () => {
  it('只导出已完成平仓评价的仓位，并逐题输出问题和答案', () => {
    const reviewed = makeLeg({
      post_outcome: 'win',
      post_realized_pnl: 123.45,
      post_decision_quality: 'good',
      post_entry_payoff_estimate_grade: 'rr_2_5',
      post_entry_payoff_basis_review: '初始支撑位清晰，目标空间充足。',
    });
    const skipped = makeLeg({
      id: 'leg-2',
      post_reviewed_at: null,
      post_outcome: 'loss',
      post_realized_pnl: -999,
    });

    expect(reviewedCampaignLegs([reviewed, skipped])).toEqual([reviewed]);

    const output = buildCampaignPostReviewsTxt(campaign, [reviewed, skipped]);
    expect(output).toContain('平仓评价数量：1');
    expect(output).toContain('问题：这笔交易的结果是什么？\n答案：赢');
    expect(output).toContain('问题：这笔交易的已实现盈亏是多少？\n答案：123.45');
    expect(output).toContain('问题：这笔交易的决策质量如何？\n答案：正当过程（结构对）');
    expect(output).toContain('问题：建仓时盈亏比估计属于哪一档？\n答案：2:1-5:1');
    expect(output).not.toContain('-999');
  });

  it('兼容历史 post_reflection 中保存的谢林兜底区与自审问题', () => {
    const audit = emptyCloseReviewAuditAnswers();
    audit.schelling_floor_weight = '全程按最高权重执行。';
    audit.decision_basis = '依据成交量和结构事实，没有为恐惧找借口。';
    audit.cycle_stage = '识别为主升阶段。';
    audit.trend_stop = '按预案止盈，没有乱动。';
    const postReflection = buildCloseReviewReflectionText('旧记录补充说明。', audit);

    const output = buildCampaignPostReviewsTxt(campaign, [
      makeLeg({
        post_reflection: postReflection,
        post_positive_expectancy_review: '[盈亏比目标复盘] 对\n目标空间如预期打开。',
      }),
    ]);

    expect(output).toContain('问题：全程有无给谢林兜底区该有的权重？\n答案：全程按最高权重执行。');
    expect(output).toContain('问题：这笔交易中，我是否准确辨认了市场当前的“周期阶段”');
    expect(output).toContain('答案：识别为主升阶段。');
    expect(output).toContain('问题：平仓复盘还有哪些补充？\n答案：旧记录补充说明。');
    expect(output).toContain('问题：建仓时的盈亏比目标在实际走势中表现如何？\n答案：对');
    expect(output).toContain('问题：盈亏比目标表现的事实依据是什么？\n答案：目标空间如预期打开。');
    expect(output).not.toContain('[盈亏比目标复盘]');
  });

  it('每个问题答案块之间保留一个空行，并区分同一战役的多个评价仓位', () => {
    const output = buildCampaignPostReviewsTxt(campaign, [
      makeLeg({
        id: 'leg-main',
        post_outcome: 'win',
        post_result_summary: '结构与结果一致。',
      }),
      makeLeg({
        id: 'leg-hedge',
        leg_role: 'hedge_initial_a',
        direction: 'short',
        post_outcome: 'loss',
        post_reviewed_at: '2026-07-21T04:05:06.000Z',
      }),
    ]);

    expect(output).toContain('===== 平仓评价 1 / 2 =====');
    expect(output).toContain('===== 平仓评价 2 / 2 =====');
    expect(output).toContain('仓位：主力开仓 · BTCUSDT · 多');
    expect(output).toContain('仓位：初始对冲 A · BTCUSDT · 空');
    expect(output).toMatch(/答案：赢\n\n问题：/);

    const questionBlocks = output.split('\n\n').filter(block => block.startsWith('问题：'));
    expect(questionBlocks.length).toBeGreaterThan(1);
    for (const block of questionBlocks) {
      expect(block).toMatch(/^问题：.+\n答案：.+$/s);
    }
  });

  it('文件名沿用战役名称和唯一编号', () => {
    expect(campaignPostReviewsTxtFileName(campaign))
      .toBe('BTCUSDT 2026-07-20 profit 编号 C-REVIEW001 平仓评价.txt');
  });

  it('没有已评价仓位时拒绝生成空文件', () => {
    expect(() => buildCampaignPostReviewsTxt(campaign, [
      makeLeg({ post_reviewed_at: null }),
    ])).toThrow('当前战役没有可导出的平仓评价');
  });
});
