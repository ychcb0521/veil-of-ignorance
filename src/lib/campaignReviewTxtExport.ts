import { campaignKlineTitleName } from '@/lib/campaignLegsPngExport';
import { formatCampaignDisplayCode } from '@/lib/campaignCode';
import { HEDGE_WORTH_IT_LABELS } from '@/lib/hedgeTypes';
import { hasCompletedJournalReview } from '@/lib/journalReviewIdentity';
import { OUTCOME_LABEL } from '@/lib/journalSummary';
import { MAIN_STONE_META } from '@/lib/mainStoneTags';
import {
  ODDS_STRUCTURE_REVIEW_LABELS,
  parseOddsStructureReviewText,
} from '@/lib/oddsStructure';
import { computeOpportunityQuality, formatOpportunityQuality } from '@/lib/opportunityQuality';
import {
  CLOSE_REVIEW_AUDIT_QUESTIONS,
  CLOSE_REVIEW_SCHELLING_FLOOR_QUESTION,
  parseCloseReviewReflectionText,
} from '@/lib/reflectionFacts';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import {
  MISSED_HIGH_ODDS_LABELS,
  SITUATION_HANDLING_ALL_LABELS,
  STRUGGLE_LEVEL_LABELS,
} from '@/lib/structureResult';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { TradeCampaign, TradeJournal } from '@/types/journal';

type QuestionAnswer = {
  question: string;
  answer: string;
};

const DECISION_QUALITY_LABELS: Record<string, string> = {
  good: '正当过程（结构对）',
  mixed: '混合 / 未明确',
  bad: '错误过程（结构错）',
};

const FALSIFICATION_STATUS_LABELS: Record<string, string> = {
  triggered_reacted: '触发了，我及时反应了',
  triggered_late: '触发了，但我反应晚了',
  not_triggered: '没触发，我是主观平仓',
};

const ENTRY_PAYOFF_ESTIMATE_LABELS: Record<string, string> = {
  rr_1_2: '1:1-2:1',
  rr_2_5: '2:1-5:1',
  rr_gt_5: '>5:1',
};

const ENTRY_WIN_RATE_ESTIMATE_LABELS: Record<string, string> = {
  wr_lt_50: '<50%',
  wr_50_80: '50-80%',
  wr_gt_80: '>80%',
};

const PATH_MODE_LABELS: Record<string, string> = {
  roll_position: '滚仓',
  mirror_take_profit_1r: '1:1 镜像止盈',
};

const TRADE_AGENCY_LABELS: Record<string, string> = {
  '1': '1 · 完全被动',
  '2': '2 · 勉强可控',
  '3': '3 · 主动可控',
  '4': '4 · 完全主动',
};

const INTERVENTION_TYPE_LABELS: Record<string, string> = {
  principle: '原则',
  rule: '规则',
  checklist: 'Checklist',
  environment: '环境',
  system: '系统',
};

const FIVE_STEP_WEAK_POINT_LABELS: Record<string, string> = {
  goal: '目标',
  problem: '问题',
  diagnosis: '诊断',
  design: '设计',
  execution: '执行',
};

function isAnswered(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(item => text(item)).filter(Boolean).join('、');
  return value == null ? '' : String(value);
}

function mapped(value: unknown, labels: Record<string, string>): string {
  if (!isAnswered(value)) return '';
  const raw = text(value);
  return labels[raw] ?? raw;
}

function addCurrent(
  target: QuestionAnswer[],
  question: string,
  value: unknown,
  labels?: Record<string, string>,
) {
  const answer = labels ? mapped(value, labels) : text(value);
  target.push({ question, answer: answer || '未填写' });
}

function addHistorical(
  target: QuestionAnswer[],
  question: string,
  value: unknown,
  labels?: Record<string, string>,
) {
  if (!isAnswered(value)) return;
  const answer = labels ? mapped(value, labels) : text(value);
  if (answer) target.push({ question, answer });
}

function buildLegQuestionAnswers(leg: TradeJournal): QuestionAnswer[] {
  const answers: QuestionAnswer[] = [];
  const reflection = parseCloseReviewReflectionText(leg.post_reflection);
  const oddsReview = parseOddsStructureReviewText(leg.post_positive_expectancy_review);
  const isHedge = leg.order_kind === 'hedge';
  const isNoEntry = leg.direction === 'no_entry';
  const quadrantApplicable = leg.post_outcome === 'win' || leg.post_outcome === 'loss';
  const hasFalsificationPlan = isAnswered(leg.pre_falsification_signal)
    || isAnswered(leg.pre_invalidation_condition)
    || isAnswered(leg.exit_falsification_status)
    || isAnswered(leg.exit_falsification_note);
  const showMissedHighOddsState = !isHedge
    && !isNoEntry
    && (
      leg.pre_odds_structure === 'r2_supported'
      || leg.pre_odds_structure === 'r3_open'
      || leg.pre_odds_structure === 'against_crowd_unreleased'
      || (leg.pre_opportunity_cost_worth === true && leg.pre_cheap_opportunity === 'cheap')
    );
  const opportunityQuality = computeOpportunityQuality({
    payoffRatio: leg.post_opportunity_quality_payoff_ratio,
    drawdownPct: leg.post_opportunity_quality_drawdown_pct,
  });

  addCurrent(answers, '这笔交易的结果是什么？', leg.post_outcome, OUTCOME_LABEL);
  addCurrent(answers, '这笔交易的已实现盈亏是多少？', leg.post_realized_pnl);
  addCurrent(answers, '这笔交易最终实现了多少 R？', leg.post_r_multiple);
  if (quadrantApplicable) {
    addCurrent(answers, '结果复盘总结是什么？', leg.post_result_summary);
    addCurrent(answers, '这笔交易的决策质量如何？', leg.post_decision_quality, DECISION_QUALITY_LABELS);
  }
  if (isHedge) {
    addCurrent(answers, '这个对冲值回成本了吗？', leg.hedge_worth_it, HEDGE_WORTH_IT_LABELS);
  }

  addCurrent(
    answers,
    CLOSE_REVIEW_SCHELLING_FLOOR_QUESTION.question,
    reflection.answers.schelling_floor_weight,
  );
  addCurrent(answers, '预设的亏损原因兑现没有？', leg.post_premortem_review);
  if (hasFalsificationPlan) {
    addCurrent(
      answers,
      '事前设定的证伪信号是否触发，我是否及时反应？',
      leg.exit_falsification_status,
      FALSIFICATION_STATUS_LABELS,
    );
    addCurrent(answers, '证伪状态的补充说明是什么？', leg.exit_falsification_note);
  }
  addCurrent(answers, '真实的离场 / 证伪事实是什么？', leg.post_invalidation_review);
  if (!isHedge) {
    if (leg.pre_odds_structure || oddsReview.review) {
      addCurrent(
        answers,
        '建仓时的盈亏比目标在实际走势中表现如何？',
        oddsReview.review,
        ODDS_STRUCTURE_REVIEW_LABELS,
      );
    }
    addCurrent(answers, '盈亏比目标表现的事实依据是什么？', oddsReview.body);
  } else {
    addCurrent(answers, '这份对冲保险有没有值回摩擦成本？', oddsReview.body || leg.post_positive_expectancy_review);
  }

  if (!isHedge && !isNoEntry) {
    addCurrent(
      answers,
      '建仓时盈亏比估计属于哪一档？',
      leg.post_entry_payoff_estimate_grade,
      ENTRY_PAYOFF_ESTIMATE_LABELS,
    );
    addCurrent(answers, '建仓时盈亏比估计的复盘说明是什么？', leg.post_entry_payoff_basis_review);
    addCurrent(
      answers,
      '建仓时胜率估计属于哪一档？',
      leg.post_entry_win_rate_estimate_grade,
      ENTRY_WIN_RATE_ESTIMATE_LABELS,
    );
    addCurrent(answers, '建仓时胜率估计的复盘说明是什么？', leg.post_entry_win_rate_basis_review);
    addCurrent(answers, '机会质量评估中的预期盈亏比 b 是多少？', leg.post_opportunity_quality_payoff_ratio);
    addCurrent(answers, '机会质量评估中的预期回撤 d% 是多少？', leg.post_opportunity_quality_drawdown_pct);
    addCurrent(
      answers,
      '机会质量评估结果 Q 是多少？',
      opportunityQuality == null ? null : formatOpportunityQuality(opportunityQuality),
    );

    addCurrent(answers, '这笔交易选择了哪一种路径？', leg.post_path_mode, PATH_MODE_LABELS);
    addCurrent(answers, '这笔交易的主动权评分是多少？', leg.post_trade_agency_score, TRADE_AGENCY_LABELS);
    addCurrent(
      answers,
      '这笔交易过程中的纠结度 / 轻松度如何？',
      leg.post_struggle_level,
      STRUGGLE_LEVEL_LABELS as unknown as Record<string, string>,
    );
  }
  addCurrent(
    answers,
    '这一手属于什么情境，处理是否得当？',
    leg.post_small_position_drag,
    SITUATION_HANDLING_ALL_LABELS,
  );
  if (showMissedHighOddsState) {
    addCurrent(
      answers,
      '是否踏空高盈亏比结构，或者该重没重？',
      leg.post_missed_high_odds_state,
      MISSED_HIGH_ODDS_LABELS,
    );
  }
  if (isAnswered(leg.pre_opponent_statement)) {
    addCurrent(answers, '反对者的判断后来被证明是对的吗？', leg.post_opponent_was_right);
  }

  if (!isNoEntry) {
    for (const question of CLOSE_REVIEW_AUDIT_QUESTIONS) {
      addCurrent(answers, question.question, reflection.answers[question.key]);
    }
  }

  addCurrent(answers, '情绪七问 ① 这单最起波澜的事情是什么？', leg.post_emo_disturbance);
  addCurrent(answers, '情绪七问 ② 我的第一反应是什么？', leg.post_emo_first_reaction);
  addCurrent(answers, '情绪七问 ③ 我其实想得到什么？', leg.post_emo_wanted);
  addCurrent(answers, '情绪七问 ④ 我其实在害怕什么？', leg.post_emo_feared);
  addCurrent(answers, '情绪七问 ⑤ 我给自己找了什么理由？', leg.post_emo_excuse);
  addCurrent(answers, '情绪七问 ⑥ 这单捞起的主石头是什么？', leg.post_emo_main_stone);
  const mainStoneLabels = leg.post_emo_main_stone_tags?.map(tag => (
      MAIN_STONE_META[tag as keyof typeof MAIN_STONE_META]?.label ?? tag
  )) ?? [];
  addCurrent(answers, '情绪七问 ⑥ 主石头标签有哪些？', mainStoneLabels);
  addCurrent(answers, '情绪七问 ⑦ 明天再遇到同样的事情，我准备怎么选？', leg.post_emo_next_time_plan);

  // 以下是历史版本曾出现过、但当前表单已不再固定展示的扩展题。
  // 只在旧记录确实有答案时追加，既保留历史信息，也避免给新评价凭空增加空题。
  addHistorical(answers, '平仓复盘还有哪些补充？', reflection.legacyText);
  addHistorical(answers, '下一次最应该坚持或修正的动作是什么？', leg.post_correct_action);
  addHistorical(answers, '五步诊断：我的目标是什么？', leg.post_five_step_goal);
  addHistorical(answers, '五步诊断：阻碍目标实现的问题是什么？', leg.post_five_step_problem);
  addHistorical(answers, '五步诊断：近因是什么？', leg.post_proximate_cause);
  addHistorical(answers, '五步诊断：根因是什么？', leg.post_root_cause);
  addHistorical(answers, '五步诊断：修正方案是什么？', leg.post_design_intervention);
  addHistorical(answers, '五步诊断：修正方案属于哪一类？', leg.post_intervention_type, INTERVENTION_TYPE_LABELS);
  addHistorical(answers, '五步诊断：如何监督执行？', leg.post_execution_monitor);
  addHistorical(answers, '五步诊断：最薄弱的环节是什么？', leg.post_five_step_weak_point, FIVE_STEP_WEAK_POINT_LABELS);
  addHistorical(answers, '错误场景是什么？', leg.post_error_scenario);
  addHistorical(answers, '原始假设是什么？', leg.post_original_hypothesis);
  addHistorical(answers, '现实反馈是什么？', leg.post_reality_feedback);
  addHistorical(answers, '错误类型总结是什么？', leg.post_error_type_summary);
  addHistorical(answers, '真正的问题是什么？', leg.post_real_problem);
  addHistorical(answers, '修正后的规则是什么？', leg.post_new_rule_draft);

  return answers;
}

export function reviewedCampaignLegs(legs: TradeJournal[]): TradeJournal[] {
  return legs.filter(hasCompletedJournalReview);
}

function directionLabel(direction: TradeJournal['direction']): string {
  if (direction === 'long') return '多';
  if (direction === 'short') return '空';
  return direction ?? '—';
}

function renderQuestionAnswer({ question, answer }: QuestionAnswer): string {
  return `问题：${question}\n答案：${answer}`;
}

export function buildCampaignPostReviewsTxt(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  accountName?: string | null,
): string {
  const reviewed = reviewedCampaignLegs(legs);
  if (reviewed.length === 0) {
    throw new Error('当前战役没有可导出的平仓评价');
  }

  const header = [
    `交易战役：${campaign.title || campaignKlineTitleName(campaign)}`,
    `战役编号：${formatCampaignDisplayCode(campaign.campaign_code, accountName, campaign.id)}`,
    `标的：${campaign.symbol}`,
    `平仓评价数量：${reviewed.length}`,
  ].join('\n');

  const sections = reviewed.map((leg, index) => {
    const role = leg.leg_role ? LEG_ROLE_LABELS[leg.leg_role] ?? leg.leg_role : '未归类仓位';
    const metadata = [
      `===== 平仓评价 ${index + 1} / ${reviewed.length} =====`,
      `仓位：${role} · ${leg.symbol} · ${directionLabel(leg.direction)}`,
      `评价时间：${leg.post_reviewed_at
        ? formatBeijingTime(leg.post_reviewed_at)
        : '历史评价（原记录未保存评价时间）'}`,
    ].join('\n');
    const questionAnswers = buildLegQuestionAnswers(leg);
    const body = questionAnswers.map(renderQuestionAnswer).join('\n\n');
    return body ? `${metadata}\n\n${body}` : metadata;
  });

  return `${header}\n\n${sections.join('\n\n\n')}\n`;
}

function safeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function campaignPostReviewsTxtFileName(
  campaign: TradeCampaign,
  accountName?: string | null,
): string {
  const code = formatCampaignDisplayCode(campaign.campaign_code, accountName, campaign.id);
  const base = code
    ? `${campaignKlineTitleName(campaign)} 编号 ${code}`
    : campaignKlineTitleName(campaign);
  return `${safeFileName(base)} 平仓评价.txt`;
}

export function exportCampaignPostReviewsTxt(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  accountName?: string | null,
): string {
  const content = buildCampaignPostReviewsTxt(campaign, legs, accountName);
  const fileName = campaignPostReviewsTxtFileName(campaign, accountName);
  const blob = new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}
