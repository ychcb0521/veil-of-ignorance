# 无知之幕独立迁移进度

目标：Vercel + 用户自有 Supabase；原 Lovable 及原数据库保留。所有代码变更在 migrate-off-lovable。

## 已确认的执行授权

用户已确认连续完成必要适配、备份、校验脚本、发布文档；备份通过后，只向其指定的新 Supabase 恢复并部署，再部署 Vercel。禁止删除、重置、强推、付费、改变业务逻辑。密钥和密码由用户在平台或 .env.local 填写。

用户已确认：以仓库现有 bun.lock 的精确版本为准，仅替换 Lovable npm 缓存地址为公开 npm；冻结安装，不升级依赖。已核对 5 项关键包的公开 npm 完整性哈希一致：MCP 0.22.0、Zod 4.4.3、drizzle-kit 0.31.11、drizzle-orm 0.45.4、postgres 3.4.9。

用户已明确允许：包含业务数据、8 个账号及密码哈希的完整数据库导出保存在同一 Lovable 项目 Cloud Storage，由 Lovable 发往其注册邮箱的临时下载链接，再下载到本机本分支 backups/ 私有目录。

## 当前事实

- 第 1 阶段审计报告提交 ca01802b 已推送。
- 已按既有 Bun 锁在全新目录完成冻结安装、生产构建、类型检查；前端入口与原线上 456 版逐字节一致。
- 原数据库 PostgreSQL 17.6，16 张 public 表，8 个 Auth 账号，约 84 MB；导出前 Storage buckets/objects 均为 0。
- 实际库有 59 条 RLS 策略；静态迁移推导的 63 条含额外 4 条 trade_campaigns_user_* 历史策略，实际库没有这 4 条。迁移以实际库为准，不重放旧迁移。
- 原 Cloud 完整导出已下载到本机私有 backups/，ZIP 和 custom archive 校验通过；zstd 数据块已完整解码，16 张 public 表、59 策略、7 函数、14 public 触发器、8 个账号及其密码哈希、profiles 关联均已核对。8 份账号大数据的 44 个分片全部版本一致且可解码。这是导出时快照，尚非最终切换快照。
- 用户已创建新 Supabase：elynuzxnvjzypjgzkemc，Free / Singapore / Nano / Healthy；未连接 GitHub 自动迁移。现有 Publishable key 已按用户要求写入忽略提交的 .env.local；数据库密码仍需用户通过本机填写页提供，不发送到聊天。
- Vercel 免费 Hobby 账号已在控制台确认；尚未导入仓库或部署。
- 已补齐实际源库对象目录：7 个 public 函数、14 个非内部触发器；迁移以实际定义为准。65 项代理和状态持久化相关回归检查通过。
- 原站仍在运行；切换前必须安排最终无新增写入的快照/增量核对，不能用早先行数推断最终一致。

## 完成标准

完整备份校验 → 新库恢复（含 Auth、RLS、函数/触发器/权限）→ 逐表及关键内容核对 → 两个 Edge Functions 和 OAuth 配置 → Vercel 正式部署 → 版本/深层路由/账号及业务验证 → 交付新地址、发布和回滚说明。

未达到这些标准前，不宣称迁移完成，不删除或停用原服务。
