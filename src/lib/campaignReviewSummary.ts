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
