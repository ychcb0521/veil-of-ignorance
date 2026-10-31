# 无知之幕迁移审计 — 第 1 阶段

阅读说明：第 1–12 节保留首阶段只读审计的历史记录；第 13 节记录后续经用户授权的实际迁移。当前状态以 MIGRATION_STATUS.md 为准。
审计日期：2026-10-31（Asia/Shanghai）。审计基线：`0b3e1cf27f2e56bd1edf18eb80f3e54084bbc5b7`，线上版本 456。分支：`migrate-off-lovable`。

本阶段目标是建立迁移清单、验证现有代码的本地构建，不迁移数据、不适配业务代码、不备份、不部署。报告未包含任何密钥、密码、连接串或用户记录内容。

## 1. 执行边界与证据等级

- 已经用户确认：创建独立迁移工作树和分支、生成报告、执行不会升级依赖的验证。安装若改变版本，先暂停并询问。
- 工作树：`/Users/a1/.codex/worktrees/migrate-off-lovable/veil-of-ignorance-main`。原主目录与原开发工作树没有作为写入目标。依赖是原有安装目录的独立副本，不是指向原目录的 symlink；npm 缓存也限定在本工作树的 `generated/migration-audit/npm-cache/`。
- 创建分支前已 `git fetch origin`；`origin/main` 与审计基线相同，无同期提交需要补审计。
- 本阶段不执行数据库 SQL、数据库 dump/restore、`supabase link`、迁移应用、Secret 修改、平台环境变量修改、发布、推送、tag、分支或源文件删除。
- 数据库对象清单是按仓库迁移文件顺序静态推导的声明状态，**不等于线上 `pg_catalog` 导出，也不是备份**。重复/条件 DDL 及平台外变更仍需后续真实 schema dump 核对。
- 平台证据仅来自已登录的 Lovable 数据库与 Storage 页面只读查看，没有打开或导出用户记录，没有读取 Secret 值。

## 2. 项目结构、框架和构建

| 项目 | 现状 |
| --- | --- |
| 前端 | React 18、Vite 5、TypeScript；SWC React 插件 |
| UI | Tailwind CSS、shadcn/ui、Radix、Recharts、klinecharts |
| 状态/数据 | React Context、TanStack React Query、Supabase JS；localStorage 和 IndexedDB |
| 开发 | `npm run dev` → `vite`，Vite 配置端口 8080 |
| 生产构建 | `npm run build` → `vite build`；脚本本身不运行 TypeScript 类型检查 |
| 开发模式构建 | `npm run build:dev` → `vite build --mode development` |
| 预览 | `npm run preview` → `vite preview` |
| 输出目录 | 未覆盖 Vite 默认值，`dist/` |
| 路由 | React Router 6 的 `BrowserRouter` + `Routes`，懒加载页面；SPA，没有 SSR 服务 |
| Vercel | 当前没有 `vercel.json`；独立托管需为 SPA 深层路径配置到 `/index.html` 的 rewrite，届时还要兼顾 MCP/函数路径 |
| 测试 | Vitest + Testing Library；Playwright 配置依赖未安装的 Lovable 测试包，本阶段未运行全量测试或浏览器测试 |

### 2.1 目录概览

| 路径 | 内容 |
| --- | --- |
| `src/main.tsx`、`src/App.tsx` | 启动、Provider、登录/初始化守卫、SPA 路由 |
| `src/pages/` | 回放交易、复盘/战役、情绪日记、Deep dig、认知/执行资产及帮助页面 |
| `src/components/` | 图表、模拟订单、仓位、渔与鱼质量、战役 Legs、导出及研究界面 |
| `src/contexts/`、`src/hooks/` | 账户、模拟交易、主题及数据加载/同步 |
| `src/lib/` | 交易计算、结算、对冲、镜像止盈、指标、Deep RSA/Deep dig、行情、持久化、导出 |
| `src/lib/mcp/` | MCP 入口和 5 个只读工具 |
| `src/integrations/supabase/` | 客户端、自动生成类型、Lovable 预览认证桥接 |
| `src/data/` | Binance 杠杆档位/交易过滤器等数据快照 |
| `public/`、`index.html` | 静态入口、favicon、robots、分享元信息 |
| `supabase/migrations/` | 59 个历史 SQL 迁移文件 |
| `supabase/functions/` | MCP 与公开行情代理两个 Edge Functions |
| `supabase/manual_remote_schema_sync.sql` | 额外手工同步脚本；不能视为自动应用记录，也不得直接重放 |
| `drizzle/`、`drizzle.config.ts` | 另一套历史迁移工具文件；schema.ts 目前是空占位，不能据此重建整库 |
| `.lovable/` | 历史计划及 MCP 发现清单 |
| `scripts/` | 两个 Binance 元数据更新脚本；本阶段未执行 |
| `docs/` | 指标、渔、Deep RSA/Deep dig 说明 |
| `generated/` | 已被 gitignore 排除的本机产物；本阶段脱敏验证日志放在这里 |

核对了仓库文件目录、配置、全部 Supabase 迁移、两个 Edge Functions、MCP 来源和 SDK 相关执行路径，并检索运行代码中的环境变量、Lovable/外部域名、数据访问和本地存储。未逐一执行所有组件或全部测试，因此不声称全功能回归通过。

### 2.2 现有路由

`/`、`/journal`、`/journal/tags`、`/journal/rules`、`/journal/deep-dig`、`/journal/deep-dig/:feature`、`/journal/insights`、`/journal/emotion-diary`、`/journal/campaigns`、`/journal/campaigns/classify`、`/journal/campaigns/:id`、`/journal/:id`、`/execution-assets`、`/cognitive-assets`、`/guide`，以及 MCP 授权页 `/.lovable/oauth/consent`。旧入口 `/journal/deep-rsa` 重定向到 Deep dig；登录和未初始化状态由守卫处理，未知路由显示 NotFound。

## 3. 后端归属：B — Lovable Cloud

依据：

1. `.env` 中 `VITE_SUPABASE_PROJECT_ID` 和 `VITE_SUPABASE_URL` 与 `supabase/config.toml` 的 project_id 一致；仅比较一致性，不在报告中写出值或地址。
2. `SETUP_云端存档.md` 明确记录这是 Lovable Cloud 管理的实例，不在用户自己的 Supabase 组织内；`.lovable/plan.md` 记录了通过 Cloud migration 工具建表的流程。这些是历史记录，不作为新的执行指令。
3. 本次只读查看 Lovable 的 Database 页面，存在内置业务表管理列表；Storage 页面显示 `No buckets yet`。该界面与官方对 Lovable Cloud 的识别方式一致。
4. 仅凭 `supabase.co` 形式的地址并不能区分 A/B；这里结合仓库明确记录和平台界面判定。

所以后续若彻底脱离 Lovable，需要迁移后端到用户自己的项目，而不只是把同一前端推到 Vercel。原平台的直接数据库凭证及 Auth/Storage 导出能力尚未取得或验证；不能假定标准 CLI dump 可以直接连通原 Cloud 实例。

## 4. Lovable 关联依赖、调用与资源

| 关联项与位置 | 当前用途 | 独立部署影响 / 是否需要处理 |
| --- | --- | --- |
| `@lovable.dev/mcp-js`；`vite.config.ts`、`src/lib/mcp/**`、`supabase/functions/mcp/index.ts` | 当前安装 0.22.0；Vite 插件生成 MCP 函数，SDK 提供协议、OAuth 校验和工具定义 | **不能直接卸载**，否则损失现有 MCP 功能；需在后续阶段明确独立运行边界，保留 5 个工具的输入输出及 RLS 权限 |
| SDK `https://api.lovable.dev/v1/app-mcp-usage` | MCP 使用统计上报，不是模型调用或 AI 网关 | SDK 默认启用 metrics；读取 `LOVABLE_API_KEY`。没有该 key 时跳过上报并记录警告，工具逻辑不是因此必然失效；彻底独立时应明确关闭或替换统计能力，需另行批准必要适配 |
| SDK `LOVABLE_MCP_LOG_LEVEL` | 可选的 MCP 日志级别 | 非业务 Secret；可在独立环境自行配置，默认行为需记录 |
| `lovable-tagger` | package.json 的开发依赖，锁定文件中 1.1.13 | 当前 Vite 配置未引用；不是线上核心功能依赖，无需为了迁移擅自卸载或升级 |
| `drizzle.config.ts` 中 `LOVABLE_DB_MIGRATION_URL` | Drizzle 数据库工具读取连接地址 | 不是前端环境变量，也不是 Edge Secret；原环境地址不可沿用到新库。后续需明确单一迁移流程，不能用空占位 schema 推送数据库 |
| `lovable-agent-playwright-config`；`playwright.config.ts`、`playwright-fixture.ts` | 平台浏览器测试配置 | 既未在 package.json 声明，也未安装；独立执行对应 Playwright 测试会缺包，不能声称本阶段验证了它 |
| `src/integrations/supabase/previewAuthStorage.ts` | 在特定 Lovable 预览 iframe 中通过 postMessage 共享认证 | 域名名单包括 lovableproject.com、lovableproject-dev.com、lovable.app、gpt-eng.com、gptengineer.run；编辑器来源包括 lovable.dev、gptengineer.app 和受限本机开发来源。独立普通域名现有逻辑自动退回 localStorage，不应无故重写 |
| `/.lovable/oauth/consent`；`src/App.tsx`、`src/pages/OAuthConsent.tsx` | Supabase OAuth 2.1 的 MCP 授权页 | 路径虽有 lovable 字样，功能直接调用 Supabase OAuth；须保留，并在新项目配置授权页及客户端，不能直接删路由 |
| `.lovable/mcp/manifest.json`、`src/lib/mcp/index.ts`、生成的 MCP 函数 | MCP 发现路径与由旧项目 ref 派生的 OAuth issuer | 新后端必须一致更新/重新生成；只改 Supabase 前端 URL 不足以迁移 MCP |
| `index.html` | Lovable 作者/描述/Twitter 元信息、外部 R2 分享截图、标识隐藏 CSS | 元信息一般不阻止应用运行；分享图仍依赖外部资源，若要完全独立需后续复制/配置，不能默默丢失 |
| `src/lib/lovableBadgeSuppression.ts`、`src/main.tsx` | 隐藏 Lovable 标识的 DOM 逻辑 | 无 Lovable 网络依赖，独立站通常无匹配元素；本阶段原样保留 |
| `README.md`、`.lovable/plan.md`、`SETUP_云端存档.md`、`docs/fish/exchanges.md`、Deep RSA 文档、构建戳注释 | 历史发布/配置说明，部分提示让用户去 Lovable 部署 | 不是运行时平台 API；新部署文档应说明新流程，历史文档本阶段不改、不删 |
| `src/lib/fish/adapters.ts` 的代理未部署提示 | 失败时提示在 Lovable 部署函数 | 函数地址取自 Supabase 环境变量，换项目后需部署同名函数；提示文案的必要调整留待后续批准 |

应用源码中未发现 `ai.gateway.lovable.dev` 或 `api.lovable.dev` 的直接模型调用，也没有发现需要用 OpenAI/Anthropic 替代的现有 Lovable AI 网关。**但 SDK 内部确实读取 `LOVABLE_API_KEY` 并有统计上报调用，不能据应用源码的零命中声称完全无 Lovable 调用。** 未查询线上 Secret 值或断言线上一定配置了此 key。

### 4.1 构建插件的写入行为

`mcpPlugin()` 会生成/更新 `supabase/functions/mcp/index.ts`，不是只写 dist；SDK 还包含清理被标记为自动生成的旧输出的分支。当前函数目录仅有预期 index.ts，输入入口存在。本阶段构建后必须比对原始 tracked 文件哈希；若生成了源码差异则停下审阅，不自动接受差异。

### 4.2 其他外部服务

Binance / Binance Vision、OKX、Gate、Bitget 提供公开行情；EmailJS 用于用户配置的通知。它们不是 Lovable 服务，迁移仍须验证新前端 Origin 的 CORS、行情代理与通知配置。`index.html` 的外部分享图是另一项静态资源依赖。图片/批量 PNG/ZIP 主要由浏览器 canvas/Blob 生成，仓库运行源码没有 Supabase Storage 调用，不能由此推断任何平台外历史文件一定不存在。

## 5. Edge Functions 与环境变量 / Secret 名称

### 5.1 函数清单

| 函数 | 文件 | 用途 | 直接读取的变量名称 |
| --- | --- | --- | --- |
| `fish-market-proxy` | `supabase/functions/fish-market-proxy/index.ts`、`handler.ts` | 对 OKX、Gate、Bitget 的固定公开行情路径做只读 GET 代理；OPTIONS/CORS；拒绝写请求、任意主机及非法参数 | 无 |
| `mcp` | `supabase/functions/mcp/index.ts`（来源 `src/lib/mcp/`） | 以已登录用户令牌和 RLS 读取资料 | `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` |

MCP 间接 SDK 变量：`LOVABLE_API_KEY`（可选统计鉴权）、`LOVABLE_MCP_LOG_LEVEL`（可选日志）。没有发现本项目 Edge 代码读取其他自定义 Secret 名称。这里列的是代码需求，不是线上 Secrets 完整配置清单。

`supabase/config.toml` 仅显式配置了 `fish-market-proxy` 的 `verify_jwt = false`；mcp 没有对应覆盖项，其内部 OAuth 定义要求 `authenticated` audience 和 OAuth client claim。新项目须验证网关认证与 SDK OAuth 兼容性，不得为方便迁移擅自弱化权限。

### 5.2 五个 MCP 工具

| 工具 | 数据 |
| --- | --- |
| `whoami` | 当前用户与 profile |
| `list_recent_journals` | 本人近期 trade_journals |
| `get_journal` | 指定 journal，受本人令牌/RLS 限制 |
| `list_trading_rules` | 本人 trading_rules |
| `list_error_patterns` | 本人 error_tag_patterns |

### 5.3 新 Supabase 环境的命名兼容风险

现有代码使用单数 `SUPABASE_PUBLISHABLE_KEY`。当前 Supabase 官方文档列出的默认注入是 `SUPABASE_PUBLISHABLE_KEYS` JSON 字典及 legacy `SUPABASE_ANON_KEY` 等，不能假定新项目必然提供相同的单数变量。需在后续适配阶段验证兼容方式；当前没有改名、设置 Secret 或改代码。Secret/数据库地址不能放入任何 `VITE_` 变量。

## 6. 数据库对象清单（迁移声明）

按 59 个迁移文件的文件名顺序静态合并对象创建、替换和移除记录：16 张业务表均有启用 RLS 的声明，63 个最终策略、6 个最终函数、14 个最终触发器。该结果未向线上数据库执行 SQL 验证。

### 6.1 表与策略数量

| 表 | RLS 声明 | 最终策略数 | 首次建表文件 |
| --- | --- | ---: | --- |
| `public.account_follows` | 启用 | 3 | `20260528090000_decision_record_principles.sql` |
| `public.campaign_counterfactuals` | 启用 | 5 | `20260525101000_campaign_counterfactuals.sql` |
| `public.cognitive_assets` | 启用 | 4 | `20260525170000_cognitive_assets.sql` |
| `public.decision_emotion_diaries` | 启用 | 4 | `20260725110000_decision_emotion_diaries.sql` |
| `public.error_tag_categories` | 启用 | 1 | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.error_tag_patterns` | 启用 | 4 | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.journal_tag_assignments` | 启用 | 4 | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.pain_log_entries` | 启用 | 4 | `20260529143000_dalio_meta_layer.sql` |
| `public.profiles` | 启用 | 3 | `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql` |
| `public.stop_doing_items` | 启用 | 1 | `20260616120000_stop_doing_list.sql` |
| `public.trade_campaign_comments` | 启用 | 4 | `20260528090000_decision_record_principles.sql` |
| `public.trade_campaigns` | 启用 | 9 | `20260524153000_trade_campaigns.sql` |
| `public.trade_journals` | 启用 | 5 | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.trade_principles` | 启用 | 4 | `20260529143000_dalio_meta_layer.sql` |
| `public.trading_rules` | 启用 | 4 | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.user_sim_state` | 启用 | 4 | `20260817080958_57a2dc99-6704-4163-9c1b-ed2c6237a0b3.sql` |

### 6.2 全部 RLS 策略

以下列出最终声明中的全部策略及条件。FOR DELETE 是既有权限声明，列出不代表本阶段执行删除。重复用途的不同策略名没有合并或优化；例如 trade_campaigns 的两组 owner 策略原样记录。

#### `public.account_follows`

- `Users see own follow edges`：`FOR SELECT USING (auth.uid() = follower_id OR auth.uid() = followee_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users insert own follow edges`：`FOR INSERT WITH CHECK (auth.uid() = follower_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users delete own follow edges`：`FOR DELETE USING (auth.uid() = follower_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.campaign_counterfactuals`

- `Users select own counterfactuals`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users insert own counterfactuals`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users update own counterfactuals`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users delete own counterfactuals`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Mutual followers select campaign counterfactuals`：`FOR SELECT USING ( auth.uid() = user_id OR EXISTS ( SELECT 1 FROM public.trade_campaigns c JOIN public.account_follows f1 ON f1.follower_id = auth.uid() AND f1.followee_id = c.user_id JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid() WHERE c.id = campaign_counterfactuals.campaign_id ) )`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.cognitive_assets`

- `Users select own cognitive assets`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users insert own cognitive assets`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users update own cognitive assets`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users delete own cognitive assets`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.decision_emotion_diaries`

- `Users select own emotion diaries`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260725110000_decision_emotion_diaries.sql`。
- `Users insert own emotion diaries`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260725110000_decision_emotion_diaries.sql`。
- `Users update own emotion diaries`：`FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`。来源 `20260725110000_decision_emotion_diaries.sql`。
- `Users delete own emotion diaries`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260725110000_decision_emotion_diaries.sql`。

#### `public.error_tag_categories`

- `Authenticated users can view categories`：`FOR SELECT TO authenticated USING (true)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。

#### `public.error_tag_patterns`

- `Users select own patterns`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users insert own patterns`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users update own patterns`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users delete own patterns`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。

#### `public.journal_tag_assignments`

- `Users select own assignments`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users insert own assignments`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users update own assignments`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users delete own assignments`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。

#### `public.pain_log_entries`

- `Users select own pain entries`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users insert own pain entries`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users update own pain entries`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users delete own pain entries`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.profiles`

- `Users can view their own profile`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql`。
- `Users can update their own profile`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql`。
- `Users can insert their own profile`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql`。

#### `public.stop_doing_items`

- `stop_doing_items_owner_all`：`FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.trade_campaign_comments`

- `Mutual participants select campaign comments`：`FOR SELECT USING ( user_id = auth.uid() OR EXISTS ( SELECT 1 FROM public.trade_campaigns c WHERE c.id = trade_campaign_comments.campaign_id AND (c.user_id = auth.uid() OR EXISTS ( SELECT 1 FROM public.account_follows f1 JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid() WHERE f1.follower_id = auth.uid() AND f1.followee_id = c.user_id )) ) )`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Mutual participants insert campaign comments`：`FOR INSERT WITH CHECK ( user_id = auth.uid() AND EXISTS ( SELECT 1 FROM public.trade_campaigns c WHERE c.id = campaign_id AND (c.user_id = auth.uid() OR EXISTS ( SELECT 1 FROM public.account_follows f1 JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid() WHERE f1.follower_id = auth.uid() AND f1.followee_id = c.user_id )) ) )`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users update own campaign comments`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users delete own campaign comments`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.trade_campaigns`

- `trade_campaigns_user_select`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260525213000_batch21_emergency_backfill_support.sql`。
- `trade_campaigns_user_insert`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260525213000_batch21_emergency_backfill_support.sql`。
- `trade_campaigns_user_update`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260525213000_batch21_emergency_backfill_support.sql`。
- `trade_campaigns_user_delete`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260525213000_batch21_emergency_backfill_support.sql`。
- `Users select own campaigns`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users insert own campaigns`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users update own campaigns`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users delete own campaigns`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Mutual followers select campaigns`：`FOR SELECT USING ( auth.uid() = user_id OR ( deleted_at IS NULL AND EXISTS ( SELECT 1 FROM public.account_follows f1 JOIN public.account_follows f2 ON f2.follower_id = user_id AND f2.followee_id = auth.uid() WHERE f1.follower_id = auth.uid() AND f1.followee_id = user_id ) ) )`。来源 `20260717150000_trade_campaign_soft_delete.sql`。

#### `public.trade_journals`

- `Users select own journals`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users insert own journals`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users update own journals`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users delete own journals`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Mutual followers select campaign journals`：`FOR SELECT USING ( auth.uid() = user_id OR EXISTS ( SELECT 1 FROM public.trade_campaigns c JOIN public.account_follows f1 ON f1.follower_id = auth.uid() AND f1.followee_id = c.user_id JOIN public.account_follows f2 ON f2.follower_id = c.user_id AND f2.followee_id = auth.uid() WHERE c.id = trade_journals.campaign_id ) )`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.trade_principles`

- `Users select own principles`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users insert own principles`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users update own principles`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。
- `Users delete own principles`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql`。

#### `public.trading_rules`

- `Users select own rules`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users insert own rules`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users update own rules`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。
- `Users delete own rules`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql`。

#### `public.user_sim_state`

- `Users read own sim state`：`FOR SELECT USING (auth.uid() = user_id)`。来源 `20260817090000_add_user_sim_state.sql`。
- `Users insert own sim state`：`FOR INSERT WITH CHECK (auth.uid() = user_id)`。来源 `20260817090000_add_user_sim_state.sql`。
- `Users update own sim state`：`FOR UPDATE USING (auth.uid() = user_id)`。来源 `20260817090000_add_user_sim_state.sql`。
- `Users delete own sim state`：`FOR DELETE USING (auth.uid() = user_id)`。来源 `20260817090000_add_user_sim_state.sql`。

### 6.3 数据库函数

| 函数 | 最后声明来源 |
| --- | --- |
| `public.handle_new_user()` | `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql` |
| `public.update_updated_at_column()` | `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql` |
| `public.fn_update_pattern_stats()` | `20260523032744_34bfce96-648a-437b-8676-5e06838507ff.sql` |
| `public.fn_detect_reason_rewrite()` | `20260523032744_34bfce96-648a-437b-8676-5e06838507ff.sql` |
| `public.fn_update_deep_analysis_completed_at()` | `20260523082441_f81a25ba-a689-4e1a-93a6-3c4efe119aef.sql` |
| `public.trg_rule_activation_stamp()` | `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql` |

历史上还创建过 `public.prune_campaign_counterfactuals()`；最后一个迁移 `20260918033000_persist_campaign_counterfactuals_until_deleted.sql` 声明移除该函数及其触发器，以保留用户历史反事实记录。不能复活旧清理函数。未来恢复要保留现有函数语义、SECURITY DEFINER / search_path、权限及触发器行为，不能只复制表数据。

### 6.4 全部最终触发器

| 表 | 触发器 | 时机与函数 | 最后声明来源 |
| --- | --- | --- | --- |
| `auth.users` | `on_auth_user_created` | `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()` | `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql` |
| `public.profiles` | `update_profiles_updated_at` | `BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql` |
| `public.journal_tag_assignments` | `tg_update_pattern_stats` | `AFTER INSERT OR DELETE ON public.journal_tag_assignments FOR EACH ROW EXECUTE FUNCTION public.fn_update_pattern_stats()` | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.trade_journals` | `tg_update_journal_updated_at` | `BEFORE UPDATE ON public.trade_journals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.trade_journals` | `tg_detect_reason_rewrite` | `BEFORE UPDATE ON public.trade_journals FOR EACH ROW EXECUTE FUNCTION public.fn_detect_reason_rewrite()` | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.error_tag_patterns` | `tg_update_pattern_updated_at` | `BEFORE UPDATE ON public.error_tag_patterns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.trading_rules` | `tg_update_rule_updated_at` | `BEFORE UPDATE ON public.trading_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` |
| `public.trade_journals` | `trg_deep_analysis_completed_at` | `BEFORE INSERT OR UPDATE ON public.trade_journals FOR EACH ROW EXECUTE FUNCTION public.fn_update_deep_analysis_completed_at()` | `20260523082441_f81a25ba-a689-4e1a-93a6-3c4efe119aef.sql` |
| `public.trade_campaigns` | `tg_update_trade_campaign_updated_at` | `BEFORE UPDATE ON public.trade_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql` |
| `public.cognitive_assets` | `tg_update_cognitive_assets_updated_at` | `BEFORE UPDATE ON public.cognitive_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql` |
| `public.trading_rules` | `trg_rule_activation_stamp` | `BEFORE INSERT OR UPDATE ON public.trading_rules FOR EACH ROW EXECUTE FUNCTION public.trg_rule_activation_stamp()` | `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql` |
| `public.trade_campaign_comments` | `tg_update_trade_campaign_comments_updated_at` | `BEFORE UPDATE ON public.trade_campaign_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql` |
| `public.trade_principles` | `tg_update_trade_principles_updated_at` | `BEFORE UPDATE ON public.trade_principles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql` |
| `public.decision_emotion_diaries` | `update_decision_emotion_diaries_updated_at` | `BEFORE UPDATE ON public.decision_emotion_diaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` | `20260725110000_decision_emotion_diaries.sql` |

历史上创建、后声明移除的 `tg_prune_campaign_counterfactuals` 不在最终触发器清单内。

### 6.5 Storage 与平台管理对象

- 59 个 Supabase 迁移文件未发现 `storage.buckets` 的 bucket 创建/插入声明，也未发现 `storage.objects` 策略。
- 本次 Lovable Storage 页面显示 `No buckets yet`。这表示页面目前没有列出 bucket；不是经 Storage API 全量分页校验过的清单。
- 运行源码未发现 `supabase.storage`、`.storage.from` 或 `/storage/v1` 调用。
- Auth 用户、身份、OAuth 客户端/授权配置、平台默认 schema/角色/扩展、Secrets、SMTP、数据库实时配置均不能由 16 张 public 业务表清单代表。后续必须单独核对。
- 迁移扫描没有发现 CREATE VIEW / MATERIALIZED VIEW、CREATE EXTENSION 或 ALTER PUBLICATION 声明；不代表线上没有平台自带或人工创建的对象。

### 6.6 迁移文件完整目录

这些文件是证据和历史，不是获准执行的计划。不能在新库或旧库直接整批应用，尤其不能在已经恢复的数据上重跑。

- `20260330070838_6622d4d8-708d-4064-a79b-9510c86d34de.sql`
- `20260523032718_73420f39-bc22-4c59-9c4d-397549b3a1f9.sql` — 含既有数据 UPDATE 或函数体
- `20260523032744_34bfce96-648a-437b-8676-5e06838507ff.sql` — 含既有数据 UPDATE 或函数体
- `20260523034520_562c23c4-795a-4377-9dbc-c9ac286759dc.sql`
- `20260523074852_0620b22e-e1cb-46f4-b968-b24d18fafe93.sql`
- `20260523082441_f81a25ba-a689-4e1a-93a6-3c4efe119aef.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260524093631_953c66c7-1628-40d3-a0de-f020fea27f86.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260524153000_trade_campaigns.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260525101000_campaign_counterfactuals.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260525170000_cognitive_assets.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260525193000_cognitive_assets_jsonb.sql` — 含既有数据 UPDATE 或函数体
- `20260525213000_batch21_emergency_backfill_support.sql` — 含 DROP / DELETE 等历史语句或函数体；含既有数据 UPDATE 或函数体
- `20260526120000_rule_activation_cooldown.sql` — 含 DROP / DELETE 等历史语句或函数体；含既有数据 UPDATE 或函数体
- `20260526180000_decision_quality_fields.sql`
- `20260527000000_post_real_close_time.sql`
- `20260528090000_decision_record_principles.sql` — 含 DROP / DELETE 等历史语句或函数体；含既有数据 UPDATE 或函数体
- `20260529143000_dalio_meta_layer.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260530030000_confidence_calibration_snapshot_fields.sql`
- `20260530043000_snapshot_v2_slim_fields.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260530120000_expand_emotion_tags.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260531090000_munger_layer.sql`
- `20260601090000_replace_emotion_tags.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260602090000_expand_emotion_tags_v3.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260603090000_batch25_hedge_snapshot.sql`
- `20260603103000_batch25_hedge_down_branches.sql`
- `20260603123000_main_odds_structure.sql`
- `20260604090000_main_odds_review_layer.sql`
- `20260605090000_main_market_structure_layer.sql`
- `20260606090000_add_pre_cheap_opportunity.sql`
- `20260606100000_add_missed_high_odds_state.sql`
- `20260606170000_post_path_agency_review.sql`
- `20260607090000_fix_pre_odds_structure_check.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260616100000_post_emotion_review.sql`
- `20260616120000_stop_doing_list.sql`
- `20260616140000_post_path_mode_and_agency_score.sql`
- `20260617080000_safety_net_align_trade_journals.sql`
- `20260617143000_campaign_add_roles_and_schema_reload.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260617170000_trade_campaign_importance.sql`
- `20260618030558_75a5a6a1-76d8-4377-b5d2-53166f1ca610.sql` — 含 DROP / DELETE 等历史语句或函数体；含既有数据 UPDATE 或函数体
- `20260620090000_campaign_deviation_notes.sql`
- `20260622100000_campaign_strategy_template_rolling.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260622170000_trade_journal_settlement_fields.sql`
- `20260707090000_post_entry_basis_reviews.sql`
- `20260707100000_trade_campaign_unique_codes.sql` — 含既有数据 UPDATE 或函数体
- `20260711000000_trade_journal_objective_operation_time.sql` — 含既有数据 UPDATE 或函数体
- `20260717150000_trade_campaign_soft_delete.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260717173000_recover_deleted_campaigns_after_20260715.sql` — 含既有数据 UPDATE 或函数体
- `20260719160000_opportunity_quality_fields.sql`
- `20260725110000_decision_emotion_diaries.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260725190000_expand_post_small_position_drag_constraint.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260726103000_emotion_diary_poms_panas.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260726120000_post_every_ball_pct.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260728113000_fix_poms_cn40_reverse_scoring.sql` — 含既有数据 UPDATE 或函数体
- `20260728160000_split_post_decision_quality_by_phase.sql` — 含 DROP / DELETE 等历史语句或函数体；含既有数据 UPDATE 或函数体
- `20260729090000_add_emotion_diary_pi7.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260802143000_add_post_exit_nature.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260817080958_57a2dc99-6704-4163-9c1b-ed2c6237a0b3.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260817090000_add_user_sim_state.sql` — 含 DROP / DELETE 等历史语句或函数体
- `20260918033000_persist_campaign_counterfactuals_until_deleted.sql` — 含 DROP / DELETE 等历史语句或函数体

此外存在 `supabase/manual_remote_schema_sync.sql` 以及 `drizzle/migrations/0000_create_decision_emotion_diaries.sql`。Drizzle 的迁移与 Supabase 情绪日记迁移存在内容重叠；其元数据不等于完整 Supabase 迁移记录。本阶段没有应用任何一套 SQL。

## 7. 前端全部配置环境变量

| 名称 | 用途与位置 | 独立部署配置 |
| --- | --- | --- |
| `VITE_SUPABASE_PROJECT_ID` | MCP OAuth issuer 的构建期项目标识；`src/lib/mcp/index.ts` | 后续由用户在 Vercel 后台填写；本阶段未改 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 前端 Supabase publishable key，必须配合 RLS；`src/integrations/supabase/client.ts` | 后续由用户在 Vercel 后台填写；本阶段未改 |
| `VITE_SUPABASE_URL` | Supabase 客户端地址与渔行情代理地址；`src/integrations/supabase/client.ts`, `src/lib/fish/adapters.ts` | 后续由用户在 Vercel 后台填写；本阶段未改 |

上述三个名称都在已跟踪 `.env` 中声明；报告不记录值。项目没有 `.env.local`，`.gitignore` 已通过 `*.local` 排除它。现有 `.env` 不能被静默删除或改写。Vite 的 `VITE_` 值在构建期进入产物，Vercel 修改环境变量后需要重建，并非浏览器运行时动态读取。

`src/lib/mcp/tools/**` 中的 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 虽位于 src，实际在服务端工具执行，不属于应暴露给浏览器的前端变量。`LOVABLE_DB_MIGRATION_URL` 仅是 Drizzle 工具环境变量。测试专用 `ATI6H_EXAMPLE_PATH`、`CTBA_REAL_INPUT`、`CTBA_REAL_OUTPUT`、`MBI_REAL_INPUT`、`MBI_REAL_OUTPUT`、`TZ` 不属于生产前端配置，也不需要设置到 Vercel。

## 8. 安装预检与构建验证

### 8.1 安装：按要求暂停，没有执行 npm install

package.json 与 package-lock.json 的根声明不一致：

| 依赖 | package.json | lock 根声明 | lock 实际版本 | 当前已安装版本 |
| --- | --- | --- | --- | --- |
| `@lovable.dev/mcp-js` | `^0.22.0` | 未记录/未安装 | 未记录/未安装 | `0.22.0` |
| `zod` | `^4.4.3` | `^3.25.76` | `3.25.76` | `4.4.3` |
| `drizzle-kit` | `0.x` | 未记录/未安装 | 未记录/未安装 | 未记录/未安装 |
| `drizzle-orm` | `0.x` | 未记录/未安装 | 未记录/未安装 | 未记录/未安装 |
| `postgres` | `^3.4.9` | 未记录/未安装 | 未记录/未安装 | 未记录/未安装 |

直接 npm install 需要重新解析这些范围并更新锁文件；不能保证不改变版本。尤其 Zod 的锁定是 3.25.76，而当前运行代码和已有安装使用 4.4.3。Drizzle 两个 0.x 范围及 Postgres 在现有安装里也不存在，没有可确认的原安装精确版本可照抄。

因此遵照用户要求暂停安装并等待决定，不运行 npm install / npm ci，不生成或修改任何锁文件，不为绕开问题擅自删包或升降级。现有 node_modules 副本只能用来验证当前代码构建，**不能证明全新 clone 后安装成功或 Vercel 干净构建可重复**。安装状态及具体差异另存本地 `generated/migration-audit/install-precheck.json`。

### 8.2 当前依赖隔离构建与类型检查

<!-- VALIDATION_START -->
| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| `npm install` | **暂停，未执行** | 安装前的静态预检已确定 manifest/lock 不一致；未经新确认不修锁、不升降级 |
| `npm run build` | **通过，退出码 0** | 使用当前已安装依赖的独立副本；命令总耗时 56.0 秒，Vite 输出 built in 48.97s |
| TypeScript | **通过，退出码 0** | `node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false`，耗时 115.68 秒，无错误输出 |
| 生产输出 | **生成成功** | dist/index.html 存在，dist 共 92 个文件；仅为本机验证，没有部署 |
| 原始 tracked 文件完整性 | **通过** | 逐一校验基线 1432 个文件的 SHA-256，变动 0、缺失 0；包含环境文件、锁文件和自动生成 MCP 函数 |
| 依赖隔离 | **通过** | node_modules 是当前安装的独立复制目录，不是指向受保护主目录的链接；未调用安装或版本更新 |

运行环境：Node `v24.14.0`、npm `11.9.0`。构建完成时间 `2026-10-31T13:45:14.843126+08:00`；类型检查完成时间 `2026-10-31T13:46:11.746604+08:00`（Asia/Shanghai）。

构建警告仅记录、不修复：qualityPostExit.ts 和 qualityEntry.ts 同时存在静态/动态导入，导致动态导入不会拆出独立 chunk；部分压缩后 JS chunk 大于 500 kB。构建没有因此失败，本阶段不做拆包或重构。

本机脱敏证据（均在已忽略的 generated/migration-audit/ 内，不包含备份数据，不会提交）：

- `build.log`、`build-result.json`：生产构建输出、退出码、工具版本与时间。
- `typecheck.log`、`typecheck-result.json`：类型检查输出与退出码。
- `install-precheck.json`：未执行安装的原因和版本差异。
- `inventory.json`：数据库对象/环境变量名称及迁移文件清单。
- `baseline-hashes.json`、`source-integrity.json`：原始文件完整性核对；只含文件名/哈希，不含配置值。

结论：当前代码在现有依赖版本下可构建且通过本次类型检查；**干净安装与 Vercel 干净构建可重复性尚未验证**。
<!-- VALIDATION_END -->

本阶段未验证：全新依赖安装、全量测试、线上业务流程、真实新 Supabase 连接、旧新数据行数/内容一致性、Auth 登录迁移、Storage 文件校验、新 Origin 的交易所 CORS、Edge Functions 部署与 OAuth 全链路。

## 9. 数据完整性与迁移风险

1. **原数据库归属 Cloud。** 不能用新建空库并改 URL 代替迁移，也不能凭仓库迁移重建用户数据。先取得可验证的原库导出与原 Auth 用户身份，再讨论恢复路径。
2. **历史迁移有破坏性与数据修正语句。** 包含移除约束/策略/触发器、旧反事实清理、情绪评分修正、恢复软删除、回填战役编号/时间等。现有最高原则禁止这些执行，本次仅读取和列证据。不得使用 db reset、force push 或整批重放来省步骤。
3. **备份范围需要覆盖 Auth 和权限。** public 表 dump 不等于 Auth 用户、身份、密码哈希、OAuth 客户端、SMTP、Secrets、角色和授权全部备齐。未来若使用 `--no-owner --no-acl`，仍要单独恢复/核对正确 GRANT 和 RLS，不能因忽略 ACL 而丢权限或扩大可见范围。
4. **用户 ID 不能重建。** public 业务记录和本地 owner 命名空间依赖原 auth.users UUID。新项目重新注册同邮箱不等价；旧 JWT、session 和外部 OAuth 授权不能假定可直接复用，用户可能需要重新登录/授权。
5. **浏览器数据有独立边界。** localStorage、IndexedDB 受 Origin 隔离，换 Vercel 域名后不能直接读取旧域名存储。user_sim_state 是模拟交易状态云端镜像，包含余额、仓位、成交、挂单、偏好、信号等；大数据还通过 idb: 头行+分片保存。需要核对完整头/分片、rev 及仍未同步到云端的数据，不以表行数相同代表分片完整。
6. **IndexedDB/本地镜像不能一概当缓存丢弃。** 代码存在 veil-fish-quality-v1、veil-fish-mining-library-v1、veil-fish-library-v1、veil-fish-session-v1、veil-fish-reconstruction-v1、veil-fish-library-collections-v1、veil-deep-dig、veil-campaign-read-cache、veil-account-sync-v1、veil-prs6h-state-v1、veil-avg-highlight-v1 等存储。部分经过账号分片同步，部分是研究明细、状态检查点或缓存；目前未逐库验证旧浏览器与云端一致性，也未授权清理。
7. **不要运行旧、新站造成分叉写入。** 后续切换需要明确写入停止点和数据快照边界；不能拿不同时间的行数对比来宣称一致，也不能让旧库/新库并行写后互相覆盖。当前旧站和 Cloud 保持原样，未实施切换。
8. **MCP 需要完整保留。** 除前端三个变量外，还要处理 issuer、Supabase OAuth server、授权页、客户端重新授权、函数网关、服务端 key 命名，以及 Lovable SDK 统计调用；不许直接去掉 SDK 让构建过关。
9. **依赖锁定阻塞可重复安装。** 这是迁移前已存在的问题。未授权升级、补齐或降级，报告不得把当前依赖构建成功描述为干净安装通过。
10. **独立部署配置尚未实施。** SPA rewrite、Vercel 构建设置/变量、Supabase URL Configuration、新函数部署、域名/邮件、分享图以及 EmailJS、交易所公开数据均需在后续阶段配置与验证。
11. **本次没有数据库或文件备份。** 没打 pre-migration-backup tag，没有备份脚本或 backups 目录，也没有下载数据库、Auth 或 Storage 文件。阶段 2 尚未授权。
12. **平台与代码可能有漂移。** 静态对象清单没有覆盖线上人工改动、Cloud 内部对象或仓库之外的文件/Secret；后续实际导出清单、每表行数与关键字段/内容校验，才可成为迁移验收证据。构建通过不证明交易计算、Legs、镜像止盈或所有导出功能在新环境已验收。

## 10. 本阶段改动与还原

| 项目 | 改了什么 | 为什么 | 怎么还原 |
| --- | --- | --- | --- |
| 迁移工作树与 migrate-off-lovable 分支 | 从已 fetch 的 origin/main 基线创建独立分支/工作树 | 隔离主目录及其他未提交研究数据 | 无需修改原工作树；继续使用原分支/旧站即可。本任务禁止删除分支或文件，不提供清理命令 |
| MIGRATION_AUDIT.md | 新增此报告 | 留下检查依据、完整清单、风险与验证限制 | 文档不改变运行行为；未来如需撤销，另行审阅并批准，本阶段不执行删除或回退 |
| 本地忽略产物 | 在本工作树复制现有 node_modules；generated/migration-audit 下放日志/清单，构建生成 dist | 隔离依赖与 npm 缓存，留验证证据 | 都不提交、不部署，不影响原项目；当前不清理或删除文件 |
| 应用源码/计算/UI/数据库/配置/依赖声明及锁文件 | 不做修改；构建后验证逐文件哈希 | 遵守只迁移原则和阶段边界 | 不需要还原 |

未创建 vercel.json、.env.example、DEPLOY.md、VERIFY.md 或备份/上传脚本；这些属于后续阶段，未经继续授权不实施。未进入备份、迁移、部署或日常开发流程改造。

## 11. 下一步待用户决定

- npm install 暂停：是否允许先制定并确认缺失依赖的精确版本与锁文件修复方案？任何补锁、升降级都要单独批准；当前不做。
- 如要进入第 2 阶段，需用户明确说“继续”。本阶段结果不代表获得备份、打 tag、访问新数据库、配置密钥、部署或推送的授权。

## 12. 参考依据

仓库：package.json、package-lock.json、vite.config.ts、src/App.tsx、src/integrations/supabase/client.ts、src/lib/mcp/**、supabase/functions/**、supabase/config.toml、全部 supabase/migrations/*.sql、supabase/manual_remote_schema_sync.sql、drizzle 配置/历史迁移、SETUP_云端存档.md、.lovable/plan.md 与 .lovable/mcp/manifest.json。SDK 行为依据当前已安装 @lovable.dev/mcp-js 0.22.0 的 dist/stacks/supabase/vite.js、dist/stacks/supabase/index.js、dist/chunk-H37EB22A.js 和 dist/chunk-RK62EMPY.js，只读检查。

官方文档（本次已核对，2026-10-31）：

- [Supabase：识别 Lovable Cloud 与自有 Supabase 后端](https://supabase.com/kb/troubleshooting/identify-lovable-cloud-or-supabase-backend)
- [Lovable：部署、托管与所有权边界](https://docs.lovable.dev/tips-tricks/deployment-hosting-ownership)
- [Vercel：Vite SPA 深层路由 rewrite](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas)
- [Supabase：Edge Functions 环境变量与默认 Secrets](https://supabase.com/docs/guides/functions/secrets)


## 13. 连续迁移补充核对（2026-10-31）

用户已批准连续推进，原库保持不删除、不重置、不付费；依赖版本另行确认。随后用户已确认以既有 bun.lock 的完整精确版本为基线，所有包版本和完整性哈希保持不变，只替换 Lovable npm 缓存下载地址为公开 npm；Vercel 明确使用冻结安装，不再使用失配的 npm 锁文件。

补充检查发现 bun.lock 已记录 MCP 0.22.0、Zod 4.4.3、drizzle-kit 0.31.11、drizzle-orm 0.45.4、postgres 3.4.9。公开 npm 对这 5 项的完整性哈希与现有锁一致。第 8 节的 npm 安装阻塞仍是事实；此处选择沿用既有 Bun 锁，避免另行选择依赖版本。其余全部版本保持该锁原值，冻结安装失败时停止。

现已通过只读 SQL 验证实际库：16 张 public 表均启用 RLS，实际 59 条策略（静态清单中的 4 条 trade_campaigns_user_* 不在线上），Auth 账号 8 个。原库约 84 MB、PostgreSQL 17.6；导出前 Storage bucket/object 均为 0。实际数据基线优先于仓库迁移推导，绝不为凑静态清单重放旧迁移。

| 必要适配 | 原因 | 还原方式 |
| --- | --- | --- |
| bun.lock 仅替换下载地址；新增 .npmrc | 构建不再从 Lovable 包缓存下载；版本和完整性不变 | 采用原提交中的原锁配置；不得用安装/更新命令重解版本 |
| vercel.json | 固定 Bun 冻结安装、Vite 构建、dist 和 SPA rewrite | 新文件尚未部署到原站；原站无改动 |
| MCP metrics:false | 禁止 SDK 向 Lovable 发送使用统计，保留 5 个只读工具及 OAuth/RLS | 恢复此字段前须另行确认外部统计传输 |
| 5 个 MCP 工具的 publishable key 读取兼容 | 同时识别原单数变量、新 Supabase 默认 publishable JSON 字典与 legacy anon key；仍使用用户令牌执行 RLS | 恢复原单数变量读取；不涉及工具输入输出或交易算法 |
| 备份脚本、只读 SQL、离线行数比较脚本 | 生成可重复备份与核对材料，缺参数/缺工具时失败退出；不执行恢复或改库 | 均为新增工具，不影响应用运行；本任务不删除文件 |
| .gitignore 新增 backups/.vercel/supabase/.temp | 私有备份和部署元数据不得提交 | 保持原库与备份不变，不撤销隐私忽略规则 |

原库完整导出已获得用户关于 Cloud Storage、注册邮箱临时链接和本机私有下载的明确授权。只有下载完成并验证 archive/校验和、行数与账号范围后，才可以标记备份完成。当前尚未恢复新库或部署 Vercel。

### 13.1 干净构建与部署防误连验证

使用官方 npm 分发的隔离 Bun 1.4.4，在全新目录按现有 bun.lock 冻结安装成功：683 个包，锁文件保持不变，全部直接依赖与原锁一致。随后 npm run build、锁定 TypeScript 5.8.3 类型检查均通过。旧第 8 节描述的是首阶段历史限制，现已通过此冻结安装消除。

在尚未更换后端变量的相同构建条件下，新构建入口 assets/index-ZrLBkLbH.js 与线上 456 版逐字节 SHA-256 相同：b2eb9785ca1827e8b319396aa6af3f238975b7b63d14382b6b148d79a45fb127。此项证明依赖基线可重复，不代表新后端或整站已经验收。

新增 deployment-target.json 与部署环境检查脚本，在安装及构建前要求显式填写三个前端变量，并核对已记录的新 project-ref、URL 和仅限浏览器的 publishable/anon key。目标未创建时故意阻止独立发布，避免仓库旧 .env 让 Vercel 意外继续连接旧 Cloud。只影响独立流水线，不修改本地开发命令或应用逻辑；还原为原 Vite 构建配置即可撤销该部署检查。

index.html 的两个外部分享图片地址改为 public/social-preview.png，图片从原地址逐字节复制（69079 字节，SHA-256 fd65615ef7b3934ceda47549df7ead2e11b5188188b28b2054ba262045dba64f），避免独立站继续依赖原平台静态资源。界面、图片内容和计算均不变。恢复原提交两个 metadata 地址可撤销。

已新增 DEPLOY.md、VERIFY.md、MIGRATION_STATUS.md 和仅含空变量名的 .env.example，记录独立发布、验收及回滚；这些文档不是已经上线的声明。

### 13.2 实际对象和相关验证

实际 public 函数有 7 个、非内部触发器 14 个。额外保留的函数包括历史 prune_campaign_counterfactuals；静态迁移推导的 6 个函数不代表实际库最终目录。已通过只读 catalog 查询把实际函数、触发器、约束、授权及列信息保存在忽略提交的私有 backups 目录。此处仅读取定义，没有调用历史清理函数、执行历史 SQL 或修改原库。

65 项既有代理/持久化回归检查全部通过：fishExchanges 16、fishReliability 21、fishStocks 10、accountBlobSync 13、persistedStateStorage 5。部署环境检查使用虚构值验证 12 种允许/拒绝情形，全部符合预期。这些验证不替代恢复后数据和真实登录验收。

Vercel 控制台已确认用户的免费 Hobby 账号存在；新 Supabase 仍等待用户本人设置新数据库密码并提交创建。未恢复数据、未导入部署、未修改 main。

### 13.3 原生完整备份验证与新目标

已下载平台导出的 veil-of-ignorance_261031.backup.zip，原下载文件保留，私有副本在 backups/ 下且已被 Git 忽略。ZIP 27004687 字节；其中 custom archive 27004527 字节，SHA-256 为 8190c071c5d5e4c461ab3f2eadf60a2090dda6dd2a59caeb8c96e4dabc7be7ef。隔离的官方 PostgreSQL 客户端完成目录读取及全部 zstd 数据块解码，生成私有 SQL 49344071 字节，未执行该 SQL。

归档含 56 张表的数据部分，其中 public 16 张、auth 27 张；public 59 策略、7 函数、14 触发器与实际目录吻合。Auth 8 个账号均保留密码哈希，8 个 profiles 用户 ID 集合一致。user_sim_state 有 241 行；其中账号大块存档 8 个头行、44 个分片均通过 rev、完整性、gzip、JSON 与长度校验，共 488819247 个序列化字符。这证明该快照中的分片可用，不代表之后没有新增写入或所有浏览器本机缓存已转移。

新目标由用户本人创建并经控制台确认：elynuzxnvjzypjgzkemc，Free 组织、Singapore、Nano、Healthy。deployment-target.json 已记录此标识；原 .env、原 config.toml 项目关联尚未改动，防止误触原后端。当前尚未恢复新库或部署前端。用户随后要求由代理填写现有 key，已仅将浏览器 Publishable key 写入本机忽略提交的 .env.local，不打印值；数据库密码不能从平台回读，正等待用户在仅监听 127.0.0.1 的本机页提供。

托管 auth/storage/realtime 的内置迁移历史不能盲目覆盖新项目。恢复前还需比对目标结构与对象权限，保留实际自定义 auth.users 触发器；全部历史文件仍不重放。新旧最终写入边界和逐表/内容核对尚待完成。

### 13.4 新目标构建配置

supabase/config.toml 的 project_id、生成的 supabase/functions/mcp/index.ts OAuth issuer 和 .lovable/mcp/manifest.json issuer 均改为已验证的新 project-ref elynuzxnvjzypjgzkemc，避免命令误部署原项目或 OAuth 发现仍指向旧库。源码中的 issuer 仍由构建环境派生；五个工具和鉴权/RLS 语义保留。回退这些迁移分支配置到原提交可还原旧目标，切勿在回退后误执行新目标恢复或部署命令。

本迁移工作树原 node_modules 独立副本完整移至忽略提交的 generated/pre-frozen-node-modules-20261031，根目录改为引用同一工作树内已冻结安装的依赖目录。未删除原副本、未链接主目录依赖、未升级包。

### 13.5 新库恢复与逐字段验收

用户已提供现有新库密码，代理仅写入本机忽略提交的私有配置。连接使用后台实际提供的 Supabase Root 2021 CA，sslmode=verify-full；没有关闭证书或主机名校验。目标初始 public 表、Auth 用户及 Storage 均为空，PostgreSQL 17.11。

选择性恢复已在一个事务中提交：按新库实际外键顺序复制 Auth 数据，导入 public 结构和数据后创建约束/RLS/触发器，保留自定义 auth.users 注册触发器和原迁移记录。事务内 45 项表行数、16 个 RLS 表、59 条策略及账号关联检查通过。未写原库、未调用清理函数、未运行历史迁移、未清空或重置。

原库独有 sandbox_exec 为 Lovable 平台的 LOGIN/BYPASSRLS 角色，应用代码没有引用。新库没有创建该角色，也没有带入其 16 项 SELECT/INSERT 授权；其余 schema/default ACL 与原库一致。原 archive 和权限目录均保留，未删除源角色。另发现新平台默认 ACL 会额外授予新建 handle_new_user 函数 anon/authenticated 执行权，已仅在新库收回这两项，使该函数与原库一样仅为 postgres/service_role 执行范围。

已只读导出新库 45 张恢复表，用列名对齐后的 COPY 字段逐行 SHA-256 比对：全部相同，包括账号密码哈希和大块研究数据。源与目标 7 函数（含 ACL）、14 public 触发器、126 约束、59 RLS 和应用表授权均比对一致。连接器将策略 roles 返回 PostgreSQL 数组文本，新库 JSON 返回数组，已规范格式再比较。

逐表 56 项行数有 55 项一致。唯一差异 realtime.schema_migrations 旧 68 / 新 91，源版本全部包含在新库，新增 23 条由新平台管理。已按用户要求暂停并报告；用户明确批准保留新系统记录、只读核对通过后继续。未覆盖、删除或降级系统记录。完整对比表见 MIGRATION_ROW_COMPARISON.md。该验收对应备份快照，最终切换仍需增量核对。

Vercel 免费项目已创建；正式追踪分支已保存为 migrate-off-lovable，公开前端变量只含 3 个 VITE_SUPABASE 项，数据库密码没有配置进 Vercel。分配地址 https://veil-of-ignorance-ten.vercel.app/ 尚未完成首次正式部署。原站仍为回退入口；新库后续产生写入时不能直接以旧快照覆盖回滚。

### 13.6 函数、OAuth 与 Storage 工具

两个 Edge Functions 已在新项目部署。fish-market-proxy 三交易所 GET 均 200，非法路由/外部地址 400、POST 405、OPTIONS 204。mcp 发现文档 200，匿名与无效令牌均 401；五个只读工具的源码和逐用户 RLS 保留。

用户对 MCP 网关设置作了单独确认后，关闭 legacy JWT 网关（verify_jwt=false），由源码 SDK 验证 OAuth 签名、issuer/audience/client_id。新 OAuth Server、动态客户端注册已保存，授权路径 /.lovable/oauth/consent；Site URL 和两个重定向均为新正式站。发现文档指向新项目且 HTTP 200。还原方法是在另行审阅后调整平台 OAuth/网关及对应 config.toml；不能为排错绕过 SDK 身份检查。

新增 scripts/restore_storage.mjs，默认本地校验，--apply 才使用指定新项目服务端凭证。只向已匹配权限的 bucket 新增缺失文件，拒绝覆盖或删除，逐个验 SHA-256。原业务 Storage 文件为 0；导出后新增的私有数据库备份文件已按原 bucket/路径保存本机，并在 manifest 标为迁移产物、默认不上传到业务站。该工具不改变应用；保留不用即可。

用户已暂停旧站写入。最后一轮 user_sim_state 增量核对为 241 对 241 行，键集合一致，43 条约 31 MB 待增量合并。其他 15 张 public 表此前逐表摘要一致。完成前不把新站视为最终切换。

### 13.7 最终增量与正式构建准备

用户已明确回复“旧站已暂停”，后续只读元数据确认 241 行及各内容/时间戳保持稳定。43 条增量共 31,187,784 字节逐条保存、MD5/长度校验，未增加或移除任何键。原下载和快照继续保留，增量副本亦为私有且不提交。

在新项目单事务中，仅更新这 43 条现有 user_sim_state：写前验证旧值及时间戳未变化，事务内临时抑制触发器以保留原时间戳，写后恢复会话默认并校验所有新值/时间戳，任何失败回滚。于 2026-10-31 08:01:38 UTC 成功提交。未写原库，未删除记录，未改变持久化 schema 或触发器定义。还原不能丢弃新站后续写入；原备份与增量均保留，先审阅按键合并方案。

最后新旧 16 张 public 表行数与内容摘要全部一致，包括 campaign 467、journal 152、rules 61、profiles 8、状态 241。摘要比较按表名、行数和哈希，不把连接器 JSON 属性顺序视为数据差异。新库 8 个存档头、44 分片完整解压，rev、JSON 与 UTF-16 序列化长度全部通过。此前 45 张恢复表的全字段 SHA-256 及账号密码哈希验证继续保留。

最终本地生产构建再次通过（32.89 秒），依赖声明和锁版本没有后续变更；既有大分块警告保留、不重构。Storage 恢复 4 项本地保护检查通过：有效文件、坏哈希、路径穿越、错误目标；没有网络或云写入。备份工具补记 Content-Type/缓存头，恢复工具沿用，避免文件展示属性改变。

下一步由迁移分支的新提交触发 Vercel Production，尚需记录实际 Ready、commit、正式网址及登录/业务验收。此处不提前宣称上线完成。

### 13.8 Vercel 首次正式部署与 HTTP 验收

迁移提交 463838300df9888bb2984b6c5f9c91c16199ed66 已先 fetch 再推送，main 无同期新提交、未修改。Vercel 免费 Hobby 项目首次部署 9zqV4RuUSgZa3NeQeXV4re36V9s9 已 Ready / Production，域名 https://veil-of-ignorance-ten.vercel.app/ 已指向该部署。实际安装器 Bun 1.3.14 按现有锁冻结安装，前置目标检查通过；未升级应用依赖。

8 个正式页面路径均 HTTP 200 并返回 SPA，包含 Deep RSA 兼容路径和 OAuth 授权页。线上入口 /assets/index-DTaqvCO_.js 的 SHA-256 为 51b14427137a017f9b966f78d8263278720acf589ca8b1fecfbd9fc01a393e0c，与最终本地构建完全一致；新 project-ref 存在，旧 Cloud ref 不存在。16 张业务表使用公开 key 的匿名 GET 均返回 200/0 行，RLS 未泄露用户记录。

新站登录页已实际加载，正在等待用户用原应用账号登录；数据库密码不能替代应用登录密码。真实交易/复盘界面、浏览器本机数据、导出与新记录验收尚未写成通过。原站保持暂停以避免双写，原服务和备份继续保留。

### 13.9 追加资源与邮件边界核对

正式站 86 个 JavaScript/CSS 文件逐一下载并与最终本地构建 SHA-256 比对，全部一致。

新 Supabase Authentication → Emails → SMTP Settings 的自定义 SMTP 为关闭状态。根据 [Supabase 官方 SMTP 文档](https://supabase.com/docs/guides/auth/auth-smtp)，默认服务只向项目组织团队邮箱发信；普通用户注册验证、找回密码邮件不能据此验收通过。已有账号的密码登录不依赖 SMTP。已询问用户是否有现有 SMTP 服务，密码/密钥只在平台填写；未创建新凭据、未注册发信服务、未付费、未关闭邮箱确认。此项仍待补齐，不能宣称所有功能彻底迁移验收完成。

### 13.10 主要业务与认证最终验收

用户用原应用账号成功登录。实际恢复历史成交/仓位历史各 1507、资金流水 573、信号库 1073、鱼舱 33；战役完整加载后 344 场可见。ERA 示例的 3 条 Legs、2 条滚动对冲、K 线及情绪日记可显示；规则和 Deep Dig 可打开，Deep RSA 旧书签重定向正确，ATI/PRS 独立指标可用。渔为自动模式、每 1h，未改算法阈值。

普通登录用户通过界面保存 P_gap 折叠偏好，新库只读确认写入，刷新保持；随后恢复原值并再次从新库确认。没有为了测试制造交易、情绪或用户账号记录。

单张 PNG 确已下载，2355301 字节、5236×5218，PNG CRC 和视觉检查通过。浏览器下载事件监听超时不能代表下载失败，本次以实际文件作为验收依据。两场批量 ZIP 4395014 字节，含 2 张 PNG（5236×4716、5236×5398），解压和 CRC 通过，完整图表、Legs、中文文件名可用。私有图片与 ZIP 仅留本机忽略目录，未公开或提交。

用户未选择 Gmail，改用本人 163 邮箱，并亲自生成现有客户端授权码、明确要求代理填写。仅将其保存到新 Supabase SMTP（smtp.163.com / 465，发信人“无知之幕”），未保存到代码、报告或迁移配置。刷新确认 SMTP 已启用。向本人既有账号发送一次登录验证邮件，HTTP 200，用户确认收到，并亲自完成退出后通过邮件重新登录。未创建新账号、未关闭邮箱确认、未付费。网易网页被浏览器站点安全策略拒绝，未尝试绕过；授权码由用户本人在邮箱端生成。

自动化点击退出未能可靠读取结果，最终由用户亲自在新站确认退出及再次登录成功，没有据此修改认证或业务代码。

独立部署与数据迁移的主要验收已完成。完整日后清单仍按实际范围记录：跨账号人工检查、首次外部 MCP 客户端授权后的工具读取、新建真实交易记录没有假写成通过；数据库未来结构变更前仍须单独建立/审阅迁移历史基线，不能重放旧 SQL。

### 13.11 全账号差异复核与大型研究恢复

用户确认两站暂停后，已对全部 8 个账号及 16 张业务表复核，并明确确认 49 行具体原子合并。2026-10-31 10:54:40 UTC 提交成功，读回 49 行全部一致；新站 242→246 条状态，原有键缺失和计划外内容变化均为 0，9 个存档头的所有引用分片完整。按用户选择保留删除状态，旧站被删除标记遮蔽的研究仅另存独立恢复包。空列表恢复与工具栏修复的原因、验证、私有备份和还原边界见 MIGRATION_RECOVERY_AUDIT.md；不以云端字段一致代表所有浏览器未同步数据已全部核验。
