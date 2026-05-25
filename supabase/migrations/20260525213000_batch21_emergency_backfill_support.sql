CREATE TABLE IF NOT EXISTS public.trade_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

ALTER TABLE public.trade_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users insert own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users update own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "Users delete own campaigns" ON public.trade_campaigns;
DROP POLICY IF EXISTS "trade_campaigns_user_select" ON public.trade_campaigns;
DROP POLICY IF EXISTS "trade_campaigns_user_insert" ON public.trade_campaigns;
DROP POLICY IF EXISTS "trade_campaigns_user_update" ON public.trade_campaigns;
DROP POLICY IF EXISTS "trade_campaigns_user_delete" ON public.trade_campaigns;

CREATE POLICY "trade_campaigns_user_select"
  ON public.trade_campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trade_campaigns_user_insert"
  ON public.trade_campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trade_campaigns_user_update"
  ON public.trade_campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "trade_campaigns_user_delete"
  ON public.trade_campaigns FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.trade_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leg_role text,
  ADD COLUMN IF NOT EXISTS leg_sequence integer,
  ADD COLUMN IF NOT EXISTS source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trade_journals_leg_role_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_leg_role_check CHECK (leg_role IN (
        'main_open',
        'hedge_initial_a',
        'hedge_initial_b',
        'hedge_rolling',
        'mirror_tp',
        'reentry_main',
        'reentry_hedge',
        'standalone'
      ));
  END IF;
END
$$;

UPDATE public.trade_journals
SET source = 'live'
WHERE source IS NULL;

ALTER TABLE public.trade_journals
  ALTER COLUMN source SET DEFAULT 'live',
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trade_journals_source_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_source_check CHECK (source IN ('live', 'retroactive_from_record'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_campaign
  ON public.trade_journals(campaign_id, leg_sequence);

DROP TRIGGER IF EXISTS tg_update_trade_campaign_updated_at ON public.trade_campaigns;
CREATE TRIGGER tg_update_trade_campaign_updated_at
BEFORE UPDATE ON public.trade_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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

CREATE TABLE IF NOT EXISTS public.cognitive_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '认知资产',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_edited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cognitive_assets_user_id_key UNIQUE (user_id)
);

ALTER TABLE public.cognitive_assets
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '认知资产',
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cognitive_assets'
      AND column_name = 'content'
      AND data_type <> 'jsonb'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE public.cognitive_assets
        ALTER COLUMN content TYPE jsonb
        USING CASE
          WHEN NULLIF(BTRIM(content), '') IS NULL THEN '{}'::jsonb
          WHEN LEFT(BTRIM(content), 1) IN ('{', '[') THEN content::jsonb
          ELSE jsonb_build_object('legacy_text', content)
        END
    $sql$;
  END IF;
END
$$;

UPDATE public.cognitive_assets
SET last_edited_at = COALESCE(updated_at, now())
WHERE last_edited_at IS NULL
   OR last_edited_at <> COALESCE(updated_at, last_edited_at);

ALTER TABLE public.cognitive_assets
  ALTER COLUMN content SET DEFAULT '{}'::jsonb,
  ALTER COLUMN content SET NOT NULL;

ALTER TABLE public.cognitive_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own cognitive assets" ON public.cognitive_assets;
DROP POLICY IF EXISTS "Users insert own cognitive assets" ON public.cognitive_assets;
DROP POLICY IF EXISTS "Users update own cognitive assets" ON public.cognitive_assets;
DROP POLICY IF EXISTS "Users delete own cognitive assets" ON public.cognitive_assets;

CREATE POLICY "Users select own cognitive assets"
  ON public.cognitive_assets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own cognitive assets"
  ON public.cognitive_assets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own cognitive assets"
  ON public.cognitive_assets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own cognitive assets"
  ON public.cognitive_assets FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cognitive_assets_user_id
  ON public.cognitive_assets(user_id);

DROP TRIGGER IF EXISTS tg_update_cognitive_assets_updated_at ON public.cognitive_assets;
CREATE TRIGGER tg_update_cognitive_assets_updated_at
BEFORE UPDATE ON public.cognitive_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
