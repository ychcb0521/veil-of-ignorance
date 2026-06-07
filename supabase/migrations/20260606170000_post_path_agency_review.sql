ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_path_first_move text,
  ADD COLUMN IF NOT EXISTS post_path_drawdown text,
  ADD COLUMN IF NOT EXISTS post_path_win_quality text,
  ADD COLUMN IF NOT EXISTS post_path_agency_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_post_path_first_move_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_path_first_move_check
      CHECK (post_path_first_move IS NULL OR post_path_first_move IN (
        'immediate_profit',
        'immediate_drawdown',
        'unclear'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_post_path_drawdown_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_path_drawdown_check
      CHECK (post_path_drawdown IS NULL OR post_path_drawdown IN (
        'none_or_shallow',
        'meaningful',
        'over_stop',
        'unclear'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_post_path_win_quality_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_path_win_quality_check
      CHECK (post_path_win_quality IS NULL OR post_path_win_quality IN (
        'clean_win',
        'dragged_win',
        'not_win',
        'unclear'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_post_path_win_quality
  ON public.trade_journals(user_id, post_path_win_quality);

CREATE INDEX IF NOT EXISTS idx_trade_journals_post_path_drawdown
  ON public.trade_journals(user_id, post_path_drawdown);
