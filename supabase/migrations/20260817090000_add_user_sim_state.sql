-- 模拟交易引擎状态的云端镜像。
--
-- 此前持仓、成交历史、挂单、余额、各币时间线、杠杆设置等全部只存在浏览器
-- localStorage（sim_<userId>_* 前缀），同一账号换浏览器即回到初始状态。
-- 这张 KV 表按 (user_id, key) 存一份 jsonb 镜像：写路径防抖推送，
-- 新环境启动时水化回 localStorage，账号数据从此跟人走、不跟浏览器走。
create table if not exists public.user_sim_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_sim_state enable row level security;

create policy "Users read own sim state"
  on public.user_sim_state for select
  using (auth.uid() = user_id);

create policy "Users insert own sim state"
  on public.user_sim_state for insert
  with check (auth.uid() = user_id);

create policy "Users update own sim state"
  on public.user_sim_state for update
  using (auth.uid() = user_id);

create policy "Users delete own sim state"
  on public.user_sim_state for delete
  using (auth.uid() = user_id);
