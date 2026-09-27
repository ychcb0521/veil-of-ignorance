import { buildCampaignDeviationRuleTextFromNote } from '@/lib/campaignDeviationRules';
import type { CampaignDeviationNote } from '@/types/journal';

/** 复用战役已有 JSON 字段，不改用户的战役备注，也不依赖新增数据库列。 */
export const CAMPAIGN_REVIEW_SUMMARY_KEY = '__campaign_review_summary_v1__';

export function readCampaignReviewSummary(notes: Record<string, CampaignDeviationNote> | null | undefined): string {
  return notes?.[CAMPAIGN_REVIEW_SUMMARY_KEY]?.reason ?? '';
}

export function withCampaignReviewSummary(
  notes: Record<string, CampaignDeviationNote>,
  summary: string,
): Record<string, CampaignDeviationNote> {
  // 空字符串也是明确保存的值；不能删除键，否则旧的本地镜像可能把已清空内容合并回来。
  return { ...notes, [CAMPAIGN_REVIEW_SUMMARY_KEY]: { reason: summary } };
}

/**
 * 【用户要求】复盘总结里「违规」「修正」两行，填写后自动纳入「规则」。
 * 同样存进战役的 deviation_notes（专用键，不改数据库）：reason = 违规、fix = 修正——与逐腿偏离备注同一种形状，
 * 所以规则文字用同一个生成函数（【战役偏离】违规操作：…。修正后的规则：…），规则页按文字就能认回这场战役（换台电脑也认得）。
 */
export const CAMPAIGN_REVIEW_RULE_KEY = '__campaign_review_rule_v1__';

export type CampaignReviewRule = { violation: string; fix: string };

export function readCampaignReviewRule(notes: Record<string, CampaignDeviationNote> | null | undefined): CampaignReviewRule {
  const note = notes?.[CAMPAIGN_REVIEW_RULE_KEY];
  return { violation: note?.reason ?? '', fix: note?.fix ?? '' };
}

export function withCampaignReviewRule(
  notes: Record<string, CampaignDeviationNote>,
  rule: CampaignReviewRule,
): Record<string, CampaignDeviationNote> {
  // 清空也写成空串（不删键），理由同复盘总结：旧的本地镜像不能把已清空的内容合并回来
  return { ...notes, [CAMPAIGN_REVIEW_RULE_KEY]: { reason: rule.violation.trim(), fix: rule.fix.trim() } };
}

/** 这一对生成的规则文字；「修正」为空时不生成规则（只写了违规，还没有可执行的规则）。 */
export function campaignReviewRuleText(rule: CampaignReviewRule): string | null {
  return buildCampaignDeviationRuleTextFromNote({ reason: rule.violation, fix: rule.fix });
}
