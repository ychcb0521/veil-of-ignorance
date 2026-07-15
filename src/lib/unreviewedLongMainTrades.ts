import { buildTradeRecordLookup, journalOperationTime } from '@/lib/objectiveOperationTime';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export interface ObjectiveLongMainReviewItem {
  journal: TradeJournal;
  record: TradeRecord | null;
  operationTime: number;
  symbol: string;
  reviewed: boolean;
}

export interface UnreviewedSymbolSummary {
  symbol: string;
  count: number;
  earliestOperationTime: number;
  latestOperationTime: number;
}

function normalizedSymbol(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * 可评价历史的统一口径：真实交易、主力多单、存在成交关联，并且能还原未经移位的客观操作时间。
 * 不硬编码起始日期；旧数据从第一个真正拥有客观操作时间的样本自然开始。
 */
export function buildObjectiveLongMainReviewItems(
  journals: TradeJournal[],
  tradeRecords: TradeRecord[],
): ObjectiveLongMainReviewItem[] {
  const recordLookup = buildTradeRecordLookup(tradeRecords);
  return journals.flatMap(journal => {
    if ((journal.journal_kind ?? 'trade') !== 'trade') return [];
    if ((journal.order_kind ?? 'main') !== 'main') return [];
    if (journal.direction !== 'long' || !journal.trade_record_id) return [];
    const record = recordLookup.get(journal.trade_record_id) ?? null;
    const operationTime = journalOperationTime(journal, record);
    const symbol = normalizedSymbol(journal.symbol);
    if (operationTime == null || !symbol) return [];
    return [{
      journal,
      record,
      operationTime,
      symbol,
      reviewed: Boolean(journal.post_reviewed_at),
    }];
  });
}

export function buildUnreviewedLongMainItems(
  journals: TradeJournal[],
  tradeRecords: TradeRecord[],
): ObjectiveLongMainReviewItem[] {
  return buildObjectiveLongMainReviewItems(journals, tradeRecords).filter(item => !item.reviewed);
}

export function summarizeUnreviewedSymbols(
  items: ObjectiveLongMainReviewItem[],
): UnreviewedSymbolSummary[] {
  const bySymbol = new Map<string, UnreviewedSymbolSummary>();
  for (const item of items) {
    const current = bySymbol.get(item.symbol);
    if (!current) {
      bySymbol.set(item.symbol, {
        symbol: item.symbol,
        count: 1,
        earliestOperationTime: item.operationTime,
        latestOperationTime: item.operationTime,
      });
      continue;
    }
    current.count += 1;
    current.earliestOperationTime = Math.min(current.earliestOperationTime, item.operationTime);
    current.latestOperationTime = Math.max(current.latestOperationTime, item.operationTime);
  }
  return [...bySymbol.values()].sort((a, b) => (
    b.latestOperationTime - a.latestOperationTime || a.symbol.localeCompare(b.symbol)
  ));
}
