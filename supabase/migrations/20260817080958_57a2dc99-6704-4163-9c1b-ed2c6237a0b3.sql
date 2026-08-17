-- =============================================================================
-- user_sim_state —— 模拟交易引擎状态的账号云端存档
-- =============================================================================
-- WHY
--   持仓、成交历史、挂单、余额、各币时间线、杠杆设置、信号库等引擎状态此前
--   只存在浏览器 localStorage，换浏览器 / 换电脑即全部丢失（账户资产由余额、
--   持仓、成交历史推导，因此一并丢失）。这张表按 (user_id, key) 存一份 jsonb
--   镜像：客户端写入后防抖推送，新环境登录时水化回本地。
--
-- SAFETY
--   幂等：表用 IF NOT EXISTS，策略先 DROP 再 CREATE，可安全重复执行；
--   不触碰任何既有表，不删除任何数据。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_sim_state (
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  key        text        NOT NULL,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sim_state TO authenticated;
GRANT ALL ON public.user_sim_state TO service_role;

ALTER TABLE public.user_sim_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own sim state"   ON public.user_sim_state;
DROP POLICY IF EXISTS "Users insert own sim state" ON public.user_sim_state;
DROP POLICY IF EXISTS "Users update own sim state" ON public.user_sim_state;
DROP POLICY IF EXISTS "Users delete own sim state" ON public.user_sim_state;

CREATE POLICY "Users read own sim state"
  ON public.user_sim_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own sim state"
  ON public.user_sim_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own sim state"
  ON public.user_sim_state FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own sim state"
  ON public.user_sim_state FOR DELETE USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';