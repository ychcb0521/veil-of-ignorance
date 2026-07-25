import { describe, expect, it } from 'vitest';
import {
  buildCampaignOpeningSnapshotsTxt,
  campaignOpeningSnapshotsTxtFileName,
  openingSnapshotCampaignLegs,
} from '@/lib/campaignSnapshotTxtExport';
import { buildHedgeBoundaryBasis } from '@/lib/hedgeBoundaryBasis';
import type { TradeCampaign, TradeJournal } from '@/types/journal';

const campaign = {
  id: 'campaign-1',
  campaign_code: 'C-SNAPSHOT001',
  symbol: 'BTCUSDT',
  title: 'BTCUSDT 快照战役',
  opened_at: '2026-07-20T02:00:00.000Z',
  status: 'closed_profit',
} as TradeCampaign;

function makeLeg(overrides: Partial<TradeJournal> = {}): TradeJournal {
  return {
    id: 'leg-1',
    user_id: 'user-1',
    trade_record_id: null,
    campaign_id: 'campaign-1',
    leg_role: 'main_open',
    leg_sequence: 1,
    source: 'live',
    symbol: 'BTCUSDT',
    direction: 'long',
    leverage: 5,
    position_mode: 'cross',
    order_kind: 'main',
    pre_simulated_time: '2026-07-20T02:00:00.000Z',
    pre_real_time: '2026-07-21T03:04:05.000Z',
    pre_entry_price: 100,
    pre_mental_state: 4,
    pre_checklist_items: [],
    pre_checklist_passed: true,
    pre_position_size: 1000,
    pre_max_loss_usdt: 50,
    pre_pain_tags: [],
    pre_cognitive_bias_tags: [],
    reason_was_rewritten: false,
    created_at: '2026-07-21T03:04:05.000Z',
    updated_at: '2026-07-21T03:04:05.000Z',
    ...overrides,
  } as TradeJournal;
}

function makeRetroactiveLeg(overrides: Partial<TradeJournal> = {}): TradeJournal {
  return makeLeg({
    source: 'retroactive_from_record',
    pre_mental_state: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: null,
    pre_max_loss_usdt: null,
    pre_pain_tags: null,
    pre_cognitive_bias_tags: null,
    ...overrides,
  });
}

describe('campaignSnapshotTxtExport', () => {
  it('主力快照逐题导出全部当前问题，空答案写为未填写并计算机会质量', () => {
    const output = buildCampaignOpeningSnapshotsTxt(campaign, [
      makeLeg({
        pre_market_regime: 'trending',
        pre_entry_stage: 'early',
        pre_edge_source: 'trend_follow',
        pre_cheap_opportunity: 'cheap',
        pre_opportunity_cost_worth: true,
        pre_odds_structure: 'r3_open',
        pre_opportunity_quality_payoff_ratio: 6,
        pre_opportunity_quality_drawdown_pct: 2,
        pre_checklist_items: [
          { id: 'check-1', label: '结构确认', checked: true, required: true },
        ],
      }),
    ]);

    expect(output).toContain('开仓快照数量：1');
    expect(output).toContain('问题：当前是什么市场？\n答案：单边趋势');
    expect(output).toContain('问题：不做更亏吗？是在浪费机会吗？\n答案：是 · 不做更亏');
    expect(output).toContain('问题：机会质量判断结果 Q 是多少？\n答案：3.00');
    expect(output).toContain('问题：这笔为什么会对？\n答案：未填写');
    expect(output).toContain('问题：开仓清单的逐项检查结果是什么？\n答案：[已勾选][必填] 结构确认');
    expect(output).toMatch(/答案：做多\n\n问题：/);
  });

  it('对冲快照还原结构化边界三问，并排除主力专属题目', () => {
    const output = buildCampaignOpeningSnapshotsTxt(campaign, [
      makeLeg({
        id: 'hedge-1',
        leg_role: 'hedge_initial_a',
        direction: 'short',
        order_kind: 'hedge',
        hedge_type: 'filter',
        hedge_boundary_price: 98,
        hedge_boundary_basis: buildHedgeBoundaryBasis({
          whyRight: '区间下沿有效。',
          failureReason: '趋势突然转强。',
          invalidationSignal: '放量站回边界。',
        }),
        hedge_boundary_stance: 'at_crossover',
        hedge_resolution_up: '拆掉对冲。',
      }),
    ]);

    expect(output).toContain('问题：这是哪一类对冲？\n答案：滤波对冲');
    expect(output).toContain('问题：正 · 边界为什么会对？\n答案：区间下沿有效。');
    expect(output).toContain('问题：反 · 如果错，最可能错在哪？\n答案：趋势突然转强。');
    expect(output).toContain('问题：止 · 什么信号出现就意味着不再对了？\n答案：放量站回边界。');
    expect(output).not.toContain('问题：这一单靠什么赚钱？');
    expect(output).not.toContain('问题：开仓清单的逐项检查结果是什么？');
  });

  it('历史回填记录只有实质快照字段时才纳入导出', () => {
    const emptyRetroactive = makeRetroactiveLeg({
      id: 'legacy-empty',
    });
    const savedRetroactive = makeRetroactiveLeg({
      id: 'legacy-snapshot',
      pre_thesis_why_right: '趋势已经确认。',
    });

    expect(openingSnapshotCampaignLegs([emptyRetroactive, savedRetroactive]))
      .toEqual([savedRetroactive]);
  });

  it('文件名沿用战役名称和唯一编号', () => {
    expect(campaignOpeningSnapshotsTxtFileName(campaign))
      .toBe('BTCUSDT 2026-07-20 profit 编号 C-SNAPSHOT001 开仓快照.txt');
  });

  it('没有开仓快照时拒绝生成空文件', () => {
    expect(() => buildCampaignOpeningSnapshotsTxt(campaign, [
      makeRetroactiveLeg(),
    ])).toThrow('当前战役没有可导出的开仓快照');
  });
});
