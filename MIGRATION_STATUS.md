# 无知之幕独立迁移：已部署并完成主要验收

正式站：https://veil-of-ignorance-ten.vercel.app/
前端：用户 Vercel Hobby；后端：用户 Supabase Free，elynuzxnvjzypjgzkemc / Singapore。生产分支 migrate-off-lovable。原 Lovable、原数据库和主目录未提交研究资料保留；以后使用新站持续写入。

## 已完成

- 全部代码改动仅在迁移分支，main 未修改。依赖沿用既有 bun.lock 精确版本，冻结安装；不升级、不重构、不改变交易计算或界面。
- 原生完整备份、Auth 8 个账号及密码哈希已私有保存。pre-migration-backup 标签已推送。业务 Storage 文件原为 0，新增私有数据库导出文件也按原路径备份。
- 45 张恢复表全字段 SHA-256 一致。用户暂停旧站后，43 条 / 31,187,784 字节最终增量单事务提交；16 张业务表行数和内容摘要全部一致。8 个研究存档头、44 分片的 rev、gzip、JSON 和长度全部通过。
- 59 条 RLS、7 函数、14 public 触发器、126 约束、应用授权核对一致。未引入 Lovable 平台专用 sandbox_exec BYPASSRLS 角色。
- 56 张归档表中唯一平台差异为 realtime.schema_migrations：旧 68 / 新 91，旧版本完整保留。用户已明确批准保留新系统记录；未覆盖或降级。
- 两个 Edge Functions 已部署。行情代理 7 项实测通过；MCP 发现、匿名/无效令牌拒绝 4 项通过。OAuth Server 与动态注册已按用户批准启用，SDK OAuth 验签、client_id 和用户 RLS 保留。
- Auth Site URL/重定向指向新站。用户已用原账号密码成功登录，并亲自确认退出、通过验证邮件链接再次登录成功。
- 用户选择 ychpsychology@163.com；现有授权码仅保存至新 Supabase SMTP。smtp.163.com / 465 已保存、刷新确认启用；验证邮件接口 200，用户确认收到并完成登录回调。授权码不写代码、报告或本机迁移配置。
- 新站历史成交 1507、仓位历史 1507、资金流水 573、信号库 1073、鱼舱 33 可读取。战役列表及详情、3 条 Legs/2 条滚动对冲、情绪日记、规则和 Deep Dig 已实际打开。Deep RSA 旧入口正常重定向。ATI/PRS 两项指标存在。
- 渔显示自动模式、每 1h；原算法配置可读取，未为验收修改阈值。账户界面偏好通过普通登录用户写入新库、刷新后保留，并已恢复原值。
- 单张 PNG 实测 5236×5218，结构/CRC 与视觉检查通过；批量 ZIP 含 2 张 PNG，CRC、解压、中文文件名与完整尺寸通过。所有下载及私有验收副本保留。
- Vercel 两次部署均 Ready / Production（首次 46383830，验收报告 e41c40e7）；8 个 SPA 路由 200，86 个 JS/CSS 与本地构建逐一 SHA-256 一致，线上只含新后端标识。16 张表匿名读取均返回 0 行。最终报告提交后仍须确认同分支最新部署 Ready。
- 最终本地生产构建、65 项既有回归、12 项环境保护检查、4 项 Storage 恢复保护检查通过。

## 使用与后续开发

- 当前生产分支是 migrate-off-lovable：本地预览/测试 → 推送该分支 → Vercel 自动构建 → 检查 Ready / Production、Source commit、正式域名和实际功能。仅推送成功不等于发布完成。
- 首次新增数据库结构变更前，必须单独审阅迁移历史基线：源托管库的历史与仓库旧脚本数量不同。不要直接重放历史 migrations 或直接 db push。DEPLOY.md 已给出备份、dry-run、审阅流程。前端日常发布不依赖执行数据库迁移。
- MCP 外部客户端应按新地址重新授权；本次验证公开发现和鉴权拒绝行为，未创建额外外部客户端来读取用户数据。首次客户端授权后的 5 个工具按 VERIFY.md 检查。
- VERIFY.md 保留日后完整逐项验收：跨账号读取隔离、新建真实业务记录等没有伪造测试记录。原域名的浏览器数据没有清理；已上云研究存档已完整恢复。

详细历史见 MIGRATION_AUDIT.md；逐表比对见 MIGRATION_ROW_COMPARISON.md；日常发布与回滚见 DEPLOY.md。私有数据、数据库密码、授权码、令牌不在 Git 中。
