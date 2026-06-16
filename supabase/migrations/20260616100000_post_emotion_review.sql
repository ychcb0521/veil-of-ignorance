-- 平仓评价新增「情绪侧复盘」模块：7 个心理动机字段 + 主石头标签数组
-- 设计意图：
--   现有 post_*  字段都偏"结构 / 路径 / 事实"层面，缺一个把"恐惧与贪婪"
--   命名出来的钩子。这一组字段补这块。
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_emo_disturbance       text,
  ADD COLUMN IF NOT EXISTS post_emo_first_reaction    text,
  ADD COLUMN IF NOT EXISTS post_emo_wanted            text,
  ADD COLUMN IF NOT EXISTS post_emo_feared            text,
  ADD COLUMN IF NOT EXISTS post_emo_excuse            text,
  ADD COLUMN IF NOT EXISTS post_emo_main_stone        text,
  ADD COLUMN IF NOT EXISTS post_emo_main_stone_tags   text[],
  ADD COLUMN IF NOT EXISTS post_emo_next_time_plan    text;

-- 给"主石头标签"做一个 GIN 索引，方便后续做"同一块石头反复出现"的体检。
CREATE INDEX IF NOT EXISTS idx_trade_journals_post_emo_main_stone_tags
  ON public.trade_journals USING GIN (post_emo_main_stone_tags);
