-- Stop Doing List · 决策记录前的"我决心不做的事"清单
--   设计意图：
--     现有 trading_rules 是"我应该做 X"语义；这里是反向语义"我决心不做 Y"。
--     强行复用会让 buildChecklist 的语义混乱，所以另起一张表。
--   每个 item 是 user 个人的全局条目，在开仓决策记录顶部统一勾选。

CREATE TABLE IF NOT EXISTS public.stop_doing_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  ui_order    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stop_doing_items_user_active
  ON public.stop_doing_items(user_id, is_active, ui_order);

ALTER TABLE public.stop_doing_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'stop_doing_items'
      AND policyname = 'stop_doing_items_owner_all'
  ) THEN
    CREATE POLICY stop_doing_items_owner_all
      ON public.stop_doing_items
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- journal 上的两个对应字段：
--   pre_stop_doing_acknowledged_ids = 本笔确认勾选的全局条目 ID 列表
--   pre_stop_doing_ad_hoc           = 本笔补充的"这次特别要防的"
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_stop_doing_acknowledged_ids uuid[],
  ADD COLUMN IF NOT EXISTS pre_stop_doing_ad_hoc           text;
