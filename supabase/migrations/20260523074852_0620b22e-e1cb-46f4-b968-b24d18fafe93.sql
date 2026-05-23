-- Batch 6 schema additions
ALTER TABLE public.trading_rules
  ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ui_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS snooze_until timestamptz;

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS counterfactual_branches jsonb NOT NULL DEFAULT '[]'::jsonb;
