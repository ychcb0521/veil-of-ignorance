-- Every trade campaign gets a globally unique, human-facing code.
-- The sequence generates new codes; the unique index is the concurrency backstop.

CREATE SEQUENCE IF NOT EXISTS public.trade_campaign_code_seq;

ALTER TABLE public.trade_campaigns
  ADD COLUMN IF NOT EXISTS campaign_code text;

UPDATE public.trade_campaigns
SET campaign_code = 'C' || lpad(nextval('public.trade_campaign_code_seq')::text, 8, '0')
WHERE campaign_code IS NULL OR btrim(campaign_code) = '';

DO $$
DECLARE
  max_code bigint;
BEGIN
  SELECT COALESCE(MAX(substring(campaign_code FROM 2)::bigint), 0)
  INTO max_code
  FROM public.trade_campaigns
  WHERE campaign_code ~ '^C[0-9]+$';

  IF max_code > 0 THEN
    PERFORM setval('public.trade_campaign_code_seq', max_code, true);
  END IF;
END $$;

ALTER TABLE public.trade_campaigns
  ALTER COLUMN campaign_code SET DEFAULT ('C' || lpad(nextval('public.trade_campaign_code_seq')::text, 8, '0')),
  ALTER COLUMN campaign_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS trade_campaigns_campaign_code_key
  ON public.trade_campaigns(campaign_code);

NOTIFY pgrst, 'reload schema';
