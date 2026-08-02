ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_exit_nature text;

ALTER TABLE public.trade_journals
  DROP CONSTRAINT IF EXISTS trade_journals_post_exit_nature_check;

ALTER TABLE public.trade_journals
  ADD CONSTRAINT trade_journals_post_exit_nature_check
  CHECK (
    post_exit_nature IS NULL OR post_exit_nature IN (
      'take_profit_before_t',
      'deterioration_falsification_exit',
      'stop_above_k',
      'stop_at_k'
    )
  );

NOTIFY pgrst, 'reload schema';
