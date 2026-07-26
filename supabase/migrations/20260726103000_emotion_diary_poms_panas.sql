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
  ADD CONSTRAINT decision_emotion_diaries_poms_item_scores_check
    CHECK (
      poms_item_scores IS NULL
      OR (
        cardinality(poms_item_scores) = 40
        AND poms_item_scores <@ ARRAY[0, 1, 2, 3, 4]::smallint[]
      )
    ),
  ADD CONSTRAINT decision_emotion_diaries_poms_tension_score_check
    CHECK (poms_tension_score IS NULL OR poms_tension_score BETWEEN 0 AND 24),
  ADD CONSTRAINT decision_emotion_diaries_poms_anger_score_check
    CHECK (poms_anger_score IS NULL OR poms_anger_score BETWEEN 0 AND 28),
  ADD CONSTRAINT decision_emotion_diaries_poms_fatigue_score_check
    CHECK (poms_fatigue_score IS NULL OR poms_fatigue_score BETWEEN 0 AND 20),
  ADD CONSTRAINT decision_emotion_diaries_poms_depression_score_check
    CHECK (poms_depression_score IS NULL OR poms_depression_score BETWEEN 0 AND 24),
  ADD CONSTRAINT decision_emotion_diaries_poms_vigor_score_check
    CHECK (poms_vigor_score IS NULL OR poms_vigor_score BETWEEN 0 AND 24),
  ADD CONSTRAINT decision_emotion_diaries_poms_confusion_score_check
    CHECK (poms_confusion_score IS NULL OR poms_confusion_score BETWEEN 0 AND 20),
  ADD CONSTRAINT decision_emotion_diaries_poms_esteem_score_check
    CHECK (poms_esteem_score IS NULL OR poms_esteem_score BETWEEN 0 AND 20),
  ADD CONSTRAINT decision_emotion_diaries_poms_tmd_check
    CHECK (poms_total_mood_disturbance IS NULL OR poms_total_mood_disturbance BETWEEN 56 AND 216),
  ADD CONSTRAINT decision_emotion_diaries_panas_item_scores_check
    CHECK (
      panas_item_scores IS NULL
      OR (
        cardinality(panas_item_scores) = 20
        AND panas_item_scores <@ ARRAY[1, 2, 3, 4, 5]::smallint[]
      )
    ),
  ADD CONSTRAINT decision_emotion_diaries_panas_positive_score_check
    CHECK (panas_positive_score IS NULL OR panas_positive_score BETWEEN 10 AND 50),
  ADD CONSTRAINT decision_emotion_diaries_panas_negative_score_check
    CHECK (panas_negative_score IS NULL OR panas_negative_score BETWEEN 10 AND 50);

NOTIFY pgrst, 'reload schema';
