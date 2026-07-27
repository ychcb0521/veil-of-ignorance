ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_every_ball_pct numeric;

ALTER TABLE public.trade_journals
  DROP CONSTRAINT IF EXISTS trade_journals_post_every_ball_pct_check;

ALTER TABLE public.trade_journals
  ADD CONSTRAINT trade_journals_post_every_ball_pct_check
  CHECK (
    post_every_ball_pct IS NULL
    OR (post_every_ball_pct >= 0 AND post_every_ball_pct <= 100)
  );

NOTIFY pgrst, 'reload schema';
