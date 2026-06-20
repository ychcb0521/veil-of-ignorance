-- 战役「SOP 偏离代价明细」的手填备注（违规阶段 / 违规描述 / 修正后），按「行键 → {category,reason,fix}」存一份 JSON。
-- 存到战役行上，使互关者也能读到本人写的备注：沿用 trade_campaigns 现有 SELECT 策略
-- （本人 + 互关者可读；只有本人可 UPDATE），因此无需新增任何 RLS 策略。
ALTER TABLE public.trade_campaigns
  ADD COLUMN IF NOT EXISTS deviation_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
