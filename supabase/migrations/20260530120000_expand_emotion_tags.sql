-- Expand emotion tags beyond negative-only "pain" set.
-- Adds positive (focused/confident/calm/content), neutral (detached),
-- and an extra low-arousal negative (fatigue) tag so the snapshot
-- emotion picker can cover the arousal × valence circumplex.

ALTER TABLE public.pain_log_entries
  DROP CONSTRAINT IF EXISTS pain_log_entries_tag_check;

ALTER TABLE public.pain_log_entries
  ADD CONSTRAINT pain_log_entries_tag_check CHECK (
    pain_tag IN (
      -- 负向 · 高唤醒
      'fomo', 'anxiety', 'greed', 'revenge',
      -- 负向 · 低唤醒
      'loss_aversion', 'regret', 'fatigue',
      -- 正向 · 高唤醒
      'focused', 'confident',
      -- 正向 · 低唤醒
      'calm', 'content',
      -- 中性 · 平和度
      'detached'
    )
  );
