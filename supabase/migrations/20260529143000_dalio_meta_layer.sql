-- Dalio / Principles meta layer:
-- L1 principles, L2 rule evolution levels, L3 richer decision snapshots,
-- L4 five-step diagnosis, and L5 pain / credibility tracking inputs.

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

CREATE INDEX IF NOT EXISTS idx_trade_principles_user_active
  ON public.trade_principles(user_id, is_active, created_at DESC);

ALTER TABLE public.trade_principles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own principles" ON public.trade_principles;
DROP POLICY IF EXISTS "Users insert own principles" ON public.trade_principles;
DROP POLICY IF EXISTS "Users update own principles" ON public.trade_principles;
DROP POLICY IF EXISTS "Users delete own principles" ON public.trade_principles;

CREATE POLICY "Users select own principles"
  ON public.trade_principles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own principles"
  ON public.trade_principles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own principles"
  ON public.trade_principles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own principles"
  ON public.trade_principles FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS tg_update_trade_principles_updated_at ON public.trade_principles;
CREATE TRIGGER tg_update_trade_principles_updated_at
BEFORE UPDATE ON public.trade_principles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.trading_rules
  ADD COLUMN IF NOT EXISTS principle_id uuid REFERENCES public.trade_principles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evolution_level integer NOT NULL DEFAULT 3;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_rules_evolution_level_check'
      AND conrelid = 'public.trading_rules'::regclass
  ) THEN
    ALTER TABLE public.trading_rules
      ADD CONSTRAINT trading_rules_evolution_level_check CHECK (evolution_level BETWEEN 0 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trading_rules_principle
  ON public.trading_rules(principle_id);

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_intervention_type_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_intervention_type_check
        CHECK (
          post_intervention_type IS NULL OR
          post_intervention_type IN ('principle', 'rule', 'sop', 'awareness')
        );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_five_step_weak_point_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_five_step_weak_point_check
        CHECK (
          post_five_step_weak_point IS NULL OR
          post_five_step_weak_point IN ('goal', 'problem', 'diagnosis', 'design', 'execution')
        );
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
  CONSTRAINT pain_log_entries_tag_check CHECK (
    pain_tag IN ('loss_aversion', 'fomo', 'regret', 'greed', 'anxiety', 'revenge')
  ),
  CONSTRAINT pain_log_entries_intensity_check CHECK (intensity BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_pain_log_entries_user_time
  ON public.pain_log_entries(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pain_log_entries_journal
  ON public.pain_log_entries(journal_id);

ALTER TABLE public.pain_log_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own pain entries" ON public.pain_log_entries;
DROP POLICY IF EXISTS "Users insert own pain entries" ON public.pain_log_entries;
DROP POLICY IF EXISTS "Users update own pain entries" ON public.pain_log_entries;
DROP POLICY IF EXISTS "Users delete own pain entries" ON public.pain_log_entries;

CREATE POLICY "Users select own pain entries"
  ON public.pain_log_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own pain entries"
  ON public.pain_log_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own pain entries"
  ON public.pain_log_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own pain entries"
  ON public.pain_log_entries FOR DELETE USING (auth.uid() = user_id);
