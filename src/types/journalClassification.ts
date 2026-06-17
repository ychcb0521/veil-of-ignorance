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

export function isJournalItem(item: ClassifiableItem): item is Extract<ClassifiableItem, { kind: 'journal' }> {
  return item.kind === 'journal';
}

export function isOrphanRecordItem(item: ClassifiableItem): item is Extract<ClassifiableItem, { kind: 'orphanRecord' }> {
  return item.kind === 'orphanRecord';
}
