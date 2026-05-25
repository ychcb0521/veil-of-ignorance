import type { SuggestedLegRole, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export type ClassifiableItem =
  | {
      id: string;
      kind: 'journal';
      journal: TradeJournal;
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
