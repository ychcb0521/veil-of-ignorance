-- Real wall-clock timestamp of when the user actually closed the position.
-- pre_real_time already records the open-side real timestamp.
-- post_real_close_time captures the close-side. It is stamped the first time
-- the post-trade review sheet opens for an unreviewed journal (close happens
-- moments before the sheet auto-opens, so this is a tight approximation).

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_real_close_time timestamptz;
