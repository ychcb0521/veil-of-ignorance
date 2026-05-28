-- Decision record refinement:
-- - Three pre-trade questions: expectancy, pre-mortem, invalidation
-- - Post-trade split between result and decision quality
-- - Rule categories + weight
-- - Mutual-follow campaign comments for external believability checks

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_positive_expectancy text,
  ADD COLUMN IF NOT EXISTS pre_invalidation_condition text,
  ADD COLUMN IF NOT EXISTS post_result_summary text,
  ADD COLUMN IF NOT EXISTS post_decision_quality text,
  ADD COLUMN IF NOT EXISTS post_positive_expectancy_review text,
  ADD COLUMN IF NOT EXISTS post_premortem_review text,
  ADD COLUMN IF NOT EXISTS post_invalidation_review text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trade_journals_decision_quality_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_decision_quality_check
        CHECK (post_decision_quality IS NULL OR post_decision_quality IN ('good', 'mixed', 'bad'));
  END IF;
END $$;

ALTER TABLE public.trading_rules
  ADD COLUMN IF NOT EXISTS rule_category text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 50;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_rules_category_check'
      AND conrelid = 'public.trading_rules'::regclass
  ) THEN
    ALTER TABLE public.trading_rules
      ADD CONSTRAINT trading_rules_category_check
        CHECK (rule_category IN ('hard', 'core', 'watch', 'retired'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trading_rules_weight_check'
      AND conrelid = 'public.trading_rules'::regclass
  ) THEN
    ALTER TABLE public.trading_rules
      ADD CONSTRAINT trading_rules_weight_check CHECK (weight BETWEEN 0 AND 100);
  END IF;
END $$;

UPDATE public.trading_rules
   SET rule_category = CASE
     WHEN is_active = false THEN 'retired'
     WHEN added_to_checklist = true AND required = true THEN 'core'
     WHEN added_to_checklist = true THEN 'core'
     ELSE 'watch'
   END
 WHERE rule_category IS NULL OR rule_category = 'core';

CREATE TABLE IF NOT EXISTS public.account_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_account_follows_follower ON public.account_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_account_follows_followee ON public.account_follows(followee_id);

ALTER TABLE public.account_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own follow edges" ON public.account_follows;
DROP POLICY IF EXISTS "Users insert own follow edges" ON public.account_follows;
DROP POLICY IF EXISTS "Users delete own follow edges" ON public.account_follows;

CREATE POLICY "Users see own follow edges"
  ON public.account_follows FOR SELECT
  USING (auth.uid() = follower_id OR auth.uid() = followee_id);
CREATE POLICY "Users insert own follow edges"
  ON public.account_follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users delete own follow edges"
  ON public.account_follows FOR DELETE
  USING (auth.uid() = follower_id);

CREATE TABLE IF NOT EXISTS public.trade_campaign_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.trade_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  believability_score integer CHECK (believability_score IS NULL OR believability_score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_campaign_comments_campaign
  ON public.trade_campaign_comments(campaign_id, created_at);

ALTER TABLE public.trade_campaign_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Mutual followers select campaigns" ON public.trade_campaigns;
CREATE POLICY "Mutual followers select campaigns"
  ON public.trade_campaigns FOR SELECT
  USING (
    auth.uid() = user_id OR EXISTS (
      SELECT 1
      FROM public.account_follows f1
      JOIN public.account_follows f2
        ON f2.follower_id = user_id
       AND f2.followee_id = auth.uid()
      WHERE f1.follower_id = auth.uid()
        AND f1.followee_id = user_id
    )
  );

DROP POLICY IF EXISTS "Mutual followers select campaign journals" ON public.trade_journals;
CREATE POLICY "Mutual followers select campaign journals"
  ON public.trade_journals FOR SELECT
  USING (
    auth.uid() = user_id OR EXISTS (
      SELECT 1
      FROM public.trade_campaigns c
      JOIN public.account_follows f1
        ON f1.follower_id = auth.uid()
       AND f1.followee_id = c.user_id
      JOIN public.account_follows f2
        ON f2.follower_id = c.user_id
       AND f2.followee_id = auth.uid()
      WHERE c.id = trade_journals.campaign_id
    )
  );

DROP POLICY IF EXISTS "Mutual followers select campaign counterfactuals" ON public.campaign_counterfactuals;
CREATE POLICY "Mutual followers select campaign counterfactuals"
  ON public.campaign_counterfactuals FOR SELECT
  USING (
    auth.uid() = user_id OR EXISTS (
      SELECT 1
      FROM public.trade_campaigns c
      JOIN public.account_follows f1
        ON f1.follower_id = auth.uid()
       AND f1.followee_id = c.user_id
      JOIN public.account_follows f2
        ON f2.follower_id = c.user_id
       AND f2.followee_id = auth.uid()
      WHERE c.id = campaign_counterfactuals.campaign_id
    )
  );

DROP POLICY IF EXISTS "Mutual participants select campaign comments" ON public.trade_campaign_comments;
DROP POLICY IF EXISTS "Mutual participants insert campaign comments" ON public.trade_campaign_comments;
DROP POLICY IF EXISTS "Users update own campaign comments" ON public.trade_campaign_comments;
DROP POLICY IF EXISTS "Users delete own campaign comments" ON public.trade_campaign_comments;

CREATE POLICY "Mutual participants select campaign comments"
  ON public.trade_campaign_comments FOR SELECT
  USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1
      FROM public.trade_campaigns c
      WHERE c.id = trade_campaign_comments.campaign_id
        AND (
          c.user_id = auth.uid() OR EXISTS (
            SELECT 1
            FROM public.account_follows f1
            JOIN public.account_follows f2
              ON f2.follower_id = c.user_id
             AND f2.followee_id = auth.uid()
            WHERE f1.follower_id = auth.uid()
              AND f1.followee_id = c.user_id
          )
        )
    )
  );

CREATE POLICY "Mutual participants insert campaign comments"
  ON public.trade_campaign_comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND EXISTS (
      SELECT 1
      FROM public.trade_campaigns c
      WHERE c.id = campaign_id
        AND (
          c.user_id = auth.uid() OR EXISTS (
            SELECT 1
            FROM public.account_follows f1
            JOIN public.account_follows f2
              ON f2.follower_id = c.user_id
             AND f2.followee_id = auth.uid()
            WHERE f1.follower_id = auth.uid()
              AND f1.followee_id = c.user_id
          )
        )
    )
  );

CREATE POLICY "Users update own campaign comments"
  ON public.trade_campaign_comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own campaign comments"
  ON public.trade_campaign_comments FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS tg_update_trade_campaign_comments_updated_at ON public.trade_campaign_comments;
CREATE TRIGGER tg_update_trade_campaign_comments_updated_at
BEFORE UPDATE ON public.trade_campaign_comments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
