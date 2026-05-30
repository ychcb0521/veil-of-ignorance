-- Add confidence-calibration evidence fields to decision-record snapshots.
-- These extend the existing win-probability and pre-mortem fields with:
-- interval check, reference-class history, circle-of-competence basis, and update check.

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_confidence_interval_low_pct numeric,
  ADD COLUMN IF NOT EXISTS pre_confidence_interval_high_pct numeric,
  ADD COLUMN IF NOT EXISTS pre_calibration_reference_class text,
  ADD COLUMN IF NOT EXISTS pre_calibration_competence_basis text,
  ADD COLUMN IF NOT EXISTS pre_calibration_update_signal text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_confidence_interval_range_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_confidence_interval_range_check
        CHECK (
          pre_confidence_interval_low_pct IS NULL
          OR (
            pre_confidence_interval_low_pct >= 0
            AND pre_confidence_interval_low_pct <= 100
          )
        );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_confidence_interval_high_range_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_confidence_interval_high_range_check
        CHECK (
          pre_confidence_interval_high_pct IS NULL
          OR (
            pre_confidence_interval_high_pct >= 0
            AND pre_confidence_interval_high_pct <= 100
          )
        );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_confidence_interval_order_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_confidence_interval_order_check
        CHECK (
          pre_confidence_interval_low_pct IS NULL
          OR pre_confidence_interval_high_pct IS NULL
          OR pre_confidence_interval_low_pct <= pre_confidence_interval_high_pct
        );
  END IF;
END $$;
