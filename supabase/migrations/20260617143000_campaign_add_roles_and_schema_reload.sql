-- Keep historical campaign classification usable on projects that have not
-- applied the older campaign-column migrations, and allow explicit add-on legs.

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS leg_role text,
  ADD COLUMN IF NOT EXISTS leg_sequence integer;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trade_journals_leg_role_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      DROP CONSTRAINT trade_journals_leg_role_check;
  END IF;

  ALTER TABLE public.trade_journals
    ADD CONSTRAINT trade_journals_leg_role_check CHECK (
      leg_role IS NULL OR leg_role IN (
        'main_open',
        'main_add_1',
        'main_add_2',
        'main_add_3',
        'main_add_4',
        'main_add_5',
        'main_add_6',
        'hedge_initial_a',
        'hedge_initial_b',
        'hedge_rolling',
        'mirror_tp',
        'reentry_main',
        'reentry_hedge',
        'standalone'
      )
    );
END
$$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_campaign
  ON public.trade_journals(campaign_id, leg_sequence);

NOTIFY pgrst, 'reload schema';
