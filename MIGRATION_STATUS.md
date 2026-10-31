# 无知之幕独立迁移进度

目标：Vercel + 用户自有 Supabase。所有代码变更仅在 migrate-off-lovable；原 Lovable、原数据库和主目录未提交资料保留。

## 已确认授权

- 连续完成必要适配、备份、校验、文档；备份验证后恢复至用户指定的新 Supabase，再部署函数和 Vercel。禁止删除、重置、强推、付费、改变业务逻辑。
- 采用既有 bun.lock 的全部精确版本，仅替换 203 个 Lovable npm 下载地址；冻结安装，不升级依赖。
- 完整数据库导出（含 8 个账号和密码哈希）保存在同项目私有 Cloud Storage、通知用户注册邮箱并下载到本机私有 backups/。
- Vercel 免费 Hobby 账号和条款已确认；GitHub App 仅授权 ychcb0521/veil-of-ignorance，安装已完成。
- 用户已提供现有新库密码并要求代理填写现有公开 key；均只用于指定新项目，值不写入报告或 Git。
- 用户已批准保留新项目 Realtime 系统版本记录，作为平台差异单独登记；不覆盖、删除或降级。

## 已验证完成

- 审计提交 ca01802b、独立部署准备提交 0b810028 已推送；pre-migration-backup 标签已推送，main 未修改。
- 干净 Bun 冻结安装、生产构建、类型检查通过。切换后端前的前端入口与原线上 456 版逐字节一致；面向新项目的构建通过。65 项相关回归和 12 项部署环境检查通过；最终本地生产构建再次通过（32.89 秒）。
- 原生完整备份已下载并校验，全部 zstd 数据块可解码；16 张业务表、8 账号及密码哈希完整。账号大块存档 8 个头行、44 分片均校验可用。
- 新 Supabase elynuzxnvjzypjgzkemc，由用户创建：Free / Singapore / Nano，数据库 PostgreSQL 17.11，TLS 证书和主机名校验通过。
- 选择性恢复在单个事务中提交。45 张已恢复表逐行内容 SHA-256 一致；8 个 profiles 与 Auth 用户 ID 一致。59 条 RLS、7 函数、14 个 public 触发器、126 约束及应用授权均比对一致。
- 56 张归档表的行数有 55 张一致；realtime.schema_migrations 为旧 68 / 新 91，旧版本全部保留、额外 23 条。用户已确认此例外。详见 MIGRATION_ROW_COMPARISON.md。
- 原平台专用 sandbox_exec LOGIN/BYPASSRLS 角色没有带入；应用 schema/default ACL 保持源范围。新库注册触发函数额外的默认 anon/authenticated 执行权限已收回，精确匹配源权限。
- Publishable key 已通过真实应用 profiles 接口验证：HTTP 200，匿名 RLS 返回 0 行。REST 根说明接口要求 Secret key，其 401 不代表公开 key 无效。
- Vercel 项目 veil-of-ignorance 已创建，Hobby；正式分支保存为 migrate-off-lovable，3 个公开前端变量已配置。分配的地址为 https://veil-of-ignorance-ten.vercel.app/，首次正式部署已 Ready / Production，对应 463838300df9888bb2984b6c5f9c91c16199ed66；登录后业务验收仍在进行。

## 正在进行与剩余工作

- fish-market-proxy 已在新项目部署；三交易所 GET 均 200，非法路径 400、POST 405、OPTIONS 204，共 7 项通过。
- mcp 已部署；公开发现 200，匿名及无效令牌均 401，4 项通过。按用户单独批准关闭 legacy JWT 网关，保留 OAuth/RLS；OAuth Server 和动态注册已保存，发现文档 200 指向新项目。
- Supabase Auth Site URL 已设新站地址，重定向仅新正式地址及其子路径。Vercel 已首次正式部署，8 个 SPA 路由 HTTP 200；线上 86 个 JS/CSS 文件与本地逐一 SHA-256 完全一致，入口 SHA-256 与本地完全一致，新后端标识存在、旧 Cloud 标识不存在；16 张业务表匿名 GET 均 200/0 行。等待原账号登录后的业务、导出验收。
- 用户暂停旧站写入后，43 条 / 31,187,784 字节增量已校验保存并在新库单事务提交；总行数 241 未变，键集合未变。最终 16 张业务表的行数及逐行内容摘要全部一致；新库 8 个研究存档头、44 个分片的 rev、gzip、JSON 与序列化长度全部通过。浏览器本机未上云数据与新站运行验收仍待核对。
- 认证邮件 SMTP 尚未配置。默认 Supabase SMTP 只向组织团队邮箱发信，普通用户注册验证/找回密码邮件需另配；不能为绕过邮件关闭邮箱确认。已询问用户现有 SMTP 服务，未创建新账号/密钥或付费。
- 后续数据库迁移历史基线须避免重放旧 SQL；不得直接执行全套历史 migrations。

达到完整数据与账号校验、函数和 OAuth、正式部署、运行验证及最终增量核对之前，不宣称迁移完成，不删除或停用原服务。
