import type { OddsStructure } from '@/types/journal';

export type OddsStructureReview = 'right' | 'mixed' | 'wrong';

export interface OddsStructureOption {
  id: OddsStructure;
  label: string;
  description: string;
}

export const ODDS_STRUCTURE_OPTIONS: readonly OddsStructureOption[] = [
  {
    id: 'r1_easy',
    label: '1R 容易到达',
    description: '最近目标清晰，正常波动即可触达，适合基础试仓。',
  },
  {
    id: 'r2_supported',
    label: '2R 有结构支撑',
    description: '上方空间打开，阻力不密集，值得正常暴露。',
  },
  {
    id: 'r3_open',
    label: '3R 以上打开',
    description: '趋势、动能、环境共振，具备大波段潜力。',
  },
  {
    id: 'odds_insufficient',
    label: '盈亏比不足',
    description: '止损太远或目标太近，即使方向对也不值得做。',
  },
  {
    id: 'target_unclear',
    label: '目标不清楚',
    description: '看不出有效止盈区，不能计算计划盈亏比。',
  },
] as const;

export const ODDS_STRUCTURE_LABELS: Record<OddsStructure, string> = {
  r1_easy: '1R 容易到达',
  r2_supported: '2R 有结构支撑',
  r3_open: '3R 以上打开',
  odds_insufficient: '盈亏比不足',
  target_unclear: '目标不清楚',
  against_crowd_unreleased: '逆拥挤（旧）',
  neutral_choppy: '中性（旧）',
  with_crowd_released: '顺情绪 / 追价（旧）',
};

export const ODDS_STRUCTURE_REVIEW_LABELS: Record<OddsStructureReview, string> = {
  right: '对',
  mixed: '一般',
  wrong: '错',
};

const REVIEW_PREFIX = '[盈亏比目标复盘] ';
const LEGACY_REVIEW_PREFIX = '[盈亏比结构复盘] ';

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
  const prefix = text.startsWith(REVIEW_PREFIX)
    ? REVIEW_PREFIX
    : text.startsWith(LEGACY_REVIEW_PREFIX)
      ? LEGACY_REVIEW_PREFIX
      : null;
  if (!prefix) {
    return { review: null, body: text };
  }

  const [firstLine, ...rest] = text.split('\n');
  const reviewLabel = firstLine.slice(prefix.length).trim();
  const review = (Object.entries(ODDS_STRUCTURE_REVIEW_LABELS) as [OddsStructureReview, string][])
    .find(([, label]) => label === reviewLabel)?.[0] ?? null;

  return {
    review,
    body: rest.join('\n').trim(),
  };
}
