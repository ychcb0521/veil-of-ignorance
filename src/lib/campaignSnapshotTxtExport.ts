import { COGNITIVE_BIAS_LABELS } from '@/lib/cognitiveBiasTags';
import { campaignKlineTitleName } from '@/lib/campaignLegsPngExport';
import { formatCampaignDisplayCode } from '@/lib/campaignCode';
import { EDGE_SOURCE_LABELS } from '@/lib/edgeSource';
import { parseHedgeBoundaryBasis } from '@/lib/hedgeBoundaryBasis';
import {
  HEDGE_BOUNDARY_STANCE_LABELS,
  HEDGE_ORDER_METHOD_LABELS,
  HEDGE_TYPE_LABELS,
} from '@/lib/hedgeTypes';
import { ODDS_STRUCTURE_LABELS } from '@/lib/oddsStructure';
import { computeOpportunityQuality, formatOpportunityQuality } from '@/lib/opportunityQuality';
import {
  ENTRY_STAGE_LABELS,
  MARKET_REGIME_LABELS,
  STOP_QUALITY_LABELS,
} from '@/lib/snapshotStructure';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import { formatBeijingTime } from '@/lib/timeFormat';
import {
  MENTAL_STATE_LABELS,
  PAIN_TAG_LABELS,
  type ChecklistItem,
  type TradeCampaign,
  type TradeJournal,
} from '@/types/journal';

type QuestionAnswer = {
  question: string;
  answer: string;
};

const POSITION_MODE_LABELS: Record<string, string> = {
  cross: '全仓',
  isolated: '逐仓',
};

const SETTLEMENT_MODE_LABELS: Record<string, string> = {
  usdt: 'U 本位',
  coin: '币本位',
};

const CHEAP_OPPORTUNITY_LABELS: Record<string, string> = {
  cheap: '是 · 成本低',
  not_cheap: '否 · 代价高',
  unclear: '说不清',
};

const DATASET_SPLIT_LABELS: Record<string, string> = {
  in_sample: '样本内',
  out_of_sample: '样本外',
};

const SNAPSHOT_SIGNAL_FIELDS = [
  'pre_planned_stop_loss',
  'pre_opportunity_quality_payoff_ratio',
  'pre_opportunity_quality_drawdown_pct',
  'pre_planned_take_profit',
  'pre_entry_reason',
  'pre_mental_trigger',
  'pre_risk_awareness',
  'pre_risk_management',
  'pre_checklist_items',
  'pre_max_loss_usdt',
  'pre_thesis_why_right',
  'pre_premortem_failure_reason',
  'pre_falsification_signal',
  'pre_confidence_basis',
  'pre_odds_structure',
  'pre_odds_structure_source',
  'pre_odds_structure_premortem',
  'pre_odds_structure_breakdown_signals',
  'pre_account_equity_usdt',
  'pre_opportunity_cost_worth',
  'pre_cheap_opportunity',
  'pre_edge_source',
  'pre_market_regime',
  'pre_entry_stage',
  'pre_stop_quality',
  'pre_chase_after_close',
  'pre_mortem_text',
  'pre_positive_expectancy',
  'pre_invalidation_condition',
  'pre_calibration_win_pct',
  'pre_confidence_interval_low_pct',
  'pre_confidence_interval_high_pct',
  'pre_calibration_reference_class',
  'pre_calibration_competence_basis',
  'pre_calibration_update_signal',
  'pre_dataset_split',
  'pre_lollapalooza_score',
  'pre_bankruptcy_estimate',
  'pre_info_kline_facts',
  'pre_info_macro_facts',
  'pre_info_rule_advice',
  'pre_info_intuition',
  'pre_info_designer_view',
  'pre_opponent_statement',
  'pre_triggered_principle_ids',
  'pre_triggered_rule_ids',
  'pre_pain_tags',
  'pre_cognitive_bias_tags',
  'pre_executor_self',
  'pre_designer_self',
  'pre_stop_doing_acknowledged_ids',
  'pre_stop_doing_ad_hoc',
  'hedge_type',
  'hedge_boundary_price',
  'hedge_boundary_basis',
  'hedge_boundary_stance',
  'hedge_lock_profit_pct',
  'hedge_resolution_up',
  'hedge_resolution_down',
  'hedge_down_if_chop',
  'hedge_down_if_trend',
  'hedge_down_if_rebound',
  'hedge_necessity_pct',
  'hedge_safety_strength',
  'hedge_safety_regularity',
  'hedge_risk_magnitude',
  'hedge_conviction_pct',
  'hedge_friction_cost',
  'hedge_order_method',
] as const satisfies readonly (keyof TradeJournal)[];

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

function formatChecklist(items: ChecklistItem[] | null | undefined): string {
  if (!items?.length) return '';
  return items.map(item => (
    `[${item.checked ? '已勾选' : '未勾选'}][${item.required ? '必填' : '可选'}] ${item.label}`
  )).join('；');
}

function formatMentalState(value: TradeJournal['pre_mental_state']): string {
  if (!value) return '';
  return `${value} · ${MENTAL_STATE_LABELS[value] ?? ''}`.trim();
}

function formatTags(
  values: readonly string[] | null | undefined,
  labels: Record<string, string>,
): string {
  if (!values?.length) return '';
  return values.map(value => labels[value] ?? value).join('、');
}

function directionLabel(direction: TradeJournal['direction']): string {
  if (direction === 'long') return '多';
  if (direction === 'short') return '空';
  return '未开仓';
}

function buildLegQuestionAnswers(leg: TradeJournal): QuestionAnswer[] {
  const answers: QuestionAnswer[] = [];
  const isHedge = leg.order_kind === 'hedge';
  const isNoEntry = leg.direction === 'no_entry';
  const opportunityQuality = computeOpportunityQuality({
    payoffRatio: leg.pre_opportunity_quality_payoff_ratio,
    drawdownPct: leg.pre_opportunity_quality_drawdown_pct,
  });

  addCurrent(answers, '交易方向是什么？', leg.direction, {
    long: '做多',
    short: '做空',
    no_entry: '未开仓',
  });
  addCurrent(answers, '杠杆倍数是多少？', leg.leverage);
  addCurrent(answers, '仓位模式是什么？', leg.position_mode, POSITION_MODE_LABELS);
  addCurrent(answers, '快照时的 K 线（模拟）时间是什么？', leg.pre_simulated_time);
  addCurrent(answers, '快照的真实操作时间是什么？', leg.pre_real_time);
  addCurrent(answers, '快照时的入场价格是多少？', leg.pre_entry_price);
  addCurrent(answers, '开仓时心态自评是多少？', formatMentalState(leg.pre_mental_state));

  if (isHedge) {
    const boundaryBasis = parseHedgeBoundaryBasis(leg.hedge_boundary_basis);
    addCurrent(answers, '这是哪一类对冲？', leg.hedge_type, HEDGE_TYPE_LABELS);
    addCurrent(answers, '边界价是多少？', leg.hedge_boundary_price);
    addCurrent(answers, '正 · 边界为什么会对？', boundaryBasis.whyRight);
    addCurrent(answers, '反 · 如果错，最可能错在哪？', boundaryBasis.failureReason);
    addCurrent(answers, '止 · 什么信号出现就意味着不再对了？', boundaryBasis.invalidationSignal);
    addCurrent(
      answers,
      '相对“机会=风险”的交叉点，这条线放在哪？',
      leg.hedge_boundary_stance,
      HEDGE_BOUNDARY_STANCE_LABELS,
    );
    if (leg.hedge_type === 'trailing') {
      addCurrent(answers, '锁定的最低微利 % 是多少？', leg.hedge_lock_profit_pct);
    }
    addCurrent(answers, '向上预案是什么？', leg.hedge_resolution_up);
    addCurrent(answers, '若触发后转为震荡，怎么处理？', leg.hedge_down_if_chop);
    addCurrent(answers, '若触发后确认下行，怎么处理？', leg.hedge_down_if_trend);
    addCurrent(answers, '若触发后快速反弹，怎么处理？', leg.hedge_down_if_rebound);
    addCurrent(answers, '行情强劲程度是多少？', leg.hedge_safety_strength);
    addCurrent(answers, '历史规则程度是多少？', leg.hedge_safety_regularity);
    addCurrent(answers, '下行烈度 / 跳空风险是多少？', leg.hedge_risk_magnitude);
    addCurrent(answers, '对冲必要性 / 占主仓比例是多少？', leg.hedge_necessity_pct);
    addCurrent(answers, '我多确定这个风险估计是对的？', leg.hedge_conviction_pct);
    addCurrent(answers, '下单方式是什么？', leg.hedge_order_method, HEDGE_ORDER_METHOD_LABELS);
  } else if (!isNoEntry) {
    addCurrent(answers, '当前是什么市场？', leg.pre_market_regime, MARKET_REGIME_LABELS);
    addCurrent(answers, '你在哪个阶段入场？', leg.pre_entry_stage, ENTRY_STAGE_LABELS);
    addCurrent(answers, '这一单靠什么赚钱？', leg.pre_edge_source, EDGE_SOURCE_LABELS);
    addCurrent(answers, '这是一个便宜的机会吗？', leg.pre_cheap_opportunity, CHEAP_OPPORTUNITY_LABELS);
    addCurrent(
      answers,
      '不做更亏吗？是在浪费机会吗？',
      leg.pre_opportunity_cost_worth,
      { 是: '是 · 不做更亏', 否: '否 · 不做也不亏' },
    );
    addCurrent(answers, '盈亏比目标是什么？', leg.pre_odds_structure, ODDS_STRUCTURE_LABELS);
    addCurrent(answers, '预期最大回撤价格是多少？', leg.pre_planned_stop_loss);
    addCurrent(
      answers,
      '机会质量判断中的预期盈亏比 b 是多少？',
      leg.pre_opportunity_quality_payoff_ratio,
    );
    addCurrent(
      answers,
      '机会质量判断中的预期最大回撤 d% 是多少？',
      leg.pre_opportunity_quality_drawdown_pct,
    );
    addCurrent(
      answers,
      '机会质量判断结果 Q 是多少？',
      opportunityQuality == null ? null : formatOpportunityQuality(opportunityQuality),
    );
    addCurrent(answers, '止损质量如何？', leg.pre_stop_quality, STOP_QUALITY_LABELS);
    addCurrent(answers, '盈亏比目标的事实依据是什么？', leg.pre_odds_structure_source);
    addCurrent(answers, '这个盈亏比目标最可能错在哪里？', leg.pre_odds_structure_premortem);
    addCurrent(answers, '什么信号出现说明盈亏比目标已失效？', leg.pre_odds_structure_breakdown_signals);
    addCurrent(answers, '这笔为什么会对？', leg.pre_thesis_why_right);
    addCurrent(answers, '假设这笔亏完，最可能的原因是？', leg.pre_premortem_failure_reason);
    addCurrent(answers, '什么信号一旦触发，你就提前止损 / 拆仓？', leg.pre_falsification_signal);
    addCurrent(answers, '开仓预测胜率是多少？', leg.pre_calibration_win_pct);
    addCurrent(answers, '我为什么有资格给这个置信度？', leg.pre_confidence_basis);
  }

  if (!isNoEntry) {
    addCurrent(answers, '结算模式是什么？', leg.pre_settlement_mode, SETTLEMENT_MODE_LABELS);
    addCurrent(answers, '结算资产是什么？', leg.pre_settlement_asset);
    if (leg.pre_settlement_mode === 'coin') {
      addCurrent(answers, '每张合约面值是多少 USD？', leg.pre_contract_size_usd);
      addCurrent(answers, '合约张数是多少？', leg.pre_contracts);
    }
    addCurrent(answers, '名义仓位是多少？', leg.pre_position_size);
    if (!isHedge) {
      addCurrent(answers, '本次预设最大亏损是多少 USDT？', leg.pre_max_loss_usdt);
      addCurrent(answers, '开仓时账户总资产是多少 USDT？', leg.pre_account_equity_usdt);
      addCurrent(answers, '是否属于刚平就开的连续单？', leg.pre_chase_after_close);
      addCurrent(answers, '开仓清单的逐项检查结果是什么？', formatChecklist(leg.pre_checklist_items));
      addCurrent(answers, '开仓清单是否全部通过？', leg.pre_checklist_passed);
    }
  }

  addCurrent(
    answers,
    '开仓时有哪些情绪标签？',
    formatTags(leg.pre_pain_tags, PAIN_TAG_LABELS as unknown as Record<string, string>),
  );
  addCurrent(
    answers,
    '开仓时识别到哪些认知偏差？',
    formatTags(leg.pre_cognitive_bias_tags, COGNITIVE_BIAS_LABELS),
  );
  addCurrent(
    answers,
    '本次确认遵守了哪些 Stop Doing 条目？',
    leg.pre_stop_doing_acknowledged_ids,
  );
  addCurrent(answers, '这次特别要防的一条是什么？', leg.pre_stop_doing_ad_hoc);

  // 历史版本曾出现、当前快照已不再固定展示的题目，只在旧记录确有答案时追加。
  addHistorical(answers, '计划止盈价格是多少？', leg.pre_planned_take_profit);
  addHistorical(answers, '入场理由是什么？', leg.pre_entry_reason);
  addHistorical(answers, '心态触发说明是什么？', leg.pre_mental_trigger);
  addHistorical(answers, '风险认知是什么？', leg.pre_risk_awareness);
  addHistorical(answers, '风险管理方案是什么？', leg.pre_risk_management);
  addHistorical(answers, '事前预演的失败原因是什么？', leg.pre_mortem_text);
  addHistorical(answers, '正期望依据是什么？', leg.pre_positive_expectancy);
  addHistorical(answers, '失效条件是什么？', leg.pre_invalidation_condition);
  addHistorical(answers, '置信区间下限是多少？', leg.pre_confidence_interval_low_pct);
  addHistorical(answers, '置信区间上限是多少？', leg.pre_confidence_interval_high_pct);
  addHistorical(answers, '置信度参考类是什么？', leg.pre_calibration_reference_class);
  addHistorical(answers, '置信度能力依据是什么？', leg.pre_calibration_competence_basis);
  addHistorical(answers, '什么信号会更新置信度？', leg.pre_calibration_update_signal);
  addHistorical(answers, '这笔判断属于样本内还是样本外？', leg.pre_dataset_split, DATASET_SPLIT_LABELS);
  addHistorical(answers, '多因素共振评分是多少？', leg.pre_lollapalooza_score);
  addHistorical(answers, '破产概率估计是多少？', leg.pre_bankruptcy_estimate);
  addHistorical(answers, 'K 线客观事实是什么？', leg.pre_info_kline_facts);
  addHistorical(answers, '宏观客观事实是什么？', leg.pre_info_macro_facts);
  addHistorical(answers, '规则给出的建议是什么？', leg.pre_info_rule_advice);
  addHistorical(answers, '直觉提供了什么信息？', leg.pre_info_intuition);
  addHistorical(answers, '设计者视角是什么？', leg.pre_info_designer_view);
  addHistorical(answers, '反对者会怎么说？', leg.pre_opponent_statement);
  addHistorical(answers, '触发了哪些原则？', leg.pre_triggered_principle_ids);
  addHistorical(answers, '触发了哪些规则？', leg.pre_triggered_rule_ids);
  addHistorical(answers, '执行者自我怎么想？', leg.pre_executor_self);
  addHistorical(answers, '设计者自我怎么想？', leg.pre_designer_self);
  addHistorical(answers, '旧版向下预案是什么？', leg.hedge_resolution_down);
  addHistorical(answers, '可接受的对冲摩擦成本是什么？', leg.hedge_friction_cost);

  return answers;
}

export function hasOpeningSnapshot(leg: TradeJournal): boolean {
  if (leg.source !== 'retroactive_from_record') return true;
  return SNAPSHOT_SIGNAL_FIELDS.some(field => isAnswered(leg[field]));
}

export function openingSnapshotCampaignLegs(legs: TradeJournal[]): TradeJournal[] {
  return legs.filter(hasOpeningSnapshot);
}

function renderQuestionAnswer({ question, answer }: QuestionAnswer): string {
  return `问题：${question}\n答案：${answer}`;
}

export function buildCampaignOpeningSnapshotsTxt(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  accountName?: string | null,
): string {
  const snapshots = openingSnapshotCampaignLegs(legs);
  if (snapshots.length === 0) {
    throw new Error('当前战役没有可导出的开仓快照');
  }

  const header = [
    `交易战役：${campaign.title || campaignKlineTitleName(campaign)}`,
    `战役编号：${formatCampaignDisplayCode(campaign.campaign_code, accountName, campaign.id)}`,
    `标的：${campaign.symbol}`,
    `开仓快照数量：${snapshots.length}`,
  ].join('\n');

  const sections = snapshots.map((leg, index) => {
    const role = leg.leg_role ? LEG_ROLE_LABELS[leg.leg_role] ?? leg.leg_role : '未归类仓位';
    const metadata = [
      `===== 开仓快照 ${index + 1} / ${snapshots.length} =====`,
      `仓位：${role} · ${leg.symbol} · ${directionLabel(leg.direction)}`,
      `快照时间：${formatBeijingTime(leg.pre_real_time || leg.created_at)}`,
    ].join('\n');
    const body = buildLegQuestionAnswers(leg).map(renderQuestionAnswer).join('\n\n');
    return `${metadata}\n\n${body}`;
  });

  return `${header}\n\n${sections.join('\n\n\n')}\n`;
}

function safeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function campaignOpeningSnapshotsTxtFileName(
  campaign: TradeCampaign,
  accountName?: string | null,
): string {
  const code = formatCampaignDisplayCode(campaign.campaign_code, accountName, campaign.id);
  const base = code
    ? `${campaignKlineTitleName(campaign)} 编号 ${code}`
    : campaignKlineTitleName(campaign);
  return `${safeFileName(base)} 开仓快照.txt`;
}

export function exportCampaignOpeningSnapshotsTxt(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  accountName?: string | null,
): string {
  const content = buildCampaignOpeningSnapshotsTxt(campaign, legs, accountName);
  const fileName = campaignOpeningSnapshotsTxtFileName(campaign, accountName);
  const blob = new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}
