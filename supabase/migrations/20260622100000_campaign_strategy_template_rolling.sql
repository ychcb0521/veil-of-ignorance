-- 策略模板新增「滚仓」(rolling)：与「主仓 + 双对冲 + 镜像止盈」共用同一套 SOP / 评分 / Pure SOP。
-- 保留 main_only（兼容已有历史战役；仅从新建下拉里移除，不再新建）。
ALTER TABLE public.trade_campaigns DROP CONSTRAINT IF EXISTS trade_campaigns_strategy_template_check;
ALTER TABLE public.trade_campaigns ADD CONSTRAINT trade_campaigns_strategy_template_check
  CHECK (strategy_template IN ('main_dual_hedge_mirror_tp', 'main_only', 'rolling', 'custom'));

NOTIFY pgrst, 'reload schema';
