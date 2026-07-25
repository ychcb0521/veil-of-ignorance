import type { TradeJournal } from '@/types/journal';

const REVIEW_AUXILIARY_KEYS = new Set([
  'exit_falsification_status',
  'exit_falsification_note',
  'hedge_worth_it',
  'pre_edge_source',
]);

const AUTOMATIC_POST_REVIEW_KEYS = new Set([
  'post_outcome',
  'post_realized_pnl',
  'post_r_multiple',
  'post_exit_price_snapshot',
  'post_real_close_time',
  'post_simulated_close_time',
  'post_reviewed_at',
]);

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function reviewTimeMs(journal: TradeJournal): number {
  const candidates = [
    journal.post_reviewed_at,
    journal.updated_at,
    journal.created_at,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function journalSnapshotTimeMs(journal: TradeJournal): number {
  const candidates = [
    journal.updated_at,
    journal.created_at,
    journal.pre_real_time,
    journal.pre_simulated_time,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function isReviewField(key: string): boolean {
  return key.startsWith('post_') || REVIEW_AUXILIARY_KEYS.has(key);
}

export function hasCompletedJournalReview(journal: TradeJournal): boolean {
  if (journal.post_reviewed_at?.trim()) return true;

  // 历史 schema 曾出现“答案成功保存，但 post_reviewed_at 没有落库”的记录。
  // 只认人工评价字段；平仓结果、盈亏、平仓时间等自动回填字段不能单独构成评价。
  return Object.entries(journal).some(([key, value]) => (
    (
      (key.startsWith('post_') && !AUTOMATIC_POST_REVIEW_KEYS.has(key))
      || key === 'exit_falsification_status'
      || key === 'exit_falsification_note'
      || key === 'hedge_worth_it'
    )
    && hasMeaningfulValue(value)
  ));
}

/**
 * 同一成交可能同时存在“战役 leg”和“后来补做评价的 journal”。
 * 评价属于成交本身，因此把最新完整评价投影到同 trade_record_id 的每条记录上，
 * 但保留每条记录自己的 id / campaign_id / leg 元数据。
 */
export function mergeCompletedReview(
  target: TradeJournal,
  source: TradeJournal,
): TradeJournal {
  if (!hasCompletedJournalReview(source)) return target;
  if (
    hasCompletedJournalReview(target)
    && reviewTimeMs(target) > reviewTimeMs(source)
  ) {
    return target;
  }

  const reviewPatch: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (isReviewField(key) && value !== undefined) reviewPatch[key] = value;
  });
  return { ...target, ...reviewPatch } as TradeJournal;
}

function latestCompletedReview(journals: TradeJournal[]): TradeJournal | null {
  return journals
    .filter(hasCompletedJournalReview)
    .sort((a, b) => reviewTimeMs(b) - reviewTimeMs(a))[0] ?? null;
}

export function hydrateJournalReviews(journals: TradeJournal[]): TradeJournal[] {
  const reviewedByTradeRecord = new Map<string, TradeJournal>();
  const grouped = new Map<string, TradeJournal[]>();

  journals.forEach(journal => {
    if (!journal.trade_record_id) return;
    const group = grouped.get(journal.trade_record_id) ?? [];
    group.push(journal);
    grouped.set(journal.trade_record_id, group);
  });
  grouped.forEach((group, tradeRecordId) => {
    const reviewed = latestCompletedReview(group);
    if (reviewed) reviewedByTradeRecord.set(tradeRecordId, reviewed);
  });

  return journals.map(journal => {
    if (!journal.trade_record_id) return journal;
    const reviewed = reviewedByTradeRecord.get(journal.trade_record_id);
    return reviewed ? mergeCompletedReview(journal, reviewed) : journal;
  });
}

/**
 * 错题集按“成交”统计，而不是按数据库里偶然存在的重复 journal 行统计。
 * 同一 trade_record_id 只保留一条：优先最新已评价记录，并补回战役归属与快照字段。
 */
export function coalesceJournalRecords(journals: TradeJournal[]): TradeJournal[] {
  const hydrated = hydrateJournalReviews(journals);
  const groups = new Map<string, TradeJournal[]>();
  const standalone: TradeJournal[] = [];

  hydrated.forEach(journal => {
    if (!journal.trade_record_id) {
      standalone.push(journal);
      return;
    }
    const group = groups.get(journal.trade_record_id) ?? [];
    group.push(journal);
    groups.set(journal.trade_record_id, group);
  });

  const coalesced = [...standalone];
  groups.forEach(group => {
    const canonical = [...group].sort((a, b) => {
      const reviewedDelta = Number(hasCompletedJournalReview(b)) - Number(hasCompletedJournalReview(a));
      if (reviewedDelta !== 0) return reviewedDelta;
      const campaignDelta = Number(Boolean(b.campaign_id)) - Number(Boolean(a.campaign_id));
      if (campaignDelta !== 0) return campaignDelta;
      return journalSnapshotTimeMs(b) - journalSnapshotTimeMs(a);
    })[0];

    let merged = { ...canonical } as TradeJournal;
    group.forEach(sibling => {
      Object.entries(sibling).forEach(([key, value]) => {
        if ((merged as Record<string, unknown>)[key] == null && value != null) {
          (merged as Record<string, unknown>)[key] = value;
        }
      });
    });
    const reviewed = latestCompletedReview(group);
    if (reviewed) merged = mergeCompletedReview(merged, reviewed);
    coalesced.push(merged);
  });

  return coalesced.sort((a, b) => (
    journalSnapshotTimeMs(b) - journalSnapshotTimeMs(a)
    || a.id.localeCompare(b.id)
  ));
}
