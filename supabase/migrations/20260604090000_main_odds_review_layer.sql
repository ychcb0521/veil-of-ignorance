-- 《不对称思考》review layer — main-order only. Four additive columns that turn the
-- snapshot/review pair into a structure-first loop:
--   pre_opportunity_cost_worth  机会成本问句：不做的机会成本更高吗？false = 填补无聊的"小机会仓位"。
--   pre_edge_source             这一单的 edge/源头标签（结构判定，不是涨幅预测），用于盈亏同源分析。
--   post_struggle_level         纠结度/轻松度（1 煎熬 … 5 行云流水），作为过程质量的先行指标。
--   post_small_position_drag    小机会仓位的隐性成本记账（占用注意力 / 错过大机会 / 连锁乱做）。
-- Append-only: every column is additive & nullable, nothing is dropped. Hedge-order
-- behaviour is untouched. Old records read NULL → fall back to the existing「旧版快照」path.

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_opportunity_cost_worth boolean,
  ADD COLUMN IF NOT EXISTS pre_edge_source text,
  ADD COLUMN IF NOT EXISTS post_struggle_level integer,
  ADD COLUMN IF NOT EXISTS post_small_position_drag text;

-- CHECK constraints (added separately so re-runs stay idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_pre_edge_source_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_edge_source_check
      CHECK (pre_edge_source IS NULL OR pre_edge_source IN (
        'against_crowd',
        'trend_follow',
        'structure_level',
        'breakout',
        'mean_reversion',
        'event_catalyst',
        'no_clear_edge'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_post_struggle_level_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_struggle_level_check
      CHECK (post_struggle_level IS NULL OR (post_struggle_level BETWEEN 1 AND 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_post_small_position_drag_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_post_small_position_drag_check
      CHECK (post_small_position_drag IS NULL OR post_small_position_drag IN (
        'none',
        'attention_only',
        'missed_bigger',
        'chain_reaction'
      ));
  END IF;
END $$;

-- 盈亏同源 analysis groups journals by edge source.
CREATE INDEX IF NOT EXISTS idx_trade_journals_pre_edge_source
  ON public.trade_journals(user_id, pre_edge_source);
