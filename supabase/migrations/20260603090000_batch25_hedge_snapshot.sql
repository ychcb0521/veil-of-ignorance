-- Batch 25: hedge-order snapshot — a risk-tool-specific decision record.
-- A hedge is not a directional bet; it trades unbounded, uncontrollable risk for a
-- known, measurable friction cost. These columns capture that decision (3 questions +
-- necessity/conviction sliders + friction + discipline) plus a post-close worth-it回填.
-- Append-only migration: every column is additive, nothing is dropped. Main-order
-- snapshot fields are untouched.

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

-- CHECK constraints (added separately so re-runs stay idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_type_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_type_check
      CHECK (hedge_type IS NULL OR hedge_type IN ('filter', 'trailing', 'ratio'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_boundary_stance_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_boundary_stance_check
      CHECK (hedge_boundary_stance IS NULL OR hedge_boundary_stance IN ('early', 'at_crossover', 'late'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_necessity_pct_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_necessity_pct_check
      CHECK (hedge_necessity_pct IS NULL OR (hedge_necessity_pct >= 0 AND hedge_necessity_pct <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_safety_strength_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_safety_strength_check
      CHECK (hedge_safety_strength IS NULL OR (hedge_safety_strength BETWEEN 1 AND 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_safety_regularity_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_safety_regularity_check
      CHECK (hedge_safety_regularity IS NULL OR (hedge_safety_regularity BETWEEN 1 AND 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_risk_magnitude_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_risk_magnitude_check
      CHECK (hedge_risk_magnitude IS NULL OR (hedge_risk_magnitude BETWEEN 1 AND 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_conviction_pct_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_conviction_pct_check
      CHECK (hedge_conviction_pct IS NULL OR (hedge_conviction_pct >= 0 AND hedge_conviction_pct <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_order_method_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_order_method_check
      CHECK (hedge_order_method IS NULL OR hedge_order_method IN ('limit_preset', 'market_chase'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_hedge_worth_it_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_hedge_worth_it_check
      CHECK (hedge_worth_it IS NULL OR hedge_worth_it IN ('yes', 'partial', 'no'));
  END IF;
END $$;

-- The hedge calibration curve filters hedge journals with a worth-it verdict.
CREATE INDEX IF NOT EXISTS idx_trade_journals_hedge_worth_it
  ON public.trade_journals(user_id, hedge_worth_it);
