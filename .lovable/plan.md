## 批次 1：错题集数据层（DB + RLS + 类型 + API）

本批次只动后端 schema 与前端数据访问层，不改任何 UI。完成后界面无变化。

### 步骤 1 — 数据库迁移（通过 Lovable Cloud migration 工具一次性提交）

创建 5 张表 + 1 张已有 profiles 不动：

1. **`error_tag_categories`**（全局字典，只读）
   - 字段：`id, code unique, name_zh, description, color, sort_order, is_special, created_at`
   - RLS：开启；策略仅允许 `authenticated` 角色 SELECT，不创建 INSERT/UPDATE/DELETE 策略 → 等价于禁止写

2. **`error_tag_patterns`**（用户私有，第二层标签）
   - 字段含 `user_id, category_id, pattern_name, operational_definition, parent_id, occurrence_count, last_seen_at, is_archived, timestamps`
   - 约束 `CHECK (length(operational_definition) >= 10)`
   - 索引 `(user_id, category_id)`、`(user_id, is_archived)`
   - RLS：4 条策略 `auth.uid() = user_id`

3. **`trade_journals`**（双时点日记，pre 快照 + post 复盘）
   - 完整字段按规格，包含 `pre_*`、`post_*`、`reason_was_rewritten`
   - `direction` check `('long','short','no_entry')`
   - `pre_mental_state` check 1–5
   - `post_outcome` check `('win','loss','breakeven','no_entry')`
   - 索引 `(user_id, pre_simulated_time desc)`、`(user_id, post_outcome)`、`(user_id, symbol)`
   - RLS：4 条 `auth.uid() = user_id`

4. **`journal_tag_assignments`**（journal ↔ pattern 多对多）
   - 含 `tagged_phase check ('pre','post')`、`UNIQUE (journal_id, pattern_id, tagged_phase)`
   - 索引 `(user_id, pattern_id, created_at desc)`
   - RLS：4 条 `auth.uid() = user_id`

5. **`trading_rules`**（错题集生成的规则）
   - 含 `source_pattern_id`（外键 ON DELETE SET NULL）、`is_active, added_to_checklist, trigger_threshold`
   - RLS：4 条 `auth.uid() = user_id`

### 步骤 2 — 触发器

- **`tg_update_pattern_stats`**：AFTER INSERT/DELETE on `journal_tag_assignments`
  - INSERT：`occurrence_count + 1`，`last_seen_at = now()`
  - DELETE：`occurrence_count - 1`（不下溢到负）
- **`tg_update_journal_updated_at`**：BEFORE UPDATE on `trade_journals` 刷新 `updated_at`
- **`tg_detect_reason_rewrite`**：BEFORE UPDATE on `trade_journals`
  - 若 `NEW.pre_entry_reason IS DISTINCT FROM OLD.pre_entry_reason` → `NEW.reason_was_rewritten := true`
  - 若 `OLD.reason_was_rewritten = true AND NEW.reason_was_rewritten = false` → 强制 `NEW.reason_was_rewritten := true`（不可回退）

### 步骤 3 — 初始化字典数据

同一迁移内 `INSERT INTO error_tag_categories` 6 条（entry_reason / hedge_stop / exit_reason / mental_state / no_entry_missed / checklist_violation），含中文名、可操作定义、颜色、排序、`is_special`。用 `ON CONFLICT (code) DO NOTHING` 保证幂等。

### 步骤 4 — 前端类型 `src/types/journal.ts`

与自动生成的 `supabase/types.ts` 保持 **snake_case** 一致（项目现有风格）。导出：

- `ErrorTagCategory`、`ErrorTagPattern`、`TradeJournal`、`JournalTagAssignment`、`TradingRule`
- 常量 `ERROR_CATEGORY_CODES`（联合类型 + 数组）
- 常量 `MENTAL_STATE_LABELS: Record<1|2|3|4|5, string>`

不引用 `Database` 泛型（避免在 types.ts 刷新前出现类型缺失），用纯接口声明。

### 步骤 5 — 数据访问层 `src/lib/journalApi.ts`

按规格封装全部函数，使用 `import { supabase } from "@/integrations/supabase/client"`。
- 统一 `try/catch`，错误抛出中文消息（如：`抛出 new Error("加载错题分类失败：" + err.message)`)
- `listJournals` 支持 `symbol / outcome / patternId / dateRange` 可选过滤；`patternId` 过滤通过 `journal_tag_assignments` 内连接实现
- `assignTag` 使用 upsert 防重复；`createJournalPreSnapshot` 强制 `pre_real_time = now()`
- 所有写函数 `.select().single()` 返回新行

### 步骤 6 — 守卫

- 不动 `supabase/client.ts`、`supabase/types.ts`、`.env`
- 不动 `TradingContext.tsx`、`Index.tsx`、`OrderPanel.tsx`、`useTimeSimulator.ts`、`CandlestickChart.tsx`、`PositionPanel.tsx`
- 不引入 `user_roles`，RLS 全部用 `auth.uid()`

### 步骤 7 — 验收

迁移成功 + supabase linter 通过 + 类型/API 文件可编译 + 预览页面表现无变化。

### 技术细节

- 所有 timestamp 字段用 `timestamptz`
- `gen_random_uuid()` 作为主键默认值
- `error_tag_categories` 仅赋予 SELECT 策略，等价禁写（不需要显式 deny）
- `tg_detect_reason_rewrite` 用 plpgsql + `SET search_path = public`
- 触发器函数全部 `SECURITY DEFINER` 并设 `search_path` 避免 search_path 警告
- snake_case 与现有 `Profile` interface 风格一致（如 `user_id`、`initial_capital`）

执行顺序：先调 `supabase--migration` 一次性提交 schema + RLS + 触发器 + 字典初始化；待用户批准并刷新 types 后，并行创建 `src/types/journal.ts` 与 `src/lib/journalApi.ts`。