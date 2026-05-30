-- Expand the emotion-tag vocabulary to the rule-impact v3 model (positive / neutral / negative),
-- 46 selectable tags total. Supersedes 20260601090000_replace_emotion_tags.sql.
--
-- pre_pain_tags (jsonb on trade_journals) is free-form and unconstrained; only the denormalized
-- pain_log_entries.pain_tag column carries a CHECK. We re-create that CHECK with the 46 current
-- tags PLUS every legacy id earlier migrations allowed, so historical pain_log_entries rows stay
-- valid (ADD CONSTRAINT re-validates existing rows). Legacy-only ids are no longer selectable in UI.
--
-- Note: the snapshot save mirrors pre_pain_tags into pain_log_entries fire-and-forget
-- (.catch in journalApi.createPreTradeSnapshot), so even without this migration the UI never
-- blocks; running it simply keeps the pain-log pipeline complete and warning-free.

ALTER TABLE public.pain_log_entries
  DROP CONSTRAINT IF EXISTS pain_log_entries_tag_check;

ALTER TABLE public.pain_log_entries
  ADD CONSTRAINT pain_log_entries_tag_check CHECK (
    pain_tag IN (
      -- 正向情绪 · 帮助执行规则（可放行，但不能替代规则）
      'calm', 'focused', 'patient',
      -- 中性情绪 · 本身不坏，但必须校准
      'fear_of_loss', 'fear_giveback', 'hesitation', 'unease', 'confusion',
      'regret', 'odds_excitement', 'fatigue', 'distracted',
      -- 负向情绪 · 默认黄灯或红灯
      'fomo', 'revenge', 'prove_self', 'impatience', 'boredom', 'anxiety',
      'greed', 'overconfidence', 'optimism', 'jackpot_fantasy', 'unwilling',
      'sunk_cost', 'deprivation', 'wishful', 'denial', 'stubborn_hold',
      'confirmation', 'narrative', 'anchoring', 'envy', 'anger', 'panic',
      'despair', 'frustration', 'self_pity', 'shame', 'numbness',
      'stress_overload', 'infatuation', 'aversion', 'false_safety',
      'false_control', 'rationalization', 'obsessive_focus',
      -- legacy ids (kept only so historical rows remain valid; not selectable in UI)
      'loss_aversion', 'confident', 'content', 'detached'
    )
  );
