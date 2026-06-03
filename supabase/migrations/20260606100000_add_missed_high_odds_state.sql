-- Add the symmetric negative-state marker for thick structures that were missed or under-sized.
-- Append-only: no columns are dropped; old records keep NULL and continue through legacy display paths.

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_missed_high_odds_state text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_post_missed_high_odds_state_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_missed_high_odds_state_check
      CHECK (post_missed_high_odds_state IS NULL OR post_missed_high_odds_state IN (
        'none',
        'missed',
        'under_sized',
        'late_chase'
      ));
  END IF;
END $$;
