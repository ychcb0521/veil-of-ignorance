CREATE TABLE IF NOT EXISTS public.campaign_counterfactuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.trade_campaigns(id) ON DELETE CASCADE,
  label text NOT NULL,
  branch_kind text NOT NULL
    CHECK (branch_kind IN ('pure_sop', 'fix_one_deviation', 'custom_what_if')),
  source_deduction_id text,
  params jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_counterfactuals_campaign
  ON public.campaign_counterfactuals(campaign_id, created_at DESC);

ALTER TABLE public.campaign_counterfactuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own counterfactuals" ON public.campaign_counterfactuals;
DROP POLICY IF EXISTS "Users insert own counterfactuals" ON public.campaign_counterfactuals;
DROP POLICY IF EXISTS "Users update own counterfactuals" ON public.campaign_counterfactuals;
DROP POLICY IF EXISTS "Users delete own counterfactuals" ON public.campaign_counterfactuals;

CREATE POLICY "Users select own counterfactuals"
  ON public.campaign_counterfactuals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own counterfactuals"
  ON public.campaign_counterfactuals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own counterfactuals"
  ON public.campaign_counterfactuals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own counterfactuals"
  ON public.campaign_counterfactuals FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.prune_campaign_counterfactuals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  overflow_count integer;
BEGIN
  SELECT GREATEST(COUNT(*) - 20, 0)
    INTO overflow_count
  FROM public.campaign_counterfactuals
  WHERE campaign_id = NEW.campaign_id;

  IF overflow_count > 0 THEN
    DELETE FROM public.campaign_counterfactuals
    WHERE id IN (
      SELECT id
      FROM public.campaign_counterfactuals
      WHERE campaign_id = NEW.campaign_id
      ORDER BY created_at ASC, id ASC
      LIMIT overflow_count
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_prune_campaign_counterfactuals ON public.campaign_counterfactuals;
CREATE TRIGGER tg_prune_campaign_counterfactuals
AFTER INSERT ON public.campaign_counterfactuals
FOR EACH ROW EXECUTE FUNCTION public.prune_campaign_counterfactuals();
