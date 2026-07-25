export type CampaignAccountIdentity = {
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
};

const MAX_ACCOUNT_SEGMENT_LENGTH = 24;

function normalizeCodeSegment(value: string): string {
  return Array.from(value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, ''))
    .slice(0, MAX_ACCOUNT_SEGMENT_LENGTH)
    .join('');
}

/** 优先使用用户设置的账户名；未设置时使用登录邮箱前缀，最后回退到用户 ID。 */
export function resolveCampaignAccountName(identity: CampaignAccountIdentity): string | null {
  const emailAccount = identity.email?.split('@')[0] ?? '';
  const candidates = [
    identity.displayName ?? '',
    emailAccount,
    identity.userId ? `USER-${identity.userId.slice(0, 8)}` : '',
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCodeSegment(candidate);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * 为人类可见的战役编号嵌入账户名，同时保留数据库中的原始唯一编号作为后缀。
 * 原始 campaign_code 不会被改写，因此战役链接、唯一索引和历史关联保持稳定。
 */
export function formatCampaignDisplayCode(
  campaignCode: string | null | undefined,
  accountName: string | null | undefined,
  fallbackId?: string | null,
): string {
  const storedCampaignCode = campaignCode?.trim();
  const canonicalCode = storedCampaignCode || fallbackId?.trim() || 'C-UNKNOWN';
  const accountSegment = normalizeCodeSegment(accountName ?? '');
  if (!accountSegment) return canonicalCode;

  const rawSuffix = storedCampaignCode
    ? canonicalCode.replace(/^C(?:[-_])?/i, '')
    : canonicalCode;
  const normalizedSuffix = normalizeCodeSegment(rawSuffix) || 'UNKNOWN';
  if (
    normalizedSuffix === accountSegment
    || normalizedSuffix.startsWith(`${accountSegment}-`)
  ) {
    return `C-${normalizedSuffix}`;
  }
  return `C-${accountSegment}-${normalizedSuffix}`;
}
