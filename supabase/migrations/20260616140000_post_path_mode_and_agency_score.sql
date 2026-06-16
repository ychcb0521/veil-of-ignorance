ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_path_mode text,
  ADD COLUMN IF NOT EXISTS post_trade_agency_score integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_post_path_mode_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_path_mode_check
      CHECK (post_path_mode IS NULL OR post_path_mode IN (
        'roll_position',
        'mirror_take_profit_1r'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_post_trade_agency_score_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_trade_agency_score_check
      CHECK (post_trade_agency_score IS NULL OR post_trade_agency_score BETWEEN 1 AND 4);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_post_path_mode
  ON public.trade_journals(user_id, post_path_mode);

CREATE INDEX IF NOT EXISTS idx_trade_journals_post_trade_agency_score
  ON public.trade_journals(user_id, post_trade_agency_score);
