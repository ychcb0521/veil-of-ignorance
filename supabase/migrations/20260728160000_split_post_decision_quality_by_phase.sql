ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_entry_decision_quality text,
  ADD COLUMN IF NOT EXISTS post_holding_decision_quality text,
  ADD COLUMN IF NOT EXISTS post_exit_decision_quality text;

UPDATE public.trade_journals
SET
  post_entry_decision_quality = COALESCE(post_entry_decision_quality, post_decision_quality),
  post_holding_decision_quality = COALESCE(post_holding_decision_quality, post_decision_quality),
  post_exit_decision_quality = COALESCE(post_exit_decision_quality, post_decision_quality)
WHERE post_decision_quality IS NOT NULL;

ALTER TABLE public.trade_journals
  DROP CONSTRAINT IF EXISTS trade_journals_post_entry_decision_quality_check,
  DROP CONSTRAINT IF EXISTS trade_journals_post_holding_decision_quality_check,
  DROP CONSTRAINT IF EXISTS trade_journals_post_exit_decision_quality_check;

ALTER TABLE public.trade_journals
  ADD CONSTRAINT trade_journals_post_entry_decision_quality_check
    CHECK (
      post_entry_decision_quality IS NULL
      OR post_entry_decision_quality IN ('good', 'mixed', 'bad')
    ),
  ADD CONSTRAINT trade_journals_post_holding_decision_quality_check
    CHECK (
      post_holding_decision_quality IS NULL
      OR post_holding_decision_quality IN ('good', 'mixed', 'bad')
    ),
  ADD CONSTRAINT trade_journals_post_exit_decision_quality_check
    CHECK (
      post_exit_decision_quality IS NULL
      OR post_exit_decision_quality IN ('good', 'mixed', 'bad')
    );

NOTIFY pgrst, 'reload schema';
