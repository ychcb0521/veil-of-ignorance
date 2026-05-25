ALTER TABLE public.cognitive_assets
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz NOT NULL DEFAULT now();

UPDATE public.cognitive_assets
SET last_edited_at = COALESCE(updated_at, now())
WHERE last_edited_at IS NULL OR last_edited_at <> COALESCE(updated_at, last_edited_at);

ALTER TABLE public.cognitive_assets
  ALTER COLUMN content TYPE jsonb
  USING CASE
    WHEN NULLIF(BTRIM(content), '') IS NULL THEN '{}'::jsonb
    WHEN LEFT(BTRIM(content), 1) IN ('{', '[') THEN content::jsonb
    ELSE jsonb_build_object('legacy_text', content)
  END;
