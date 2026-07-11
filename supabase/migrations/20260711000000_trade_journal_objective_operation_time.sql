-- Keep objective wallet time and shifted K-line time in separate columns.
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_simulated_close_time timestamptz;

-- Historical/retroactive rows were created with the simulated close stored in the
-- real-time column. Preserve it for replay, then stop exposing it as objective time.
UPDATE public.trade_journals
SET
  post_simulated_close_time = COALESCE(post_simulated_close_time, post_real_close_time),
  post_real_close_time = NULL
WHERE source = 'retroactive_from_record'
  AND post_real_close_time IS NOT NULL;

COMMENT ON COLUMN public.trade_journals.post_real_close_time IS
  'Objective wallet-clock time of the close action; never shifted market time.';
COMMENT ON COLUMN public.trade_journals.post_simulated_close_time IS
  'Time-machine/K-line close timestamp used for replay and chart alignment.';
