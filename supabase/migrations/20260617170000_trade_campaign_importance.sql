ALTER TABLE public.trade_campaigns
  ADD COLUMN IF NOT EXISTS importance_weight integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trade_campaigns_importance_weight_check'
  ) THEN
    ALTER TABLE public.trade_campaigns
      ADD CONSTRAINT trade_campaigns_importance_weight_check
      CHECK (importance_weight BETWEEN 0 AND 5);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_campaigns_user_importance_opened
  ON public.trade_campaigns(user_id, importance_weight DESC, opened_at DESC);

NOTIFY pgrst, 'reload schema';
