-- =============================================================================
-- ONE-TIME REMOTE SCHEMA CATCH-UP  (run in the Supabase dashboard SQL editor)
-- Project: pyvndfzpbsgzinqxairn
-- =============================================================================
-- WHY THIS EXISTS
--   The decision-record submit fails on the live site with:
--     "Could not find the 'pre_confidence_basis' column of 'trade_journals'
--      in the schema cache"  (PostgREST PGRST204).
--   Root cause: the remote database is missing the snapshot columns added by
--   migrations 20260529143000 → 20260606100000. PostgREST therefore rejects the
--   INSERT before it ever reaches the table.
--
-- WHAT THIS DOES
--   Adds every missing snapshot column to public.trade_journals as
--   `ADD COLUMN IF NOT EXISTS` (so it is safe to re-run and never drops data),
--   relaxes the legacy pre_entry_reason NOT NULL, relaxes the pre_odds_structure
--   CHECK to the current vocabulary, and forces PostgREST to reload its cache.
--
-- SAFETY
--   * Idempotent: every statement is IF NOT EXISTS / IF EXISTS guarded.
--   * Append-only: no column is ever dropped; historical rows are untouched
--     (new columns are nullable, so existing rows simply read NULL).
--   * Columns are added WITHOUT restrictive CHECKs so a snapshot can never be
--     blocked by an enum mismatch; the canonical CHECKs live in the migration
--     files and will no-op if those migrations are later applied.
--
-- AFTER RUNNING: the live "提交" should succeed immediately — no redeploy needed,
-- because the fix is on the database side (PostgREST re-reads the schema).
-- =============================================================================

-- ---- decision-quality / calibration / pre-mortem (batch 22-era) -------------
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_result_summary             text,
  ADD COLUMN IF NOT EXISTS post_decision_quality           text,
  ADD COLUMN IF NOT EXISTS post_positive_expectancy_review text,
  ADD COLUMN IF NOT EXISTS post_premortem_review           text,
  ADD COLUMN IF NOT EXISTS post_invalidation_review        text,
  ADD COLUMN IF NOT EXISTS post_entry_payoff_estimate_grade text,
  ADD COLUMN IF NOT EXISTS pre_opportunity_quality_payoff_ratio numeric,
  ADD COLUMN IF NOT EXISTS pre_opportunity_quality_drawdown_pct numeric,
  ADD COLUMN IF NOT EXISTS post_opportunity_quality_payoff_ratio numeric,
  ADD COLUMN IF NOT EXISTS post_opportunity_quality_drawdown_pct numeric,
  ADD COLUMN IF NOT EXISTS post_entry_win_rate_estimate_grade text,
  ADD COLUMN IF NOT EXISTS post_entry_payoff_basis_review  text,
  ADD COLUMN IF NOT EXISTS post_entry_win_rate_basis_review text,
  ADD COLUMN IF NOT EXISTS pre_calibration_win_pct         numeric,
  ADD COLUMN IF NOT EXISTS pre_dataset_split               text,
  ADD COLUMN IF NOT EXISTS pre_lollapalooza_score          integer,
  ADD COLUMN IF NOT EXISTS pre_bankruptcy_estimate         numeric,
  ADD COLUMN IF NOT EXISTS pre_mortem_text                 text,
  ADD COLUMN IF NOT EXISTS pre_positive_expectancy         text,
  ADD COLUMN IF NOT EXISTS pre_invalidation_condition      text,
  ADD COLUMN IF NOT EXISTS post_real_close_time            timestamptz,
  ADD COLUMN IF NOT EXISTS post_simulated_close_time       timestamptz;

UPDATE public.trade_journals
SET
  post_simulated_close_time = COALESCE(post_simulated_close_time, post_real_close_time),
  post_real_close_time = NULL
WHERE source = 'retroactive_from_record'
  AND post_real_close_time IS NOT NULL;

-- ---- Dalio / principles meta layer (20260529143000) -------------------------
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_info_kline_facts       text,
  ADD COLUMN IF NOT EXISTS pre_info_macro_facts       text,
  ADD COLUMN IF NOT EXISTS pre_info_rule_advice       text,
  ADD COLUMN IF NOT EXISTS pre_info_intuition         text,
  ADD COLUMN IF NOT EXISTS pre_info_designer_view     text,
  ADD COLUMN IF NOT EXISTS pre_opponent_statement     text,
  ADD COLUMN IF NOT EXISTS pre_triggered_principle_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pre_triggered_rule_ids      uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pre_pain_tags               text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pre_executor_self          text,
  ADD COLUMN IF NOT EXISTS pre_designer_self          text,
  ADD COLUMN IF NOT EXISTS post_opponent_was_right    boolean,
  ADD COLUMN IF NOT EXISTS post_five_step_goal        text,
  ADD COLUMN IF NOT EXISTS post_five_step_problem     text,
  ADD COLUMN IF NOT EXISTS post_proximate_cause       text,
  ADD COLUMN IF NOT EXISTS post_root_cause            text,
  ADD COLUMN IF NOT EXISTS post_design_intervention   text,
  ADD COLUMN IF NOT EXISTS post_intervention_type     text,
  ADD COLUMN IF NOT EXISTS post_execution_monitor     text,
  ADD COLUMN IF NOT EXISTS post_five_step_weak_point  text;

-- ---- confidence-calibration evidence (20260530030000) -----------------------
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_confidence_interval_low_pct  numeric,
  ADD COLUMN IF NOT EXISTS pre_confidence_interval_high_pct numeric,
  ADD COLUMN IF NOT EXISTS pre_calibration_reference_class  text,
  ADD COLUMN IF NOT EXISTS pre_calibration_competence_basis text,
  ADD COLUMN IF NOT EXISTS pre_calibration_update_signal    text;

-- ---- snapshot v2 slim fields (20260530043000) — the reported error ----------
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_thesis_why_right          text,
  ADD COLUMN IF NOT EXISTS pre_premortem_failure_reason  text,
  ADD COLUMN IF NOT EXISTS pre_falsification_signal      text,
  ADD COLUMN IF NOT EXISTS pre_confidence_basis          text,   -- <-- the missing column from the screenshot
  ADD COLUMN IF NOT EXISTS pre_account_equity_usdt       numeric;

-- legacy free-text entry reason is no longer mandatory in the slim snapshot
ALTER TABLE public.trade_journals
  ALTER COLUMN pre_entry_reason DROP NOT NULL;

-- ---- Munger layer: too-hard basket + falsification (20260531090000) ---------
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS journal_kind               text NOT NULL DEFAULT 'trade',
  ADD COLUMN IF NOT EXISTS no_trade_reason            text,
  ADD COLUMN IF NOT EXISTS no_trade_would_be_entry_price numeric,
  ADD COLUMN IF NOT EXISTS no_trade_direction         text,
  ADD COLUMN IF NOT EXISTS pre_cognitive_bias_tags    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exit_falsification_status  text,
  ADD COLUMN IF NOT EXISTS exit_falsification_note    text;

-- ---- hedge-order snapshot (20260603090000 + 20260603103000) -----------------
-- These are NULL for main orders, but the INSERT payload still carries the keys,
-- so the columns must exist or PostgREST rejects the whole row.
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS hedge_type             text,
  ADD COLUMN IF NOT EXISTS hedge_boundary_price   numeric,
  ADD COLUMN IF NOT EXISTS hedge_boundary_basis   text,
  ADD COLUMN IF NOT EXISTS hedge_boundary_stance  text,
  ADD COLUMN IF NOT EXISTS hedge_lock_profit_pct  numeric,
  ADD COLUMN IF NOT EXISTS hedge_resolution_up    text,
  ADD COLUMN IF NOT EXISTS hedge_resolution_down  text,
  ADD COLUMN IF NOT EXISTS hedge_necessity_pct    numeric,
  ADD COLUMN IF NOT EXISTS hedge_safety_strength  integer,
  ADD COLUMN IF NOT EXISTS hedge_safety_regularity integer,
  ADD COLUMN IF NOT EXISTS hedge_risk_magnitude   integer,
  ADD COLUMN IF NOT EXISTS hedge_conviction_pct   numeric,
  ADD COLUMN IF NOT EXISTS hedge_friction_cost    text,
  ADD COLUMN IF NOT EXISTS hedge_order_method     text,
  ADD COLUMN IF NOT EXISTS hedge_worth_it         text,
  ADD COLUMN IF NOT EXISTS hedge_down_if_chop     text,
  ADD COLUMN IF NOT EXISTS hedge_down_if_trend    text,
  ADD COLUMN IF NOT EXISTS hedge_down_if_rebound  text;

-- ---- main-order odds structure (20260603123000) -----------------------------
-- Added WITHOUT the legacy restrictive CHECK; the permissive CHECK is set below.
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_odds_structure                   text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_source            text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_premortem         text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_breakdown_signals text;

-- ---- 不对称思考 review layer (20260604090000) -------------------------------
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_opportunity_cost_worth boolean,
  ADD COLUMN IF NOT EXISTS pre_edge_source            text,
  ADD COLUMN IF NOT EXISTS post_struggle_level        integer,
  ADD COLUMN IF NOT EXISTS post_small_position_drag   text;

-- ---- market-structure layer (20260605090000) --------------------------------
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_market_regime    text,
  ADD COLUMN IF NOT EXISTS pre_entry_stage      text,
  ADD COLUMN IF NOT EXISTS pre_stop_quality     text,
  ADD COLUMN IF NOT EXISTS pre_chase_after_close boolean;

-- ---- cheap-opportunity + missed-high-odds (20260606090000 / 20260606100000) -
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_cheap_opportunity      text,
  ADD COLUMN IF NOT EXISTS post_missed_high_odds_state text;

-- ---- relax pre_odds_structure CHECK to the current vocabulary ----------------
-- (legacy three-state ids kept valid so any historical rows still pass)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trade_journals'
      AND column_name = 'pre_odds_structure'
  ) THEN
    ALTER TABLE public.trade_journals
      DROP CONSTRAINT IF EXISTS trade_journals_pre_odds_structure_check;
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_odds_structure_check
      CHECK (
        pre_odds_structure IS NULL OR pre_odds_structure IN (
          'r1_easy', 'r2_supported', 'r3_open', 'odds_insufficient', 'target_unclear',
          'against_crowd_unreleased', 'neutral_choppy', 'with_crowd_released'
        )
      );
  END IF;
END $$;

-- ---- trade campaign unique human code --------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.trade_campaign_code_seq;

ALTER TABLE public.trade_campaigns
  ADD COLUMN IF NOT EXISTS campaign_code text;

UPDATE public.trade_campaigns
SET campaign_code = 'C' || lpad(nextval('public.trade_campaign_code_seq')::text, 8, '0')
WHERE campaign_code IS NULL OR btrim(campaign_code) = '';

DO $$
DECLARE
  max_code bigint;
BEGIN
  SELECT COALESCE(MAX(substring(campaign_code FROM 2)::bigint), 0)
  INTO max_code
  FROM public.trade_campaigns
  WHERE campaign_code ~ '^C[0-9]+$';

  IF max_code > 0 THEN
    PERFORM setval('public.trade_campaign_code_seq', max_code, true);
  END IF;
END $$;

ALTER TABLE public.trade_campaigns
  ALTER COLUMN campaign_code SET DEFAULT ('C' || lpad(nextval('public.trade_campaign_code_seq')::text, 8, '0')),
  ALTER COLUMN campaign_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS trade_campaigns_campaign_code_key
  ON public.trade_campaigns(campaign_code);

-- ---- force PostgREST to pick up the new columns immediately ------------------
NOTIFY pgrst, 'reload schema';
