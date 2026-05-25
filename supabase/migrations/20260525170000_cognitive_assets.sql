CREATE TABLE IF NOT EXISTS public.cognitive_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '认知资产',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cognitive_assets_user_id_key UNIQUE (user_id)
);

ALTER TABLE public.cognitive_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own cognitive assets" ON public.cognitive_assets;
CREATE POLICY "Users select own cognitive assets"
  ON public.cognitive_assets FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own cognitive assets" ON public.cognitive_assets;
CREATE POLICY "Users insert own cognitive assets"
  ON public.cognitive_assets FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own cognitive assets" ON public.cognitive_assets;
CREATE POLICY "Users update own cognitive assets"
  ON public.cognitive_assets FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own cognitive assets" ON public.cognitive_assets;
CREATE POLICY "Users delete own cognitive assets"
  ON public.cognitive_assets FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cognitive_assets_user_id ON public.cognitive_assets(user_id);

DROP TRIGGER IF EXISTS tg_update_cognitive_assets_updated_at ON public.cognitive_assets;
CREATE TRIGGER tg_update_cognitive_assets_updated_at
BEFORE UPDATE ON public.cognitive_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
