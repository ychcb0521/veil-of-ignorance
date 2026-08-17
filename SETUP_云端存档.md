# 启用账号云端存档（一次性操作）

交易数据换浏览器/换电脑就丢失，是因为整个模拟交易引擎的状态只存在浏览器本地。
代码侧的同步已经就绪，但**云端还缺一张表** `user_sim_state`——建好之前程序会
自动降级为纯本地模式（不报错，但也不同步）。

## 重要前提：后端由 Lovable Cloud 托管

本项目的 Supabase 项目是 `pyvndfzpbsgzinqxairn`，由 **Lovable Cloud 管理**
（见 `.lovable/plan.md`：「通过 Lovable Cloud migration 工具一次性提交」）。

因此：

- 它**不会**出现在你自己的 Supabase 组织里——那个组织显示「Create a project」
  是正常的，**不要在那里新建项目**，新项目是另一个空数据库，连上去等于把
  现有数据全部弃掉。
- 建表要走 Lovable，而不是自己的 Supabase 控制台。

## 怎么做（任选其一）

### 方式 A · 让 Lovable 应用迁移（推荐）

迁移文件已经在仓库里，且已推送到 GitHub：

```
supabase/migrations/20260817090000_add_user_sim_state.sql
```

在 Lovable 的对话框里说：

> 请应用 supabase/migrations/20260817090000_add_user_sim_state.sql 这个数据库迁移

如果它说找不到文件，就把下面整段 SQL 直接贴给它，让它执行。

### 方式 B · 从 Lovable 进入后端控制台

Lovable 项目页里有 Cloud / Backend 入口，从那里打开 Supabase 后台（会带上
正确的项目与权限），进 SQL Editor 粘贴执行同一段 SQL。

### 要执行的 SQL

```sql
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
```

可重复执行，不删任何数据，不碰其他表。
（同一段也已并入 `supabase/manual_remote_schema_sync.sql` 末尾。）

## 执行之后

1. **先在有数据的那台电脑/浏览器上打开一次系统**——登录后会自动把本地已有的
   全部历史数据补推上云（持仓、成交历史、挂单、余额、各币时间线、杠杆设置、
   信号库、战役缓存等）。等十几秒，或切到别的标签页一次（切走会立即冲刷）。
2. 再去新电脑/新浏览器登录同一账号，进入交易页前会看到「同步账号数据」，
   完成后所有记录原样恢复。

## 怎么确认生效了

浏览器控制台如果出现下面这行，说明表还没建成功：

```
[simStateSync] user_sim_state 表不存在，云端同步停用（退回纯本地存储）
```

没有这行、且 Supabase 的 `user_sim_state` 表里能看到若干行
（key 为 balance / trade_history / positions_map 等），即为成功。
