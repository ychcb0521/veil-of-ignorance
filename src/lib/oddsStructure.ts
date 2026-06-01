import type { OddsStructure } from '@/types/journal';

export type OddsStructureReview = 'right' | 'mixed' | 'wrong';

export interface OddsStructureOption {
  id: OddsStructure;
  label: string;
  description: string;
}

export const ODDS_STRUCTURE_OPTIONS: readonly OddsStructureOption[] = [
  {
    id: 'against_crowd_unreleased',
    label: '逆拥挤',
    description: '向量纯净，但还未释放（趋势刚起）→ 结构性高盈亏比',
  },
  {
    id: 'neutral_choppy',
    label: '中性',
    description: '多空力量胶着（震荡，没成型的趋势）→ 盈亏比看你自己的下限；在震荡里开仓＝持有小机会仓位',
  },
  {
    id: 'with_crowd_released',
    label: '顺情绪 / 追价',
    description: '向量纯净，但已释放（趋势末端），反向回吐空间太大 → 结构性低盈亏比',
  },
] as const;

export const ODDS_STRUCTURE_LABELS: Record<OddsStructure, string> = {
  against_crowd_unreleased: '逆拥挤',
  neutral_choppy: '中性',
  with_crowd_released: '顺情绪 / 追价',
};

export const ODDS_STRUCTURE_REVIEW_LABELS: Record<OddsStructureReview, string> = {
  right: '对',
  mixed: '一般',
  wrong: '错',
};

const REVIEW_PREFIX = '[盈亏比结构复盘] ';

export function buildOddsStructureReviewText(
  body: string,
  review: OddsStructureReview | null,
): string {
  const trimmedBody = body.trim();
  if (!review) return trimmedBody;
  const line = `${REVIEW_PREFIX}${ODDS_STRUCTURE_REVIEW_LABELS[review]}`;
  return trimmedBody ? `${line}\n${trimmedBody}` : line;
}

export function parseOddsStructureReviewText(
  raw: string | null | undefined,
): { review: OddsStructureReview | null; body: string } {
  const text = (raw ?? '').trim();
  if (!text.startsWith(REVIEW_PREFIX)) {
    return { review: null, body: text };
  }

  const [firstLine, ...rest] = text.split('\n');
  const reviewLabel = firstLine.slice(REVIEW_PREFIX.length).trim();
  const review = (Object.entries(ODDS_STRUCTURE_REVIEW_LABELS) as [OddsStructureReview, string][])
    .find(([, label]) => label === reviewLabel)?.[0] ?? null;

  return {
    review,
    body: rest.join('\n').trim(),
  };
}
