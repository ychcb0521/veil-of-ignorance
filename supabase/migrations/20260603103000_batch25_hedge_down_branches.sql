ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS hedge_down_if_chop text,
  ADD COLUMN IF NOT EXISTS hedge_down_if_trend text,
  ADD COLUMN IF NOT EXISTS hedge_down_if_rebound text;
