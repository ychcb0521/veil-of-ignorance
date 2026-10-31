# 无知之幕：独立部署与日常发布

本文件记录 Vercel + 用户自有 Supabase 的流程。当前完成状态以 MIGRATION_STATUS.md 和最终验证结果为准；文件存在不代表已经上线。原 Lovable 及原数据库在新站验收前保持不删除、不重置、不擅自付费。

当前正式地址：[https://veil-of-ignorance-ten.vercel.app/](https://veil-of-ignorance-ten.vercel.app/)。Vercel 已 Ready / Production，首次提交 46383830；生产分支为 `migrate-off-lovable`，不是 main。完整业务验收进度见 MIGRATION_STATUS.md。

## 1. 构建与版本基线

- React + Vite SPA，构建命令 npm run build，输出 dist/。
- 独立安装统一使用仓库现有 bun.lock，执行 bun install --frozen-lockfile。保留旧 npm 锁文件作为历史，不删除、不用于这条部署流水线；不要直接 npm install 重新解析版本。
- 现有精确锁定版本及完整性哈希保持不变；仅将 Lovable 包缓存下载地址换成公开 npm。全部直接依赖的实际安装版本已核对。
- 本机验证工具 Bun 1.4.4、Node 24；以生成日志记录实际版本。依赖升级不属于迁移，必须单独确认。

## 2. 新后端与备份

1. 先下载并验证原 Cloud 全库 .backup（自定义 PostgreSQL archive），包含业务数据和 Auth 用户；原 Storage 文件另行备份。导出可能先包装成 ZIP，必须保留原文件并核对校验和。
2. scripts/backup_supabase.sh 是有直接源连接时的只读方案，分别导出 schema/data/roles 并检查 Auth 数据。原 Cloud 没有提供连接串时，采用用户明确授权的原生完整导出，不要伪造连接信息或用公开 key 当数据库密码。
3. scripts/backup_storage.mjs 按原 bucket/路径下载文件、记录 SHA-256；缺少源服务凭证会在网络请求前停止。原始 Storage 初始为 0；平台为数据库导出新增的私有 bucket 属备份产物，不能误上传成公开业务文件。
4. 完整恢复以实际库和 archive 目录为准，不重放 supabase/migrations 的历史脚本。仓库静态推导与实际库存在 4 条历史重复策略的差异，实际库 59 条 RLS 策略才是基线。
5. 只向用户指定的新项目恢复。恢复前确认目标地址、public 业务表/业务用户为空，计划无清理/覆盖删除；使用 --no-owner --no-acl，单事务、遇错停止。不要使用 --clean、db reset、强推或为了重试删除数据。
6. 托管 auth/storage schema 已由 Supabase 初始化，须审阅 archive 目录并选择兼容对象/数据，不能整库盲目覆盖系统对象。Auth 用户 UUID 和密码哈希必须保留；新项目会话需重新登录。平台迁移历史、JWT 签名、Secrets、SMTP 和 OAuth 配置单独核对。
7. scripts/migration_inventory.sql 在只读连接中导出逐表行数；scripts/compare_migration_inventory.py 比对两份清单，有差异返回非零。行数只是第一层，还需核对关键字段/关联、RLS/权限、分片数据和文件哈希。
8. `node scripts/restore_storage.mjs --manifest /绝对路径/storage/manifest.json` 默认只校验；加 `--apply` 才按原 bucket/路径上传，需本机 TARGET_SUPABASE_URL / TARGET_SUPABASE_SERVICE_ROLE_KEY。脚本拒绝修改 bucket 权限、覆盖不同文件或删除文件，上传后逐个验 SHA-256。数据库导出产物 bucket 默认排除，业务 Storage 文件本次为 0。上传语义参考 [Supabase 官方文档](https://supabase.com/docs/reference/javascript/storage-from-upload)。
9. 旧站导出后仍可能写入。正式切换要有最终停止写入的边界，或经过确认的增量合并；不能把早期快照当最终全量一致。此任务不自动关闭旧服务。

## 3. 环境变量

浏览器构建所需三个名称：

| 名称 | 获取位置 | 存放位置 |
| --- | --- | --- |
| VITE_SUPABASE_URL | 新 Supabase 的项目 API 地址 | 本机 .env.local；Vercel Production/Preview 环境 |
| VITE_SUPABASE_PUBLISHABLE_KEY | 新项目的 publishable key 或 legacy anon key | 同上；不能使用 secret/service-role key |
| VITE_SUPABASE_PROJECT_ID | 新项目 project-ref | 同上 |

模板见 .env.example，模板无值。密码、连接串和敏感密钥由用户填入忽略的 .env.local 或平台后台，不发到聊天、不提交 Git。迁移工具的 SOURCE_DB_URL / TARGET_DB_URL 等只供本机使用，不放进 VITE_ 变量。

Edge mcp 的服务端读取兼容：SUPABASE_URL；SUPABASE_PUBLISHABLE_KEY 或新平台自动注入的 SUPABASE_PUBLISHABLE_KEYS 字典，最后兼容 SUPABASE_ANON_KEY。仍传递登录用户 JWT，并受该用户 RLS 限制。未使用特权 key 替代用户身份。

MCP 已关闭 Lovable 使用统计，不需要把 LOVABLE_API_KEY 迁过去。当前应用没有 Lovable AI 网关模型调用，不需要新增 OpenAI/Anthropic 账号或费用。

## 4. Vercel 导入与发布

1. 使用自己的 Vercel 账号，选择免费 Hobby；注册/条款和 GitHub 仓库授权按页面实际提示由用户确认。
2. 导入 GitHub 仓库 ychcb0521/veil-of-ignorance，只授权这个仓库所需权限。
3. 首次部署选 migrate-off-lovable，验证期间不把迁移改动直接推到 main。将它设为本次独立站的 Production Branch，或按平台支持方式从该分支建立正式部署。验收后的 main 合并必须走审阅流程；不能误发布未适配的 main。
4. Framework Preset 选 Vite；Root Directory 为仓库根目录。Install Command 由 vercel.json 指定 node scripts/install_standalone.mjs；Build Command 为 node scripts/verify_standalone_env.mjs && npm run build；Output Directory 为 dist。
5. 在 Vercel 的 Production 环境明确填好上述三个新 Supabase 变量；Preview 只在确认其后端目标后配置，不要误写真实业务数据。
6. deployment-target.json 必须记录已核对的新项目标识。安装前的脚本检查平台显式变量、目标项目一致性及浏览器 key 类型；配置缺失时拒绝发布，避免读到仓库 .env 的旧 Cloud 默认值却误以为迁移成功。该检查不会打印变量值。
7. vercel.json 已配置 /(.*) → /index.html 的 SPA rewrite，确保刷新 /journal/campaigns、Deep dig 和 OAuth 授权页等深层路由不 404。
8. 先使用 Vercel 提供的地址完成验证，不购买域名或升级套餐。实际新地址、commit、部署状态在验收后记录到进度文件。

## 5. Supabase Authentication 配置

- Authentication → URL Configuration：Site URL 设置为新正式站地址；Redirect URLs 加入同一正式地址及确实使用的精确回调/预览地址。
- 本机开发若使用该后端，按需加入 http://localhost:8080；不要为省事加入所有站点的宽泛通配。
- 当前新项目自定义 SMTP 未启用，生产认证邮件尚未验收。[Supabase 默认 SMTP](https://supabase.com/docs/guides/auth/auth-smtp) 仅向组织团队邮箱发信；普通用户注册验证/找回密码必须配自有 SMTP。进入 Authentication → Emails → SMTP Settings，使用用户自己的服务端主机/端口/发信人/用户名/密码。密码仅填平台后台；不提交 Git、不配置为 VITE_，不通过关闭邮箱确认绕过。配置后只向用户本人执行经授权的测试邮件。
- 复核 Email 登录、邮箱验证、邮件服务及模板。源项目账号的 UUID、确认状态、profile 初始化状态及业务 user_id 关联要保留。
- MCP 使用 Supabase OAuth 2.1；授权页路径沿用 /.lovable/oauth/consent，虽含 lovable 字样，运行功能不依赖 Lovable。新项目需核对 OAuth server、客户端及重授权流程，发现文档中的 issuer 必须是新后端。
- JWT/会话不跨项目沿用，迁移后需要重新登录；不能通过关闭邮箱确认或放宽 RLS 来绕过登录问题。

## 6. Edge Functions 部署

仅在新项目已确认、数据已恢复并核对后执行，连接参数/令牌由用户在本机或平台配置。

```bash
supabase link --project-ref "$TARGET_PROJECT_REF"
supabase functions deploy fish-market-proxy
supabase functions deploy mcp
```

- supabase/config.toml 和 CLI 链接必须指向新项目；执行前再次核对，不能部署到原 Cloud。
- fish-market-proxy 保留现有只读公开行情白名单及 verify_jwt=false；验证三交易所合法 GET、非法路径 400、写请求 405，不传递用户凭证给交易所。
- mcp 的 `verify_jwt=false` 已按用户单独批准与原站保持一致：只取消 legacy JWT 网关层，SDK 内仍验证 OAuth 签名、issuer/audience/client_id；匿名和无效令牌测试均返回 401。OAuth Server、动态注册已启用，授权路径仍为 `/.lovable/oauth/consent`。
- mcp 保留 5 个只读工具、OAuth issuer/audience/client claim 和逐用户 RLS。核对公开发现、OAuth 和工具调用；遇认证问题先查配置，不得直接放宽权限让测试通过。
- 原生本地构建会生成 supabase/functions/mcp/index.ts，发布前必须使用新项目的构建变量生成并审阅；.lovable/mcp/manifest.json 也应与新 issuer 对齐。
- 单独查看 Supabase 函数部署记录、日志和真实响应。Vercel 前端 Ready 不代表函数已经部署。

## 7. 怎样判断发布成功

以下各项同时成立，才报告发布完成：

1. GitHub 上目标分支的完整 commit SHA 与本次审阅代码一致。
2. Vercel 对同一 commit 的部署为 Ready，环境为 Production，正式域名已指向该部署；只看到 Preview 或 Git push 成功不够。
3. 正式网址加载成功，页面中现有构建版本戳与预期一致；本次迁移不改业务时版本号可继续为 456，提交 SHA 是部署身份的主要依据。
4. 深层路由刷新、登录/退出、原账号资料和原有业务数据正常；按 VERIFY.md 核对 campaign、Legs、对冲、镜像止盈、研究及导出。
5. 后端是指定的新 Supabase，逐表/关键内容核对通过、账号 ID 和 RLS 正确、两个 Edge Functions 实测通过。
6. 安装、构建和运行日志没有未解释的失败。分块体积等已有警告与功能故障区分记录，不顺手优化。

## 8. 自定义域名

新站验收后，在 Vercel 项目 Settings → Domains 添加用户已拥有的域名，按 Vercel 实际给出的 DNS 记录配置。等待域名验证、HTTPS 证书与访问生效，再将 Supabase Site URL/Redirect URLs 更新为该精确地址并验证登录。未获得域名和预算前不购买、转移或付费；Vercel 默认地址可作为完整交付地址。

## 9. 回滚

- 前端故障：选择 Vercel 中已验收的上一份正式部署回退域名指向；再核对对应 commit 和后端兼容性。
- 数据库不能靠前端回滚恢复。禁止自动执行旧 SQL、清空/覆盖原库或删除 Storage。保留完整备份、迁移日志和新站新增记录，先审阅恢复/合并方案。
- 新站验收前原 Lovable 仍可用；正式切换后如要回旧站，要先处理两边后续写入差异，不能把用户带回旧快照而丢失新记录。

## 10. 日后开发流程

### 前端和计算功能

本地开发 → npm run dev 预览 → 相关测试及 npm run build → 推送开发分支 → Vercel Preview 验证 → 经审阅合并到配置的 Production Branch → Vercel 自动部署 → 按第 7 节验收。

当前生产分支以 Vercel 实际配置为准。迁移期分支是 migrate-off-lovable；后续切换到 main 需先审阅合并并同步 Vercel 分支设置。提交与推送不等于发布成功，最终要看正式域名和功能验证。

### 数据库结构变更

先备份并验证 → 在独立开发/测试环境生成新的 migration → 审阅 SQL 和数据兼容性 → 确认恢复后的迁移历史已建立基线 → supabase db push --dry-run 只列本次新迁移 → 获准后 supabase db push → 检查 RLS/数据与应用。

仓库保留了许多历史迁移，其中有破坏性/回填语句。恢复新库后若迁移历史未核对，绝不能直接 db push；不要为修报错随意 migration repair。相关历史基线的实际登记状态须写入最终验收记录。

### 如偶尔继续使用 Lovable

原项目关联 main；不要让 Lovable agent 与本地同时编辑同一条生产分支。保留一处权威代码来源，开始修改前 fetch，对照完整 commit；通过独立分支/PR 审阅合并。不要恢复历史暂停队列，不使用 force push，不让原 Cloud 迁移工具操作新库。Lovable 发布不会替代 Vercel/Supabase 的独立发布和验证流程。
