-- Fix pre_odds_structure CHECK drift.
-- 20260603123000_main_odds_structure.sql created pre_odds_structure with a CHECK that
-- only allowed the legacy three-state vocabulary (against_crowd_unreleased / neutral_choppy /
-- with_crowd_released). The OddsStructure type has since moved to the R-target vocabulary
-- (r1_easy / r2_supported / r3_open / odds_insufficient / target_unclear), so any current
-- snapshot that records an odds structure would violate the old CHECK and fail to submit.
--
-- Re-create the CHECK to allow the current 5 values PLUS the legacy 3 (so historical rows
-- stay valid — ADD CONSTRAINT re-validates existing rows). Append-only: no column is dropped;
-- dropping/replacing a CHECK constraint follows the same pattern as the emotion-tag migrations.

DO $$
BEGIN
  -- Only touch the constraint if the column exists (it is created by 20260603123000).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trade_journals'
      AND column_name = 'pre_odds_structure'
  ) THEN
    ALTER TABLE public.trade_journals
      DROP CONSTRAINT IF EXISTS trade_journals_pre_odds_structure_check;

    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_odds_structure_check
      CHECK (
        pre_odds_structure IS NULL OR pre_odds_structure IN (
          -- current R-target vocabulary
          'r1_easy', 'r2_supported', 'r3_open', 'odds_insufficient', 'target_unclear',
          -- legacy three-state ids (kept only so historical rows remain valid; not selectable in UI)
          'against_crowd_unreleased', 'neutral_choppy', 'with_crowd_released'
        )
      );
  END IF;
END $$;
