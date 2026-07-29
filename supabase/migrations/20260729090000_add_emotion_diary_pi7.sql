ALTER TABLE public.decision_emotion_diaries
  ADD COLUMN IF NOT EXISTS pi_item_scores smallint[],
  ADD COLUMN IF NOT EXISTS pi_total_score smallint,
  ADD COLUMN IF NOT EXISTS pi_mean_score numeric(4, 2);

ALTER TABLE public.decision_emotion_diaries
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_pi_item_scores_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_pi_total_score_check,
  DROP CONSTRAINT IF EXISTS decision_emotion_diaries_pi_mean_score_check;

ALTER TABLE public.decision_emotion_diaries
  ADD CONSTRAINT decision_emotion_diaries_pi_item_scores_check
    CHECK (
      pi_item_scores IS NULL
      OR (
        cardinality(pi_item_scores) = 7
        AND pi_item_scores <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
      )
    ),
  ADD CONSTRAINT decision_emotion_diaries_pi_total_score_check
    CHECK (pi_total_score IS NULL OR pi_total_score BETWEEN 7 AND 49),
  ADD CONSTRAINT decision_emotion_diaries_pi_mean_score_check
    CHECK (pi_mean_score IS NULL OR pi_mean_score BETWEEN 1 AND 7);

NOTIFY pgrst, 'reload schema';
