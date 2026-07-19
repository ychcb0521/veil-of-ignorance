ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_opportunity_quality_payoff_ratio numeric,
  ADD COLUMN IF NOT EXISTS pre_opportunity_quality_drawdown_pct numeric,
  ADD COLUMN IF NOT EXISTS post_opportunity_quality_payoff_ratio numeric,
  ADD COLUMN IF NOT EXISTS post_opportunity_quality_drawdown_pct numeric;

NOTIFY pgrst, 'reload schema';
