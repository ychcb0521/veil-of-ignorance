# 启用账号云端存档（一次性操作）

交易数据换浏览器/换电脑就丢失，是因为整个模拟交易引擎的状态只存在浏览器本地。
代码侧的同步已经就绪，但**云端还缺一张表**——建好之前，程序会自动降级为纯本地
模式（不会报错，但也不会同步）。

## 怎么做

1. 打开 <https://supabase.com/dashboard/project/pyvndfzpbsgzinqxairn/sql/new>
2. 把下面整段粘进去，点 **Run**
3. 看到 `Success` 即可

```sql
CREATE TABLE IF NOT EXISTS public.user_sim_state (
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  key        text        NOT NULL,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

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

这段可以重复执行，不会删任何数据，也不碰其他表。
（它同时已并入 `supabase/manual_remote_schema_sync.sql` 末尾，跑那个文件同样生效。）

## 执行之后

1. **先在有数据的那台电脑/浏览器上打开一次系统**——登录后会自动把本地已有的
   全部历史数据补推上云（持仓、成交历史、挂单、余额、各币时间线、杠杆设置、
   信号库、战役缓存等）。等十几秒，或切到别的标签页一次（切走会立即冲刷）。
2. 再去新电脑/新浏览器登录同一账号，进入交易页前会看到「同步账号数据」，
   完成后所有记录原样恢复。

## 怎么确认生效了

浏览器控制台执行：

```js
localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('_balance')))
```

或在 Supabase 后台 Table Editor 里打开 `user_sim_state`，应能看到若干行
（key 为 balance / trade_history / positions_map 等）。

若控制台出现 `[simStateSync] user_sim_state 表不存在`，说明 SQL 还没执行成功。
