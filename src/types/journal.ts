/**
 * 错题集（Trade Journal）相关类型定义
 * 字段命名与数据库列名保持一致（snake_case），与 supabase/types.ts 风格统一。
 */

export const ERROR_CATEGORY_CODES = [
  "entry_reason",
  "hedge_stop",
  "exit_reason",
  "mental_state",
  "no_entry_missed",
  "checklist_violation",
] as const;

export type ErrorCategoryCode = (typeof ERROR_CATEGORY_CODES)[number];

export const MENTAL_STATE_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "极差",
  2: "较差",
  3: "中性",
  4: "良好",
  5: "极佳",
};

export type TradeDirection = "long" | "short" | "no_entry";
export type TradeOutcome = "win" | "loss" | "breakeven" | "no_entry";
export type TaggedPhase = "pre" | "post";
export type PositionMode = "cross" | "isolated";
export type OrderKind = "main" | "hedge";
export type JournalSource = 'live' | 'retroactive_from_record';
/** Training-set vs holdout-set discipline (anti-overfitting). */
export type DatasetSplit = 'in_sample' | 'out_of_sample';
export type DecisionQuality = 'good' | 'mixed' | 'bad';
export type RuleCategory = 'hard' | 'core' | 'watch' | 'retired';
export type PrincipleEvolutionLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type PainTag =
  // 负向 · 高唤醒
  | 'fomo'
  | 'anxiety'
  | 'greed'
  | 'revenge'
  // 负向 · 低唤醒
  | 'loss_aversion'
  | 'regret'
  | 'fatigue'
  // 正向 · 高唤醒
  | 'focused'
  | 'confident'
  // 正向 · 低唤醒
  | 'calm'
  | 'content'
  // 中性 · 平和度（执行者抽离）
  | 'detached';

export type EmotionValence = 'positive' | 'neutral' | 'negative';
export type EmotionArousal = 'high' | 'low';

export interface EmotionTagMeta {
  label: string;
  valence: EmotionValence;
  arousal: EmotionArousal;
  /** 简短说明，给 UI tooltip / 副标题用 */
  hint: string;
}
export type FiveStepWeakPoint = 'goal' | 'problem' | 'diagnosis' | 'design' | 'execution';
export type InterventionType = 'principle' | 'rule' | 'sop' | 'awareness';

// ============ Batch 24: Munger layer ============
/** 'trade' = normal order (incl. the legacy "该开没开" decision record); 'no_trade' = Munger "too hard" skip. */
export type JournalKind = 'trade' | 'no_trade';
/** Result of checking the entry-time falsification signal against what actually happened before close. */
export type ExitFalsificationStatus = 'triggered_reacted' | 'triggered_late' | 'not_triggered';

export const PRINCIPLE_EVOLUTION_LEVEL_LABELS: Record<PrincipleEvolutionLevel, string> = {
  0: '直觉',
  1: '表述',
  2: '模式确认',
  3: '规则化',
  4: '算法化',
  5: '已证伪/升级',
};

export const EMOTION_TAG_META: Record<PainTag, EmotionTagMeta> = {
  // 负向 · 高唤醒（被情绪推着走）
  fomo: { label: '错失/FOMO 痛', valence: 'negative', arousal: 'high', hint: '怕赶不上别人，急着追入' },
  anxiety: { label: '焦虑痛', valence: 'negative', arousal: 'high', hint: '未发生事就提前心慌' },
  greed: { label: '贪婪痛', valence: 'negative', arousal: 'high', hint: '想再多赚一点，舍不得离场' },
  revenge: { label: '报复痛', valence: 'negative', arousal: 'high', hint: '想用下一单把上一单赢回来' },
  // 负向 · 低唤醒（被情绪压住）
  loss_aversion: { label: '损失厌恶痛', valence: 'negative', arousal: 'low', hint: '害怕兑现亏损，不敢动' },
  regret: { label: '后悔痛', valence: 'negative', arousal: 'low', hint: '盯着已发生的错误反复回放' },
  fatigue: { label: '疲惫/无力', valence: 'negative', arousal: 'low', hint: '注意力涣散，不想再判断' },
  // 正向 · 高唤醒（积极但活跃）
  focused: { label: '心流/专注', valence: 'positive', arousal: 'high', hint: '盘面与判断高度契合' },
  confident: { label: '自信', valence: 'positive', arousal: 'high', hint: '判断有据，敢按计划下注' },
  // 正向 · 低唤醒（积极且平稳）
  calm: { label: '平和', valence: 'positive', arousal: 'low', hint: '情绪平稳，不急不躁' },
  content: { label: '知足', valence: 'positive', arousal: 'low', hint: '对当前进度满意，不勉强' },
  // 中性 · 平和度（执行者抽离）
  detached: { label: '抽离/旁观', valence: 'neutral', arousal: 'low', hint: '设计者视角，把自己当成第三方' },
};

/** 向后兼容旧代码：只保留 label。新 UI 用 EMOTION_TAG_META。 */
export const PAIN_TAG_LABELS: Record<PainTag, string> = Object.fromEntries(
  (Object.entries(EMOTION_TAG_META) as [PainTag, EmotionTagMeta][])
    .map(([tag, meta]) => [tag, meta.label]),
) as Record<PainTag, string>;
export type CampaignStatus =
  | 'planned'
  | 'active'
  | 'closed_profit'
  | 'closed_loss'
  | 'closed_breakeven'
  | 'abandoned';
export type StrategyTemplate = 'main_dual_hedge_mirror_tp' | 'main_only' | 'custom';
export type LegRole =
  | 'main_open'
  | 'hedge_initial_a'
  | 'hedge_initial_b'
  | 'hedge_rolling'
  | 'mirror_tp'
  | 'reentry_main'
  | 'reentry_hedge'
  | 'standalone';

export type SuggestionConfidence = 'high' | 'medium' | 'low';

export interface CampaignEvent {
  id: string;
  timestamp: string;
  event_type:
    | 'campaign_opened'
    | 'historical_classification_created'
    | 'historical_leg_attached'
    | 'main_opened'
    | 'hedge_placed'
    | 'mirror_tp_placed'
    | 'hedge_cancelled'
    | 'hedge_triggered'
    | 'mirror_tp_triggered'
    | 'main_partial_closed'
    | 'main_fully_closed'
    | 'campaign_closed'
    | 'note';
  leg_role: LegRole | null;
  journal_id: string | null;
  trade_record_id: string | null;
  pending_order_id: string | null;
  price: number | null;
  size_usdt: number | null;
  notes: string | null;
  recorded_at: string;
}

export interface TradeCampaign {
  id: string;
  user_id: string;
  symbol: string;
  direction: 'main_long' | 'main_short';
  status: CampaignStatus;
  strategy_template: StrategyTemplate;
  title: string;
  opened_at: string;
  closed_at: string | null;
  initial_main_size_usdt: number | null;
  initial_leverage: number | null;
  final_realized_pnl: number | null;
  final_r_multiple: number | null;
  peak_unrealized_pnl: number | null;
  peak_drawdown: number | null;
  notes: string | null;
  actual_evolution: CampaignEvent[];
  created_at: string;
  updated_at: string;
}

export function isHistoricalCampaign(campaign: Pick<TradeCampaign, 'actual_evolution'>): boolean {
  return (campaign.actual_evolution ?? []).some(event =>
    event.event_type === 'historical_classification_created' ||
    event.event_type === 'historical_leg_attached',
  );
}

export type CampaignCounterfactualBranchKind =
  | 'pure_sop'
  | 'fix_one_deviation'
  | 'custom_what_if';

export interface CampaignCounterfactualParams {
  entry: {
    time: string;
    price: number;
    size_usdt: number;
    direction: 'long' | 'short';
    leverage: number;
  };
  hedge_a: {
    offset_pct: number;
    size_pct: number;
  };
  hedge_b: {
    offset_pct: number;
    size_pct: number;
  };
  mirror_tp: {
    offset_pct: number;
    size_pct: number;
  };
  rolling: {
    enabled: boolean;
    trigger_rise_pct: number;
    min_interval_minutes: number;
    new_hedge_offset_pct: number;
    rolling_hedge_size_pct: number;
  };
  exit_rule: 'close_all_on_hedge_trigger' | 'reenter_after_hedge_trigger' | 'manual_only';
  reentry?: {
    delay_minutes: number;
    size_pct: number;
  };
}

export interface CampaignCounterfactualEvent {
  timestamp: string;
  event_type: string;
  leg_role: string;
  price: number;
  size_usdt: number;
  notes: string;
}

export interface CampaignCounterfactualLegSummary {
  leg_role: string;
  placed_at: string;
  trigger_price: number;
  status: 'filled' | 'cancelled' | 'never_triggered';
  triggered_at: string | null;
  realized_pnl_usdt: number;
}

export interface CampaignCounterfactualStateSegment {
  state: string;
  state_label: string;
  start_time: string;
  end_time: string;
}

export interface CampaignCounterfactualResult {
  final_realized_pnl: number;
  final_r_multiple: number;
  peak_unrealized_pnl: number;
  peak_drawdown: number;
  profit_capture_ratio: number;
  events: CampaignCounterfactualEvent[];
  legs_summary: CampaignCounterfactualLegSummary[];
  state_segments: CampaignCounterfactualStateSegment[];
  sop_score: number;
}

export interface CampaignCounterfactual {
  id: string;
  user_id: string;
  campaign_id: string;
  label: string;
  branch_kind: CampaignCounterfactualBranchKind;
  source_deduction_id: string | null;
  params: CampaignCounterfactualParams;
  result: CampaignCounterfactualResult;
  created_at: string;
}

export interface DeviationCost {
  deduction_category: 'setup' | 'lockin' | 'rolling' | 'exit';
  deduction_reason: string;
  cost_usdt: number;
  cost_pct_of_account: number;
  fix_description: string;
  source_deduction_id?: string;
}

export interface SuggestedLegRole {
  journalId: string;
  suggestedRole: LegRole;
  confidence: SuggestionConfidence;
  reason: string;
}

export interface ClassificationAssignmentInput {
  journalId: string;
  legRole: LegRole;
  legSequence?: number | null;
  attachNote?: string | null;
}

export interface ClassificationValidationInput {
  legs: Array<{ journalId: string; legRole: LegRole }>;
  strategyTemplate: StrategyTemplate;
  targetCampaignId?: string;
}

export interface ClassificationValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ErrorTagCategory {
  id: string;
  code: ErrorCategoryCode;
  name_zh: string;
  description: string;
  color: string;
  sort_order: number;
  is_special: boolean;
  created_at: string;
}

export interface ErrorTagPattern {
  id: string;
  user_id: string;
  category_id: string;
  pattern_name: string;
  operational_definition: string;
  parent_id: string | null;
  occurrence_count: number;
  last_seen_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  required?: boolean;
}

export interface TradePrinciple {
  id: string;
  user_id: string;
  title: string;
  body: string;
  evolution_level: PrincipleEvolutionLevel;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PainLogEntry {
  id: string;
  user_id: string;
  journal_id: string | null;
  symbol: string | null;
  pain_tag: PainTag;
  intensity: 1 | 2 | 3 | 4 | 5;
  recorded_at: string;
  market_time: string | null;
  created_at: string;
}

export interface TradeJournal {
  id: string;
  user_id: string;
  trade_record_id: string | null;
  campaign_id: string | null;
  leg_role: LegRole | null;
  leg_sequence: number | null;
  source: JournalSource;
  symbol: string;
  direction: TradeDirection;
  leverage: number | null;
  position_mode: PositionMode | null;
  order_kind: OrderKind;

  // pre-snapshot
  pre_simulated_time: string;
  pre_real_time: string;
  pre_entry_price: number | null;
  /** @deprecated v2 snapshot no longer records stop-loss in this field. */
  pre_planned_stop_loss: number | null;
  /** @deprecated v2 snapshot does not collect TP levels; order-level TP/SL stays outside the snapshot. */
  pre_planned_take_profit: number | null;
  /** @deprecated v2 snapshot uses pre_thesis_why_right; legacy journals may still display this. */
  pre_entry_reason: string | null;
  pre_mental_state: 1 | 2 | 3 | 4 | 5;
  /** @deprecated v2 snapshot blocks mental <=2 and does not collect a separate trigger note. */
  pre_mental_trigger: string | null;
  /** @deprecated v2 snapshot folds risk framing into the decision-three-questions block. */
  pre_risk_awareness: string | null;
  /** @deprecated v2 snapshot folds risk framing into the decision-three-questions block. */
  pre_risk_management: string | null;
  pre_checklist_items: ChecklistItem[] | null;
  pre_checklist_passed: boolean | null;
  /** @deprecated v2 snapshot infers this from pendingOrderParams instead of user input. */
  pre_position_size: number | null;
  pre_max_loss_usdt: number | null;

  // ============ Snapshot v2 fields (batch 23) ============
  /** Decision-three-questions A: why this has positive expectancy. */
  pre_thesis_why_right?: string | null;
  /** Decision-three-questions B: pre-mortem failure reason. */
  pre_premortem_failure_reason?: string | null;
  /** Decision-three-questions C: objective falsification / exit signal. */
  pre_falsification_signal?: string | null;
  /** Optional basis for the binary probability slider. */
  pre_confidence_basis?: string | null;
  /** Account equity snapshot used to reconstruct the risk-anchor percentage. */
  pre_account_equity_usdt?: number | null;

  // ============ Batch 24: Munger layer ============
  /** 'trade' (default, incl. legacy no_entry decision record) or 'no_trade' (too-hard skip). */
  journal_kind?: JournalKind;
  /** Free-text reason a setup was judged "too hard" (no_trade only). */
  no_trade_reason?: string | null;
  /** Market price at the moment the user pressed "too hard", for hypothetical PnL. */
  no_trade_would_be_entry_price?: number | null;
  /** Direction the user would have taken had they entered (no_trade only). */
  no_trade_direction?: 'long' | 'short' | null;
  /** Cognitive-bias self-check tags (dual-track with pre_pain_tags). 'none' means self-checked clean. */
  pre_cognitive_bias_tags?: string[] | null;
  /** Post-close check of the entry-time falsification signal. */
  exit_falsification_status?: ExitFalsificationStatus | null;
  /** Optional note for the falsification check. */
  exit_falsification_note?: string | null;

  // ============ Decision-quality fields (added 2026-05) ============
  /** @deprecated v2 snapshot uses pre_premortem_failure_reason. */
  pre_mortem_text?: string | null;
  /** @deprecated v2 snapshot uses pre_thesis_why_right. */
  pre_positive_expectancy?: string | null;
  /** @deprecated v2 snapshot uses pre_falsification_signal. */
  pre_invalidation_condition?: string | null;
  /** Tetlock-style calibration prediction at open time, 0-100. */
  pre_calibration_win_pct?: number | null;
  /** @deprecated v2 snapshot keeps only a binary probability slider. */
  pre_confidence_interval_low_pct?: number | null;
  /** @deprecated v2 snapshot keeps only a binary probability slider. */
  pre_confidence_interval_high_pct?: number | null;
  /** @deprecated v2 snapshot no longer collects this separate field. */
  pre_calibration_reference_class?: string | null;
  /** @deprecated v2 snapshot uses pre_confidence_basis. */
  pre_calibration_competence_basis?: string | null;
  /** @deprecated v2 snapshot no longer collects this separate field. */
  pre_calibration_update_signal?: string | null;
  /** @deprecated v2 snapshot no longer asks for training/test split at entry. */
  pre_dataset_split?: DatasetSplit | null;
  /** @deprecated v2 snapshot removed the explicit Lollapalooza block. */
  pre_lollapalooza_score?: number | null;
  /** @deprecated v2 snapshot removed this submit-time estimate from the form. */
  pre_bankruptcy_estimate?: number | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_kline_facts?: string | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_macro_facts?: string | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_rule_advice?: string | null;
  /** @deprecated v2 snapshot folds facts into pre_thesis_why_right. */
  pre_info_intuition?: string | null;
  /** @deprecated v2 snapshot no longer collects designer-self separately. */
  pre_info_designer_view?: string | null;
  /** @deprecated v2 snapshot folds inversion into pre_premortem_failure_reason. */
  pre_opponent_statement?: string | null;
  /** @deprecated v2 snapshot no longer asks for explicit principle links. */
  pre_triggered_principle_ids?: string[] | null;
  /** @deprecated v2 snapshot keeps checklist entries but no separate triggered rule list. */
  pre_triggered_rule_ids?: string[] | null;
  /** Pain + reflection loop; also mirrored into pain_log_entries when possible. */
  pre_pain_tags?: PainTag[] | null;
  /** @deprecated v2 snapshot removed the executor/designer dialogue box. */
  pre_executor_self?: string | null;
  /** @deprecated v2 snapshot removed the executor/designer dialogue box. */
  pre_designer_self?: string | null;

  // post-review
  post_outcome: TradeOutcome | null;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  post_reflection: string | null;
  post_correct_action: string | null;
  post_reviewed_at: string | null;
  /** Outcome summary separated from decision quality. */
  post_result_summary?: string | null;
  /** Good/bad decision under information available at entry, independent of outcome. */
  post_decision_quality?: DecisionQuality | null;
  post_positive_expectancy_review?: string | null;
  post_premortem_review?: string | null;
  post_invalidation_review?: string | null;
  post_opponent_was_right?: boolean | null;
  /** Dalio five-step diagnosis. */
  post_five_step_goal?: string | null;
  post_five_step_problem?: string | null;
  post_proximate_cause?: string | null;
  post_root_cause?: string | null;
  post_design_intervention?: string | null;
  post_intervention_type?: InterventionType | null;
  post_execution_monitor?: string | null;
  post_five_step_weak_point?: FiveStepWeakPoint | null;
  /** Real wall-clock time of position close (stamped on first review-sheet open). */
  post_real_close_time?: string | null;

  reason_was_rewritten: boolean;
  counterfactual_branches?: CounterfactualBranch[];

  // ============ Batch 7: 六步深度分析 ============
  post_error_scenario?: string | null;
  post_original_hypothesis?: string | null;
  post_reality_feedback?: string | null;
  post_error_type_summary?: string | null;
  post_real_problem?: string | null;
  post_new_rule_draft?: string | null;
  deep_analysis_completed_at?: string | null;

  created_at: string;
  updated_at: string;
}

export interface JournalTagAssignment {
  id: string;
  user_id: string;
  journal_id: string;
  pattern_id: string;
  tagged_phase: TaggedPhase;
  note: string | null;
  created_at: string;
}

export interface TradingRule {
  id: string;
  user_id: string;
  source_pattern_id: string | null;
  rule_text: string;
  is_active: boolean;
  added_to_checklist: boolean;
  trigger_threshold: number | null;
  required: boolean;
  rule_category: RuleCategory;
  weight: number;
  principle_id: string | null;
  evolution_level: PrincipleEvolutionLevel;
  ui_order: number;
  snooze_until: string | null;
  /** Stamped when the rule first reaches (is_active && added_to_checklist). Drives cooldown. */
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountFollow {
  id: string;
  follower_id: string;
  followee_id: string;
  created_at: string;
}

export interface CampaignComment {
  id: string;
  campaign_id: string;
  user_id: string;
  body: string;
  believability_score: number | null;
  created_at: string;
  updated_at: string;
}

/** Days a rule stays locked after activation. Weakening edits are blocked during this window. */
export const RULE_COOLDOWN_DAYS = 7;

/** Returns ms remaining in the cooldown window, or 0 if expired / never activated. */
export function ruleCooldownRemainingMs(rule: Pick<TradingRule, 'activated_at'>): number {
  if (!rule.activated_at) return 0;
  const end = new Date(rule.activated_at).getTime() + RULE_COOLDOWN_DAYS * 86400_000;
  return Math.max(0, end - Date.now());
}

// ============ Batch 6: Counterfactual branches ============

export interface CounterfactualTpLevel {
  price: number;
  size_pct: number;
}

export interface CounterfactualBranchParams {
  direction: TradeDirection;
  entry_price: number | null;
  stop_loss: number | null;
  take_profits: CounterfactualTpLevel[];
  position_size_usdt: number;
  leverage: number;
  entry_time: string; // ISO
  max_hold_minutes?: number;
}

export type CounterfactualExitReason =
  | 'sl_hit' | 'tp1_hit' | 'tp2_hit' | 'tp3_hit'
  | 'timeout' | 'no_entry' | 'no_data';

export interface CounterfactualBranchResult {
  exit_time: string | null; // ISO
  exit_price: number | null;
  exit_reason: CounterfactualExitReason;
  realized_pnl_usdt: number;
  r_multiple: number;
  filled_tp_index: number | null;
  hold_duration_minutes: number;
}

export interface CounterfactualBranch {
  id: string;
  label: string;
  created_at: string;
  params: CounterfactualBranchParams;
  result: CounterfactualBranchResult;
}
