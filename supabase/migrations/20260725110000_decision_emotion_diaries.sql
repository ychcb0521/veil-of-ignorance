CREATE TABLE IF NOT EXISTS public.decision_emotion_diaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  diary_date date NOT NULL,
  event_text text NOT NULL,
  sam_valence smallint NOT NULL CHECK (sam_valence BETWEEN 1 AND 9),
  sam_arousal smallint NOT NULL CHECK (sam_arousal BETWEEN 1 AND 9),
  hads_anxiety_scores smallint[] NOT NULL
    CHECK (
      cardinality(hads_anxiety_scores) = 7
      AND hads_anxiety_scores <@ ARRAY[0, 1, 2, 3]::smallint[]
    ),
  hads_depression_scores smallint[] NOT NULL
    CHECK (
      cardinality(hads_depression_scores) = 7
      AND hads_depression_scores <@ ARRAY[0, 1, 2, 3]::smallint[]
    ),
  hads_anxiety_score smallint NOT NULL CHECK (hads_anxiety_score BETWEEN 0 AND 21),
  hads_depression_score smallint NOT NULL CHECK (hads_depression_score BETWEEN 0 AND 21),
  measurement_version text NOT NULL DEFAULT 'SAM-VA-9+HADS-14-score-entry-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, diary_date)
);

CREATE INDEX IF NOT EXISTS decision_emotion_diaries_user_date_idx
  ON public.decision_emotion_diaries (user_id, diary_date DESC);

ALTER TABLE public.decision_emotion_diaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users select own emotion diaries"
  ON public.decision_emotion_diaries
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users insert own emotion diaries"
  ON public.decision_emotion_diaries
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users update own emotion diaries"
  ON public.decision_emotion_diaries
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own emotion diaries" ON public.decision_emotion_diaries;
CREATE POLICY "Users delete own emotion diaries"
  ON public.decision_emotion_diaries
  FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_decision_emotion_diaries_updated_at
  ON public.decision_emotion_diaries;
CREATE TRIGGER update_decision_emotion_diaries_updated_at
  BEFORE UPDATE ON public.decision_emotion_diaries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
