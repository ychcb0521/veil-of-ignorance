-- 快照源头层追加：这是一个便宜的机会吗？
-- 便宜 = 用低成本拿到不对称暴露；not_cheap / unclear 会进入小机会仓位警惕。
-- Append-only：只新增 nullable 列，不 drop / rewrite 任何历史字段。旧记录 NULL → 旧版快照路径。

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_cheap_opportunity text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_pre_cheap_opportunity_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_cheap_opportunity_check
      CHECK (pre_cheap_opportunity IS NULL OR pre_cheap_opportunity IN (
        'cheap',
        'not_cheap',
        'unclear'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trade_journals_pre_cheap_opportunity
  ON public.trade_journals(user_id, pre_cheap_opportunity);
