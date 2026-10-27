CREATE TABLE IF NOT EXISTS public.decision_emotion_diaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  diary_date date NOT NULL,
  event_text text NOT NULL,
  sam_valence smallint NOT NULL CHECK (sam_valence BETWEEN 1 AND 9),
  sam_arousal smallint NOT NULL CHECK (sam_arousal BETWEEN 1 AND 9),
  hads_anxiety_scores smallint[] NOT NULL CHECK (cardinality(hads_anxiety_scores) = 7 AND hads_anxiety_scores <@ ARRAY[0, 1, 2, 3]::smallint[]),
  hads_depression_scores smallint[] NOT NULL CHECK (cardinality(hads_depression_scores) = 7 AND hads_depression_scores <@ ARRAY[0, 1, 2, 3]::smallint[]),
  hads_anxiety_score smallint NOT NULL CHECK (hads_anxiety_score BETWEEN 0 AND 21),
  hads_depression_score smallint NOT NULL CHECK (hads_depression_score BETWEEN 0 AND 21),
  measurement_version text NOT NULL DEFAULT 'SAM-VA-9+HADS-14-score-entry-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, diary_date)
);

CREATE INDEX IF NOT EXISTS decision_emotion_diaries_user_date_idx ON public.decision_emotion_diaries (user_id, diary_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_emotion_diaries TO authenticated;
GRANT ALL ON public.decision_emotion_diaries TO service_role;

ALTER TABLE public.decision_emotion_diaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users select own emotion diaries" ON public.decision_emotion_diaries FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users insert own emotion diaries" ON public.decision_emotion_diaries FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users update own emotion diaries" ON public.decision_emotion_diaries FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users delete own emotion diaries" ON public.decision_emotion_diaries FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_decision_emotion_diaries_updated_at ON public.decision_emotion_diaries;
CREATE TRIGGER update_decision_emotion_diaries_updated_at BEFORE UPDATE ON public.decision_emotion_diaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.decision_emotion_diaries
  ALTER COLUMN sam_valence DROP NOT NULL,
  ALTER COLUMN sam_arousal DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS poms_item_scores smallint[],
  ADD COLUMN IF NOT EXISTS poms_tension_score smallint,
  ADD COLUMN IF NOT EXISTS poms_anger_score smallint,
  ADD COLUMN IF NOT EXISTS poms_fatigue_score smallint,
  ADD COLUMN IF NOT EXISTS poms_depression_score smallint,
  ADD COLUMN IF NOT EXISTS poms_vigor_score smallint,
  ADD COLUMN IF NOT EXISTS poms_confusion_score smallint,
  ADD COLUMN IF NOT EXISTS poms_esteem_score smallint,
  ADD COLUMN IF NOT EXISTS poms_total_mood_disturbance smallint,
  ADD COLUMN IF NOT EXISTS panas_item_scores smallint[],
  ADD COLUMN IF NOT EXISTS panas_positive_score smallint,
  ADD COLUMN IF NOT EXISTS panas_negative_score smallint;

ALTER TABLE public.decision_emotion_diaries
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_item_scores_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_tension_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_anger_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_fatigue_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_depression_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_vigor_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_confusion_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_esteem_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_poms_tmd_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_panas_item_scores_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_panas_positive_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_panas_negative_score_check;

ALTER TABLE public.decision_emotion_diaries
  ADD CONSTRAINT decision_emotion_diaries_poms_item_scores_check CHECK (poms_item_scores IS NULL OR (cardinality(poms_item_scores) = 40 AND poms_item_scores <@ ARRAY[0, 1, 2, 3, 4]::smallint[])),
  ADD CONSTRAINT decision_emotion_diaries_poms_tension_score_check CHECK (poms_tension_score IS NULL OR poms_tension_score BETWEEN 0 AND 24),
  ADD CONSTRAINT decision_emotion_diaries_poms_anger_score_check CHECK (poms_anger_score IS NULL OR poms_anger_score BETWEEN 0 AND 28),
  ADD CONSTRAINT decision_emotion_diaries_poms_fatigue_score_check CHECK (poms_fatigue_score IS NULL OR poms_fatigue_score BETWEEN 0 AND 20),
  ADD CONSTRAINT decision_emotion_diaries_poms_depression_score_check CHECK (poms_depression_score IS NULL OR poms_depression_score BETWEEN 0 AND 24),
  ADD CONSTRAINT decision_emotion_diaries_poms_vigor_score_check CHECK (poms_vigor_score IS NULL OR poms_vigor_score BETWEEN 0 AND 24),
  ADD CONSTRAINT decision_emotion_diaries_poms_confusion_score_check CHECK (poms_confusion_score IS NULL OR poms_confusion_score BETWEEN 0 AND 20),
  ADD CONSTRAINT decision_emotion_diaries_poms_esteem_score_check CHECK (poms_esteem_score IS NULL OR poms_esteem_score BETWEEN 0 AND 20),
  ADD CONSTRAINT decision_emotion_diaries_poms_tmd_check CHECK (poms_total_mood_disturbance IS NULL OR poms_total_mood_disturbance BETWEEN 56 AND 216),
  ADD CONSTRAINT decision_emotion_diaries_panas_item_scores_check CHECK (panas_item_scores IS NULL OR (cardinality(panas_item_scores) = 20 AND panas_item_scores <@ ARRAY[1, 2, 3, 4, 5]::smallint[])),
  ADD CONSTRAINT decision_emotion_diaries_panas_positive_score_check CHECK (panas_positive_score IS NULL OR panas_positive_score BETWEEN 10 AND 50),
  ADD CONSTRAINT decision_emotion_diaries_panas_negative_score_check CHECK (panas_negative_score IS NULL OR panas_negative_score BETWEEN 10 AND 50);

ALTER TABLE public.decision_emotion_diaries
  ADD COLUMN IF NOT EXISTS pi_item_scores smallint[],
  ADD COLUMN IF NOT EXISTS pi_total_score smallint,
  ADD COLUMN IF NOT EXISTS pi_mean_score numeric(4, 2);

ALTER TABLE public.decision_emotion_diaries
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_pi_item_scores_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_pi_total_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_pi_mean_score_check;

ALTER TABLE public.decision_emotion_diaries
  ADD CONSTRAINT decision_emotion_diaries_pi_item_scores_check CHECK (pi_item_scores IS NULL OR (cardinality(pi_item_scores) = 7 AND pi_item_scores <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  ADD CONSTRAINT decision_emotion_diaries_pi_total_score_check CHECK (pi_total_score IS NULL OR pi_total_score BETWEEN 7 AND 49),
  ADD CONSTRAINT decision_emotion_diaries_pi_mean_score_check CHECK (pi_mean_score IS NULL OR pi_mean_score BETWEEN 1 AND 7);

NOTIFY pgrst, 'reload schema';