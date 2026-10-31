# 原生备份与新 Supabase 逐表行数核对

目标项目：elynuzxnvjzypjgzkemc。基线为已验证的完整原生备份；原站在备份后仍可能产生新写入，最终切换前还需核对增量。

单事务恢复已提交成功。56 张归档数据表中，55 张行数一致。唯一差异是 Supabase 托管的 Realtime 系统版本记录，旧库 68 条、新库 91 条。此前已按用户“任何不一致立即停”的要求暂停；用户随后已明确批准保留新项目系统记录，在只读核对通过后继续。未清空、删除或覆盖该系统表。

行数一致只是第一层验证，不能替代字段内容、账号哈希、分片、RLS 与功能验收。

| 表 | 备份行数 | 新库行数 | 结果 |
| --- | ---: | ---: | --- |
| auth.audit_log_entries | 0 | 0 | 一致 |
| auth.custom_oauth_providers | 0 | 0 | 一致 |
| auth.flow_state | 0 | 0 | 一致 |
| auth.identities | 8 | 8 | 一致 |
| auth.instances | 0 | 0 | 一致 |
| auth.mfa_amr_claims | 11 | 11 | 一致 |
| auth.mfa_challenges | 0 | 0 | 一致 |
| auth.mfa_factors | 0 | 0 | 一致 |
| auth.mfa_recovery_code_sets | 0 | 0 | 一致 |
| auth.mfa_recovery_codes | 0 | 0 | 一致 |
| auth.oauth_authorizations | 0 | 0 | 一致 |
| auth.oauth_client_states | 0 | 0 | 一致 |
| auth.oauth_clients | 0 | 0 | 一致 |
| auth.oauth_consents | 0 | 0 | 一致 |
| auth.one_time_tokens | 3 | 3 | 一致 |
| auth.refresh_tokens | 235 | 235 | 一致 |
| auth.saml_providers | 0 | 0 | 一致 |
| auth.saml_relay_states | 0 | 0 | 一致 |
| auth.schema_migrations | 82 | 82 | 一致 |
| auth.scim_tokens | 0 | 0 | 一致 |
| auth.scim_users | 0 | 0 | 一致 |
| auth.sessions | 11 | 11 | 一致 |
| auth.sso_domains | 0 | 0 | 一致 |
| auth.sso_providers | 0 | 0 | 一致 |
| auth.users | 8 | 8 | 一致 |
| auth.webauthn_challenges | 0 | 0 | 一致 |
| auth.webauthn_credentials | 0 | 0 | 一致 |
| drizzle.__drizzle_migrations | 1 | 1 | 一致 |
| public.account_follows | 2 | 2 | 一致 |
| public.campaign_counterfactuals | 170 | 170 | 一致 |
| public.cognitive_assets | 2 | 2 | 一致 |
| public.decision_emotion_diaries | 2 | 2 | 一致 |
| public.error_tag_categories | 6 | 6 | 一致 |
| public.error_tag_patterns | 0 | 0 | 一致 |
| public.journal_tag_assignments | 0 | 0 | 一致 |
| public.pain_log_entries | 0 | 0 | 一致 |
| public.profiles | 8 | 8 | 一致 |
| public.stop_doing_items | 0 | 0 | 一致 |
| public.trade_campaign_comments | 0 | 0 | 一致 |
| public.trade_campaigns | 467 | 467 | 一致 |
| public.trade_journals | 152 | 152 | 一致 |
| public.trade_principles | 0 | 0 | 一致 |
| public.trading_rules | 61 | 61 | 一致 |
| public.user_sim_state | 241 | 241 | 一致 |
| realtime.schema_migrations | 68 | 91 | 已获准保留新平台版本 |
| realtime.subscription | 0 | 0 | 一致 |
| storage.buckets | 1 | 1 | 一致 |
| storage.buckets_analytics | 0 | 0 | 一致 |
| storage.buckets_vectors | 0 | 0 | 一致 |
| storage.migrations | 74 | 74 | 一致 |
| storage.objects | 0 | 0 | 一致 |
| storage.s3_multipart_uploads | 0 | 0 | 一致 |
| storage.s3_multipart_uploads_parts | 0 | 0 | 一致 |
| storage.vector_indexes | 0 | 0 | 一致 |
| supabase_migrations.schema_migrations | 9 | 9 | 一致 |
| vault.secrets | 0 | 0 | 一致 |

Realtime 版本记录只读核对：原有版本缺失 0 条；新项目额外版本 23 条。

已恢复的 45 张表进一步完成逐行、逐字段对齐后的 SHA-256 内容核对，全部一致；包含业务数据、账号记录及密码哈希。7 个函数、14 个 public 触发器、126 个约束、59 条 RLS 与应用授权定义均已比对一致。

## 最终切换增量

旧站暂停后补齐 43 条状态记录，16 张 public 表的最新逐表行数和逐行内容摘要全部一致。状态表仍 241 行；8 个研究存档头、44 个分片均完整可解码。Realtime 系统例外继续按用户批准保留。数据证据仅留在私有 backups/，不含用户记录正文的报告可提交。
