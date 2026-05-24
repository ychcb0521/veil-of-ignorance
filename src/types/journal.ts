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

  // post-review
  post_outcome: TradeOutcome | null;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  post_reflection: string | null;
  post_correct_action: string | null;
  post_reviewed_at: string | null;

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
  created_at: string;
  updated_at: string;
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

