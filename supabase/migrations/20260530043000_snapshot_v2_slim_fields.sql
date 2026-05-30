-- Batch 23: snapshot v2 slim fields.
-- Append-only migration: old columns stay in place for historical journals.

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_thesis_why_right text,
  ADD COLUMN IF NOT EXISTS pre_premortem_failure_reason text,
  ADD COLUMN IF NOT EXISTS pre_falsification_signal text,
  ADD COLUMN IF NOT EXISTS pre_confidence_basis text,
  ADD COLUMN IF NOT EXISTS pre_account_equity_usdt numeric;

ALTER TABLE public.trade_journals
  ALTER COLUMN pre_entry_reason DROP NOT NULL;
