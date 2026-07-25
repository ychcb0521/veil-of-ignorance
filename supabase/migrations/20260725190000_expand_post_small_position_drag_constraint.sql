-- Expand the legacy four-state small-position review constraint to the current
-- six-state situation-handling model. Keep legacy values valid so historical
-- rows and older clients continue to work during a rolling deployment.

BEGIN;

ALTER TABLE public.trade_journals
  DROP CONSTRAINT IF EXISTS trade_journals_post_small_position_drag_check;

ALTER TABLE public.trade_journals
  ADD CONSTRAINT trade_journals_post_small_position_drag_check
  CHECK (
    post_small_position_drag IS NULL
    OR post_small_position_drag IN (
      'none',
      'attention_only',
      'missed_bigger',
      'chain_reaction',
      'attention_drain',
      'missed_big',
      'small_clean',
      'small_dragged',
      'big_opp_seized',
      'big_opp_missed',
      'crisis_avoided',
      'crisis_hit'
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
