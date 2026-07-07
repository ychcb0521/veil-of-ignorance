CREATE SEQUENCE IF NOT EXISTS public.trade_campaign_code_seq;

CREATE TABLE IF NOT EXISTS public.trade_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_code text NOT NULL DEFAULT ('C' || lpad(nextval('public.trade_campaign_code_seq')::text, 8, '0')),
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('main_long', 'main_short')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('planned', 'active', 'closed_profit', 'closed_loss', 'closed_breakeven', 'abandoned')),
  strategy_template text NOT NULL DEFAULT 'main_dual_hedge_mirror_tp'
    CHECK (strategy_template IN ('main_dual_hedge_mirror_tp', 'main_only', 'custom')),
  title text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  initial_main_size_usdt numeric,
  initial_leverage integer,
  final_realized_pnl numeric,
  final_r_multiple numeric,
  peak_unrealized_pnl numeric,
  peak_drawdown numeric,
  notes text,
  actual_evolution jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_campaigns_user_status
  ON public.trade_campaigns(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trade_campaigns_user_symbol
  ON public.trade_campaigns(user_id, symbol);
CREATE UNIQUE INDEX IF NOT EXISTS trade_campaigns_campaign_code_key
  ON public.trade_campaigns(campaign_code);

ALTER TABLE public.trade_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users insert own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users update own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users delete own campaigns" ON public.trade_campaigns;

CREATE POLICY "Users select own campaigns"
  ON public.trade_campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own campaigns"
  ON public.trade_campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own campaigns"
  ON public.trade_campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaigns"
  ON public.trade_campaigns FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.trade_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leg_role text
    CHECK (leg_role IN (
      'main_open',
      'hedge_initial_a',
      'hedge_initial_b',
      'hedge_rolling',
      'mirror_tp',
      'reentry_main',
      'reentry_hedge',
      'standalone'
    )),
  ADD COLUMN IF NOT EXISTS leg_sequence integer;

CREATE INDEX IF NOT EXISTS idx_trade_journals_campaign
  ON public.trade_journals(campaign_id, leg_sequence);

DROP TRIGGER IF EXISTS tg_update_trade_campaign_updated_at ON public.trade_campaigns;
CREATE TRIGGER tg_update_trade_campaign_updated_at
BEFORE UPDATE ON public.trade_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
