import { COGNITIVE_BIAS_LABELS } from '@/lib/cognitiveBiasTags';
import { EMOTION_TAG_META, PAIN_TAG_LABELS, type TradeJournal } from '@/types/journal';

/**
 * 正向情绪（冷静/专注/耐心，以及历史遗留的 confident/content）帮助执行规则，
 * 不是"漏洞"，因此排除在偏差光谱之外。中性与负向情绪都计入。
 */
const POSITIVE_EMOTION_TAGS = new Set<string>([
  ...Object.entries(EMOTION_TAG_META)
    .filter(([, meta]) => meta.valence === 'positive')
    .map(([id]) => id),
  'confident',
  'content',
]);

export interface BiasSpectrumItem {
  id: string;
  label: string;
  occurrences: number;
  loss_count: number;
  loss_ratio: number;
  rank: number;
  is_biggest_gap: boolean;
}

export interface BiasSpectrumResult {
  items: BiasSpectrumItem[];
  labeledTradeCount: number;
}

function upsertTag(
  bucket: Map<string, { label: string; occurrences: number; loss_count: number }>,
  id: string,
  label: string,
  isLoss: boolean,
) {
  const current = bucket.get(id) ?? { label, occurrences: 0, loss_count: 0 };
  current.occurrences += 1;
  if (isLoss) current.loss_count += 1;
  bucket.set(id, current);
}

export function computeBiasSpectrum(
  journals: TradeJournal[],
  days: number = 90,
  nowMs: number = Date.now(),
): BiasSpectrumResult {
  const sinceMs = nowMs - days * 24 * 60 * 60_000;
  const trades = journals.filter(journal =>
    (journal.journal_kind ?? 'trade') === 'trade'
    && new Date(journal.pre_simulated_time).getTime() >= sinceMs,
  );

  const bucket = new Map<string, { label: string; occurrences: number; loss_count: number }>();
  let labeledTradeCount = 0;

  for (const journal of trades) {
    const painTags = (journal.pre_pain_tags ?? []).filter(tag => !POSITIVE_EMOTION_TAGS.has(tag));
    const cognitiveBiasTags = (journal.pre_cognitive_bias_tags ?? []).filter(tag => tag !== 'none');
    const hasAnyTag = painTags.length > 0 || cognitiveBiasTags.length > 0;
    if (!hasAnyTag) continue;

    labeledTradeCount += 1;
    const isLoss = journal.post_outcome === 'loss';

    painTags.forEach(tag => upsertTag(bucket, tag, PAIN_TAG_LABELS[tag] ?? tag, isLoss));
    cognitiveBiasTags.forEach(tag => upsertTag(bucket, tag, COGNITIVE_BIAS_LABELS[tag] ?? tag, isLoss));
  }

  const items = [...bucket.entries()]
    .map(([id, value]) => ({
      id,
      label: value.label,
      occurrences: value.occurrences,
      loss_count: value.loss_count,
      loss_ratio: value.occurrences === 0 ? 0 : value.loss_count / value.occurrences,
    }))
    .sort((left, right) =>
      right.occurrences - left.occurrences
      || right.loss_count - left.loss_count
      || left.label.localeCompare(right.label, 'zh-CN'))
    .slice(0, 6)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      is_biggest_gap: index === 0,
    }));

  return { items, labeledTradeCount };
}
