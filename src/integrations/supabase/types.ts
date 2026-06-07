export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      error_tag_categories: {
        Row: {
          code: string
          color: string
          created_at: string
          description: string
          id: string
          is_special: boolean
          name_zh: string
          sort_order: number
        }
        Insert: {
          code: string
          color: string
          created_at?: string
          description: string
          id?: string
          is_special?: boolean
          name_zh: string
          sort_order: number
        }
        Update: {
          code?: string
          color?: string
          created_at?: string
          description?: string
          id?: string
          is_special?: boolean
          name_zh?: string
          sort_order?: number
        }
        Relationships: []
      }
      error_tag_patterns: {
        Row: {
          category_id: string
          created_at: string
          id: string
          is_archived: boolean
          last_seen_at: string | null
          occurrence_count: number
          operational_definition: string
          parent_id: string | null
          pattern_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          is_archived?: boolean
          last_seen_at?: string | null
          occurrence_count?: number
          operational_definition: string
          parent_id?: string | null
          pattern_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          last_seen_at?: string | null
          occurrence_count?: number
          operational_definition?: string
          parent_id?: string | null
          pattern_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "error_tag_patterns_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "error_tag_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_tag_patterns_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "error_tag_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_tag_assignments: {
        Row: {
          created_at: string
          id: string
          journal_id: string
          note: string | null
          pattern_id: string
          tagged_phase: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          journal_id: string
          note?: string | null
          pattern_id: string
          tagged_phase: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          journal_id?: string
          note?: string | null
          pattern_id?: string
          tagged_phase?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_tag_assignments_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "trade_journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_tag_assignments_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "error_tag_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          initial_capital: number
          is_initialized: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          initial_capital?: number
          is_initialized?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          initial_capital?: number
          is_initialized?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cognitive_assets: {
        Row: {
          content: Json
          created_at: string
          id: string
          last_edited_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          last_edited_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          last_edited_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaign_counterfactuals: {
        Row: {
          branch_kind: string
          campaign_id: string
          created_at: string
          id: string
          label: string
          params: Json
          result: Json
          source_deduction_id: string | null
          user_id: string
        }
        Insert: {
          branch_kind: string
          campaign_id: string
          created_at?: string
          id?: string
          label: string
          params: Json
          result: Json
          source_deduction_id?: string | null
          user_id: string
        }
        Update: {
          branch_kind?: string
          campaign_id?: string
          created_at?: string
          id?: string
          label?: string
          params?: Json
          result?: Json
          source_deduction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_counterfactuals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "trade_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_journals: {
        Row: {
          campaign_id: string | null
          counterfactual_branches: Json
          created_at: string
          deep_analysis_completed_at: string | null
          direction: string
          id: string
          leg_role: string | null
          leg_sequence: number | null
          leverage: number | null
          order_kind: string
          position_mode: string | null
          post_correct_action: string | null
          post_error_scenario: string | null
          post_error_type_summary: string | null
          post_new_rule_draft: string | null
          post_original_hypothesis: string | null
          post_outcome: string | null
          post_path_agency_note: string | null
          post_path_drawdown: string | null
          post_path_first_move: string | null
          post_path_win_quality: string | null
          post_r_multiple: number | null
          post_real_problem: string | null
          post_reality_feedback: string | null
          post_realized_pnl: number | null
          post_reflection: string | null
          post_reviewed_at: string | null
          pre_checklist_items: Json | null
          pre_checklist_passed: boolean | null
          pre_calibration_competence_basis: string | null
          pre_calibration_reference_class: string | null
          pre_calibration_update_signal: string | null
          pre_calibration_win_pct: number | null
          pre_account_equity_usdt: number | null
          pre_confidence_interval_high_pct: number | null
          pre_confidence_interval_low_pct: number | null
          pre_confidence_basis: string | null
          pre_dataset_split: string | null
          pre_bankruptcy_estimate: number | null
          pre_entry_price: number | null
          pre_entry_reason: string | null
          pre_executor_self: string | null
          pre_designer_self: string | null
          pre_falsification_signal: string | null
          pre_max_loss_usdt: number | null
          pre_mental_state: number
          pre_mental_trigger: string | null
          pre_mortem_text: string | null
          pre_opponent_statement: string | null
          pre_pain_tags: Json | null
          pre_positive_expectancy: string | null
          pre_premortem_failure_reason: string | null
          pre_info_designer_view: string | null
          pre_info_intuition: string | null
          pre_info_kline_facts: string | null
          pre_info_macro_facts: string | null
          pre_info_rule_advice: string | null
          pre_invalidation_condition: string | null
          pre_lollapalooza_score: number | null
          pre_planned_stop_loss: number | null
          pre_planned_take_profit: number | null
          pre_position_size: number | null
          pre_real_time: string
          pre_risk_awareness: string | null
          pre_risk_management: string | null
          pre_simulated_time: string
          pre_thesis_why_right: string | null
          pre_triggered_principle_ids: Json | null
          pre_triggered_rule_ids: Json | null
          reason_was_rewritten: boolean
          symbol: string
          trade_record_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          counterfactual_branches?: Json
          created_at?: string
          deep_analysis_completed_at?: string | null
          direction: string
          id?: string
          leg_role?: string | null
          leg_sequence?: number | null
          leverage?: number | null
          order_kind?: string
          position_mode?: string | null
          post_correct_action?: string | null
          post_error_scenario?: string | null
          post_error_type_summary?: string | null
          post_new_rule_draft?: string | null
          post_original_hypothesis?: string | null
          post_outcome?: string | null
          post_path_agency_note?: string | null
          post_path_drawdown?: string | null
          post_path_first_move?: string | null
          post_path_win_quality?: string | null
          post_r_multiple?: number | null
          post_real_problem?: string | null
          post_reality_feedback?: string | null
          post_realized_pnl?: number | null
          post_reflection?: string | null
          post_reviewed_at?: string | null
          pre_checklist_items?: Json | null
          pre_checklist_passed?: boolean | null
          pre_calibration_competence_basis?: string | null
          pre_calibration_reference_class?: string | null
          pre_calibration_update_signal?: string | null
          pre_calibration_win_pct?: number | null
          pre_account_equity_usdt?: number | null
          pre_confidence_interval_high_pct?: number | null
          pre_confidence_interval_low_pct?: number | null
          pre_confidence_basis?: string | null
          pre_dataset_split?: string | null
          pre_bankruptcy_estimate?: number | null
          pre_entry_price?: number | null
          pre_entry_reason?: string | null
          pre_executor_self?: string | null
          pre_designer_self?: string | null
          pre_falsification_signal?: string | null
          pre_max_loss_usdt?: number | null
          pre_mental_state: number
          pre_mental_trigger?: string | null
          pre_mortem_text?: string | null
          pre_opponent_statement?: string | null
          pre_pain_tags?: Json | null
          pre_positive_expectancy?: string | null
          pre_premortem_failure_reason?: string | null
          pre_info_designer_view?: string | null
          pre_info_intuition?: string | null
          pre_info_kline_facts?: string | null
          pre_info_macro_facts?: string | null
          pre_info_rule_advice?: string | null
          pre_invalidation_condition?: string | null
          pre_lollapalooza_score?: number | null
          pre_planned_stop_loss?: number | null
          pre_planned_take_profit?: number | null
          pre_position_size?: number | null
          pre_real_time?: string
          pre_risk_awareness?: string | null
          pre_risk_management?: string | null
          pre_simulated_time: string
          pre_thesis_why_right?: string | null
          pre_triggered_principle_ids?: Json | null
          pre_triggered_rule_ids?: Json | null
          reason_was_rewritten?: boolean
          symbol: string
          trade_record_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          counterfactual_branches?: Json
          created_at?: string
          deep_analysis_completed_at?: string | null
          direction?: string
          id?: string
          leg_role?: string | null
          leg_sequence?: number | null
          leverage?: number | null
          order_kind?: string
          position_mode?: string | null
          post_correct_action?: string | null
          post_error_scenario?: string | null
          post_error_type_summary?: string | null
          post_new_rule_draft?: string | null
          post_original_hypothesis?: string | null
          post_outcome?: string | null
          post_path_agency_note?: string | null
          post_path_drawdown?: string | null
          post_path_first_move?: string | null
          post_path_win_quality?: string | null
          post_r_multiple?: number | null
          post_real_problem?: string | null
          post_reality_feedback?: string | null
          post_realized_pnl?: number | null
          post_reflection?: string | null
          post_reviewed_at?: string | null
          pre_checklist_items?: Json | null
          pre_checklist_passed?: boolean | null
          pre_calibration_competence_basis?: string | null
          pre_calibration_reference_class?: string | null
          pre_calibration_update_signal?: string | null
          pre_calibration_win_pct?: number | null
          pre_account_equity_usdt?: number | null
          pre_confidence_interval_high_pct?: number | null
          pre_confidence_interval_low_pct?: number | null
          pre_confidence_basis?: string | null
          pre_dataset_split?: string | null
          pre_bankruptcy_estimate?: number | null
          pre_entry_price?: number | null
          pre_entry_reason?: string | null
          pre_executor_self?: string | null
          pre_designer_self?: string | null
          pre_falsification_signal?: string | null
          pre_max_loss_usdt?: number | null
          pre_mental_state?: number
          pre_mental_trigger?: string | null
          pre_mortem_text?: string | null
          pre_opponent_statement?: string | null
          pre_pain_tags?: Json | null
          pre_positive_expectancy?: string | null
          pre_premortem_failure_reason?: string | null
          pre_info_designer_view?: string | null
          pre_info_intuition?: string | null
          pre_info_kline_facts?: string | null
          pre_info_macro_facts?: string | null
          pre_info_rule_advice?: string | null
          pre_invalidation_condition?: string | null
          pre_lollapalooza_score?: number | null
          pre_planned_stop_loss?: number | null
          pre_planned_take_profit?: number | null
          pre_position_size?: number | null
          pre_real_time?: string
          pre_risk_awareness?: string | null
          pre_risk_management?: string | null
          pre_simulated_time?: string
          pre_thesis_why_right?: string | null
          pre_triggered_principle_ids?: Json | null
          pre_triggered_rule_ids?: Json | null
          reason_was_rewritten?: boolean
          symbol?: string
          trade_record_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_journals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "trade_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_campaigns: {
        Row: {
          actual_evolution: Json
          closed_at: string | null
          created_at: string | null
          direction: string
          final_r_multiple: number | null
          final_realized_pnl: number | null
          id: string
          initial_leverage: number | null
          initial_main_size_usdt: number | null
          notes: string | null
          opened_at: string
          peak_drawdown: number | null
          peak_unrealized_pnl: number | null
          status: string
          strategy_template: string
          symbol: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_evolution?: Json
          closed_at?: string | null
          created_at?: string | null
          direction: string
          final_r_multiple?: number | null
          final_realized_pnl?: number | null
          id?: string
          initial_leverage?: number | null
          initial_main_size_usdt?: number | null
          notes?: string | null
          opened_at: string
          peak_drawdown?: number | null
          peak_unrealized_pnl?: number | null
          status?: string
          strategy_template?: string
          symbol: string
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_evolution?: Json
          closed_at?: string | null
          created_at?: string | null
          direction?: string
          final_r_multiple?: number | null
          final_realized_pnl?: number | null
          id?: string
          initial_leverage?: number | null
          initial_main_size_usdt?: number | null
          notes?: string | null
          opened_at?: string
          peak_drawdown?: number | null
          peak_unrealized_pnl?: number | null
          status?: string
          strategy_template?: string
          symbol?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trading_rules: {
        Row: {
          added_to_checklist: boolean
          created_at: string
          id: string
          is_active: boolean
          required: boolean
          rule_text: string
          snooze_until: string | null
          source_pattern_id: string | null
          trigger_threshold: number | null
          ui_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          added_to_checklist?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          required?: boolean
          rule_text: string
          snooze_until?: string | null
          source_pattern_id?: string | null
          trigger_threshold?: number | null
          ui_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          added_to_checklist?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          required?: boolean
          rule_text?: string
          snooze_until?: string | null
          source_pattern_id?: string | null
          trigger_threshold?: number | null
          ui_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_rules_source_pattern_id_fkey"
            columns: ["source_pattern_id"]
            isOneToOne: false
            referencedRelation: "error_tag_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
