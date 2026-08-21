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
  // 与两条腿的 post_realized_pnl 之和一致（123.45 + −999）。
  // 落库值是由各腿推导出来的缓存，写一个对不上的数在真实数据里不成立。
  final_realized_pnl: -875.55,
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
      post_every_ball_pct: 86,
      post_outcome: 'win',
      post_realized_pnl: 123.45,
      post_decision_quality: 'good',
      post_entry_decision_quality: 'good',
      post_holding_decision_quality: 'bad',
      post_exit_decision_quality: 'good',
      post_exit_nature: 'take_profit_before_t',
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
    expect(output).toContain('问题：是否做到了珍惜“每一个球”？\n答案：86%');
    expect(output).toContain('问题：这笔交易的结果是什么？\n答案：赢');
    expect(output).toContain('问题：整个战役的总利润是多少？\n答案：-875.55');
    expect(output).not.toContain('问题：这笔交易的已实现盈亏是多少？');
    expect(output).toContain('问题：入场阶段的决策质量如何？\n答案：正当过程（结构对）');
    expect(output).toContain('问题：持仓阶段的决策质量如何？\n答案：错误过程（结构错）');
    expect(output).toContain('问题：离场阶段的决策质量如何？\n答案：正当过程（结构对）');
    expect(output).toContain('问题：这笔交易的离场性质是什么？\n答案：T 前止盈 · 主动退出');
    expect(output).not.toContain('问题：这笔交易的决策质量如何？');
    expect(output).toContain('问题：建仓时盈亏比估计属于哪一档？\n答案：2:1-5:1');
    expect(output).not.toContain('-999');

    const everyBallQuestion = output.indexOf('问题：是否做到了珍惜“每一个球”？');
    const outcomeQuestion = output.indexOf('问题：这笔交易的结果是什么？');
    expect(everyBallQuestion).toBeGreaterThan(-1);
    expect(everyBallQuestion).toBeLessThan(outcomeQuestion);
  });

  it('历史战役缺少汇总盈亏时，使用全部 Legs 的已实现盈亏合计作为战役总利润', () => {
    const historicalCampaign = {
      ...campaign,
      final_realized_pnl: null,
    } as TradeCampaign;
    const output = buildCampaignPostReviewsTxt(historicalCampaign, [
      makeLeg({
        id: 'leg-main',
        post_outcome: 'win',
        post_realized_pnl: 120,
      }),
      makeLeg({
        id: 'leg-hedge',
        post_reviewed_at: null,
        post_realized_pnl: -35,
      }),
    ]);

    expect(output).toContain('问题：整个战役的总利润是多少？\n答案：85');
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

  it('导出有答案但缺少评价时间戳的历史仓位', () => {
    const legacyReview = makeLeg({
      post_reviewed_at: null,
      post_reflection: '这是一条旧版平仓评价答案。',
    });

    expect(reviewedCampaignLegs([legacyReview])).toEqual([legacyReview]);

    const output = buildCampaignPostReviewsTxt(campaign, [legacyReview]);
    expect(output).toContain('平仓评价数量：1');
    expect(output).toContain('评价时间：历史评价（原记录未保存评价时间）');
    expect(output).toContain('问题：平仓复盘还有哪些补充？\n答案：这是一条旧版平仓评价答案。');
  });

  it('只有自动回填的平仓事实时不显示为可导出的评价', () => {
    const closeFactsOnly = makeLeg({
      post_reviewed_at: null,
      post_outcome: 'win',
      post_realized_pnl: 123.45,
      post_r_multiple: 1.2,
      post_real_close_time: '2026-07-21T03:04:05.000Z',
      post_simulated_close_time: '2026-07-20T03:04:05.000Z',
    });

    expect(reviewedCampaignLegs([closeFactsOnly])).toEqual([]);
    expect(() => buildCampaignPostReviewsTxt(campaign, [closeFactsOnly]))
      .toThrow('当前战役没有可导出的平仓评价');
  });

  it('输出当前表单全部适用题目，未作答也明确标记未填写', () => {
    const output = buildCampaignPostReviewsTxt(campaign, [
      makeLeg({
        post_outcome: 'breakeven',
        pre_falsification_signal: null,
        exit_falsification_status: 'triggered_late',
      }),
    ]);

    expect(output).toContain('问题：全程有无给谢林兜底区该有的权重？\n答案：未填写');
    expect(output).toContain('问题：建仓时胜率估计的复盘说明是什么？\n答案：未填写');
    expect(output).toContain('问题：这笔交易的离场性质是什么？\n答案：未填写');
    expect(output).toContain('问题：事前设定的证伪信号是否触发，我是否及时反应？\n答案：触发了，但我反应晚了');
    expect(output).not.toContain('问题：这个对冲值回成本了吗？');
  });

  it('不因当前适用条件变化而遗漏已经保存的历史答案', () => {
    const audit = emptyCloseReviewAuditAnswers();
    audit.decision_basis = '虽然是未入场记录，但这条自审答案已经保存。';

    const output = buildCampaignPostReviewsTxt(campaign, [
      makeLeg({
        direction: 'no_entry',
        order_kind: 'main',
        post_outcome: 'breakeven',
        post_result_summary: '旧记录仍保存了结果总结。',
        post_decision_quality: 'mixed',
        hedge_worth_it: 'partial',
        post_missed_high_odds_state: 'under_sized',
        post_opponent_was_right: false,
        post_entry_payoff_estimate_grade: 'rr_gt_5',
        post_entry_payoff_basis_review: '旧版评估认为目标空间超过五倍。',
        post_reflection: buildCloseReviewReflectionText('', audit),
      }),
    ]);

    expect(output).toContain('问题：结果复盘总结是什么？\n答案：旧记录仍保存了结果总结。');
    expect(output).toContain('问题：入场阶段的决策质量如何？\n答案：混合 / 未明确');
    expect(output).toContain('问题：持仓阶段的决策质量如何？\n答案：混合 / 未明确');
    expect(output).toContain('问题：离场阶段的决策质量如何？\n答案：混合 / 未明确');
    expect(output).toContain('问题：这个对冲值回成本了吗？\n答案：部分');
    expect(output).toContain('问题：是否踏空高盈亏比结构，或者该重没重？\n答案：该重没重');
    expect(output).toContain('问题：反对者的判断后来被证明是对的吗？\n答案：否');
    expect(output).toContain('问题：建仓时盈亏比估计属于哪一档？\n答案：>5:1');
    expect(output).toContain('问题：建仓时盈亏比估计的复盘说明是什么？\n答案：旧版评估认为目标空间超过五倍。');
    expect(output).toContain('答案：虽然是未入场记录，但这条自审答案已经保存。');
  });

  it('完整导出旧版路径复盘中已经保存的全部题目与答案', () => {
    const output = buildCampaignPostReviewsTxt(campaign, [
      makeLeg({
        post_path_first_move: 'immediate_drawdown',
        post_path_drawdown: 'over_stop',
        post_path_win_quality: 'dragged_win',
        post_path_agency_note: '被动等待后才重新拿回主动权。',
      }),
    ]);

    expect(output).toContain('问题：旧版路径复盘：开仓后的第一段走势如何？\n答案：上来先水下');
    expect(output).toContain('问题：旧版路径复盘：持仓途中经历了怎样的浮亏？\n答案：浮亏打到 / 越过止损');
    expect(output).toContain('问题：旧版路径复盘：这笔赢单的质量如何？\n答案：扛出来的赢单');
    expect(output).toContain('问题：旧版路径复盘：主动权补充说明是什么？\n答案：被动等待后才重新拿回主动权。');
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

  it('账户名会同时写入评价正文中的战役编号与下载文件名', () => {
    const output = buildCampaignPostReviewsTxt(
      campaign,
      [makeLeg({ post_outcome: 'win' })],
      '主账户',
    );
    expect(output).toContain('战役编号：C-主账户-REVIEW001');
    expect(campaignPostReviewsTxtFileName(campaign, '主账户'))
      .toBe('BTCUSDT 2026-07-20 profit 编号 C-主账户-REVIEW001 平仓评价.txt');
  });

  it('没有已评价仓位时拒绝生成空文件', () => {
    expect(() => buildCampaignPostReviewsTxt(campaign, [
      makeLeg({ post_reviewed_at: null }),
    ])).toThrow('当前战役没有可导出的平仓评价');
  });
});
