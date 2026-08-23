import type { SuggestedLegRole, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export type ClassifiableItem =
  | {
      id: string;
      kind: 'journal';
      journal: TradeJournal;
      /** 该 journal 已成交时关联的真实成交记录，用于显示实际平仓时间/平仓价。 */
      record?: TradeRecord | null;
    }
  | {
      id: string;
      kind: 'orphanRecord';
      record: TradeRecord;
    };

export interface ClassifiableSuggestion {
  itemId: string;
  suggestedRole: SuggestedLegRole['suggestedRole'];
  confidence: SuggestedLegRole['confidence'];
  reason: string;
}

/**
 * 从待归类项里取出「这条腿实际成交在什么价」，喂给 suggestLegRoles 的初始对冲价格判据。
 * 对冲单 A / B 是照着**实际**成本线挂的，只拿快照里的计划价去比，
 * 一个滑点就能让判据落空。
 */
export function filledEntryPriceFromItems(
  items: ClassifiableItem[],
): (journal: TradeJournal) => number | null {
  const byJournalId = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== 'journal') continue;
    const price = item.record?.entryPrice;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      byJournalId.set(item.journal.id, price);
    }
  }
  return journal => byJournalId.get(journal.id) ?? null;
}

export function isJournalItem(item: ClassifiableItem): item is Extract<ClassifiableItem, { kind: 'journal' }> {
  return item.kind === 'journal';
}

export function isOrphanRecordItem(item: ClassifiableItem): item is Extract<ClassifiableItem, { kind: 'orphanRecord' }> {
  return item.kind === 'orphanRecord';
}
