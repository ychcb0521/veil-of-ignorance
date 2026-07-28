WITH poms_scores AS (
  SELECT
    id,
    poms_item_scores[1] + poms_item_scores[8] + poms_item_scores[15]
      + poms_item_scores[21] + poms_item_scores[28] + poms_item_scores[35] AS tension,
    poms_item_scores[2] + poms_item_scores[9] + poms_item_scores[16]
      + poms_item_scores[22] + poms_item_scores[29] + poms_item_scores[36]
      + poms_item_scores[37] AS anger,
    poms_item_scores[3] + poms_item_scores[10] + poms_item_scores[17]
      + poms_item_scores[23] + poms_item_scores[30] AS fatigue,
    poms_item_scores[4] + poms_item_scores[11] + poms_item_scores[18]
      + poms_item_scores[24] + poms_item_scores[31] + poms_item_scores[38] AS depression,
    poms_item_scores[5] + poms_item_scores[12] + poms_item_scores[19]
      + poms_item_scores[25] + poms_item_scores[32] + poms_item_scores[39] AS vigor,
    poms_item_scores[6] + poms_item_scores[13] + poms_item_scores[20]
      + poms_item_scores[26] + poms_item_scores[33] AS confusion,
    (4 - poms_item_scores[7]) + poms_item_scores[14] + poms_item_scores[27]
      + poms_item_scores[34] + poms_item_scores[40] AS esteem
  FROM public.decision_emotion_diaries
  WHERE cardinality(poms_item_scores) = 40
    AND poms_item_scores <@ ARRAY[0, 1, 2, 3, 4]::smallint[]
)
UPDATE public.decision_emotion_diaries AS diary
SET
  poms_tension_score = scores.tension,
  poms_anger_score = scores.anger,
  poms_fatigue_score = scores.fatigue,
  poms_depression_score = scores.depression,
  poms_vigor_score = scores.vigor,
  poms_confusion_score = scores.confusion,
  poms_esteem_score = scores.esteem,
  poms_total_mood_disturbance = scores.tension
    + scores.anger
    + scores.fatigue
    + scores.depression
    + scores.confusion
    - scores.vigor
    - scores.esteem
    + 100,
  measurement_version = 'POMS-CN-40+PANAS-20+HADS-14-research-v2'
FROM poms_scores AS scores
WHERE diary.id = scores.id;
