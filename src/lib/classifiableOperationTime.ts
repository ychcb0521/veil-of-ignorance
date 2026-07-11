import type { ClassifiableItem } from '@/types/journalClassification';
import type { TradeRecord } from '@/types/trading';
import { tradeRecordOperationTime } from '@/lib/objectiveOperationTime';

/**
 * 操作时间 = 真实钱包时钟下交易员实际操作的客观时间。
 * 不允许回退到 openTime / closeTime / post_real_close_time，因为那些可能是时间机器里的 K 线时间。
 */
export function classifiableOperationTime(
  item: ClassifiableItem,
  linkedRecord?: TradeRecord | null,
): number | null {
  return tradeRecordOperationTime(linkedRecord)
    ?? tradeRecordOperationTime(item.kind === 'journal' ? item.record : item.record);
}
