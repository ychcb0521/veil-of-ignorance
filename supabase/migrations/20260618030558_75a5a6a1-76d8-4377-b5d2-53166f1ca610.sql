
-- ===== 20260524093631_953c66c7-1628-40d3-a0de-f020fea27f86.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS order_kind text NOT NULL DEFAULT 'main'
    CHECK (order_kind IN ('main', 'hedge'));

ALTER TABLE public.trade_journals ALTER COLUMN pre_risk_awareness DROP NOT NULL;
ALTER TABLE public.trade_journals ALTER COLUMN pre_risk_management DROP NOT NULL;
ALTER TABLE public.trade_journals ALTER COLUMN pre_checklist_items DROP NOT NULL;
ALTER TABLE public.trade_journals ALTER COLUMN pre_checklist_passed DROP NOT NULL;

DO $guard1$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_main_order_completeness') THEN
ALTER TABLE public.trade_journals
  ADD CONSTRAINT chk_main_order_completeness
  CHECK (
    order_kind = 'hedge'
    OR (
      pre_risk_awareness IS NOT NULL
      AND pre_risk_management IS NOT NULL
      AND pre_checklist_items IS NOT NULL
      AND pre_checklist_passed IS NOT NULL
    )
  );
END IF; END $guard1$;

-- ===== 20260524153000_trade_campaigns.sql =====
CREATE SEQUENCE IF NOT EXISTS public.trade_campaign_code_seq;

CREATE TABLE IF NOT EXISTS public.trade_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_code text NOT NULL DEFAULT ('C' || lpad(nextval('public.trade_campaign_code_seq')::text, 8, '0')),
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('main_long', 'main_short')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('planned', 'active', 'closed_profit', 'closed_loss', 'closed_breakeven', 'abandoned')),
  strategy_template text NOT NULL DEFAULT 'main_dual_hedge_mirror_tp'
    CHECK (strategy_template IN ('main_dual_hedge_mirror_tp', 'main_only', 'custom')),
  title text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  initial_main_size_usdt numeric,
  initial_leverage integer,
  final_realized_pnl numeric,
  final_r_multiple numeric,
  peak_unrealized_pnl numeric,
  peak_drawdown numeric,
  notes text,
  actual_evolution jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_campaigns TO authenticated;
GRANT ALL ON public.trade_campaigns TO service_role;

CREATE INDEX IF NOT EXISTS idx_trade_campaigns_user_status ON public.trade_campaigns(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trade_campaigns_user_symbol ON public.trade_campaigns(user_id, symbol);
CREATE UNIQUE INDEX IF NOT EXISTS trade_campaigns_campaign_code_key ON public.trade_campaigns(campaign_code);

ALTER TABLE public.trade_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users insert own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users update own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users delete own campaigns" ON public.trade_campaigns;
CREATE POLICY "Users select own campaigns" ON public.trade_campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own campaigns" ON public.trade_campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own campaigns" ON public.trade_campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaigns" ON public.trade_campaigns FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.trade_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leg_role text,
  ADD COLUMN IF NOT EXISTS leg_sequence integer;

CREATE INDEX IF NOT EXISTS idx_trade_journals_campaign ON public.trade_journals(campaign_id, leg_sequence);

DROP TRIGGER IF EXISTS tg_update_trade_campaign_updated_at ON public.trade_campaigns;
CREATE TRIGGER tg_update_trade_campaign_updated_at
BEFORE UPDATE ON public.trade_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 20260525101000_campaign_counterfactuals.sql =====
CREATE TABLE IF NOT EXISTS public.campaign_counterfactuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.trade_campaigns(id) ON DELETE CASCADE,
  label text NOT NULL,
  branch_kind text NOT NULL CHECK (branch_kind IN ('pure_sop', 'fix_one_deviation', 'custom_what_if')),
  source_deduction_id text,
  params jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_counterfactuals TO authenticated;
GRANT ALL ON public.campaign_counterfactuals TO service_role;

CREATE INDEX IF NOT EXISTS idx_campaign_counterfactuals_campaign ON public.campaign_counterfactuals(campaign_id, created_at DESC);

ALTER TABLE public.campaign_counterfactuals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own counterfactuals" ON public.campaign_counterfactuals;
DROP POLICY IF EXISTS "Users insert own counterfactuals" ON public.campaign_counterfactuals;
DROP POLICY IF EXISTS "Users update own counterfactuals" ON public.campaign_counterfactuals;
DROP POLICY IF EXISTS "Users delete own counterfactuals" ON public.campaign_counterfactuals;
CREATE POLICY "Users select own counterfactuals" ON public.campaign_counterfactuals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own counterfactuals" ON public.campaign_counterfactuals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own counterfactuals" ON public.campaign_counterfactuals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own counterfactuals" ON public.campaign_counterfactuals FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.prune_campaign_counterfactuals()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE overflow_count integer;
BEGIN
  SELECT GREATEST(COUNT(*) - 20, 0) INTO overflow_count
  FROM public.campaign_counterfactuals WHERE campaign_id = NEW.campaign_id;
  IF overflow_count > 0 THEN
    DELETE FROM public.campaign_counterfactuals WHERE id IN (
      SELECT id FROM public.campaign_counterfactuals
      WHERE campaign_id = NEW.campaign_id ORDER BY created_at ASC, id ASC LIMIT overflow_count
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_prune_campaign_counterfactuals ON public.campaign_counterfactuals;
CREATE TRIGGER tg_prune_campaign_counterfactuals
AFTER INSERT ON public.campaign_counterfactuals
FOR EACH ROW EXECUTE FUNCTION public.prune_campaign_counterfactuals();

-- ===== 20260525170000_cognitive_assets.sql =====
CREATE TABLE IF NOT EXISTS public.cognitive_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '认知资产',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cognitive_assets_user_id_key UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cognitive_assets TO authenticated;
GRANT ALL ON public.cognitive_assets TO service_role;

ALTER TABLE public.cognitive_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own cognitive assets" ON public.cognitive_assets;
DROP POLICY IF EXISTS "Users insert own cognitive assets" ON public.cognitive_assets;
DROP POLICY IF EXISTS "Users update own cognitive assets" ON public.cognitive_assets;
DROP POLICY IF EXISTS "Users delete own cognitive assets" ON public.cognitive_assets;
CREATE POLICY "Users select own cognitive assets" ON public.cognitive_assets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own cognitive assets" ON public.cognitive_assets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own cognitive assets" ON public.cognitive_assets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own cognitive assets" ON public.cognitive_assets FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cognitive_assets_user_id ON public.cognitive_assets(user_id);

DROP TRIGGER IF EXISTS tg_update_cognitive_assets_updated_at ON public.cognitive_assets;
CREATE TRIGGER tg_update_cognitive_assets_updated_at
BEFORE UPDATE ON public.cognitive_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 20260525193000_cognitive_assets_jsonb.sql =====
ALTER TABLE public.cognitive_assets
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz NOT NULL DEFAULT now();

UPDATE public.cognitive_assets
SET last_edited_at = COALESCE(updated_at, now())
WHERE last_edited_at IS NULL OR last_edited_at <> COALESCE(updated_at, last_edited_at);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cognitive_assets'
      AND column_name='content' AND data_type <> 'jsonb'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE public.cognitive_assets
        ALTER COLUMN content TYPE jsonb
        USING CASE
          WHEN NULLIF(BTRIM(content), '') IS NULL THEN '{}'::jsonb
          WHEN LEFT(BTRIM(content), 1) IN ('{', '[') THEN content::jsonb
          ELSE jsonb_build_object('legacy_text', content)
        END
    $sql$;
  END IF;
END $$;

ALTER TABLE public.cognitive_assets
  ALTER COLUMN content SET DEFAULT '{}'::jsonb;

-- ===== 20260525213000_batch21_emergency_backfill_support.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_leg_role_check'
      AND conrelid = 'public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_leg_role_check CHECK (leg_role IN (
        'main_open','hedge_initial_a','hedge_initial_b','hedge_rolling',
        'mirror_tp','reentry_main','reentry_hedge','standalone'
      ));
  END IF;
END $$;

UPDATE public.trade_journals SET source = 'live' WHERE source IS NULL;

ALTER TABLE public.trade_journals
  ALTER COLUMN source SET DEFAULT 'live',
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_source_check'
      AND conrelid = 'public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_source_check CHECK (source IN ('live', 'retroactive_from_record'));
  END IF;
END $$;

-- ===== 20260526120000_rule_activation_cooldown.sql =====
ALTER TABLE public.trading_rules
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

UPDATE public.trading_rules
   SET activated_at = updated_at
 WHERE activated_at IS NULL
   AND is_active = true
   AND added_to_checklist = true;

CREATE OR REPLACE FUNCTION public.trg_rule_activation_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_active = true AND NEW.added_to_checklist = true AND NEW.activated_at IS NULL THEN
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rule_activation_stamp ON public.trading_rules;
CREATE TRIGGER trg_rule_activation_stamp
  BEFORE INSERT OR UPDATE ON public.trading_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_rule_activation_stamp();

-- ===== 20260526180000_decision_quality_fields.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_mortem_text text,
  ADD COLUMN IF NOT EXISTS pre_calibration_win_pct numeric,
  ADD COLUMN IF NOT EXISTS pre_dataset_split text,
  ADD COLUMN IF NOT EXISTS pre_lollapalooza_score integer,
  ADD COLUMN IF NOT EXISTS pre_bankruptcy_estimate numeric;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_dataset_split_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_dataset_split_check
      CHECK (pre_dataset_split IS NULL OR pre_dataset_split IN ('in_sample','out_of_sample'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_calibration_range_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_calibration_range_check
      CHECK (pre_calibration_win_pct IS NULL OR (pre_calibration_win_pct >= 0 AND pre_calibration_win_pct <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_lollapalooza_range_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_lollapalooza_range_check
      CHECK (pre_lollapalooza_score IS NULL OR (pre_lollapalooza_score >= 0 AND pre_lollapalooza_score <= 100));
  END IF;
END $$;

-- ===== 20260527000000_post_real_close_time.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_real_close_time timestamptz;

-- ===== 20260528090000_decision_record_principles.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_positive_expectancy text,
  ADD COLUMN IF NOT EXISTS pre_invalidation_condition text,
  ADD COLUMN IF NOT EXISTS post_result_summary text,
  ADD COLUMN IF NOT EXISTS post_decision_quality text,
  ADD COLUMN IF NOT EXISTS post_positive_expectancy_review text,
  ADD COLUMN IF NOT EXISTS post_premortem_review text,
  ADD COLUMN IF NOT EXISTS post_invalidation_review text,
  ADD COLUMN IF NOT EXISTS post_entry_payoff_estimate_grade text,
  ADD COLUMN IF NOT EXISTS post_entry_win_rate_estimate_grade text,
  ADD COLUMN IF NOT EXISTS post_entry_payoff_basis_review text,
  ADD COLUMN IF NOT EXISTS post_entry_win_rate_basis_review text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_decision_quality_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_decision_quality_check
      CHECK (post_decision_quality IS NULL OR post_decision_quality IN ('good','mixed','bad'));
  END IF;
END $$;

ALTER TABLE public.trading_rules
  ADD COLUMN IF NOT EXISTS rule_category text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 50;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trading_rules_category_check' AND conrelid='public.trading_rules'::regclass) THEN
    ALTER TABLE public.trading_rules ADD CONSTRAINT trading_rules_category_check
      CHECK (rule_category IN ('hard','core','watch','retired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trading_rules_weight_check' AND conrelid='public.trading_rules'::regclass) THEN
    ALTER TABLE public.trading_rules ADD CONSTRAINT trading_rules_weight_check CHECK (weight BETWEEN 0 AND 100);
  END IF;
END $$;

UPDATE public.trading_rules
   SET rule_category = CASE
     WHEN is_active = false THEN 'retired'
     WHEN added_to_checklist = true AND required = true THEN 'core'
     WHEN added_to_checklist = true THEN 'core'
     ELSE 'watch'
   END
 WHERE rule_category IS NULL OR rule_category = 'core';

CREATE TABLE IF NOT EXISTS public.account_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
GRANT SELECT, INSERT, DELETE ON public.account_follows TO authenticated;
GRANT ALL ON public.account_follows TO service_role;

CREATE INDEX IF NOT EXISTS idx_account_follows_follower ON public.account_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_account_follows_followee ON public.account_follows(followee_id);

ALTER TABLE public.account_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own follow edges" ON public.account_follows;
DROP POLICY IF EXISTS "Users insert own follow edges" ON public.account_follows;
DROP POLICY IF EXISTS "Users delete own follow edges" ON public.account_follows;
CREATE POLICY "Users see own follow edges" ON public.account_follows FOR SELECT USING (auth.uid() = follower_id OR auth.uid() = followee_id);
CREATE POLICY "Users insert own follow edges" ON public.account_follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users delete own follow edges" ON public.account_follows FOR DELETE USING (auth.uid() = follower_id);

CREATE TABLE IF NOT EXISTS public.trade_campaign_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.trade_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  believability_score integer CHECK (believability_score IS NULL OR believability_score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_campaign_comments TO authenticated;
GRANT ALL ON public.trade_campaign_comments TO service_role;

CREATE INDEX IF NOT EXISTS idx_trade_campaign_comments_campaign ON public.trade_campaign_comments(campaign_id, created_at);

ALTER TABLE public.trade_campaign_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Mutual followers select campaigns" ON public.trade_campaigns;
CREATE POLICY "Mutual followers select campaigns" ON public.trade_campaigns FOR SELECT USING (
  auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.account_follows f1
    JOIN public.account_follows f2 ON f2.follower_id = user_id AND f2.followee_id = auth.uid()
    WHERE f1.follower_id = auth.uid() AND f1.followee_id = user_id
  )
);

DROP POLICY IF EXISTS "Mutual followers select campaign journals" ON public.trade_journals;
CREATE POLICY "Mutual followers select campaign journals" ON public.trade_journals FOR SELECT USING (
  auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.trade_campaigns c
    JOIN public.account_follows f1 ON f1.follower_id = auth.uid() AND f1.followee_id = c.user_id
    JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid()
    WHERE c.id = trade_journals.campaign_id
  )
);

DROP POLICY IF EXISTS "Mutual followers select campaign counterfactuals" ON public.campaign_counterfactuals;
CREATE POLICY "Mutual followers select campaign counterfactuals" ON public.campaign_counterfactuals FOR SELECT USING (
  auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.trade_campaigns c
    JOIN public.account_follows f1 ON f1.follower_id = auth.uid() AND f1.followee_id = c.user_id
    JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid()
    WHERE c.id = campaign_counterfactuals.campaign_id
  )
);

DROP POLICY IF EXISTS "Mutual participants select campaign comments" ON public.trade_campaign_comments;
DROP POLICY IF EXISTS "Mutual participants insert campaign comments" ON public.trade_campaign_comments;
DROP POLICY IF EXISTS "Users update own campaign comments" ON public.trade_campaign_comments;
DROP POLICY IF EXISTS "Users delete own campaign comments" ON public.trade_campaign_comments;

CREATE POLICY "Mutual participants select campaign comments" ON public.trade_campaign_comments FOR SELECT USING (
  user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.trade_campaigns c
    WHERE c.id = trade_campaign_comments.campaign_id
      AND (c.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.account_follows f1
        JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid()
        WHERE f1.follower_id = auth.uid() AND f1.followee_id = c.user_id
      ))
  )
);

CREATE POLICY "Mutual participants insert campaign comments" ON public.trade_campaign_comments FOR INSERT WITH CHECK (
  user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.trade_campaigns c
    WHERE c.id = campaign_id
      AND (c.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.account_follows f1
        JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid()
        WHERE f1.follower_id = auth.uid() AND f1.followee_id = c.user_id
      ))
  )
);

CREATE POLICY "Users update own campaign comments" ON public.trade_campaign_comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaign comments" ON public.trade_campaign_comments FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS tg_update_trade_campaign_comments_updated_at ON public.trade_campaign_comments;
CREATE TRIGGER tg_update_trade_campaign_comments_updated_at
BEFORE UPDATE ON public.trade_campaign_comments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 20260529143000_dalio_meta_layer.sql =====
CREATE TABLE IF NOT EXISTS public.trade_principles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  evolution_level integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trade_principles_evolution_level_check CHECK (evolution_level BETWEEN 0 AND 5)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_principles TO authenticated;
GRANT ALL ON public.trade_principles TO service_role;

CREATE INDEX IF NOT EXISTS idx_trade_principles_user_active ON public.trade_principles(user_id, is_active, created_at DESC);

ALTER TABLE public.trade_principles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own principles" ON public.trade_principles;
DROP POLICY IF EXISTS "Users insert own principles" ON public.trade_principles;
DROP POLICY IF EXISTS "Users update own principles" ON public.trade_principles;
DROP POLICY IF EXISTS "Users delete own principles" ON public.trade_principles;
CREATE POLICY "Users select own principles" ON public.trade_principles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own principles" ON public.trade_principles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own principles" ON public.trade_principles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own principles" ON public.trade_principles FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS tg_update_trade_principles_updated_at ON public.trade_principles;
CREATE TRIGGER tg_update_trade_principles_updated_at
BEFORE UPDATE ON public.trade_principles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.trading_rules
  ADD COLUMN IF NOT EXISTS principle_id uuid REFERENCES public.trade_principles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evolution_level integer NOT NULL DEFAULT 3;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trading_rules_evolution_level_check' AND conrelid='public.trading_rules'::regclass) THEN
    ALTER TABLE public.trading_rules ADD CONSTRAINT trading_rules_evolution_level_check CHECK (evolution_level BETWEEN 0 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trading_rules_principle ON public.trading_rules(principle_id);

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_info_kline_facts text,
  ADD COLUMN IF NOT EXISTS pre_info_macro_facts text,
  ADD COLUMN IF NOT EXISTS pre_info_rule_advice text,
  ADD COLUMN IF NOT EXISTS pre_info_intuition text,
  ADD COLUMN IF NOT EXISTS pre_info_designer_view text,
  ADD COLUMN IF NOT EXISTS pre_opponent_statement text,
  ADD COLUMN IF NOT EXISTS pre_triggered_principle_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pre_triggered_rule_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pre_pain_tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pre_executor_self text,
  ADD COLUMN IF NOT EXISTS pre_designer_self text,
  ADD COLUMN IF NOT EXISTS post_opponent_was_right boolean,
  ADD COLUMN IF NOT EXISTS post_five_step_goal text,
  ADD COLUMN IF NOT EXISTS post_five_step_problem text,
  ADD COLUMN IF NOT EXISTS post_proximate_cause text,
  ADD COLUMN IF NOT EXISTS post_root_cause text,
  ADD COLUMN IF NOT EXISTS post_design_intervention text,
  ADD COLUMN IF NOT EXISTS post_intervention_type text,
  ADD COLUMN IF NOT EXISTS post_execution_monitor text,
  ADD COLUMN IF NOT EXISTS post_five_step_weak_point text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_intervention_type_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_intervention_type_check
      CHECK (post_intervention_type IS NULL OR post_intervention_type IN ('principle','rule','sop','awareness'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_five_step_weak_point_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_five_step_weak_point_check
      CHECK (post_five_step_weak_point IS NULL OR post_five_step_weak_point IN ('goal','problem','diagnosis','design','execution'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.pain_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  journal_id uuid REFERENCES public.trade_journals(id) ON DELETE SET NULL,
  symbol text,
  pain_tag text NOT NULL,
  intensity integer NOT NULL DEFAULT 3,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  market_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pain_log_entries_tag_check CHECK (pain_tag IN ('loss_aversion','fomo','regret','greed','anxiety','revenge')),
  CONSTRAINT pain_log_entries_intensity_check CHECK (intensity BETWEEN 1 AND 5)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pain_log_entries TO authenticated;
GRANT ALL ON public.pain_log_entries TO service_role;

CREATE INDEX IF NOT EXISTS idx_pain_log_entries_user_time ON public.pain_log_entries(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pain_log_entries_journal ON public.pain_log_entries(journal_id);

ALTER TABLE public.pain_log_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users select own pain entries" ON public.pain_log_entries;
DROP POLICY IF EXISTS "Users insert own pain entries" ON public.pain_log_entries;
DROP POLICY IF EXISTS "Users update own pain entries" ON public.pain_log_entries;
DROP POLICY IF EXISTS "Users delete own pain entries" ON public.pain_log_entries;
CREATE POLICY "Users select own pain entries" ON public.pain_log_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own pain entries" ON public.pain_log_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own pain entries" ON public.pain_log_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own pain entries" ON public.pain_log_entries FOR DELETE USING (auth.uid() = user_id);

-- ===== 20260530030000_confidence_calibration_snapshot_fields.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_confidence_interval_low_pct numeric,
  ADD COLUMN IF NOT EXISTS pre_confidence_interval_high_pct numeric,
  ADD COLUMN IF NOT EXISTS pre_calibration_reference_class text,
  ADD COLUMN IF NOT EXISTS pre_calibration_competence_basis text,
  ADD COLUMN IF NOT EXISTS pre_calibration_update_signal text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_confidence_interval_range_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_confidence_interval_range_check
      CHECK (pre_confidence_interval_low_pct IS NULL OR (pre_confidence_interval_low_pct >= 0 AND pre_confidence_interval_low_pct <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_confidence_interval_high_range_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_confidence_interval_high_range_check
      CHECK (pre_confidence_interval_high_pct IS NULL OR (pre_confidence_interval_high_pct >= 0 AND pre_confidence_interval_high_pct <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_confidence_interval_order_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_confidence_interval_order_check
      CHECK (pre_confidence_interval_low_pct IS NULL OR pre_confidence_interval_high_pct IS NULL OR pre_confidence_interval_low_pct <= pre_confidence_interval_high_pct);
  END IF;
END $$;

-- ===== 20260530043000_snapshot_v2_slim_fields.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_thesis_why_right text,
  ADD COLUMN IF NOT EXISTS pre_premortem_failure_reason text,
  ADD COLUMN IF NOT EXISTS pre_falsification_signal text,
  ADD COLUMN IF NOT EXISTS pre_confidence_basis text,
  ADD COLUMN IF NOT EXISTS pre_account_equity_usdt numeric;

ALTER TABLE public.trade_journals ALTER COLUMN pre_entry_reason DROP NOT NULL;

-- ===== 20260530120000_expand_emotion_tags.sql (superseded by later) — skip =====
-- ===== 20260531090000_munger_layer.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS journal_kind text NOT NULL DEFAULT 'trade',
  ADD COLUMN IF NOT EXISTS no_trade_reason text,
  ADD COLUMN IF NOT EXISTS no_trade_would_be_entry_price numeric,
  ADD COLUMN IF NOT EXISTS no_trade_direction text,
  ADD COLUMN IF NOT EXISTS pre_cognitive_bias_tags jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exit_falsification_status text,
  ADD COLUMN IF NOT EXISTS exit_falsification_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_journal_kind_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_journal_kind_check CHECK (journal_kind IN ('trade','no_trade'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_no_trade_direction_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_no_trade_direction_check CHECK (no_trade_direction IS NULL OR no_trade_direction IN ('long','short'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_exit_falsification_status_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_exit_falsification_status_check
      CHECK (exit_falsification_status IS NULL OR exit_falsification_status IN ('triggered_reacted','triggered_late','not_triggered'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_kind ON public.trade_journals(user_id, journal_kind);

-- ===== 20260602090000_expand_emotion_tags_v3.sql (final vocabulary) =====
ALTER TABLE public.pain_log_entries DROP CONSTRAINT IF EXISTS pain_log_entries_tag_check;
ALTER TABLE public.pain_log_entries ADD CONSTRAINT pain_log_entries_tag_check CHECK (
  pain_tag IN (
    'calm','focused','patient',
    'fear_of_loss','fear_giveback','hesitation','unease','confusion',
    'regret','odds_excitement','fatigue','distracted',
    'fomo','revenge','prove_self','impatience','boredom','anxiety',
    'greed','overconfidence','optimism','jackpot_fantasy','unwilling',
    'sunk_cost','deprivation','wishful','denial','stubborn_hold',
    'confirmation','narrative','anchoring','envy','anger','panic',
    'despair','frustration','self_pity','shame','numbness',
    'stress_overload','infatuation','aversion','false_safety',
    'false_control','rationalization','obsessive_focus',
    'loss_aversion','confident','content','detached'
  )
);

-- ===== 20260603090000_batch25_hedge_snapshot.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS hedge_type text,
  ADD COLUMN IF NOT EXISTS hedge_boundary_price numeric,
  ADD COLUMN IF NOT EXISTS hedge_boundary_basis text,
  ADD COLUMN IF NOT EXISTS hedge_boundary_stance text,
  ADD COLUMN IF NOT EXISTS hedge_lock_profit_pct numeric,
  ADD COLUMN IF NOT EXISTS hedge_resolution_up text,
  ADD COLUMN IF NOT EXISTS hedge_resolution_down text,
  ADD COLUMN IF NOT EXISTS hedge_necessity_pct numeric,
  ADD COLUMN IF NOT EXISTS hedge_safety_strength integer,
  ADD COLUMN IF NOT EXISTS hedge_safety_regularity integer,
  ADD COLUMN IF NOT EXISTS hedge_risk_magnitude integer,
  ADD COLUMN IF NOT EXISTS hedge_conviction_pct numeric,
  ADD COLUMN IF NOT EXISTS hedge_friction_cost text,
  ADD COLUMN IF NOT EXISTS hedge_order_method text,
  ADD COLUMN IF NOT EXISTS hedge_worth_it text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_type_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_type_check CHECK (hedge_type IS NULL OR hedge_type IN ('filter','trailing','ratio'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_boundary_stance_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_boundary_stance_check CHECK (hedge_boundary_stance IS NULL OR hedge_boundary_stance IN ('early','at_crossover','late'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_necessity_pct_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_necessity_pct_check CHECK (hedge_necessity_pct IS NULL OR (hedge_necessity_pct >= 0 AND hedge_necessity_pct <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_safety_strength_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_safety_strength_check CHECK (hedge_safety_strength IS NULL OR (hedge_safety_strength BETWEEN 1 AND 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_safety_regularity_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_safety_regularity_check CHECK (hedge_safety_regularity IS NULL OR (hedge_safety_regularity BETWEEN 1 AND 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_risk_magnitude_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_risk_magnitude_check CHECK (hedge_risk_magnitude IS NULL OR (hedge_risk_magnitude BETWEEN 1 AND 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_conviction_pct_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_conviction_pct_check CHECK (hedge_conviction_pct IS NULL OR (hedge_conviction_pct >= 0 AND hedge_conviction_pct <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_order_method_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_order_method_check CHECK (hedge_order_method IS NULL OR hedge_order_method IN ('limit_preset','market_chase'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_hedge_worth_it_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_hedge_worth_it_check CHECK (hedge_worth_it IS NULL OR hedge_worth_it IN ('yes','partial','no'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_hedge_worth_it ON public.trade_journals(user_id, hedge_worth_it);

-- ===== 20260603103000_batch25_hedge_down_branches.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS hedge_down_if_chop text,
  ADD COLUMN IF NOT EXISTS hedge_down_if_trend text,
  ADD COLUMN IF NOT EXISTS hedge_down_if_rebound text;

-- ===== 20260603123000_main_odds_structure.sql (CHECK relaxed by 20260607090000) =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_odds_structure text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_source text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_premortem text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_breakdown_signals text;

-- ===== 20260604090000_main_odds_review_layer.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_opportunity_cost_worth boolean,
  ADD COLUMN IF NOT EXISTS pre_edge_source text,
  ADD COLUMN IF NOT EXISTS post_struggle_level integer,
  ADD COLUMN IF NOT EXISTS post_small_position_drag text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_pre_edge_source_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_pre_edge_source_check
      CHECK (pre_edge_source IS NULL OR pre_edge_source IN ('against_crowd','trend_follow','structure_level','breakout','mean_reversion','event_catalyst','no_clear_edge'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_struggle_level_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_struggle_level_check
      CHECK (post_struggle_level IS NULL OR (post_struggle_level BETWEEN 1 AND 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_small_position_drag_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_small_position_drag_check
      CHECK (post_small_position_drag IS NULL OR post_small_position_drag IN ('none','attention_drain','missed_big','chain_reaction'));
  END IF;
END $$;

-- ===== 20260605090000_main_market_structure_layer.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_market_regime text,
  ADD COLUMN IF NOT EXISTS pre_entry_stage text,
  ADD COLUMN IF NOT EXISTS pre_stop_quality text,
  ADD COLUMN IF NOT EXISTS pre_chase_after_close boolean;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_pre_market_regime_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_pre_market_regime_check
      CHECK (pre_market_regime IS NULL OR pre_market_regime IN ('trending_up','trending_down','ranging','breakout_pending','unclear'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_pre_entry_stage_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_pre_entry_stage_check
      CHECK (pre_entry_stage IS NULL OR pre_entry_stage IN ('early','mid','late','too_late','unclear'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_pre_stop_quality_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_pre_stop_quality_check
      CHECK (pre_stop_quality IS NULL OR pre_stop_quality IN ('clean','noisy','arbitrary','none'));
  END IF;
END $$;

-- ===== 20260606090000_add_pre_cheap_opportunity.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_cheap_opportunity text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_pre_cheap_opportunity_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_pre_cheap_opportunity_check
      CHECK (pre_cheap_opportunity IS NULL OR pre_cheap_opportunity IN ('cheap_clear','cheap_unclear','expensive_clear','expensive_unclear','unclear'));
  END IF;
END $$;

-- ===== 20260606100000_add_missed_high_odds_state.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_missed_high_odds_state text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_missed_high_odds_state_check') THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_missed_high_odds_state_check
      CHECK (post_missed_high_odds_state IS NULL OR post_missed_high_odds_state IN ('none','missed','under_sized','late_chase'));
  END IF;
END $$;

-- ===== 20260606170000_post_path_agency_review.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_path_first_move text,
  ADD COLUMN IF NOT EXISTS post_path_drawdown text,
  ADD COLUMN IF NOT EXISTS post_path_win_quality text,
  ADD COLUMN IF NOT EXISTS post_path_agency_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_path_first_move_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_path_first_move_check
      CHECK (post_path_first_move IS NULL OR post_path_first_move IN ('immediate_profit','immediate_drawdown','unclear'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_path_drawdown_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_path_drawdown_check
      CHECK (post_path_drawdown IS NULL OR post_path_drawdown IN ('none_or_shallow','meaningful','over_stop','unclear'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_path_win_quality_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_path_win_quality_check
      CHECK (post_path_win_quality IS NULL OR post_path_win_quality IN ('clean_win','dragged_win','not_win','unclear'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_post_path_win_quality ON public.trade_journals(user_id, post_path_win_quality);
CREATE INDEX IF NOT EXISTS idx_trade_journals_post_path_drawdown ON public.trade_journals(user_id, post_path_drawdown);

-- ===== 20260607090000_fix_pre_odds_structure_check.sql =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trade_journals' AND column_name='pre_odds_structure') THEN
    ALTER TABLE public.trade_journals DROP CONSTRAINT IF EXISTS trade_journals_pre_odds_structure_check;
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_pre_odds_structure_check
      CHECK (pre_odds_structure IS NULL OR pre_odds_structure IN (
        'r1_easy','r2_supported','r3_open','odds_insufficient','target_unclear',
        'against_crowd_unreleased','neutral_choppy','with_crowd_released'
      ));
  END IF;
END $$;

-- ===== 20260616100000_post_emotion_review.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_emo_disturbance text,
  ADD COLUMN IF NOT EXISTS post_emo_first_reaction text,
  ADD COLUMN IF NOT EXISTS post_emo_wanted text,
  ADD COLUMN IF NOT EXISTS post_emo_feared text,
  ADD COLUMN IF NOT EXISTS post_emo_excuse text,
  ADD COLUMN IF NOT EXISTS post_emo_main_stone text,
  ADD COLUMN IF NOT EXISTS post_emo_main_stone_tags text[],
  ADD COLUMN IF NOT EXISTS post_emo_next_time_plan text;

CREATE INDEX IF NOT EXISTS idx_trade_journals_post_emo_main_stone_tags ON public.trade_journals USING GIN (post_emo_main_stone_tags);

-- ===== 20260616120000_stop_doing_list.sql =====
CREATE TABLE IF NOT EXISTS public.stop_doing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  ui_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stop_doing_items TO authenticated;
GRANT ALL ON public.stop_doing_items TO service_role;

CREATE INDEX IF NOT EXISTS idx_stop_doing_items_user_active ON public.stop_doing_items(user_id, is_active, ui_order);

ALTER TABLE public.stop_doing_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stop_doing_items' AND policyname='stop_doing_items_owner_all') THEN
    CREATE POLICY stop_doing_items_owner_all ON public.stop_doing_items FOR ALL
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_stop_doing_acknowledged_ids uuid[],
  ADD COLUMN IF NOT EXISTS pre_stop_doing_ad_hoc text;

-- ===== 20260616140000_post_path_mode_and_agency_score.sql =====
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_path_mode text,
  ADD COLUMN IF NOT EXISTS post_trade_agency_score integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_path_mode_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_path_mode_check
      CHECK (post_path_mode IS NULL OR post_path_mode IN ('roll_position','mirror_take_profit_1r'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_post_trade_agency_score_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_post_trade_agency_score_check
      CHECK (post_trade_agency_score IS NULL OR post_trade_agency_score BETWEEN 1 AND 4);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_post_path_mode ON public.trade_journals(user_id, post_path_mode);
CREATE INDEX IF NOT EXISTS idx_trade_journals_post_trade_agency_score ON public.trade_journals(user_id, post_trade_agency_score);

-- ===== 20260617080000_safety_net_align_trade_journals.sql (覆盖性 ADD IF NOT EXISTS) =====
-- 所有列上面已经加过；此处再跑一次是无操作，保留以保证未来 schema 漂移时再跑也能补齐。
-- (omitted: superset of previous additive columns; ADD COLUMN IF NOT EXISTS is no-op)

-- ===== 20260617143000_campaign_add_roles_and_schema_reload.sql =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_journals_leg_role_check' AND conrelid='public.trade_journals'::regclass) THEN
    ALTER TABLE public.trade_journals DROP CONSTRAINT trade_journals_leg_role_check;
  END IF;
  ALTER TABLE public.trade_journals ADD CONSTRAINT trade_journals_leg_role_check CHECK (
    leg_role IS NULL OR leg_role IN (
      'main_open','main_add_1','main_add_2','main_add_3','main_add_4','main_add_5','main_add_6',
      'hedge_initial_a','hedge_initial_b','hedge_rolling','mirror_tp','reentry_main','reentry_hedge','standalone'
    )
  );
END $$;

-- ===== 20260617170000_trade_campaign_importance.sql =====
ALTER TABLE public.trade_campaigns
  ADD COLUMN IF NOT EXISTS importance_weight integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_campaigns_importance_weight_check') THEN
    ALTER TABLE public.trade_campaigns ADD CONSTRAINT trade_campaigns_importance_weight_check CHECK (importance_weight BETWEEN 0 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_campaigns_user_importance_opened
  ON public.trade_campaigns(user_id, importance_weight DESC, opened_at DESC);

NOTIFY pgrst, 'reload schema';
