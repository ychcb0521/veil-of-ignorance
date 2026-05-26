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
  pre_planned_stop_loss: number | null;
  pre_planned_take_profit: number | null;
  pre_entry_reason: string;
  pre_mental_state: 1 | 2 | 3 | 4 | 5;
  pre_mental_trigger: string | null;
  pre_risk_awareness: string | null;
  pre_risk_management: string | null;
  pre_checklist_items: ChecklistItem[] | null;
  pre_checklist_passed: boolean | null;
  pre_position_size: number | null;
  pre_max_loss_usdt: number | null;

  // ============ Decision-quality fields (added 2026-05) ============
  /** Klein's pre-mortem: "if this loses, what's the most likely reason?" */
  pre_mortem_text?: string | null;
  /** Tetlock-style calibration prediction at open time, 0-100. */
  pre_calibration_win_pct?: number | null;
  /** Anti-overfitting: training set vs holdout (out-of-sample). */
  pre_dataset_split?: DatasetSplit | null;
  /** 0-100 composite of mental, sizing, recent losses, time-of-day, etc. */
  pre_lollapalooza_score?: number | null;
  /** Expected ruin events out of 100 trades, computed at submit time. */
  pre_bankruptcy_estimate?: number | null;

  // post-review
  post_outcome: TradeOutcome | null;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  post_reflection: string | null;
  post_correct_action: string | null;
  post_reviewed_at: string | null;
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
  ui_order: number;
  snooze_until: string | null;
  /** Stamped when the rule first reaches (is_active && added_to_checklist). Drives cooldown. */
  activated_at: string | null;
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
