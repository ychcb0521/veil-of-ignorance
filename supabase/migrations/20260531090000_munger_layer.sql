-- Batch 24: Munger layer — too-hard basket + dual-track cognition + falsification check.
-- Append-only migration: all columns are additive, nothing is dropped.

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS journal_kind text NOT NULL DEFAULT 'trade',
  ADD COLUMN IF NOT EXISTS no_trade_reason text,
  ADD COLUMN IF NOT EXISTS no_trade_would_be_entry_price numeric,
  ADD COLUMN IF NOT EXISTS no_trade_direction text,
  ADD COLUMN IF NOT EXISTS pre_cognitive_bias_tags jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exit_falsification_status text,
  ADD COLUMN IF NOT EXISTS exit_falsification_note text;

-- CHECK constraints (added separately so re-runs stay idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_journal_kind_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_journal_kind_check
      CHECK (journal_kind IN ('trade', 'no_trade'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_no_trade_direction_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_no_trade_direction_check
      CHECK (no_trade_direction IS NULL OR no_trade_direction IN ('long', 'short'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_exit_falsification_status_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_exit_falsification_status_check
      CHECK (
        exit_falsification_status IS NULL
        OR exit_falsification_status IN ('triggered_reacted', 'triggered_late', 'not_triggered')
      );
  END IF;
END $$;

-- Filtering no_trade vs trade journals is a hot path on the insights / list pages.
CREATE INDEX IF NOT EXISTS idx_trade_journals_kind
  ON public.trade_journals(user_id, journal_kind);
