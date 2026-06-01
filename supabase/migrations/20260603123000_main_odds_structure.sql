ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_odds_structure text
    CHECK (pre_odds_structure IN (
      'against_crowd_unreleased',
      'neutral_choppy',
      'with_crowd_released'
    )),
  ADD COLUMN IF NOT EXISTS pre_odds_structure_source text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_premortem text,
  ADD COLUMN IF NOT EXISTS pre_odds_structure_breakdown_signals text;
