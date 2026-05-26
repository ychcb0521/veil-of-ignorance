-- Decision-quality fields added to the pre-trade snapshot:
--   pre_mortem_text          : Klein's pre-mortem — "if this trade loses, what's the most likely reason?"
--   pre_calibration_win_pct  : Tetlock-style calibration — user-stated probability of profit
--   pre_dataset_split        : in_sample vs out_of_sample — separate training from "test"
--   pre_lollapalooza_score   : 0-100, multi-bias risk composite computed at submit time
--   pre_bankruptcy_estimate  : expected ruin events out of 100 trades at current sizing (Monte Carlo)

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_mortem_text text,
  ADD COLUMN IF NOT EXISTS pre_calibration_win_pct numeric,
  ADD COLUMN IF NOT EXISTS pre_dataset_split text,
  ADD COLUMN IF NOT EXISTS pre_lollapalooza_score integer,
  ADD COLUMN IF NOT EXISTS pre_bankruptcy_estimate numeric;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_dataset_split_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_dataset_split_check
        CHECK (pre_dataset_split IS NULL OR pre_dataset_split IN ('in_sample', 'out_of_sample'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_calibration_range_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_calibration_range_check
        CHECK (pre_calibration_win_pct IS NULL OR (pre_calibration_win_pct >= 0 AND pre_calibration_win_pct <= 100));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_lollapalooza_range_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_lollapalooza_range_check
        CHECK (pre_lollapalooza_score IS NULL OR (pre_lollapalooza_score >= 0 AND pre_lollapalooza_score <= 100));
  END IF;
END $$;
