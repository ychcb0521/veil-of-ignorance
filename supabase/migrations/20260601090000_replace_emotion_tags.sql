-- Replace the emotion-tag vocabulary: rule-impact model (positive / neutral / negative),
-- 30 tags total. Supersedes 20260530120000_expand_emotion_tags.sql.
--
-- The CHECK is re-created with the 30 current tags PLUS the legacy ids that earlier
-- migrations allowed, so historical pain_log_entries rows stay valid (ADD CONSTRAINT
-- validates existing rows). Legacy ids are no longer selectable in the UI.

ALTER TABLE public.pain_log_entries
  DROP CONSTRAINT IF EXISTS pain_log_entries_tag_check;

ALTER TABLE public.pain_log_entries
  ADD CONSTRAINT pain_log_entries_tag_check CHECK (
    pain_tag IN (
      -- 正向情绪 · 帮助执行规则
      'calm', 'focused', 'patient',
      -- 中性情绪 · 需要被校准
      'fear_of_loss', 'fear_giveback', 'hesitation', 'odds_excitement',
      'regret', 'fatigue', 'distracted',
      -- 负向情绪 · 容易破坏规则
      'fomo', 'revenge', 'prove_self', 'impatience', 'greed', 'overconfidence',
      'unwilling', 'sunk_cost', 'boredom', 'panic', 'jackpot_fantasy', 'wishful',
      'denial', 'stubborn_hold', 'confirmation', 'narrative', 'anchoring',
      'envy', 'numbness', 'stress_overload',
      -- legacy ids (kept only so historical rows remain valid; not selectable in UI)
      'anxiety', 'loss_aversion', 'confident', 'content', 'detached'
    )
  );
